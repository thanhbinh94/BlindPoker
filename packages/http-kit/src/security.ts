import type { FastifyInstance } from 'fastify'
import { HttpError } from './http-errors.js'

export interface SecurityHeadersOptions {
  /** The `Content-Security-Policy` value; `DEFAULT_CSP` unless an edition needs more sources. */
  csp: string
  /** Path prefixes answered with `cache-control: no-store` — the dynamic half of the surface. */
  noStorePrefixes?: string[]
}

/**
 * `connect-src 'self'` alone covers the WebSocket too: a `ws://`/`wss://` URL on the page's own
 * origin matches `'self'` in CSP 3, which every browser this targets implements. The four directives
 * after it close what `default-src` does not reach — framing, `<base href>`, form posts and plugins.
 */
export const DEFAULT_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

/** The header value a mutating request must carry; see `registerCsrfGuard`. */
export const REQUESTED_WITH = 'bind-poker'

const DEFAULT_NO_STORE_PREFIXES = ['/api', '/health']

function isNoStore(url: string, prefixes: string[]): boolean {
  const path = url.split('?')[0] ?? ''
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/**
 * The response headers that must be on *every* reply, hooked on `onRequest` so they are present on
 * error and 404 responses too, not just on handled routes.
 */
export function registerSecurityHeaders(app: FastifyInstance, opts: Partial<SecurityHeadersOptions> = {}): void {
  const csp = opts.csp ?? DEFAULT_CSP
  const noStorePrefixes = opts.noStorePrefixes ?? DEFAULT_NO_STORE_PREFIXES
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff')
    reply.header('referrer-policy', 'no-referrer')
    reply.header('content-security-policy', csp)
    // `frame-ancestors` already says this, but it is CSP 3: the legacy header covers the browsers
    // (and the embedded webviews on a LAN kiosk) that only understand X-Frame-Options.
    reply.header('x-frame-options', 'DENY')
    if (isNoStore(req.url, noStorePrefixes)) reply.header('cache-control', 'no-store')
  })
}

/**
 * CSRF guard (spec §19): a mutating request must carry `X-Requested-With: bind-poker`. Only
 * fetch/XHR can set a custom header, and doing so on a cross-origin request forces a preflight
 * that this server never answers — so a form or an image tag on another site cannot reach these.
 */
export function registerCsrfGuard(app: FastifyInstance): void {
  app.addHook('preHandler', async (req) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'PATCH' && req.method !== 'DELETE') return
    if (req.headers['x-requested-with'] !== REQUESTED_WITH) {
      throw new HttpError(403, 'FORBIDDEN', `mutating requests require the X-Requested-With: ${REQUESTED_WITH} header`)
    }
  })
}
