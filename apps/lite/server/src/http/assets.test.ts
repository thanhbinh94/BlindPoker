import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assetSourceFromDir, assetSourceFromSea, contentType } from './assets.js'

const dirs: string[] = []

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'bp-assets-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Bind Poker</title>')
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)')
  writeFileSync(join(dir, 'assets', 'app-abc123.css'), ':root{--x:1}')
  writeFileSync(join(dir, 'favicon.ico'), 'icon')
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('contentType', () => {
  it('maps the extensions the Lite bundle ships', () => {
    expect(contentType('index.html')).toBe('text/html; charset=utf-8')
    expect(contentType('assets/app-abc123.js')).toBe('text/javascript; charset=utf-8')
    expect(contentType('assets/app-abc123.css')).toBe('text/css; charset=utf-8')
    expect(contentType('manifest.json')).toBe('application/json; charset=utf-8')
    expect(contentType('logo.svg')).toBe('image/svg+xml')
    expect(contentType('logo.png')).toBe('image/png')
    expect(contentType('favicon.ico')).toBe('image/x-icon')
    expect(contentType('font.woff2')).toBe('font/woff2')
    expect(contentType('robots.txt')).toBe('text/plain; charset=utf-8')
    expect(contentType('app.js.map')).toBe('application/json; charset=utf-8')
  })

  it('falls back to an opaque type for anything unknown', () => {
    expect(contentType('data.bin')).toBe('application/octet-stream')
    expect(contentType('noextension')).toBe('application/octet-stream')
  })
})

describe('assetSourceFromDir', () => {
  it('serves a file at the root', () => {
    const src = assetSourceFromDir(fixtureDir())
    const asset = src.get('index.html')
    expect(asset?.body.toString()).toBe('<!doctype html><title>Bind Poker</title>')
    expect(asset?.type).toBe('text/html; charset=utf-8')
    expect(asset?.immutable).toBe(false)
    expect(src.has('index.html')).toBe(true)
  })

  it('serves a nested file and accepts a leading slash', () => {
    const src = assetSourceFromDir(fixtureDir())
    expect(src.get('assets/app-abc123.js')?.body.toString()).toBe('console.log(1)')
    expect(src.get('/assets/app-abc123.js')?.body.toString()).toBe('console.log(1)')
  })

  it('marks hashed build output immutable and everything else mutable', () => {
    const src = assetSourceFromDir(fixtureDir())
    expect(src.get('/assets/app-abc123.js')?.immutable).toBe(true)
    expect(src.get('/assets/app-abc123.css')?.immutable).toBe(true)
    expect(src.get('/favicon.ico')?.immutable).toBe(false)
    expect(src.get('/index.html')?.immutable).toBe(false)
  })

  it('returns null for a missing file', () => {
    const src = assetSourceFromDir(fixtureDir())
    expect(src.get('missing.png')).toBeNull()
    expect(src.has('missing.png')).toBe(false)
  })

  it('returns null for a directory', () => {
    const src = assetSourceFromDir(fixtureDir())
    expect(src.get('assets')).toBeNull()
  })

  it('denies path traversal in every encoding', () => {
    const dir = fixtureDir()
    writeFileSync(join(dir, '..', 'bp-secret.txt'), 'secret')
    const src = assetSourceFromDir(join(dir))
    expect(src.get('../bp-secret.txt')).toBeNull()
    expect(src.get('/../bp-secret.txt')).toBeNull()
    expect(src.get('assets/../../bp-secret.txt')).toBeNull()
    expect(src.get('..%2Fbp-secret.txt')).toBeNull()
    expect(src.get('..\\bp-secret.txt')).toBeNull()
    rmSync(join(dir, '..', 'bp-secret.txt'), { force: true })
  })

  it('caches what it reads, hits and misses alike', () => {
    const dir = fixtureDir()
    const src = assetSourceFromDir(dir)
    expect(src.get('index.html')?.body.toString()).toContain('Bind Poker')
    rmSync(join(dir, 'index.html'))
    expect(src.get('index.html')?.body.toString()).toContain('Bind Poker')

    expect(src.get('later.js')).toBeNull()
    writeFileSync(join(dir, 'later.js'), 'later')
    expect(src.get('later.js')).toBeNull()
  })
})

describe('assetSourceFromSea', () => {
  const manifest = ['index.html', 'assets/app-abc123.js']
  const read = (key: string): ArrayBuffer => {
    const buf = Buffer.from(key === 'index.html' ? '<!doctype html>' : 'console.log(1)')
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  it('serves only the keys the manifest lists', () => {
    const src = assetSourceFromSea(manifest, read)
    expect(src.get('/index.html')?.body.toString()).toBe('<!doctype html>')
    expect(src.get('index.html')?.type).toBe('text/html; charset=utf-8')
    expect(src.has('assets/app-abc123.js')).toBe(true)
    expect(src.get('assets/app-abc123.js')?.immutable).toBe(true)
    expect(src.get('missing.png')).toBeNull()
    expect(src.has('missing.png')).toBe(false)
  })

  it('denies path traversal and normalises manifest keys with a leading slash', () => {
    const src = assetSourceFromSea(['/index.html'], read)
    expect(src.get('index.html')?.body.toString()).toBe('<!doctype html>')
    expect(src.get('../index.html')).toBeNull()
  })

  it('reads each asset at most once', () => {
    let reads = 0
    const src = assetSourceFromSea(manifest, (key) => {
      reads += 1
      return read(key)
    })
    src.get('index.html')
    src.get('index.html')
    expect(reads).toBe(1)
  })
})
