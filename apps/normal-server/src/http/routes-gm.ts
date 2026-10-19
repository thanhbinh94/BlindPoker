/**
 * `/api/gm/*` (Plan 25 §5): what a GM does to an account or a room, and the log that says so.
 *
 * Every route sits behind `requireGm`, which re-reads the role from the database on each request, and every POST is
 * under `/api/` — so the CSRF guard and the write limiter of `routes.ts` meet it like any other write.
 *
 * Two rules the file keeps:
 *
 * - **The reason comes first.** A POST without a 3–200 character `reason` is `400 INVALID_REASON` before any lookup,
 *   so a refusal never depends on whether the target exists. The account routes get this from the service (its first
 *   line is the reason check); the two room routes check it here, because their service is a façade over memory.
 * - **A room action is logged around the deed, not inside a transaction** (a room lives in memory). Closing logs
 *   first, and a failed close adds a second line with `details.error`; a kick is logged once, after it, with how it
 *   took effect (`details.effective`) or why it failed; a log write that fails after a kick that happened is warned,
 *   and the GM still gets `200 { effective }`. A lookup that finds nothing (no such room, not in it) is not an action
 *   and is not logged.
 */
import { HttpError } from '@bp/http-kit'
import type { Logger } from '@bp/server-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { ServiceError } from '../errors.js'
import type { GmRoomService } from '../gm/gm-rooms.js'
import { checkReason, type GmActor, type GmService } from '../gm/gm-service.js'
import type { HistoryService } from '../history/history-service.js'
import { clampLimit, cursorOf, isUuid, type NormalRepositories } from '../repos/index.js'
import { currentUser, type RequireUser } from './auth-guard.js'
import { HISTORY_DEFAULT, LEDGER_DEFAULT, LEDGER_MAX, numberParam } from './routes-me.js'
import './types.js'

export interface GmRouteDeps {
  gm: GmService
  gmRooms: GmRoomService
  history: HistoryService
  repos: NormalRepositories
  requireGm: RequireUser
  /** Where a kick that happened but could not be logged is reported. */
  log: Pick<Logger, 'warn'>
}

/** How a deliberate service refusal reaches the client. Anything not listed is a bug, not a 4xx. */
const SERVICE_STATUS: Record<string, number> = {
  NOT_FOUND: 404,
  ROOM_NOT_FOUND: 404,
  NOT_IN_ROOM: 404,
  INVALID_AMOUNT: 400,
  INVALID_REASON: 400,
  INVALID_ITEM: 400,
  INVALID_ROLE: 400,
  FORBIDDEN: 403,
  SELF_TARGET: 403,
  TARGET_IS_GM: 403,
  ALREADY_LOCKED: 409,
  NOT_LOCKED: 409,
  LAST_GM: 409,
  TARGET_IS_LOCKED: 409,
  INSUFFICIENT_BALANCE: 409,
  ILLEGAL_ACTION: 400,
  GAME_IN_PROGRESS: 409,
}

/** A refusal that means "there was nothing to act on" — no action happened, so none is logged. */
const LOOKUP_REFUSALS: ReadonlySet<string> = new Set(['ROOM_NOT_FOUND', 'NOT_IN_ROOM'])

function translateServiceError(err: unknown): never {
  if (err instanceof ServiceError) throw new HttpError(SERVICE_STATUS[err.code] ?? 400, err.code, err.message)
  throw err
}

/** Runs a service call and turns its deliberate refusals into HTTP ones. */
async function translated<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    return translateServiceError(err)
  }
}

const bodyOf = (req: FastifyRequest): Record<string, unknown> => {
  const body = req.body
  return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
}

const stringQuery = (query: unknown, key: string): string | undefined => {
  const raw = (query as Record<string, unknown> | null | undefined)?.[key]
  return typeof raw === 'string' && raw !== '' ? raw : undefined
}

const errorCodeOf = (err: unknown): string => (err instanceof ServiceError ? err.code : err instanceof Error ? err.message : String(err))

export function registerGmRoutes(app: FastifyInstance, deps: GmRouteDeps): void {
  const gmOnly = { preHandler: deps.requireGm }
  const actorOf = (req: FastifyRequest): GmActor => ({ userId: currentUser(req).userId })
  const idOf = (req: FastifyRequest): string => (req.params as { id: string }).id
  /** The service answers `NOT_FOUND` for an id that is no account; the ledger and history reads would 500 on a non-uuid. */
  const accountId = (req: FastifyRequest): string => {
    const id = idOf(req)
    if (!isUuid(id)) throw new HttpError(404, 'NOT_FOUND', 'no such player')
    return id
  }
  /** `reason` of a room POST, checked before the room is looked up. */
  const roomReason = (req: FastifyRequest): string => {
    try {
      return checkReason(bodyOf(req).reason)
    } catch (err) {
      return translateServiceError(err)
    }
  }

  app.get('/api/gm/overview', gmOnly, async (_req, reply) => reply.send(await deps.gm.overview()))

  // ---------- players ----------

  app.post('/api/gm/players/search', gmOnly, async (req, reply) => {
    const body = bodyOf(req)
    if (typeof body.q !== 'string') throw new HttpError(400, 'BAD_REQUEST', 'q must be a string')
    const limit = typeof body.limit === 'number' ? body.limit : undefined
    const before = typeof body.before === 'string' ? body.before : undefined
    return reply.send(await deps.gm.search(body.q, { ...(limit === undefined ? {} : { limit }), ...(before === undefined ? {} : { before }) }))
  })

  app.get('/api/gm/players/:id', gmOnly, async (req, reply) => {
    const found = await deps.gm.get(idOf(req))
    if (found === null) throw new HttpError(404, 'NOT_FOUND', 'no such player')
    return reply.send(found)
  })

  // The same two reads as `/api/me/ledger` and `/api/me/history`, on the target's id instead of the caller's.
  app.get('/api/gm/players/:id/ledger', gmOnly, async (req, reply) => {
    const limit = clampLimit(numberParam(req.query, 'limit'), LEDGER_DEFAULT, LEDGER_MAX)
    const before = cursorOf(numberParam(req.query, 'before'))
    const rows = await deps.repos.ledger.list(accountId(req), { limit, ...(before === undefined ? {} : { before }) })
    return reply.send({
      entries: rows.map((r) => ({ id: r.id, amount: r.amount, reason: r.reason, refId: r.refId, createdAt: r.createdAt.getTime() })),
      nextBefore: rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null,
    })
  })

  app.get('/api/gm/players/:id/history', gmOnly, async (req, reply) =>
    reply.send(await deps.history.listForPlayer(accountId(req), numberParam(req.query, 'limit') ?? HISTORY_DEFAULT)))

  app.post('/api/gm/players/:id/points', gmOnly, async (req, reply) => {
    const body = bodyOf(req)
    return reply.send(await translated(() => deps.gm.adjustPoints(actorOf(req), idOf(req), body.amount as number, body.reason as string)))
  })

  app.post('/api/gm/players/:id/items', gmOnly, async (req, reply) => {
    const body = bodyOf(req)
    const reason = body.reason as string
    const granted = await translated(() => body.all === true
      ? deps.gm.grantWardrobe(actorOf(req), idOf(req), reason)
      : deps.gm.grantItem(actorOf(req), idOf(req), body.itemId as string, reason))
    return reply.send({ granted: granted.granted, alreadyOwned: granted.alreadyOwned })
  })

  app.post('/api/gm/players/:id/lock', gmOnly, async (req, reply) => {
    await translated(() => deps.gm.lock(actorOf(req), idOf(req), bodyOf(req).reason as string))
    return reply.send({ locked: true })
  })

  app.post('/api/gm/players/:id/unlock', gmOnly, async (req, reply) => {
    await translated(() => deps.gm.unlock(actorOf(req), idOf(req), bodyOf(req).reason as string))
    return reply.send({ locked: false })
  })

  app.post('/api/gm/players/:id/role', gmOnly, async (req, reply) => {
    const body = bodyOf(req)
    const done = await translated(() => deps.gm.setRole(actorOf(req), idOf(req), body.role as 'player' | 'gm', body.reason as string))
    return reply.send({ role: done.role })
  })

  // ---------- rooms ----------

  app.get('/api/gm/rooms', gmOnly, async (_req, reply) => reply.send({ rooms: deps.gmRooms.list() }))

  app.get('/api/gm/rooms/:id', gmOnly, async (req, reply) => {
    const room = deps.gmRooms.get(idOf(req))
    if (room === null) throw new HttpError(404, 'ROOM_NOT_FOUND', 'no such room')
    return reply.send(room)
  })

  app.post('/api/gm/rooms/:id/kick', gmOnly, async (req, reply) => {
    const reason = roomReason(req)
    const playerId = bodyOf(req).playerId
    if (typeof playerId !== 'string' || playerId === '') throw new HttpError(400, 'BAD_REQUEST', 'playerId must be a string')
    const roomId = idOf(req)
    let effective: 'now' | 'after_hand'
    try {
      effective = await deps.gmRooms.kick(roomId, playerId, reason)
    } catch (err) {
      if (!(err instanceof ServiceError && LOOKUP_REFUSALS.has(err.code))) {
        await deps.gm.recordRoomAction(actorOf(req), 'kick', roomId, playerId, reason, { error: errorCodeOf(err) })
      }
      return translateServiceError(err)
    }
    // The kick has happened and cannot be undone: a log write that fails now is an operator's to look at, and the GM
    // still hears that the kick took effect — a 500 would invite a retry of something already done.
    await deps.gm.recordRoomAction(actorOf(req), 'kick', roomId, playerId, reason, { effective }).catch((err: unknown) => {
      deps.log.warn('gm kick not logged', { roomId, playerId, effective, error: errorCodeOf(err) })
    })
    return reply.send({ effective })
  })

  app.post('/api/gm/rooms/:id/close', gmOnly, async (req, reply) => {
    const reason = roomReason(req)
    const roomId = idOf(req)
    if (deps.gmRooms.get(roomId) === null) throw new HttpError(404, 'ROOM_NOT_FOUND', 'no such room')
    // Logged first: the close cannot be rolled back, and a line that says what was meant is better than none.
    await deps.gm.recordRoomAction(actorOf(req), 'close_room', roomId, null, reason)
    try {
      const { refunded } = await deps.gmRooms.close(roomId, reason)
      return reply.send({ closed: true, refunded })
    } catch (err) {
      // The room vanished between the check and the close (it emptied on its own): nothing for the GM to retry.
      await deps.gm.recordRoomAction(actorOf(req), 'close_room', roomId, null, reason, { error: errorCodeOf(err) })
      return translateServiceError(err)
    }
  })

  // ---------- the log ----------

  app.get('/api/gm/actions', gmOnly, async (req, reply) => {
    const limit = numberParam(req.query, 'limit')
    const before = numberParam(req.query, 'before')
    const playerId = stringQuery(req.query, 'player')
    const roomId = stringQuery(req.query, 'room')
    return reply.send(await deps.gm.actions({
      ...(limit === undefined ? {} : { limit }),
      ...(before === undefined ? {} : { before }),
      ...(playerId === undefined ? {} : { playerId }),
      ...(roomId === undefined ? {} : { roomId }),
    }))
  })
}
