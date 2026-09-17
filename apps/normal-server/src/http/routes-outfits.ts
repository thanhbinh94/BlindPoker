/**
 * Five saved outfits per player (design §5.3, same contract Plan 10 §5.4 speced for v2).
 *
 * `PUT`'s body carries a whole `AvatarConfigDto` the same shape `PUT /api/me/avatar` accepts, and it
 * is validated the same way — `validateAvatarConfig` before anything reaches `outfits-service.ts` —
 * so an outfit can never be saved half-wrong: what a player can save is exactly what they could wear
 * directly, and the avatar error codes (`INVALID_ITEM`, `WRONG_CATEGORY`, `MISSING_LAYER`,
 * `INVALID_BASE`) mean the same thing here as they do there.
 */
import { HttpError } from '@bp/http-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { validateAvatarConfig } from '../inventory/avatar.js'
import type { BaseIds } from '../inventory/slots.js'
import type { ItemCatalog } from '../inventory/items.js'
import type { OutfitsService } from '../inventory/outfits-service.js'
import { ServiceError } from '../errors.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import './types.js'

export interface OutfitRouteDeps {
  outfits: OutfitsService
  catalog: ItemCatalog
  /** The ids `data/avatar-bases.json` defines — what `INVALID_BASE` is measured against. */
  baseIds: BaseIds
  requireUser: RequireUser
}

/** How a deliberate service refusal reaches the client. Anything not listed is a bug, not a 4xx. */
const SERVICE_STATUS: Record<string, number> = { INVALID_SLOT: 400, INVALID_NAME: 400, ITEM_NOT_OWNED: 403, NOT_FOUND: 404 }

function translateServiceError(err: unknown): never {
  if (err instanceof ServiceError) throw new HttpError(SERVICE_STATUS[err.code] ?? 400, err.code, err.message)
  throw err
}

/** The `:slot` route param as a number — not yet range-checked, that is the service's job. */
function slotParam(req: FastifyRequest): number {
  const { slot } = req.params as { slot: string }
  return Number(slot)
}

export function registerOutfitRoutes(app: FastifyInstance, deps: OutfitRouteDeps): void {
  const authed = { preHandler: deps.requireUser }
  const playerIdOf = (req: FastifyRequest): string => currentUser(req).playerId

  app.get('/api/me/outfits', authed, async (req, reply) => reply.send({ outfits: await deps.outfits.list(playerIdOf(req)) }))

  app.put('/api/me/outfits/:slot', authed, async (req, reply) => {
    const body = req.body as { name?: unknown; config?: unknown } | null | undefined
    const name = body?.name
    if (typeof name !== 'string') throw new HttpError(400, 'INVALID_NAME', 'name must be a string')

    const checked = validateAvatarConfig(body?.config, deps.catalog, deps.baseIds)
    if (!checked.ok) throw new HttpError(400, checked.code, `avatar refused: ${checked.code}`)

    try {
      return reply.send(await deps.outfits.save(playerIdOf(req), slotParam(req), name, checked.value))
    } catch (err) {
      return translateServiceError(err)
    }
  })

  app.delete('/api/me/outfits/:slot', authed, async (req, reply) => {
    try {
      return reply.send({ removed: await deps.outfits.remove(playerIdOf(req), slotParam(req)) })
    } catch (err) {
      return translateServiceError(err)
    }
  })

  app.post('/api/me/outfits/:slot/apply', authed, async (req, reply) => {
    try {
      return reply.send(await deps.outfits.apply(playerIdOf(req), slotParam(req)))
    } catch (err) {
      return translateServiceError(err)
    }
  })
}
