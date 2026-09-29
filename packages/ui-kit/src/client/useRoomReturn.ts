import { useEffect, useRef } from 'react'
import type { ClientState } from './types.js'

/**
 * Takes the player back to the room the server is still holding them in.
 *
 * A socket that comes up — a first load, a reload, a tab reopened after a dropped connection — is answered with
 * `WELCOME` and, only if the player is still in a room, a `ROOM_SNAPSHOT`; the reducer counts those answers in
 * `roomReturns`. This calls `onReturn` once per answer, so the app can open its room screen wherever the player
 * happened to land (the lobby, the daily page). Without it a player stood up after a long drop, but kept in the
 * room as a spectator for five minutes (spec §16.6), came back to a lobby that refused every other room with
 * `ALREADY_IN_ROOM` and never said which room it meant (finding T5 of the 2026-09-28 operation test).
 *
 * Only the answer to a (re)connect counts: a room the player has just created or joined is the app's own doing,
 * and a room they have just left does not bring them back.
 */
export function useRoomReturn(state: Pick<ClientState, 'roomReturns'>, onReturn: () => void): void {
  const onReturnRef = useRef(onReturn)
  onReturnRef.current = onReturn
  const seen = useRef(state.roomReturns)
  const returns = state.roomReturns
  useEffect(() => {
    if (returns === seen.current) return
    seen.current = returns
    // A `reset` (a sign-out) takes the count back to 0: nothing to return to.
    if (returns > 0) onReturnRef.current()
  }, [returns])
}
