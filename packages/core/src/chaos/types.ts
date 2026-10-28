import type { Card } from '../cards/cards.js'

/**
 * Poker hỗn loạn (spec 2026-10-26-chaos-poker-design): effect cards on a Blind table. Everything here is pure data;
 * the catalogue itself lives in data (spec §6.1), these types say what a card can be.
 */

export type ChaosTier = 'silver' | 'gold' | 'diamond'
/**
 * When a card acts (spec §5 "Lúc áp"): at the deal, during the play/fold choice, at the reveal, on a condition, on
 * receipt, or at the end of the hand (BP-41 §5, the dice: wait-like — never fired by `planHand`, never in the bonus hand).
 */
export type ChaosTiming = 'deal' | 'decision' | 'reveal' | 'wait' | 'now' | 'end'
/** The table's `BlindRules.decisionMode` a card is valid for; ✱ cards are `['playOrFold']` only. */
export type ChaosMode = 'playOrFold' | 'none'
/**
 * What a card does. The first block is BP-37's; the rest are BP-41's (spec 2026-10-28 §4–§6), one per behaviour — a card
 * that only changes numbers shares its kind with the card it varies (Siêu cộng dồn vàng is `acesCharge`, Thách đấu bạc and
 * vàng are `duel`, Đổi bài liều is BP-37's `swapHands`, the three Xúc xắc vận may are `fortuneDice`).
 */
export type ChaosEffectKind =
  | 'swapLowest' | 'bestOfN' | 'highCard' | 'suited' | 'redealWeak' | 'swapAll' | 'extraHole'
  | 'peekBoard' | 'freeFold' | 'refundStake' | 'shield' | 'mirror' | 'rescue' | 'chaosPoints' | 'farm'
  | 'stealHole' | 'lowerHole' | 'blindfold' | 'freeze' | 'crit' | 'fortune' | 'levelUp'
  | 'borrowHole' | 'redealBoard' | 'swapHands' | 'reverseRank' | 'gambler'
  // BP-41 Kim cương
  | 'carp' | 'acesCharge' | 'riskyHand' | 'adventurer' | 'shareWinnings' | 'plunder' | 'shuffleHoles' | 'swapLeader'
  | 'backfire' | 'deluge' | 'eclipse' | 'wildCard' | 'timeBomb' | 'fortuneDice'
  // BP-41 Vàng
  | 'flipFlop' | 'bigTable' | 'duel' | 'stealPoints' | 'scapegoat' | 'hawkEye' | 'sixthBoard' | 'winTax' | 'curse' | 'fateDie'
  // BP-41 Bạc
  | 'tierUp' | 'noFold' | 'coinFlip' | 'master' | 'lossPoints' | 'redealHole' | 'neighbourSwap' | 'spoiler' | 'kindling'

export const CHAOS_TIERS: readonly ChaosTier[] = ['silver', 'gold', 'diamond']
export const CHAOS_TIMINGS: readonly ChaosTiming[] = ['deal', 'decision', 'reveal', 'wait', 'now', 'end']
export const CHAOS_MODES: readonly ChaosMode[] = ['playOrFold', 'none']
export const CHAOS_EFFECT_KINDS: readonly ChaosEffectKind[] = [
  'swapLowest', 'bestOfN', 'highCard', 'suited', 'redealWeak', 'swapAll', 'extraHole',
  'peekBoard', 'freeFold', 'refundStake', 'shield', 'mirror', 'rescue', 'chaosPoints', 'farm',
  'stealHole', 'lowerHole', 'blindfold', 'freeze', 'crit', 'fortune', 'levelUp',
  'borrowHole', 'redealBoard', 'swapHands', 'reverseRank', 'gambler',
  'carp', 'acesCharge', 'riskyHand', 'adventurer', 'shareWinnings', 'plunder', 'shuffleHoles', 'swapLeader',
  'backfire', 'deluge', 'eclipse', 'wildCard', 'timeBomb', 'fortuneDice',
  'flipFlop', 'bigTable', 'duel', 'stealPoints', 'scapegoat', 'hawkEye', 'sixthBoard', 'winTax', 'curse', 'fateDie',
  'tierUp', 'noFold', 'coinFlip', 'master', 'lossPoints', 'redealHole', 'neighbourSwap', 'spoiler', 'kindling',
]
/**
 * The effects that hurt another seat (spec §3.4–§3.5: at most one fires per seat per hand, shields block them). BP-41
 * §3 adds the cards aimed at one person: Cướp đoạt, Ngược dòng, Lời nguyền, Đổi lá hàng xóm, Xào bài, Bom nổ chậm,
 * Thách đấu, Kẻ phá đám, Trộm điểm (Đổi bài liều is `swapHands`, already here). Table rules (Thuế thắng, Ép chia thưởng,
 * Cấm bỏ bài, Hoán vị định mệnh, Đại hồng thủy, Nhật thực, Sới lớn) are not debuffs.
 */
export const CHAOS_DEBUFF_EFFECTS: ReadonlySet<ChaosEffectKind> = new Set<ChaosEffectKind>([
  'stealHole', 'lowerHole', 'blindfold', 'freeze', 'swapHands',
  'plunder', 'swapLeader', 'curse', 'neighbourSwap', 'redealHole', 'timeBomb', 'duel', 'spoiler', 'stealPoints',
])

/**
 * One catalogue row. `params` holds every number of the card (spec §6.1), as integers:
 * - `hands`: a duration in hands — a card with `hands` is a duration card, one without fires once or waits;
 * - `all: 1`: a debuff on every opponent instead of one at random;
 * - `minRank`: a rank threshold in `rankOf` terms (0 = 2 … 12 = A);
 * - `p2`/`p3`: Bạo kích odds of ×2/×3 in percent; `multiplier`: Cấp cứu, × the fixed wager;
 * - Thần tài: `mN` × wager, `cN` prize cards of tier `tN` (1 silver, 2 gold, 3 diamond), for a loss streak of
 *   N = 2 (2–3 hands), 4 (4–5) or 6 (6 and more);
 * - Cấp độ: `count` cards of tier `tier` (absent = a random tier each).
 * BP-41's params (Cá chép, Siêu cộng dồn, the dice tables …) are listed card by card on `CHAOS_CARDS_SPEC` (fixtures.ts).
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
  /**
   * BP-41: state the card itself carries from hand to hand, kept with the card and lost with the seat — Cá chép's
   * energy and Siêu cộng dồn's chance (percent), Đảo bài's phase, Liều ăn nhiều's hands played, Mạo hiểm gia's step.
   * Absent on every card that keeps none. A second copy of a charge card adds hands and keeps this (Ruling 6).
   */
  charge?: number
}

/** The most cards a human seat keeps in its bonus hand (BP-39): a fourth bonus card waits as points. */
export const BONUS_HAND_MAX = 3

/**
 * A bonus card the player pressed "Dùng" on. `this`: inserted into the running hand's reveal; `next`: fires first in the
 * next hand's plan. It stays in `armed` through its hand, so no other client learns of it before it fires.
 */
export interface ArmedBonus {
  card: HeldCard
  hand: 'this' | 'next'
}

/** A seat's chaos state at one table; all of it is lost when the player leaves the seat (spec §3.4). */
export interface ChaosSeat {
  /** In the order received: the oldest debuff is the one that fires. */
  cards: HeldCard[]
  /** The bonus hand (BP-39): cards earned from points, kept private until played; at most `BONUS_HAND_MAX` for a human. */
  bonus: HeldCard[]
  /** The bonus card pressed and waiting to fire; one at a time. */
  armed: ArmedBonus | null
  /**
   * A bonus card was played into the hand in play (set by `planHand`, cleared by `afterHand`): "one bonus card per hand"
   * counts on the hand a card applies to, so a second card pressed during that hand's choice waits for the next.
   */
  bonusPlayedThisHand: boolean
  points: number
  streak: { kind: 'win' | 'loss'; len: number } | null
  frozenNextHand: boolean
  blindfoldedNextHand: boolean
  /** "Cày điểm": points ×2 while > 0 (mirrors the held farm card's hands left). */
  farmHandsLeft: number
  /** Bonus cards earned in a frozen hand, handed over at the end of the seat's next unfrozen hand. */
  pendingBonus: number
  /**
   * BP-41 Cấm bỏ bài (A2): another seat's card says this seat may not fold the table's next hand. Set by `afterHand` from
   * a `noFold` mark, read by `planHand` (`ChaosHandPlan.noFoldSeats`), gone after that hand whether the seat played it or
   * sat it out. Absent otherwise.
   */
  noFoldNextHand?: true
}

export interface ChaosConfig {
  tierWeights: Readonly<Record<ChaosTier, number>>
  pointsThreshold: number
  draftMs: number
  /** How long the hand result stays up before the next hand deals, unless every human skips it (BP-39). */
  resultMs: number
  dailyCapPoints: number
  dailyRescues: number
}

export const DEFAULT_CHAOS_CONFIG: ChaosConfig = Object.freeze({
  // BP-41 G8: 50 / 35 / 15 (was 60 / 30 / 10).
  tierWeights: Object.freeze({ silver: 50, gold: 35, diamond: 15 }),
  pointsThreshold: 10,
  draftMs: 15_000,
  resultMs: 10_000,
  dailyCapPoints: 100_000,
  dailyRescues: 3,
})

export const EMPTY_CHAOS_SEAT: ChaosSeat = Object.freeze({
  cards: Object.freeze([]) as unknown as HeldCard[],
  bonus: Object.freeze([]) as unknown as HeldCard[],
  armed: null,
  bonusPlayedThisHand: false,
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
  /**
   * BP-41: the held card's `charge` as this hand plays it — Siêu cộng dồn's chance in percent after this hand's growth,
   * Đảo bài's phase (hands it has played: even = +1 card, odd = −1). Absent on every card that keeps none.
   */
  charge?: number
  /**
   * BP-41 A8: a bonus card the player pressed for this hand that fires from `armed` (a decision card, a one-shot reveal
   * card): private until it fires, so Kẻ phá đám never switches it off (its event would name it). Absent otherwise.
   */
  fromBonus?: true
}

export interface ChaosHandPlan {
  seats: {
    seat: number
    effects: PlannedEffect[]
    /** `lasting`: a duration shield (Khiên sắt) that blocks every debuff while it lasts; otherwise it is spent on one. */
    shield: { uid: number; cardId: string; kind: 'shield' | 'mirror'; lasting?: true } | null
    blindfolded: boolean
    /**
     * BP-41 Nhật thực (A11): another seat's eclipse switched every card of this seat off for the hand — it fires nothing
     * (`effects` empty, no shield), and `afterHand` neither counts its durations down nor fires its wait cards. Absent
     * otherwise.
     */
    eclipsed?: true
    /**
     * BP-41 Bia đỡ đạn: the seat's oldest held scapegoat, waiting this hand (a wait card, exposed like `shield`): the
     * next debuff aimed at the seat goes to another seat at random, and the card is spent (its uid joins `applied`).
     * Absent when the seat holds none, is frozen or eclipsed.
     */
    scapegoat?: { uid: number; cardId: string }
    /**
     * BP-41 A1: the multiple of the fixed wager this seat stakes this hand, ante and "Chơi" alike — Mạo hiểm gia's step
     * (×2 … ×32) times Sới lớn's whole-table ×2 (Ruling 1: they multiply). The part above one wager is dead money
     * (`ChaosHandState.deadMoney`). Absent = 1.
     */
    stake?: number
  }[]
  reverse: boolean
  /**
   * BP-41 A2: the seats that may not fold this hand ("Chơi hoặc bỏ" only) — Cấm bỏ bài's mark from last hand (every seat
   * but its holder), or every seat while a Thần reigns. Absent or empty: anyone may fold.
   */
  noFoldSeats?: number[]
}

/**
 * A mark that landed this hand for the next one, after shields and mirrors (the engine's final marks): a freeze or a
 * blindfold on `seat`; `noFold` (BP-41 Cấm bỏ bài): `seat` may not fold next hand.
 */
export interface ChaosMark {
  seat: number
  kind: 'freeze' | 'blindfold' | 'noFold'
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
  /** The seats the card was aimed at (empty when it has no target), so the tooltip can say who it hit. */
  targets: number[]
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
  /**
   * Uids of every effect the table was told of (`CHAOS_APPLIED`, `CHAOS_PEEK`, a line in `CHAOS_SUMMARY`), used up or not:
   * a bonus card played for this hand that is named here never goes back to its owner's private bonus hand (BP-39 I1).
   */
  recorded: number[]
  /** "Nhìn trộm": the board cards each seat saw, kept so a reconnect shows them again. */
  peek: { seat: number; cards: Card[] }[]
  /**
   * BP-41 Mắt diều hâu: the hole cards of `target` that `seat` saw at the decision (one, or the whole hand), kept so a
   * reconnect shows them again. Absent until one fires.
   */
  hawk?: { seat: number; target: number; cards: Card[] }[]
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
  /**
   * BP-41 Lá chung thứ sáu: the board has six cards this hand (the river deals two). Absent = five. Set at the deal only
   * when the deck can spare the sixth card above the reserve.
   */
  sixthBoard?: true
  /**
   * BP-41 Lá ma: the hole card each seat ranks as wild this hand. It stays itself on every screen (clients show the real
   * card); only the showdown's ranking treats it as any card (`ShowdownHand.wild`). It is wild only while its seat still
   * holds it: a card stolen or swapped away loses the wildness, and the seat it goes to does not gain it.
   */
  wild?: { seat: number; card: Card }[]
  /**
   * BP-41 spec §3 "miễn nhiễm rút bài": the seats no card may take, lower, swap or redeal a hole card of this hand
   * (Liều ăn nhiều while it lasts, Đảo bài on a −1 hand). A debuff of that family aimed at one fizzles. Absent = none.
   */
  immune?: number[]
  /**
   * BP-41 A3: what the hand did that `afterHand` settles on — the room copies it into `afterHand`'s `outcomes`. Absent
   * until a round-three card or the Thần writes it.
   */
  outcomes?: ChaosHandOutcomes
  /**
   * BP-41 Thách đấu: each duel the reveal settled that pays — `payer` owes `winner` `wagers` × the fixed wager (2 or 3,
   * rolled on the card's `p2`/`p3`). A mirrored or bounced duel has the target challenge the holder. Task 5b moves the
   * points (`afterPayout`, capped at the payer's stack). Absent until one pays.
   */
  duels?: { winner: number; payer: number; wagers: number; cardId: string; uid: number }[]
  /**
   * BP-41 A12: the title marks this hand earned, per seat (an ascension, a demigod, a dethrone). The room copies them
   * into `HandSummary.players[].chaosTitles`. Absent when nobody earned one.
   */
  titles?: ({ seat: number } & ChaosTitles)[]
  /**
   * BP-41 A1: the multiplied part of each seat's stake (`plan.seats[].stake` − 1 wagers, at the ante and at "Chơi"),
   * taken from its stack into the pot but never into `totalCommitted`: nobody has to match it and nothing hands it back
   * as uncalled; `settle` adds it to the main pot (whoever wins that takes it), a hand where everyone folds carries it
   * over, `cancelHand` refunds it. "Bỏ không mất" and "Bảo hiểm" never touch it (Ruling 1). Absent until a seat pays some.
   */
  deadMoney?: { seat: number; amount: number }[]
}

/**
 * BP-41 A3: the round-three results `afterHand` settles on, as the engine recorded them in `ChaosHandState.outcomes`.
 * Every list holds seats; absent = none.
 */
export interface ChaosHandOutcomes {
  /** Xúc xắc định mệnh rolled 5–6: Bạo kích ×2 if the seat wins. */
  fateCrit?: number[]
  /** Seats that won a Thách đấu (or a Thần thách đấu) this hand: a payment is due to them (`ChaosHandState.duels`). */
  duelWins?: number[]
  /** Seats that beat the Thần this hand (spec §4.2 "hạ Thần"): each takes 2 Kim cương cards and a count. */
  dethroned?: number[]
  /** Seats dealt their Aces by Siêu cộng dồn this hand: its charge goes back to 0 and the card is spent. */
  acesDealt?: number[]
}

/**
 * BP-41 §4.4: one hand's title marks for one seat — became the Thần (`ascended`), became a Bán Thần (`demigod`), beat
 * the Thần `slew` times (1 per hand; 0 or absent = none). Counted for a title only where spec §4.4 G12 allows (≥ 2
 * humans at the table, never a bot Thần).
 */
export interface ChaosTitles {
  ascended?: true
  demigod?: true
  slew?: number
}

/**
 * The ledger reasons of new points a card pays. BP-41 A14: every crit (Thần, Bán Thần, Liều ăn nhiều, Xúc xắc định
 * mệnh…) stays `chaos_crit`; `chaos_jackpot` is a dice or Mạo hiểm gia jackpot.
 */
export type ChaosCreditReason = 'chaos_rescue' | 'chaos_crit' | 'chaos_fortune' | 'chaos_jackpot'

/** A Bạo kích multiplier: ×2/×3 (BP-37), ×4/×5 (BP-41's Thần and Liều ăn nhiều). */
export type ChaosCritMultiplier = 2 | 3 | 4 | 5

/** New points a card pays (spec §4): the room writes one ledger row per credit. */
export interface ChaosCredit {
  seat: number
  amount: number
  reason: ChaosCreditReason
  cardId: string
  /** The held card that paid. */
  uid: number
  /** Bạo kích only. */
  multiplier?: ChaosCritMultiplier
}

/**
 * BP-41 §5: points a card takes off a seat's stack into the sink (Xúc xắc vận may's unlucky rolls). The room lowers
 * the stack at once and writes the sink like the table fee (`SettlementMeta.kind: 'chaos_dice'`, A6); never more than
 * the stack.
 */
export interface ChaosDebit {
  seat: number
  amount: number
  reason: 'chaos_dice'
  cardId: string
  /** The held card that rolled. */
  uid: number
}

/**
 * BP-41 §5: what one Xúc xắc vận may roll gave (`CHAOS_DICE.result`). Empty = nothing. `points`: chaos points; `cards`:
 * prize cards by tier and count, never which cards (A7: a human's go to the private bonus hand); `burned`: points the
 * seat lost to the sink (`ChaosDebit`), as taken; `jackpot`: the jackpot due (the `CHAOS_CREDIT` that follows says what
 * the daily cap let through); `triple`: three alike on the Kim cương dice (the cell's prize doubled); `herald`: the
 * table-wide banner (18 or 6-6-6).
 */
export interface ChaosDiceResult {
  points?: number
  cards?: { tier: ChaosTier; count: number }[]
  burned?: number
  jackpot?: number
  triple?: true
  herald?: true
}

/** BP-41 §4.2: the Thần's curse on every other seat in the first 3 hands — 1 rút bài, 2 thách đấu, 3 tráo bài. */
export type ChaosGodCurse = 1 | 2 | 3

/**
 * The chaos state of the table itself, not of a seat (BP-41 §4, §6.1 Bom nổ chậm), server-side: one Thần at most, any
 * number of Bán Thần, and the bombs in play. `planHand` and `afterHand` take it in and give it back (A3); a seat that
 * leaves ends its reign and clears its bombs. Pure data; `EMPTY_CHAOS_TABLE` is the start.
 */
export interface ChaosTableState {
  /**
   * The Thần Bài, or null. `handsLeft`: hands of the reign still to play (5 at the ascension). `curse`: drawn once at the
   * ascension; it acts while `handsLeft > 2` (the first 3 hands) and is null afterwards.
   */
  god: { seat: number; playerId: string; isBot: boolean; handsLeft: number; curse: ChaosGodCurse | null } | null
  /** The Bán Thần, one per seat at most, each with the hands of its reign still to play (5 at the start). */
  demigods: { seat: number; playerId: string; isBot: boolean; handsLeft: number }[]
  /**
   * Every Bom nổ chậm in play (two holders may each plant one, A3): planted by `owner`, held by `carrier` (never the
   * owner), `handsLeft` until it explodes (3 at the plant); `cardId`/`uid` name the card that planted it.
   */
  bombs: { owner: number; carrier: number; handsLeft: number; cardId: string; uid: number }[]
}

export const EMPTY_CHAOS_TABLE: ChaosTableState = Object.freeze({
  god: null,
  demigods: Object.freeze([]) as unknown as ChaosTableState['demigods'],
  bombs: Object.freeze([]) as unknown as ChaosTableState['bombs'],
})

/**
 * What every client sees of `ChaosTableState` (`CHAOS_STATE.table`, `ChaosSnapshot.table`): who reigns and for how long,
 * the curse, and who carries a bomb. Never a player id or a held bonus card.
 */
export interface ChaosTableView {
  god: { seat: number; handsLeft: number; curse: ChaosGodCurse | null } | null
  demigods: { seat: number; handsLeft: number }[]
  bombs: { owner: number; carrier: number; handsLeft: number }[]
}

export interface HeldCardView {
  uid: number
  cardId: string
  tier: ChaosTier
  handsLeft: number | null
  /** BP-41: the card's `HeldCard.charge` (Cá chép's energy, Siêu cộng dồn's %…), when it keeps one. */
  charge?: number
}
