import type { FastifyInstance, FastifyReply } from 'fastify'
import type { AssetSource } from './assets.js'
import { notFoundEnvelope } from './http-errors.js'

/** A content-hashed file name changes with its content, so the old one may be cached forever. */
const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'

/** The server's own surface: the API, the socket and the health probe are never the index page. */
export const DEFAULT_RESERVED = ['api', 'ws', 'health']

export interface StaticRouteOptions {
  /**
   * First path segments the SPA fallback must never answer — `DEFAULT_RESERVED` unless an edition
   * mounts more. A typo under one of them is a 404, not the index page.
   *
   * Entries are matched as single path segments and may be written either way: `'api'` and `'/api/'`
   * mean the same thing, so this reads the same as `noStorePrefixes` next door. Only the first
   * segment is compared, so a multi-segment entry (`'api/v1'`) never matches — name `'api'`.
   */
  reserved?: string[]
  /** `cache-control` for content-hashed assets. */
  immutableCache?: string
}

/** `'/api/'` → `'api'`: what a caller writes, reduced to the segment the route compares. */
const toSegment = (entry: string): string => entry.replace(/^\/+/, '').replace(/\/+$/, '')

/**
 * The `/*` catch-all that serves a single-page app out of `assets`.
 *
 * Register it after every real route: it matches everything the others did not claim. A miss on a
 * path that looks like a file (it has an extension) stays a miss; a miss on an extension-less path
 * is a client route, so it gets `index.html` and the app boots and routes on its own.
 *
 * `assets` may be `null` — an API-only deployment with no UI bundle — in which case every path
 * under this route is the same JSON 404.
 */
export function registerStaticRoute(app: FastifyInstance, assets: AssetSource | null, opts: StaticRouteOptions = {}): void {
  const reserved = (opts.reserved ?? DEFAULT_RESERVED).map(toSegment)
  const immutableCache = opts.immutableCache ?? IMMUTABLE_CACHE

  app.get('/*', async (req, reply) => {
    const requested = (req.params as { '*'?: string })['*'] ?? ''
    const notFound = (): FastifyReply => reply.code(404).send(notFoundEnvelope(req.method, req.url))
    if (!assets) return notFound()

    const first = requested.split('/')[0] ?? ''
    if (reserved.includes(first)) return notFound()

    const direct = requested === '' ? null : assets.get(requested)
    if (direct) {
      // Only content-hashed names may be cached: everything else (index.html, favicon.ico) keeps
      // its name when the build is replaced, so it has to be revalidated on every load.
      reply.header('cache-control', direct.immutable ? immutableCache : 'no-cache')
      return reply.type(direct.type).send(direct.body)
    }

    // SPA fallback: the client routes on the hash, but a hand-typed `/lobby` must still boot the app.
    // A path with a file extension is a real asset request, so a miss there stays a miss.
    const base = requested.slice(requested.lastIndexOf('/') + 1)
    if (base.includes('.')) return notFound()

    const index = assets.get('index.html')
    if (!index) return notFound()
    reply.header('cache-control', 'no-cache')
    return reply.type(index.type).send(index.body)
  })
}
