/**
 * Reading a Postgres error back out of what drizzle throws.
 *
 * A unique-index collision is how "that email already has an account" and "that name is taken" are
 * *decided* — checking with a `SELECT` first would leave a window in which another request takes the
 * same value between the check and the insert. The database is the only arbiter that has no such
 * window, so the code has to be able to tell one of its refusals from another.
 *
 * That is harder than reading `err.code`, because drizzle wraps the driver's error in a `Failed
 * query: …` of its own, and `pg` and PGlite word their messages differently and attach the
 * constraint name in different places. Walking the `cause` chain for SQLSTATE `23505` plus the
 * constraint name somewhere in it is what both agree on.
 */

/** SQLSTATE 23505: unique_violation. */
const UNIQUE_VIOLATION = '23505'

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  let code: string | undefined
  const messages: string[] = []
  for (let e: unknown = err; e instanceof Error; e = (e as { cause?: unknown }).cause) {
    messages.push(e.message)
    const c = (e as { code?: unknown }).code
    if (typeof c === 'string') code ??= c
    const name = (e as { constraint?: unknown }).constraint
    if (typeof name === 'string') messages.push(name)
  }
  return code === UNIQUE_VIOLATION && messages.some((m) => m.includes(constraint))
}
