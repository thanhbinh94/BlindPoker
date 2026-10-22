/**
 * `node dist/reputation-backfill-cli.js [--dry-run]`: credit every existing account the reputation its history
 * already earned (Plan 27, spec §2 A6).
 *
 * Run once per deploy of Plan 27, after `docker compose up` (and `backup.sh`): first with `--dry-run`, which prints
 * the totals and the rank spread and writes nothing, then without. A rerun is a no-op for every account already
 * credited. Reads only `DATABASE_URL` — from the environment, else from `.env` in the working directory — like
 * `grant-gm-cli`. Prints `players=<n> applied=<n> ranks=[r1,r2,r3,r4,r5]`; exit 0, 2 for a missing `DATABASE_URL`
 * or an argument other than `--dry-run` (with the usage line: a mistyped flag must not run the real credit), 1 on any
 * error.
 */
import { readDotenv } from '@bp/http-kit'
import { loadAchievements } from './achievements/definitions.js'
import { createPgDb } from './db/client.js'
import { describeError } from './db/pg-errors.js'
import { loadItemCatalog } from './inventory/items.js'
import { loadAvatarManifest } from './inventory/manifest.js'
import { BACKFILL_USAGE, backfillReputation, parseBackfillArgs } from './reputation/backfill.js'

async function main(argv: string[]): Promise<number> {
  const args = parseBackfillArgs(argv)
  if (args === null) {
    console.error(BACKFILL_USAGE)
    return 2
  }
  const { dryRun } = args
  const databaseUrl = process.env['DATABASE_URL'] ?? readDotenv('.env')['DATABASE_URL']
  if (databaseUrl === undefined || databaseUrl === '') {
    console.error('DATABASE_URL is not set (environment or .env in the working directory)')
    return 2
  }
  // The catalogue the server boots with (`app.ts`): an achievement's reward decides what its unlock pays.
  const defs = loadAchievements(loadItemCatalog(undefined, loadAvatarManifest()))
  const handle = createPgDb(databaseUrl, { max: 1, onError: (err) => console.error('database pool error', String(err)) })
  try {
    const result = await backfillReputation(handle.db, { dryRun, defs })
    console.log(`${dryRun ? '(dry run) ' : ''}players=${String(result.players)} applied=${String(result.applied)} ranks=[${result.byRank.join(',')}]`)
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
