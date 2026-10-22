/**
 * The welcome gift over HTTP (Plan 27, spec §4 C1, amendment P24): `GET /api/welcome` for the lobby to decide whether
 * to open the dialog, and `POST /api/welcome/claim` to take the gift. It is not folded into `GET /api/me`, which the
 * lobby does not fetch.
 *
 * **The body.** `{ itemId: string | null }` — the key must be there: `null` is the deliberate "reputation only" of R17
 * (every choice already owned), and a body without the key is a malformed request (`400 INVALID_BODY`), not a quiet
 * vote for `null`.
 *
 * **Refusals.** `WELCOME_CLAIMED`, `NOT_A_CHOICE` and `ALREADY_OWNED` are each a 409 with the code in the usual error
 * envelope: the request is well formed, and the player's standing says no.
 *
 * Both routes are ordinary metered `/api` routes (`routes.ts`): the GET in the read bucket, the POST in the write
 * bucket and behind the CSRF header rule.
 */
import { HttpError } from '@bp/http-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { WelcomeRefusal, WelcomeService } from '../economy/welcome-service.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import './types.js'

export interface WelcomeRouteDeps {
  welcome: WelcomeService
  requireUser: RequireUser
}

/** The longest item id worth looking up; the catalogue's are a few dozen characters. */
const ITEM_ID_MAX = 100

const REFUSAL_MESSAGE: Record<WelcomeRefusal, string> = {
  WELCOME_CLAIMED: 'the welcome gift has already been claimed',
  NOT_A_CHOICE: 'this item is not one of the welcome choices',
  ALREADY_OWNED: 'this item is already owned',
}

export function registerWelcomeRoutes(app: FastifyInstance, deps: WelcomeRouteDeps): void {
  const authed = { preHandler: deps.requireUser }
  const playerIdOf = (req: FastifyRequest): string => currentUser(req).playerId

  app.get('/api/welcome', authed, async (req, reply) => reply.send(await deps.welcome.status(playerIdOf(req))))

  app.post('/api/welcome/claim', authed, async (req, reply) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const itemId = body['itemId']
    if (itemId !== null && (typeof itemId !== 'string' || itemId === '' || itemId.length > ITEM_ID_MAX)) {
      throw new HttpError(400, 'INVALID_BODY', 'itemId must be a catalogue item id, or null')
    }
    const result = await deps.welcome.claim(playerIdOf(req), itemId)
    if (!result.ok) throw new HttpError(409, result.code, REFUSAL_MESSAGE[result.code])
    return reply.send(result)
  })
}
