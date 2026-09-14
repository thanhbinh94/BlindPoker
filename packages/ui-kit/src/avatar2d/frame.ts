/**
 * The manifest's own frame and crop numbers (`avatar-manifest.json`'s `frame`/`crop`, spec §3): every layer PNG is
 * 384×448, and the 160×160 avatar crop sits at (112, 48) inside it. Kept as data, not hand-typed CSS literals, so
 * the head-crop geometry below — and anything else that ever needs these numbers — derives from one source.
 */
export const CHIBI_FRAME = { w: 384, h: 448 } as const
export const CHIBI_CROP = { x: 112, y: 48, size: 160 } as const

export interface CropGeometry {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where the inner (un-cropped, full-frame) layer stack must sit, in the same unit as `outputSize`, so that the
 * 160×160 crop at (112, 48) exactly fills an `outputSize`-square viewport.
 *
 * `outputSize` is deliberately just a number, not a px value: `Chibi` calls this with an actual pixel size when it
 * has one, and with `100` (reading the result back as percentages) when it does not — the ratios are identical
 * either way, so one function serves both. This replaces a CSS `transform: translate(...) scale(...)`, which
 * applies its scale to the point *before* the translate offset (the offset is never magnified), landing the crop
 * off-centre; plain left/top/width/height on an absolutely positioned box has no such ordering trap.
 */
export function headCropGeometry(outputSize: number): CropGeometry {
  const ratio = outputSize / CHIBI_CROP.size
  return {
    left: -CHIBI_CROP.x * ratio,
    top: -CHIBI_CROP.y * ratio,
    width: CHIBI_FRAME.w * ratio,
    height: CHIBI_FRAME.h * ratio,
  }
}
