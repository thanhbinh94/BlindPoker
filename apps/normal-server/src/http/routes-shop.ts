/**
 * The shop over HTTP (Plan 27, spec §3 B2–B3): the shelves, and a purchase for points. Points only — nothing here
 * takes money, converts anything or lets players trade (requirement.txt §3, SRS §33).
 *
 * **Once per click.** The client names each press of "Mua" with a fresh UUID, `purchaseId`, and resends the same one
 * when it retries after a timeout. The service charges once per id and answers a repeat `repeated: true` with the
 * balance as it stands; this route only insists the id *is* a UUID, before the service is asked, so a client that
 * sends a counter or a timestamp hears `400 BAD_REQUEST` rather than getting a key that collides across tabs.
 *
 * **Refusals.** `UNKNOWN_ITEM` is a 404 — the thing asked for does not exist. The other five (`SHOP_DISABLED`,
 * `RANK_TOO_LOW`, `ALREADY_OWNED`, `INSUFFICIENT_POINTS`, `PURCHASE_UNDONE`) are a 409 with the code and a message of
 * its own in the usual error envelope: the item exists, and the player's standing, the price list or a GM's revocation of
 * this very purchase says no right now. The service's own `INVALID_PURCHASE_ID`
 * cannot be reached through the UUID check, but is translated to the same 400 should the two ever drift.
 *
 * Both routes are ordinary metered `/api` routes (`routes.ts`): the GET in the read bucket, the POST in the write
 * bucket and behind the CSRF header rule.
 */
import { HttpError } from '@bp/http-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ServiceError } from '../errors.js'
import type { BuyResult, ShopService } from '../shop/shop-service.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import './types.js'

export interface ShopRouteDeps {
  shop: Pick<ShopService, 'view' | 'buy'>
  requireUser: RequireUser
}

/** A client-made v4-style UUID, lower-case hex and dashes, 36 characters (spec B2). */
const PURCHASE_ID = /^[0-9a-f-]{36}$/
/** The longest item id worth looking up; the catalogue's are a few dozen characters. */
const ITEM_ID_MAX = 100

/** The 409s, each with its words — typed over the service's codes, so a refusal added there cannot go unworded here. */
const REFUSAL_MESSAGE: Record<Exclude<Extract<BuyResult, { ok: false }>['code'], 'UNKNOWN_ITEM'>, string> = {
  SHOP_DISABLED: 'this item is not on sale',
  RANK_TOO_LOW: 'this item needs a higher rank',
  ALREADY_OWNED: 'this item is already owned',
  INSUFFICIENT_POINTS: 'not enough points for this item',
  PURCHASE_UNDONE: 'this purchase was undone; a new purchase buys the item again',
}

export function registerShopRoutes(app: FastifyInstance, deps: ShopRouteDeps): void {
  const authed = { preHandler: deps.requireUser }
  const playerIdOf = (req: FastifyRequest): string => currentUser(req).playerId

  app.get('/api/shop', authed, async (req, reply) => reply.send(await deps.shop.view(playerIdOf(req))))

  app.post('/api/shop/buy', authed, async (req, reply) => {
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>
    const { itemId, purchaseId } = body
    if (typeof itemId !== 'string' || itemId === '' || itemId.length > ITEM_ID_MAX) {
      throw new HttpError(400, 'BAD_REQUEST', 'itemId must be a catalogue item id')
    }
    if (typeof purchaseId !== 'string' || !PURCHASE_ID.test(purchaseId)) {
      throw new HttpError(400, 'BAD_REQUEST', 'purchaseId must be a lower-case UUID')
    }

    let result: Awaited<ReturnType<ShopService['buy']>>
    try {
      result = await deps.shop.buy(playerIdOf(req), itemId, purchaseId)
    } catch (err) {
      if (err instanceof ServiceError && err.code === 'INVALID_PURCHASE_ID') throw new HttpError(400, 'BAD_REQUEST', err.message)
      throw err
    }
    if (!result.ok) {
      if (result.code === 'UNKNOWN_ITEM') throw new HttpError(404, 'UNKNOWN_ITEM', 'no such item')
      throw new HttpError(409, result.code, REFUSAL_MESSAGE[result.code])
    }
    return reply.send({ balance: result.balance, itemId: result.itemId, repeated: result.repeated })
  })
}
