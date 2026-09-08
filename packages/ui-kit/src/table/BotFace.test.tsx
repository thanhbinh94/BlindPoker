import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BOT_FACE_COUNT, BotFace, botFaceIndex } from './BotFace.js'

describe('BotFace', () => {
  it('gives the same seed the same face every time, and spreads seeds over all eight faces', () => {
    expect(botFaceIndex('bot:r1:0')).toBe(botFaceIndex('bot:r1:0'))
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(botFaceIndex(`bot:room-${i % 7}:${i}`))
    expect(seen.size).toBe(BOT_FACE_COUNT)
    for (const index of seen) expect(index).toBeGreaterThanOrEqual(0)
    for (const index of seen) expect(index).toBeLessThan(BOT_FACE_COUNT)
  })

  it('renders a decorative svg stamped with the face it chose', () => {
    const { container } = render(<BotFace seed="bot:r1:2" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('data-bot-face', String(botFaceIndex('bot:r1:2')))
  })

  it('draws two bots at the same table with different faces when their ids differ', () => {
    // Room ids are random; this pins one pair that hashes apart so a regression in the hash cannot pass silently.
    const seeds = ['bot:ABC234:0', 'bot:ABC234:1', 'bot:ABC234:2', 'bot:ABC234:3']
    const faces = new Set(seeds.map(botFaceIndex))
    expect(faces.size).toBeGreaterThan(1)
  })
})
