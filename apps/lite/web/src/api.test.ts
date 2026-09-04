import { describe, expect, it, vi } from 'vitest'
import { ApiError, REQUESTED_WITH, createApi } from './api.js'

/** A `Response` stand-in: jsdom has no fetch, so the tests never touch the real one. */
function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response
}

function textResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.reject(new SyntaxError('Unexpected token < in JSON')),
  } as unknown as Response
}

const init = (mock: ReturnType<typeof vi.fn>): RequestInit => (mock.mock.calls[0]?.[1] ?? {}) as RequestInit
const headers = (mock: ReturnType<typeof vi.fn>): Record<string, string> => (init(mock).headers ?? {}) as Record<string, string>

describe('createApi', () => {
  it('GETs the config without an Authorization header', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { edition: 'lite', wsPath: '/ws', languages: ['vi', 'en'] }))
    const api = createApi(fetchImpl as unknown as typeof fetch)

    const config = await api.config()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/config')
    expect(init(fetchImpl).method).toBe('GET')
    expect(headers(fetchImpl).authorization).toBeUndefined()
    expect(headers(fetchImpl)['x-requested-with']).toBeUndefined()
    expect(config.wsPath).toBe('/ws')
  })

  it('prefixes every path with the base', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}))
    await createApi(fetchImpl as unknown as typeof fetch, 'http://127.0.0.1:8080').config()

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('http://127.0.0.1:8080/api/config')
  })

  it('POSTs a session with the CSRF header and a JSON body', async () => {
    const dto = { playerId: 'p1', displayName: 'Bình', token: 'tok', balance: 10000 }
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(201, dto))

    const session = await createApi(fetchImpl as unknown as typeof fetch).createSession('Bình')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/session')
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(headers(fetchImpl)['content-type']).toBe('application/json')
    expect(init(fetchImpl).body).toBe(JSON.stringify({ displayName: 'Bình' }))
    expect(session).toEqual(dto)
  })

  it('sends the bearer token on authenticated reads', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { playerId: 'p1' }))
    await createApi(fetchImpl as unknown as typeof fetch).me('tok-123')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/me')
    expect(headers(fetchImpl).authorization).toBe('Bearer tok-123')
    expect(init(fetchImpl).method).toBe('GET')
  })

  it('reads the daily status', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { allowed: true, day: 3 }))
    await createApi(fetchImpl as unknown as typeof fetch).daily('tok')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/rewards/daily')
    expect(headers(fetchImpl).authorization).toBe('Bearer tok')
  })

  it('POSTs the daily claim with both headers and no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { claimed: true, points: 1000, streak: 3, balance: 11000 }))
    const claim = await createApi(fetchImpl as unknown as typeof fetch).claimDaily('tok')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/rewards/daily/claim')
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl).authorization).toBe('Bearer tok')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
    expect(init(fetchImpl).body).toBeUndefined()
    expect(claim.points).toBe(1000)
  })

  it('POSTs relief', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { granted: true, amount: 5000, balance: 5000 }))
    await createApi(fetchImpl as unknown as typeof fetch).relief('tok')

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('/api/economy/relief')
    expect(init(fetchImpl).method).toBe('POST')
    expect(headers(fetchImpl)['x-requested-with']).toBe(REQUESTED_WITH)
  })

  it('turns an { error } body into an ApiError carrying status and code', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, { error: { code: 'DISPLAY_NAME_TAKEN', message: 'display name in use' } }))

    const failure = await createApi(fetchImpl as unknown as typeof fetch)
      .createSession('Bình')
      .catch((err: unknown) => err)

    expect(failure).toBeInstanceOf(ApiError)
    const err = failure as ApiError
    expect(err.status).toBe(409)
    expect(err.code).toBe('DISPLAY_NAME_TAKEN')
    expect(err.message).toBe('display name in use')
  })

  it.each([
    [400, 'INVALID_NAME'],
    [429, 'RATE_LIMITED'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
  ])('maps a %i response to code %s', async (status, code) => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(status, { error: { code, message: code } }))

    const err = (await createApi(fetchImpl as unknown as typeof fetch)
      .me('tok')
      .catch((e: unknown) => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(status)
    expect(err.code).toBe(code)
  })

  it('falls back to an HTTP code when the failure body is not JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(textResponse(502))

    const err = (await createApi(fetchImpl as unknown as typeof fetch)
      .config()
      .catch((e: unknown) => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(502)
    expect(err.code).toBe('HTTP_502')
  })

  it('reports an unreachable server as ApiError NETWORK with status 0', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))

    const err = (await createApi(fetchImpl as unknown as typeof fetch)
      .config()
      .catch((e: unknown) => e)) as ApiError

    expect(err).toBeInstanceOf(ApiError)
    expect(err.status).toBe(0)
    expect(err.code).toBe('NETWORK')
  })
})
