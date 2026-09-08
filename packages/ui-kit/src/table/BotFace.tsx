import type { CSSProperties } from 'react'
import s from './table.module.css'

/**
 * The eight bot faces. Each is a head shape, an eye style and a hue; a seat picks one by hashing the bot's id, so
 * "Bot 3" wears the same face for the whole life of the room and a different one from "Bot 2" beside it. They are
 * vectors on purpose: bots have no account, no wardrobe and no portrait to render, and a 2D mark is what the
 * table asks of every seat — a human's portrait is a picture too, just one drawn from their outfit.
 */
export const BOT_FACE_COUNT = 8

interface FaceSpec {
  hue: string
  head: 'round' | 'square' | 'hex' | 'dome'
  eyes: 'dots' | 'visor' | 'wide' | 'sleepy'
  antenna: boolean
}

const FACES: readonly FaceSpec[] = [
  { hue: '#3f938a', head: 'square', eyes: 'dots', antenna: true },
  { hue: '#d9a441', head: 'round', eyes: 'visor', antenna: false },
  { hue: '#c95c5c', head: 'hex', eyes: 'wide', antenna: true },
  { hue: '#7b6fd6', head: 'dome', eyes: 'sleepy', antenna: false },
  { hue: '#5aa564', head: 'square', eyes: 'wide', antenna: false },
  { hue: '#4f8fd9', head: 'round', eyes: 'dots', antenna: true },
  { hue: '#e07b39', head: 'dome', eyes: 'visor', antenna: true },
  { hue: '#d46aa3', head: 'hex', eyes: 'sleepy', antenna: false },
]

/** FNV-1a over UTF-16 code units: cheap, stable across sessions and machines, and good enough to spread eight faces. */
export function botFaceIndex(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % BOT_FACE_COUNT
}

const HEADS: Record<FaceSpec['head'], string> = {
  round: 'M32 14 a18 18 0 1 1 0 36 a18 18 0 1 1 0 -36 Z',
  square: 'M18 16 h28 a6 6 0 0 1 6 6 v24 a6 6 0 0 1 -6 6 h-28 a6 6 0 0 1 -6 -6 v-24 a6 6 0 0 1 6 -6 Z',
  hex: 'M32 12 L50 22 V42 L32 52 L14 42 V22 Z',
  dome: 'M14 50 V34 a18 18 0 0 1 36 0 V50 Z',
}

function Eyes({ kind, hue }: { kind: FaceSpec['eyes']; hue: string }) {
  switch (kind) {
    case 'dots':
      return (
        <>
          <circle cx="25" cy="31" r="3.2" fill={hue} />
          <circle cx="39" cy="31" r="3.2" fill={hue} />
        </>
      )
    case 'visor':
      return <rect x="19" y="27" width="26" height="7" rx="3.5" fill={hue} />
    case 'wide':
      return (
        <>
          <ellipse cx="24" cy="31" rx="5" ry="4" fill={hue} />
          <ellipse cx="40" cy="31" rx="5" ry="4" fill={hue} />
          <circle cx="25" cy="31" r="1.6" fill="#0b1020" />
          <circle cx="41" cy="31" r="1.6" fill="#0b1020" />
        </>
      )
    case 'sleepy':
      return (
        <>
          <path d="M20 31 q5 -4 10 0" stroke={hue} strokeWidth="2.4" fill="none" strokeLinecap="round" />
          <path d="M34 31 q5 -4 10 0" stroke={hue} strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </>
      )
  }
}

export interface BotFaceProps {
  /** Anything stable for the bot — its player id. Same seed, same face. */
  seed: string
  className?: string
  style?: CSSProperties
}

/** A bot's 2D face, one of eight, chosen by `seed`. Decorative: the seat's Bot badge carries the meaning. */
export function BotFace({ seed, className, style }: BotFaceProps) {
  const index = botFaceIndex(seed)
  const face = FACES[index]!
  return (
    <svg
      className={className === undefined ? s.botFace : `${s.botFace} ${className}`}
      style={style}
      viewBox="0 0 64 64"
      data-bot-face={index}
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="32" cy="32" r="32" fill="#14203a" />
      {face.antenna ? (
        <>
          <path d="M32 8 V15" stroke={face.hue} strokeWidth="2" strokeLinecap="round" />
          <circle cx="32" cy="7" r="2.6" fill={face.hue} />
        </>
      ) : null}
      <path d={HEADS[face.head]} fill="#26314f" stroke={face.hue} strokeWidth="1.8" />
      <Eyes kind={face.eyes} hue={face.hue} />
      <rect x="25" y="40" width="14" height="2.6" rx="1.3" fill={face.hue} opacity="0.8" />
    </svg>
  )
}
