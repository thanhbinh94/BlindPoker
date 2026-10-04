/**
 * The body's own skin, which "Tự nhiên" on Màu da shows (spec §4.2's "cream"): the real body f's skin as measured on its
 * final skin mask (`avatar-pipeline.mjs colours body_f_L30`, Plan 19 batch C6; body m's is #fbe0c7). It sits between Da
 * sáng and Da sáng ấm.
 *
 * A module of its own, importing nothing, so `test/natural-skin.test.ts` — Node, reading the committed art — can measure
 * the body again and hold this to it: the art changes, the test fails, rather than the swatch drifting off the body
 * (Plan 19 final review).
 */
export const NATURAL_SKIN = '#fbe0ca'
