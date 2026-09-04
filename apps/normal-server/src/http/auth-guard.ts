/**
 * "This request has to be signed in."
 *
 * A factory rather than a bare pre-handler because the guard needs the session service and the
 * player repository, and reaching for them through a Fastify decorator would make every route file
 * depend on a decoration having been applied somewhere else. `createRequireUser(deps)` is handed to
 * `preHandler` and the dependency is visible at the call site.
 *
 * The guard resolves the cookie *and* loads the profile, so a handler behind it never has to ask
 * whether the player still exists — and an account erased under a live session is a 401 rather than
 * a handler dereferencing `null` somewhere further in.
 *
 * Both failures answer the same `401 UNAUTHENTICATED`: "no cookie", "expired session" and "account
 * gone" are one situation from the client's side — sign in again — and telling them apart would say
 * more about the server's state than a caller who is not signed in has any business learning.
 */
import { HttpError } from '@bp/http-kit'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import { readSessionCookie } from '../auth/cookie.js'
import type { SessionService } from '../auth/session-service.js'
import type { NormalPlayerRepository } from '../repos/index.js'
import './types.js'

export interface AuthGuardDeps {
  sessions: SessionService
  repos: { players: NormalPlayerRepository }
}

export type RequireUser = (req: FastifyRequest) => Promise<void>

const UNAUTHENTICATED = 'a valid session cookie is required'

/**
 * Declares `req.user` on the instance. Idempotent: Fastify throws on a second decoration of the same
 * name, and both `registerAuthRoutes` and any later route module that guards its own routes have to
 * be able to ask for it without knowing which of them runs first.
 */
export function decorateRequestUser(app: FastifyInstance): void {
  if (!app.hasRequestDecorator('user')) app.decorateRequest('user', null)
}

export function createRequireUser(deps: AuthGuardDeps): RequireUser {
  return async (req) => {
    const token = readSessionCookie(req)
    const session = token === null ? null : await deps.sessions.resolve(token)
    if (session === null) throw new HttpError(401, 'UNAUTHENTICATED', UNAUTHENTICATED)
    const player = await deps.repos.players.findById(session.userId)
    if (player === null) throw new HttpError(401, 'UNAUTHENTICATED', UNAUTHENTICATED)
    req.user = { userId: session.userId, playerId: player.playerId, displayName: player.displayName }
  }
}

/** `req.user` after the guard has run. Throws rather than returning null: reaching this without the guard is a bug. */
export function currentUser(req: FastifyRequest): NonNullable<FastifyRequest['user']> {
  if (req.user === null || req.user === undefined) throw new HttpError(401, 'UNAUTHENTICATED', UNAUTHENTICATED)
  return req.user
}
