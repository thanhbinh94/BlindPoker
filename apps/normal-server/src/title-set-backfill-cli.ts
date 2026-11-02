/**
 * `node dist/title-set-backfill-cli.js [--dry-run]`: hand every existing holder of a Thần title the wardrobe set that
 * came after it (Plan 43).
 *
 * Run once per deploy of Plan 43, after `docker compose up` (and `backup.sh`): first with `--dry-run`, which prints
 * the totals and writes nothing, then without. A rerun is a no-op. Writes inventory rows only — no points, no ledger,
 * no reputation. Reads only `DATABASE_URL` — from the environment, else from `.env` in the working directory — like
 * `reputation-backfill-cli`. Prints `players=<n> granted=<n>`, prefixed `(dry run) ` for a dry run; exit 0, 2 for a
 * missing `DATABASE_URL` or an argument other than `--dry-run` (with the usage line: a mistyped flag must not run the
 * real grant), 1 on any error.
 */
import { readDotenv } from '@bp/http-kit'
import { loadAchievements } from './achievements/definitions.js'
import { createPgDb } from './db/client.js'
import { describeError } from './db/pg-errors.js'
import { loadItemCatalog } from './inventory/items.js'
import { loadAvatarManifest } from './inventory/manifest.js'
import { backfillTitleSets, parseTitleSetArgs, TITLE_SET_USAGE } from './inventory/title-sets.js'

async function main(argv: string[]): Promise<number> {
  const args = parseTitleSetArgs(argv)
  if (args === null) {
    console.error(TITLE_SET_USAGE)
    return 2
  }
  const { dryRun } = args
  const databaseUrl = process.env['DATABASE_URL'] ?? readDotenv('.env')['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('DATABASE_URL is not set (environment or .env in the working directory)')
    return 2
  }
  // The catalogue the server boots with (`app.ts`): an achievement's reward decides what its unlock hands over.
  const defs = loadAchievements(loadItemCatalog(undefined, loadAvatarManifest()))
  const handle = createPgDb(databaseUrl, { max: 1, onError: (err) => console.error('database pool error', String(err)) })
  try {
    const result = await backfillTitleSets(handle.db, { dryRun, defs })
    console.log(`${dryRun ? '(dry run) ' : ''}players=${String(result.players)} granted=${String(result.granted)}`)
    return 0
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
