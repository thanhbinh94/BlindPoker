import { useTintedLayer, type LayerRef } from '@bp/ui-kit'
import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, ItemDto } from '../../api.js'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { ItemTab } from './ItemTab.js'

// `ItemPreview` tints a colour variant's icon through the kit's `useTintedLayer`; here the hook only records what it was
// asked for (file and queue priority) and answers a fake blob URL for a layer with tints.
vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
const tintedLayer = vi.mocked(useTintedLayer)

const head = (id: string): ItemDto => ({
  id,
  slot: 'head',
  rarity: 'rare',
  nameKey: `items.${id}`,
  assetKey: `head/${id}`,
  isDefault: false,
  asset: { layer: 80, file: `item_${id}_L80`, fitsAvatarCrop: true },
})
const CATALOG = [head('head_beanie01'), head('head_conical_hat01'), head('head_tophat01')]
const OWNED = new Set(CATALOG.map((each) => each.id))
const DRAFT: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }

/** A hand-driven `IntersectionObserver` (the pattern of the kit's own `lazy.test.tsx`): `fire` tells every observer its
 * targets are on screen. jsdom has none, and without one every icon draws at once. */
class FakeObserver {
  static all: FakeObserver[] = []
  readonly targets: Element[] = []
  constructor(readonly callback: IntersectionObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(target: Element) {
    this.targets.push(target)
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
  static fire() {
    act(() => {
      for (const o of FakeObserver.all) {
        o.callback(
          o.targets.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry),
          o as unknown as IntersectionObserver,
        )
      }
    })
  }
}

const drawTab = () =>
  renderWithI18n(
    <ItemTab slot="head" catalog={CATALOG} owned={OWNED} hints={{ achievements: [], gifts: [] }} draft={DRAFT} showLocked={false} onPick={vi.fn()} />,
    makeI18n('vi'),
  )

/** The last priority each icon file was asked to tint at. */
const priorities = (): Map<string, number> => {
  const map = new Map<string, number>()
  for (const [, layer, priority] of tintedLayer.mock.calls) if (layer.file !== '') map.set(layer.file, priority!)
  return map
}

describe('ItemTab', () => {
  beforeEach(() => {
    tintedLayer.mockReset()
    tintedLayer.mockImplementation((_prefix: string, layer: LayerRef) => (layer.tints === undefined ? null : `blob:http://localhost/${layer.file}`))  })
  afterEach(() => vi.unstubAllGlobals())

  // Plan 27 E2: a long tab of cards asks for no picture until a card comes on screen.
  it('draws a card’s icon only once it comes on screen: until then an empty box, no image and no tint', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    FakeObserver.all = []
    drawTab()

    const panel = screen.getByRole('tabpanel')
    expect(panel.querySelectorAll('[data-icon-pending]')).toHaveLength(3)
    expect(panel.querySelectorAll('img')).toHaveLength(0)
    expect(priorities().size).toBe(0)

    FakeObserver.fire()
    expect(panel.querySelectorAll('[data-icon-pending]')).toHaveLength(0)
    expect(panel.querySelectorAll('img[data-item-icon]')).toHaveLength(3)
  })

  it('tints the icons through the queue behind the figures, the first card first', () => {
    drawTab()

    // In the grid's own order (`slotCards`), whatever it is.
    const order = [...screen.getByRole('tabpanel').querySelectorAll('img')].map((img) => img.getAttribute('data-item-icon'))
    expect(order).toHaveLength(3)
    const ranked = priorities()
    const [first, second, third] = order.map((id) => ranked.get(`item_${id}_icon`)!)
    // Below a lazy chibi's lowest layer (−100 − 90), so no card ever holds up a figure.
    expect(first).toBeLessThan(-190)
    expect(first).toBeGreaterThan(second!)
    expect(second).toBeGreaterThan(third!)
  })
})
