/**
 * Knowing whether the portrait renderer still has a GPU behind it.
 *
 * A WebGL context is not a thing a page owns: a GPU reset, a driver update, a laptop switching from
 * the discrete card to the integrated one, a background tab whose memory the browser reclaimed, or
 * simply opening one context too many — any of them takes it away, and the page is told by an event
 * rather than by an error. Everything after that point *appears* to work. `renderer.render` draws
 * nothing, `drawImage` copies a blank canvas, and `toBlob` returns a perfectly valid, perfectly
 * transparent WebP.
 *
 * That blob is the danger, because the portrait pipeline believes it. It goes into the memory cache
 * **and into IndexedDB**, keyed by the configuration's hash, where it survives reloads and is served in
 * preference to rendering again. The failure the player sees is not "my picture went back to a letter"
 * — the design allows that — but "my face is permanently blank on this machine", with no way back short
 * of changing what they are wearing.
 *
 * So: a lost context makes the render **reject**. The letter comes back, nothing is cached, and when
 * the browser restores the context the next render draws again.
 *
 * This module is deliberately free of three.js — it is two DOM contracts, narrowed to what is used —
 * so the behaviour can be tested with a stub instead of a GPU.
 */

/** The half of an `HTMLCanvasElement` a watch needs. */
export interface ContextEvents {
  addEventListener(type: string, listener: (event: Event) => void): void
  removeEventListener(type: string, listener: (event: Event) => void): void
}

/** The half of a `WebGLRenderer` a check needs. */
export interface ContextHolder {
  getContext(): { isContextLost(): boolean } | null | undefined
}

export interface ContextWatch {
  /** `true` from `webglcontextlost` until `webglcontextrestored`. */
  lost(): boolean
  /** Unsubscribes. The canvas is going away with the renderer, but a watch that outlived one would lie. */
  stop(): void
}

/**
 * Listen for the context going away and coming back.
 *
 * `preventDefault()` on the loss event is not optional politesse: it is the only thing that makes the
 * browser *restore* the context afterwards. Without it the canvas is dead for the life of the page, and
 * a player whose GPU hiccuped once would see letters until they reloaded.
 */
export function watchContext(canvas: ContextEvents): ContextWatch {
  let gone = false

  const onLost = (event: Event): void => {
    // A default-prevented loss is a loss the browser is willing to undo.
    event.preventDefault()
    gone = true
  }
  const onRestored = (): void => {
    gone = false
  }

  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    lost: () => gone,
    stop() {
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    },
  }
}

/**
 * Whether drawing right now would produce nothing.
 *
 * Both halves are asked, because they answer at different moments: the watch knows as soon as the event
 * fires, and `isContextLost()` is the truth at the instant the pixels are about to be read — which is
 * the moment that matters, since a context can be lost between the `render` call and the copy out of
 * the drawing buffer. A `getContext` that throws is treated as lost; an ex-context cannot be trusted to
 * answer politely.
 */
export function contextLost(watch: ContextWatch | null, renderer: ContextHolder): boolean {
  if (watch !== null && watch.lost()) return true
  try {
    return renderer.getContext()?.isContextLost() === true
  } catch {
    return true
  }
}

/** The rejection a lost context produces. Not an `AbortError`: nobody cancelled this, it broke. */
export const CONTEXT_LOST = 'the portrait renderer lost its WebGL context; nothing was drawn'
