import { seededRng, type ActionKind, type RoomConfig, type ServerMessage } from '@bp/core'
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
  seed: number
  /** Random think time before an action, to spread the load out. Omitted = act immediately. */
  actionDelayMs?: [min: number, max: number]
}

export interface SoakResult {
  /** Hands settled across every room, cancelled ones included. */
  hands: number
  cancelledHands: number
  /** Σ `HAND_SETTLED.summary.fee` — the domain events are the fee source of truth here. */
  fees: number
  /** Σ every sink row the repositories recorded (`table_fee` + `carry_over`). */
  sinks: number
  /** Σ `net` of every bot seat across every settled hand: points bots took off (or gave to) the humans. */
  botNet: number
  startBalances: number
  /** Read after `shutdown()`, so every table stack and carry-over pot is back in a balance. */
  endBalances: number
  actions: number
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

interface Seat {
  id: string
  client: TestClient
  room: number
  seat: number
  leader: boolean
  seated: boolean
  ready: boolean
  status: 'OPEN' | 'IN_GAME'
  balance: number
  lastSeq: number
  pending: { reqId: string; sentAt: number } | null
  timers: NodeJS.Timeout[]
}

export async function runSoak(server: TestServer, opts: SoakOptions): Promise<SoakResult> {
  const perRoom = Math.floor(opts.clients / opts.rooms)
  if (perRoom < 2) throw new Error(`each soak room needs two humans; ${opts.clients} clients over ${opts.rooms} rooms gives ${perRoom}`)
  const ids = [...server.repos.records.keys()].slice(0, opts.clients)
  if (ids.length < opts.clients) throw new Error(`the server seeds ${ids.length} players but the soak asked for ${opts.clients}`)

  const rng = seededRng(opts.seed)
  const errors: string[] = []
  const tolerated: string[] = []
  const latencies: number[] = []
  const config = roomConfig(opts.mode, perRoom)
  const needed = opts.mode === 'holdem' ? HOLDEM_BUY_IN : 2_000 // blind: 2 × the fixed wager (§8.2)
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
      id, client, room: Math.floor(i / perRoom), seat: i % perRoom, leader: i % perRoom === 0,
      seated: false, ready: false, status: 'OPEN', balance: welcome.balance, lastSeq: -1, pending: null, timers: [],
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
    const t = setTimeout(fn, min + rng.int(Math.max(1, max - min + 1)))
    s.timers.push(t)
  }

  /** Play the legal action the server offered: check/call by default, fold `foldPct` of the time. */
  const choose = (kinds: readonly ActionKind[]): ActionKind => {
    const foldPct = opts.mode === 'blind' ? 30 : 20 // blind: "play ~70 %"
    if (kinds.includes('fold') && rng.int(100) < foldPct) return 'fold'
    if (kinds.includes('check')) return 'check'
    if (kinds.includes('call')) return 'call'
    if (kinds.includes('play')) return 'play'
    return 'fold'
  }

  const act = (s: Seat, kinds: readonly ActionKind[], baseSeq: number) => {
    if (stopped) return
    const kind = choose(kinds)
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
      if (e.type === 'TURN_CHANGED' && e.seat === s.seat) act(s, e.legal.kinds, m.seq)
      else if (e.type === 'DECISION_PHASE' && e.seats.includes(s.seat)) act(s, ['play', 'fold'], m.seq)
      else if ((e.type === 'DECISION_MADE' && e.seat === s.seat) || (e.type === 'PLAYER_ACTED' && e.seat === s.seat)) {
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
    if (s.lastSeq < 0) s.lastSeq = m.seq - 1
    if (m.seq <= s.lastSeq) return // a frame the RESYNC snapshot already accounted for
    if (m.seq !== s.lastSeq + 1) {
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
  return {
    hands: summaries.length,
    cancelledHands: summaries.filter((h) => h.cancelled).length,
    fees: summaries.reduce((s, h) => s + h.fee, 0),
    sinks: server.repos.sinks.reduce((s, x) => s + x.fee, 0),
    botNet: summaries.flatMap((h) => h.players).filter((p) => p.isBot).reduce((s, p) => s + p.net, 0),
    startBalances,
    endBalances,
    actions: latencies.length,
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
