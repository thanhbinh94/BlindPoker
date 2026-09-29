import { useEffect, useRef, useState } from 'react'
import type { NormalApi } from './api.js'
import { deviceStorage } from './session.js'

/**
 * Remembers which local day this browser has already been steered to `/daily` for. The value is the day's
 * `nextResetAt` — the instant the server says the next day begins — so "already nudged" expires exactly when the
 * reward does, in the server's timezone, with no clock arithmetic of our own.
 */
export const DAILY_NUDGE_KEY = 'bp.dailyNudge'

/** Routes a sign-in lands on. A deep link anywhere else (a room code, the profile) is left alone. */
const HOME_ROUTES = ['/', '/lobby', '/login', '/register']

const readNudged = (): string => {
  try {
    return deviceStorage()?.getItem(DAILY_NUDGE_KEY) ?? ''
  } catch {
    return ''
  }
}

const writeNudged = (value: string): void => {
  try {
    deviceStorage()?.setItem(DAILY_NUDGE_KEY, value)
  } catch {
    /* storage unavailable: the nudge repeats next visit, which is the safe way round */
  }
}

/** Every mounted reminder, told when today's reward is taken. One in practice: `App` mounts it once. */
const claimListeners = new Set<() => void>()

/**
 * Today's reward is gone: the daily page calls this the moment a claim lands — or is refused as already
 * claimed, which means another tab took it — so the tab's dot goes out at once instead of on the way out of
 * `/daily` (finding T1 of the 2026-09-28 operation test).
 */
export function markClaimedToday(): void {
  for (const listener of claimListeners) listener()
}

export interface DailyNudgeArgs {
  api: NormalApi
  /** The signed-in account, or `null` — the hook asks once per account, not once per render. */
  playerId: string | null
  path: string
  navigate: (path: string) => void
}

/**
 * The daily reward's two reminders (spec §13.1 keeps the claim itself a deliberate press, so neither claims):
 *
 * - **Once a day, on arrival:** when a session starts on a home route and today's reward is still there, the
 *   app opens `/daily` instead of the lobby — once per local day per browser, so a player who does not want it
 *   walks back to the lobby and is not dragged in again.
 * - **The dot on the tab:** `ready` is `true` while a reward is claimable. `/daily` is the one place it can
 *   change, so the daily page reports a claim through `markClaimedToday` and the dot goes out right then; it
 *   is also re-read when the player leaves `/daily`.
 */
export function useDailyNudge({ api, playerId, path, navigate }: DailyNudgeArgs): { ready: boolean } {
  const [ready, setReady] = useState(false)
  const pathRef = useRef(path)
  /** The account the standing answer was asked for; a new account asks again. */
  const asked = useRef<string | null>(null)
  /** Which request is current, so a late reply cannot open the reward page under the next player. */
  const epoch = useRef(0)

  // A claim on the daily page: the dot goes now. The epoch moves too, so a status read that left before the
  // claim cannot land afterwards and put the dot back.
  useEffect(() => {
    const onClaimed = (): void => {
      epoch.current += 1
      setReady(false)
    }
    claimListeners.add(onClaimed)
    return () => {
      claimListeners.delete(onClaimed)
    }
  }, [])

  useEffect(() => {
    const previous = pathRef.current
    pathRef.current = path
    if (playerId === null) {
      asked.current = null
      epoch.current += 1
      setReady(false)
      return
    }
    const signingIn = asked.current !== playerId
    const leftDaily = previous === '/daily' && path !== '/daily'
    // Ask on sign-in and on the way out of /daily; any other route change is somebody moving between screens,
    // which cannot have claimed anything.
    if (!signingIn && !leftDaily) return
    asked.current = playerId
    const mine = ++epoch.current
    void api
      .daily()
      .then((status) => {
        if (mine !== epoch.current) return
        setReady(status.claimable)
        if (!status.claimable || !signingIn) return
        const stamp = String(status.nextResetAt)
        if (readNudged() === stamp || !HOME_ROUTES.includes(pathRef.current)) return
        writeNudged(stamp)
        navigate('/daily')
      })
      .catch(() => {
        if (mine === epoch.current) setReady(false)
      })
  }, [api, playerId, path, navigate])

  return { ready }
}
