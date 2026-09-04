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
import { join } from 'node:path'
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
 * A smoke run listens for real, so it writes a run file — and it must take it away again. One left
 * behind would make the next `--stop` chase a pid that no longer exists.
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

describe.skipIf(!hasExe)('bind-poker-lite.exe', () => {
  it('boots, answers /health and exits 0', async () => {
    expectHealthy(await runSmoke(EXE, [], 'exe'), 'bind-poker-lite.exe --smoke')
    expectNoRunFile()
  }, BUDGET_MS + 5_000)
})
