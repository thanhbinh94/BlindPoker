/**
 * The PNG-layer chibi: a stack of pre-rendered `<img>` layers on a shared 384×448 frame (spec
 * `2026-09-14-avatar-chibi-ai-design.md` §3), not a 3D rig. Every id here is a filename stem — the part before
 * `@1x.png` / `@2x.png` — so the same value doubles as a manifest key and a cache key.
 */

/** The six faces every body and bot ships; `neutral` is the resting state everything else expires back to. */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'

/** Which body a human chibi is drawn on (avatar v4, spec `2026-10-03-avatar-v4-design.md` §4.3) — the server's
 * `Gender`, and the key a gendered outfit's cut is chosen by. */
export type Gender = 'f' | 'm'

/** `head` crops the 208×208 avatar square out of the frame; `full` shows the whole 384×448 body. */
export type ChibiFrame = 'head' | 'full'

/** One tint to paint onto a layer: `mask` is the mask file's stem (`<file>_hairmask` etc, same `@Nx.png`
 * convention as `LayerRef.file`), `colour` the hex target and `meanL` the mask region's original mean lightness —
 * both needed by `recolour` (spec §5.1) so the client never has to re-measure the source art. */
export interface TintRef {
  mask: string
  colour: string
  meanL: number
}

/** One stacked layer: `order` is the z-index (10 aura … 90 frame), `file` the filename stem without `@Nx.png`.
 * `tints`, when `layersFor` sets it, lists the paint jobs this layer needs — skin then eyes on a face, skin on the
 * body, the hair colour on a hair layer, the item's own tint for a worn item — in the order `useTintedLayer`
 * should apply them. */
export interface LayerRef {
  order: number
  file: string
  tints?: TintRef[]
}

/** The mask files one recolourable region carries (a body's skin or eyes, a hairstyle's hair): `meanL` is that
 * region's mean lightness on the source art (shared by every layer of the region, so no seam shows between
 * layers), `files` the layer file stems that carry a non-empty mask for it. The server derives both from the
 * manifest, so the client never measures art itself. */
export interface MaskSet {
  meanL: number
  files: string[]
}

/** A body of one gender (avatar v4): bald, drawn at layer 30, with a face per expression at layer 50
 * (`body_<g>_L30`, `body_<g>_face_<expr>_L50`). `tint`, present only when the server found the masks, says which
 * of those layers `skinColor` (`<file>_skinmask`) and `eyeColor` (`<file>_eyemask`) may recolour. */
export interface BodyRef {
  gender: Gender
  body: string
  faces: Record<Expression, string>
  tint?: { skin?: MaskSet; eyes?: MaskSet }
}

/** A hairstyle (avatar v4): one item, two layers — `back` at 20, behind the body, and `front` at 60, in front of
 * the face (`item_hair_<code>_L20` / `_L60`). `id` is the item id (`hair_<code>`), which is what the hash keys on;
 * `tint`, when present, says which of the two layers `hairColor` may recolour (`<file>_hairmask`), at the
 * hairstyle's own lightness. */
export interface HairRef {
  id: string
  back: string
  front: string
  tint?: MaskSet
}

/** A wearable item — anything that is not the body or the hair. `id` survives independently of `file` because
 * inventory, achievements and aliasing all key on it (spec §7), while `file` is only ever what `layersFor` draws.
 * `tint`, present only for a colour variant (spec §3.3), is the hex colour and the source art's mean lightness
 * for its own `<file>_tintmask`. */
export interface WearRef extends LayerRef {
  id: string
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  tint?: { colour: string; meanL: number }
}

/** A human chibi (avatar v4): a body of one gender, a two-layer hairstyle and whatever wearables are equipped.
 * `outfit` is the one mandatory wearable — every new figure wears `outfit_casual01` (see `defaultChibi`).
 * `hairColor`/`eyeColor`/`skinColor`, present only when the player picked a colour, are hex strings (not item
 * ids — `normal-web`'s `chibiFromApi` resolves those) that `layersFor` paints onto whichever layers the hair's and
 * the body's `tint` say carry that mask. Absent, the art's own colour shows: the hairstyle's natural colour, the
 * body's own eyes and its "cream" skin. */
export interface ChibiConfig {
  kind: 'human'
  body: BodyRef
  hair: HairRef
  outfit: WearRef
  head?: WearRef
  face?: WearRef
  aura?: WearRef
  frame?: WearRef
  hairColor?: string
  eyeColor?: string
  skinColor?: string
}

/** A bot's chibi: one of the eight placeholder robot sets, `bot_<index>_*`. */
export interface BotChibi {
  kind: 'bot'
  index: number
}

export type ChibiSubject = ChibiConfig | BotChibi
