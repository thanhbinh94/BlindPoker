import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto } from '../api.js'
import { PartPortrait, Portrait } from './Portrait.js'
import { withSlot } from './config.js'
import { fakeRenderer } from './fake-renderer.js'
import { hashConfig } from './hash.js'
import { resetPortraitMemory } from './portrait-cache.js'
import { setPortraitRendererForTests } from './usePortrait.js'

const CONFIG: AvatarConfigDto = {
  v: 2,
  body: 'female',
  skin: '#efc9a4',
  eyes: '#6b4a2f',
  hairColor: '#d9a441',
  hair: 'hair_bun',
  top: 'clothing_aodai',
  bottom: 'bottom_skirt',
  shoes: 'shoes_sandals',
}

const disc = (): HTMLElement => {
  const found = document.querySelector('[data-portrait]')
  if (found === null) throw new Error('no portrait was rendered')
  return found as HTMLElement
}

describe('Portrait', () => {
  beforeEach(() => {
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    setPortraitRendererForTests(fakeRenderer({ supported: false }))
  })

  it('shows the initial while it is drawing, and the picture once it is drawn', async () => {
    const renderer = fakeRenderer({ hold: true })
    setPortraitRendererForTests(renderer)
    render(<Portrait config={CONFIG} name="Bình" />)

    expect(disc()).toHaveTextContent('B')
    expect(disc().querySelector('img')).toBeNull()

    renderer.release()

    await waitFor(() => expect(disc().querySelector('img')).not.toBeNull())
    expect(disc().querySelector('img')).toHaveAttribute('data-hash', hashConfig(CONFIG))
    expect(disc()).not.toHaveTextContent('B')
  })

  it('keeps the initial for good when portraits cannot be drawn here', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    setPortraitRendererForTests(fakeRenderer({ supported: false }))
    render(<Portrait config={CONFIG} name="bình" />)

    await waitFor(() => expect(disc()).toHaveAttribute('data-portrait', 'unsupported'))
    // Upper-cased, and still only the first character of a name that may be a whole sentence.
    expect(disc()).toHaveTextContent('B')
    expect(disc().querySelector('img')).toBeNull()
  })

  it('is idle with no configuration, and says nothing rather than an empty disc', () => {
    render(<Portrait config={null} name="Bình" />)

    expect(disc()).toHaveAttribute('data-portrait', 'idle')
    expect(disc()).toHaveTextContent('B')
  })

  it('is decoration without a label and an image with one', async () => {
    const { unmount } = render(<Portrait config={CONFIG} name="Bình" />)
    expect(disc()).toHaveAttribute('aria-hidden', 'true')
    expect(disc()).not.toHaveAttribute('role')
    unmount()

    render(<Portrait config={CONFIG} name="Bình" label="Ảnh của bạn" />)
    expect(await screen.findByRole('img', { name: 'Ảnh của bạn' })).toBe(disc())
    // The inner image never carries a second name: the wrapper owns the one this portrait has.
    await waitFor(() => expect(disc().querySelector('img')).toHaveAttribute('alt', ''))
  })

  it('marks the size it was asked for, and defaults to the list-row one', () => {
    const { unmount } = render(<Portrait config={null} name="Bình" />)
    expect(disc()).toHaveAttribute('data-size', 'md')
    unmount()

    for (const size of ['sm', 'md', 'lg'] as const) {
      const sized = render(<Portrait config={null} name="Bình" size={size} />)
      expect(disc()).toHaveAttribute('data-size', size)
      sized.unmount()
    }
  })
})

describe('PartPortrait', () => {
  beforeEach(() => {
    resetPortraitMemory()
    setPortraitRendererForTests(fakeRenderer())
  })

  it('draws the figure wearing the item, not the item on its own', async () => {
    const renderer = fakeRenderer()
    setPortraitRendererForTests(renderer)

    render(<PartPortrait config={CONFIG} slot="top" itemId="clothing_kimono" />)

    const tried = withSlot(CONFIG, 'top', 'clothing_kimono')
    await waitFor(() => expect(disc().querySelector('img')).toHaveAttribute('data-hash', hashConfig(tried)))
    // Everything but the previewed slot is the player's own configuration, so the tile and the face they
    // end up with are the same cache entry.
    expect(renderer.rendered).toEqual([hashConfig(tried)])
  })

  it('empties an optional slot rather than sending an empty id', async () => {
    render(<PartPortrait config={{ ...CONFIG, hat: 'hat_crown' }} slot="hat" itemId="" />)

    await waitFor(() => expect(disc().querySelector('img')).toHaveAttribute('data-hash', hashConfig(CONFIG)))
  })
})
