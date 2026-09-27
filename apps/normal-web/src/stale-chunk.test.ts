import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, lazyScreen, reloadForNewVersion, RELOAD_KEY, RELOAD_WINDOW_MS, resetReloadingForTests } from './stale-chunk.js'

beforeEach(() => resetReloadingForTests())

/** A throwaway in-memory `Storage`: jsdom's sessionStorage is shared across the file. */
function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() {
      return data.size
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, String(v)),
  }
}

describe('isChunkLoadError', () => {
  it.each([
    ['Chromium', new TypeError('Failed to fetch dynamically imported module: http://x/assets/ProfileScreen-abc.js')],
    ['Safari', new TypeError('Importing a module script failed.')],
    ['Firefox', new TypeError('error loading dynamically imported module: http://x/a.js')],
    ['Vite CSS preload', new Error('Unable to preload CSS for /assets/ProfileScreen-abc.css')],
  ])('recognises the %s wording', (_browser, err) => {
    expect(isChunkLoadError(err)).toBe(true)
  })

  it('leaves every other failure alone', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

describe('reloadForNewVersion', () => {
  it('reloads once, then not again inside the window, then again after it', () => {
    const storage = memoryStorage()
    const reload = vi.fn()
    expect(reloadForNewVersion({ now: 1_000, storage, reload })).toBe(true)
    expect(storage.getItem(RELOAD_KEY)).toBe('1000')
    expect(reloadForNewVersion({ now: 1_000 + RELOAD_WINDOW_MS - 1, storage, reload })).toBe(false)
    expect(reloadForNewVersion({ now: 1_000 + RELOAD_WINDOW_MS, storage, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('never reloads without storage — a guard it cannot write is a loop it cannot stop', () => {
    const reload = vi.fn()
    expect(reloadForNewVersion({ storage: null, reload })).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })
})

describe('lazyScreen', () => {
  // `React.lazy` keeps its factory's promise in a private payload; reaching it is the only way to test the
  // factory without rendering. `_payload._result` is the factory until first use.
  const factoryOf = (component: unknown): (() => Promise<unknown>) => (component as { _payload: { _result: () => Promise<unknown> } })._payload._result

  it('asks for a reload on a missing chunk and never settles while the page goes away', async () => {
    const reload = vi.fn(() => true)
    const Screen = lazyScreen(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /a.js')), reload)
    const pending = factoryOf(Screen)()
    const settled = await Promise.race([pending.then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(reload).toHaveBeenCalledTimes(1)
    expect(settled).toBe('pending')
  })

  it('rejects when the reload was already spent, so the boundary can speak', async () => {
    const reload = vi.fn(() => false)
    const err = new TypeError('Failed to fetch dynamically imported module: /a.js')
    const Screen = lazyScreen(() => Promise.reject(err), reload)
    await expect(factoryOf(Screen)()).rejects.toBe(err)
  })

  it('waits instead of rejecting while a reload this page asked for is on its way (preload error and import fail together)', async () => {
    reloadForNewVersion({ now: 5_000, storage: memoryStorage(), reload: vi.fn() }) // e.g. Vite's preload error, first
    const reload = vi.fn(() => false) // the window guard would refuse a second reload
    const Screen = lazyScreen(() => Promise.reject(new TypeError('Failed to fetch dynamically imported module: /a.js')), reload)
    const settled = await Promise.race([factoryOf(Screen)().then(() => 'settled', () => 'settled'), new Promise((r) => setTimeout(() => r('pending'), 20))])
    expect(settled).toBe('pending')
    expect(reload).not.toHaveBeenCalled()
  })

  it('rejects any other failure without reloading', async () => {
    const reload = vi.fn(() => true)
    const err = new Error('boom')
    const Screen = lazyScreen(() => Promise.reject(err), reload)
    await expect(factoryOf(Screen)()).rejects.toBe(err)
    expect(reload).not.toHaveBeenCalled()
  })
})
