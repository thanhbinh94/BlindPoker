import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from './http-errors.js'
import { DEFAULT_CSP, REQUESTED_WITH, registerCsrfGuard, registerSecurityHeaders } from './security.js'

const apps: FastifyInstance[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

const silent = { error: () => {} }

function makeApp(opts?: Parameters<typeof registerSecurityHeaders>[1]): FastifyInstance {
  const app = Fastify({ logger: false })
  registerSecurityHeaders(app, opts)
  registerCsrfGuard(app)
  registerErrorHandler(app, silent)
  app.get('/health', async () => ({ status: 'ok' }))
  app.get('/api/config', async () => ({ ok: true }))
  app.get('/', async (_req, reply) => reply.type('text/html').send('<html></html>'))
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
    app.route({ method, url: '/api/thing', handler: async () => ({ done: true }) })
  }
  apps.push(app)
  return app
}

describe('registerSecurityHeaders', () => {
  it('sets the header set on every response, misses included', async () => {
    const app = makeApp()
    for (const url of ['/health', '/api/config', '/', '/nothing-here']) {
      const res = await app.inject(url)
      expect(res.headers['x-content-type-options'], url).toBe('nosniff')
      expect(res.headers['referrer-policy'], url).toBe('no-referrer')
      expect(res.headers['content-security-policy'], url).toBe(DEFAULT_CSP)
      expect(res.headers['x-frame-options'], url).toBe('DENY')
    }
  })

  it('names every directive the spec §19.3 header list requires, and no ws: scheme source', () => {
    const directives = new Map(DEFAULT_CSP.split('; ').map((d) => [d.split(' ')[0], d]))
    expect(directives.get('default-src')).toBe("default-src 'self'")
    expect(directives.get('connect-src')).toBe("connect-src 'self'")
    expect(directives.get('frame-ancestors')).toBe("frame-ancestors 'none'")
    expect(directives.get('base-uri')).toBe("base-uri 'self'")
    expect(directives.get('form-action')).toBe("form-action 'self'")
    expect(directives.get('object-src')).toBe("object-src 'none'")
    expect(DEFAULT_CSP).not.toContain('ws:')
    expect(DEFAULT_CSP).not.toContain('wss:')
  })

  it('marks the dynamic surface no-store and leaves static responses cacheable', async () => {
    const app = makeApp()
    expect((await app.inject('/health')).headers['cache-control']).toBe('no-store')
    expect((await app.inject('/api/config')).headers['cache-control']).toBe('no-store')
    expect((await app.inject('/api/config?x=1')).headers['cache-control']).toBe('no-store')
    expect((await app.inject('/')).headers['cache-control']).toBeUndefined()
  })

  it('takes the CSP and the no-store prefixes from the options', async () => {
    const app = makeApp({ csp: "default-src 'none'", noStorePrefixes: ['/data'] })
    const res = await app.inject('/health')
    expect(res.headers['content-security-policy']).toBe("default-src 'none'")
    // The default prefixes are replaced, not extended: /health is now cacheable and /data is not.
    expect(res.headers['cache-control']).toBeUndefined()
    expect((await app.inject('/data')).headers['cache-control']).toBe('no-store')
    expect((await app.inject('/data/rows')).headers['cache-control']).toBe('no-store')
    expect((await app.inject('/database')).headers['cache-control']).toBeUndefined()
  })
})

describe('registerCsrfGuard', () => {
  it('lets a mutating request through when it carries the header', async () => {
    const app = makeApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/thing', headers: { 'x-requested-with': REQUESTED_WITH } })
      expect(res.statusCode, method).toBe(200)
    }
  })

  it('refuses a mutating request without it', async () => {
    const app = makeApp()
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      const res = await app.inject({ method, url: '/api/thing' })
      expect(res.statusCode, method).toBe(403)
      expect((res.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
    }
  })

  it('refuses a wrong value, which is what a cross-site form would send', async () => {
    const res = await makeApp().inject({ method: 'POST', url: '/api/thing', headers: { 'x-requested-with': 'XMLHttpRequest' } })
    expect(res.statusCode).toBe(403)
  })

  it('never asks for it on a read', async () => {
    expect((await makeApp().inject('/api/config')).statusCode).toBe(200)
  })
})
