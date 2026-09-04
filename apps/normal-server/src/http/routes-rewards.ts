/**
 * The two ways points arrive without a card being dealt: the daily check-in (§13) and relief (§12.4).
 *
 * The paths and the bodies are Lite's (§19.3) even though the services behind them are not: Lite's
 * daily reward is points only, Normal's also hands out cosmetics. The Normal-only fields are
 * additions to Lite's shape rather than a reshaping of it, so one client can call either edition and
 * simply ignore what it does not understand.
 *
 * The refusals are the part worth reading. Both services answer with a discriminated union
 * (`{ ok: false, … }`), and both refusals are a 409 with the extra fields *outside* the error
 * envelope — `claimed: false`, `granted: false` — because a client that asked to claim needs to know
 * why it was told no, not merely that it was.
 */
import { HttpError } from '@bp/http-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { EconomyService } from '../economy/economy-service.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import './types.js'

export interface RewardRouteDeps {
  economy: EconomyService
  requireUser: RequireUser
}

const REFUSAL_MESSAGE: Record<string, string> = {
  cooldown: 'relief is still on cooldown',
  balance: 'relief is only granted below the threshold',
}

export function registerRewardRoutes(app: FastifyInstance, deps: RewardRouteDeps): void {
  const authed = { preHandler: deps.requireUser }
  const playerIdOf = (req: FastifyRequest): string => currentUser(req).playerId

  app.get('/api/rewards/daily', authed, async (req, reply) => reply.send(await deps.economy.dailyStatus(playerIdOf(req))))

  app.post('/api/rewards/daily/claim', authed, async (req, reply) => {
    const result = await deps.economy.claimDaily(playerIdOf(req))
    if (!result.ok) {
      throw new HttpError(409, 'ALREADY_CLAIMED', 'the daily reward has already been claimed today', { claimed: false })
    }
    const { ok: _ok, ...rest } = result
    return reply.send({ claimed: true, ...rest })
  })

  app.post('/api/economy/relief', authed, async (req, reply) => {
    const result = await deps.economy.claimRelief(playerIdOf(req))
    if (!result.ok) {
      throw new HttpError(409, 'NOT_ELIGIBLE', REFUSAL_MESSAGE[result.reason] ?? 'relief is not available', {
        granted: false,
        reason: result.reason,
        retryAt: result.retryAt,
      })
    }
    return reply.send({ granted: true, amount: result.amount, balance: result.balance })
  })
}
