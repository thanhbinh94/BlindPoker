/**
 * The PNG-layer chibi: a stack of pre-rendered `<img>` layers on a shared 384×448 frame (spec
 * `2026-09-14-avatar-chibi-ai-design.md` §3), not a 3D rig. Every id here is a filename stem — the part before
 * `@1x.png` / `@2x.png` — so the same value doubles as a manifest key and a cache key.
 */

/** The six faces every base and bot ships; `neutral` is the resting state everything else expires back to. */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'

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
 * `tints`, when `layersFor` sets it, lists the paint jobs this layer needs (spec §5.2) — hair then eyes for a
 * base layer, the item's own tint for a worn item — in the order `useTintedLayer` should apply them. */
export interface LayerRef {
  order: number
  file: string
  tints?: TintRef[]
}

/** The mask files a base carries for one recolourable region (hair or eyes): `meanL` is that region's mean
 * lightness on the source art (shared by every layer of this base, spec §5.2, so no seam shows between layers),
 * `files` the layer file stems that carry a non-empty mask for it. */
export interface MaskSet {
  meanL: number
  files: string[]
}

/** A body: two hair layers either side of layer 50, one body layer, and a face per expression. `tint`, present
 * only when the server registry has masks for this base, tells `layersFor` which of those layers to recolour. */
export interface BaseRef {
  id: string
  hairBack: string
  body: string
  hairFront: string
  faces: Record<Expression, string>
  tint?: { hair?: MaskSet; eyes?: MaskSet }
}

/** A wearable item — anything that is not part of the base body. `id` survives independently of `file` because
 * inventory, achievements and aliasing all key on it (spec §7), while `file` is only ever what `layersFor` draws.
 * `tint`, present only for a colour variant (spec §3.3), is the hex colour and the source art's mean lightness
 * for its own `<file>_tintmask`. */
export interface WearRef extends LayerRef {
  id: string
  hidesHairFront?: boolean
  hidesHairBack?: boolean
  tint?: { colour: string; meanL: number }
}

/** A human chibi: a base body plus whatever wearables are equipped. `outfit` is the only mandatory slot — every
 * base ships in `outfit_casual01` by default (see `defaultChibi`). `hairColor`/`eyeColor`, present only when the
 * player picked a colour, are hex strings (not item ids — `normal-web`'s `chibiFromApi` resolves those, spec
 * §5.2) that `layersFor` paints onto whichever base layers `base.tint` says carry that mask. */
export interface ChibiConfig {
  kind: 'human'
  base: BaseRef
  outfit: WearRef
  head?: WearRef
  face?: WearRef
  aura?: WearRef
  frame?: WearRef
  hairColor?: string
  eyeColor?: string
}

/** A bot's chibi: one of the eight placeholder robot sets, `bot_<index>_*`. */
export interface BotChibi {
  kind: 'bot'
  index: number
}

export type ChibiSubject = ChibiConfig | BotChibi
