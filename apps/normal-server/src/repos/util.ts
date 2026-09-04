/**
 * The two predicates every repository leans on. Both exist because the values they guard arrive from
 * a query string one layer up, where `Number('abc')` is `NaN` and a player id is whatever was typed.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `players.id` and `game_players.player_id` are `uuid` columns, so a malformed id would come back as
 * a raw `22P02` from the driver — the same failure as "no such player", dressed as a syntax error.
 * Callers check first and answer with `null`, `[]`, or a typed `UnknownPlayerError` instead.
 */
export function isUuid(id: string): boolean {
  return UUID.test(id)
}

/**
 * A page size that is safe to hand to `LIMIT`.
 *
 * Anything that is not a finite number falls back to `def` rather than being clamped: `Math.min(Math.max(NaN, 1), max)`
 * is still `NaN`, which reaches the driver as `invalid input syntax for type bigint` — a 500 where the
 * caller asked for a page. `Infinity` clamps to `max` on its own, but only because `Math.min` catches
 * it; folding both to the default keeps "the caller sent nonsense" one answer instead of two.
 * Fractions are truncated for the same reason: `LIMIT 2.5` is not a query.
 */
export function clampLimit(value: number | undefined, def: number, max: number): number {
  if (value === undefined || !Number.isFinite(value)) return def
  return Math.min(Math.max(Math.trunc(value), 1), max)
}

/** A cursor that is safe to compare against a `bigserial`; anything non-finite means "no cursor". */
export function cursorOf(value: number | undefined): number | undefined {
  return value !== undefined && Number.isFinite(value) ? Math.trunc(value) : undefined
}
