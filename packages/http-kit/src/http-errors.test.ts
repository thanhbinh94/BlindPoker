import Fastify, { type FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it } from 'vitest'
import { FASTIFY_CODES, HttpError, registerErrorHandler } from './http-errors.js'
import { registerTolerantJsonParser } from './json-body.js'

const apps: FastifyInstance[] = []
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close()
})

interface Logged {
  msg: string
  data?: object
}

function makeApp(): { app: FastifyInstance; logged: Logged[] } {
  const logged: Logged[] = []
  const app = Fastify({ logger: false, bodyLimit: 128 })
  registerTolerantJsonParser(app)
  registerErrorHandler(app, { error: (msg, data) => logged.push({ msg, ...(data ? { data } : {}) }) })
  app.get('/boom', async () => {
    throw new Error('the database is on fire')
  })
  app.get('/refused', async () => {
    throw new HttpError(409, 'NOT_ELIGIBLE', 'relief is still on cooldown', { granted: false, retryAt: 42 })
  })
  app.post('/echo', async (req) => req.body ?? { empty: true })
  apps.push(app)
  return { app, logged }
}

describe('registerErrorHandler', () => {
  it('answers an HttpError with its own status, code and extra fields', async () => {
    const { app } = makeApp()
    const res = await app.inject('/refused')
    expect(res.statusCode).toBe(409)
    expect(res.json()).toEqual({ granted: false, retryAt: 42, error: { code: 'NOT_ELIGIBLE', message: 'relief is still on cooldown' } })
  })

  it('hides an unexpected failure behind INTERNAL and logs it in full', async () => {
    const { app, logged } = makeApp()
    const res = await app.inject('/boom')
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'internal server error' } })
    expect(res.body).not.toContain('on fire')
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ msg: 'request failed', data: { method: 'GET', url: '/boom' } })
    expect(String((logged[0]?.data as { err: string }).err)).toContain('on fire')
  })

  it('gives Fastify’s own 4xx a stable code and keeps its status', async () => {
    const { app, logged } = makeApp()
    const malformed = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: '{"a": ' })
    expect(malformed.statusCode).toBe(400)
    expect((malformed.json() as { error: { code: string } }).error.code).toBe('BAD_REQUEST')

    const tooBig = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ a: 'x'.repeat(500) }) })
    expect(tooBig.statusCode).toBe(413)
    expect((tooBig.json() as { error: { code: string } }).error.code).toBe('PAYLOAD_TOO_LARGE')

    const wrongType = await app.inject({ method: 'POST', url: '/echo', headers: { 'content-type': 'application/xml' }, payload: '<hello/>' })
    expect(wrongType.statusCode).toBe(415)
    expect((wrongType.json() as { error: { code: string } }).error.code).toBe('UNSUPPORTED_MEDIA_TYPE')

    // Nothing a client sent is a server failure, so none of the three is logged.
    expect(logged).toEqual([])
  })

  it('answers an unknown route with the same envelope', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'DELETE', url: '/nowhere' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'NOT_FOUND', message: 'no route for DELETE /nowhere' } })
  })

  it('maps the statuses Fastify raises before a handler runs', () => {
    expect(FASTIFY_CODES).toEqual({ 400: 'BAD_REQUEST', 404: 'NOT_FOUND', 413: 'PAYLOAD_TOO_LARGE', 415: 'UNSUPPORTED_MEDIA_TYPE', 429: 'RATE_LIMITED' })
  })
})

describe('HttpError', () => {
  it('is an Error carrying the response it asks for', () => {
    const err = new HttpError(401, 'UNAUTHENTICATED', 'a valid session token is required')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HttpError')
    expect(err.status).toBe(401)
    expect(err.code).toBe('UNAUTHENTICATED')
    expect(err.message).toBe('a valid session token is required')
    expect(err.extra).toBeUndefined()
  })
})
