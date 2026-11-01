import { useState } from 'react'

/**
 * The result's reveal hold as a component saw it (`useRevealHold`), in client time: `since` when it began, `until` when it ended
 * (`null` while it runs).
 */
export interface HeraldHold {
  since: number
  until: number | null
}

/**
 * The reveal hold's start and end, noted in the render that sees `held` change (React's pattern for what earlier renders knew).
 * Only the latest hold is kept. `RoomScreen` tracks it once and hands it to both the Thần's herald (`ChaosHerald`'s `hold`) and
 * the entrance band (`useEntrances`), so the two read the same window (BP-42 A7).
 */
export function useHeldWindow(held: boolean): HeraldHold | null {
  const [hold, setHold] = useState<HeraldHold | null>(null)
  const now = Date.now()
  let seen = hold
  if (held && (hold === null || hold.until !== null)) seen = { since: now, until: null }
  else if (!held && hold !== null && hold.until === null) seen = { since: hold.since, until: now }
  if (seen !== hold) setHold(seen)
  return seen
}
