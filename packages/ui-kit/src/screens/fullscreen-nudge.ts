import { useCallback, useState } from 'react'

/**
 * The short landscape tier's one-time nudge towards "Toàn màn hình" (BP-28, R3): on a phone whose browser keeps its bars
 * the table has 255 px of stage, and full screen gives it back about 90. Shown until the player dismisses it or uses it,
 * once per browser: the answer is kept in `localStorage` under this key. Storage that is missing or refuses (a private
 * window, a blocked site) counts as "not dismissed yet", and a dismissal it cannot keep still holds for this page.
 */
export const FULLSCREEN_NUDGE_KEY = 'bp.fullscreenNudge'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** Whether the nudge was dismissed (or used) in this browser before. */
export function nudgeDismissed(): boolean {
  try {
    return storage()?.getItem(FULLSCREEN_NUDGE_KEY) === 'dismissed'
  } catch {
    return false
  }
}

/** Remembers that the nudge is done with. */
export function rememberNudgeDismissed(): void {
  try {
    storage()?.setItem(FULLSCREEN_NUDGE_KEY, 'dismissed')
  } catch {
    // nowhere to keep it: the page's own state still hides the nudge until the next load
  }
}

/** `[dismissed, dismiss]`: read once when the room mounts, written on the player's answer. */
export function useFullscreenNudge(): [boolean, () => void] {
  const [dismissed, setDismissed] = useState(nudgeDismissed)
  const dismiss = useCallback(() => {
    rememberNudgeDismissed()
    setDismissed(true)
  }, [])
  return [dismissed, dismiss]
}
