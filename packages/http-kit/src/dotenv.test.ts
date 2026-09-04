import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseDotenv, readDotenv } from './dotenv.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-dotenv-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseDotenv', () => {
  it('parses keys, quotes, comments and blanks', () => {
    expect(parseDotenv('# c\nPORT=9000\nHOST="127.0.0.1"\nSQLITE_PATH=\'./x.sqlite\'\n\nLOG_LEVEL=debug # trailing\n')).toEqual({ PORT: '9000', HOST: '127.0.0.1', SQLITE_PATH: './x.sqlite', LOG_LEVEL: 'debug' })
  })
  it('strips a trailing comment after a quoted value, and only comment-strips unquoted values', () => {
    expect(parseDotenv('HOST="127.0.0.1" # note')).toEqual({ HOST: '127.0.0.1' })
    expect(parseDotenv("A='x=y' # c")).toEqual({ A: 'x=y' })
    expect(parseDotenv('B=plain#nohash')).toEqual({ B: 'plain#nohash' })
    expect(parseDotenv('C="has # inside"')).toEqual({ C: 'has # inside' })
  })
  it('ignores lines that are not assignments', () => {
    expect(parseDotenv('noequals\n=novalue\n   \nD=ok')).toEqual({ D: 'ok' })
  })
  it('reads CRLF files, as an operator on Windows writes them', () => {
    expect(parseDotenv('PORT=1\r\nHOST=x\r\n')).toEqual({ PORT: '1', HOST: 'x' })
  })
})

describe('readDotenv', () => {
  it('parses a file that exists', () => {
    const dir = tempDir()
    writeFileSync(join(dir, '.env'), 'PORT=9000\n# note\nHOST="0.0.0.0"\n')
    expect(readDotenv(join(dir, '.env'))).toEqual({ PORT: '9000', HOST: '0.0.0.0' })
  })
  it('is empty for a missing file, rather than throwing', () => {
    expect(readDotenv(join(tempDir(), 'nothing-here.env'))).toEqual({})
  })
  it('is empty for a path that is a directory', () => {
    expect(readDotenv(tempDir())).toEqual({})
  })
})
