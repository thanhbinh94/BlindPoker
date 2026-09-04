import type { FastifyError, FastifyInstance } from 'fastify'

/** Every REST failure is `{ error: { code, message } }` (spec §19); this is how a handler asks for one. */
export class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly extra?: Record<string, unknown>) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Stable codes for the failures Fastify raises before a handler runs, so clients never see `FST_ERR_*`. */
export const FASTIFY_CODES: Record<number, string> = { 400: 'BAD_REQUEST', 404: 'NOT_FOUND', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED' }

/**
 * Turns every way a request can fail into the one error envelope.
 *
 * `HttpError` carries its own status, code and optional extra fields. Anything else is Fastify's:
 * a 4xx keeps its status and gets a stable code, while a 5xx is logged in full and answered with a
 * fixed `INTERNAL` — an unexpected throw is the one case where the message is ours, not the
 * caller's, and stack details or driver text must not leave the process.
 *
 * The not-found handler comes with it: a route that does not exist is the same envelope, and
 * leaving it to Fastify would answer one class of miss in a different shape from all the others.
 */
export function registerErrorHandler(app: FastifyInstance, log: { error(msg: string, data?: object): void }): void {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ ...(err.extra ?? {}), error: { code: err.code, message: err.message } })
    }
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500
    if (status >= 500) {
      log.error('request failed', { method: req.method, url: req.url, err: String(err) })
      return reply.code(500).send({ error: { code: 'INTERNAL', message: 'internal server error' } })
    }
    // Fastify's own 4xx: unparseable JSON, an oversized body, an unsupported content type.
    return reply.code(status).send({ error: { code: FASTIFY_CODES[status] ?? 'BAD_REQUEST', message: err.message } })
  })

  app.setNotFoundHandler((req, reply) => {
    void reply.code(404).send({ error: { code: 'NOT_FOUND', message: `no route for ${req.method} ${req.url}` } })
  })
}
