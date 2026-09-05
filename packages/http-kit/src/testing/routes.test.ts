import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { enumerateRoutes, mutatingApiRoutes } from './routes.js'

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

  it('finds the mutating API surface and nothing else', async () => {
    const routes = await app().then(mutatingApiRoutes)
    expect(routes.map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'DELETE /api/me/thing',
      'PATCH /api/me',
      'POST /api/session',
      'PUT /api/me/avatar',
    ])
  })

  /**
   * The static fallback answers `/*` for every method there is, `DELETE` included. It is a file
   * server, not a mutation, and folding it into the mutating set would make every guard test assert
   * that a 404 on a missing image is rate limited.
   */
  it('leaves the static wildcard out of the mutating set', async () => {
    const instance = await app()
    expect(enumerateRoutes(instance).some((r) => r.path === '*')).toBe(true)
    expect(mutatingApiRoutes(instance).some((r) => r.path === '*')).toBe(false)
  })
})
