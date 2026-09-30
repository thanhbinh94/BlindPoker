/**
 * `run.ps1`, held to its contract.
 *
 * The script is the only piece of the Windows LAN kit that can be wrong silently: a runbook that is
 * out of date gets read and questioned, but a launcher that resolves `PUBLIC_DIR` against the wrong
 * directory or forgets to substitute `<IP-LAN>` starts a server that looks fine and serves nobody.
 * So every assertion here is about the *normalised* configuration `-DryRun` prints — the values the
 * child process would actually receive — rather than about the script's prose.
 *
 * `-DryRun` is the whole test surface, deliberately. Starting the server for real needs a Postgres
 * URL, and the point of this kit is that the operator brings their own (Neon) — and would register a
 * scheduled task on the machine running the suite. What the dry run proves is everything that
 * happens *before* the first packet: the guards, the substitutions, the launch it would make, and
 * that no secret reaches the console or the task's action. (One case runs `-Serve` instead, with an
 * `.env` it refuses at the first line — long before node or any task.)
 *
 * **The script is copied into a fixture tree rather than run in place.** `run.ps1` finds the repo
 * root from `$PSScriptRoot` and refuses to start without both built `dist` trees — so running it in
 * place would make these assertions depend on whether this checkout happens to be built, and worse,
 * on *when*: `pnpm test` runs the projects in parallel, and the bundle tests rewrite
 * `apps/normal-server/dist` while this file is executing. A throwaway `deploy/normal-windows/` with
 * empty stand-ins for the three artefacts gives the same script the same decisions to make, and
 * nothing else in the suite can move the ground under it.
 *
 * The one skip is `powershell` missing from PATH — every Linux CI run — where there is nothing to
 * exercise and saying so is the honest answer.
 */
import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REAL_SCRIPT = fileURLToPath(new URL('run.ps1', import.meta.url))

/** A long enough secret that is obviously not one, so a leak into the output is unmistakable. */
const SECRET = 'sekret-abcdefghijklmnopqrstuvwxyz-0123456789'
const GOOD_ENV = [
  'DATABASE_URL=postgres://neon_owner:hunter2@ep-test.aws.neon.tech/neondb?sslmode=verify-full',
  `SESSION_SECRET=${SECRET}`,
  'ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080',
  'PORT=8080',
  'HOST=0.0.0.0',
  'COOKIE_SECURE=false',
  'TRUST_PROXY=false',
  'PUBLIC_DIR=../../apps/normal-web/dist',
  'AUTO_MIGRATE=false',
  'LOG_LEVEL=info',
].join('\n')

function hasPowerShell(): boolean {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', 'exit 0'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const HAVE_POWERSHELL = hasPowerShell()

interface Run {
  status: number
  output: string
}

function runScript(script: string, ...args: string[]): Run {
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args]
  try {
    const stdout = execFileSync('powershell', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, output: stdout }
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: string | null; stderr?: string | null }
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** A repo-shaped directory holding a copy of the script and empty stand-ins for what it checks for. */
function makeFixture(root: string, built: boolean): string {
  const kit = join(root, 'deploy', 'normal-windows')
  mkdirSync(kit, { recursive: true })
  copyFileSync(REAL_SCRIPT, join(kit, 'run.ps1'))
  if (built) {
    mkdirSync(join(root, 'apps', 'normal-server', 'dist'), { recursive: true })
    mkdirSync(join(root, 'apps', 'normal-web', 'dist'), { recursive: true })
    writeFileSync(join(root, 'apps', 'normal-server', 'dist', 'main.js'), '')
    writeFileSync(join(root, 'apps', 'normal-server', 'dist', 'migrate-cli.js'), '')
    writeFileSync(join(root, 'apps', 'normal-web', 'dist', 'index.html'), '')
  }
  return join(kit, 'run.ps1')
}

describe.skipIf(!HAVE_POWERSHELL)('deploy/normal-windows/run.ps1 -DryRun', () => {
  let dir = ''
  let root = ''
  let script = ''

  const envFile = (name: string, contents: string): string => {
    const path = join(dir, name)
    writeFileSync(path, contents, 'utf8')
    return path
  }
  const dryRun = (name: string, contents: string, ...extra: string[]): Run =>
    runScript(script, '-DryRun', '-EnvFile', envFile(name, contents), ...extra)

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bp-win-kit-'))
    script = makeFixture(join(dir, 'repo'), true)
    // `tmpdir()` on Windows is the 8.3 short form (`…\LATHAN~1\…`); PowerShell prints the long one.
    root = realpathSync.native(join(dir, 'repo'))
  })
  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  it('refuses an environment file with no DATABASE_URL, naming the variable', () => {
    const run = dryRun('nodb.env', GOOD_ENV.split('\n').filter((line) => !line.startsWith('DATABASE_URL=')).join('\n'))
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('DATABASE_URL')
  }, 60_000)

  it('refuses the CHANGE_ME placeholders rather than starting with them', () => {
    const run = dryRun('change.env', 'DATABASE_URL=postgres://u:CHANGE_ME@host/db\nSESSION_SECRET=CHANGE_ME\nALLOWED_ORIGINS=http://localhost:8080\n')
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('CHANGE_ME')
    // Both problems in one run, not one per attempt.
    expect(run.output).toContain('DATABASE_URL')
    expect(run.output).toContain('SESSION_SECRET')
  }, 60_000)

  it('refuses a SESSION_SECRET under 32 characters', () => {
    const run = dryRun('short.env', GOOD_ENV.replace(SECRET, 'too-short'))
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('SESSION_SECRET')
    expect(run.output).toContain('32')
  }, 60_000)

  it('never echoes a mis-pasted connection string with its password in it (KEY=VALUE line, invalid key)', () => {
    // A bare Neon connection string pasted as its own line still contains an `=` (`sslmode=require`),
    // so it is read as KEY=VALUE with an invalid key — the other branch through Get-SafeLinePreview,
    // masking the *key* text rather than the whole line. Either way the password must never surface.
    const run = dryRun('paste.env', `postgresql://neondb_owner:npg_TOPSECRET@ep-x.aws.neon.tech/neondb?sslmode=require\n${GOOD_ENV}`)
    expect(run.status).not.toBe(0)
    expect(run.output).not.toContain('npg_TOPSECRET')
    expect(run.output).toContain('1') // the line number is what the operator needs to find it
  }, 60_000)

  it('never echoes a mis-pasted connection string with its password in it (no "=" at all)', () => {
    // No `=` anywhere means Read-EnvFile refuses it as not KEY=VALUE at all, previewing the whole
    // line through Get-SafeLinePreview — the masked line is short enough here to appear untruncated.
    const run = dryRun('paste-noeq.env', `postgres://u:TOPSECRET@h/db\n${GOOD_ENV}`)
    expect(run.status).not.toBe(0)
    expect(run.output).not.toContain('TOPSECRET')
    expect(run.output).toContain('postgres://u:***@h/db')
  }, 60_000)

  it('refuses a missing environment file instead of starting on defaults', () => {
    const run = runScript(script, '-DryRun', '-EnvFile', join(dir, 'nope.env'))
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('nope.env')
  }, 60_000)

  it('names the build command when dist is missing, before it looks at anything else', () => {
    const unbuilt = makeFixture(join(dir, 'unbuilt'), false)
    const run = runScript(unbuilt, '-DryRun', '-EnvFile', envFile('unbuilt.env', GOOD_ENV))
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('main.js')
    expect(run.output).toContain('pnpm build:normal')
  }, 60_000)

  it('normalises a good file: absolute PUBLIC_DIR, substituted origin, masked secrets, both commands', () => {
    const run = dryRun('good.env', GOOD_ENV)
    expect(run.status).toBe(0)

    // PUBLIC_DIR is `../../apps/normal-web/dist` in the file, relative to the server's own working
    // directory; what the server is handed is the resolved path.
    expect(run.output).toContain(`PUBLIC_DIR=${join(root, 'apps', 'normal-web', 'dist')}`)

    // `<IP-LAN>` is gone, and whatever replaced it is a plausible host — an address on this machine
    // or the documented `localhost` fallback.
    const origins = /^ {2}ALLOWED_ORIGINS=(.+)$/m.exec(run.output)?.[1]?.trim()
    expect(origins).toBeDefined()
    expect(origins).not.toContain('<IP-LAN>')
    expect(origins).toContain('http://localhost:8080')
    const lan = origins?.split(',').map((s) => s.trim()).find((s) => s !== 'http://localhost:8080')
    expect(lan).toMatch(/^http:\/\/(localhost|\d{1,3}(\.\d{1,3}){3}):8080$/)

    // Neither secret reaches the console: not the session key, not the database password.
    expect(run.output).not.toContain(SECRET)
    expect(run.output).not.toContain('hunter2')
    expect(run.output).toContain('SESSION_SECRET=***')
    expect(run.output).toContain('DATABASE_URL=postgres://neon_owner:***@ep-test.aws.neon.tech/neondb?sslmode=verify-full')

    // The two commands, and the directory they run in.
    expect(run.output).toContain('node dist/migrate-cli.js')
    expect(run.output).toContain('node dist/main.js')
    expect(run.output).toContain(join(root, 'apps', 'normal-server'))
  }, 60_000)

  it('lets -Port override the file when an origin already matches, and honours -NoMigrate', () => {
    // GOOD_ENV's ALLOWED_ORIGINS already has an entry at :8080, same as its own PORT — this just
    // exercises that -Port and -NoMigrate both reach the normalised config.
    const run = dryRun('port-ok.env', GOOD_ENV, '-Port', '8080', '-NoMigrate')
    expect(run.status).toBe(0)
    expect(run.output).toContain('PORT=8080')
    // Only the ASCII tail of the line is asserted: the prose around it is Vietnamese, and pinning
    // diacritics here would make this test a check of PowerShell 5.1's console encoding rather than
    // of the script's behaviour.
    expect(run.output).toContain('-NoMigrate) node dist/migrate-cli.js')
  }, 60_000)

  it('refuses -Port 0', () => {
    const run = dryRun('port-zero.env', GOOD_ENV, '-Port', '0')
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('-Port')
  }, 60_000)

  it('refuses -Port when no ALLOWED_ORIGINS entry matches the new port, with an actionable message, and exits non-zero even under -DryRun', () => {
    // The plain-LAN case (no proxy signalled: every origin is http://, TRUST_PROXY=false, as in
    // GOOD_ENV) is exactly where the port-match hard-fail is right — this is what must keep failing.
    const run = dryRun('port-bad.env', GOOD_ENV, '-Port', '9090')
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('ALLOWED_ORIGINS')
    expect(run.output).toContain('9090')
  }, 60_000)

  it('accepts the README §8 Cloudflare Tunnel configuration although the origin port never matches PORT', () => {
    // README §8, verbatim: PORT stays 8080 (cloudflared connects to localhost:8080), but the
    // browser's origin is the tunnel URL cloudflared prints — https://…trycloudflare.com on 443,
    // never 8080. The port-match hard-fail exists for the direct-LAN case; TRUST_PROXY=loopback (and
    // independently, the https:// scheme) must be enough to let this through instead of tripping it.
    const tunnelEnv = GOOD_ENV
      .replace('ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080', 'ALLOWED_ORIGINS=https://random-words-1234.trycloudflare.com')
      .replace('COOKIE_SECURE=false', 'COOKIE_SECURE=true')
      .replace('TRUST_PROXY=false', 'TRUST_PROXY=loopback')
    const run = dryRun('tunnel.env', tunnelEnv)
    expect(run.status).toBe(0)
    expect(run.output).toContain('ALLOWED_ORIGINS=https://random-words-1234.trycloudflare.com')
    expect(run.output).toContain('PORT=8080')
  }, 60_000)

  it('refuses a missing ALLOWED_ORIGINS', () => {
    const noOrigins = GOOD_ENV.split('\n').filter((line) => !line.startsWith('ALLOWED_ORIGINS=')).join('\n')
    const run = dryRun('no-origins.env', noOrigins)
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('ALLOWED_ORIGINS')
  }, 60_000)

  it('refuses an ALLOWED_ORIGINS entry with a trailing slash instead of silently accepting it', () => {
    // The likely mistake: pasting an address-bar URL, trailing slash and all. `config.ts` rejects
    // this at server boot (`url.origin === value`); the dry run must catch it too.
    const bad = GOOD_ENV.replace('ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080', 'ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080/')
    const run = dryRun('trailing-slash.env', bad)
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('ALLOWED_ORIGINS')
  }, 60_000)

  it('refuses an ALLOWED_ORIGINS entry with a path', () => {
    const bad = GOOD_ENV.replace('ALLOWED_ORIGINS=http://localhost:8080,http://<IP-LAN>:8080', 'ALLOWED_ORIGINS=http://localhost:8080/app')
    const run = dryRun('with-path.env', bad)
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('ALLOWED_ORIGINS')
  }, 60_000)

  // The launch mode (bug log R2-5). By default the server runs as a scheduled task, detached from the
  // console that started it; the dry run prints the exact action section 11 would register. That
  // action is stored in the task's definition, readable in Task Scheduler — so it must hold paths and
  // nothing else, which is what these pin.
  const actionOf = (output: string): string | undefined => /^ {2}Action: (.+)$/m.exec(output)?.[1]?.trim()

  it('launches detached by default: names the task, and its action runs -Serve on the env file with no secret in it', () => {
    const run = dryRun('detached.env', GOOD_ENV)
    expect(run.status).toBe(0)
    // ASCII fragments only, as above: the prose around them is Vietnamese.
    expect(run.output).toContain('detached')
    expect(run.output).toContain("scheduled task 'BlindLuckPoker-Normal'")

    const action = actionOf(run.output)
    expect(action).toBeDefined()
    expect(action).toContain('powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "')
    expect(action).toContain(`${join(root, 'deploy', 'normal-windows', 'run.ps1')}" -Serve -EnvFile "`)
    expect(action).toMatch(/-EnvFile "[^"]+detached\.env"$/)
    // Neither -Port nor -LanIp was passed, so neither is baked into the task.
    expect(action).not.toContain('-Port')
    expect(action).not.toContain('-LanIp')
    // No secret, and not even the names of the variables that hold them.
    expect(action).not.toContain(SECRET)
    expect(action).not.toContain('hunter2')
    expect(action).not.toContain('DATABASE_URL')
    expect(action).not.toContain('SESSION_SECRET')

    // No logon trigger unless asked for.
    expect(run.output).toContain('Trigger:')
    expect(run.output).not.toContain('AtLogOn')
  }, 60_000)

  it('carries -Port and -LanIp into the task action when the caller passed them', () => {
    const run = dryRun('detached-port.env', GOOD_ENV, '-Port', '8080', '-LanIp', '192.168.77.5')
    expect(run.status).toBe(0)
    const action = actionOf(run.output)
    expect(action).toMatch(/ -Serve -EnvFile "[^"]+" -Port 8080 -LanIp "192\.168\.77\.5"$/)
    expect(action).not.toContain(SECRET)
    expect(action).not.toContain('hunter2')
  }, 60_000)

  it('-AutoStart adds the AtLogOn trigger; -TaskName renames the task', () => {
    const run = dryRun('autostart.env', GOOD_ENV, '-AutoStart', '-TaskName', 'BlindLuckPoker-Normal-other')
    expect(run.status).toBe(0)
    expect(run.output).toContain("scheduled task 'BlindLuckPoker-Normal-other'")
    expect(run.output).toContain('Trigger: AtLogOn (-AutoStart)')
  }, 60_000)

  it('-Foreground says foreground and describes no task', () => {
    const run = dryRun('foreground.env', GOOD_ENV, '-Foreground')
    expect(run.status).toBe(0)
    expect(run.output).toContain('foreground (-Foreground)')
    expect(run.output).not.toContain('detached')
    expect(run.output).not.toContain('Action:')
    expect(run.output).not.toContain('Trigger:')
  }, 60_000)

  it('refuses flag combinations that mean nothing: -Foreground with -AutoStart, and -Serve outside the task', () => {
    const both = dryRun('fg-auto.env', GOOD_ENV, '-Foreground', '-AutoStart')
    expect(both.status).not.toBe(0)
    expect(both.output).toContain('-AutoStart')

    // -Serve starts node for real, so the only safe way to exercise it here is a combination it
    // refuses before it reads anything.
    const serve = dryRun('serve-dry.env', GOOD_ENV, '-Serve')
    expect(serve.status).not.toBe(0)
    expect(serve.output).toContain('-Serve')
    expect(serve.output).not.toContain('node dist/main.js')
  }, 60_000)

  it('refuses a -TaskName Task Scheduler would misread', () => {
    // `\` would make a folder path, `*` a wildcard pattern to the ScheduledTasks cmdlets.
    for (const bad of ['a\\b', 'BlindLuckPoker-*']) {
      const run = dryRun('bad-task.env', GOOD_ENV, '-TaskName', bad)
      expect(run.status).not.toBe(0)
      expect(run.output).toContain('-TaskName')
    }
  }, 60_000)

  it('holds -LanIp to an IPv4 address or a host name before it reaches the task action', () => {
    for (const bad of ['999.1.1.1', 'two words', 'a"b']) {
      const run = dryRun('bad-lan.env', GOOD_ENV, '-LanIp', bad)
      expect(run.status).not.toBe(0)
      expect(run.output).toContain('-LanIp')
    }
    const named = dryRun('named-lan.env', GOOD_ENV, '-LanIp', 'poker-host.local')
    expect(named.status).toBe(0)
    expect(actionOf(named.output)).toMatch(/ -LanIp "poker-host\.local"$/)
  }, 90_000)

  it('under -Serve, names a malformed .env line by number only — on stderr and in normal.serve.log', () => {
    // -Serve writes into a file that outlives the run, so not even the masked preview a console run
    // prints may go there. The line is refused in section 3, long before anything would start.
    const serveLog = join(dirname(script), 'normal.serve.log')
    const run = runScript(script, '-Serve', '-EnvFile', envFile('serve-bad.env', `postgres://u:TOPSECRET@h/db\n${GOOD_ENV}`))
    expect(run.status).not.toBe(0)
    expect(run.output).toContain('KEY=VALUE')
    expect(run.output).not.toContain('TOPSECRET')
    expect(run.output).not.toContain('postgres://')

    expect(existsSync(serveLog)).toBe(true)
    const logged = readFileSync(serveLog, 'utf8')
    expect(logged).toContain('KEY=VALUE')
    expect(logged).not.toContain('TOPSECRET')
    expect(logged).not.toContain('postgres://')
    expect(logged).not.toContain(SECRET)
  }, 60_000)
})

if (!HAVE_POWERSHELL) {
  // Not a warning about a broken test — a note about which machine this is, expected on every Linux
  // CI runner.
  console.warn('skipping deploy/normal-windows/run.test.ts: powershell is not on PATH')
}
