/**
 * Where a rendered portrait lives once it exists (avatar-3d design §5).
 *
 * Two layers, and the split is the point:
 *
 * - **Memory** is a `Map` from hash to `{ blob, url, lastUsed }`. It is what a re-render reads, and it
 *   is the only layer that can answer *synchronously* — which is what lets a seat plate that has drawn
 *   this face before draw it again with no placeholder flash.
 * - **IndexedDB** (`bp.portraits`) is what survives a reload. Rendering a portrait costs a WebGL
 *   context, a megabyte of geometry and tens of milliseconds; doing that again for the same nine faces
 *   on every navigation is the difference between a lobby that feels instant and one that does not.
 *
 * Both are capped at the same 200 entries and evict the same way — oldest `lastUsed` first — so the two
 * hold roughly the same set. **An evicted object URL is revoked**: a `blob:` URL keeps its blob alive
 * for the lifetime of the document, so an LRU that dropped the Map entry and not the URL would be a
 * cache that only ever grew.
 *
 * Everything here is failure-tolerant by construction. A browser in private mode, one that has run out
 * of quota, one that blocks storage entirely — each of them makes IndexedDB throw, and each of them
 * ends with the same behaviour: the memory layer keeps working and the portrait is re-rendered after a
 * reload. Nothing in this module ever rejects into React.
 */

/** The database and store the portraits live in. One store, keyed by hash. */
export const PORTRAIT_DB = 'bp.portraits'
export const PORTRAIT_STORE = 'portraits'

/** The index eviction walks, oldest first. */
const LAST_USED = 'lastUsed'

/** How many portraits are kept, in each layer. Nine seats, a lobby and a wardrobe fit many times over. */
export const PORTRAIT_LIMIT = 200

interface MemoryEntry {
  blob: Blob
  url: string
  lastUsed: number
}

/** What one row of the object store looks like. */
interface StoredPortrait {
  hash: string
  /**
   * The image as bytes rather than as a `Blob`.
   *
   * A `Blob` is structured-cloneable in every browser and this would be a shorter file if it were
   * stored as one — but it is not cloneable under jsdom, which is where every test of this module
   * runs, and a cache whose eviction policy is only ever exercised against a different storage shape
   * than production uses is a cache with an untested eviction policy. Bytes plus a MIME type
   * round-trip identically everywhere, and reconstructing the `Blob` costs nothing.
   */
  bytes: ArrayBuffer
  type: string
  lastUsed: number
}

const memory = new Map<string, MemoryEntry>()

/**
 * A clock that never repeats.
 *
 * `Date.now()` has millisecond resolution, and two portraits stored inside the same millisecond would
 * be indistinguishable to the LRU — which is not a theoretical concern: it is what a test that stores
 * 201 entries in a loop does, and it is what a table that seats nine at once does. The counter keeps
 * the wall clock's meaning (so a row written yesterday sorts before one written today) and adds a
 * tiebreak.
 */
let clock = 0
function stamp(): number {
  clock = Math.max(Date.now(), clock + 1)
  return clock
}

/* ── the memory layer ───────────────────────────────────────────────────────── */

function revoke(url: string): void {
  try {
    URL.revokeObjectURL(url)
  } catch {
    // A browser that has no `revokeObjectURL` cannot have given us a URL to revoke.
  }
}

/** Drop memory entries beyond the cap, oldest first, revoking each URL as it goes. */
function trimMemory(): void {
  if (memory.size <= PORTRAIT_LIMIT) return
  const order = [...memory.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)
  for (const [hash, entry] of order) {
    if (memory.size <= PORTRAIT_LIMIT) break
    memory.delete(hash)
    revoke(entry.url)
  }
}

function remember(hash: string, blob: Blob): string {
  const existing = memory.get(hash)
  if (existing !== undefined) {
    existing.lastUsed = stamp()
    return existing.url
  }
  const url = URL.createObjectURL(blob)
  memory.set(hash, { blob, url, lastUsed: stamp() })
  trimMemory()
  return url
}

/**
 * The portrait for this hash if it is already in memory — no promise, no work.
 *
 * `usePortrait` calls this during render so that a face already drawn once does not go back through
 * `loading`. A miss here says nothing about IndexedDB; it says only "not without awaiting".
 */
export function cachedPortrait(hash: string): string | null {
  const entry = memory.get(hash)
  if (entry === undefined) return null
  entry.lastUsed = stamp()
  return entry.url
}

/* ── the IndexedDB layer ────────────────────────────────────────────────────── */

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve(null)
      const request = indexedDB.open(PORTRAIT_DB, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(PORTRAIT_STORE)) {
          db.createObjectStore(PORTRAIT_STORE, { keyPath: 'hash' }).createIndex(LAST_USED, LAST_USED)
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

/** One transaction, resolved when it commits. `null` (rather than a rejection) is every failure. */
async function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => Promise<T> | T): Promise<T | null> {
  const db = await openDb()
  if (db === null) return null
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(PORTRAIT_STORE, mode)
      let value: T | null = null
      tx.oncomplete = () => resolve(value)
      tx.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
      void Promise.resolve(work(tx.objectStore(PORTRAIT_STORE)))
        .then((result) => {
          value = result
        })
        .catch(() => {
          try {
            tx.abort()
          } catch {
            // Already finished; the handlers above have resolved.
          }
        })
    })
  } catch {
    return null
  }
}

/** An `IDBRequest` as a promise. Rejections are the caller's to swallow. */
function ask<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** The image bytes. `Blob.arrayBuffer` is the browser path; `FileReader` is the one jsdom has. */
function bytesOf(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(blob)
  })
}

/** Delete rows beyond the cap, oldest first. Runs inside the same transaction as the write. */
async function trimStore(store: IDBObjectStore): Promise<void> {
  const total = await ask(store.count())
  let excess = total - PORTRAIT_LIMIT
  if (excess <= 0) return
  await new Promise<void>((resolve, reject) => {
    const cursor = store.index(LAST_USED).openCursor()
    cursor.onerror = () => reject(cursor.error)
    cursor.onsuccess = () => {
      const at = cursor.result
      if (at === null || excess <= 0) return resolve()
      at.delete()
      excess -= 1
      at.continue()
    }
  })
}

/* ── what the hook uses ─────────────────────────────────────────────────────── */

/**
 * The portrait for this hash, from memory or from storage; `null` when it has to be rendered.
 *
 * A hit in IndexedDB is promoted into memory (and given an object URL) on the way past, so the second
 * seat asking for the same face gets it synchronously.
 */
export async function lookupPortrait(hash: string): Promise<string | null> {
  const hot = cachedPortrait(hash)
  if (hot !== null) return hot

  const row = await transact('readonly', (store) => ask(store.get(hash) as IDBRequest<StoredPortrait | undefined>))
  if (row === null || row === undefined) return null

  const url = remember(hash, new Blob([row.bytes], { type: row.type }))
  // Reading counts as using: without this a portrait restored from storage would keep the `lastUsed`
  // it was written with and be the first thing evicted, however often it is looked at.
  void transact('readwrite', (store) => {
    store.put({ ...row, lastUsed: stamp() })
  })
  return url
}

/**
 * Keep a freshly rendered portrait, and hand back the URL to draw it with.
 *
 * The memory write is synchronous and the storage write is not awaited for its own sake — but it *is*
 * awaited, because a caller that returns before the transaction commits makes the write unobservable
 * to the test that has to prove it happened. It never throws: a full or blocked database means the
 * portrait lives only for this page's lifetime.
 */
export async function storePortrait(hash: string, blob: Blob): Promise<string> {
  const url = remember(hash, blob)
  try {
    const bytes = await bytesOf(blob)
    await transact('readwrite', async (store) => {
      const row: StoredPortrait = { hash, bytes, type: blob.type, lastUsed: stamp() }
      await ask(store.put(row) as IDBRequest<IDBValidKey>)
      await trimStore(store)
    })
  } catch {
    // Storage is an optimisation. The memory entry above is what this page actually draws from.
  }
  return url
}

/**
 * Forget every portrait held in memory, revoking each URL.
 *
 * Called when a session ends — the faces of the account that just signed out are exactly what should
 * not sit behind the sign-in card — and by tests that need to start from nothing. IndexedDB is left
 * alone on purpose: it holds no names and no ids, only pictures keyed by a hash of public cosmetics,
 * and clearing it would throw away the one thing that makes the next sign-in fast.
 */
export function resetPortraitMemory(): void {
  for (const entry of memory.values()) revoke(entry.url)
  memory.clear()
}

/** Drops the stored portraits as well, and the handle to the database. Tests only. */
export async function resetPortraitCacheForTests(): Promise<void> {
  resetPortraitMemory()
  clock = 0
  await transact('readwrite', (store) => {
    store.clear()
  })
  dbPromise = null
}

/** How many portraits memory is holding — the LRU's own measurement, for a test and for a log. */
export const portraitMemorySize = (): number => memory.size
