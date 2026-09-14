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
import { alphaBBox, placeOnCanvas, resizePicture } from './png.mjs'

/** D01 §3.1. */
export const FRAME = { w: 384, h: 448 }
export const BODY = { x: 80, y: 72, w: 224, h: 336 }
export const AXIS_X = 192
export const BASELINE_Y = 408
/** D01 §5: the portrait is cut from the composed figure, never drawn. */
export const CROP = { x: 112, y: 48, size: 160 }
/** D01 §7: the avatar frame ring, drawn around the 192 px portrait. */
export const RING = 208
/** Spec §3, D5: @3x is gone — the web wants two densities and a third of the bytes back. */
export const DENSITIES = [1, 2]

/** D01 §4.2, plus the two layers spec §3 adds: 5 behind the aura and 90 over everything. */
export const LAYERS = {
  backdrop: 5,
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
 * body between the chin and the hips, and *within* it the underwear is whatever colour covers most of
 * it — the base's own dominant tone there — to a tolerance of `UNDERWEAR_TOLERANCE`. Skin, line art and
 * the odd stray highlight fall outside that tolerance and are not held against the outfit.
 */
export const UNDERWEAR_BAND = { y0: 176, y1: 300 }
export const UNDERWEAR_TOLERANCE = 24
/** …and the fraction of it an outfit has to cover to pass C6. */
export const UNDERWEAR_COVERAGE = 0.98

/** A hat never reaches the waist: what the `head` extraction rule drops (spec §6). */
export const HEAD_LIMIT_Y = 260

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

// ────────────────────────────────────────────────────────────── the stand-ins ──

/**
 * Colours. Nothing here is meant to be pretty: a placeholder that could be mistaken for finished art is
 * a placeholder that ships. Each one is a flat tinted shape of the right size in the right place, with
 * its own file code written across it, so a screen full of them reads as "the art is not here yet" and
 * still exercises every layer, hide rule and crop the renderer has.
 */
const SKIN = { f01: '#dcc4a6', m01: '#c9ac86' }
const UNDERWEAR = { f01: '#9aa3ad', m01: '#8f99a4' }
const HAIR = { f01: '#5b4a6b', m01: '#6b5540' }
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

/** The six expressions of spec §4.3, as the only thing that changes between the six face layers. */
function eyesAndMouth(expression, ink) {
  const mouth = {
    neutral: `<path d="M176 178 Q192 188 208 178" stroke="${ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    happy: `<path d="M172 174 Q192 194 212 174" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    sad: `<path d="M176 186 Q192 174 208 186" stroke="${ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    surprised: `<ellipse cx="192" cy="180" rx="9" ry="11" fill="${ink}"/>`,
    closed: `<path d="M178 178 Q192 186 206 178" stroke="${ink}" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    sleep: `<ellipse cx="192" cy="180" rx="7" ry="9" fill="${ink}"/>`,
  }[expression]
  const eyes = {
    neutral: `<ellipse cx="170" cy="154" rx="12" ry="15" fill="${ink}"/><ellipse cx="214" cy="154" rx="12" ry="15" fill="${ink}"/>`,
    happy: `<path d="M158 158 Q170 144 182 158" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M202 158 Q214 144 226 158" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    sad: `<ellipse cx="170" cy="158" rx="11" ry="13" fill="${ink}"/><ellipse cx="214" cy="158" rx="11" ry="13" fill="${ink}"/><path d="M214 172 q4 8 -2 10" stroke="#7fb7e0" stroke-width="4" fill="none" stroke-linecap="round"/>`,
    surprised: `<circle cx="170" cy="152" r="16" fill="${ink}"/><circle cx="214" cy="152" r="16" fill="${ink}"/>`,
    closed: `<path d="M158 154 Q170 166 182 154" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M202 154 Q214 166 226 154" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/>`,
    sleep: `<path d="M158 154 Q170 166 182 154" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M202 154 Q214 166 226 154" stroke="${ink}" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M232 118 h16 l-16 16 h16" stroke="${ink}" stroke-width="4" fill="none" stroke-linejoin="round"/>`,
  }[expression]
  return eyes + mouth
}

/** The body of the SVG for one stage-1 entry, in frame units. */
function shapesFor(entry) {
  const hue = SLOT_HUE[entry.slot] ?? BOT_HUE
  const tint = hsl(hue + (jitter(entry.name) % 48) - 24, 0.44, 0.54)
  switch (entry.kind) {
    case 'base': {
      const skin = SKIN[entry.base]
      const cloth = UNDERWEAR[entry.base]
      const hair = HAIR[entry.base]
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
      return `<ellipse cx="192" cy="162" rx="56" ry="44" fill="${SKIN[entry.base]}"/>` +
        `<g transform="translate(0 -9)">${eyesAndMouth(entry.expr, '#33272b')}</g>` +
        plate(150, 188, 84, 16, `${entry.base} ${entry.expr}`)
    case 'bot':
      return `${figure(hsl(BOT_HUE, 0.18, 0.68), hsl(BOT_HUE + entry.bot * 24, 0.34, 0.46))}${plate(150, 244, 84, 24, `bot ${entry.bot}`)}`
    case 'botFace':
      return `<rect x="136" y="118" width="112" height="88" rx="20" fill="${hsl(BOT_HUE, 0.18, 0.68)}"/>` +
        `<g transform="translate(0 -9)">${eyesAndMouth(entry.expr, '#22303a')}</g>` +
        plate(146, 188, 92, 16, `bot ${entry.bot} ${entry.expr}`)
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
      // D01 §7: a 208 × 208 ring around the portrait, its middle left empty.
      return `<circle cx="192" cy="128" r="100" fill="none" stroke="${tint}" stroke-width="8"/>${plate(120, 240, 144, 26, entry.code)}`
    default:
      throw new Error(`no placeholder shape for ${entry.name}`)
  }
}

/** The whole SVG for one stage-1 entry at one density. */
export function placeholderSvg(entry, density) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${FRAME.w * density}" height="${FRAME.h * density}" viewBox="0 0 ${FRAME.w} ${FRAME.h}">${shapesFor(entry)}</svg>`
}
