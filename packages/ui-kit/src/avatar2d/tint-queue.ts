/**
 * The queue every tinted layer's render waits in (plan 27 E1, spec §6 Phần E). A render loads the layer's PNG and one
 * mask per tint, one after another, then paints them on a canvas; the Phòng thay đồ asks for dozens of them at once,
 * and firing them all together had every image fight for the same slow connection while the stage waited behind the
 * cards. So no more than `TINT_CONCURRENCY` renders run at a time — which caps the tint pipeline's image requests in
 * flight at the same number — and a waiting render with a higher `priority` starts first, renders of one priority in
 * the order they were asked for.
 *
 * Module-level, like the tint cache it feeds, so every `Chibi` and wardrobe icon on a page shares the four slots. A job
 * that rejects or throws gives its slot back like one that resolves; its promise carries the rejection to its caller.
 */
export const TINT_CONCURRENCY = 4

interface Waiting {
  start: () => void
  priority: number
  seq: number
}

let running = 0
let seq = 0
const waiting: Waiting[] = []

function next(): void {
  while (running < TINT_CONCURRENCY && waiting.length > 0) {
    // Highest priority first; the lowest `seq` (the oldest) among equals. The queue is a handful long, so a scan beats a heap.
    let best = 0
    for (let i = 1; i < waiting.length; i++) {
      const a = waiting[i]!
      const b = waiting[best]!
      if (a.priority > b.priority || (a.priority === b.priority && a.seq < b.seq)) best = i
    }
    const [job] = waiting.splice(best, 1)
    job!.start()
  }
}

/** Runs `job` once a slot is free — at once, synchronously, when one already is — and settles as it does. */
export function enqueue<T>(job: () => Promise<T>, priority: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const start = () => {
      running++
      let result: Promise<T>
      try {
        result = job()
      } catch (error) {
        result = Promise.reject(error)
      }
      result.then(resolve, reject).finally(() => {
        running--
        next()
      })
    }
    waiting.push({ start, priority, seq: seq++ })
    next()
  })
}

/** Test seam: how many jobs are running and how many wait. */
export function tintQueueStats(): { running: number; waiting: number } {
  return { running, waiting: waiting.length }
}
