import { attachGestureUnlock, createSoundEngine, type SoundEngine } from '@bp/ui-kit'

/**
 * The app's one sound engine (BP-42 spec §5.3, A12): the room's mute button and the Cài đặt choice are the same switch
 * because they are the same engine, and there is one audio channel for the whole page.
 *
 * Created on first use, not when this module loads: `App.tsx` is imported by tests that must not build an engine (it reads
 * `localStorage` the moment it exists), and the gesture listeners are attached from `main.tsx`, never by an import.
 */
let engine: SoundEngine | null = null

export function soundEngine(): SoundEngine {
  engine ??= createSoundEngine()
  return engine
}

/** The browser entry's one call: the first gesture unlocks the audio (and loads the stingers). Returns the remover. */
export function startSound(): () => void {
  return attachGestureUnlock(soundEngine())
}
