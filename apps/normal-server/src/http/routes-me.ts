/**
 * Everything a signed-in player can read or change about themselves (spec §19.2).
 *
 * One module rather than five because they share a single precondition — `requireUser` has run and
 * `req.user` names an existing profile — and because the shapes they answer with are the shapes
 * `ui-kit` renders. `/api/me` in particular mirrors Lite's body field for field (`playerId`,
 * `displayName`, `balance`, `stats`, `daily`, `relief`), with the Normal-only additions bolted on
 * the end, so the shared `PlayerBar` and daily-reward screens need no edition switch.
 *
 * The routes translate and nothing else: the services decide, and a `ServiceError` or a repository's
 * typed refusal becomes the status and code the client is written against. Anything that is not one
 * of those is a bug, and `registerErrorHandler` answers it with a 500 and no detail.
 */
import { validateDisplayName } from '@bp/core'
import { HttpError } from '@bp/http-kit'
import type { GameServer } from '@bp/server-kit'
import { eq } from 'drizzle-orm'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { AchievementService } from '../achievements/achievement-service.js'
import type { AchievementDef } from '../achievements/definitions.js'
import type { AppDb } from '../db/client.js'
import { users } from '../db/schema.js'
import type { EconomyService } from '../economy/economy-service.js'
import { ServiceError } from '../errors.js'
import type { HistoryService } from '../history/history-service.js'
import { resolveItemId } from '../inventory/aliases.js'
import { applyAvatarConfig, validateAvatarConfig } from '../inventory/avatar.js'
import { readAvatarConfig } from '../inventory/avatar-migrate.js'
import type { Bodies } from '../inventory/bodies.js'
import type { InventoryService } from '../inventory/inventory-service.js'
import type { ItemCatalog } from '../inventory/items.js'
import { clampLimit, cursorOf, DisplayNameTakenError, type NormalRepositories } from '../repos/index.js'
import type { StatsService } from '../stats/stats-service.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import './types.js'

export interface MeRouteDeps {
  db: AppDb
  repos: NormalRepositories
  economy: EconomyService
  stats: StatsService
  achievements: AchievementService
  inventory: InventoryService
  history: HistoryService
  catalog: ItemCatalog
  /** Old wardrobe ids, kept readable — see `inventory/aliases.ts`. */
  aliases: ReadonlyMap<string, string>
  /** The v4 bodies, one per gender (`inventory/bodies.ts`): an old account's avatar is read against their natural eyes. */
  bodies: Bodies
  /** The loaded definitions, so `/api/me/achievements` can answer definition *and* progress at once. */
  defs: AchievementDef[]
  /** The live socket side: a rename reaches the player's connection so the next room they enter uses it. */
  game: Pick<GameServer, 'renameIdentity'>
  requireUser: RequireUser
}

/** `?limit=` / `?before=`: a query string is text, and `Number('')` is 0, which is not "unset". */
function numberParam(query: unknown, key: string): number | undefined {
  const raw = (query as Record<string, unknown> | null | undefined)?.[key]
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  return Number(raw)
}

/** §19.2 asks for the last 20 hands; the service caps a page at 50 whatever is asked for. */
const HISTORY_DEFAULT = 20
const LEDGER_DEFAULT = 50
const LEDGER_MAX = 200
/** A profile is a cheap read but a per-player one, so it may be cached in the player's own browser only. */
const AVATAR_CACHE = 'private, max-age=60'

/** How a deliberate service refusal reaches the client. Anything not listed is a bug, not a 4xx. */
const SERVICE_STATUS: Record<string, number> = { NOT_OWNED: 403 }

function translateServiceError(err: unknown): never {
  if (err instanceof ServiceError) throw new HttpError(SERVICE_STATUS[err.code] ?? 400, err.code, err.message)
  throw err
}

export function registerMeRoutes(app: FastifyInstance, deps: MeRouteDeps): void {
  const authed = { preHandler: deps.requireUser }
  const playerIdOf = (req: FastifyRequest): string => currentUser(req).playerId

  /**
   * The profile row behind `req.user`.
   *
   * `requireUser` already proved the player exists, so a miss here is a row deleted between the
   * guard and the handler — a 401 rather than a 404, because from the client's side the answer is
   * the same one the guard would have given a moment earlier: sign in again.
   */
  async function profile(playerId: string) {
    const row = await deps.repos.players.findByIdFull(playerId)
    if (row === null) throw new HttpError(401, 'UNAUTHENTICATED', 'a valid session cookie is required')
    return row
  }

  app.get('/api/me', authed, async (req, reply) => {
    const playerId = playerIdOf(req)
    const player = await profile(playerId)
    // The account half of the profile. Read here rather than through a repository method because it
    // is two columns on one route; widening `NormalPlayerRepository` for them would put account
    // fields into the object `server-kit` is handed.
    const [account] = await deps.db
      .select({ email: users.email, lastLoginAt: users.lastLoginAt })
      .from(users)
      .where(eq(users.id, playerId))
    const [daily, relief, stats] = await Promise.all([
      deps.economy.dailyStatus(playerId),
      deps.economy.reliefStatus(playerId),
      deps.stats.get(playerId),
    ])
    return reply.send({
      playerId: player.playerId,
      displayName: player.displayName,
      email: account?.email ?? null,
      role: currentUser(req).role,
      balance: player.balance,
      avatar: readAvatarConfig(player.avatarConfig, deps.catalog, deps.aliases, deps.bodies),
      // The summary Lite publishes under the same key: both modes folded into one pair, because
      // that is what the shared player bar draws. The per-mode counters are `/api/me/stats`.
      stats: {
        handsPlayed: stats.handsPlayedHoldem + stats.handsPlayedBlind,
        handsWon: stats.handsWonHoldem + stats.handsWonBlind,
      },
      daily,
      relief,
      createdAt: player.createdAt.getTime(),
      lastLoginAt: account?.lastLoginAt?.getTime() ?? null,
    })
  })

  /**
   * Renaming.
   *
   * Shape is decided by `@bp/core` — the same validator the client runs, so a name the UI accepted
   * is not refused here for a different reason — and uniqueness by the database, which is the only
   * place it can be decided without a race.
   *
   * A player who is seated keeps their old name at the table until they next join a room: the room
   * actor holds the identity it was given when they entered, and rewriting it mid-hand would change
   * the name on a seat that other players are reading. The live connection, though, takes the new
   * name at once (`renameIdentity`), so that next room — created or joined — seats them under it
   * without a reconnect (finding T7 of the 2026-09-28 operation test).
   */
  app.patch('/api/me', authed, async (req, reply) => {
    const raw = (req.body as { displayName?: unknown } | null | undefined)?.displayName
    if (typeof raw !== 'string') throw new HttpError(400, 'INVALID_NAME', 'displayName must be a string')
    const verdict = validateDisplayName(raw)
    if (!verdict.ok) throw new HttpError(400, 'INVALID_NAME', `display name refused: ${verdict.reason}`)

    const playerId = playerIdOf(req)
    try {
      await deps.repos.players.updateProfile(playerId, { displayName: verdict.name })
    } catch (err) {
      if (err instanceof DisplayNameTakenError) throw new HttpError(409, 'DISPLAY_NAME_TAKEN', err.message)
      throw err
    }
    deps.game.renameIdentity(playerId, verdict.name)
    return reply.send({ playerId, displayName: verdict.name })
  })

  app.get('/api/me/stats', authed, async (req, reply) => reply.send(await deps.stats.get(playerIdOf(req))))

  app.get('/api/me/history', authed, async (req, reply) =>
    reply.send(await deps.history.listForPlayer(playerIdOf(req), numberParam(req.query, 'limit') ?? HISTORY_DEFAULT)))

  /**
   * The points history, paged on the ledger's own sequence id.
   *
   * `nextBefore` is the last row's id rather than "page + 1": every row of one settlement shares a
   * timestamp and an offset moves under inserts, so the cursor has to be something that never ties
   * and never shifts.
   */
  app.get('/api/me/ledger', authed, async (req, reply) => {
    const limit = clampLimit(numberParam(req.query, 'limit'), LEDGER_DEFAULT, LEDGER_MAX)
    const before = cursorOf(numberParam(req.query, 'before'))
    const rows = await deps.repos.ledger.list(playerIdOf(req), { limit, ...(before === undefined ? {} : { before }) })
    return reply.send({
      entries: rows.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, refId: r.refId, createdAt: r.createdAt.getTime() })),
      // Only when the page was full: a short page is the end of the history, and handing back a
      // cursor there would have the client ask for a page that is always empty.
      nextBefore: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    })
  })

  app.get('/api/me/inventory', authed, async (req, reply) => {
    const playerId = playerIdOf(req)
    const [owned, player] = await Promise.all([deps.inventory.list(playerId), profile(playerId)])
    // `inventory.item_id` rows are never rewritten (`inventory/aliases.ts`), so a legacy row still names
    // its old id — joining the catalogue against that raw id would miss it entirely (`catalog.get` only
    // knows current ids) and leave the wardrobe unable to tell the row apart from an item nobody owns.
    // Resolved here, once, the same way `owns`/`missingOf` already widen an id to its alias class: every
    // row is reported under its *current* id, with the id it was actually acquired as kept in
    // `acquiredAs` for anyone who cares which one it was. `owned` is oldest-first (`InventoryService.list`),
    // so a player who somehow holds both the old and the new row for one item collapses to a single entry
    // at the earlier of the two `acquiredAt`s — the first `resolved` wins and every later duplicate is
    // dropped, rather than the wardrobe (and any summary derived from `items.length`) counting one item twice.
    const collapsed = new Map<string, { itemId: string; acquiredAs: string; source: string; acquiredAt: number }>()
    for (const item of owned) {
      const resolved = resolveItemId(item.itemId, deps.aliases)
      if (!collapsed.has(resolved)) collapsed.set(resolved, { itemId: resolved, acquiredAs: item.itemId, source: item.source, acquiredAt: item.acquiredAt })
    }
    return reply.send({
      // Joined against the catalogue here rather than in the client: the slot and rarity of an
      // owned item are what the wardrobe groups by, and the client should not have to fetch the
      // whole catalogue to draw its own inventory. The geometry is not joined in — an item's
      // `asset` is the same for everyone and is served whole by `/api/catalog/items`.
      items: [...collapsed.values()].map((item) => {
        const def = deps.catalog.get(item.itemId)
        return {
          itemId: item.itemId,
          acquiredAs: item.acquiredAs,
          slot: def?.slot ?? null,
          rarity: def?.rarity ?? null,
          nameKey: def?.nameKey ?? null,
          assetKey: def?.assetKey ?? null,
          source: item.source,
          acquiredAt: item.acquiredAt,
        }
      }),
      avatar: readAvatarConfig(player.avatarConfig, deps.catalog, deps.aliases, deps.bodies),
    })
  })

  /** A full replace, not a patch: omitting `title` is how a player takes their title off. */
  app.put('/api/me/avatar', authed, async (req, reply) => {
    const checked = validateAvatarConfig(req.body, deps.catalog)
    if (!checked.ok) throw new HttpError(400, checked.code, `avatar refused: ${checked.code}`)
    try {
      return reply.send(await applyAvatarConfig(deps.db, deps.inventory, playerIdOf(req), checked.value))
    } catch (err) {
      return translateServiceError(err)
    }
  })

  /**
   * Anyone else's avatar — what the table view draws for the other seats.
   *
   * Behind `requireUser` even though it says nothing secret: an open endpoint that turns a player id
   * into a display name is an enumeration tool, and every legitimate caller is signed in already.
   */
  app.get('/api/players/:id/avatar', authed, async (req, reply) => {
    const { id } = req.params as { id: string }
    const player = await deps.repos.players.findByIdFull(id)
    if (player === null) throw new HttpError(404, 'NOT_FOUND', `no player ${id}`)
    reply.header('cache-control', AVATAR_CACHE)
    return reply.send({
      playerId: player.playerId,
      displayName: player.displayName,
      avatar: readAvatarConfig(player.avatarConfig, deps.catalog, deps.aliases, deps.bodies),
    })
  })

  /**
   * Definition and progress in one list (§19.2), in the catalogue's own order.
   *
   * A definition the player has no row for yet is still listed, at zero: the achievement screen is a
   * list of everything there is to earn, and one that only showed what had been started would be
   * empty on the first day.
   */
  app.get('/api/me/achievements', authed, async (req, reply) => {
    const progress = new Map((await deps.achievements.list(playerIdOf(req))).map((p) => [p.id, p]))
    return reply.send(
      deps.defs.map((def) => ({
        id: def.id,
        category: def.category,
        metric: def.metric,
        threshold: def.threshold,
        reward: def.reward,
        progress: progress.get(def.id)?.progress ?? 0,
        unlockedAt: progress.get(def.id)?.unlockedAt ?? null,
      })),
    )
  })
}
