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

/**
 * Whether the arrival move may happen (Plan 27, P25): the welcome gift comes before the daily reward, so a session that
 * starts with the gift unclaimed stays in the lobby, where the gift's dialog opens.
 *
 * - `go`: the gift is taken (or its status could not be read) — the move happens as it always did.
 * - `skip`: the gift was waiting when the session started — no move this session; the tab's dot still shows.
 * - `wait`: not known yet — a move that is due is held, then made on `go` or dropped on `skip`.
 */
export type NudgeArrival = 'go' | 'skip' | 'wait'

export interface DailyNudgeArgs {
  api: NormalApi
  /** The signed-in account, or `null` — the hook asks once per account, not once per render. */
  playerId: string | null
  path: string
  navigate: (path: string) => void
  /** `go` when omitted. */
  arrival?: NudgeArrival
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
 *
 * The arrival move also waits on `arrival` (see `NudgeArrival`): a fresh account meets its welcome gift first.
 */
export function useDailyNudge({ api, playerId, path, navigate, arrival = 'go' }: DailyNudgeArgs): { ready: boolean } {
  const [ready, setReady] = useState(false)
  const pathRef = useRef(path)
  const arrivalRef = useRef(arrival)
  arrivalRef.current = arrival
  /** The day of an arrival move held while `arrival` is `wait`. */
  const held = useRef<string | null>(null)
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
      held.current = null
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
    if (signingIn) held.current = null
    const mine = ++epoch.current
    void api
      .daily()
      .then((status) => {
        if (mine !== epoch.current) return
        setReady(status.claimable)
        if (!status.claimable || !signingIn) return
        const stamp = String(status.nextResetAt)
        if (readNudged() === stamp || !HOME_ROUTES.includes(pathRef.current)) return
        if (arrivalRef.current === 'skip') return
        if (arrivalRef.current === 'wait') {
          held.current = stamp
          return
        }
        writeNudged(stamp)
        navigate('/daily')
      })
      .catch(() => {
        if (mine === epoch.current) setReady(false)
      })
  }, [api, playerId, path, navigate])

  // The welcome status landed: a held move is made — if the player is still where a session lands and the gift is
  // taken — or dropped. Either way it is spent; nothing is held past one answer.
  useEffect(() => {
    if (arrival === 'wait') return
    const stamp = held.current
    held.current = null
    if (stamp === null || arrival === 'skip') return
    if (readNudged() === stamp || !HOME_ROUTES.includes(pathRef.current)) return
    writeNudged(stamp)
    navigate('/daily')
  }, [arrival, navigate])

  return { ready }
}
