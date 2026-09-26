/**
 * Small monochrome line icons for the wardrobe's group tabs (`CategoryNav`) and wearing list
 * (`EquippedList`) — V2 fix, 2026-09-27: the two spots that used to draw a coloured emoji, which read as
 * cheap and inconsistent next to the mockup's flat line-icon set. Every path is stroked in `currentColor`
 * with no fill of its own, so an icon always matches its own button/row's text colour (gold selected,
 * `--ink-muted` otherwise) for free — no separate colour rule to keep in sync.
 *
 * One `viewBox="0 0 24 24"`, one stroke width, round caps/joins throughout, so the whole set reads as one
 * family regardless of which glyph is on screen. Always `aria-hidden` — every caller already has its own
 * text label naming the thing, the same convention `cards.tsx`'s lock/check glyphs and `EquippedList`'s
 * former emoji already followed.
 */

import type { SVGProps } from 'react'

export type IconName = 'person' | 'drop' | 'eye' | 'hat' | 'glasses' | 'shirt' | 'sparkle' | 'frame' | 'tag' | 'medal'

/** One `<path>`/primitive list per glyph — kept to circles, rects and straight-line paths wherever the
 * shape allows, so a hand-written `d` has as little room as possible to go visually wrong. */
const GLYPHS: Record<IconName, JSX.Element> = {
  person: (
    <>
      <circle cx="12" cy="8.2" r="3.2" />
      <path d="M5.5 19c.9-3.6 3.4-5.6 6.5-5.6s5.6 2 6.5 5.6" />
    </>
  ),
  drop: <path d="M12 3s6 7 6 11a6 6 0 1 1-12 0c0-4 6-11 6-11Z" />,
  eye: (
    <>
      <path d="M3 12s3.6-6 9-6 9 6 9 6-3.6 6-9 6-9-6-9-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  hat: (
    <>
      <path d="M4 15c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      <path d="M3 15h18" />
      <path d="M3 15v1.4c0 .9 4 1.6 9 1.6s9-.7 9-1.6V15" />
    </>
  ),
  glasses: (
    <>
      <circle cx="6.5" cy="13" r="3" />
      <circle cx="17.5" cy="13" r="3" />
      <path d="M9.5 12h5M3.5 12l1.2-2M20.5 12l-1.2-2" />
    </>
  ),
  shirt: <path d="M8 4 4 7l2.2 3L8 9v11h8V9l1.8 1L20 7l-4-3c0 1.4-1.8 2.5-4 2.5S8 5.4 8 4Z" />,
  sparkle: (
    <>
      <path d="M11 2.5c.5 3.4 1.7 4.9 5.2 5.6-3.5.7-4.7 2.2-5.2 5.6-.5-3.4-1.7-4.9-5.2-5.6 3.5-.7 4.7-2.2 5.2-5.6Z" />
      <circle cx="17.5" cy="17.5" r="1.6" />
    </>
  ),
  frame: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="1.4" />
      <rect x="7.6" y="7.6" width="8.8" height="8.8" rx="0.8" />
    </>
  ),
  tag: (
    <>
      <path d="M11.4 2.7 3 3l-.3 8.4c0 .4.15.8.45 1.1l9.35 9.35c.6.6 1.6.6 2.2 0l7.6-7.6c.6-.6.6-1.6 0-2.2L12.9 3.15a1.6 1.6 0 0 0-1.1-.45Z" />
      <circle cx="7.6" cy="7.6" r="1.4" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="4.3" />
      <path d="m9 11.2-3-7.2M15 11.2l3-7.2M7.6 5h8.8" />
    </>
  ),
}

export interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName
}

export function Icon({ name, ...rest }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {GLYPHS[name]}
    </svg>
  )
}
