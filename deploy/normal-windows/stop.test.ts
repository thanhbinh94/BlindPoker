/**
 * `stop.ps1`, specifically its one dangerous guard: Windows reuses pids, and a pid file outlives the
 * process that wrote it, so a naive "kill whatever this pid is now" would eventually murder someone's
 * editor or browser. `stop.ps1` refuses unless the process at that pid is still named `node`. The
 * reviewer verified this by hand for all four cases (missing file / dead pid / garbage pid / pid
 * reused by a non-node process) — nothing pins it, so a future edit that drops the `node` check would
 * stay green. These two cases cover the ones a hand check cannot repeat cheaply on every run: a real
 * live process wearing a stale pid, and a genuinely stale one.
 *
 * No server is started here — for the pid cases `stop.ps1` only looks at a pid file and
 * `Get-Process`, so a throwaway `powershell -Command Start-Sleep` stands in for "some unrelated
 * process now owns this pid", and is killed by the test itself in `finally` regardless of what
 * `stop.ps1` did.
 *
 * **Every run names a scheduled task that is not the real one.** After the pid, `stop.ps1` stops the
 * kit's scheduled task (`BlindLuckPoker-Normal` by default) if it is running — and the machine
 * running this suite may be the one hosting the LAN server under that very task. So each call passes
 * `-TaskName` with a name no real task has, and the task cases register their own tasks under unique
 * names (never started, no trigger) — shaped like this kit's, or deliberately not — and remove them
 * again in `finally`. The wildcard case uses a pattern that could only ever match its own decoy.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REAL_STOP = fileURLToPath(new URL('stop.ps1', import.meta.url))

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

/** Unique per run, so neither a real task nor a parallel run of this file can be touched. */
const TEST_TASK_PREFIX = `BlindLuckPoker-Normal-vitest-${process.pid}-${Date.now()}`
const ABSENT_TASK = `${TEST_TASK_PREFIX}-absent`

function runStop(...args: string[]): Run {
  const withTask = args.includes('-TaskName') ? args : [...args, '-TaskName', ABSENT_TASK]
  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', REAL_STOP, ...withTask]
  try {
    const stdout = execFileSync('powershell', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    return { status: 0, output: stdout }
  } catch (err) {
    const failure = err as { status?: number | null; stdout?: string | null; stderr?: string | null }
    return { status: failure.status ?? -1, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** True once `Get-Process -Id` (run through the same powershell as the script) can no longer find it. */
function isAlive(pid: number): boolean {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', `Get-Process -Id ${pid} -ErrorAction Stop | Out-Null`], {
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/**
 * Runs a PowerShell command with values passed through the environment (`$env:BP_*`) rather than
 * spliced into its text — task names and quoted paths then need no escaping at all.
 */
function powershell(command: string, env: Record<string, string> = {}): { ok: boolean; stdout: string } {
  try {
    const stdout = execFileSync('powershell', ['-NoProfile', '-Command', command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      env: { ...process.env, ...env },
    })
    return { ok: true, stdout }
  } catch {
    return { ok: false, stdout: '' }
  }
}

/** The run.ps1 beside the stop.ps1 under test: the only script whose tasks stop.ps1 may touch. */
const REAL_RUN = realpathSync.native(fileURLToPath(new URL('run.ps1', import.meta.url)))

/** An action shaped exactly like the one run.ps1 registers — for this checkout's run.ps1. */
const OWN_ACTION = {
  execute: 'powershell.exe',
  args: `-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${REAL_RUN}" -Serve -EnvFile "C:\\never\\started.env"`,
}
/** Somebody else's task that merely has a kit-like name. */
const FOREIGN_ACTION = { execute: 'cmd.exe', args: '/c exit 0' }

/**
 * Registers a task for the current user (logged-on only, not elevated) with the given action. It is
 * never started and has no trigger, so registering it runs nothing. False when this machine cannot
 * register one at all (no Task Scheduler service, say).
 */
function registerTask(name: string, action: { execute: string; args: string }): boolean {
  return powershell(
    [
      "$ErrorActionPreference = 'Stop'",
      '$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name',
      '$action = New-ScheduledTaskAction -Execute $env:BP_TASK_EXE -Argument $env:BP_TASK_ARGS',
      '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
      "Register-ScheduledTask -TaskName $env:BP_TASK_NAME -TaskPath '\\' -Action $action -Principal $principal | Out-Null",
    ].join('; '),
    { BP_TASK_NAME: name, BP_TASK_EXE: action.execute, BP_TASK_ARGS: action.args },
  ).ok
}

// Exact-name lookups (`-eq`), never `-TaskName`: that parameter takes wildcard patterns.
const FIND_TASK = "Get-ScheduledTask -TaskPath '\\' -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -eq $env:BP_TASK_NAME }"

function taskExists(name: string): boolean {
  return powershell(`if (@(${FIND_TASK}).Count -gt 0) { exit 0 } else { exit 1 }`, { BP_TASK_NAME: name }).ok
}

function unregisterTask(name: string): void {
  powershell(`${FIND_TASK} | Unregister-ScheduledTask -Confirm:$false`, { BP_TASK_NAME: name })
}

/** Every task in the root folder, by name — to prove a refused call changed none of them. */
function rootTaskNames(): string {
  return powershell("(@(Get-ScheduledTask -TaskPath '\\' -ErrorAction SilentlyContinue | ForEach-Object { $_.TaskName }) | Sort-Object) -join '|'").stdout.trim()
}

describe.skipIf(!HAVE_POWERSHELL)('deploy/normal-windows/stop.ps1', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'bp-win-stop-'))
  })
  afterAll(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a pid file whose pid is now a live non-node process, names it, and kills nothing', async () => {
    const decoy = spawn('powershell', ['-NoProfile', '-Command', 'Start-Sleep -Seconds 30'], { stdio: 'ignore' })
    try {
      const pid = decoy.pid
      expect(pid).toBeTypeOf('number')
      // `spawn` returns the pid as soon as the OS assigns it; give Get-Process a moment to see it too.
      await sleep(500)
      expect(isAlive(pid as number)).toBe(true)

      const pidFile = join(dir, 'reused.pid')
      writeFileSync(pidFile, String(pid), 'utf8')

      const run = runStop('-PidFile', pidFile)

      expect(run.status).not.toBe(0)
      // Names the real pid and the real process name, not "node".
      expect(run.output).toContain(String(pid))
      expect(run.output).toContain('powershell')
      // The pid file is untouched — stop.ps1 must not have decided this was a stale entry.
      expect(existsSync(pidFile)).toBe(true)
      // And, the one thing that actually matters: the decoy is still running.
      expect(isAlive(pid as number)).toBe(true)
    } finally {
      if (decoy.pid !== undefined && !decoy.killed) {
        try {
          process.kill(decoy.pid)
        } catch {
          // already gone
        }
      }
    }
  }, 30_000)

  it('removes a stale pid file and exits 0', () => {
    const pidFile = join(dir, 'stale.pid')
    // A plausible-looking pid that is not a live process on this machine.
    writeFileSync(pidFile, '999997', 'utf8')

    const run = runStop('-PidFile', pidFile)

    expect(run.status).toBe(0)
    expect(run.output).toContain('999997')
    expect(existsSync(pidFile)).toBe(false)
  }, 30_000)

  it('refuses a pid that is now another node process (not dist/main.js), and kills nothing', async () => {
    // A node that is not this kit's server — a dev server that inherited the pid, say.
    const decoy = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })
    try {
      const pid = decoy.pid
      expect(pid).toBeTypeOf('number')
      await sleep(500)
      expect(isAlive(pid as number)).toBe(true)

      const pidFile = join(dir, 'other-node.pid')
      writeFileSync(pidFile, String(pid), 'utf8')

      const run = runStop('-PidFile', pidFile)

      expect(run.status).not.toBe(0)
      expect(run.output).toContain(String(pid))
      expect(run.output).toContain('dist/main.js')
      expect(existsSync(pidFile)).toBe(true)
      expect(isAlive(pid as number)).toBe(true)
    } finally {
      decoy.kill()
    }
  }, 30_000)

  it('refuses a wildcard or otherwise invalid -TaskName before it looks at any task', (ctx) => {
    // The pattern can only ever match this test's own decoy — and the decoy is shaped like a real
    // kit task, so the name check is the only thing that can keep it registered.
    const decoy = `${TEST_TASK_PREFIX}-glob-decoy`
    if (!registerTask(decoy, OWN_ACTION)) {
      ctx.skip()
      return
    }
    try {
      const before = rootTaskNames()
      const missingPid = join(dir, 'no-such.pid')
      for (const bad of [`${TEST_TASK_PREFIX}-glob-*`, `${TEST_TASK_PREFIX}-glob-?ecoy`, 'two words']) {
        const run = runStop('-PidFile', missingPid, '-TaskName', bad, '-Remove')
        expect(run.status).not.toBe(0)
        expect(run.output).toContain('-TaskName')
      }
      expect(taskExists(decoy)).toBe(true)
      expect(rootTaskNames()).toBe(before)
    } finally {
      unregisterTask(decoy)
    }
  }, 90_000)

  it('refuses -Remove on a same-named task that is not this kit\'s, and leaves it registered', (ctx) => {
    const name = `${TEST_TASK_PREFIX}-foreign`
    if (!registerTask(name, FOREIGN_ACTION)) {
      ctx.skip()
      return
    }
    try {
      const missingPid = join(dir, 'no-such.pid')
      const removed = runStop('-PidFile', missingPid, '-TaskName', name, '-Remove')
      expect(removed.status).not.toBe(0)
      expect(removed.output).toContain(name)
      expect(taskExists(name)).toBe(true)

      // A plain stop leaves it alone too, and says so rather than failing the stop.
      const plain = runStop('-PidFile', missingPid, '-TaskName', name)
      expect(plain.status).toBe(0)
      expect(plain.output).toContain(name)
      expect(taskExists(name)).toBe(true)
    } finally {
      unregisterTask(name)
    }
  }, 60_000)

  it('keeps the scheduled task on a plain stop, and unregisters it only under -Remove', (ctx) => {
    const name = `${TEST_TASK_PREFIX}-remove`
    if (!registerTask(name, OWN_ACTION)) {
      ctx.skip()
      return
    }
    try {
      expect(taskExists(name)).toBe(true)
      const missingPid = join(dir, 'no-such.pid')

      // A plain stop with no server: nothing to kill, and the task a later run.ps1 reuses stays.
      const plain = runStop('-PidFile', missingPid, '-TaskName', name)
      expect(plain.status).toBe(0)
      expect(taskExists(name)).toBe(true)

      const removed = runStop('-PidFile', missingPid, '-TaskName', name, '-Remove')
      expect(removed.status).toBe(0)
      expect(removed.output).toContain(name)
      expect(taskExists(name)).toBe(false)

      // Removing what is already gone is not an error — uninstalling twice is still uninstalled.
      const again = runStop('-PidFile', missingPid, '-TaskName', name, '-Remove')
      expect(again.status).toBe(0)
      expect(again.output).toContain(name)
    } finally {
      unregisterTask(name)
    }
  }, 60_000)
})

if (!HAVE_POWERSHELL) {
  console.warn('skipping deploy/normal-windows/stop.test.ts: powershell is not on PATH')
}
