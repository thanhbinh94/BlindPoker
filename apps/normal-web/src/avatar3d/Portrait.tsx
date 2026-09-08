import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { AvatarConfigDto, GeometricSlot } from '../api.js'
import { frameForSlot, portraitRelevant, withSlot } from './config.js'
import type { PortraitFrame } from './framing.js'
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

/** `seat` fills whatever frame holds it — the kit's seat disc sets the size, so the picture and the frame never disagree. */
export type PortraitSize = 'sm' | 'md' | 'lg' | 'seat'

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
  /**
   * The crop: `portrait` (head and shoulders) everywhere a *face* is wanted, which is everywhere but a
   * wardrobe tile for something worn below the chest. See `framing.ts`.
   */
  frame?: PortraitFrame
  className?: string
}

/** The letter on the disc: the first character of the name, upper case, or nothing. */
function initialOf(name: string | undefined): string {
  const trimmed = (name ?? '').trim()
  return trimmed === '' ? '' : trimmed.slice(0, 1).toUpperCase()
}

export function Portrait({ config, name, size = 'md', label, frame = 'portrait', className }: PortraitProps) {
  // The hash comes back from the hook rather than being computed again here: it is the identity of the
  // picture `url` actually holds, so the attribute cannot drift from the image beside it while a new
  // configuration is still being drawn.
  const { url, status, hash } = usePortrait(config, { frame })
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
 * shown on the body, hair and skin tone that will actually wear it.
 *
 * **The crop follows the slot** (`frameForSlot`). A hat, a top or a hairstyle is previewed head-and-
 * shoulders; a pair of trousers and a pair of shoes are previewed on the whole standing figure, because
 * they are below a head-and-shoulders crop by construction and framing them on the head would give
 * every bottom in the wardrobe the same picture.
 *
 * The configuration is then narrowed by `portraitRelevant` to the slots that crop can contain. This is
 * what stops one click on a pair of shoes from changing the cache key of every tile on the screen and
 * re-rendering forty identical pictures through a sequential queue.
 *
 * The full-body tiles cost one cache entry each rather than one between them, which is at most seven
 * more renders — and they are the tiles furthest down the wardrobe, so `useNearViewport` below means
 * they are drawn when they are scrolled to rather than when the screen opens.
 */
export function PartPortrait({ config, slot, itemId, size = 'md', className }: PartPortraitProps) {
  const box = useRef<HTMLSpanElement>(null)
  const near = useNearViewport(box)
  const frame = frameForSlot(slot)
  const worn = useMemo(() => portraitRelevant(withSlot(config, slot, itemId), frame), [config, slot, itemId, frame])

  return (
    <span className={className === undefined ? s.part : `${s.part} ${className}`} ref={box}>
      <Portrait config={near ? worn : null} size={size} frame={frame} />
    </span>
  )
}
