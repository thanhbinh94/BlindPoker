import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { liveInstanceAt, pidAlive, readRunFile, removeRunFile, resolveRunFilePath, RUN_FILE_NAME, writeRunFile } from './run-file.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-runfile-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const INFO = { pid: 4242, port: 8080, host: '0.0.0.0', token: 'a'.repeat(64) }

describe('resolveRunFilePath', () => {
  it('puts the file next to a relative data file, resolved against the base directory', () => {
    expect(resolveRunFilePath('/srv/bp', './bind-poker.sqlite')).toBe(resolve('/srv/bp', RUN_FILE_NAME))
    expect(resolveRunFilePath('/srv/bp', 'data/bind-poker.sqlite')).toBe(resolve('/srv/bp/data', RUN_FILE_NAME))
  })

  it('follows an absolute data file to its own directory', () => {
    expect(resolveRunFilePath('/srv/bp', resolve('/var/lib/bp/db.sqlite'))).toBe(resolve('/var/lib/bp', RUN_FILE_NAME))
  })

  it('falls back to the base directory when there is no data file at all', () => {
    expect(resolveRunFilePath('/srv/bp', ':memory:')).toBe(resolve('/srv/bp', RUN_FILE_NAME))
  })
})

describe('writeRunFile / readRunFile', () => {
  it('round-trips the instance record', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    expect(readRunFile(path)).toEqual(INFO)
    expect(readFileSync(path, 'utf8')).toMatch(/\n$/)
  })

  it('keeps the file owner-only where the platform has file modes', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    // Windows reports 0o666 whatever mode is asked for; there the loopback check is the guard.
    if (process.platform !== 'win32') expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('overwrites a run file left behind by a hard kill', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, { ...INFO, pid: 1, token: 'b'.repeat(64) })
    writeRunFile(path, INFO)
    expect(readRunFile(path)).toEqual(INFO)
  })

  it('reads back null for a missing, unparseable or incomplete file', () => {
    const dir = tempDir()
    expect(readRunFile(join(dir, 'nope.json'))).toBeNull()

    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ not json')
    expect(readRunFile(broken)).toBeNull()

    const partial = join(dir, 'partial.json')
    writeFileSync(partial, JSON.stringify({ pid: 1, port: 8080 }))
    expect(readRunFile(partial)).toBeNull()

    const wrongTypes = join(dir, 'types.json')
    writeFileSync(wrongTypes, JSON.stringify({ pid: '1', port: '8080', host: 1, token: 2 }))
    expect(readRunFile(wrongTypes)).toBeNull()
  })
})

describe('removeRunFile', () => {
  const owner = { pid: INFO.pid, token: INFO.token }

  it('deletes the file it owns and tolerates a second call', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    removeRunFile(path, owner)
    expect(existsSync(path)).toBe(false)
    expect(() => removeRunFile(path, owner)).not.toThrow()
  })

  /**
   * The file is shared state in a directory, not a handle. Between one instance writing it and
   * removing it, another may have replaced it — and unlinking *that* would silently disarm `--stop`
   * for a server still holding players' stacks.
   */
  it('leaves a file that another instance has since taken over', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    const successor = { ...INFO, pid: INFO.pid + 1, token: 'c'.repeat(64) }
    writeRunFile(path, successor)

    removeRunFile(path, owner)

    expect(existsSync(path)).toBe(true)
    expect(readRunFile(path)).toEqual(successor)
  })

  it('leaves a file whose token differs even when the pid happens to match', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, { ...INFO, token: 'd'.repeat(64) })

    removeRunFile(path, owner)

    expect(existsSync(path)).toBe(true)
  })

  it('leaves a file it cannot read rather than guessing', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeFileSync(path, '{ not json')
    removeRunFile(path, owner)
    expect(existsSync(path)).toBe(true)
  })
})

describe('liveInstanceAt', () => {
  it('reports the instance when its pid is alive', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    expect(liveInstanceAt(path, () => true)).toEqual(INFO)
  })

  it('reports nothing when the pid is gone — the wreckage of a hard kill is not an owner', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    expect(liveInstanceAt(path, () => false)).toBeNull()
  })

  it('reports nothing when there is no run file at all', () => {
    expect(liveInstanceAt(join(tempDir(), RUN_FILE_NAME), () => true)).toBeNull()
  })

  it('defaults to asking the operating system', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, { ...INFO, pid: process.pid })
    expect(liveInstanceAt(path)?.pid).toBe(process.pid)
  })
})

describe('pidAlive', () => {
  it('is true for this process and false for a pid that cannot exist', () => {
    expect(pidAlive(process.pid)).toBe(true)
    // Well above any plausible live pid on Windows or Linux, and never 0 (which means "this group").
    expect(pidAlive(0x7ffffffe)).toBe(false)
  })
})
