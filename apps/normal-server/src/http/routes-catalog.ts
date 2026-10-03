/**
 * The reads that are the same for everybody: the client's boot configuration, the item catalogue,
 * the avatar frame/bases and the achievement definitions.
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
import type { AvatarManifest } from '../inventory/manifest.js'
import type { BaseDef } from '../inventory/bases.js'
import type { Bodies } from '../inventory/bodies.js'
import type { ItemCatalog } from '../inventory/items.js'

export interface CatalogRouteDeps {
  config: NormalConfig
  catalog: ItemCatalog
  defs: AchievementDef[]
  manifest: AvatarManifest
  /** The v3 registry, still served until A5 switches the wire to v4. */
  bases: Record<string, BaseDef>
  /** The v4 bodies, one per gender (Plan 19). */
  bodies: Bodies
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
   * The rig every chibi is drawn on (design §5.1): the frame and profile crop the pipeline built to,
   * and every base the registry defines — public, like `/api/catalog/items`, because a base is chosen
   * rather than owned and the wardrobe needs it before it needs a session.
   *
   * 2026-09-17: the list is `deps.bases` itself, in `data/avatar-bases.json`'s own key order, rather
   * than a constant naming two ids. Adding a figure is a registry entry and its art; the wardrobe's
   * base tab draws one tile per entry it is sent, so nothing downstream counts them either.
   *
   * 2026-10-03 (Plan 19): `bodies` beside `bases` — the two v4 bodies, f then m, each with its files, its
   * natural eye colour and the tint it derived from the manifest. Today's client ignores the key; A5 switches
   * the client to it and drops `bases`.
   */
  app.get('/api/catalog/avatar', async (_req, reply) =>
    reply.send({
      frame: deps.manifest.frame,
      crop: deps.manifest.crop,
      bases: Object.values(deps.bases),
      bodies: Object.values(deps.bodies),
      manifestVersion: deps.manifest.version,
    }))

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
