/**
 * The PNG-layer chibi: a stack of pre-rendered `<img>` layers on a shared 384×448 frame (spec
 * `2026-09-14-avatar-chibi-ai-design.md` §3), not a 3D rig. Every id here is a filename stem — the part before
 * `@1x.png` / `@2x.png` — so the same value doubles as a manifest key and a cache key.
 */

/** The six faces every base and bot ships; `neutral` is the resting state everything else expires back to. */
export type Expression = 'neutral' | 'happy' | 'sad' | 'surprised' | 'closed' | 'sleep'

/** `head` crops the 208×208 avatar square out of the frame; `full` shows the whole 384×448 body. */
export type ChibiFrame = 'head' | 'full'

/** One stacked layer: `order` is the z-index (10 aura … 90 frame), `file` the filename stem without `@Nx.png`. */
export interface LayerRef {
  order: number
  file: string
}

/** A body: two hair layers either side of layer 50, one body layer, and a face per expression. */
export interface BaseRef {
  id: string
  hairBack: string
  body: string
  hairFront: string
  faces: Record<Expression, string>
}

/** A wearable item — anything that is not part of the base body. `id` survives independently of `file` because
 * inventory, achievements and aliasing all key on it (spec §7), while `file` is only ever what `layersFor` draws. */
export interface WearRef extends LayerRef {
  id: string
  hidesHairFront?: boolean
  hidesHairBack?: boolean
}

/** A human chibi: a base body plus whatever wearables are equipped. `outfit` is the only mandatory slot — every
 * base ships in `outfit_casual01` by default (see `defaultChibi`). */
export interface ChibiConfig {
  kind: 'human'
  base: BaseRef
  outfit: WearRef
  head?: WearRef
  face?: WearRef
  aura?: WearRef
  frame?: WearRef
}

/** A bot's chibi: one of the eight placeholder robot sets, `bot_<index>_*`. */
export interface BotChibi {
  kind: 'bot'
  index: number
}

export type ChibiSubject = ChibiConfig | BotChibi
