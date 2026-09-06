/**
 * How far the figure turns, and how much of a turn each gesture is worth.
 *
 * Its own module, and free of three.js, for one reason: `AvatarStage.tsx` ships in the entry-side
 * graph and reads these numbers to interpret a drag, while `stage.ts` reads them to apply the result
 * — and a static import of `stage.ts` from a component would drag 150 KB of three into every chunk
 * that renders one. Four numbers are cheaper to share than a boundary is to breach.
 */

const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** How far the figure may be turned from its resting view, either way (design §6: "kéo để xoay ±60°"). */
export const YAW_LIMIT = rad(60)

/** One arrow-key press. Twelve of them cross the whole range — a comfortable number of taps. */
export const YAW_STEP = rad(10)

/**
 * The three-quarter turn the figure rests at.
 *
 * Not zero: a character squared on to the camera reads as a mugshot, and the whole point of a stage
 * rather than a picture is that it has a third dimension. Yaw is measured from *this*, so "reset
 * view" comes back here and the ±60° range is symmetric around it.
 */
export const BASE_YAW = rad(-22)

/** A drag of ~320 px crosses the whole range, which is a thumb's width of travel on a phone. */
export const YAW_PER_PIXEL = (YAW_LIMIT * 2) / 320

/** Keeps a yaw inside the range, wherever it came from. */
export const clampYaw = (radians: number): number => Math.min(Math.max(radians, -YAW_LIMIT), YAW_LIMIT)
