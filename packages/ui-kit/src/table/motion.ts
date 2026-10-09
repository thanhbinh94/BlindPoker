import type { ClientHand } from '../client/types.js'

/**
 * The table's card motion in numbers (spec 2026-10-08 §3, §4.1): how long each move takes — the CSS tokens' twins, which
 * `Card.test` holds equal — how far apart the cards go, and the rules `PokerTable`, `Seat` and `useRevealHold` time it by.
 */

/** How long a revealed card takes to turn over in place: the `--dur-flip` token in `tokens.css`. */
export const FLIP_MS = 600
/** The slide from the deck: the `--dur-deal` token. */
export const DEAL_MS = 360
/** The showdown's lift-and-turn: the `--dur-lift` token. */
export const LIFT_MS = 720
/** The step between the result card's cards: card `i` waits `i × CARD_STAGGER_MS`. */
export const CARD_STAGGER_MS = 60
/**
 * The step between cards dealt around the table: card `i` of the seat `k`-th from the button waits `(i × n + k) × this` —
 * at most; a deal of many cards takes a shorter one (`dealStaggerMs`).
 */
export const DEAL_STAGGER_MS = 120
/**
 * The longest a deal may take, from the first card leaving the deck to the last (ruling 26): the hand's timer
 * is already running, so eight seats of three cards at the full step — 2.8 s — would eat into a 10 s decision.
 */
export const DEAL_SPAN_MS = 1000
/** The step between the flop's three cards. */
export const BOARD_STAGGER_MS = 300
/** The step between one seat's cards at the showdown. */
export const SHOWDOWN_STAGGER_MS = 200
/**
 * How long after its arrival a card still counts as dealt (pre-flight 2026-10-09): a card that mounts later in the hand —
 * a layout switch, a remount — was already on the table and comes out of no deck.
 */
export const DEAL_WINDOW_MS = 1500

/** A showdown this close behind the latest board card came in the same batch. */
const WITH_THE_BOARD_MS = 1000

/**
 * Whether the hand's `SHOWDOWN` came together with a board card (pre-flight 2026-10-09): the engine settles in the
 * `ADVANCE` that deals the river, so the river's `COMMUNITY_REVEALED` and the `SHOWDOWN` land in one batch on every Blind
 * hand and every Hold'em run-out. The opponents' cards then lift only once the river has slid in and turned
 * (`DEAL_MS + FLIP_MS`, spec 2026-10-08 §1, §4.1.3), and `useRevealHold` holds the result card that much longer.
 * Never for a hand rebuilt from a snapshot, which has no stamps.
 */
export const showdownWithBoard = (hand: ClientHand | null): boolean =>
  hand !== null && hand.showdownAt !== null && hand.boardAt !== null && hand.showdownAt - hand.boardAt < WITH_THE_BOARD_MS

/**
 * The step between the hole cards of a deal of `totalCards` cards round the table (seats dealt in × cards each):
 * `DEAL_STAGGER_MS`, or less when that would have the last card leave the deck more than `DEAL_SPAN_MS` after the first.
 * A single card (or none) has no step.
 */
export function dealStaggerMs(totalCards: number): number {
  if (totalCards <= 1) return 0
  return Math.min(DEAL_STAGGER_MS, Math.floor(DEAL_SPAN_MS / (totalCards - 1)))
}

/** The hand's seats in the order a dealer deals to them: clockwise (seat numbers up), from the first after the button. */
export function dealOrderOf(hand: ClientHand | null): number[] {
  if (hand === null) return []
  const seats = hand.seats.map((hs) => hs.seat).sort((a, b) => a - b)
  const first = seats.findIndex((seat) => seat > hand.button)
  return first <= 0 ? seats : [...seats.slice(first), ...seats.slice(0, first)]
}
