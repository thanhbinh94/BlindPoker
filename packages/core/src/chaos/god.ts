import type { Rng } from '../cards/rng.js'
import type {
  ChaosGodCurse, ChaosHandOutcomes, ChaosHandPlan, ChaosMode, ChaosReign, ChaosSeat, ChaosTableState, HeldCard, PlannedEffect,
} from './types.js'

/**
 * BP-41 §4 (Task 6): Cá chép hóa rồng, the Thần Bài and the Bán Thần — the table-side half, pure on the table state:
 * what `planHand` decides before a hand (an ascension, who reigns this hand), what `afterHand` decides after it (energy,
 * a Bán Thần, the reigns counted down, a Thần dethroned) and what the room calls when a seat leaves (`endReign`). The
 * engine's half (the Aces, the curse, the dethrone at the settlement) is `engine-god.ts`.
 *
 * Rulings (Task 6):
 * - A reign counts every hand the table settles while it lasts, one the reigning seat sits out or is frozen in included
 *   (that hand it has no powers: spec §4.2 "ván đó không có hiệu ứng Thần"); a cancelled hand does not count. A Thần who
 *   sits out cannot hold the throne against the next Cá chép for ever.
 * - One Cá chép acts per seat, the oldest held; a second copy waits. The Thần's own Cá chép cards wait while it reigns
 *   (no energy, no Bán Thần).
 * - Energy is capped at 100 %. A roll at 0 % draws nothing (it cannot hit), nor one at 100 % (it always does).
 * - Two seats hitting in the same hand: one of them, at random, takes the throne; the other keeps its card and energy
 *   and rolls again at the first hand the throne is empty (Review Focus 4). While a Thần reigns nobody rolls.
 * - A frozen seat, or one in Nhật thực's dark, neither rolls nor turns Bán Thần that hand (its cards are off); the Thần
 *   itself is never darkened (G11).
 * - A Bán Thần who becomes the Thần ends its Bán Thần reign (the throne outranks it); a Bán Thần who wins with another
 *   Cá chép starts a new 5-hand reign (one per seat).
 * - A Bán Thần in Nhật thực's dark or frozen has no powers that hand (only the Thần is protected).
 */

/** The seat's Cá chép hóa rồng that acts (the oldest held), or undefined. */
export const carpOf = (seat: ChaosSeat): HeldCard | undefined => seat.cards.find((c) => c.effect === 'carp')

/**
 * The Cá chép hóa rồng card behind a reign, as an effect to record its lines and pay its crit with (the curse, the
 * ascension, the fall): the card is spent already, so its uid in `applied` or `blocked` takes nothing more from the seat.
 */
export const reignEffect = (r: { uid: number; cardId: string; params?: Readonly<Record<string, number>> }): PlannedEffect => ({
  uid: r.uid, cardId: r.cardId, effect: 'carp', params: r.params ?? {}, timing: 'wait', debuff: false, targets: [],
})

const reignOf = (card: HeldCard, seat: number, isBot: boolean): ChaosReign => ({ seat, isBot, cardId: card.cardId, uid: card.uid, params: card.params })
const reignPart = (r: ChaosReign): ChaosReign => ({ seat: r.seat, isBot: r.isBot, cardId: r.cardId, uid: r.uid, params: r.params })

/** A seat dealt into the hand as `planHand` planned it: whether its cards are off (frozen, or in Nhật thực's dark). */
export interface ReignSeat {
  seat: number
  playerId: string
  isBot: boolean
  frozen: boolean
  eclipsed: boolean
}

/**
 * The Thần whose powers act in a hand dealt to `dealt`, before Nhật thực's pass (which spares it): the table's Thần when
 * it is dealt in and not frozen; null otherwise.
 */
export function activeGod(table: ChaosTableState, dealt: readonly { seat: number; frozen: boolean }[]): number | null {
  const god = table.god
  if (!god) return null
  const s = dealt.find((x) => x.seat === god.seat)
  return s && !s.frozen ? god.seat : null
}

/**
 * Before a hand (`planHand`, after Nhật thực's pass), BP-41 §4.1–§4.3:
 * 1. With the throne empty, each seat dealt in whose cards are on and that holds a Cá chép rolls under its energy
 *    (`charge`, ≥ 100 certain). A hit becomes the Thần this very hand: the card is spent (gone from `chaos`), the reign
 *    starts at `godHands`, and the curse is drawn once (1 rút bài, 2 thách đấu, 3 tráo bài; none when `curseHands` is 0).
 * 2. The plan's reigns: the Thần (`god`) when dealt in and not frozen, the Bán Thần (`demigods`) whose cards are on, the
 *    live Cá chép (`carps`, the Thần's aside), and every seat dealt in may not fold while the Thần acts on a "Chơi hoặc
 *    bỏ" table (`noFold`, G11).
 * `chaos` is the map `planHand` returns, changed in place for the seat that ascends. Draws from `rng` only to roll (an
 * energy strictly between 0 and 100), to pick among several hits and to draw the curse.
 */
export function planReigns(input: {
  table: ChaosTableState
  seats: readonly ReignSeat[]
  chaos: Map<number, ChaosSeat>
  mode: ChaosMode
  rng: Rng
}): { table: ChaosTableState; god?: NonNullable<ChaosHandPlan['god']>; demigods?: ChaosReign[]; carps?: NonNullable<ChaosHandPlan['carps']>; noFold: number[] } {
  const { seats, chaos, mode, rng } = input
  let table = input.table
  const on = (seat: number): boolean => {
    const s = seats.find((x) => x.seat === seat)
    return s !== undefined && !s.frozen && !s.eclipsed
  }

  let ascended = false
  if (table.god === null) {
    const hopefuls = seats.flatMap((s) => {
      const card = on(s.seat) ? carpOf(chaos.get(s.seat)!) : undefined
      return card ? [{ s, card }] : []
    })
    const hits = hopefuls.filter(({ card }) => {
      const energy = card.charge ?? 0
      return energy >= 100 || (energy > 0 && rng.int(100) < energy)
    })
    if (hits.length > 0) {
      const { s, card } = hits.length === 1 ? hits[0]! : hits[rng.int(hits.length)]!
      const curse: ChaosGodCurse | null = (card.params.curseHands ?? 0) > 0 ? ((1 + rng.int(3)) as ChaosGodCurse) : null
      const held = chaos.get(s.seat)!
      chaos.set(s.seat, { ...held, cards: held.cards.filter((c) => c.uid !== card.uid) })
      table = {
        ...table,
        god: { ...reignOf(card, s.seat, s.isBot), playerId: s.playerId, handsLeft: card.params.godHands ?? 5, curse },
        demigods: table.demigods.filter((d) => d.seat !== s.seat),
      }
      ascended = true
    }
  }

  const g = table.god
  const godSeat = activeGod(table, seats)
  const out: ReturnType<typeof planReigns> = { table, noFold: [] }
  if (g && godSeat !== null) {
    out.god = { ...reignPart(g), curse: g.curse, ...(ascended ? { ascended: true as const } : {}) }
    if (mode === 'playOrFold') out.noFold = seats.map((s) => s.seat)
  }
  const demigods = table.demigods.filter((d) => on(d.seat)).map(reignPart)
  if (demigods.length > 0) out.demigods = demigods
  const carps = seats.flatMap((s) => {
    const card = on(s.seat) && s.seat !== g?.seat ? carpOf(chaos.get(s.seat)!) : undefined
    return card ? [{ seat: s.seat, uid: card.uid, cardId: card.cardId }] : []
  })
  if (carps.length > 0) out.carps = carps
  return out
}

/**
 * After a settled hand (`afterHand`), BP-41 §4.2–§4.3: every reign has a hand fewer (`ChaosTableState.god` Ruling); the
 * Thần's curse ends after its `curseHands`; a Thần whose powers acted this hand and that the engine saw beaten
 * (`outcomes.dethroned`) falls from the next hand; a reign at 0 ends. The same table object when nobody reigns.
 */
export function countReigns(table: ChaosTableState, plan: ChaosHandPlan, outcomes: ChaosHandOutcomes | undefined): ChaosTableState {
  if (table.god === null && table.demigods.length === 0) return table
  let god = table.god
  if (god) {
    const fallen = plan.god?.seat === god.seat && (outcomes?.dethroned?.length ?? 0) > 0
    const left = god.handsLeft - 1
    if (fallen || left <= 0) god = null
    else {
      const cursed = left > (god.params.godHands ?? 5) - (god.params.curseHands ?? 0)
      god = { ...god, handsLeft: left, curse: cursed ? god.curse : null }
    }
  }
  const demigods = table.demigods.map((d) => ({ ...d, handsLeft: d.handsLeft - 1 })).filter((d) => d.handsLeft > 0)
  return { ...table, god, demigods }
}

/** BP-41 §4.1: a lost hand gives the Cá chép a random whole `stepMin`..`stepMax` % of energy, up to 100. */
export function chargeCarp(card: HeldCard, rng: Rng): HeldCard {
  const lo = card.params.stepMin ?? 0
  const step = lo + rng.int(Math.max(1, (card.params.stepMax ?? lo) - lo + 1))
  return { ...card, charge: Math.min(100, (card.charge ?? 0) + step) }
}

/**
 * BP-41 §4.1: the Cá chép's holder won before it ascended — a Bán Thần from the next hand, for `demigodHands` hands (a
 * seat already one starts again). The card is spent by the caller.
 */
export function crownDemigod(table: ChaosTableState, card: HeldCard, seat: number, playerId: string, isBot: boolean): ChaosTableState {
  const demigod = { ...reignOf(card, seat, isBot), playerId, handsLeft: card.params.demigodHands ?? 5 }
  return { ...table, demigods: [...table.demigods.filter((d) => d.seat !== seat), demigod] }
}

/**
 * BP-41 §4.2 "rời bàn thì mất ngôi": the seat left the table — its Thần and Bán Thần reigns end now (the room calls this
 * when it clears the seat, Task 7a; the bombs are the room's too). The same table object when it reigned nowhere.
 */
export function endReign(table: ChaosTableState, seat: number): ChaosTableState {
  const god = table.god?.seat === seat ? null : table.god
  const demigods = table.demigods.filter((d) => d.seat !== seat)
  if (god === table.god && demigods.length === table.demigods.length) return table
  return { ...table, god, demigods }
}

/**
 * BP-41 §4.2–§4.3: the reign's crit multiplier on a won hand — the Thần ×4 / ×3 / ×2 under `p4` / `p4+p3` / `p4+p3+p2`,
 * a Bán Thần ×3 / ×2 under `b3` / `b3+b2` — or 0. One `rng.int(100)` each.
 */
export function reignCrit(kind: 'god' | 'demigod', params: Readonly<Record<string, number>>, rng: Rng): number {
  const r = rng.int(100)
  if (kind === 'god') {
    const p4 = params.p4 ?? 0
    const p3 = p4 + (params.p3 ?? 0)
    return r < p4 ? 4 : r < p3 ? 3 : r < p3 + (params.p2 ?? 0) ? 2 : 0
  }
  const b3 = params.b3 ?? 0
  return r < b3 ? 3 : r < b3 + (params.b2 ?? 0) ? 2 : 0
}
