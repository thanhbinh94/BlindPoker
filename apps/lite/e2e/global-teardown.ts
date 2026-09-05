import { readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Playwright stops its `webServer` with a hard kill, so the Lite server never runs `close()` and its
 * `bind-poker.run.json` stays behind in `apps/lite/`. The next `pnpm test` then finds a run file whose
 * pid is dead and `smoke.test.ts` reads that as another instance. Remove it here — but only when it is
 * the e2e server's own file (the port pins it), never an operator's.
 */
const E2E_PORT = 8090
const RUN_FILE = fileURLToPath(new URL('../bind-poker.run.json', import.meta.url))

export default function globalTeardown(): void {
  let port: unknown
  try {
    port = (JSON.parse(readFileSync(RUN_FILE, 'utf8')) as { port?: unknown }).port
  } catch {
    return // no run file, or not ours to parse
  }
  if (port === E2E_PORT) {
    try {
      unlinkSync(RUN_FILE)
    } catch {
      /* already gone */
    }
  }
}
