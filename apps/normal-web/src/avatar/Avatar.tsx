import type { CSSProperties } from 'react'
import type { AvatarConfigDto } from '../api.js'
import s from './avatar.module.css'
import { DEFAULT_HAIR_COLOR, HAIR_VAR, LAYER_ORDER, PARTS, SILHOUETTE, type AvatarLayer } from './parts.js'

export type AvatarSize = 'sm' | 'md' | 'lg'

export interface AvatarProps {
  /** The equipped config, or `null` for the neutral silhouette (no account, or the fetch has not landed). */
  config: AvatarConfigDto | null
  /** `sm` 32 px (seat plates, lists), `md` 48 px (rows, headers), `lg` 128 px (the wardrobe). */
  size?: AvatarSize
  /**
   * An accessible name. Given one, the SVG is an image with that name; given none it is decoration and is
   * hidden from assistive technology — which is what a seat plate wants, since the name is already printed
   * beside it, and an unnamed `role="img"` is worse than no image at all.
   */
  label?: string
  className?: string
}

/** `accessory` and `jewelry` are the two optional slots; the other four are always equipped. */
const slotOf = (config: AvatarConfigDto, layer: AvatarLayer): string | undefined => config[layer]

/**
 * One player's avatar, drawn from the catalogue.
 *
 * It is a stack of at most six vectors in `LAYER_ORDER`, each looked up in `PARTS` by `<layer>/<itemId>` —
 * the same `assetKey` the server's catalogue publishes. A key with no part is *skipped*, never thrown on:
 * the server can ship an item before the browser bundle that draws it (a deploy is two artefacts, and they
 * do not land at the same instant), and the answer to that is a player missing a hat for a few minutes, not
 * a table that fails to render.
 *
 * Hair colour is a free hex string rather than an item, so it arrives as the CSS custom property
 * `--avatar-hair` on the `<svg>` and every hair path fills from it — one declaration for a layer that is
 * otherwise identical to the others.
 */
export function Avatar({ config, size = 'md', label, className }: AvatarProps) {
  const style = config === null ? undefined : ({ [HAIR_VAR]: config.hairColor || DEFAULT_HAIR_COLOR } as CSSProperties)
  const naming = label === undefined ? { 'aria-hidden': true } : { 'aria-label': label }

  return (
    <svg
      className={className === undefined ? s.avatar : `${s.avatar} ${className}`}
      data-size={size}
      data-avatar={config === null ? 'none' : 'config'}
      viewBox="0 0 64 64"
      role="img"
      style={style}
      {...naming}
    >
      {config === null
        ? SILHOUETTE
        : LAYER_ORDER.map((layer) => {
            const itemId = slotOf(config, layer)
            if (itemId === undefined || itemId === '') return null
            const part = PARTS[`${layer}/${itemId}`]
            if (part === undefined) return null
            return (
              <g key={layer} data-layer={layer}>
                {part({})}
              </g>
            )
          })}
    </svg>
  )
}
