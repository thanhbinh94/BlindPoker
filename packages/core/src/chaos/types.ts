import type { Card } from '../cards/cards.js'

/**
 * Poker hỗn loạn (spec 2026-10-26-chaos-poker-design): effect cards on a Blind table. Everything here is pure data;
 * the catalogue itself lives in data (spec §6.1), these types say what a card can be.
 */

export type ChaosTier = 'silver' | 'gold' | 'diamond'
/** When a card acts (spec §5 "Lúc áp"): at the deal, during the play/fold choice, at the reveal, on a condition, on receipt. */
export type ChaosTiming = 'deal' | 'decision' | 'reveal' | 'wait' | 'now'
/** The table's `BlindRules.decisionMode` a card is valid for; ✱ cards are `['playOrFold']` only. */
export type ChaosMode = 'playOrFold' | 'none'
export type ChaosEffectKind =
  | 'swapLowest' | 'bestOfN' | 'highCard' | 'suited' | 'redealWeak' | 'swapAll' | 'extraHole'
  | 'peekBoard' | 'freeFold' | 'refundStake' | 'shield' | 'mirror' | 'rescue' | 'chaosPoints' | 'farm'
  | 'stealHole' | 'lowerHole' | 'blindfold' | 'freeze' | 'crit' | 'fortune' | 'levelUp'
  | 'borrowHole' | 'redealBoard' | 'swapHands' | 'reverseRank' | 'gambler'

export const CHAOS_TIERS: readonly ChaosTier[] = ['silver', 'gold', 'diamond']
export const CHAOS_TIMINGS: readonly ChaosTiming[] = ['deal', 'decision', 'reveal', 'wait', 'now']
export const CHAOS_MODES: readonly ChaosMode[] = ['playOrFold', 'none']
export const CHAOS_EFFECT_KINDS: readonly ChaosEffectKind[] = [
  'swapLowest', 'bestOfN', 'highCard', 'suited', 'redealWeak', 'swapAll', 'extraHole',
  'peekBoard', 'freeFold', 'refundStake', 'shield', 'mirror', 'rescue', 'chaosPoints', 'farm',
  'stealHole', 'lowerHole', 'blindfold', 'freeze', 'crit', 'fortune', 'levelUp',
  'borrowHole', 'redealBoard', 'swapHands', 'reverseRank', 'gambler',
]
/** The effects that hurt another seat (spec §3.4–§3.5: at most one fires per seat per hand, shields block them). */
export const CHAOS_DEBUFF_EFFECTS: ReadonlySet<ChaosEffectKind> = new Set(['stealHole', 'lowerHole', 'blindfold', 'freeze', 'swapHands'])

/**
 * One catalogue row. `params` holds every number of the card (spec §6.1), as integers:
 * - `hands`: a duration in hands — a card with `hands` is a duration card, one without fires once or waits;
 * - `all: 1`: a debuff on every opponent instead of one at random;
 * - `minRank`: a rank threshold in `rankOf` terms (0 = 2 … 12 = A);
 * - `p2`/`p3`: Bạo kích odds of ×2/×3 in percent; `multiplier`: Cấp cứu, × the fixed wager;
 * - Thần tài: `mN` × wager, `cN` prize cards of tier `tN` (1 silver, 2 gold, 3 diamond), for a loss streak of
 *   N = 2 (2–3 hands), 4 (4–5) or 6 (6 and more);
 * - Cấp độ: `count` cards of tier `tier` (absent = a random tier each).
 */
export interface ChaosCardDef {
  id: string
  tier: ChaosTier
  /** Display and filter only (spec §5 "Nhóm"); never decides stacking. */
  family: string
  effect: ChaosEffectKind
  params: Readonly<Record<string, number>>
  timing: ChaosTiming
  modes: readonly ChaosMode[]
  debuff: boolean
  enabled: boolean
}

/** One copy of a card on a seat. */
export interface HeldCard {
  uid: number
  cardId: string
  tier: ChaosTier
  effect: ChaosEffectKind
  params: Readonly<Record<string, number>>
  timing: ChaosTiming
  debuff: boolean
  /** null = waits for its condition (wait cards) or fires once (one-shot). */
  handsLeft: number | null
}

/** A seat's chaos state at one table; all of it is lost when the player leaves the seat (spec §3.4). */
export interface ChaosSeat {
  /** In the order received: the oldest debuff is the one that fires. */
  cards: HeldCard[]
  points: number
  streak: { kind: 'win' | 'loss'; len: number } | null
  frozenNextHand: boolean
  blindfoldedNextHand: boolean
  /** "Cày điểm": points ×2 while > 0 (mirrors the held farm card's hands left). */
  farmHandsLeft: number
  /** Bonus cards earned in a frozen hand, handed over at the end of the seat's next unfrozen hand. */
  pendingBonus: number
}

export interface ChaosConfig {
  tierWeights: Readonly<Record<ChaosTier, number>>
  pointsThreshold: number
  draftMs: number
  dailyCapPoints: number
  dailyRescues: number
}

export const DEFAULT_CHAOS_CONFIG: ChaosConfig = Object.freeze({
  tierWeights: Object.freeze({ silver: 60, gold: 30, diamond: 10 }),
  pointsThreshold: 10,
  draftMs: 15_000,
  dailyCapPoints: 100_000,
  dailyRescues: 3,
})

export const EMPTY_CHAOS_SEAT: ChaosSeat = Object.freeze({
  cards: Object.freeze([]) as unknown as HeldCard[],
  points: 0,
  streak: null,
  frozenNextHand: false,
  blindfoldedNextHand: false,
  farmHandsLeft: 0,
  pendingBonus: 0,
})

export interface PlannedEffect {
  uid: number
  cardId: string
  effect: ChaosEffectKind
  params: Readonly<Record<string, number>>
  timing: ChaosTiming
  debuff: boolean
  /** Deal-time debuffs only (`freeze`, `blindfold`); reveal debuffs pick their target in the engine. */
  targets: number[]
}

export interface ChaosHandPlan {
  seats: {
    seat: number
    effects: PlannedEffect[]
    /** `lasting`: a duration shield (Khiên sắt) that blocks every debuff while it lasts; otherwise it is spent on one. */
    shield: { uid: number; cardId: string; kind: 'shield' | 'mirror'; lasting?: true } | null
    blindfolded: boolean
  }[]
  reverse: boolean
}

/** A freeze or blindfold that landed this hand, after shields and mirrors (the engine's final marks). */
export interface ChaosMark {
  seat: number
  kind: 'freeze' | 'blindfold'
}

/**
 * What became of one card's effect in a hand: it acted; a shield stopped it (`blocked`); a mirror turned it back on its
 * user (`reflected`); or it changed nothing — the deck reserve was short, its condition was not met, or its target had
 * already taken a debuff this hand (`fizzled`).
 */
export type ChaosOutcome = 'applied' | 'blocked' | 'reflected' | 'fizzled'

/** One line of "Thẻ đã dùng" (the `CHAOS_SUMMARY` event at settlement). */
export interface ChaosUse {
  seat: number
  cardId: string
  effect: ChaosEffectKind
  outcome: ChaosOutcome
}

/**
 * The engine's chaos bookkeeping for one Blind hand (`HandState.chaos`), server-side only. `applied ∪ blocked` are the
 * held-card uids the hand used up (Task 3 passes them to `afterHand` as `consumed`); `marks` are the freezes and
 * blindfolds that landed; `used` feeds `CHAOS_SUMMARY`.
 */
export interface ChaosHandState {
  plan: ChaosHandPlan
  /** Uids of the effects that fired (a debuff that fizzled on an already-hit seat counts: spec §3.5.4). */
  applied: number[]
  /** Uids of the debuffs a shield or mirror stopped, and of the one-shot shields and mirrors spent doing it. */
  blocked: number[]
  /** "Nhìn trộm": the board cards each seat saw, kept so a reconnect shows them again. */
  peek: { seat: number; cards: Card[] }[]
  freeFoldSeats: number[]
  insured: { seat: number; percent: number }[]
  /** "Mượn lá": a copy of an opponent's hole card the seat ranks with. */
  borrowed: { seat: number; card: Card }[]
  marks: ChaosMark[]
  used: ChaosUse[]
  /** Seats that took a debuff this hand (spec §3.5.4: one each). */
  hit: number[]
  /** Seats whose one-shot shield or mirror is spent this hand. */
  shieldSpent: number[]
}

export type ChaosCreditReason = 'chaos_rescue' | 'chaos_crit' | 'chaos_fortune'

/** New points a card pays (spec §4): the room writes one ledger row per credit. */
export interface ChaosCredit {
  seat: number
  amount: number
  reason: ChaosCreditReason
  cardId: string
  /** The held card that paid. */
  uid: number
  /** Bạo kích only. */
  multiplier?: 2 | 3
}

export interface HeldCardView {
  uid: number
  cardId: string
  tier: ChaosTier
  handsLeft: number | null
}
