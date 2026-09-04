/**
 * The one place `req.user` is declared.
 *
 * Fastify's request type is augmented per *application*, not per file: two `declare module 'fastify'`
 * blocks describing the same property would have to agree forever, and the moment they drifted the
 * error would surface somewhere neither of them is. So this file owns the augmentation, and every
 * route module imports the type from here.
 */

/** What `requireUser` puts on the request: the account, the profile that shares its id, and the name. */
export interface RequestUser {
  /** `users.id`. The same value as `playerId` — an account has exactly one profile — but named for what it is. */
  userId: string
  playerId: string
  displayName: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser`; `null` on every route that does not use that guard. */
    user: RequestUser | null
  }
}
