import type { ReactNode } from 'react'

/**
 * The avatar part library: one small vector per catalogue item, keyed by the item's `assetKey`
 * (`<category>/<id>`, exactly the string `apps/normal-server/data/items.json` carries).
 *
 * Everything is drawn into the same 64×64 box on the same skeleton, so any base can wear any hair and any
 * collar without the parts drifting apart:
 *
 * ```
 *   y  0 ┬ hats and crowns sit above the skull
 *     11 ┼ top of the head           ─┐
 *     25 ┼ eye line                   │ head: cx 32, half-width 13, half-height 14
 *     32 ┼ mouth line                 │
 *     39 ┴ chin                      ─┘
 *     44 ┼ shoulder line — every collar starts here
 *     64 ┴ bottom edge
 * ```
 *
 * The parts are deliberately few paths each: a seat disc is 30 px across on a phone, so anything finer than
 * a couple of shapes is a smudge. What has to survive that size is *which item is equipped* — a conical hat
 * must read as a conical hat at 30 px — which is why the variants differ in silhouette, not in detail.
 *
 * Colours come from the kit's tokens (`--gold`, `--red`, `--teal`, `--card-face`) wherever the item is meant
 * to follow the theme, and from the fixed skin/cloth tones below wherever it is not: a person's face is not a
 * theme colour, and a `--ink` face on a `--bg` ground would invert with the theme into a different person.
 */

/** Draw order, top layer last — spec §15.1. `title` and `badge` are text, not layers, and are absent here. */
export const LAYER_ORDER = ['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry'] as const

export type AvatarLayer = (typeof LAYER_ORDER)[number]

/** The CSS custom property `Avatar` sets on the `<svg>`; every hair part fills from it. */
export const HAIR_VAR = '--avatar-hair'

/** The hair colour a config gets when it names none, and the fallback baked into every hair fill. */
export const DEFAULT_HAIR_COLOR = '#2b2b2b'

/**
 * The palette the wardrobe screen (Task 3) offers for `hairColor`. The server validates the field as a hex
 * colour rather than against this list, so it is a suggestion, not a constraint — but it is the list that
 * keeps eight players at one table telling each other apart on the kit's ground.
 */
export const HAIR_PRESETS = [
  '#2b2b2b', // ink
  '#4a2f1d', // dark brown
  '#8a5a2b', // chestnut
  '#d9a441', // gold
  '#c8323c', // lacquer red
  '#3f938a', // teal
  '#7b4bbd', // violet
  '#e7e3d8', // silver
] as const

export interface PartProps {
  /**
   * An explicit hair colour. `Avatar` leaves it undefined and sets `--avatar-hair` on the `<svg>` instead —
   * one declaration for every hair path — but a caller drawing a single part outside an `Avatar` (the
   * wardrobe's swatch previews) can pass the colour directly.
   */
  hairColor?: string
}

export type PartRenderer = (props: PartProps) => ReactNode

/* ── the shared skeleton ───────────────────────────────────────────────────── */

const SKIN = '#e9bb92'
const SKIN_SHADE = '#cf9d74'
const EYE = '#20263a'
const CLOTH_LINE = 'rgba(8, 12, 24, 0.34)'
const METAL = '#cfd6e4'

/** Every collar is this silhouette with a neckline cut into it; only the fill and the neckline change. */
const SHOULDERS = 'M4 64 C 6.5 50.5 17.5 43.5 32 43.5 C 46.5 43.5 57.5 50.5 60 64 Z'

const hairFill = (hairColor?: string): string => hairColor ?? `var(${HAIR_VAR}, ${DEFAULT_HAIR_COLOR})`

/** Neck and ears, shared by every base: the parts above and below both attach to them. */
const neckAndEars = (
  <>
    <rect x="27" y="32" width="10" height="12" rx="4" fill={SKIN_SHADE} />
    <ellipse cx="19" cy="27" rx="2.4" ry="3.2" fill={SKIN_SHADE} />
    <ellipse cx="45" cy="27" rx="2.4" ry="3.2" fill={SKIN_SHADE} />
  </>
)

/* ── base: the ground the item is named for, plus a head silhouette ────────── */

export const PARTS: Record<string, PartRenderer> = {
  // "Plain base" — flat night ground, round head.
  'base/base_01': () => (
    <>
      <circle cx="32" cy="32" r="32" fill="#17203a" />
      {neckAndEars}
      <ellipse cx="32" cy="25" rx="13" ry="14" fill={SKIN} />
    </>
  ),

  // "Tile base" — the ground carries a faint hàng-hiên tile grid; oval head.
  'base/base_02': () => (
    <>
      <circle cx="32" cy="32" r="32" fill="#17203a" />
      <g stroke="var(--teal, #3f938a)" strokeWidth="1" opacity="0.34">
        <path d="M0 16 H64 M0 32 H64 M0 48 H64" />
        <path d="M16 0 V64 M32 0 V64 M48 0 V64" />
      </g>
      {neckAndEars}
      <ellipse cx="32" cy="25" rx="12" ry="15" fill={SKIN} />
    </>
  ),

  // "Indigo base" — deeper indigo ground, square jaw.
  'base/base_03': () => (
    <>
      <circle cx="32" cy="32" r="32" fill="#26306b" />
      {neckAndEars}
      <rect x="20" y="11" width="24" height="28" rx="9" fill={SKIN} />
    </>
  ),

  // "Lacquer base" (rare) — sơn mài red with a gold sweep; heart-shaped face.
  'base/base_04': () => (
    <>
      <circle cx="32" cy="32" r="32" fill="#6e1c22" />
      <path d="M0 46 C 16 38 48 38 64 46 L64 64 L0 64 Z" fill="rgba(217, 164, 65, 0.24)" />
      <path d="M2 22 C 14 12 50 12 62 22" stroke="var(--gold, #d9a441)" strokeWidth="1.2" fill="none" opacity="0.7" />
      {neckAndEars}
      <path d="M32 11 C 23.5 11 19 16.5 19 23 C 19 31.5 26 37.5 32 40 C 38 37.5 45 31.5 45 23 C 45 16.5 40.5 11 32 11 Z" fill={SKIN} />
    </>
  ),

  // "Mother-of-pearl base" (rare) — pale khảm trai ground with two nacre arcs; long face.
  'base/base_05': () => (
    <>
      <circle cx="32" cy="32" r="32" fill="#cbd6e6" />
      <g stroke="#8fa6c6" strokeWidth="1.4" fill="none" opacity="0.75">
        <path d="M-2 44 C 12 30 30 26 66 34" />
        <path d="M-2 56 C 14 44 34 40 66 48" />
      </g>
      <circle cx="14" cy="16" r="4" fill="#eef3fa" opacity="0.85" />
      {neckAndEars}
      <ellipse cx="32" cy="26" rx="11" ry="16" fill={SKIN} />
    </>
  ),

  /* ── face: eyes, brows and mouth on the eye/mouth lines ─────────────────── */

  // "Calm face" — level eyes, a level mouth.
  'face/face_01': () => (
    <>
      <circle cx="26.5" cy="24" r="2.1" fill={EYE} />
      <circle cx="37.5" cy="24" r="2.1" fill={EYE} />
      <rect x="28.5" y="31.4" width="7" height="1.8" rx="0.9" fill={EYE} />
    </>
  ),

  // "Smiling face" — arched eyes over an open smile.
  'face/face_02': () => (
    <>
      <g stroke={EYE} strokeWidth="2" strokeLinecap="round" fill="none">
        <path d="M24.4 24.6 Q26.5 21.6 28.6 24.6" />
        <path d="M35.4 24.6 Q37.5 21.6 39.6 24.6" />
      </g>
      <path d="M27 30.6 Q32 36.4 37 30.6 Z" fill={EYE} />
    </>
  ),

  // "Poker face" — half-lidded slits, a mouth that gives nothing away.
  'face/face_03': () => (
    <>
      <rect x="23.8" y="23.2" width="5.4" height="1.9" rx="0.95" fill={EYE} />
      <rect x="34.8" y="23.2" width="5.4" height="1.9" rx="0.95" fill={EYE} />
      <rect x="26.5" y="31.6" width="11" height="1.6" rx="0.8" fill={EYE} />
    </>
  ),

  // "Sly face" (rare) — one eye winking, the mouth pulled to one side.
  'face/face_04': () => (
    <>
      <circle cx="26.5" cy="24" r="2.2" fill={EYE} />
      <path d="M34.8 24.4 Q37.5 21.8 40.2 24.4" stroke={EYE} strokeWidth="2" strokeLinecap="round" fill="none" />
      <path d="M27.4 32.8 Q32.4 34.4 37 30.4" stroke={EYE} strokeWidth="2" strokeLinecap="round" fill="none" />
    </>
  ),

  // "Steely face" (rare) — brows down, mouth short and set.
  'face/face_05': () => (
    <>
      <g stroke={EYE} strokeWidth="2" strokeLinecap="round">
        <path d="M23.4 19.6 L29.4 22" />
        <path d="M40.6 19.6 L34.6 22" />
      </g>
      <circle cx="26.6" cy="25" r="2" fill={EYE} />
      <circle cx="37.4" cy="25" r="2" fill={EYE} />
      <rect x="29" y="32" width="6" height="1.8" rx="0.9" fill={EYE} />
    </>
  ),

  /* ── clothing: the same shoulders, a different collar ───────────────────── */

  // "T-shirt" — a plain round neckline.
  'clothing/clothing_tee': () => (
    <>
      <path d={SHOULDERS} fill="#4a5f9e" />
      <path d="M25 44.6 Q32 51.5 39 44.6" fill={SKIN_SHADE} />
      <path d="M25 44.6 Q32 51.5 39 44.6" stroke={CLOTH_LINE} strokeWidth="1.2" fill="none" />
    </>
  ),

  // "Hoodie" — a hood rolled behind the neck and two drawstrings.
  'clothing/clothing_hoodie': () => (
    <>
      <path d={SHOULDERS} fill="#586477" />
      <path d="M21 47 C 24 42 40 42 43 47 C 39 51 25 51 21 47 Z" fill="#47525f" />
      <path d="M26 44 Q32 50 38 44" fill={SKIN_SHADE} />
      <g stroke="#e5e0d2" strokeWidth="1.3" strokeLinecap="round">
        <path d="M28 49 L27 58" />
        <path d="M36 49 L37 58" />
      </g>
    </>
  ),

  // "Polo shirt" — a soft collar, a placket and two buttons.
  'clothing/clothing_polo': () => (
    <>
      <path d={SHOULDERS} fill="#2f7d6f" />
      <path d="M26 44 L32 52 L38 44 L36 43.6 L32 48 L28 43.6 Z" fill="#f0ece0" />
      <rect x="31.2" y="51" width="1.8" height="10" fill={CLOTH_LINE} />
      <circle cx="32.1" cy="54" r="1.1" fill="#f0ece0" />
      <circle cx="32.1" cy="59" r="1.1" fill="#f0ece0" />
    </>
  ),

  // "Áo dài" (rare) — the high mandarin collar, gold piping and a hint of the side slit.
  'clothing/clothing_aodai': () => (
    <>
      <path d={SHOULDERS} fill="var(--red, #c8323c)" />
      <path d="M26.5 43.6 C 26.5 49 28.5 51.5 32 51.5 C 35.5 51.5 37.5 49 37.5 43.6 Z" fill="#a41f28" />
      <path d="M26.5 44 C 26.5 49.4 28.5 52 32 52 C 35.5 52 37.5 49.4 37.5 44" stroke="var(--gold, #d9a441)" strokeWidth="1.3" fill="none" />
      <path d="M32 52 L32 64" stroke="var(--gold, #d9a441)" strokeWidth="1.1" opacity="0.85" />
      <path d="M44 52 L49 64" stroke="var(--gold, #d9a441)" strokeWidth="1.1" opacity="0.6" />
    </>
  ),

  // "Suit" (rare) — two lapels over a shirt V, and a lacquer-red tie.
  'clothing/clothing_suit': () => (
    <>
      <path d={SHOULDERS} fill="#1c2233" />
      <path d="M25 44 L32 53 L39 44 L37 43.6 L32 49.4 L27 43.6 Z" fill="#f2eee2" />
      <path d="M27 43.8 L32 53 L24 58 L22.5 46 Z" fill="#2b3450" />
      <path d="M37 43.8 L32 53 L40 58 L41.5 46 Z" fill="#2b3450" />
      <path d="M32 53 L34.4 56 L33 64 L31 64 L29.6 56 Z" fill="var(--red, #c8323c)" />
    </>
  ),

  // "Kimono" (rare) — the crossed collar, right panel over left.
  'clothing/clothing_kimono': () => (
    <>
      <path d={SHOULDERS} fill="#2d3a63" />
      <path d="M25.5 43.6 L32 55 L23 64 L18 64 L20.5 46 Z" fill="#e8e2d2" />
      <path d="M38.5 43.6 L32 55 L41 64 L46 64 L43.5 46 Z" fill="#d5cdb8" />
      <path d="M32 55 L32 64" stroke={CLOTH_LINE} strokeWidth="1.2" />
      <rect x="20" y="60" width="24" height="4" fill="var(--teal, #3f938a)" opacity="0.85" />
    </>
  ),

  // "Champion jacket" (epic) — gold-trimmed shoulders and the star on the chest.
  'clothing/jacket_champion': () => (
    <>
      <path d={SHOULDERS} fill="#20263c" />
      <path d="M4 64 C 6.5 50.5 17.5 43.5 32 43.5 C 46.5 43.5 57.5 50.5 60 64" stroke="var(--gold, #d9a441)" strokeWidth="1.6" fill="none" />
      <path d="M26 44 Q32 50.5 38 44" fill="#12172a" />
      <path d="M32 49 L33.5 53.4 L38.2 53.5 L34.5 56.3 L35.8 60.8 L32 58.1 L28.2 60.8 L29.5 56.3 L25.8 53.5 L30.5 53.4 Z" fill="var(--gold, #d9a441)" />
    </>
  ),

  /* ── hair: silhouettes over the skull, filled from --avatar-hair ────────── */

  // "Short hair" — a cap with a fringe swept to one side.
  'hair/hair_short': ({ hairColor }) => (
    <path
      d="M18.6 26 C 18.6 13.6 24.6 8.6 32 8.6 C 39.4 8.6 45.4 13.6 45.4 26 C 44.4 20 41.4 19 34 20.4 C 27.4 21.6 21.6 21 18.6 26 Z"
      fill={hairFill(hairColor)}
    />
  ),

  // "Curly hair" — the same cap under a ring of curls.
  'hair/hair_curly': ({ hairColor }) => (
    <g fill={hairFill(hairColor)}>
      <path d="M18.4 27 C 18.4 14 24.4 9 32 9 C 39.6 9 45.6 14 45.6 27 C 44.4 20.4 40 18 32 18 C 24 18 19.6 20.4 18.4 27 Z" />
      <circle cx="20" cy="17" r="4.6" />
      <circle cx="27" cy="10.6" r="5.2" />
      <circle cx="36" cy="10" r="5.4" />
      <circle cx="44" cy="17" r="4.6" />
      <circle cx="31.5" cy="15" r="4.6" />
    </g>
  ),

  // "Ponytail" — a cap, a band, and the tail hanging off the right of the skull.
  'hair/hair_ponytail': ({ hairColor }) => (
    <g fill={hairFill(hairColor)}>
      <path d="M18.6 25 C 18.6 13.4 24.6 8.4 32 8.4 C 39.4 8.4 45.4 13.4 45.4 25 C 44.4 18.4 40 16.4 32 16.4 C 24 16.4 19.6 18.4 18.6 25 Z" />
      <path d="M45 17 C 51.5 19 53.5 26 51.5 34 C 50.5 38 48.5 40 46.5 39.5 C 48.5 33 48.5 25 44 20 Z" />
      <rect x="43.4" y="17.4" width="4.6" height="3" rx="1.5" fill="var(--gold, #d9a441)" />
    </g>
  ),

  // "Long hair" (rare) — the cap plus two panels down past the jaw.
  'hair/hair_long': ({ hairColor }) => (
    <g fill={hairFill(hairColor)}>
      <path d="M17.6 24 C 17.6 12.6 24 7.6 32 7.6 C 40 7.6 46.4 12.6 46.4 24 C 45.2 17.6 40 15.4 32 15.4 C 24 15.4 18.8 17.6 17.6 24 Z" />
      <path d="M17.6 22 C 15.6 32 15.4 42 17 49 L22.6 49 C 20.6 41 20.4 31 21.6 24 Z" />
      <path d="M46.4 22 C 48.4 32 48.6 42 47 49 L41.4 49 C 43.4 41 43.6 31 42.4 24 Z" />
    </g>
  ),

  // "Hair bun" (rare) — pulled back into a knot above the crown.
  'hair/hair_bun': ({ hairColor }) => (
    <g fill={hairFill(hairColor)}>
      <circle cx="32" cy="6.6" r="5.2" />
      <path d="M18.8 24 C 18.8 12.8 24.6 8 32 8 C 39.4 8 45.2 12.8 45.2 24 C 44 18 40 16 32 16 C 24 16 20 18 18.8 24 Z" />
      <rect x="28.6" y="10.6" width="6.8" height="2.8" rx="1.4" fill="var(--red, #c8323c)" />
    </g>
  ),

  // "Mohawk" (rare) — shaved sides, one crest down the middle.
  'hair/hair_mohawk': ({ hairColor }) => (
    <g fill={hairFill(hairColor)}>
      <path d="M28.4 15 C 28.4 8 30 3 32 1 C 34 3 35.6 8 35.6 15 C 35.6 17 34.4 18 32 18 C 29.6 18 28.4 17 28.4 15 Z" />
      <path d="M19.4 23 C 19.6 18.6 21.4 15.6 24.4 14 L26.4 17.4 C 23.4 18.8 21.4 20.6 20.8 23.4 Z" opacity="0.75" />
      <path d="M44.6 23 C 44.4 18.6 42.6 15.6 39.6 14 L37.6 17.4 C 40.6 18.8 42.6 20.6 43.2 23.4 Z" opacity="0.75" />
    </g>
  ),

  /* ── accessory: worn on the face or the skull ───────────────────────────── */

  // "Glasses" — two thin rims on the eye line.
  'accessory/accessory_glasses': () => (
    <g stroke={METAL} strokeWidth="1.5" fill="none">
      <circle cx="26" cy="24.4" r="4.6" />
      <circle cx="38" cy="24.4" r="4.6" />
      <path d="M30.6 24.4 L33.4 24.4" />
      <path d="M21.4 24.4 L18.8 25.4" />
      <path d="M42.6 24.4 L45.2 25.4" />
    </g>
  ),

  // "Headband" — a band across the forehead with the knot on the left.
  'accessory/accessory_headband': () => (
    <>
      <path d="M19 19.6 C 23 16.4 41 16.4 45 19.6 L45 15.4 C 41 12.4 23 12.4 19 15.4 Z" fill="var(--teal, #3f938a)" />
      <path d="M18.8 15.6 L13.6 12.6 L15.6 18 L13 22.6 L18.8 19.8 Z" fill="var(--teal, #3f938a)" />
    </>
  ),

  // "Face mask" — a pleated mask over nose and mouth, with ear loops.
  'accessory/accessory_mask': () => (
    <>
      <g stroke={METAL} strokeWidth="1.3" fill="none">
        <path d="M19.4 27.4 Q17.4 30 19.8 33.4" />
        <path d="M44.6 27.4 Q46.6 30 44.2 33.4" />
      </g>
      <path d="M20 27.6 C 25 26.4 39 26.4 44 27.6 C 43 35.6 38.6 40.6 32 40.6 C 25.4 40.6 21 35.6 20 27.6 Z" fill="#e9eef6" />
      <g stroke="#b9c4d6" strokeWidth="1">
        <path d="M21.4 31.6 H42.6" />
        <path d="M22.6 35.4 H41.4" />
      </g>
    </>
  ),

  // "Conical hat" (rare) — nón lá: the cone, the brim and the chin strap.
  'accessory/accessory_conical_hat': () => (
    <>
      <path d="M32 1.4 L50 21 L14 21 Z" fill="#e0c087" />
      <path d="M32 1.4 L38 21 L26 21 Z" fill="#eed7a8" opacity="0.7" />
      <ellipse cx="32" cy="21.4" rx="21" ry="4" fill="#d6b071" />
      <ellipse cx="32" cy="20.4" rx="21" ry="4" fill="#e8cd99" />
      <path d="M22 22.6 C 25 32 39 32 42 22.6" stroke="var(--red, #c8323c)" strokeWidth="1.4" fill="none" />
    </>
  ),

  // "Sunglasses" (rare) — two dark lenses in gold rims.
  'accessory/accessory_sunglasses': () => (
    <>
      <path d="M19.6 21.4 H44.4 L43.6 24 H20.4 Z" fill="var(--gold, #d9a441)" />
      <path d="M20.6 23.4 H30.4 C 30.4 29.4 28.4 31.4 25.4 31.4 C 22.4 31.4 20.6 29.4 20.6 23.4 Z" fill="#161b2c" />
      <path d="M33.6 23.4 H43.4 C 43.4 29.4 41.6 31.4 38.6 31.4 C 35.6 31.4 33.6 29.4 33.6 23.4 Z" fill="#161b2c" />
      <path d="M30.4 24.2 H33.6" stroke="var(--gold, #d9a441)" strokeWidth="1.3" />
    </>
  ),

  // "Crown" (epic) — five points of gold with three lacquer stones.
  'accessory/hat_crown': () => (
    <>
      <path d="M17.4 15.4 L17.4 5.4 L23.4 10.4 L32 2.4 L40.6 10.4 L46.6 5.4 L46.6 15.4 Z" fill="var(--gold, #d9a441)" />
      <rect x="17.4" y="14.4" width="29.2" height="3.6" rx="1.2" fill="#b98a2f" />
      <circle cx="24" cy="12.6" r="1.5" fill="var(--red, #c8323c)" />
      <circle cx="32" cy="11" r="1.8" fill="var(--red, #c8323c)" />
      <circle cx="40" cy="12.6" r="1.5" fill="var(--red, #c8323c)" />
    </>
  ),

  /* ── jewelry: small, and placed where a 30 px disc still shows it ───────── */

  // "Stud earring" — one bright point on each earlobe.
  'jewelry/jewelry_stud': () => (
    <>
      <circle cx="19" cy="30" r="2" fill="var(--gold, #d9a441)" />
      <circle cx="45" cy="30" r="2" fill="var(--gold, #d9a441)" />
      <circle cx="45.6" cy="29.4" r="0.7" fill="var(--card-face, #f6f1e4)" />
    </>
  ),

  // "Silver ring" — worn on a hand resting at the shoulder line, where the plate still shows it.
  'jewelry/jewelry_ring': () => (
    <>
      <ellipse cx="49" cy="55.4" rx="5" ry="6" fill={SKIN} />
      <g stroke={SKIN_SHADE} strokeWidth="0.9" strokeLinecap="round">
        <path d="M47 50.4 L47 55" />
        <path d="M50.2 50.2 L50.2 55" />
      </g>
      <rect x="45.6" y="53.4" width="6.8" height="2.6" rx="1.3" fill={METAL} />
      <circle cx="49" cy="52.4" r="1.6" fill="#f1f5fb" />
    </>
  ),

  // "Chain" (rare) — a gold line across the collarbone.
  'jewelry/jewelry_chain': () => (
    <path d="M22 46 Q32 55.4 42 46" stroke="var(--gold, #d9a441)" strokeWidth="1.8" strokeLinecap="round" fill="none" />
  ),

  // "Pendant" (rare) — the same chain, carrying a teal drop.
  'jewelry/jewelry_pendant': () => (
    <>
      <path d="M23 45.6 Q32 54.4 41 45.6" stroke={METAL} strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M32 53.4 L35.4 57.6 L32 61.8 L28.6 57.6 Z" fill="var(--teal, #3f938a)" />
      <path d="M32 53.4 L35.4 57.6 L32 61.8 L28.6 57.6 Z" stroke="var(--gold, #d9a441)" strokeWidth="1" fill="none" />
    </>
  ),

  // "Royal ring" (epic) — gold band, red stone, worn where the silver ring is.
  'jewelry/ring_royal': () => (
    <>
      <ellipse cx="49" cy="55.4" rx="5.2" ry="6.2" fill={SKIN} />
      <g stroke={SKIN_SHADE} strokeWidth="0.9" strokeLinecap="round">
        <path d="M47 50.2 L47 55" />
        <path d="M50.2 50 L50.2 55" />
      </g>
      <rect x="45.2" y="53.4" width="7.6" height="3" rx="1.5" fill="var(--gold, #d9a441)" />
      <circle cx="49" cy="51.6" r="2.6" fill="var(--gold, #d9a441)" />
      <circle cx="49" cy="51.6" r="1.6" fill="var(--red, #c8323c)" />
    </>
  ),
}

/**
 * The neutral silhouette: what a seat shows before its avatar has arrived, or when the server has no config
 * for that player at all. Head and shoulders in the kit's muted ink — a person-shaped hole, not a face.
 */
export const SILHOUETTE: ReactNode = (
  <>
    <circle cx="32" cy="32" r="32" fill="var(--bg-elev, #141b33)" />
    <circle cx="32" cy="25" r="12" fill="var(--ink-muted, #9aa4c0)" opacity="0.55" />
    <path d="M8 64 C 10.5 51 19.5 45 32 45 C 44.5 45 53.5 51 56 64 Z" fill="var(--ink-muted, #9aa4c0)" opacity="0.55" />
  </>
)

/**
 * The mark a bot wears instead of an avatar. Bots have no account, so there is nothing to fetch and nothing
 * to equip — the seat says "machine" and stops there.
 */
export const BOT_MARK: ReactNode = (
  <>
    <circle cx="32" cy="32" r="32" fill="#14203a" />
    <path d="M32 10 L32 16" stroke="var(--teal, #3f938a)" strokeWidth="2" strokeLinecap="round" />
    <circle cx="32" cy="9" r="2.6" fill="var(--teal, #3f938a)" />
    <rect x="16" y="17" width="32" height="28" rx="8" fill="#26314f" stroke="var(--teal, #3f938a)" strokeWidth="1.6" />
    <circle cx="25" cy="29" r="3.2" fill="var(--teal, #3f938a)" />
    <circle cx="39" cy="29" r="3.2" fill="var(--teal, #3f938a)" />
    <rect x="24" y="37" width="16" height="2.6" rx="1.3" fill="var(--teal, #3f938a)" opacity="0.8" />
    <path d="M10 60 C 13 51 21 47 32 47 C 43 47 51 51 54 60 Z" fill="#26314f" />
  </>
)
