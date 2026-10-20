import { useMediaQuery } from './useMediaQuery.js'

/**
 * Which stage the room is laid out for: the `desktop` one (tray under the felt, header on top — which also serves a
 * portrait phone) or the `landscape` one, a phone held sideways, where every pixel of height is the table's.
 */
export type RoomFrame = 'desktop' | 'landscape'

/** A phone on its side: wider than tall, and no more than 500 px of height. A laptop window never gets this short. */
export const LANDSCAPE_PHONE = '(orientation: landscape) and (max-height: 500px)'

/** The room's frame: `override` when given (a host app, the playground), otherwise what the viewport says. */
export function useRoomFrame(override?: RoomFrame): RoomFrame {
  // The hook runs either way, so the order of hooks does not change when an override comes and goes.
  const landscape = useMediaQuery(LANDSCAPE_PHONE)
  return override ?? (landscape ? 'landscape' : 'desktop')
}
