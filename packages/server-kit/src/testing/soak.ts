import { seededRng, type ActionKind, type Rng, type RoomConfig, type ServerMessage } from '@bp/core'
import type { HandSummary } from '../repositories.js'
import type { TestServer } from './harness.js'
import { TestClient } from './test-client.js'

/**
 * Spec §29.3: many clients, many rooms, many hands, over real sockets, checking that points are
 * conserved and that no client's `seq` stream has a hole in it.
 *
 * The driver is deliberately dumb: it plays the legal action the server itself offered (the
 * `legal.kinds` on `TURN_CHANGED`, `play`/`fold` on `DECISION_PHASE`), never bets or raises, and
 * folds a fixed share of the time. That keeps pots at one big blind a hand, so nobody busts and a
 * 20-hand run stays a test of the *plumbing* rather than of the bot's poker.
 */
export interface SoakOptions {
  clients: number
  rooms: number
  /** A floor, not a cap: every room keeps playing until the *last* room reaches it. */
  handsPerRoom: number
  mode: 'holdem' | 'blind'
  /**
   * Seeds one RNG stream *per seat* (`seed + seatIndex`), so a seat's decision sequence depends only
   * on how many turns it has been given — not on the order the sockets happened to be served in.
   * That makes the *policy* reproducible; the hands themselves are not bit-for-bit reproducible,
   * because the server's own deck consumption follows whichever room reaches `startGame` first and
   * the delays are real `setTimeout`s.
   */
  seed: number
  /** Random think time before an action, to spread the load out. Omitted = act immediately. */
  actionDelayMs?: [min: number, max: number]
}

export interface SoakResult {
  /** Hands settled across every room, cancelled ones included. */
  hands: number
  /**
   * `HAND_COMPLETE`s counted per room from that room's own client stream, so §29.3's "20 hands
   * *each*" is assertable rather than an aggregate that one busy room could satisfy alone.
   */
  handsPerRoomSeen: number[]
  cancelledHands: number
  /** Σ `HAND_SETTLED.summary.fee` — the domain events are the fee source of truth here. */
  fees: number
  /** Σ fee over the *cancelled* summaries. A cancelled hand takes no rake, so this must be 0. */
  cancelledFees: number
  /** Σ every sink row the repositories recorded (`table_fee` + `carry_over`). */
  sinks: number
  /** Σ `net` of every bot seat across every settled hand: points bots took off (or gave to) the humans. */
  botNet: number
  startBalances: number
  /** Read after `shutdown()`, so every table stack and carry-over pot is back in a balance. */
  endBalances: number
  /** How many action → broadcast round trips were timed. Fewer than the actions sent: a seat whose
   * turn timer beat it contributes no sample (the timer acted, not the client). */
  latencySamples: number
  /** A frame whose `seq` was not exactly one past the previous one. Each gap costs one `RESYNC`. */
  seqGaps: number
  resyncs: number
  p95ActionToBroadcastMs: number
  maxActionToBroadcastMs: number
  /** Every `ERROR` frame that was not an expected consequence of racing the room's own state machine. */
  errors: string[]
  /** Races the driver knowingly runs into (`GAME_IN_PROGRESS` on a `READY`, `SEAT_TAKEN` on a re-buy). */
  tolerated: string[]
}

const HOLDEM_BUY_IN = 20_000

function roomConfig(mode: 'holdem' | 'blind', seats: number): RoomConfig {
  return mode === 'holdem'
    ? { name: 'soak-holdem', mode: 'holdem', maxPlayers: Math.max(2, seats), isPrivate: false, turnTimerSec: 15, autoStart: true, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
    : { name: 'soak-blind', mode: 'blind', maxPlayers: Math.max(2, seats) + 1, isPrivate: false, turnTimerSec: 10, autoStart: true, blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 1_000, botCount: 1 } }
}

/** `ERROR` codes the driver can provoke by racing the room's own state machine; not failures. */
const TOLERATED = new Set(['GAME_IN_PROGRESS', 'SEAT_TAKEN', 'NOT_ENOUGH_PLAYERS'])

/**
 * The `seq` rule a soak client applies to every frame. Pulled out of the listener because a healthy
 * run never takes the `gap` branch, so this is the only way it can have a test of its own
 * (`soak.test.ts`, "the seq rule"): otherwise a mutation that stopped detecting gaps would still
 * make the soak pass.
 */
export function seqVerdict(lastSeq: number, seq: number): 'apply' | 'duplicate' | 'gap' {
  if (lastSeq < 0) return 'apply' // the first frame this client has seen: nothing to compare against
  if (seq <= lastSeq) return 'duplicate' // a frame the RESYNC snapshot already accounted for
  return seq === lastSeq + 1 ? 'apply' : 'gap'
}

interface Seat {
  id: string
  client: TestClient
  /** This seat's own decision stream, seeded `opts.seed + index`: independent of socket ordering. */
  rng: Rng
  room: number
  seat: number
  leader: boolean
  seated: boolean
  ready: boolean
  status: 'OPEN' | 'IN_GAME'
  balance: number
  /**
   * The seat's table stack, as the frames tell it (`PLAYER_SAT`, `SETTLEMENT`, `HAND_CANCELLED`): Blind deals a short
   * seat (plan 27 D2), and a seat whose ante took the whole stack is played for it — it must not answer the decision.
   */
  stack: number
  /** This hand's ante emptied the seat, so its decision is the server's (`DECISION_MADE` right after the phase). */
  autoPlayed: boolean
  lastSeq: number
  pending: { reqId: string; sentAt: number } | null
  timers: NodeJS.Timeout[]
}

export async function runSoak(server: TestServer, opts: SoakOptions): Promise<SoakResult> {
  const perRoom = Math.floor(opts.clients / opts.rooms)
  if (perRoom < 2) throw new Error(`each soak room needs two humans; ${opts.clients} clients over ${opts.rooms} rooms gives ${perRoom}`)
  const ids = [...server.repos.records.keys()].slice(0, opts.clients)
  if (ids.length < opts.clients) throw new Error(`the server seeds ${ids.length} players but the soak asked for ${opts.clients}`)

  const errors: string[] = []
  const tolerated: string[] = []
  const latencies: number[] = []
  const config = roomConfig(opts.mode, perRoom)
  const needed = opts.mode === 'holdem' ? HOLDEM_BUY_IN : 1_000 // blind: one fixed wager seats a player (plan 27 D2)
  let seqGaps = 0
  let resyncs = 0
  let actions = 0
  let stopped = false

  const startBalances = (await Promise.all(ids.map((id) => server.repos.balances.get(id)))).reduce((s, x) => s + x, 0)

  const seats: Seat[] = []
  for (const [i, id] of ids.entries()) {
    const client = await TestClient.connect(server.url)
    const welcome = await client.hello(`tok:${id}`)
    seats.push({
      id, client, rng: seededRng(opts.seed + i), room: Math.floor(i / perRoom), seat: i % perRoom, leader: i % perRoom === 0,
      seated: false, ready: false, status: 'OPEN', balance: welcome.balance, stack: 0, autoPlayed: false, lastSeq: -1, pending: null, timers: [],
    })
  }
  const inRoom = (room: number) => seats.filter((s) => s.room === room)

  // ---------- completion ----------

  const handsSeen = new Array<number>(opts.rooms).fill(0)
  let roomsLeft = opts.rooms
  let finish: () => void = () => {}
  const finished = new Promise<void>((resolve) => { finish = resolve })

  // ---------- the driver ----------

  const send = (s: Seat, msg: object) => { if (s.client.isOpen) s.client.send(msg) }
  const later = (s: Seat, fn: () => void) => {
    const [min, max] = opts.actionDelayMs ?? [0, 0]
    if (max <= 0) return fn()
    const t = setTimeout(fn, min + s.rng.int(Math.max(1, max - min + 1)))
    s.timers.push(t)
  }

  /**
   * Play the legal action the server offered: check/call by default, fold `foldPct` of the time.
   * Draws from the *seat's* stream, so seat `i` facing its `n`-th decision always decides the same
   * way for a given seed, whatever order the six sockets were served in.
   */
  const choose = (s: Seat, kinds: readonly ActionKind[]): ActionKind => {
    const foldPct = opts.mode === 'blind' ? 30 : 20 // blind: "play ~70 %"
    if (kinds.includes('fold') && s.rng.int(100) < foldPct) return 'fold'
    if (kinds.includes('check')) return 'check'
    if (kinds.includes('call')) return 'call'
    if (kinds.includes('play')) return 'play'
    return kinds[0] ?? 'fold' // never invent an action the server did not offer
  }

  const act = (s: Seat, kinds: readonly ActionKind[], baseSeq: number) => {
    if (stopped) return
    const kind = choose(s, kinds)
    const reqId = `${s.id}-${actions++}`
    later(s, () => {
      if (stopped || !s.client.isOpen) return
      s.pending = { reqId, sentAt: Date.now() }
      send(s, { t: 'ACTION', reqId, baseSeq, action: { kind } })
    })
  }

  const sitAndReady = (s: Seat) => {
    if (stopped) return
    if (!s.seated) {
      if (s.balance < needed) return // cannot afford a seat any more: the run reports it as fewer hands
      send(s, opts.mode === 'holdem' ? { t: 'SIT_DOWN', seat: s.seat, buyIn: HOLDEM_BUY_IN } : { t: 'SIT_DOWN', seat: s.seat })
      return // READY follows the PLAYER_SAT we are about to receive
    }
    if (!s.ready && s.status === 'OPEN') {
      s.ready = true
      send(s, { t: 'READY', reqId: `${s.id}-ready-${actions++}`, ready: true })
    }
  }

  const onEvent = (s: Seat, m: Extract<ServerMessage, { t: 'GAME_EVENT' | 'ROOM_EVENT' }>) => {
    if (m.t === 'GAME_EVENT') {
      const e = m.event
      // The seat's stack, followed from the frames, so the driver knows when an ante took all of it (plan 27 D2).
      if (e.type === 'HAND_STARTED') s.autoPlayed = false
      else if (e.type === 'BLINDS_POSTED') {
        const posted = e.posts.filter((p) => p.seat === s.seat).reduce((sum, p) => sum + p.amount, 0)
        if (posted > 0) {
          s.stack -= posted
          s.autoPlayed = opts.mode === 'blind' && s.stack <= 0
        }
      } else if (e.type === 'SETTLEMENT') s.stack = e.stacks.find((x) => x.seat === s.seat)?.stack ?? s.stack
      else if (e.type === 'HAND_CANCELLED') s.stack += e.refunds.find((x) => x.seat === s.seat)?.amount ?? 0
      if (e.type === 'PLAYER_ACTED' && e.seat === s.seat) s.stack = e.stack

      if (e.type === 'TURN_CHANGED' && e.seat === s.seat) act(s, e.legal.kinds, m.seq)
      // Blind's legal set is a literal, unlike the branch above: `DECISION_PHASE` is
      // `{ seats, turnSeq }` (`packages/core/src/hand/types.ts`) and carries no `legal`, so there is
      // nothing server-advertised to read. play/fold is the whole of §8.2's decision — unless the ante emptied the
      // seat, which the server then plays all in itself and never asks (spec R14).
      else if (e.type === 'DECISION_PHASE' && e.seats.includes(s.seat)) {
        if (!s.autoPlayed) act(s, ['play', 'fold'], m.seq)
      } else if ((e.type === 'DECISION_MADE' && e.seat === s.seat) || (e.type === 'PLAYER_ACTED' && e.seat === s.seat)) {
        // A timed-out seat's PLAYER_ACTED is the timer's work, not ours: it is not a latency sample.
        const timedOut = e.type === 'PLAYER_ACTED' && e.timedOut
        if (s.pending && !timedOut) latencies.push(Date.now() - s.pending.sentAt)
        s.pending = null
      } else if (e.type === 'HAND_COMPLETE' && s.leader) {
        handsSeen[s.room] = (handsSeen[s.room] ?? 0) + 1
        if (handsSeen[s.room] === opts.handsPerRoom && --roomsLeft === 0) {
          stopped = true
          finish()
        }
      }
      return
    }
    const e = m.event
    if (e.type === 'PLAYER_SAT' && e.playerId === s.id) {
      s.seated = true
      s.stack = e.stack
      s.ready = false
      sitAndReady(s)
    } else if (e.type === 'PLAYER_STOOD' && e.playerId === s.id) {
      s.seated = false
      s.ready = false
      sitAndReady(s)
    } else if (e.type === 'ROOM_STATUS') {
      const wasOpen = s.status === 'OPEN'
      s.status = e.status
      // toOpen() clears everyone's ready flag, so a room that falls back to OPEN must be re-armed.
      if (e.status === 'OPEN') {
        if (!wasOpen) s.ready = false
        sitAndReady(s)
      }
    }
  }

  const listen = (s: Seat) => s.client.onMessage((m) => {
    if (m.t === 'ROOM_SNAPSHOT') {
      s.lastSeq = m.seq
      s.status = m.room.status
      const me = m.room.players.find((p) => p.playerId === s.id)
      s.seated = me !== undefined && me.seat !== null
      if (me !== undefined) s.stack = me.stack
      return
    }
    if (m.t === 'BALANCE') {
      s.balance = m.balance
      return
    }
    if (m.t === 'ERROR') {
      if (s.pending && m.reqId === s.pending.reqId) s.pending = null
      ;(TOLERATED.has(m.code) ? tolerated : errors).push(`${s.id}: ${m.code} ${m.message}`)
      if (m.code === 'GAME_IN_PROGRESS') s.ready = true // the hand we were arming for already started
      return
    }
    if (m.t !== 'GAME_EVENT' && m.t !== 'ROOM_EVENT') return
    if (stopped) return
    const verdict = seqVerdict(s.lastSeq, m.seq)
    if (verdict === 'duplicate') return
    if (verdict === 'gap') {
      // §29.3 / docs "Wire contract": the client rebuilds from a snapshot rather than guessing.
      seqGaps += 1
      resyncs += 1
      send(s, { t: 'RESYNC' })
    }
    s.lastSeq = m.seq
    onEvent(s, m)
  })

  const unlisten = seats.map(listen)

  // ---------- open the rooms, seat everyone, then let it run ----------

  try {
    for (let room = 0; room < opts.rooms; room++) {
      const members = inRoom(room)
      const host = members[0]!
      host.client.send({ t: 'CREATE_ROOM', config })
      const snap = await host.client.next('ROOM_SNAPSHOT')
      for (const s of members.slice(1)) {
        s.client.send({ t: 'JOIN_ROOM', code: snap.room.code })
        await s.client.next('ROOM_SNAPSHOT')
      }
    }
    for (const s of seats) sitAndReady(s)
    await finished
  } finally {
    stopped = true
    for (const s of seats) for (const t of s.timers) clearTimeout(t)
    for (const off of unlisten) off()
  }

  // Every point that was ever a table stack or a carry-over pot is back in a balance afterwards
  // (docs/server-kit.md, "Shutdown"), which is what makes endBalances comparable to startBalances.
  await server.server.shutdown('soak complete')
  for (const s of seats) await s.client.close().catch(() => undefined)

  const summaries: HandSummary[] = server.domainEvents.flatMap((e) => (e.type === 'HAND_SETTLED' ? [e.summary] : []))
  const endBalances = (await Promise.all(ids.map((id) => server.repos.balances.get(id)))).reduce((s, x) => s + x, 0)
  const sorted = [...latencies].sort((a, b) => a - b)
  const cancelled = summaries.filter((h) => h.cancelled)
  return {
    hands: summaries.length,
    handsPerRoomSeen: [...handsSeen],
    cancelledHands: cancelled.length,
    fees: summaries.reduce((s, h) => s + h.fee, 0),
    cancelledFees: cancelled.reduce((s, h) => s + h.fee, 0),
    sinks: server.repos.sinks.reduce((s, x) => s + x.fee, 0),
    botNet: summaries.flatMap((h) => h.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0),
    startBalances,
    endBalances,
    latencySamples: latencies.length,
    seqGaps,
    resyncs,
    p95ActionToBroadcastMs: percentile(sorted, 0.95),
    maxActionToBroadcastMs: sorted.at(-1) ?? 0,
    errors,
    tolerated,
  }
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]!
}
