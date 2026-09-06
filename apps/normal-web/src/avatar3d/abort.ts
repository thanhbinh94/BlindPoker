/**
 * The one vocabulary for a portrait that was asked for and then no longer wanted.
 *
 * It lives in its own module, and a three-free one, because both ends of the pipeline need it: the
 * render queue (inside the lazy three.js chunk) raises it, and `usePortrait` (in the entry chunk) has
 * to recognise it without importing a byte of three.
 *
 * A cancellation is **not** a failure. `usePortrait` turns every real failure into `unsupported` — the
 * initial letter, for good, plus a warning. A cancelled render means only that the tile scrolled away
 * or the player clicked a different hair colour before its turn in the queue came up, and the right
 * answer to that is silence.
 */

/** The rejection a dropped render produces — the shape `fetch` uses, so it reads the same everywhere. */
export function abortError(reason = 'the portrait render was cancelled'): Error {
  if (typeof DOMException === 'function') return new DOMException(reason, 'AbortError')
  const error = new Error(reason)
  error.name = 'AbortError'
  return error
}

/**
 * Whether a rejection is a cancellation.
 *
 * `instanceof` is deliberately not used: a `DOMException` is not an `Error` in every engine, and the
 * signal may have been aborted by a caller with its own reason. The name is the contract.
 */
export function isAbortError(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { name?: unknown }).name === 'AbortError'
}
