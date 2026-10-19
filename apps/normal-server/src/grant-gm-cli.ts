/**
 * `node dist/grant-gm-cli.js <email> [--revoke]`: make one account a GM, or take the role back.
 *
 * The first GM cannot be made from the API (only a GM promotes), so the operator makes one here, on the server.
 * Reads only `DATABASE_URL` — from the environment, else from `.env` in the working directory — like
 * `grant-wardrobe-cli`, and logs the change in `gm_actions` as a CLI action with no actor. `--revoke` refuses to
 * demote the only GM, and a locked account is not promoted (exit 1 for both).
 */
import { readDotenv } from '@bp/http-kit'
import { createPgDb } from './db/client.js'
import { describeError } from './db/pg-errors.js'
import { grantGm, LastGmError, LockedAccountError, UnknownAccountError } from './gm/grant-gm.js'

const USAGE = 'usage: node dist/grant-gm-cli.js <email> [--revoke]'

async function main(argv: string[]): Promise<number> {
  const revoke = argv.includes('--revoke')
  const email = argv.find((a) => !a.startsWith('--'))
  if (email === undefined) {
    console.error(USAGE)
    return 2
  }
  const databaseUrl = process.env['DATABASE_URL'] ?? readDotenv('.env')['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('DATABASE_URL is not set (environment or .env in the working directory)')
    return 2
  }
  const handle = createPgDb(databaseUrl, { max: 1, onError: (err) => console.error('database pool error', String(err)) })
  try {
    const result = await grantGm(handle.db, email, { revoke })
    const what = result.changed ? `is now ${result.role === 'gm' ? 'a gm' : 'a player'}` : `was already ${result.role === 'gm' ? 'a gm' : 'a player'}`
    console.log(`${result.displayName} (${result.playerId}) ${what}`)
    return 0
  } catch (err) {
    if (err instanceof UnknownAccountError || err instanceof LastGmError || err instanceof LockedAccountError) {
      console.error(err.message)
      return 1
    }
    throw err
  } finally {
    await handle.close()
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(describeError(err))
    process.exit(1)
  },
)
