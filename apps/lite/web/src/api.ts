/**
 * The Lite REST client. It mirrors `apps/lite/server/src/http/routes.ts` exactly — same paths, same headers,
 * same failure envelope — and knows nothing else: no retries, no caching, no state.
 */

/** The CSRF token the server demands on every mutating request; only fetch/XHR can set it. */
export const REQUESTED_WITH = 'bind-poker'

/** The code an `ApiError` carries when the request never reached the server at all. */
export const NETWORK_ERROR_CODE = 'NETWORK'

export interface LiteConfigDto {
  edition: string
  wsPath: string
  economy: {
    startingBalance: number
    blindWagerTiers: number[]
    holdemBlindTiers: { smallBlind: number; bigBlind: number }[]
    reliefThreshold: number
    reliefTarget: number
  }
  languages: string[]
}

export interface SessionDto {
  playerId: string
  displayName: string
  token: string
  balance: number
}

/** `GET /api/rewards/daily`, and the `daily` block of `GET /api/me`. */
export interface DailyStatusDto {
  allowed: boolean
  alreadyClaimed: boolean
  day: number
  points: number
  nextDay: number
  nextPoints: number
  streak: number
  lastClaim: string | null
}

/** The server's name for the same shape (`economy/daily.ts`), kept so both halves read alike. */
export type DailyClaimResult = DailyStatusDto

export interface ReliefStatusDto {
  eligible: boolean
  reason: 'ok' | 'balance' | 'cooldown'
  retryAt: number | null
}

export interface MeDto {
  playerId: string
  displayName: string
  balance: number
  stats: { handsPlayed: number; handsWon: number }
  daily: DailyStatusDto
  relief: ReliefStatusDto
}

export interface ClaimDto {
  claimed: true
  points: number
  streak: number
  balance: number
}

export interface ReliefDto {
  granted: true
  amount: number
  balance: number
}

/**
 * Every REST failure, including the ones that never left the browser. `status` is `0` and `code` is
 * `NETWORK` when `fetch` itself rejected — the screens need to tell "the server said no" apart from
 * "there was no server".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export interface LiteApi {
  config(): Promise<LiteConfigDto>
  createSession(displayName: string): Promise<SessionDto>
  me(token: string): Promise<MeDto>
  daily(token: string): Promise<DailyStatusDto>
  claimDaily(token: string): Promise<ClaimDto>
  relief(token: string): Promise<ReliefDto>
}

interface Call {
  method: 'GET' | 'POST'
  path: string
  token?: string
  body?: unknown
}

/** A failure body is `{ error: { code, message } }`; anything else (a proxy's HTML 502) falls back to the status. */
function failure(status: number, payload: unknown, call: Call): ApiError {
  const error = (payload as { error?: { code?: unknown; message?: unknown } } | null)?.error
  const code = typeof error?.code === 'string' ? error.code : `HTTP_${status}`
  const message = typeof error?.message === 'string' ? error.message : `${call.method} ${call.path} failed with ${status}`
  return new ApiError(status, code, message)
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown
  } catch {
    return null
  }
}

export function createApi(fetchImpl?: typeof fetch, base = ''): LiteApi {
  const send = fetchImpl ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init))

  async function call<T>(spec: Call): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (spec.token !== undefined) headers.authorization = `Bearer ${spec.token}`
    if (spec.method !== 'GET') headers['x-requested-with'] = REQUESTED_WITH
    const init: RequestInit = { method: spec.method, headers }
    if (spec.body !== undefined) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(spec.body)
    }

    let res: Response
    try {
      res = await send(`${base}${spec.path}`, init)
    } catch (cause) {
      throw new ApiError(0, NETWORK_ERROR_CODE, cause instanceof Error ? cause.message : String(cause))
    }

    const payload = await readJson(res)
    if (!res.ok) throw failure(res.status, payload, spec)
    return payload as T
  }

  return {
    config: () => call<LiteConfigDto>({ method: 'GET', path: '/api/config' }),
    createSession: (displayName) => call<SessionDto>({ method: 'POST', path: '/api/session', body: { displayName } }),
    me: (token) => call<MeDto>({ method: 'GET', path: '/api/me', token }),
    daily: (token) => call<DailyStatusDto>({ method: 'GET', path: '/api/rewards/daily', token }),
    claimDaily: (token) => call<ClaimDto>({ method: 'POST', path: '/api/rewards/daily/claim', token }),
    relief: (token) => call<ReliefDto>({ method: 'POST', path: '/api/economy/relief', token }),
  }
}
