import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cachedPortrait,
  lookupPortrait,
  portraitMemorySize,
  PORTRAIT_DB,
  PORTRAIT_LIMIT,
  PORTRAIT_STORE,
  resetPortraitCacheForTests,
  resetPortraitMemory,
  storePortrait,
} from './portrait-cache.js'

/**
 * The cache, against a real IndexedDB implementation.
 *
 * `fake-indexeddb` rather than a hand-written double, because the parts of this module that could
 * plausibly be wrong are exactly the parts a double would have to reimplement: transaction lifetimes,
 * index cursors, and what `count()` sees inside the transaction that is writing.
 */

const blobOf = (text: string): Blob => new Blob([text], { type: 'image/webp' })

/** One row, read with the test's own connection — the shape on disk, not the module's view of it. */
async function rowOf(hash: string): Promise<{ bytes: ArrayBuffer; type: string; lastUsed: number } | undefined> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(PORTRAIT_DB, 1)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(PORTRAIT_STORE).objectStore(PORTRAIT_STORE).get(hash)
      request.onsuccess = () => resolve(request.result as never)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

describe('portrait-cache', () => {
  beforeEach(async () => {
    await resetPortraitCacheForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hands back a URL for what it was given, and serves it again without awaiting', async () => {
    const url = await storePortrait('aaaa1111', blobOf('one'))

    expect(url).toContain('blob:')
    expect(cachedPortrait('aaaa1111')).toBe(url)
    expect(await lookupPortrait('aaaa1111')).toBe(url)
  })

  it('knows nothing about a hash it has never been given', async () => {
    expect(cachedPortrait('deadbeef')).toBeNull()
    expect(await lookupPortrait('deadbeef')).toBeNull()
  })

  it('writes the image itself, not a reference to it', async () => {
    await storePortrait('bbbb2222', blobOf('a picture'))

    const row = await rowOf('bbbb2222')
    expect(row?.type).toBe('image/webp')
    expect(new TextDecoder().decode(row?.bytes)).toBe('a picture')
  })

  it('brings a portrait back from storage after the memory layer is emptied', async () => {
    const first = await storePortrait('cccc3333', blobOf('kept'))
    resetPortraitMemory()
    expect(cachedPortrait('cccc3333')).toBeNull()

    const second = await lookupPortrait('cccc3333')

    // A new object URL over a blob rebuilt from the stored bytes — the old one was revoked with its entry.
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    // …and it is in memory now, so the next reader gets it without a transaction.
    expect(cachedPortrait('cccc3333')).toBe(second)
  })

  it('counts a read as a use, so a restored portrait is not the first thing evicted', async () => {
    await storePortrait('dddd4444', blobOf('old'))
    const before = (await rowOf('dddd4444'))?.lastUsed ?? 0
    resetPortraitMemory()

    await lookupPortrait('dddd4444')
    // The write-back is fire-and-forget; a turn of the event loop is enough for it to commit.
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect((await rowOf('dddd4444'))?.lastUsed ?? 0).toBeGreaterThan(before)
  })

  it('holds no more than the limit in memory, dropping the least recently used first', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')

    const urls: string[] = []
    for (let i = 0; i < PORTRAIT_LIMIT; i += 1) urls.push(await storePortrait(`hash${i}`, blobOf(`p${i}`)))
    expect(portraitMemorySize()).toBe(PORTRAIT_LIMIT)
    expect(revoke).not.toHaveBeenCalled()

    // Touch the oldest, so that "oldest written" and "least recently used" disagree — which is the whole
    // difference between an LRU and a queue. `hash1` is left alone, and is therefore what goes.
    const rescued = cachedPortrait('hash0')
    const doomed = urls[1]
    await storePortrait('overflow', blobOf('one too many'))

    expect(portraitMemorySize()).toBe(PORTRAIT_LIMIT)
    expect(cachedPortrait('hash0')).toBe(rescued)
    expect(cachedPortrait('hash1')).toBeNull()
    // The blob behind an object URL stays alive for the life of the document until it is revoked, so a
    // cache that dropped the entry and kept the URL would only ever grow.
    expect(revoke).toHaveBeenCalledTimes(1)
    expect(revoke).toHaveBeenCalledWith(doomed)
  })

  it('holds no more than the limit in storage either', async () => {
    for (let i = 0; i < PORTRAIT_LIMIT + 5; i += 1) await storePortrait(`stored${i}`, blobOf(`p${i}`))

    // The five oldest rows were deleted as the newest were written; the rest survive a reload.
    expect(await rowOf('stored0')).toBeUndefined()
    expect(await rowOf('stored4')).toBeUndefined()
    expect(await rowOf('stored5')).toBeDefined()
    expect(await rowOf(`stored${PORTRAIT_LIMIT + 4}`)).toBeDefined()
  })

  it('keeps a portrait usable when there is no IndexedDB at all', async () => {
    const real = globalThis.indexedDB
    // A private window, a browser with storage blocked, an old WebView: the memory layer is the whole
    // cache, and nothing may throw.
    Reflect.deleteProperty(globalThis, 'indexedDB')
    await resetPortraitCacheForTests()
    try {
      const url = await storePortrait('eeee5555', blobOf('no store'))
      expect(cachedPortrait('eeee5555')).toBe(url)
      resetPortraitMemory()
      expect(await lookupPortrait('eeee5555')).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', { value: real, configurable: true, writable: true })
      await resetPortraitCacheForTests()
    }
  })
})
