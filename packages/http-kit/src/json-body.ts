import type { FastifyInstance } from 'fastify'

/**
 * Many mutating routes take their input from headers or the URL, so a `POST` that announces
 * `application/json` and then sends nothing is a normal request — but Fastify's stock parser
 * answers an empty body with `FST_ERR_CTP_EMPTY_JSON_BODY` (400). Treat it as "no body" instead,
 * and keep the 400 for a body that is present but malformed.
 */
export function registerTolerantJsonParser(app: FastifyInstance): void {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = typeof body === 'string' ? body.trim() : ''
    if (text === '') return done(null, undefined)
    try {
      done(null, JSON.parse(text) as unknown)
    } catch (err) {
      const failure = err instanceof Error ? err : new Error(String(err))
      ;(failure as Error & { statusCode?: number }).statusCode = 400
      done(failure, undefined)
    }
  })
}
