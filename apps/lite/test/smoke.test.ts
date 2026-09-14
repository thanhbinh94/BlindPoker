/**
 * Boots the release artefacts for real. `--smoke` makes the entry point listen on an ephemeral
 * port, request `/health` through the whole routing stack and exit, so a pass means the bundle (or
 * the exe) composes, opens its database and serves a request — the things a unit test running
 * inside Vitest's own process cannot prove.
 *
 * Both blocks skip when their artefact is missing, so `pnpm test` on an unbuilt checkout stays green.
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { RUN_FILE_NAME } from '../server/src/run-file.js'
import { EXE, PACKAGE_ROOT, SERVER_BUNDLE } from './paths.js'

/** Generous next to the ~1 s a warm start takes, but short enough to fail rather than hang CI. */
const BUDGET_MS = 10_000

const hasBundle = existsSync(SERVER_BUNDLE)
const hasExe = existsSync(EXE)
if (!hasBundle) console.warn(`[smoke] skipping bundle boot: ${SERVER_BUNDLE} is missing — run \`pnpm --filter @bp/lite build\` first`)
if (!hasExe) console.warn(`[smoke] skipping executable boot: ${EXE} is missing — run \`pnpm --filter @bp/lite build\` on Windows first`)

// Created on first use so a fully skipped run leaves nothing behind in the temp directory.
let scratch: string | null = null
const scratchDir = (): string => (scratch ??= mkdtempSync(join(tmpdir(), 'bp-lite-smoke-')))
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true })
})

interface Run { code: number | null; stdout: string; stderr: string; ms: number }

/**
 * Runs one smoke process to completion. The database goes to a scratch directory so the run leaves
 * nothing behind next to the exe, and `PORT` is 0 to make the intent explicit even though `--smoke`
 * overrides the port itself.
 */
function runSmoke(command: string, args: string[], label: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(command, [...args, '--smoke'], {
      cwd: PACKAGE_ROOT,
      env: { ...process.env, PORT: '0', SQLITE_PATH: join(scratchDir(), `${label}.sqlite`) },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${label} did not exit within ${BUDGET_MS} ms\nstdout: ${stdout}\nstderr: ${stderr}`))
    }, BUDGET_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ms: Date.now() - started })
    })
  })
}

/** Runs one Lite process to completion with the given argv and environment. */
function run(command: string, args: string[], env: NodeJS.ProcessEnv): Promise<Run> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const child = spawn(command, args, { cwd: PACKAGE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${args.join(' ')} did not exit within ${BUDGET_MS} ms
stdout: ${stdout}
stderr: ${stderr}`))
    }, BUDGET_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ms: Date.now() - started })
    })
  })
}

/**
 * `stderr` is reported rather than asserted empty: Node prints `ExperimentalWarning` lines for
 * features outside our control, and the release notes already tell operators to ignore them. It is
 * folded into the failure message so a non-zero exit arrives with its reason attached.
 */
function expectHealthy(run: Run, label: string): void {
  console.log(`[smoke] ${label} exited ${run.code} in ${run.ms} ms${run.stderr ? ` (stderr: ${run.stderr.trim()})` : ''}`)
  expect({ code: run.code, stderr: run.stderr }).toMatchObject({ code: 0 })
  expect(run.stdout).toContain('"status":"ok"')
  expect((JSON.parse(run.stdout.trim()) as { status: string }).status).toBe('ok')
}

/**
 * A smoke run listens for real, but it is a *second* process and often shares the data directory
 * with a live server — so it must write no run file at all. Writing one would overwrite the running
 * instance's pid and token and then delete the file on the way out, leaving that server unstoppable.
 */
function expectNoRunFile(): void {
  for (const dir of [scratchDir(), PACKAGE_ROOT]) {
    expect(existsSync(join(dir, RUN_FILE_NAME)), `${join(dir, RUN_FILE_NAME)} was left behind`).toBe(false)
  }
}

describe.skipIf(!hasBundle)('dist/server.cjs', () => {
  it('boots, answers /health and exits 0', async () => {
    expectHealthy(await runSmoke(process.execPath, [SERVER_BUNDLE], 'bundle'), 'node dist/server.cjs --smoke')
    expectNoRunFile()
  }, BUDGET_MS + 5_000)
})

/**
 * The other half of the run file's contract, and it takes two real processes to show: a second
 * server on the same data directory must refuse to start rather than overwrite the first one's run
 * file. Silently taking it over is how a live server holding players' stacks becomes unstoppable.
 *
 * Both instances bind `PORT=0`, so nothing here depends on a free fixed port — the refusal comes
 * from the run file alone, not from `EADDRINUSE`.
 */
describe.skipIf(!hasBundle)('a second instance on the same data directory', () => {
  it('refuses to start, and leaves the running instance able to stop itself', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-lite-second-'))
    const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', SQLITE_PATH: join(dir, 'bp.sqlite'), LOG_LEVEL: 'warn' }
    const runFile = join(dir, RUN_FILE_NAME)
    const first = spawn(process.execPath, [SERVER_BUNDLE], { cwd: PACKAGE_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
    try {
      const deadline = Date.now() + BUDGET_MS
      while (!existsSync(runFile) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50))
      expect(existsSync(runFile), 'the first instance published its run file').toBe(true)

      const second = await run(process.execPath, [SERVER_BUNDLE], env)
      expect(second.code, `stderr: ${second.stderr}`).toBe(1)
      expect(second.stderr).toContain('another instance is already running')
      expect(second.stderr).toContain('--stop')

      // The refusal must be inert: the first instance's file is untouched, so `--stop` still works.
      const stop = await run(process.execPath, [SERVER_BUNDLE, '--stop'], env)
      expect(stop.code, `stderr: ${stop.stderr}`).toBe(0)
      expect(stop.stdout).toContain('stopped Just a Normal Poker Lite gracefully')
      expect(existsSync(runFile)).toBe(false)
    } finally {
      first.kill()
      rmSync(dir, { recursive: true, force: true })
    }
  }, BUDGET_MS * 4)
})

describe.skipIf(!hasExe)('bind-poker-lite.exe', () => {
  it('boots, answers /health and exits 0', async () => {
    expectHealthy(await runSmoke(EXE, [], 'exe'), 'bind-poker-lite.exe --smoke')
    expectNoRunFile()
  }, BUDGET_MS + 5_000)
})

/**
 * `--smoke` only ever proves `/health`; the avatar PNGs `build.mjs` copies into `dist/public/avatar` (and the SEA
 * step embeds from there) need the exe actually *listening*, so this boots it for real, reads its own JSON log
 * for the address it bound, makes one request, and kills it.
 */
describe.skipIf(!hasExe)('bind-poker-lite.exe serving the bundled avatar assets', () => {
  it('answers GET /avatar/base_f01_L30@1x.png and the default outfit with 200', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bp-lite-avatar-'))
    const env = { ...process.env, PORT: '0', HOST: '127.0.0.1', SQLITE_PATH: join(dir, 'bp.sqlite'), LOG_LEVEL: 'info' }
    const child = spawn(EXE, [], { cwd: dirname(EXE), env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    try {
      const address = await new Promise<string>((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`exe did not report a listen address within ${BUDGET_MS} ms\nstdout: ${stdout}\nstderr: ${stderr}`)),
          BUDGET_MS,
        )
        const tryParse = (): void => {
          for (const line of stdout.split('\n')) {
            if (!line.trim().startsWith('{')) continue
            try {
              const entry = JSON.parse(line) as { msg?: string }
              if (typeof entry.msg === 'string' && entry.msg.startsWith('Listening on ')) {
                clearTimeout(timer)
                resolvePromise(entry.msg.slice('Listening on '.length))
                return
              }
            } catch {
              // an incomplete line mid-write — wait for more data
            }
          }
        }
        child.stdout.on('data', tryParse)
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
        child.on('exit', (code) => {
          clearTimeout(timer)
          reject(new Error(`exe exited (${code}) before it started listening\nstdout: ${stdout}\nstderr: ${stderr}`))
        })
      })

      const res = await fetch(`${address}/avatar/base_f01_L30@1x.png`)
      expect(res.status).toBe(200)
      await res.arrayBuffer()

      // The default outfit `defaultChibi` equips every human with — without it, every Lite seat 404s on
      // its outfit layer and renders undressed (`apps/lite/scripts/build.mjs`'s `isLiteAvatarFile`).
      const outfitRes = await fetch(`${address}/avatar/item_outfit_casual01_L40@1x.png`)
      expect(outfitRes.status).toBe(200)
      await outfitRes.arrayBuffer()
    } finally {
      child.kill()
      // On Windows the SQLite file stays locked for a moment after `kill()` — the signal is delivered
      // asynchronously, and the OS does not release the process's open handles until it has actually exited.
      // Retrying past that race beats making every run of this test wait out a fixed delay.
      await rmDirWhenUnlocked(dir)
    }
  }, BUDGET_MS + 5_000)
})

/** `rmSync` retried past a transient `EBUSY`/`EPERM` (Windows holding a just-killed process's file open a beat
 * longer than `child.kill()` takes to return) — up to ~1 s, which the process teardown never approaches in
 * practice. */
async function rmDirWhenUnlocked(dir: string, attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch (err) {
      if (attempt === attempts) throw err
      await new Promise((r) => setTimeout(r, 100))
    }
  }
}
