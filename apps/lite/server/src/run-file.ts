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
 * The address a run file points at. The file records the *configured* listen address; a wildcard
 * bind (or an empty one) is reached over the loopback, and a bare IPv6 literal needs its brackets.
 */
export function runFileUrl(info: Pick<RunFile, 'host' | 'port'>): string {
  const host = info.host === '0.0.0.0' || info.host === '::' || info.host === '' ? '127.0.0.1' : info.host
  return `http://${host.includes(':') ? `[${host}]` : host}:${info.port}`
}

/** How long the start-up probe waits for the recorded address to identify itself. */
export const PROBE_TIMEOUT_MS = 1000

/** What a run file found on disk turns out to be worth. */
export type RunFileClaim =
  /** No file, or nothing that parses as one: the directory is free. */
  | { state: 'vacant' }
  /** A Lite instance answered at the recorded address. Starting here would fight it. */
  | { state: 'held'; info: RunFile }
  /** A file, but nothing of ours behind it. `why` is the one line the operator gets. */
  | { state: 'stale'; info: RunFile; why: string }
  /**
   * The pid is alive and the recorded address neither refused the connection nor answered, on two
   * tries. That is not proof of anything — a live instance too busy to answer for a couple of
   * seconds looks identical from here to nothing being there at all — so this is not `stale`
   * (overwriting would risk fighting a live server on the port it already holds) and not `held`
   * (nothing actually answered as Lite). `why` is the one line the operator gets.
   */
  | { state: 'unreachable'; info: RunFile; why: string }

/**
 * The `code` on a failed `fetch`, walking into `.cause` where undici nests the real `node:net`
 * error (a rejected `fetch` is itself a generic `TypeError: fetch failed`).
 */
function errorCode(err: unknown): string | undefined {
  const direct = err !== null && typeof err === 'object' ? (err as { code?: unknown }).code : undefined
  if (typeof direct === 'string') return direct
  const cause = err !== null && typeof err === 'object' ? (err as { cause?: unknown }).cause : undefined
  const nested = cause !== null && typeof cause === 'object' ? (cause as { code?: unknown }).code : undefined
  return typeof nested === 'string' ? nested : undefined
}

/**
 * `true` only when the rejection *proves* nothing is listening at the address — a refused
 * connection, or a host name that does not resolve. Every other failure (the probe's own
 * `AbortSignal.timeout` firing, a reset mid-response, …) is silence, not evidence: a live instance
 * whose event loop is busy for a moment looks exactly the same.
 */
function isConclusivelyGone(err: unknown): boolean {
  const code = errorCode(err)
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND'
}

type ProbeOutcome = { kind: 'ok'; res: Response } | { kind: 'refused' } | { kind: 'timeout' }

async function probeOnce(url: string, timeoutMs: number): Promise<ProbeOutcome> {
  try {
    return { kind: 'ok', res: await fetch(url, { signal: AbortSignal.timeout(timeoutMs) }) }
  } catch (err) {
    return { kind: isConclusivelyGone(err) ? 'refused' : 'timeout' }
  }
}

/**
 * Who owns `path` right now.
 *
 * A live pid used to be the whole answer, and it was wrong in the one case the run file exists for:
 * after a hard kill (`taskkill`, `sc stop`, the window's X) the file survives, and the operating
 * system is free to hand that pid to anything at all — a browser, a build, the operator's shell.
 * Then the next start refuses with "another instance is already running" and names a pid that has
 * never heard of Bind Poker. So the pid is only the cheap first question; the deciding one is
 * whether the *recorded address* still answers as Lite, which `GET /api/config` says outright
 * (`edition: 'lite'` — the same field Normal answers `'normal'` to).
 *
 * The probe's two failure shapes are not the same evidence. A refused connection (or a name that
 * does not resolve) is conclusive — nothing is there, so the file is wreckage and gets overwritten.
 * A timeout is only the absence of an answer within `PROBE_TIMEOUT_MS`, which a live instance can
 * produce too if it is briefly too busy to reply; taken as proof, it would make the guard weaker
 * than the pid-only check it replaced. So a timeout earns one retry with the same budget, and only
 * if *that* also times out does this give up — not by overwriting, but by refusing to start at all,
 * leaving the decision to the operator (`--stop`, or check what else is on the port).
 *
 * The two injectable seams keep the test honest: `isAlive` lets a test describe a live pid without
 * having one, and the probe is the real `fetch` against a real listener.
 */
export async function claimRunFile(
  path: string,
  { isAlive = pidAlive, timeoutMs = PROBE_TIMEOUT_MS }: { isAlive?: (pid: number) => boolean; timeoutMs?: number } = {},
): Promise<RunFileClaim> {
  const info = readRunFile(path)
  if (info === null) return { state: 'vacant' }
  if (!isAlive(info.pid)) return { state: 'stale', info, why: `pid ${info.pid} is gone` }

  const url = `${runFileUrl(info)}/api/config`

  let outcome = await probeOnce(url, timeoutMs)
  if (outcome.kind === 'timeout') outcome = await probeOnce(url, timeoutMs)

  if (outcome.kind === 'refused') return { state: 'stale', info, why: `connection refused at ${url} — nothing is listening there` }
  if (outcome.kind === 'timeout') {
    return {
      state: 'unreachable',
      info,
      why: `${url} did not identify itself within ${timeoutMs} ms, twice in a row`,
    }
  }

  const res = outcome.res
  if (!res.ok) return { state: 'stale', info, why: `${url} answered HTTP ${res.status}` }

  let edition: unknown
  try {
    edition = ((await res.json()) as { edition?: unknown }).edition
  } catch {
    return { state: 'stale', info, why: `${url} did not answer JSON` }
  }
  if (edition !== 'lite') return { state: 'stale', info, why: `${url} is not a Bind Poker Lite instance` }
  return { state: 'held', info }
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
