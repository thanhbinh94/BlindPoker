import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { claimRunFile, pidAlive, PROBE_TIMEOUT_MS, readRunFile, removeRunFile, resolveRunFilePath, RUN_FILE_NAME, runFileUrl, writeRunFile } from './run-file.js'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-runfile-'))
  dirs.push(dir)
  return dir
}

/** Stub listeners the start-up probe talks to; closed between tests so no port outlives its case. */
const servers: Server[] = []

afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  for (const server of servers.splice(0)) {
    server.closeAllConnections()
    await new Promise<void>((done) => server.close(() => done()))
  }
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

describe('runFileUrl', () => {
  it('reaches a wildcard bind over the loopback and brackets an IPv6 literal', () => {
    expect(runFileUrl({ host: '0.0.0.0', port: 8080 })).toBe('http://127.0.0.1:8080')
    expect(runFileUrl({ host: '::', port: 8080 })).toBe('http://127.0.0.1:8080')
    expect(runFileUrl({ host: '', port: 8080 })).toBe('http://127.0.0.1:8080')
    expect(runFileUrl({ host: '192.168.1.9', port: 9000 })).toBe('http://192.168.1.9:9000')
    expect(runFileUrl({ host: '::1', port: 9000 })).toBe('http://[::1]:9000')
  })
})

describe('claimRunFile', () => {
  /** A listener on the loopback that answers `/api/config` with whatever `body` is at the time. */
  async function stubServer(handler: (url: string) => { status?: number; body: string }): Promise<{ port: number; hits: string[] }> {
    const hits: string[] = []
    const server = createServer((req, res) => {
      hits.push(req.url ?? '')
      const { status = 200, body } = handler(req.url ?? '')
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(body)
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    return { port: (server.address() as AddressInfo).port, hits }
  }

  /** A port nothing is listening on: bind one, learn its number, give it back. */
  async function deadPort(): Promise<number> {
    const server = createServer()
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    const { port } = server.address() as AddressInfo
    await new Promise<void>((done) => server.close(() => done()))
    return port
  }

  const alive = { isAlive: () => true, timeoutMs: 250 }

  it('is vacant when there is no run file, or nothing that parses as one', async () => {
    const dir = tempDir()
    expect(await claimRunFile(join(dir, RUN_FILE_NAME), alive)).toEqual({ state: 'vacant' })
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ not json')
    expect(await claimRunFile(broken, alive)).toEqual({ state: 'vacant' })
  })

  it('is stale when the pid is gone, without asking the network', async () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    const stub = await stubServer(() => ({ body: JSON.stringify({ edition: 'lite' }) }))
    writeRunFile(path, { ...INFO, port: stub.port })

    const claim = await claimRunFile(path, { isAlive: () => false, timeoutMs: 250 })

    expect(claim.state).toBe('stale')
    expect(stub.hits).toEqual([])
  })

  /**
   * The case the probe exists for: a hard kill left the file behind and the operating system handed
   * that pid to something else entirely. Nothing is listening where the file says a server was — a
   * refused connection is conclusive, so no retry is spent on it — and the file is wreckage:
   * refusing to start here would lock the operator out of their own machine.
   */
  it('is stale when the recorded pid is alive but the recorded address refuses the connection', async () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    writeRunFile(path, { ...INFO, port: await deadPort() })

    const claim = await claimRunFile(path, alive)

    expect(claim.state).toBe('stale')
    expect(claim.state === 'stale' && claim.why).toMatch(/connection refused/)
  })

  it('is held when the recorded address answers as Lite — a wildcard bind reached over the loopback', async () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    const stub = await stubServer(() => ({ body: JSON.stringify({ edition: 'lite', wsPath: '/ws', languages: ['vi', 'en'] }) }))
    writeRunFile(path, { ...INFO, host: '0.0.0.0', port: stub.port })

    expect(await claimRunFile(path, alive)).toEqual({ state: 'held', info: { ...INFO, host: '0.0.0.0', port: stub.port } })
    expect(stub.hits).toEqual(['/api/config'])
  })

  it('is stale when the pid was reused by some other server on the same port', async () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    const stub = await stubServer(() => ({ body: JSON.stringify({ edition: 'normal', version: '1.0.0' }) }))
    writeRunFile(path, { ...INFO, port: stub.port })

    const claim = await claimRunFile(path, alive)

    expect(claim.state).toBe('stale')
    expect(claim.state === 'stale' && claim.why).toMatch(/not a Just a Normal Poker Lite instance/)
  })

  it('is stale when the address answers an error, or something that is not JSON at all', async () => {
    const dirPath = join(tempDir(), RUN_FILE_NAME)
    const broken = await stubServer(() => ({ status: 502, body: 'nginx says no' }))
    writeRunFile(dirPath, { ...INFO, port: broken.port })
    expect((await claimRunFile(dirPath, alive)).state).toBe('stale')

    const html = await stubServer(() => ({ body: '<!doctype html><title>a router</title>' }))
    writeRunFile(dirPath, { ...INFO, port: html.port })
    const claim = await claimRunFile(dirPath, alive)
    expect(claim.state).toBe('stale')
    expect(claim.state === 'stale' && claim.why).toMatch(/did not answer JSON/)
  })

  /**
   * A timeout is not proof of anything — a live instance too busy to answer for a moment looks the
   * same as nothing being there — so one retry is spent before giving up, and giving up here means
   * *refusing to start* rather than declaring the file stale and overwriting a possibly-live server.
   */
  it('refuses to start, rather than hanging or overwriting, when the address times out twice in a row', async () => {
    const path = join(tempDir(), RUN_FILE_NAME)
    let hits = 0
    const server = createServer(() => {
      hits += 1 // accept the request and say nothing at all — a wedged process, or a stranger on the port
    })
    servers.push(server)
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
    writeRunFile(path, { ...INFO, port: (server.address() as AddressInfo).port })

    const started = Date.now()
    const claim = await claimRunFile(path, { isAlive: () => true, timeoutMs: 150 })

    expect(claim.state).toBe('unreachable')
    expect(claim.state === 'unreachable' && claim.why).toMatch(/did not identify itself.*twice/)
    // No error code behind this one, so the message says what actually happened: nothing, for 150 ms.
    // A failure that *does* carry a code (EHOSTUNREACH, ECONNRESET) names it there instead, rather
    // than claiming a budget that never elapsed.
    expect(claim.state === 'unreachable' && claim.why).toContain('no answer within 150 ms')
    expect(hits, 'the probe should have retried once after the first timeout').toBe(2)
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('defaults to asking the operating system about the pid, and waits a second for the address', async () => {
    expect(PROBE_TIMEOUT_MS).toBe(1000)
    const path = join(tempDir(), RUN_FILE_NAME)
    // This process is alive and is not Lite, so the default `isAlive` reaches the probe and the
    // probe finds nothing: exactly the pid-reuse case, with a real pid.
    writeRunFile(path, { ...INFO, pid: process.pid, port: await deadPort() })
    expect((await claimRunFile(path)).state).toBe('stale')
  })
})

describe('pidAlive', () => {
  it('is true for this process and false for a pid that cannot exist', () => {
    expect(pidAlive(process.pid)).toBe(true)
    // Well above any plausible live pid on Windows or Linux, and never 0 (which means "this group").
    expect(pidAlive(0x7ffffffe)).toBe(false)
  })
})
