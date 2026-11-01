import { useSyncExternalStore } from 'react'
import type { SoundEngine } from './engine.js'

/** Whether the engine is muted, kept in step with every place that changes it (the room's button, Cài đặt). */
export function useSoundMuted(engine: SoundEngine): boolean {
  return useSyncExternalStore(
    engine.subscribe,
    () => engine.muted,
    () => engine.muted,
  )
}
