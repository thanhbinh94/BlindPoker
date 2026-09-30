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
 * `-TaskName` with a name no real task has, and the `-Remove` case registers its own do-nothing task
 * (never started, no trigger) under a unique name and removes it again in `finally`.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function powershell(command: string): boolean {
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', command], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * A task shaped like the kit's (the current user, logged-on only, not elevated) whose action does
 * nothing. It is never started and has no trigger, so registering it runs nothing. False when this
 * machine cannot register one at all (no Task Scheduler service, say).
 */
function registerIdleTask(name: string): boolean {
  return powershell(
    [
      "$ErrorActionPreference = 'Stop'",
      '$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name',
      "$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument '/c exit 0'",
      '$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited',
      `Register-ScheduledTask -TaskName '${name}' -TaskPath '\\' -Action $action -Principal $principal | Out-Null`,
    ].join('; '),
  )
}

function taskExists(name: string): boolean {
  return powershell(`if (Get-ScheduledTask -TaskName '${name}' -TaskPath '\\' -ErrorAction SilentlyContinue) { exit 0 } else { exit 1 }`)
}

function unregisterTask(name: string): void {
  powershell(`Unregister-ScheduledTask -TaskName '${name}' -TaskPath '\\' -Confirm:$false -ErrorAction SilentlyContinue`)
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

  it('keeps the scheduled task on a plain stop, and unregisters it only under -Remove', (ctx) => {
    const name = `${TEST_TASK_PREFIX}-remove`
    if (!registerIdleTask(name)) {
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
