/**
 * The e2e server's one extra route: `POST /e2e/promote { email }` makes an account a GM, so the ops pack can
 * reach the GM screen without a CLI on the browser side. Handed to `buildApp` as `extraRoutes` by `e2e-entry.ts`
 * and by nothing else; excluded from `tsconfig.build.json`, so it is never part of `dist/` (`build.mjs` bundles
 * main/migrate/grant-* only). Loopback only, like Lite's admin shutdown, and behind the CSRF guard like any POST.
 */
import { isLoopbackAddress } from '@bp/http-kit'
import type { FastifyInstance } from 'fastify'
import type { AppDb } from './db/client.js'
import { grantGm } from './gm/grant-gm.js'

export function promoteRoute(db: AppDb): (fastify: FastifyInstance) => void {
  return (fastify) => {
    fastify.post('/e2e/promote', async (req, reply) => {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'loopback only' } })
      const { email } = (req.body ?? {}) as { email?: string }
      if (typeof email !== 'string') return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'email' } })
      const result = await grantGm(db, email)
      return reply.send({ role: result.role })
    })
  }
}
