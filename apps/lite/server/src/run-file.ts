/**
 * The run file: how a Lite process tells a second copy of itself — `bind-poker-lite.exe --stop`,
 * `--status` — where it is listening and how to prove it is allowed to ask.
 *
 * Windows has no `kill -TERM`. `taskkill`, `sc stop` and closing the console window are hard kills
 * that lose in-flight Hold'em stacks, so the only graceful stop from outside the console is an HTTP
 * request to the process itself — and that request needs an address and a secret. Both live here, in
 * one small JSON file written at `listen()` and removed at `close()`.
 */
import { chmodSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Sits next to the data file, so one directory holds an instance's whole footprint. */
export const RUN_FILE_NAME = 'bind-poker.run.json'

export interface RunFile {
  pid: number
  port: number
  /** The configured listen address, verbatim — a wildcard bind is still reached over the loopback. */
  host: string
  /** 32 random bytes, hex. Regenerated on every boot: it is a handle on *this* process, not a password. */
  token: string
}

/**
 * Where this instance's run file belongs, resolved exactly like `SQLITE_PATH` is: next to the data
 * file. `:memory:` has no data file, so it falls back to the base directory (the exe's own folder
 * under SEA, the working directory otherwise).
 */
export function resolveRunFilePath(baseDir: string, sqlitePath: string): string {
  return sqlitePath === ':memory:' ? resolve(baseDir, RUN_FILE_NAME) : resolve(dirname(resolve(baseDir, sqlitePath)), RUN_FILE_NAME)
}

/**
 * Writes the file with owner-only permissions where the platform has them. The token inside is the
 * whole authorization for a shutdown, so a world-readable copy would hand it to every local account;
 * on Windows `chmod` is close to a no-op and the file's ACL is the directory's, which is why the
 * endpoint also insists on a loopback peer.
 */
export function writeRunFile(path: string, info: RunFile): void {
  writeFileSync(path, `${JSON.stringify(info, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // An existing file keeps its old mode through `writeFileSync`; a filesystem without POSIX modes
    // simply has nothing to set. Neither is a reason to refuse to start.
  }
}

/** `null` when the file is missing, unreadable or not a run file — every caller treats those alike. */
export function readRunFile(path: string): RunFile | null {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RunFile>
    if (typeof parsed.pid !== 'number' || typeof parsed.port !== 'number' || typeof parsed.host !== 'string' || typeof parsed.token !== 'string') return null
    return { pid: parsed.pid, port: parsed.port, host: parsed.host, token: parsed.token }
  } catch {
    return null
  }
}

/** Enough of a `RunFile` to prove a claim on it: the pid that wrote it and the token it published. */
export type RunFileOwner = Pick<RunFile, 'pid' | 'token'>

/**
 * Deletes the run file **only if it still describes `owner`**.
 *
 * The file is shared state in a directory, not something a process holds open, so between writing it
 * and removing it another instance may have replaced it — and unlinking that one would silently
 * disarm `--stop` for a server that is still running and still holding players' stacks. Re-reading
 * and comparing first turns the removal into a compare-and-delete: a stop that arrives late, or a
 * second process cleaning up what it thinks is stale, leaves a live instance's file alone.
 *
 * Best effort otherwise: a stop must not fail because the file was already gone.
 */
export function removeRunFile(path: string, owner: RunFileOwner): void {
  const current = readRunFile(path)
  if (current === null) return // missing, or not a run file at all — nothing of ours to take away
  if (current.pid !== owner.pid || current.token !== owner.token) return // somebody else's instance
  try {
    rmSync(path, { force: true })
  } catch {
    /* nothing to do — the next start overwrites it anyway */
  }
}

/**
 * The instance that owns `path` right now, or `null` when the file is missing, unreadable, or names
 * a pid that no longer exists (the wreckage of a hard kill, which the next start may overwrite).
 *
 * `isAlive` is injected so a test can describe a live process without having one.
 */
export function liveInstanceAt(path: string, isAlive: (pid: number) => boolean = pidAlive): RunFile | null {
  const info = readRunFile(path)
  return info !== null && isAlive(info.pid) ? info : null
}

/** True while the process exists. `EPERM` means it exists but belongs to somebody else. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}
