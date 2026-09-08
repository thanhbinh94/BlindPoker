/**
 * `node dist/grant-wardrobe-cli.js <email> [--dry-run]`: give one account the whole catalogue.
 *
 * The test account's wardrobe (bug-log CR1 §8): every item, so that equipping, the wardrobe screen
 * and the seat portraits can be checked without earning forty items first. Reads only `DATABASE_URL`
 * — from the environment, else from `.env` in the working directory — because that is all it needs;
 * unlike `migrate-cli` it does not validate the server's whole configuration, since it never starts
 * the server. `--dry-run` reports what would be granted and writes nothing.
 */
import { readDotenv } from '@bp/http-kit'
import { createPgDb } from './db/client.js'
import { describeError } from './db/pg-errors.js'
import { grantWardrobe, UnknownAccountError } from './inventory/grant-wardrobe.js'
import { loadItemCatalog } from './inventory/items.js'

const USAGE = 'usage: node dist/grant-wardrobe-cli.js <email> [--dry-run]'

async function main(argv: string[]): Promise<number> {
  const dryRun = argv.includes('--dry-run')
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
    const result = await grantWardrobe(handle.db, loadItemCatalog(), email, { dryRun })
    const verb = dryRun ? 'would grant' : 'granted'
    console.log(`${result.displayName} (${result.playerId}): ${verb} ${result.granted.length} item(s), ${result.alreadyOwned} already owned, ${result.total} in the catalogue`)
    for (const id of result.granted) console.log(`  + ${id}`)
    return 0
  } catch (err) {
    if (err instanceof UnknownAccountError) {
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
