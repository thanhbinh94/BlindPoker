import { eq, sql } from 'drizzle-orm'
import { rowsOf, type AppDb } from '../db/client.js'
import { gmActions, players, users } from '../db/schema.js'
import { UnknownAccountError } from '../inventory/grant-wardrobe.js'

export { UnknownAccountError }

/** `--revoke` of the only gm: an operator tool must not leave the product with nobody who can promote again. */
export class LastGmError extends Error {
  constructor(email: string) {
    super(`${email} is the only gm; promote another account first`)
    this.name = 'LastGmError'
  }
}

/** The `gm_actions.reason` a CLI change carries; its `actor_user_id` is null, because no signed-in gm did it. */
export const CLI_REASON = 'cli'

export interface GrantGmResult {
  playerId: string
  displayName: string
  role: 'player' | 'gm'
  /** `false` when the account already had that role: nothing was written, not even a log row. */
  changed: boolean
}

/**
 * Makes one account a GM (or, with `revoke`, a player again) from the server — the way the first GM comes to exist,
 * since the API only lets a GM promote and nobody is one yet.
 *
 * A tool for operators, like `grantWardrobe`: the role update and its `gm_actions` line are one transaction. The
 * last-gm check locks every gm row in id order, the same way `GmService.setRole` does, so a CLI run and a screen
 * demotion cannot each leave the other the last one. Idempotent.
 */
export async function grantGm(db: AppDb, email: string, opts: { revoke?: boolean } = {}): Promise<GrantGmResult> {
  const normalised = email.trim().toLowerCase()
  const want = opts.revoke === true ? 'player' : 'gm'
  return db.transaction(async (tx) => {
    const [account] = await tx
      .select({ id: users.id, role: users.role, displayName: players.displayName })
      .from(users)
      .innerJoin(players, eq(players.id, users.id))
      .where(eq(users.email, normalised))
      .for('update', { of: users })
    if (!account) throw new UnknownAccountError(normalised)
    const result = { playerId: account.id, displayName: account.displayName }
    if (account.role === want) return { ...result, role: want, changed: false }
    if (want === 'player') {
      const gms = rowsOf<{ id: string }>(await tx.execute(sql`select id from users where role = 'gm' order by id for update`))
      if (gms.every((g) => g.id === account.id)) throw new LastGmError(normalised)
    }
    await tx.update(users).set({ role: want }).where(eq(users.id, account.id))
    await tx.insert(gmActions).values({
      actorUserId: null,
      action: want === 'gm' ? 'promote' : 'demote',
      targetPlayerId: account.id,
      reason: CLI_REASON,
      details: { from: account.role },
    })
    return { ...result, role: want, changed: true }
  })
}
