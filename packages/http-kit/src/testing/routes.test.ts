import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { enumerateRoutes, mutatingRoutes } from './routes.js'

async function app() {
  const instance = Fastify({ logger: false })
  instance.get('/health', async () => ({ ok: true }))
  instance.get('/api/config', async () => ({}))
  instance.post('/api/session', async () => ({}))
  instance.patch('/api/me', async () => ({}))
  instance.put('/api/me/avatar', async () => ({}))
  instance.delete('/api/me/thing', async () => ({}))
  instance.get('/api/players/:id/avatar', async () => ({}))
  instance.get('/*', async () => ({}))
  await instance.ready()
  return instance
}

describe('enumerateRoutes', () => {
  it('lists one entry per path and method, with the parameter placeholders intact', async () => {
    const routes = await app().then(enumerateRoutes)
    expect(routes).toContainEqual({ path: '/api/players/:id/avatar', method: 'GET' })
    expect(routes).toContainEqual({ path: '/api/me', method: 'PATCH' })
    expect(routes).toContainEqual({ path: '/health', method: 'GET' })
  })

  /**
   * The regression that matters. `commonPrefix: false` does not flatten a path that is a prefix of
   * another: `/api/me/avatar` is printed as `/avatar` indented under `/api/me`, and a parser that
   * reads each line whole loses it — leaving a guard test that passes while saying nothing about
   * the route most in need of a guard.
   */
  it('rebuilds a path nested under a shorter one that is its prefix', async () => {
    const routes = await app().then(enumerateRoutes)
    expect(routes).toContainEqual({ path: '/api/me/avatar', method: 'PUT' })
    expect(routes).toContainEqual({ path: '/api/me/thing', method: 'DELETE' })
    // …and the shorter path is not swallowed by its own children.
    expect(routes).toContainEqual({ path: '/api/me', method: 'PATCH' })
    // …nor does a nested branch leak into the sibling that follows it.
    expect(routes).toContainEqual({ path: '/api/players/:id/avatar', method: 'GET' })
  })

  it('drops HEAD and OPTIONS, which Fastify adds rather than anyone registering them', async () => {
    const routes = await app().then(enumerateRoutes)
    expect(routes.map((r) => r.method)).not.toContain('HEAD')
    expect(routes.map((r) => r.method)).not.toContain('OPTIONS')
    // …and does not lose the GET whose shadow they are.
    expect(routes.filter((r) => r.path === '/api/config')).toEqual([{ path: '/api/config', method: 'GET' }])
  })

  it('finds every mutating route, and no read', async () => {
    const routes = await app().then(mutatingRoutes)
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'DELETE /api/me/thing',
      'PATCH /api/me',
      'POST /api/session',
      'PUT /api/me/avatar',
    ])
  })

  /**
   * The point of not filtering by prefix. Both editions' rate limiter keys on `/api/`, so a
   * mutating route mounted anywhere else would be unmetered — and if this helper filtered the same
   * way, the loop that is supposed to catch that would not even see the route. It has to come back
   * so the caller's exemption list is what answers for it.
   */
  it('returns a mutating route mounted outside /api, rather than hiding it', async () => {
    const instance = Fastify({ logger: false })
    instance.get('/health', async () => ({ ok: true }))
    instance.post('/api/session', async () => ({}))
    instance.post('/upload', async () => ({}))
    await instance.ready()
    expect(mutatingRoutes(instance).map((r) => `${r.method} ${r.path}`).sort()).toEqual(['POST /api/session', 'POST /upload'])
  })

  /**
   * The static fallback is registered as a `GET` in both editions — it is a file server — so it is
   * not in the mutating set to begin with. Folding a wildcard in would make every guard test assert
   * that a 404 on a missing image is rate limited.
   */
  it('leaves the read-only static wildcard out of the mutating set', async () => {
    const instance = await app()
    expect(enumerateRoutes(instance).some((r) => r.path === '*')).toBe(true)
    expect(mutatingRoutes(instance).some((r) => r.path === '*')).toBe(false)
  })
})
