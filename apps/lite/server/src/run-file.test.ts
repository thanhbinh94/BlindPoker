import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readRunFile, removeRunFile, resolveRunFilePath, RUN_FILE_NAME, writeRunFile } from './run-file.js'

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
  it('deletes the file and tolerates a second call', () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, INFO)
    removeRunFile(path)
    expect(existsSync(path)).toBe(false)
    expect(() => removeRunFile(path)).not.toThrow()
  })
})
