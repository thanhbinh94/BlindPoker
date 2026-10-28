import {
  DEFAULT_CHAOS_CONFIG, EMPTY_CHAOS_SEAT, EMPTY_CHAOS_TABLE, addRevealEffect, afterHand, armBonus, clearUnsettledHand, drawOffer, drawTier, endReign,
  liftTier, planHand, receiveCard, stealPoints, toChaosTableView, toHeldCardView,
  type AfterHandSeat, type ArmWhen, type BlindRules, type ChaosBonusPayload, type ChaosCardDef, type ChaosConfig, type ChaosCredit, type ChaosDebit, type ChaosHandPlan,
  type ChaosReignKind, type ChaosSeat, type ChaosSnapshot, type ChaosSteal, type ChaosTableState, type ChaosTableView, type ChaosTier, type ChaosTitles, type HandState,
  type HeldCardView, type RoomEvent,
} from '@bp/core'
import type { ChaosPort } from '../chaos-port.js'
import type { TimerHandle } from '../infra/clock.js'
import { newId } from '../infra/ids.js'
import { RoomError, type RoomDeps, type RoomPlayer } from './types.js'

/** What a `ChaosTable` needs of the `Room` that owns it. */
export interface ChaosHost {
  readonly roomId: string
  readonly rules: BlindRules
  readonly deps: RoomDeps
  readonly players: ReadonlyMap<string, RoomPlayer>
  broadcast(event: RoomEvent): void
  pushBalance(playerId: string): Promise<void>
  /** Runs `fn` on the room's queue (the draft's deadline, an offer dropped by a seat that left). */
  enqueue(fn: () => unknown): void
  /** The draft is over and every card is handed out: deal the hand it was for. Runs on the room's queue. */
  onDraftEnd(): Promise<unknown>
}

interface DraftEntry {
  playerId: string
  seat: number
  offerId: string
  /** The tier of this seat's own offer: the draft's, or higher when it held a Nâng tầm uy lực (BP-41, `liftTier`). */
  tier: ChaosTier
  cardIds: string[]
  /** The card taken; `null` while the player is still choosing. An empty offer counts as taken (nothing to give). */
  picked: string | null
}

interface Draft {
  id: string
  tier: ChaosTier
  deadlineAt: number
  /** The window's whole length, told to the clients for their timer's full circle. */
  draftMs: number
  entries: DraftEntry[]
}

const done = (e: DraftEntry): boolean => e.picked !== null || e.cardIds.length === 0

/**
 * BP-41 A12 / spec §4.4 G12: the title marks a settled chaos hand earned that count for the stats, by seat — copied into
 * `HandSummary.players[].chaosTitles`. Only when at least two humans were dealt into that hand (anti-farming, Ruling 19:
 * an idle second account sitting out does not count); never for a bot's seat (a bot has no titles); a `slew` mark only
 * when the Thần beaten was a human (`plan.god.isBot`). The room calls it for a hand that was not cancelled only: a title
 * is earned when its hand settles — an ascension whose hand is cancelled keeps its reign (and its herald, already sent)
 * but marks nothing (Ruling 7b-1).
 */
export function countedTitles(state: HandState): Map<number, ChaosTitles> {
  const out = new Map<number, ChaosTitles>()
  const chaos = state.chaos
  if (!chaos?.titles || state.players.filter((hp) => !hp.isBot).length < 2) return out
  const botGod = chaos.plan.god?.isBot === true
  for (const { seat, ascended, demigod, slew } of chaos.titles) {
    if (state.players.find((hp) => hp.seat === seat)?.isBot !== false) continue
    const marks: ChaosTitles = {
      ...(ascended ? { ascended } : {}),
      ...(demigod ? { demigod } : {}),
      ...(slew && !botGod ? { slew } : {}),
    }
    if (Object.keys(marks).length > 0) out.set(seat, marks)
  }
  return out
}

/**
 * The chaos side of one Blind table (Poker hỗn loạn, spec 2026-10-26 §3.2–§3.4): the hands counted, the draft between
 * hands, each hand's plan and the cards' settlement after it. The `Room` keeps the seats; this keeps everything else.
 * Every method runs on the room's queue.
 */
export class ChaosTable {
  /** Hands started at this table; the cycle is `floor(tableHands / chaosCycle)`. */
  tableHands = 0
  draft: Draft | null = null
  private readonly cycleTier = new Map<number, ChaosTier>()
  /** The cycle each player last drafted in. Kept through a stand-up: one draft per player per cycle. */
  private readonly draftedCycle = new Map<string, number>()
  private cards: readonly ChaosCardDef[] = []
  private weights: ReadonlyMap<string, number> = new Map()
  private config: ChaosConfig = DEFAULT_CHAOS_CONFIG
  private draftTimer: TimerHandle | null = null
  /**
   * Credits whose write failed twice, per player, oldest first (ledger ruling, Plan 37 final wave). A failed write may
   * still have landed, so the credit is kept under its key until a retry is acknowledged — the same rule as a pending
   * cash-out. Kept through a stand-up attempt: the room settles them before it cashes the stack out.
   */
  private readonly pending = new Map<string, { credit: ChaosCredit; request: Parameters<ChaosPort['credit']>[0] }[]>()
  private uid = 0
  private readonly cycleLength: number
  /**
   * The table's own chaos state (BP-41: the Thần, the Bán Thần, the bombs), threaded through `planHand` and `afterHand`
   * across hands, kept for the life of the room (a closed room drops it with the table). A seat that leaves ends its
   * reigns and its bombs (`seatCleared`).
   */
  table: ChaosTableState = EMPTY_CHAOS_TABLE
  /** The table view the clients were last told (`CHAOS_TABLE`, `CHAOS_STATE.table`), to tell it again only on a change. */
  private toldTable = JSON.stringify(toChaosTableView(EMPTY_CHAOS_TABLE))
  /**
   * Bán Thần crowned at a settlement, heralded at the next deal — the first hand of the reign (spec §4.5 "hiện đầu ván").
   * By the card's uid, so a seat that left in between (its reign ended) is not heralded.
   */
  private demigodHeralds: number[] = []

  constructor(
    private readonly port: ChaosPort,
    private readonly host: ChaosHost,
  ) {
    this.cycleLength = host.rules.chaosCycle ?? 5
  }

  get cycle(): number {
    return Math.floor(this.tableHands / this.cycleLength)
  }

  /**
   * Before a deal: opens a draft for the eligible seats that have not drafted in this cycle. `true` when one is open (the
   * room waits for it); `false` when the hand can be dealt now — nobody to draft, a draft every seat finished at once,
   * or a port that could not answer (logged; nobody is marked drafted, so the next hand tries again).
   */
  async openDraft(eligible: readonly RoomPlayer[]): Promise<boolean> {
    const c = this.cycle
    const drafted = eligible.filter((p) => this.draftedCycle.get(p.identity.playerId) !== c)
    if (drafted.length === 0) return false
    try {
      const catalogue = await this.port.catalogue()
      this.config = await this.port.config()
      this.cards = catalogue.cards
      this.weights = catalogue.weights
    } catch (err) {
      this.host.deps.log.error('chaos draft skipped: the chaos port did not answer', { roomId: this.host.roomId, err: String(err) })
      return false
    }
    const { rng, clock } = this.host.deps
    const mode = this.host.rules.decisionMode
    const tier = this.cycleTier.get(c) ?? drawTier(this.config.tierWeights, rng)
    this.cycleTier.set(c, tier)
    const deadlineAt = clock.now() + this.config.draftMs
    const entries: DraftEntry[] = []
    for (const p of drafted) {
      const id = p.identity.playerId
      this.draftedCycle.set(id, c)
      // Tay bạc lasts a cycle: it leaves when its holder drafts again (spec §5.3).
      const held = p.chaos ?? EMPTY_CHAOS_SEAT
      const kept = held.cards.some((x) => x.effect === 'gambler') ? { ...held, cards: held.cards.filter((x) => x.effect !== 'gambler') } : held
      // BP-41 Nâng tầm uy lực: this seat's own offer comes a tier up, and the card is spent by it (spec §6.3). The draft
      // frame keeps the table's tier; only the seat's offer names its own.
      const lifted = liftTier(kept, tier)
      p.chaos = lifted.seat
      const cardIds = drawOffer(this.cards, lifted.tier, mode, rng, 3, this.weights).map((x) => x.id)
      const entry: DraftEntry = { playerId: id, seat: p.seat!, offerId: newId(), tier: lifted.tier, cardIds, picked: null }
      // Bots, and humans who are not there to choose, are picked for at once.
      if (cardIds.length > 0 && (p.identity.isBot || !p.connected)) entry.picked = cardIds[rng.int(cardIds.length)]!
      entries.push(entry)
    }
    const draftMs = this.config.draftMs
    const draft: Draft = { id: newId(), tier, deadlineAt, draftMs, entries }
    this.draft = draft
    for (const e of entries) {
      if (done(e)) continue
      this.host.deps.outbox.send(e.playerId, { t: 'NOTIFICATION', kind: 'CHAOS_OFFER', payload: { offerId: e.offerId, tier: e.tier, cardIds: e.cardIds, deadlineAt, draftMs } })
    }
    this.host.broadcast({ type: 'CHAOS_DRAFT', tier, deadlineAt, draftMs, seats: entries.map((e) => e.seat).sort((a, b) => a - b) })
    if (entries.every(done)) {
      this.endDraft()
      return false
    }
    this.draftTimer = clock.setTimeout(() => this.host.enqueue(() => this.draft === draft ? this.host.onDraftEnd() : undefined), this.config.draftMs)
    return true
  }

  /** One pick. `true` when it was the last one the draft waited for (the room then ends it and deals). */
  pick(playerId: string, offerId: string, cardId: string): boolean {
    const entry = this.draft?.entries.find((e) => e.playerId === playerId && e.offerId === offerId && e.picked === null)
    if (!entry || !this.draft) throw new RoomError('CHAOS_NO_OFFER')
    if (!entry.cardIds.includes(cardId)) throw new RoomError('ILLEGAL_ACTION', 'card not offered')
    entry.picked = cardId
    return this.draft.entries.every(done)
  }

  /** A player left the seat: its offer goes, and a draft left waiting on nobody ends (after the move that caused it). */
  dropOffer(playerId: string): void {
    const draft = this.draft
    if (!draft || !draft.entries.some((e) => e.playerId === playerId)) return
    draft.entries = draft.entries.filter((e) => e.playerId !== playerId)
    if (draft.entries.every(done)) this.host.enqueue(() => this.draft === draft ? this.host.onDraftEnd() : undefined)
  }

  /** Picks at random for whoever has not, hands every card out and says what each seat got. */
  endDraft(): void {
    const draft = this.draft
    if (!draft) return
    this.draft = null
    this.draftTimer?.cancel()
    this.draftTimer = null
    const { rng } = this.host.deps
    const mode = this.host.rules.decisionMode
    const defs = new Map(this.cards.map((c) => [c.id, c]))
    const thefts: { seat: number; card: ChaosCardDef }[] = []
    for (const e of draft.entries) {
      if (e.picked === null && e.cardIds.length > 0) e.picked = e.cardIds[rng.int(e.cardIds.length)]!
      const p = this.host.players.get(e.playerId)
      const def = e.picked === null ? undefined : defs.get(e.picked)
      if (!p || p.seat !== e.seat || !def) continue
      const r = receiveCard(p.chaos ?? EMPTY_CHAOS_SEAT, def, () => this.nextUid(), this.cards, mode, rng, this.weights, this.config.tierWeights)
      p.chaos = r.seat
      this.host.broadcast({ type: 'CHAOS_PICKED', seat: e.seat, cardIds: r.received.map((x) => x.id) })
      for (const card of r.received) if (card.effect === 'stealPoints') thefts.push({ seat: e.seat, card })
    }
    // BP-41 Trộm điểm acts on receipt, once every pick is handed out (as `afterHand` does), over every seated player.
    for (const t of thefts) this.steal(t.seat, t.card)
    this.broadcastState()
  }

  /**
   * BP-41 Trộm điểm received between hands (a draft pick): resolved over every seated player's chaos points (`stealPoints`;
   * no Gậy ông stands between hands), the changed seats written back, and the table told (`CHAOS_STEAL`).
   */
  private steal(holder: number, card: ChaosCardDef): void {
    const seated = this.seated()
    const r = stealPoints({
      seats: new Map(seated.map((p) => [p.seat!, p.chaos ?? EMPTY_CHAOS_SEAT])),
      holder,
      // A uid of its own: a card that acts on receipt is never held, so no held card's uid names it.
      card: { cardId: card.id, uid: this.nextUid(), params: card.params },
      rng: this.host.deps.rng,
      // A shield stands as it would at the deal: only in a mode its card allows (a card the GM took out still stands).
      validHere: (cardId) => this.cards.find((c) => c.id === cardId)?.modes.includes(this.host.rules.decisionMode) ?? true,
    })
    for (const p of seated) {
      const next = r.seats.get(p.seat!)
      if (next && next !== (p.chaos ?? EMPTY_CHAOS_SEAT)) p.chaos = next
    }
    this.tellSteal(r.steal)
  }

  private tellSteal(s: ChaosSteal): void {
    this.host.broadcast({
      type: 'CHAOS_STEAL', seat: s.seat, cardId: s.cardId, outcome: s.outcome, targets: s.targets, from: s.from, to: s.to, amount: s.amount,
      spent: s.spent.map((x) => ({ seat: x.seat, cardId: x.cardId, ...(x.passedTo === undefined ? {} : { passedTo: x.passedTo }) })),
    })
  }

  private seated(): RoomPlayer[] {
    return [...this.host.players.values()].filter((p) => p.seat !== null).sort((a, b) => a.seat! - b.seat!)
  }

  /**
   * How long the result of a hand stays up before the next deal (BP-39, spec 2026-10-27 §3.3): read from the port after
   * each hand, so a GM change takes effect from the next one. A port that cannot answer gives the default (logged).
   */
  async resultMs(): Promise<number> {
    try {
      const ms = (await this.port.config()).resultMs
      if (Number.isFinite(ms) && ms > 0) return ms
      this.host.deps.log.error('chaos result time invalid; the default is used', { roomId: this.host.roomId, resultMs: ms })
    } catch (err) {
      this.host.deps.log.error('chaos result time unread: the chaos port did not answer', { roomId: this.host.roomId, err: String(err) })
    }
    return DEFAULT_CHAOS_CONFIG.resultMs
  }

  /** The effects this hand fires, for the seats dealt in; each seat's chaos becomes what `planHand` returns. Counts the hand. */
  planHand(eligible: readonly RoomPlayer[]): ChaosHandPlan {
    // A card played for this hand now names it (`armed.hand: 'this'`), or joined the held cards: its owner is told.
    const before = this.bonusKeys(eligible)
    const { plan, seats, table } = planHand({
      seats: eligible.map((p) => ({ seat: p.seat!, playerId: p.identity.playerId, isBot: p.identity.isBot, chaos: p.chaos ?? EMPTY_CHAOS_SEAT })),
      rules: this.host.rules,
      pool: this.cards,
      rng: this.host.deps.rng,
      nextUid: () => this.nextUid(),
      weights: this.weights,
      table: this.table,
    })
    for (const p of eligible) p.chaos = seats.get(p.seat!) ?? p.chaos
    this.table = table
    this.tellBonusChanges(before)
    this.tableHands += 1
    // BP-41: before the hand's first event — the reign and the bombs as this hand plays them (a bomb passed on, a new
    // Thần), then the banners of the reigns that start now (spec §4.5 "đầu ván").
    this.tellTable()
    if (plan.god?.ascended) this.herald('god', plan.god.seat, table.god?.playerId)
    for (const uid of this.demigodHeralds) {
      const d = table.demigods.find((x) => x.uid === uid)
      if (d) this.herald('demigod', d.seat, d.playerId)
    }
    this.demigodHeralds = []
    return plan
  }

  /** `CHAOS_HERALD` to the whole room; the player id is the seat's player now, else the one the reign was made for. */
  private herald(kind: ChaosReignKind, seat: number, fallbackId: string | undefined): void {
    const playerId = this.seated().find((p) => p.seat === seat)?.identity.playerId ?? fallbackId
    if (playerId !== undefined) this.host.broadcast({ type: 'CHAOS_HERALD', kind, seat, playerId })
  }

  /** The table's public view, or undefined when nobody reigns and no bomb is in play (`CHAOS_STATE.table` absent). */
  private tableView(): ChaosTableView | undefined {
    const t = this.table
    return t.god === null && t.demigods.length === 0 && t.bombs.length === 0 ? undefined : toChaosTableView(t)
  }

  /** `CHAOS_TABLE` when the public view changed since the clients were last told. Never a seat's cards. */
  private tellTable(): void {
    const view = toChaosTableView(this.table)
    const json = JSON.stringify(view)
    if (json === this.toldTable) return
    this.toldTable = json
    this.host.broadcast({ type: 'CHAOS_TABLE', table: view })
  }

  /**
   * The player presses "Dùng" on bonus card `uid` (BP-39, spec 2026-10-27 §3.4). `live` is the hand in play when the
   * room allows a press into it — its play/fold choice, the player dealt in — and `null` between hands. `armBonus` decides
   * the hand the card fires in; one that fires in this hand's reveal joins the live plan here, in place on the state the
   * runner holds. Nothing is broadcast: only the owner is told (`CHAOS_BONUS`), and the seat's public count is unchanged,
   * so the table learns of the card when it fires. Any refusal is `CHAOS_CANNOT_USE`.
   */
  useBonus(p: RoomPlayer, uid: number, live: HandState | null): void {
    const seat = p.chaos ?? EMPTY_CHAOS_SEAT
    let when: ArmWhen = { phase: 'between' }
    if (live) {
      const planSeat = live.chaos?.plan.seats.find((s) => s.seat === p.seat)
      if (!planSeat) throw new RoomError('CHAOS_CANNOT_USE', 'not in this chaos hand')
      // `frozenNextHand` is the seat as planned for the hand in play: a frozen seat fired nothing and plays nothing in.
      when = { phase: 'decision', frozen: seat.frozenNextHand, planSeat }
    }
    const r = armBonus(seat, uid, when)
    if ('error' in r) throw new RoomError('CHAOS_CANNOT_USE', r.error)
    if (r.armed.hand === 'this') {
      const c = r.armed.card
      addRevealEffect(live!, p.seat!, { uid: c.uid, cardId: c.cardId, effect: c.effect, params: c.params, timing: c.timing, debuff: c.debuff, targets: [] })
    }
    p.chaos = r.seat
    this.sendBonus(p)
  }

  /** The owner's bonus hand and the card it pressed (BP-39): sent to the owner only, never to another client. */
  bonusFor(p: RoomPlayer): ChaosBonusPayload {
    const chaos = p.chaos ?? EMPTY_CHAOS_SEAT
    const armed = chaos.armed
    return { cards: chaos.bonus.map(toHeldCardView), armed: armed ? { uid: armed.card.uid, cardId: armed.card.cardId, hand: armed.hand } : null }
  }

  /**
   * The seat's chaos is gone (a stand-up or a Leave, `seat` the one it left; a seat dealt into the hand in play is only
   * cleared after that hand settled, so a bomb or a reign in play is always settled first): an owner who held bonus cards
   * is told its hand is empty, and the table's state lets the seat go (BP-41) —
   * - its Thần or Bán Thần reign ends now (spec §4.2 "rời bàn thì mất ngôi", `endReign`);
   * - a bomb it planted is gone, unpaid: its owner is not there to be paid, and a newcomer on the seat must not be;
   * - a bomb it carried passes now to another seated player (not its owner), at random, as `planHand` would pass it; with
   *   nobody to take it, it is gone. A newcomer on the seat never inherits it.
   * The table is told (`CHAOS_TABLE`) when its view changed.
   */
  seatCleared(p: RoomPlayer, had: ChaosSeat | undefined, seat: number): void {
    if (had && (had.bonus.length > 0 || had.armed)) this.sendBonus(p)
    let table = endReign(this.table, seat)
    if (table.bombs.some((b) => b.owner === seat || b.carrier === seat)) {
      const others = this.seated().map((x) => x.seat!) // the leaver's seat is already empty
      const { rng } = this.host.deps
      const bombs = table.bombs.flatMap((b) => {
        if (b.owner === seat) return []
        if (b.carrier !== seat) return [b]
        const to = others.filter((s) => s !== b.owner)
        return to.length > 0 ? [{ ...b, carrier: to[rng.int(to.length)]! }] : []
      })
      table = { ...table, bombs }
    }
    this.table = table
    this.tellTable()
  }

  /**
   * After a hand that was not cancelled (spec §3.3–§3.4, §4): durations, streaks, points and bonus cards, and the credits
   * cards pay — a bot's straight onto its virtual stack, a human's through the port under its key, retried once.
   */
  async settleHand(state: HandState, stacksBefore: ReadonlyMap<number, number>, seatPlayer: (seat: number) => RoomPlayer | undefined): Promise<void> {
    const chaos = state.chaos
    const result = state.result
    if (!chaos || !result) return
    const carryOverOnly = result.pots.length === 0
    const winners = new Set(result.pots.flatMap((pot) => pot.winners.map((w) => w.seat)))
    const inHand = state.players.flatMap((hp) => {
      const p = seatPlayer(hp.seat)
      return p ? [{ hp, p }] : []
    })
    // Ruling (5c-8): every other seated player with chaos goes in too, as not in the hand — Cấm bỏ bài's mark ends for a
    // seat that sat its hand out (5a-5), and a Trộm điểm won here can reach the richest seat even when it sat out.
    const dealt = new Set(inHand.map(({ hp }) => hp.seat))
    const sittingOut = this.seated().filter((p) => !dealt.has(p.seat!) && p.chaos !== undefined)
    const before = this.bonusKeys([...inHand.map(({ p }) => p), ...sittingOut])
    const demigodsBefore = new Set(this.table.demigods.map((d) => d.uid))
    const settled = afterHand({
      rules: this.host.rules,
      config: this.config,
      pool: this.cards,
      rng: this.host.deps.rng,
      nextUid: () => this.nextUid(),
      plan: chaos.plan,
      consumed: new Set([...chaos.applied, ...chaos.blocked]),
      // A played card the table was told of (a reveal card that fizzled still says CHAOS_APPLIED) is spent (I1).
      recorded: new Set(chaos.recorded),
      carryOverOnly,
      marks: chaos.marks,
      weights: this.weights,
      table: this.table,
      ...(chaos.outcomes ? { outcomes: chaos.outcomes } : {}),
      seats: [
        ...inHand.map(({ hp, p }): AfterHandSeat => ({
          seat: hp.seat,
          playerId: hp.playerId,
          isBot: hp.isBot,
          chaos: p.chaos ?? EMPTY_CHAOS_SEAT,
          stackAfter: hp.stack,
          // From the stacks, not the payouts: a free fold's or an insurance refund is in the stack only.
          net: hp.stack - (stacksBefore.get(hp.seat) ?? hp.stack),
          inHand: true,
          outcome: carryOverOnly ? 'none' : winners.has(hp.seat) ? 'win' : 'loss',
        })),
        ...sittingOut.map((p): AfterHandSeat => ({
          seat: p.seat!, playerId: p.identity.playerId, isBot: p.identity.isBot, chaos: p.chaos!, stackAfter: p.stack, net: 0, inHand: false, outcome: 'none',
        })),
      ],
    })
    for (const { hp, p } of inHand) p.chaos = settled.seats.get(hp.seat) ?? p.chaos
    for (const p of sittingOut) p.chaos = settled.seats.get(p.seat!) ?? p.chaos
    this.table = settled.table
    // A bonus card drawn, a played card spent or given back: told to its owner only (`settled.bonusAwarded` is never
    // broadcast). The table sees the count change in `CHAOS_STATE`.
    this.tellBonusChanges(before)
    // BP-41 §4.5: each seat that beat the Thần, now (the settlement); a Bán Thần crowned here is heralded at the next deal.
    for (const seat of chaos.plan.god ? (chaos.outcomes?.dethroned ?? []) : []) {
      this.herald('godslain', seat, state.players.find((hp) => hp.seat === seat)?.playerId)
    }
    for (const d of settled.table.demigods) if (!demigodsBefore.has(d.uid)) this.demigodHeralds.push(d.uid)
    // BP-41 §5: the dice, in the order they rolled, each with the stack after its loss — the losses first (A6), then the
    // credits (a jackpot among them).
    const debits = settled.debits.slice()
    for (const roll of settled.dice) {
      const p = seatPlayer(roll.seat)
      if (!p) continue
      const i = debits.findIndex((d) => d.uid === roll.uid && d.seat === roll.seat)
      if (i >= 0) await this.payDebit(state.handId, p, debits.splice(i, 1)[0]!)
      this.host.broadcast({ type: 'CHAOS_DICE', seat: roll.seat, cardId: roll.cardId, dice: roll.dice, result: roll.result, stack: p.stack })
    }
    for (const debit of debits) {
      const p = seatPlayer(debit.seat)
      if (p) await this.payDebit(state.handId, p, debit)
    }
    for (const s of settled.steals) this.tellSteal(s)
    for (const credit of settled.credits) {
      const p = seatPlayer(credit.seat)
      if (p) await this.payCredit(state.handId, p, credit)
    }
    for (const a of settled.awarded) this.host.broadcast({ type: 'CHAOS_AWARDED', seat: a.seat, cardIds: a.cards.map((x) => x.id) })
    this.broadcastState()
  }

  /**
   * BP-41 §5 (A6): points a card takes from the seat's stack (the dice), never more than the stack. The stack is lowered
   * at once, a bot's as a human's (a bot's stack is virtual: nothing else is written for it). For a human the points
   * leave the economy like a table fee: a `chaos_dice` sink row of what was taken, with no player row (the stack's points
   * left the balance at the buy-in), under `chaos_dice:<room>:<hand>:<seat>:<uid>` so a retry never sinks twice. Retried
   * once; a write that fails again is logged with its key, like a lost fee, and the stack stays lowered (the books are
   * short by it until an operator reconciles, as for a fee).
   */
  private async payDebit(handId: string, p: RoomPlayer, debit: ChaosDebit): Promise<void> {
    const taken = Math.min(Math.max(0, debit.amount), p.stack)
    p.stack -= taken
    if (p.identity.isBot || taken === 0) return
    const key = `chaos_dice:${this.host.roomId}:${handId}:${debit.seat}:${debit.uid}`
    const write = () => this.host.deps.repos.balances.apply([], { refId: key, fee: taken, kind: 'chaos_dice' }, { key })
    try {
      await write().catch(() => write()) // one retry, under the same key
    } catch (err) {
      this.host.deps.log.error('chaos dice sink failed', { roomId: this.host.roomId, handId, playerId: p.identity.playerId, amount: taken, key, err: String(err) })
    }
  }

  /**
   * A cancelled hand settles nothing (spec §3.4), but a card a seat played into it goes back to its owner's bonus hand
   * now, not at the next deal (M4), and the owner is told (`CHAOS_BONUS`). A card the table was already told of is spent
   * instead (I1). Seats that left mid-hand were cleared already (`seatCleared`).
   */
  handCancelled(state: HandState, seatPlayer: (seat: number) => RoomPlayer | undefined): void {
    const recorded = new Set(state.chaos?.recorded ?? [])
    const inHand = state.players.flatMap((hp) => {
      const p = seatPlayer(hp.seat)
      return p?.chaos ? [p] : []
    })
    const before = this.bonusKeys(inHand)
    for (const p of inHand) p.chaos = clearUnsettledHand(p.chaos!, recorded)
    this.tellBonusChanges(before)
  }

  /**
   * The viewer's view of the draft — its own offer (none for a spectator or a seat not drafting) and whether it picked —
   * and, for a seated viewer, its own bonus hand (`bonus`); a spectator gets none, and nobody gets another seat's.
   */
  snapshotFor(viewerId: string | null): ChaosSnapshot {
    const viewer = viewerId === null ? undefined : this.host.players.get(viewerId)
    const bonus = viewer && viewer.seat !== null && !viewer.identity.isBot ? { bonus: this.bonusFor(viewer) } : {}
    const view = this.tableView()
    const table = view ? { table: view } : {}
    const draft = this.draft
    if (!draft) return { draft: null, ...bonus, ...table }
    const mine = draft.entries.find((e) => e.playerId === viewerId)
    return {
      draft: {
        // The viewer's own offer's tier (BP-41 Nâng tầm uy lực), as its `CHAOS_OFFER` said; the table's otherwise.
        tier: mine?.tier ?? draft.tier,
        deadlineAt: draft.deadlineAt,
        draftMs: draft.draftMs,
        offer: mine && mine.cardIds.length > 0 ? { offerId: mine.offerId, cardIds: mine.cardIds } : null,
        picked: mine !== undefined && mine.picked !== null,
      },
      ...bonus,
      ...table,
    }
  }

  seatView(p: RoomPlayer): { cards: HeldCardView[]; points: number; bonusCount: number } {
    const chaos: ChaosSeat = p.chaos ?? EMPTY_CHAOS_SEAT
    // Only the count of the bonus hand is public (the armed card included); which cards they are stays with the owner.
    return { cards: chaos.cards.map(toHeldCardView), points: chaos.points, bonusCount: chaos.bonus.length + (chaos.armed ? 1 : 0) }
  }

  /** The room is closing: no draft outlives it, nor the table's reigns and bombs. */
  cancel(): void {
    this.draftTimer?.cancel()
    this.draftTimer = null
    this.draft = null
    this.table = EMPTY_CHAOS_TABLE
    this.demigodHeralds = []
  }

  /** Whether this player has a credit whose write was never acknowledged (`pendingCredits`). */
  hasPending(playerId: string): boolean {
    return (this.pending.get(playerId)?.length ?? 0) > 0
  }

  /**
   * Retries every credit this player is owed, oldest first, once each, under its own key — a write that landed already
   * answers with what it wrote, so the stack is raised exactly once. Throws on the first one that fails again (it and
   * the ones after it stay pending). The room calls it after every hand and before any stand-up, Leave or kick cashes the
   * stack out: a cash-out without a landed credit would leave its `chaos_to_table` row with no stack behind it.
   */
  async settlePending(p: RoomPlayer): Promise<void> {
    const playerId = p.identity.playerId
    const queue = this.pending.get(playerId)
    while (queue && queue.length > 0) {
      const owed = queue[0]!
      const paid = await this.port.credit(owed.request)
      queue.shift()
      this.applyCredit(p, owed.credit, paid)
      await this.host.pushBalance(playerId)
    }
    this.pending.delete(playerId)
  }

  private async payCredit(handId: string, p: RoomPlayer, credit: ChaosCredit): Promise<void> {
    if (p.identity.isBot) {
      this.applyCredit(p, credit, { credited: credit.amount, capped: false })
      return
    }
    const playerId = p.identity.playerId
    const key = `chaos:${this.host.roomId}:${handId}:${credit.seat}:${credit.uid}:${credit.reason}`
    const request = { playerId, roomId: this.host.roomId, amount: credit.amount, reason: credit.reason, key }
    // Behind an older credit still owed: queued, so the stack is raised in the order the cards paid.
    if (this.hasPending(playerId)) {
      this.pending.get(playerId)!.push({ credit, request })
      return
    }
    let paid: { credited: number; capped: boolean }
    try {
      paid = await this.port.credit(request).catch(() => this.port.credit(request)) // one retry, under the same key
    } catch (err) {
      // It may have landed (a lost reply): kept under its key, never dropped (`settlePending`).
      this.pending.set(playerId, [{ credit, request }])
      this.host.deps.log.error('chaos credit failed; pending', { roomId: this.host.roomId, playerId, amount: credit.amount, reason: credit.reason, key, err: String(err) })
      return
    }
    this.applyCredit(p, credit, paid)
    await this.host.pushBalance(playerId)
  }

  private applyCredit(p: RoomPlayer, credit: ChaosCredit, paid: { credited: number; capped: boolean }): void {
    const extra = credit.multiplier === undefined ? {} : { multiplier: credit.multiplier }
    p.stack += paid.credited
    this.host.broadcast({ type: 'CHAOS_CREDIT', seat: p.seat ?? credit.seat, amount: paid.credited, stack: p.stack, reason: credit.reason, capped: paid.capped, ...extra })
  }

  private broadcastState(): void {
    const seats = [...this.host.players.values()]
      .filter((p) => p.seat !== null)
      .sort((a, b) => a.seat! - b.seat!)
      .map((p) => ({ seat: p.seat!, ...this.seatView(p) }))
    // BP-41: the table's state rides along (absent = none), and counts as told.
    const table = this.tableView()
    this.toldTable = JSON.stringify(toChaosTableView(this.table))
    this.host.broadcast({ type: 'CHAOS_STATE', seats, ...(table ? { table } : {}) })
  }

  private sendBonus(p: RoomPlayer): void {
    if (p.identity.isBot) return
    this.host.deps.outbox.send(p.identity.playerId, { t: 'NOTIFICATION', kind: 'CHAOS_BONUS', payload: this.bonusFor(p) })
  }

  /** Each human's bonus hand as it stands, to compare after a change (`tellBonusChanges`). */
  private bonusKeys(players: readonly RoomPlayer[]): Map<RoomPlayer, string> {
    return new Map(players.filter((p) => !p.identity.isBot).map((p) => [p, JSON.stringify(this.bonusFor(p))]))
  }

  /** Sends `CHAOS_BONUS` to each owner whose bonus hand or pressed card changed since `before`. */
  private tellBonusChanges(before: ReadonlyMap<RoomPlayer, string>): void {
    for (const [p, was] of before) if (JSON.stringify(this.bonusFor(p)) !== was) this.sendBonus(p)
  }

  private nextUid(): number {
    this.uid += 1
    return this.uid
  }
}
