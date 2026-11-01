import { useTranslation } from 'react-i18next'
import { cx } from '../primitives/cx.js'
import type { SoundEngine } from './engine.js'
import s from './sound.module.css'
import { useSoundMuted } from './useSound.js'

export interface MuteButtonProps {
  engine: SoundEngine
  className?: string
}

/** Kept out of the JSX: the literal rule (`eslint.config.js`) allows no such glyph in markup. */
const SOUND_ON_GLYPH = '🔊'
const SOUND_OFF_GLYPH = '🔇'

/**
 * The room's mute button: a bare `<button>` (it sits straight in the header's right cell, whose rules size it), named by
 * what a press does ("Tắt tiếng" / "Bật tiếng"). No `aria-pressed` as well (Ruling 10): with a label that already
 * flips, a screen reader would say "Bật tiếng, pressed". `data-muted` is for the style only. The press itself is a
 * gesture, so the app's gesture listener unlocks the audio on it.
 */
export function MuteButton({ engine, className }: MuteButtonProps) {
  const { t } = useTranslation()
  const muted = useSoundMuted(engine)
  return (
    <button
      type="button"
      className={cx(s.mute, className)}
      data-muted={muted}
      aria-label={t(muted ? 'sound.unmute' : 'sound.mute')}
      onClick={() => engine.setMuted(!muted)}
    >
      <span aria-hidden="true">{muted ? SOUND_OFF_GLYPH : SOUND_ON_GLYPH}</span>
    </button>
  )
}
