import { PARTS } from './parts.js'

export interface PartThumbProps {
  /** `<category>/<id>` — the same string the catalogue publishes as `assetKey`. */
  assetKey: string
  /** Only hair reads it; every other part ignores the prop. */
  hairColor?: string
  className?: string
}

/**
 * One catalogue part on its own, at thumbnail size — the wardrobe's picker tiles.
 *
 * It is deliberately *not* an `Avatar` with a single layer set: a picker is a comparison, and drawing the
 * base under every hair option would put the thing being compared behind the thing that is the same in every
 * tile. So the part is drawn alone, in the same 64-box it was authored in, and the row of tiles differs only
 * where the items differ.
 *
 * A key with no part draws nothing rather than throwing, for the same reason `Avatar` skips one: the server
 * can ship an item before the bundle that draws it, and the answer to that is a blank tile with a readable
 * name under it — never a wardrobe that fails to render.
 */
export function PartThumb({ assetKey, hairColor, className }: PartThumbProps) {
  const part = PARTS[assetKey]
  // `aria-hidden` and no role: the tile's own text names the item, and a role on a node that has been
  // removed from the accessibility tree only contradicts itself.
  return (
    <svg className={className} viewBox="0 0 64 64" aria-hidden="true" data-part={assetKey}>
      {part === undefined ? null : part(hairColor === undefined ? {} : { hairColor })}
    </svg>
  )
}
