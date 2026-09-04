import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { registerErrorHandler } from './http-errors.js'
import { registerTolerantJsonParser } from './json-body.js'

const apps: FastifyInstance[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

function makeApp(): FastifyInstance {
  const app = Fastify({ logger: false })
  registerTolerantJsonParser(app)
  registerErrorHandler(app, { error: () => {} })
  app.post('/echo', async (req) => ({ body: req.body ?? null }))
  apps.push(app)
  return app
}

const JSON_TYPE = { 'content-type': 'application/json' }

describe('registerTolerantJsonParser', () => {
  it('treats an empty body that declares JSON as no body at all', async () => {
    const app = makeApp()
    for (const payload of ['', '   ', '\n']) {
      const res = await app.inject({ method: 'POST', url: '/echo', headers: JSON_TYPE, payload })
      expect(res.statusCode, JSON.stringify(payload)).toBe(200)
      expect(res.json()).toEqual({ body: null })
    }
  })

  it('parses a real body', async () => {
    const res = await makeApp().inject({ method: 'POST', url: '/echo', headers: JSON_TYPE, payload: '{"displayName":"Alice"}' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ body: { displayName: 'Alice' } })
  })

  it('still rejects a malformed body with 400', async () => {
    const res = await makeApp().inject({ method: 'POST', url: '/echo', headers: JSON_TYPE, payload: '{"displayName": ' })
    expect(res.statusCode).toBe(400)
    expect((res.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST')
  })
})
