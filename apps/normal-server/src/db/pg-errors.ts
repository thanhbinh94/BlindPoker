/**
 * Reading a Postgres error back out of what drizzle throws — and making sure nothing else escapes.
 *
 * A unique-index collision is how "that email already has an account" and "that name is taken" are
 * *decided* — checking with a `SELECT` first would leave a window in which another request takes the
 * same value between the check and the insert. The database is the only arbiter that has no such
 * window, so the code has to be able to tell one of its refusals from another.
 *
 * That is harder than reading `err.code`, because drizzle wraps the driver's error in a `Failed
 * query: … params: …` of its own, and `pg` and PGlite attach the SQLSTATE and the constraint name in
 * different places. Which is also the reason for the second half of this file: that wrapper's message
 * embeds the *parameters* of the failed statement, and for a registration those are the email address
 * and the argon2 hash. An unexpected driver error must therefore never reach a log verbatim.
 */

/** SQLSTATE 23505: unique_violation. */
const UNIQUE_VIOLATION = '23505'

/** Five characters, digits and capitals: what a SQLSTATE looks like and a Node `ERR_*` code does not. */
const SQLSTATE = /^[0-9A-Z]{5}$/

/** Drizzle's wrapper puts the failed statement's parameters in its message under this marker. */
const PARAMS_MARKER = 'params:'

function chain(err: unknown): Error[] {
  const links: Error[] = []
  for (let e: unknown = err; e instanceof Error; e = (e as { cause?: unknown }).cause) links.push(e)
  return links
}

/**
 * The SQLSTATE of a database error, from anywhere in the `cause` chain.
 *
 * Shape-checked rather than taken from the first `code` found: drizzle's wrapper, a pool error or a
 * Node system error can each carry a `code` of its own, and the outermost one winning would mask the
 * driver's answer underneath it.
 */
export function sqlstate(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const code = (e as { code?: unknown }).code
    if (typeof code === 'string' && SQLSTATE.test(code)) return code
  }
  return undefined
}

/** The constraint the database named, when it named one. */
export function constraintOf(err: unknown): string | undefined {
  for (const e of chain(err)) {
    const name = (e as { constraint?: unknown }).constraint
    if (typeof name === 'string') return name
  }
  return undefined
}

/**
 * Did this error come from the database, and does it therefore carry the statement's parameters?
 *
 * A SQLSTATE says yes outright. The marker catches the rest: drizzle wraps *whatever* the driver
 * threw, so a connection reset mid-statement arrives as a `Failed query: … params: …` with no
 * SQLSTATE at all — and its parameters are just as sensitive as a constraint violation's.
 */
export function isDatabaseFault(err: unknown): boolean {
  return sqlstate(err) !== undefined || chain(err).some((e) => e.message.includes(PARAMS_MARKER))
}

/**
 * What a database fault is allowed to say out loud: the operation, the SQLSTATE, the constraint.
 *
 * The driver's message is dropped rather than nested under `cause`, because the whole point is that
 * nothing which stringifies this error — `String(err)`, a JSON log line, a serializer that walks
 * `cause` — can reach the parameters. The original is kept on a non-enumerable property for a
 * debugger attached to the process, which is the only reader that should have it.
 */
export class DatabaseFaultError extends Error {
  readonly sqlstate: string | undefined
  readonly constraint: string | undefined

  constructor(operation: string, err: unknown) {
    const code = sqlstate(err)
    const name = constraintOf(err)
    const detail = [code === undefined ? undefined : `sqlstate ${code}`, name === undefined ? undefined : `constraint ${name}`]
      .filter((part): part is string => part !== undefined)
      .join(', ')
    super(`${operation} failed${detail === '' ? '' : ` (${detail})`}`)
    this.name = 'DatabaseFaultError'
    this.sqlstate = code
    this.constraint = name
    Object.defineProperty(this, 'driverError', { value: err, enumerable: false, writable: false })
  }
}

/**
 * Sanitizes an error on its way out of a query, and leaves everything else exactly as it is.
 *
 * Only database faults are rewritten: a `TypeError` from this server's own code inside a transaction
 * carries no credentials and every word of it is worth keeping.
 */
export function sanitizeDbError(operation: string, err: unknown): unknown {
  return isDatabaseFault(err) ? new DatabaseFaultError(operation, err) : err
}

/**
 * Was this a collision on `constraint`?
 *
 * Every link of the chain is inspected for the SQLSTATE rather than just the outermost: a wrapper
 * carrying a `code` of its own would otherwise mask the driver's `23505` and turn a name collision
 * into a 500.
 *
 * And where the driver names the constraint outright, that name decides. The message scan is a
 * fallback for a driver that named nothing — it has to be, because drizzle's message embeds the
 * query's *parameters*, so a player who tried to call themselves `players_name_key_unique`, or to
 * register as `users_email_unique@example.com`, could otherwise talk the scan into agreeing and
 * choose which of the two 409s their collision was reported as.
 */
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  const links = chain(err)
  if (!links.some((e) => (e as { code?: unknown }).code === UNIQUE_VIOLATION)) return false
  const named = constraintOf(err)
  if (named !== undefined) return named === constraint
  return links.some((e) => e.message.includes(constraint))
}

/** How far `describeError` follows `errors[]` and `cause` before it stops. Guards a cycle, too. */
export const DESCRIBE_MAX_DEPTH = 3

/**
 * An error rendered for a human reading stderr, with the shapes a startup failure actually takes
 * spelled out.
 *
 * `Error.message` alone is not enough here, in two different ways, and the Normal server's two
 * entry points hit both:
 *
 * - When a host resolves to several addresses — and `localhost` on a dual-stack machine always does
 *   — `pg` tries each and throws an **`AggregateError` whose own `message` is the empty string**, so
 *   `console.error(err.message)` on an unreachable `DATABASE_URL` printed a blank line and exited 1.
 *   The operator's whole diagnosis was "it failed".
 * - Against a single address, the refusal arrives wrapped in **drizzle's `Failed query: …`**, whose
 *   message names the statement and not the fault; `ECONNREFUSED` is on the `cause` underneath.
 *
 * So: the message, plus the `code` the driver attached (`ECONNREFUSED`, `ENOTFOUND`, `28P01`) which
 * is very often the entire answer, then each of an `AggregateError`'s `errors[]` — or the `cause` —
 * indented beneath it.
 *
 * Only for the two `main`/`migrate-cli` catch handlers, where the failure is a configuration error,
 * a connection, or a migration: statements with no caller-supplied parameters. Anything thrown by a
 * *request* is sanitized by `sanitizeDbError` long before it can reach a log, and the
 * `DatabaseFaultError` that produces deliberately keeps its driver error off `cause`, so walking the
 * chain here cannot reach one.
 */
export function describeError(err: unknown, depth = 0): string {
  if (!(err instanceof Error)) return String(err)

  const code = (err as { code?: unknown }).code
  const suffix = typeof code === 'string' && code !== '' && !err.message.includes(code) ? ` (${code})` : ''
  const head = err.message === '' ? `${err.name}: every connection attempt failed` : `${err.message}${suffix}`
  if (depth >= DESCRIBE_MAX_DEPTH) return head

  const indent = '  '.repeat(depth + 1)
  if (err instanceof AggregateError && err.errors.length > 0) {
    return [head, ...err.errors.map((e: unknown) => `${indent}- ${describeError(e, depth + 1)}`)].join('\n')
  }
  const cause = (err as { cause?: unknown }).cause
  return cause === undefined || cause === null ? head : `${head}\n${indent}caused by: ${describeError(cause, depth + 1)}`
}
