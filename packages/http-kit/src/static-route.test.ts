import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import type { Asset, AssetSource } from './assets.js'
import { DEFAULT_RESERVED, registerStaticRoute } from './static-route.js'

const apps: FastifyInstance[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

const FILES: Record<string, Asset> = {
  'index.html': { body: Buffer.from('<div id="root"></div>'), type: 'text/html; charset=utf-8', immutable: false },
  'assets/app-abc123.js': { body: Buffer.from('console.log(1)'), type: 'text/javascript; charset=utf-8', immutable: true },
  'favicon.ico': { body: Buffer.from('icon'), type: 'image/x-icon', immutable: false },
}

/** An in-memory `AssetSource` with the same key normalisation the real ones apply. */
function fakeAssets(files: Record<string, Asset> = FILES): AssetSource {
  const get = (path: string): Asset | null => files[path.replace(/^\/+/, '')] ?? null
  return { get, has: (path) => get(path) !== null }
}

function makeApp(assets: AssetSource | null, opts?: Parameters<typeof registerStaticRoute>[2]): FastifyInstance {
  const app = Fastify({ logger: false })
  app.get('/api/config', async () => ({ ok: true }))
  registerStaticRoute(app, assets, opts)
  apps.push(app)
  return app
}

describe('registerStaticRoute', () => {
  it('serves index.html at the root, revalidated', async () => {
    const res = await makeApp(fakeAssets()).inject('/')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toContain('<div id="root">')
  })

  it('caches hashed build output forever and revalidates everything else', async () => {
    const app = makeApp(fakeAssets())
    const hashed = await app.inject('/assets/app-abc123.js')
    expect(hashed.statusCode).toBe(200)
    expect(hashed.headers['content-type']).toBe('text/javascript; charset=utf-8')
    expect(hashed.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect((await app.inject('/favicon.ico')).headers['cache-control']).toBe('no-cache')
  })

  it('takes the immutable cache-control from the options', async () => {
    const res = await makeApp(fakeAssets(), { immutableCache: 'public, max-age=60' }).inject('/assets/app-abc123.js')
    expect(res.headers['cache-control']).toBe('public, max-age=60')
  })

  it('falls back to index.html for extension-less client routes', async () => {
    const app = makeApp(fakeAssets())
    for (const url of ['/lobby', '/room/42', '/settings']) {
      const res = await app.inject(url)
      expect(res.statusCode, url).toBe(200)
      expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    }
  })

  it('404s a missing path that looks like a file, with the same envelope a missing route gets', async () => {
    const res = await makeApp(fakeAssets()).inject('/missing.png')
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'no route for GET /missing.png' } })
  })

  it('never falls back under a reserved prefix', async () => {
    const app = makeApp(fakeAssets(), { reserved: ['api', 'ws', 'health'] })
    for (const url of ['/api/unknown', '/ws', '/health/extra']) {
      const res = await app.inject(url)
      expect(res.statusCode, url).toBe(404)
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  it('reserves the same segments whether they are written with a leading slash or without', async () => {
    // The neighbouring `noStorePrefixes` option is spelled '/api', so both spellings must work here
    // — a `reserved` entry that silently never matches would hand `/api/typo` the index page.
    for (const reserved of [['api'], ['/api'], ['/api/']]) {
      const app = makeApp(fakeAssets(), { reserved })
      const res = await app.inject('/api/typo')
      expect(res.statusCode, JSON.stringify(reserved)).toBe(404)
      expect((res.json() as { error: { code: string } }).error.code).toBe('NOT_FOUND')
    }
  })

  it('reserves the server’s own surface by default', async () => {
    expect(DEFAULT_RESERVED).toEqual(['api', 'ws', 'health'])
    const app = makeApp(fakeAssets())
    for (const url of ['/api/typo', '/ws', '/health/ready']) {
      expect((await app.inject(url)).statusCode, url).toBe(404)
    }
    // An unreserved client route still boots the app.
    expect((await app.inject('/lobby')).statusCode).toBe(200)
  })

  it('leaves the routes registered before it alone', async () => {
    const res = await makeApp(fakeAssets(), { reserved: ['api'] }).inject('/api/config')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('404s a traversal rather than serving the SPA for it', async () => {
    const res = await makeApp(fakeAssets()).inject('/..%2Findex.html')
    expect(res.statusCode).toBe(404)
  })

  it('404s everything when there is no asset source', async () => {
    const app = makeApp(null)
    for (const url of ['/', '/lobby', '/index.html']) {
      expect((await app.inject(url)).statusCode, url).toBe(404)
    }
  })

  it('404s a client route when the bundle has no index.html', async () => {
    const res = await makeApp(fakeAssets({ 'favicon.ico': FILES['favicon.ico']! })).inject('/lobby')
    expect(res.statusCode).toBe(404)
  })
})
