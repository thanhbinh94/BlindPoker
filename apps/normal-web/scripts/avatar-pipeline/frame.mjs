/**
 * The frame: the numbers D01 §3 fixed, the layer order D01 §4.2 fixed, the transform that puts a
 * generated picture on that frame, and the stand-in art the app is built against until the real art
 * exists.
 *
 * Every number here is a *frame unit* — a pixel at @1x. A density multiplies all of them at once, which
 * is the whole reason the placeholders are authored as SVG with a `viewBox`: one description of a shape,
 * rasterised at 768 × 896 and then halved, so @1x and @2x cannot drift apart.
 *
 * D01 §3.4 calls the frame size, the vertical axis and the baseline invariant once the first item
 * exists. They are exported rather than repeated because four other files need them: the extraction
 * rules, the ten checks, the review sheet and — through the manifest — the renderer.
 */
import { alphaBBox, colourDistance, cropPicture, modalColour, placeOnCanvas, resizePicture } from './png.mjs'

/** D01 §3.1. */
export const FRAME = { w: 384, h: 448 }
export const BODY = { x: 80, y: 72, w: 224, h: 336 }
export const AXIS_X = 192
export const BASELINE_Y = 408
/** D01 §5: the portrait is cut from the composed figure, never drawn.
 * 2026-09-15: moved from { x: 112, y: 48, size: 160 } — the first real F01 picture showed the old crop cutting
 * the face at the eyes; the new box keeps the same axis x=192 and centre y=144, just bigger. */
export const CROP = { x: 88, y: 40, size: 208 }
/** D01 §7: the avatar frame ring, drawn around the 208 px portrait. 2026-09-15: scaled from 208 to 260, the
 * same 208/160 = 1.3 factor the crop itself grew by, so the ring keeps its proportion to the portrait. */
export const RING = 260
/**
 * A frame item (layer 90) must leave the portrait showing (2026-09-24): the mean alpha inside `radius` of
 * `RING / 2` around the crop centre stays under `limit`. The same numbers `verify` holds the square picture
 * to before it gets here (`HOLLOW` in `avatar-registry/verify.mjs`), asked again of the layer itself.
 */
export const RING_HOLLOW = { radius: 0.4, limit: 0.05 }
/**
 * An aura (layer 10) is an effect *around* the figure (2026-09-24, Plan 12): its picture is a square with the
 * effect in a ring, fitted so its ink box's larger side is `AURA_SIZE` and centred on (`AXIS_X`, `AURA_CY`) —
 * the placeholder's circle (cy 240, r 140 + a 26 px stroke) at full size. 400 is wider than the 384 frame, so
 * an aura runs off both sides; that is the one layer C2 lets touch the frame edge.
 */
export const AURA_SIZE = 400
export const AURA_CY = 240
/** Spec §3, D5: @3x is gone — the web wants two densities and a third of the bytes back. */
export const DENSITIES = [1, 2]

/** D01 §4.2, plus the layer spec §3 adds on top: 90, over everything. Stage 2 dropped the `backdrop`
 * layer (5) spec §3 had also reserved — nothing ever drew it, so it never shipped a file or an item. */
export const LAYERS = {
  aura: 10,
  hairBack: 20,
  body: 30,
  outfit: 40,
  face: 50,
  hairFront: 60,
  faceAcc: 70,
  head: 80,
  frame: 90,
}

/**
 * The band C6 and the outfit extraction rule call "the underwear".
 *
 * D01 §10.7 asks that an outfit leave none of the base's underwear showing, and gives no coordinates
 * for it, because a person looking at the picture does not need any. The pipeline does: the band is the
 * body between the chin and the hips, and *within* it the underwear is the dominant colour of everything
 * that is neither the head region nor the base's own skin (`underwearRegion` in checks.mjs, and
 * `baseSkinColour` below), to a tolerance of `UNDERWEAR_TOLERANCE`. Line art and the odd stray highlight
 * fall outside that tolerance and are not held against the outfit.
 *
 * The band is a full-width rectangle: it has a `y0` and a `y1` and no `x` at all, which is also exactly
 * how much of the base an outfit layer is allowed to absorb (`underwearUnion` in extract.mjs).
 */
export const UNDERWEAR_BAND = { y0: 176, y1: 300 }
export const UNDERWEAR_TOLERANCE = 24
/**
 * …and the fraction of it an outfit has to cover to pass C6. 2026-09-21 (R3): 0.995, up from 0.98. The
 * base's own clothing is now absorbed by the layer wherever it is rather than only inside the band, so a
 * real outfit covers every pixel of it; what is left of the margin is the antialiased rim of the region.
 */
export const UNDERWEAR_COVERAGE = 0.995

/** A hat never reaches the waist: what the `head` extraction rule drops (spec §6). */
export const HEAD_LIMIT_Y = 260

/**
 * The bottom of the *head region*: just below the chin, above the tank-top straps of the first real F01
 * picture (chin y ≈ 240, hair ends y ≈ 251, straps from y ≈ 256). The head region is the portrait crop
 * *and* `y < FACE_LIMIT_Y`, and it is what a base's face layer (50) holds — see `ingest` in `extract.mjs`.
 * 2026-09-15: added when the first AI base arrived as one flat picture rather than separate layers.
 */
export const FACE_LIMIT_Y = 250

/**
 * The part of the head region a base's face layer (50) gives up (2026-09-17, fix round 1): the torso column
 * x ∈ [150, 234] from y 236 down. Layer 50 sits above the outfit, so whatever of the base it holds there —
 * the tank top's straps beside a collar — shows on top of every outfit; the hair tips either side of it stay.
 */
export const TORSO_COLUMN = { x0: 150, x1: 234, y0: 236 }

/**
 * How far below the head top `measure` finds (frame units) an AI base's strand of hair — its ahoge — is cut
 * off into layer 60 (2026-09-17, fix round 1). The strand's root runs down into the hair a few pixels; cut
 * exactly at the head top it would leave a stub standing beside a hat.
 */
export const STRAND_MARGIN = 6

/**
 * Where a base's own skin colour is measured (2026-09-17, phase 2): the middle of the face, from below
 * the eye line down to the end of the head region.
 *
 * The bases about to be added share F01's body and pose but not her skin, so "is this pixel skin?" has
 * to be asked of *each base* rather than of one hard-coded tone. The window is the one part of every
 * base that is skin by construction — cheeks, chin and the neck under them — narrow enough (x ∈ [140,
 * 244], a quarter of the crop either side of the axis) that the hair hanging beside the face does not
 * get a vote. `modalColour` over it is the base's skin; `isSkin` is every other pixel's distance to it.
 */
export const SKIN_WINDOW = { x0: 140, x1: 244, y0: 124, y1: FACE_LIMIT_Y }
/** How far (RGB distance) a pixel may be from that colour and still be the base's own skin. */
export const SKIN_TOLERANCE = 24

/**
 * C12 "đầu không xê dịch" (Plan 19, spec §5.1, rulings 1–2): where a v4 body's head has to sit, so the hats, glasses,
 * auras, frames and portrait crop cut on F01 still land on it. F01's and M01's hair is baked into their L30, so the
 * skull cannot be measured; the eyes and the chin can. These are F01's, from `headMetrics` on the committed
 * `base_f01_L30@1x` and `base_f01_face_neutral_L50_eyemask@2x` — eye midpoint (190.91, 193.99), eye span 60.61,
 * chin 243 — rounded to a tenth. Both bodies are held to them (ruling 2): M01's head, measured the same way at
 * (191.46, 198.59), 60.78 and 239, sits 4.6 units lower than F01's, past the tolerance, and every shared item was
 * cut on F01. Recorded for information only.
 */
export const HEAD_REFERENCE = { eyeMidX: 190.9, eyeMidY: 194.0, eyeSpan: 60.6, chinY: 243 }
/** How far each of `HEAD_REFERENCE`'s eye numbers (midpoint x and y, span) may drift: 2 % of the 208 crop, the spec's "không quá 2%". */
export const HEAD_TOLERANCE = 4.16
/**
 * How far the chin may drift from `HEAD_REFERENCE.chinY` — its own, wider limit (controller ruling, Plan 19 gate): a
 * bald chibi face is drawn shorter than F01's framed one (real v4 bodies chin at 233–236 against 243, eyes within
 * ~2 units), and the chin anchors nothing once the outfits are redrawn on the new bodies; glasses ride the eye line
 * and hats the head top, so the eyes stay held to `HEAD_TOLERANCE`.
 */
export const CHIN_TOLERANCE = 12
/**
 * C11 on a body L30 (Plan 19, spec §5.5): the share of the layer's own ink its skin mask may cover. Provisional —
 * the stand-ins measure 0.57 — until the style gate measures the two real bodies and sets it to theirs ± 0.10 (B5).
 */
export const SKIN_AREA = { min: 0.35, max: 0.85 }

/** The base's skin colour, in the frame's own units at `density`, or `null` on an empty window. */
export function baseSkinColour(pic, density = 1) {
  return modalColour(pic, (x, y) =>
    x >= SKIN_WINDOW.x0 * density && x < SKIN_WINDOW.x1 * density &&
    y >= SKIN_WINDOW.y0 * density && y < SKIN_WINDOW.y1 * density)
}

/** Whether an RGB triple is that base's skin. A base with no measurable skin calls nothing skin. */
export function isSkin(r, g, b, skin, tolerance = SKIN_TOLERANCE) {
  return skin !== null && colourDistance(r, g, b, skin[0], skin[1], skin[2]) <= tolerance
}

// ─────────────────────────────────────────────────────────────── the anchors ──

/**
 * Work out the one transform that puts a generated picture on the frame.
 *
 * The figure's bounding box is mapped so that its height becomes `BODY.h` — top of the hair at
 * `BODY.y`, feet on `BASELINE_Y` — and its horizontal centre lands on `AXIS_X`. The scale is a single
 * number applied to both axes: a fit that squashed one axis would make the character a different shape
 * from the items generated beside it, and every item reuses this transform (`--lock-scale`) precisely
 * so that they share one mapping.
 *
 * Returns the transform in *source* terms: a source pixel `(sx, sy)` lands at
 * `(sx * scale + offsetX, sy * scale + offsetY)` in frame units.
 */
export function anchorBase(pic) {
  const bbox = alphaBBox(pic)
  if (!bbox) throw new Error('the picture is empty — nothing survived the background removal')
  const scale = BODY.h / bbox.h
  return {
    scale,
    offsetX: AXIS_X - (bbox.x + bbox.w / 2) * scale,
    offsetY: BODY.y - bbox.y * scale,
    bbox,
  }
}

/** Put a picture on the frame at the given density using a transform from `anchorBase`. */
export async function applyTransform(pic, transform, density) {
  const scaled = await resizePicture(
    pic,
    Math.max(1, Math.round(pic.width * transform.scale * density)),
    Math.max(1, Math.round(pic.height * transform.scale * density)),
  )
  return placeOnCanvas(scaled, FRAME.w * density, FRAME.h * density, Math.round(transform.offsetX * density), Math.round(transform.offsetY * density))
}

/**
 * Put a *square* picture — an aura or a frame ring, which has no figure to anchor on — on the frame at the
 * given density by its ink box alone (2026-09-24): the box is scaled, aspect kept, until its larger side is
 * `size` frame units, and its centre lands on (`cx`, `cy`). Whatever then falls outside the frame is cut off.
 */
export async function placeByInk(pic, { size, cx, cy }, density) {
  const box = alphaBBox(pic)
  if (!box) throw new Error('the picture is empty — nothing survived the background removal')
  const factor = (size * density) / Math.max(box.w, box.h)
  const width = Math.max(1, Math.round(box.w * factor))
  const height = Math.max(1, Math.round(box.h * factor))
  const fitted = await resizePicture(cropPicture(pic, box.x, box.y, box.w, box.h), width, height)
  return placeOnCanvas(fitted, FRAME.w * density, FRAME.h * density, Math.round(cx * density - width / 2), Math.round(cy * density - height / 2))
}

// ────────────────────────────────────────────────────────────── the stand-ins ──

/**
 * Colours. Nothing here is meant to be pretty: a placeholder that could be mistaken for finished art is
 * a placeholder that ships. Each one is a flat tinted shape of the right size in the right place, with
 * its own file code written across it, so a screen full of them reads as "the art is not here yet" and
 * still exercises every layer, hide rule and crop the renderer has.
 */
/**
 * The two bases that existed when the stand-ins were drawn keep their exact tones, so re-running
 * `placeholder` never rewrites a committed file. Any base added to `BASES` later — which is all it takes
 * to get a full set of stand-ins for it (§4, R5) — is given its own skin, underwear and hair by the same
 * stable hue jitter the items use, so three bases are three figures and not one drawn three times.
 */
const SKIN = { f01: '#dcc4a6', m01: '#c9ac86' }
const UNDERWEAR = { f01: '#9aa3ad', m01: '#8f99a4' }
const HAIR = { f01: '#5b4a6b', m01: '#6b5540' }
const skinOf = (base) => SKIN[base] ?? hsl(10 + (jitter(base) % 40), 0.42, 0.40 + ((jitter(base) >> 3) % 5) * 0.11)
const underwearOf = (base) => UNDERWEAR[base] ?? hsl(200 + (jitter(base) % 40), 0.12, 0.64)
const hairOf = (base) => HAIR[base] ?? hsl(jitter(`hair ${base}`), 0.26, 0.34)
const SLOT_HUE = { head: 14, face: 205, outfit: 232, aura: 172, frame: 45 }
const BOT_HUE = 190

/** A stable hue jitter per file name, so a sheet of eight auras is eight colours and not one. */
function jitter(name) {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360
  return hash
}

function hsl(hue, saturation, lightness) {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const second = chroma * (1 - Math.abs((((hue % 360) + 360) / 60) % 2 - 1))
  const base = lightness - chroma / 2
  const sextant = Math.floor((((hue % 360) + 360) % 360) / 60)
  const rgb = [
    [chroma, second, 0],
    [second, chroma, 0],
    [0, chroma, second],
    [0, second, chroma],
    [second, 0, chroma],
    [chroma, 0, second],
  ][sextant]
  return `#${rgb.map((channel) => Math.round((channel + base) * 255).toString(16).padStart(2, '0')).join('')}`
}

/**
 * The label every stand-in carries.
 *
 * It is an *opaque* rounded rectangle with the text inside it, and that is load-bearing rather than
 * decorative: text drawn straight onto transparency antialiases to pale half-transparent pixels, which
 * is exactly the "white fringe" D01 §8.3 forbids and C4 looks for. Inside a solid plate the glyph edges
 * are interior pixels and no check ever sees them.
 *
 * The type size is computed rather than declared, because a long code like `glasses_round_gold01` set at
 * a fixed size runs off the end of its plate and out of the portrait crop — which is C5 failing on a
 * caption. SVG's own `textLength` would be the right tool and librsvg does not honour it, so the width
 * is estimated from the glyph count instead: 0.58 em per character is a safe average for the sans faces
 * this falls back through, and over-estimating only makes the label smaller.
 */
function plate(x, y, w, h, text, ink = '#eef2f7') {
  const size = Math.max(5, Math.min(h - 8, 16, (w - 10) / (0.58 * text.length)))
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="#13161a"/>` +
    `<text x="${x + w / 2}" y="${y + h / 2 + size * 0.36}" text-anchor="middle"` +
    ` font-family="DejaVu Sans, Verdana, Arial, sans-serif" font-size="${size.toFixed(2)}" fill="${ink}">${text}</text>`
}

/** The standing figure the bases and the bots share: head, neck, torso, arms, hands, legs, feet. */
function figure(skin, cloth) {
  return `<ellipse cx="192" cy="146.5" rx="80" ry="74.5" fill="${skin}"/>` +
    `<rect x="177" y="216" width="30" height="20" fill="${cloth}"/>` +
    `<rect x="148" y="228" width="88" height="96" rx="14" fill="${cloth}"/>` +
    `<rect x="124" y="236" width="22" height="84" rx="11" fill="${cloth}"/>` +
    `<rect x="238" y="236" width="22" height="84" rx="11" fill="${cloth}"/>` +
    `<circle cx="135" cy="326" r="13" fill="${skin}"/>` +
    `<circle cx="249" cy="326" r="13" fill="${skin}"/>` +
    `<rect x="166" y="318" width="24" height="84" rx="12" fill="${cloth}"/>` +
    `<rect x="194" y="318" width="24" height="84" rx="12" fill="${cloth}"/>` +
    `<ellipse cx="172" cy="400" rx="20" ry="8" fill="${skin}"/>` +
    `<ellipse cx="212" cy="400" rx="20" ry="8" fill="${skin}"/>`
}

/**
 * One expression of spec §4.3 in three parts (Plan 19): the **eyes**, which are all an eye mask is; the
 * **extras** drawn beside them — sad's tear and sleep's Z, which are not eyes (the tear would split the right
 * eye's blob if an eye mask held it); and the **mouth**. `grow` widens every shape by that many frame units,
 * which is how a skin mask cuts them with a margin; `tear` is the tear's own colour, which a mask overrides.
 */
function expressionParts(expression, ink, { grow = 0, tear = '#7fb7e0' } = {}) {
  const solid = grow ? `fill="${ink}" stroke="${ink}" stroke-width="${grow}"` : `fill="${ink}"`
  const line = (width, colour = ink) => `stroke="${colour}" stroke-width="${width + grow}" fill="none"`
  const mouth = {
    neutral: `<path d="M176 178 Q192 188 208 178" ${line(4)} stroke-linecap="round"/>`,
    happy: `<path d="M172 174 Q192 194 212 174" ${line(5)} stroke-linecap="round"/>`,
    sad: `<path d="M176 186 Q192 174 208 186" ${line(4)} stroke-linecap="round"/>`,
    surprised: `<ellipse cx="192" cy="180" rx="9" ry="11" ${solid}/>`,
    closed: `<path d="M178 178 Q192 186 206 178" ${line(4)} stroke-linecap="round"/>`,
    sleep: `<ellipse cx="192" cy="180" rx="7" ry="9" ${solid}/>`,
  }[expression]
  const shut = `<path d="M158 154 Q170 166 182 154" ${line(5)} stroke-linecap="round"/><path d="M202 154 Q214 166 226 154" ${line(5)} stroke-linecap="round"/>`
  const eyes = {
    neutral: `<ellipse cx="170" cy="154" rx="12" ry="15" ${solid}/><ellipse cx="214" cy="154" rx="12" ry="15" ${solid}/>`,
    happy: `<path d="M158 158 Q170 144 182 158" ${line(5)} stroke-linecap="round"/><path d="M202 158 Q214 144 226 158" ${line(5)} stroke-linecap="round"/>`,
    sad: `<ellipse cx="170" cy="158" rx="11" ry="13" ${solid}/><ellipse cx="214" cy="158" rx="11" ry="13" ${solid}/>`,
    surprised: `<circle cx="170" cy="152" r="16" ${solid}/><circle cx="214" cy="152" r="16" ${solid}/>`,
    closed: shut,
    sleep: shut,
  }[expression]
  const extras = {
    sad: `<path d="M214 172 q4 8 -2 10" ${line(4, tear)} stroke-linecap="round"/>`,
    sleep: `<path d="M232 118 h16 l-16 16 h16" ${line(4)} stroke-linejoin="round"/>`,
  }[expression] ?? ''
  return { eyes, extras, mouth }
}

/** The six expressions of spec §4.3, as the only thing that changes between the six face layers. */
function eyesAndMouth(expression, ink) {
  const { eyes, extras, mouth } = expressionParts(expression, ink)
  return eyes + extras + mouth
}

// ── the v4 stand-ins (Plan 19, spec §5.2–§5.4) ──

/** Both v4 bodies are drawn cream (spec §5.2); the underwear tells f from m at a glance, the plate says so. */
const BODY_SKIN = '#f1d2b6'
const BODY_UNDERWEAR = { f: '#9aa3ad', m: '#8f99a4' }
const FACE_INK = '#33272b'
/** One tint per hairstyle, shared by its two layers, so a sheet of eight is eight colours. */
const hairTint = (code) => hsl(jitter(`hair ${code}`), 0.36, 0.4)
/** The three long styles whose back layer hangs behind the shoulders; every other style's is a crescent behind the head. */
const LONG_HAIR = new Set(['f_hime01', 'f_wavy01', 'f_ponytail01'])

/** Where each v4 stand-in's plate sits, so the layer and its masks agree on it. */
const BODY_PLATE = { x: 150, y: 250, w: 84, h: 24 }
const FACE_PLATE = { x: 150, y: 188, w: 84, h: 16 }
const FRONT_PLATE = { x: 132, y: 70, w: 120, h: 22 }
const CRESCENT_PLATE = { x: 140, y: 222, w: 104, h: 22 }
/** Long hair's plate runs up the left panel, turned a quarter, because a panel is narrower than its code. */
const PANEL_PLATE = { x: 68, y: 288, w: 110, h: 24, turn: 'rotate(-90 123 300)' }

/**
 * The relaxed pose of spec §5.2, as a stand-in: `figure()`'s shapes with the weight on the right leg, which
 * stays straight while the left one rests a little out; both arms angled away from the body; five short finger
 * strokes on each hand, the thumb toward the body. The head is bald — hair is an item now. `figure()` itself is
 * untouched, because the old bases and the bots still draw with it.
 */
export function relaxedFigure(skin, cloth) {
  const arm = (x, pivot, turn, inward) =>
    `<g transform="rotate(${turn} ${pivot} 240)">` +
    `<rect x="${x}" y="236" width="22" height="84" rx="11" fill="${cloth}"/>` +
    `<circle cx="${pivot}" cy="326" r="12" fill="${skin}"/>${fingers(pivot, 326, inward, skin)}</g>`
  return `<ellipse cx="192" cy="146.5" rx="80" ry="74.5" fill="${skin}"/>` +
    `<rect x="177" y="216" width="30" height="20" fill="${cloth}"/>` +
    `<rect x="148" y="228" width="88" height="96" rx="14" fill="${cloth}"/>` +
    arm(124, 135, 12, 1) +
    arm(238, 249, -12, -1) +
    `<g transform="rotate(8 178 320)"><rect x="166" y="318" width="24" height="80" rx="12" fill="${cloth}"/></g>` +
    `<rect x="194" y="318" width="24" height="84" rx="12" fill="${cloth}"/>` +
    `<ellipse cx="162" cy="398" rx="19" ry="8" fill="${skin}"/>` +
    `<ellipse cx="212" cy="400" rx="20" ry="8" fill="${skin}"/>`
}

/** Four fingers fanned below the palm and a thumb toward the body (`inward` +1 points it right, −1 left). */
const FINGERS = [{ angle: -36, to: 20 }, { angle: -12, to: 20 }, { angle: 12, to: 20 }, { angle: 36, to: 20 }, { angle: 70, to: 18 }]
function fingers(cx, cy, inward, colour) {
  const d = FINGERS.map(({ angle, to }) => {
    const rad = (angle * inward * Math.PI) / 180
    const at = (r) => `${(cx + Math.sin(rad) * r).toFixed(1)} ${(cy + Math.cos(rad) * r).toFixed(1)}`
    return `M${at(9)} L${at(to)}`
  }).join(' ')
  return `<path d="${d}" stroke="${colour}" stroke-width="3.6" fill="none" stroke-linecap="round"/>`
}

/**
 * A hairstyle's shape on one of its two layers. **L60** is a fringe-and-crown cap whose lowest point (y 120) is
 * above y 126, clear of every stand-in eye (y 127–160). **L20** is, for a long style, two panels behind the
 * shoulders from y 238 down, either side of the torso; for a short one, a crescent behind the head from y 130
 * down. The layers therefore never share a pixel. The crescent's clip path id is fixed: every stand-in is an
 * SVG of its own.
 */
function hairShape(entry, colour) {
  if (entry.layer === LAYERS.hairFront) {
    return `<path d="M104 120 C100 62 146 52 192 52 C238 52 284 62 280 120 Q258 104 236 118 Q214 102 192 116 Q170 102 148 118 Q126 104 104 120 Z" fill="${colour}"/>`
  }
  if (LONG_HAIR.has(entry.code)) {
    return `<rect x="100" y="238" width="46" height="124" rx="16" fill="${colour}"/>` +
      `<rect x="238" y="238" width="46" height="124" rx="16" fill="${colour}"/>`
  }
  return `<clipPath id="below-cap"><rect x="0" y="130" width="${FRAME.w}" height="${FRAME.h - 130}"/></clipPath>` +
    `<path clip-path="url(#below-cap)" fill-rule="evenodd" fill="${colour}" d="M92 170 A100 90 0 1 0 292 170 A100 90 0 1 0 92 170 Z M110 136 A82 78 0 1 0 274 136 A82 78 0 1 0 110 136 Z"/>`
}

/** Where a hair layer's plate goes: inside its own shape, always. */
function hairPlate(entry) {
  if (entry.layer === LAYERS.hairFront) return { ...FRONT_PLATE, text: `${entry.code} front` }
  return { ...(LONG_HAIR.has(entry.code) ? PANEL_PLATE : CRESCENT_PLATE), text: `${entry.code} back` }
}

const drawPlate = ({ x, y, w, h, text, turn }) => {
  const drawn = plate(x, y, w, h, text)
  return turn ? `<g transform="${turn}">${drawn}</g>` : drawn
}

/** The face of a v4 body: the oval and one expression, as a base's stand-in face is drawn. */
const faceOval = (skin) => `<ellipse cx="192" cy="162" rx="56" ry="44" fill="${skin}"/>`

/** The body of the SVG for one stage-1 entry, in frame units. */
function shapesFor(entry) {
  const hue = SLOT_HUE[entry.slot] ?? BOT_HUE
  const tint = hsl(hue + (jitter(entry.name) % 48) - 24, 0.44, 0.54)
  switch (entry.kind) {
    case 'base': {
      const skin = skinOf(entry.base)
      const cloth = underwearOf(entry.base)
      const hair = hairOf(entry.base)
      if (entry.layer === LAYERS.hairBack) {
        return `<ellipse cx="192" cy="150" rx="94" ry="84" fill="${hair}"/>${plate(132, 190, 120, 24, `${entry.base} hair back`)}`
      }
      if (entry.layer === LAYERS.hairFront) {
        // A fringe, not a helmet: layer 60 sits over the face, so it has to stop above the eye line at
        // ~62 % of the head or every expression underneath it is invisible.
        return `<ellipse cx="192" cy="96" rx="82" ry="38" fill="${hair}"/>${plate(140, 80, 104, 22, `${entry.base} bangs`)}`
      }
      return `${figure(skin, cloth)}${plate(150, 244, 84, 24, entry.base)}`
    }
    case 'baseFace':
      return `<ellipse cx="192" cy="162" rx="56" ry="44" fill="${skinOf(entry.base)}"/>` +
        `<g transform="translate(0 -9)">${eyesAndMouth(entry.expr, '#33272b')}</g>` +
        plate(150, 188, 84, 16, `${entry.base} ${entry.expr}`)
    case 'bot':
      return `${figure(hsl(BOT_HUE, 0.18, 0.68), hsl(BOT_HUE + entry.bot * 24, 0.34, 0.46))}${plate(150, 244, 84, 24, `bot ${entry.bot}`)}`
    case 'botFace':
      return `<rect x="136" y="118" width="112" height="88" rx="20" fill="${hsl(BOT_HUE, 0.18, 0.68)}"/>` +
        `<g transform="translate(0 -9)">${eyesAndMouth(entry.expr, '#22303a')}</g>` +
        plate(146, 188, 92, 16, `bot ${entry.bot} ${entry.expr}`)
    case 'body':
      return `${relaxedFigure(BODY_SKIN, BODY_UNDERWEAR[entry.gender])}${drawPlate({ ...BODY_PLATE, text: `body ${entry.gender}` })}`
    case 'bodyFace':
      return `${faceOval(BODY_SKIN)}<g transform="translate(0 -9)">${eyesAndMouth(entry.expr, FACE_INK)}</g>` +
        drawPlate({ ...FACE_PLATE, text: `${entry.gender} ${entry.expr}` })
    case 'hair':
      return `${hairShape(entry, hairTint(entry.code))}${drawPlate(hairPlate(entry))}`
    default:
      return itemShapes(entry, tint)
  }
}

function itemShapes(entry, tint) {
  switch (entry.slot) {
    case 'head':
      // Crown and brim, both inside the portrait crop — C5 is the check that says so.
      return `<rect x="124" y="58" width="136" height="58" rx="14" fill="${tint}"/>` +
        `<rect x="116" y="112" width="152" height="18" rx="9" fill="${tint}"/>` +
        plate(128, 66, 128, 22, entry.code)
    case 'face':
      return `<rect x="130" y="144" width="124" height="38" rx="17" fill="${tint}"/>${plate(136, 150, 112, 26, entry.code)}`
    case 'outfit':
      // Neck to feet (D01 §4.1), which is also what makes C6 pass: the band at y 176–300 is covered.
      return `<rect x="116" y="212" width="152" height="120" rx="18" fill="${tint}"/>` +
        `<rect x="158" y="322" width="32" height="86" rx="12" fill="${tint}"/>` +
        `<rect x="194" y="322" width="32" height="86" rx="12" fill="${tint}"/>` +
        plate(130, 238, 124, 26, entry.code)
    case 'aura':
      return `<circle cx="192" cy="240" r="140" fill="none" stroke="${tint}" stroke-width="26"/>${plate(120, 350, 144, 26, entry.code)}`
    case 'frame':
      // D01 §7: a 260 × 260 ring around the portrait, its middle left empty. Centred on the crop centre
      // (192, 144); 2026-09-15 moved from cx=192 cy=128 r=100 stroke 8 to match the 208 crop.
      return `<circle cx="192" cy="144" r="130" fill="none" stroke="${tint}" stroke-width="10"/>${plate(120, 240, 144, 26, entry.code)}`
    default:
      throw new Error(`no placeholder shape for ${entry.name}`)
  }
}

/** The whole SVG for one stage-1 entry at one density. */
export function placeholderSvg(entry, density) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.w * density}" height="${FRAME.h * density}" viewBox="0 0 ${FRAME.w} ${FRAME.h}">${shapesFor(entry)}</svg>`
}

// ── the stand-ins' masks (Plan 19) ──

/** A mask SVG is opaque: white where the region is, black elsewhere, so its red channel is the coverage. */
const IN = '#ffffff'
const OUT = '#000000'
/**
 * How far (frame units) a skin mask's black cut reaches past an eye, a mouth or a plate. At @2x that is 2 px of
 * clear skin between the two masks' soft rims, so no pixel is ever ≥ 128 in both the skin and the eye mask.
 */
const MASK_CUT = 1
const plateCut = ({ x, y, w, h, turn }) => {
  const cut = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${OUT}" stroke="${OUT}" stroke-width="${2 * MASK_CUT}"/>`
  return turn ? `<g transform="${turn}">${cut}</g>` : cut
}

/** The shapes of one stand-in's mask: the very shapes `shapesFor` draws, in mask colours. */
function maskShapes(entry, kind) {
  switch (`${entry.kind} ${kind}`) {
    case 'body skin':
      // Skin white and underwear black, in the figure's own drawing order, so the neck that covers the chin and
      // the hands that cover the sleeves come out exactly as drawn; then the plate, which sits on the underwear.
      return `${relaxedFigure(IN, OUT)}${plateCut(BODY_PLATE)}`
    case 'bodyFace skin': {
      // The oval, less everything drawn on it: eyes, tear or Z, mouth and plate, each with a margin.
      const { eyes, extras, mouth } = expressionParts(entry.expr, OUT, { grow: 2 * MASK_CUT, tear: OUT })
      return `${faceOval(IN)}<g transform="translate(0 -9)">${eyes}${extras}${mouth}</g>${plateCut(FACE_PLATE)}`
    }
    case 'bodyFace eyes':
      // The eyes only — no tear, no Z, no mouth — and none at all when they are shut.
      if (entry.expr === 'closed' || entry.expr === 'sleep') return ''
      return `<g transform="translate(0 -9)">${expressionParts(entry.expr, IN).eyes}</g>`
    case 'hair hair':
      // The whole hair shape: its plate sits inside it.
      return hairShape(entry, IN)
    default:
      throw new Error(`no ${kind} mask is drawn for the stand-in ${entry.name}`)
  }
}

/**
 * The SVG of one stand-in's mask (Plan 19) — `skin` on a body or a body face, `eyes` on a body face, `hair` on a
 * hair layer — rendered from the same shapes as the stand-in itself, never computed from its pixels (pre-flight
 * #8). Opaque, white where the region is and black elsewhere: the red channel is the mask. @2x by default, the
 * density every mask is cut at.
 */
export function placeholderMaskSvg(entry, kind, density = 2) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.w * density}" height="${FRAME.h * density}" viewBox="0 0 ${FRAME.w} ${FRAME.h}">` +
    `<rect width="${FRAME.w}" height="${FRAME.h}" fill="${OUT}"/>${maskShapes(entry, kind)}</svg>`
}
