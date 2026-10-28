import type { Rng } from '../cards/rng.js'
import type { BlindRules } from '../hand/types.js'
import { clearUnsettledHand, firesFromArmed, returnToBonus } from './bonus.js'
import { pickCard } from './draw.js'
import { activeGod, planReigns } from './god.js'
import { farmHandsOf, stackHeld } from './hold.js'
import {
  EMPTY_CHAOS_TABLE,
  type ChaosBomb, type ChaosCardDef, type ChaosEffectKind, type ChaosHandPlan, type ChaosMode, type ChaosSeat, type ChaosTableState, type HeldCard, type PlannedEffect,
} from './types.js'

/**
 * Spec §5.3 Tay bạc: it rolls any enabled Silver or Gold effect except these. A roll fires for one hand under a fresh
 * uid, with no held card behind it, so BP-41 (Task 2) also leaves out: every round-three card that waits, acts on
 * receipt or at the end of the hand (Nâng tầm uy lực, Cao thủ, Bia đỡ đạn, Trộm điểm, the dice, Cá chép); the cards that
 * carry state on the held card from hand to hand (Siêu cộng dồn's chance, Đảo bài's phase); and every Kim cương-only
 * round-three rule, named here too so a catalogue that ever lists one as Silver or Gold still cannot hand it to a roll.
 */
export const GAMBLER_EXCLUDED: ReadonlySet<ChaosEffectKind> = new Set<ChaosEffectKind>([
  'rescue', 'fortune', 'levelUp', 'gambler',
  'tierUp', 'master', 'scapegoat', 'stealPoints', 'fortuneDice', 'carp',
  'acesCharge', 'flipFlop',
  'riskyHand', 'adventurer', 'shareWinnings', 'plunder', 'shuffleHoles', 'swapLeader', 'backfire', 'deluge', 'eclipse',
  'wildCard', 'timeBomb',
])
/** The debuffs that act at the deal and so are aimed here; the reveal debuffs are aimed by the engine at the reveal. */
const DEAL_DEBUFFS: ReadonlySet<ChaosEffectKind> = new Set(['freeze', 'blindfold'])

export interface PlanSeatInput {
  seat: number
  /** Who sits there (BP-41: kept on the Thần's reign, `ChaosTableState.god.playerId`). Absent = ''. */
  playerId?: string
  isBot: boolean
  chaos: ChaosSeat
}

type PlanSeat = ChaosHandPlan['seats'][number]
type Firing = Omit<PlannedEffect, 'targets'>

/**
 * Picks the effects that fire this hand (spec §3.4–§3.5) for the seats dealt in. A frozen seat fires nothing, not even
 * its shield (and its armed bonus card waits, untouched). Otherwise a played bonus card fires first (see below), then,
 * in the order the cards were received: duration cards fire while they have hands left; one-shot buffs fire once per
 * effect kind; at most one debuff fires (the oldest); shields and mirrors are exposed as `shield` for the engine, and a
 * held Bia đỡ đạn as `scapegoat` (BP-41); Cấp cứu, Thần tài and Cao thủ wait for `afterHand`; a card whose modes
 * exclude the table's never fires. Each Tay bạc then rolls one effect under the same rules. Deal-time debuffs get their
 * targets here (one other seat at random, or every other seat with `all`); reveal debuffs get `targets: []`. The input
 * seats are never changed: the returned map holds each seat as it goes into the hand (a rolled Tích lũy adds its points
 * there).
 *
 * `table` (BP-41 A3) is the table's chaos state going into the hand (the Thần, the Bán Thần, the bombs); the returned
 * `table` is what it becomes for this hand. Absent, it is `EMPTY_CHAOS_TABLE`. End-of-hand cards (`end`, the dice) are
 * never fired here, like wait cards (A10). BP-41's deal-time debuffs (Cướp đoạt, Lời nguyền, Kẻ phá đám) get
 * `targets: []`: the engine aims them at the deal. A bonus card that fires from `armed` is marked `fromBonus`. Once every
 * seat is planned, a second pass applies Nhật thực (`eclipse`; never on the Thần), then the reigns (`planReigns`, Task 6:
 * a Cá chép may ascend, the Thần, the Bán Thần and the live Cá chép go into the plan), then each seat's stake is set
 * (`stakes`: Mạo hiểm gia, Sới lớn; Task 5a) and, on a "Chơi hoặc bỏ" table, the seats Cấm bỏ bài marked last hand —
 * every seat while the Thần acts — go into `noFoldSeats`. Last, each Bom nổ chậm on the table whose owner is dealt in is
 * passed to another seat (`passBombs`, Task 5b) and goes into `plan.bombs`; the returned `table` carries the new
 * carriers.
 */
export function planHand(input: {
  seats: readonly PlanSeatInput[]
  rules: BlindRules
  pool: readonly ChaosCardDef[]
  rng: Rng
  nextUid: () => number
  weights?: ReadonlyMap<string, number>
  table?: ChaosTableState
}): { plan: ChaosHandPlan; seats: Map<number, ChaosSeat>; table: ChaosTableState } {
  const { rules, pool, rng, nextUid, weights } = input
  const table = input.table ?? EMPTY_CHAOS_TABLE
  const mode: ChaosMode = rules.decisionMode
  const defs = new Map(pool.map((c) => [c.id, c]))
  /** A card the GM took out of the pool since it was drawn still runs (spec §6.2): it was valid when received. */
  const validHere = (cardId: string): boolean => defs.get(cardId)?.modes.includes(mode) ?? true

  const planSeats: PlanSeat[] = []
  const seats = new Map<number, ChaosSeat>()
  /** Each Siêu cộng dồn grown this hand, as it was before (by uid): the Thần's is put back (Ruling 25). */
  const ungrown = new Map<number, HeldCard>()
  for (const { seat, chaos: given } of input.seats) {
    // What a hand that never settled (cancelled) left behind: a card armed for it goes back to the bonus hand unfired
    // (spec §3.4), and its "played" marker is cleared. The room does this when the hand is cancelled (M4); this is the
    // fallback for a seat that never reached that path.
    let chaos = clearUnsettledHand(given)
    const out: PlanSeat = { seat, effects: [], shield: null, blindfolded: chaos.blindfoldedNextHand }
    planSeats.push(out)
    seats.set(seat, chaos)
    if (chaos.frozenNextHand) continue

    // A bonus card played for this hand (BP-39) fires first, and marks the hand as having had its one bonus card. A
    // one-shot reveal or decision card fires from `armed`, which now names this hand, so `afterHand` can see whether it
    // was used (and nobody learns it was played before it fires). Any other card joins `cards` and fires under the rules
    // below: a duration card by the stacking rule (back to the bonus hand, unplayed, if a stronger held card would drop
    // it), a one-shot deal card (freeze, blindfold, Tay bạc) at the front, so a pressed debuff fires before a held draft
    // debuff (spec §3.4). A card this table's mode excludes does not fire: it waits as `this`, to go back to the bonus hand.
    let lead: HeldCard | null = null
    if (chaos.armed) {
      const card = chaos.armed.card
      if (!validHere(card.cardId)) chaos = { ...chaos, armed: { card, hand: 'this' } }
      else if (firesFromArmed(card)) {
        lead = card
        chaos = { ...chaos, armed: { card, hand: 'this' }, bonusPlayedThisHand: true }
      } else {
        const cards = card.handsLeft === null ? [card, ...chaos.cards] : stackHeld(chaos.cards, card)
        chaos = cards
          ? { ...chaos, cards, armed: null, farmHandsLeft: farmHandsOf(cards), bonusPlayedThisHand: true }
          : { ...chaos, bonus: returnToBonus(chaos.bonus, card), armed: null }
      }
      seats.set(seat, chaos)
    }

    const opponents = input.seats.filter((s) => s.seat !== seat).map((s) => s.seat)
    const kinds = new Set<ChaosEffectKind>()
    let debuffFired = false
    const fire = (f: Firing, fromBonus = false): void => {
      let targets: number[] = []
      if (DEAL_DEBUFFS.has(f.effect)) {
        if (f.params.all) targets = opponents.slice()
        else if (opponents.length > 0) targets = [opponents[rng.int(opponents.length)]!]
      }
      out.effects.push({
        uid: f.uid, cardId: f.cardId, effect: f.effect, params: f.params, timing: f.timing, debuff: f.debuff, targets,
        ...(f.charge === undefined ? {} : { charge: f.charge }),
        ...(fromBonus ? { fromBonus: true as const } : {}),
      })
      kinds.add(f.effect)
      if (f.debuff) debuffFired = true
    }

    // BP-41: the charge a firing card carries into this hand. Siêu cộng dồn's chance grows by a random whole
    // `stepMin`..`stepMax` percent, up to `cap`, before this hand's roll (spec §6.1 "mỗi ván +5..7 %"); the grown card is
    // what the seat keeps — unless the seat reigns as the Thần this hand, whose card neither rolls nor grows (Ruling 25:
    // the growth is undone once the reigns are known, below). Đảo bài's phase goes as it is (`afterHand` moves it on).
    // Other cards carry none.
    const grown = new Map<number, HeldCard>()
    const chargeUp = (card: HeldCard): HeldCard => {
      if (card.effect === 'flipFlop' || card.effect === 'adventurer') return { ...card, charge: card.charge ?? 0 }
      if (card.effect !== 'acesCharge') return card
      const lo = card.params.stepMin ?? 0
      const step = lo + rng.int(Math.max(1, (card.params.stepMax ?? lo) - lo + 1))
      const next = { ...card, charge: Math.min(card.params.cap ?? 100, (card.charge ?? 0) + step) }
      grown.set(card.uid, next)
      ungrown.set(card.uid, card)
      return next
    }

    if (lead) fire(lead, true)
    let gamblers = 0
    for (const card of chaos.cards) {
      if (!validHere(card.cardId)) continue
      if (card.handsLeft !== null && card.handsLeft <= 0) continue
      if (card.effect === 'gambler') {
        gamblers++
      } else if (card.effect === 'shield' || card.effect === 'mirror') {
        // One shield stands up per hand. A lasting one (a duration card) is preferred to a one-shot: it is not used up by
        // what it stops, so the one-shot is kept for a later hand (Plan 37 final wave, M1). Otherwise the oldest held.
        const lasting = card.handsLeft !== null
        if (out.shield === null || (lasting && out.shield.lasting !== true)) {
          out.shield = { uid: card.uid, cardId: card.cardId, kind: card.effect, ...(lasting ? { lasting: true as const } : {}) }
        }
      } else if (card.effect === 'scapegoat') {
        // BP-41 Bia đỡ đạn waits for a debuff aimed at the seat: the oldest held one stands, as a shield does.
        out.scapegoat ??= { uid: card.uid, cardId: card.cardId }
      } else if (card.timing !== 'wait' && card.timing !== 'now' && card.timing !== 'end' && !(card.debuff && debuffFired) && !kinds.has(card.effect)) {
        fire(chargeUp(card))
      }
    }
    if (grown.size > 0) {
      chaos = { ...chaos, cards: chaos.cards.map((c) => grown.get(c.uid) ?? c) }
      seats.set(seat, chaos)
    }

    let points = chaos.points
    for (let g = 0; g < gamblers; g++) {
      const candidates = pool.filter((c) =>
        (c.tier === 'silver' || c.tier === 'gold') && !GAMBLER_EXCLUDED.has(c.effect) && c.modes.includes(mode)
        && !kinds.has(c.effect) && !(c.debuff && debuffFired)
        && !((c.effect === 'shield' || c.effect === 'mirror') && out.shield))
      const rolled = pickCard(candidates, rng, weights)
      if (!rolled) continue
      const uid = nextUid()
      if (rolled.effect === 'shield' || rolled.effect === 'mirror') {
        out.shield = { uid, cardId: rolled.id, kind: rolled.effect, ...(rolled.params.hands ? { lasting: true as const } : {}) }
        continue
      }
      if (rolled.effect === 'chaosPoints') points += rolled.params.points ?? 0
      fire({ ...rolled, uid, cardId: rolled.id })
    }
    if (points !== chaos.points) seats.set(seat, { ...chaos, points })
  }

  // BP-41 G11: Nhật thực never darkens the Thần whose powers act this hand.
  const frozen = (seat: number): boolean => input.seats.find((s) => s.seat === seat)!.chaos.frozenNextHand
  eclipse(planSeats, seats, input.seats, rng, activeGod(table, input.seats.map((s) => ({ seat: s.seat, frozen: frozen(s.seat) }))))
  // BP-41 §4 (Task 6): an ascension, and who reigns this hand.
  const reigns = planReigns({
    table,
    seats: input.seats.map((s) => ({
      seat: s.seat, playerId: s.playerId ?? '', isBot: s.isBot, frozen: frozen(s.seat), eclipsed: planSeats.find((p) => p.seat === s.seat)!.eclipsed === true,
    })),
    chaos: seats,
    mode,
    rng,
  })
  // Ruling 25: the Thần holds Aces already — its Siêu cộng dồn does not roll (the engine) and does not grow (here) while it
  // reigns. The rng draws stay as they were, so no other seat's plan changes.
  if (reigns.god) {
    const g = reigns.god.seat
    const back = (card: HeldCard): HeldCard => ungrown.get(card.uid) ?? card
    const held = seats.get(g)
    if (held) seats.set(g, { ...held, cards: held.cards.map(back) })
    const planned = planSeats.find((p) => p.seat === g)
    if (planned) {
      planned.effects = planned.effects.map((e) => {
        const was = ungrown.get(e.uid)
        if (!was) return e
        const { charge: _grown, ...rest } = e
        return was.charge === undefined ? rest : { ...rest, charge: was.charge }
      })
    }
  }
  stakes(planSeats)
  const plan: ChaosHandPlan = { seats: planSeats, reverse: planSeats.some((s) => s.effects.some((e) => e.effect === 'reverseRank')) }
  if (reigns.god) plan.god = reigns.god
  if (reigns.demigods) plan.demigods = reigns.demigods
  if (reigns.carps) plan.carps = reigns.carps
  // BP-41 A2 Cấm bỏ bài: last hand's marks, on a "Chơi hoặc bỏ" table only (the card is ✱; there is no fold elsewhere);
  // with a Thần acting, every seat (G11, `planReigns`).
  const marked = mode === 'playOrFold' ? input.seats.filter((s) => s.chaos.noFoldNextHand === true).map((s) => s.seat) : []
  const noFold = input.seats.map((s) => s.seat).filter((s) => marked.includes(s) || reigns.noFold.includes(s))
  if (noFold.length > 0) plan.noFoldSeats = noFold
  // BP-41 Bom nổ chậm (Task 5b): each bomb on the table passes to another seat and plays this hand.
  const after = reigns.table
  if (after.bombs.length === 0) return { plan, seats, table: after }
  const passed = passBombs(after.bombs, input.seats.map((s) => s.seat), rng)
  if (passed.playing.length > 0) plan.bombs = passed.playing
  return { plan, seats, table: { ...after, bombs: passed.bombs } }
}

/**
 * BP-41 A1, each seat's stake this hand (`stake`, absent = ×1), once Nhật thực has switched cards off: Sới lớn makes the
 * whole table's ×`stake` (one table rule however many seats fire it: the highest), Mạo hiểm gia its holder's
 * ×`stake`^k on the card's k-th hand (`charge` = hands it has played; k at most `hands`, so a second copy that adds hands
 * never goes past ×32). The two multiply (Ruling 1). Draws nothing.
 */
function stakes(planSeats: PlanSeat[]): void {
  const table = planSeats.reduce((m, s) => Math.max(m, ...s.effects.filter((e) => e.effect === 'bigTable').map((e) => e.params.stake ?? 1)), 1)
  for (const s of planSeats) {
    const adv = s.effects.find((e) => e.effect === 'adventurer')
    const own = adv ? (adv.params.stake ?? 1) ** Math.min((adv.charge ?? 0) + 1, adv.params.hands ?? 1) : 1
    const stake = table * own
    if (stake > 1) s.stake = stake
  }
}

/**
 * BP-41 Nhật thực, the plan's second pass (A11): when a seat fires it, every other seat's cards are off for the hand —
 * "không áp, không mất". Such a seat fires nothing and stands no shield (`eclipsed`), and goes into the hand exactly as it
 * came (`clearUnsettledHand` only): a bonus card pressed for this hand stays armed for the next, a Siêu cộng dồn does not
 * grow, a Tay bạc rolls nothing. Two seats firing it in one hand: one of them, at random, is the eclipse (Ruling 3b-1);
 * the other is switched off with everyone else's cards and keeps its card. Draws from `rng` only then. `spare` (BP-41
 * G11): the Thần whose powers act this hand — never darkened, its cards and powers stay on.
 */
function eclipse(planSeats: PlanSeat[], seats: Map<number, ChaosSeat>, input: readonly PlanSeatInput[], rng: Rng, spare: number | null): void {
  const holders = planSeats.filter((s) => s.effects.some((e) => e.effect === 'eclipse'))
  if (holders.length === 0) return
  const sun = holders.length === 1 ? holders[0]! : holders[rng.int(holders.length)]!
  for (const s of planSeats) {
    if (s === sun || s.seat === spare) continue
    s.effects = []
    s.shield = null
    delete s.scapegoat
    s.eclipsed = true
    seats.set(s.seat, clearUnsettledHand(input.find((x) => x.seat === s.seat)!.chaos))
  }
}

/**
 * BP-41 Bom nổ chậm before a hand (`planHand`, A3): each bomb whose owner is dealt in plays this hand, passed to a
 * random seat dealt in that is neither its owner nor its carrier (heads-up there is none: the carrier keeps it). A bomb
 * whose owner sits the hand out waits, untouched and not counted down (Ruling 5b-6). Returns the table's bombs with
 * their new carriers and the ones this hand plays (`ChaosHandPlan.bombs`). Draws from `rng` only to pass a bomb.
 */
export function passBombs(bombs: readonly ChaosBomb[], dealt: readonly number[], rng: Rng): { bombs: ChaosBomb[]; playing: ChaosBomb[] } {
  const playing: ChaosBomb[] = []
  const next = bombs.map((b) => {
    if (!dealt.includes(b.owner)) return b
    const others = dealt.filter((s) => s !== b.owner && s !== b.carrier)
    const carrier = others.length > 0 ? others[rng.int(others.length)]! : b.carrier
    if (!dealt.includes(carrier)) return b
    const moved = carrier === b.carrier ? b : { ...b, carrier }
    playing.push({ ...moved })
    return moved
  })
  return { bombs: next, playing }
}
