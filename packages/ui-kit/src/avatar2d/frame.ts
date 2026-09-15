/**
 * The manifest's own frame and crop numbers (`avatar-manifest.json`'s `frame`/`crop`, spec §3): every layer PNG is
 * 384×448, and the 208×208 avatar crop sits at (88, 40) inside it. Kept as data, not hand-typed CSS literals, so
 * the head-crop geometry below — and anything else that ever needs these numbers — derives from one source.
 *
 * 2026-09-15: crop moved from { x: 112, y: 48, size: 160 } — the first real F01 picture showed the old crop
 * cutting the face at the eyes.
 */
export const CHIBI_FRAME = { w: 384, h: 448 } as const
export const CHIBI_CROP = { x: 88, y: 40, size: 208 } as const

export interface CropGeometry {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the inner (un-cropped, full-frame) layer stack must sit, in the same unit as `outputSize`, so that the
 * 208×208 crop at (88, 40) exactly fills an `outputSize`-square viewport.
 *
 * `outputSize` is deliberately just a number, not a px value: `Chibi` calls this with an actual pixel size when it
 * has one, and with `100` (reading the result back as percentages) when it does not — the ratios are identical
 * either way, so one function serves both. This replaces a CSS `transform: translate(...) scale(...)`, which
 * applies its scale to the point *before* the translate offset (the offset is never magnified), landing the crop
 * off-centre; plain left/top/width/height on an absolutely positioned box has no such ordering trap.
 */
export function headCropGeometry(outputSize: number): CropGeometry {
  // Multiply by the (integer) crop numbers first and divide once, rather than computing `outputSize / 208` as its
  // own intermediate ratio: `208` does not divide every `outputSize` (96, notably) into a binary float that
  // round-trips cleanly, so `-88 * (96 / 208)` prints `-40.61538461538462` while `-(88 * 96) / 208` prints the
  // shorter `-40.61538461538461` — cosmetic in a browser (both resolve to the same pixel), but not in a test that
  // pins the number, or in a CSS string a reviewer or another test is going to read.
  return {
    left: -(CHIBI_CROP.x * outputSize) / CHIBI_CROP.size,
    top: -(CHIBI_CROP.y * outputSize) / CHIBI_CROP.size,
    width: (CHIBI_FRAME.w * outputSize) / CHIBI_CROP.size,
    height: (CHIBI_FRAME.h * outputSize) / CHIBI_CROP.size,
  }
}
