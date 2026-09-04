/**
 * The three reads that are the same for everybody: the client's boot configuration, the item
 * catalogue and the achievement definitions.
 *
 * None of them is behind `requireUser`, and that is deliberate rather than an oversight. The sign-in
 * screen needs `/api/config` before it has a session, and the wardrobe and achievement screens are
 * drawn from data that is identical for every player — it is the catalogue, not anyone's copy of it.
 * Nothing here reads a player id, so there is nothing to leak by asking without one.
 *
 * `/api/config` publishes exactly Lite's keys plus `reconnectWindowSec`, so `ui-kit` can boot
 * against either edition from one fetch.
 */
import { ECONOMY } from '@bp/core'
import type { FastifyInstance } from 'fastify'
import type { AchievementDef } from '../achievements/definitions.js'
import type { NormalConfig } from '../config.js'
import type { ItemCatalog } from '../inventory/items.js'

export interface CatalogRouteDeps {
  config: NormalConfig
  catalog: ItemCatalog
  defs: AchievementDef[]
}

/** The languages `normal-web` ships strings for (spec §21). */
const LANGUAGES = ['vi', 'en']
export const WS_PATH = '/ws'

export function registerCatalogRoutes(app: FastifyInstance, deps: CatalogRouteDeps): void {
  app.get('/api/config', async (_req, reply) =>
    reply.send({
      edition: 'normal',
      wsPath: WS_PATH,
      economy: {
        startingBalance: ECONOMY.startingBalance,
        blindWagerTiers: [...ECONOMY.blindWagerTiers],
        holdemBlindTiers: ECONOMY.holdemBlindTiers.map((t) => ({ smallBlind: t.smallBlind, bigBlind: t.bigBlind })),
        reliefThreshold: ECONOMY.reliefThreshold,
        reliefTarget: ECONOMY.reliefTarget,
      },
      languages: LANGUAGES,
      // The one room parameter this edition exposes (§22.5): how long a disconnected seat is held.
      reconnectWindowSec: deps.config.reconnectWindowSec,
    }))

  app.get('/api/catalog/items', async (_req, reply) => reply.send({ items: deps.catalog.all() }))

  /**
   * The definitions without anyone's progress. `/api/me/achievements` answers both together for the
   * signed-in player; this is what an "all achievements" page can render before sign-in.
   */
  app.get('/api/catalog/achievements', async (_req, reply) =>
    reply.send({
      achievements: deps.defs.map((def) => ({
        id: def.id,
        category: def.category,
        metric: def.metric,
        threshold: def.threshold,
        reward: def.reward,
      })),
    }))
}
