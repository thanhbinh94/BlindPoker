import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AvatarConfigDto, GeometricSlot } from '../api.js'
import { withSlot } from './config.js'
import { hashConfig } from './hash.js'
import { usePortrait } from './usePortrait.js'
import s from './portrait.module.css'

/**
 * A player's face, everywhere but the profile stage: a 128 px picture their own browser drew.
 *
 * It is an `<img>` around a `blob:` URL, and until there is one it is the first letter of the player's
 * name on a disc — the same placeholder the Lite edition uses for every avatar it has (spec §15.1), and
 * the permanent answer on a machine that cannot run WebGL. There is no spinner: a portrait arrives in
 * tens of milliseconds when the assets are warm, and a spinner per seat on a nine-seat table would be
 * eight more moving things than the table needs.
 *
 * `data-hash` on the image is the config's identity. It costs one attribute and it is what lets an
 * end-to-end test say "the face on that seat is the one I just saved" — a picture has no text, and the
 * whole portrait carries at most one accessible name.
 */

export type PortraitSize = 'sm' | 'md' | 'lg'

export interface PortraitProps {
  /** The equipped configuration, or `null` while it is unknown (no account, fetch in flight). */
  config: AvatarConfigDto | null
  /** Whose face it is; its first letter is the placeholder. */
  name?: string
  /** `sm` 32 px (seat plates, the lobby bar), `md` 48 px (rows), `lg` 128 px (the profile header). */
  size?: PortraitSize
  /**
   * An accessible name. Given one the portrait is an image with that name; given none it is decoration
   * and is hidden — which is what a seat plate wants, since the name is printed beside it, and an
   * unnamed `role="img"` is worse than no image at all.
   */
  label?: string
  className?: string
}

/** The letter on the disc: the first character of the name, upper case, or nothing. */
function initialOf(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  return trimmed === '' ? '' : trimmed.slice(0, 1).toUpperCase()
}

export function Portrait({ config, name, size = 'md', label, className }: PortraitProps) {
  const { url, status } = usePortrait(config)
  const hash = config === null ? null : hashConfig(config)
  const naming = label === undefined ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label }

  return (
    <span
      className={className === undefined ? s.portrait : `${s.portrait} ${className}`}
      data-size={size}
      data-portrait={status}
      {...naming}
    >
      {status === 'ready' && url !== null ? (
        <img className={s.image} src={url} data-hash={hash ?? undefined} alt="" />
      ) : (
        initialOf(name)
      )}
    </span>
  )
}

/**
 * Whether an element has come near the viewport — once true, always true.
 *
 * A wardrobe offers forty-odd items and each tile is a whole portrait; rendering the ones below the
 * fold costs a queue slot each and delays the ones the player can see. `rootMargin` starts them a
 * little early so a scroll meets pictures rather than letters.
 *
 * Without `IntersectionObserver` there is no way to ask, and the honest answer is "assume visible":
 * that is jsdom, where every test of a tile would otherwise see an empty placeholder forever, and it
 * is also any browser old enough to lack the API, where laziness is not worth a blank grid.
 */
function useNearViewport(target: RefObject<Element | null>): boolean {
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined')

  useEffect(() => {
    if (seen) return
    const node = target.current
    if (node === null) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        setSeen(true)
        observer.disconnect()
      },
      { rootMargin: '128px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [seen, target])

  return seen
}

export interface PartPortraitProps {
  /** What the player is wearing now — everything but the one slot being previewed. */
  config: AvatarConfigDto
  slot: GeometricSlot
  itemId: string
  size?: PortraitSize
  className?: string
}

/**
 * One item, previewed on the player's own figure.
 *
 * It is a `Portrait` of the current configuration with this item swapped in, which means a hoodie is
 * shown on the body, hair and skin tone that will actually wear it — and, because the cache is keyed by
 * the whole configuration, that the tile the player picks and the face they end up with are the same
 * picture from the same cache entry.
 */
export function PartPortrait({ config, slot, itemId, size = 'md', className }: PartPortraitProps) {
  const box = useRef<HTMLSpanElement>(null)
  const near = useNearViewport(box)
  const worn = useMemo(() => withSlot(config, slot, itemId), [config, slot, itemId])

  return (
    <span className={className === undefined ? s.part : `${s.part} ${className}`} ref={box}>
      <Portrait config={near ? worn : null} size={size} />
    </span>
  )
}
