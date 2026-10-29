/**
 * The lifetime counters of spec §10.3, and nothing else.
 *
 * `PlayerStats` is *exactly* the nineteen numeric metrics, with no `playerId` and no `updatedAt`,
 * because `keyof PlayerStats` is a type an achievement definition is written against
 * (`AchievementDef.metric`, §14.1). Widening it with a bookkeeping field would make
 * `{ metric: 'updatedAt' }` a well-typed achievement, which it is not.
 *
 * The names are the camelCase forms of the `player_stats` columns — the same identifiers drizzle's
 * schema uses — so one name travels unchanged from the column to the JSON of `achievements.json`
 * and out to `GET /api/me/stats`.
 */

export interface PlayerStats {
  handsPlayedHoldem: number
  handsWonHoldem: number
  handsPlayedBlind: number
  handsWonBlind: number
  botHands: number
  currentWinStreak: number
  bestWinStreak: number
  currentLoseStreak: number
  bestLoseStreak: number
  /** The best `HandCategory` rank ever *won* with; 0 until the first showdown that took a pot. */
  bestHandRank: number
  /** The largest net gain from a single hand. */
  biggestWin: number
  roomsJoined: number
  gamesCompleted: number
  totalLoginDays: number
  loginStreak: number
  bestLoginStreak: number
  /** BP-41 (spec 2026-10-28 §4.4): times this player became the Thần Bài, at a table of two or more humans. */
  chaosAscensions: number
  /** BP-41: times this player became a Bán Thần, at a table of two or more humans. */
  chaosDemigods: number
  /** BP-41: hands this player won against a human Thần, at a table of two or more humans. */
  chaosGodsSlain: number
}

export type StatMetric = keyof PlayerStats

/**
 * Every metric name, as data.
 *
 * `keyof` does not survive to run time, and `loadAchievements` has to reject a JSON file that names
 * a metric no counter exists for — a typo there would otherwise be an achievement that silently
 * never unlocks. The `satisfies` keeps this list and the interface from drifting apart: adding a
 * field to `PlayerStats` without adding it here is a type error, and vice versa.
 */
export const STAT_METRICS = [
  'handsPlayedHoldem',
  'handsWonHoldem',
  'handsPlayedBlind',
  'handsWonBlind',
  'botHands',
  'currentWinStreak',
  'bestWinStreak',
  'currentLoseStreak',
  'bestLoseStreak',
  'bestHandRank',
  'biggestWin',
  'roomsJoined',
  'gamesCompleted',
  'totalLoginDays',
  'loginStreak',
  'bestLoginStreak',
  'chaosAscensions',
  'chaosDemigods',
  'chaosGodsSlain',
] as const satisfies readonly StatMetric[]

const METRICS = new Set<string>(STAT_METRICS)

export function isStatMetric(value: string): value is StatMetric {
  return METRICS.has(value)
}

/**
 * What a player who has done nothing looks like. Also what `get()` answers for a player with no
 * `player_stats` row: "no row" and "all zeroes" describe the same player, and a caller that had to
 * tell them apart would have nothing useful to do with the difference.
 */
export function zeroStats(): PlayerStats {
  return {
    handsPlayedHoldem: 0,
    handsWonHoldem: 0,
    handsPlayedBlind: 0,
    handsWonBlind: 0,
    botHands: 0,
    currentWinStreak: 0,
    bestWinStreak: 0,
    currentLoseStreak: 0,
    bestLoseStreak: 0,
    bestHandRank: 0,
    biggestWin: 0,
    roomsJoined: 0,
    gamesCompleted: 0,
    totalLoginDays: 0,
    loginStreak: 0,
    bestLoginStreak: 0,
    chaosAscensions: 0,
    chaosDemigods: 0,
    chaosGodsSlain: 0,
  }
}
