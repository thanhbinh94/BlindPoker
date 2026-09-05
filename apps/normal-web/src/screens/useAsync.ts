import { useCallback, useEffect, useRef, useState } from 'react'

export interface AsyncHandle<T> {
  /**
   * What the last successful load returned, or `null` until one has.
   *
   * `null` after `loading` has gone false is how every caller here says "this screen could not load": the
   * cause is deliberately not exposed. There is exactly one refusal a screen could usefully tell apart, and
   * `guardApi` handles it above them all — a dead session never reaches a screen's error branch, it takes
   * the player back to the sign-in card. What is left is "the server said no" and "there was no server",
   * which read the same and offer the same one button.
   */
  data: T | null
  loading: boolean
  /** Ask again from the top — the "try again" button under a failure. */
  reload: () => void
  /** Replace what was loaded without a round trip, for a mutation whose reply *is* the new value. */
  set: (next: T) => void
}

/**
 * One request behind one screen: load on mount, and again when asked.
 *
 * The loader is held in a ref rather than in the effect's dependency list on purpose. Every caller here
 * writes it as an inline `async () => …` closing over `api`, and a dependency on that closure would refetch
 * on every render — which on a screen that also sets state from the reply is not a refetch, it is a loop.
 * `reload` is the only way to ask twice, which makes "when does this fetch" a thing you can read.
 */
export function useAsync<T>(load: () => Promise<T>): AsyncHandle<T> {
  const loadRef = useRef(load)
  loadRef.current = load

  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    void loadRef.current().then(
      (value) => {
        if (!alive) return
        setData(value)
        setLoading(false)
      },
      () => {
        // The cause is dropped on purpose: see `data` above.
        if (!alive) return
        setLoading(false)
      },
    )
    return () => {
      alive = false
    }
  }, [attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const set = useCallback((next: T) => setData(next), [])

  return { data, loading, reload, set }
}
