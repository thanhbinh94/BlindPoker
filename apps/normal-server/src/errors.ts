/**
 * A refusal a service makes on purpose, carrying the machine-readable code the HTTP layer turns
 * into `{ error: { code, message } }` (spec §19).
 *
 * The distinction that matters is against a bare `Error`: anything else escaping a service is a
 * bug or a database fault, and Task 6's error handler answers those with a 500 and no detail. A
 * `ServiceError` is the opposite — a fully considered "no" whose code is part of the API.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'ServiceError'
  }
}
