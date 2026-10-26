import type { HandSummary } from '@bp/server-kit'

/**
 * A hand of a Poker hỗn loạn table: Blind with a card cycle (`blind.chaosCycle`). Its results are bent by cards, so it
 * counts as a hand played but neither as a win nor as a streak or a record (`patchForHand`), and it earns the reputation of
 * playing and not of winning (`paySeat`). Hold'em has no chaos option.
 */
export function isChaosHand(summary: Pick<HandSummary, 'mode' | 'config'>): boolean {
  return summary.mode === 'blind' && summary.config.blind?.chaosCycle !== undefined
}
