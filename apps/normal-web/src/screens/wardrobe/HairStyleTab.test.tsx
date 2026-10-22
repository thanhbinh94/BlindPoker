import { act, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, BodyDto, ItemDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { HairStyleTab } from './HairStyleTab.js'

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const BODY_F: BodyDto = {
  gender: 'f',
  body: 'body_f_L30',
  faces: Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_f_face_${e}_L50`])),
  naturalEyeColour: '#2e6a9b',
}
const hair = (id: string): ItemDto => ({
  id,
  slot: 'hairStyle',
  rarity: 'common',
  nameKey: `items.${id}`,
  assetKey: `hairStyle/${id}`,
  isDefault: false,
  free: true,
  gender: 'f',
  asset: { layer: 60, file: `item_${id}_L60`, back: `item_${id}_L20`, fitsAvatarCrop: true },
})
const OUTFIT_CASUAL: ItemDto = {
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  nameKey: 'items.outfit_casual01',
  assetKey: 'outfit/outfit_casual01',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
}
const CATALOG = [hair('hair_f_bob01'), hair('hair_f_hime01'), OUTFIT_CASUAL]
const ITEMS = new Map(CATALOG.map((each) => [each.id, each]))
const DRAFT: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }

/** A hand-driven `IntersectionObserver` (the pattern of the kit's own `lazy.test.tsx`): `fire` tells every observer its
 * targets are on screen. jsdom has none, and without one a lazy `Chibi` draws at once. */
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

describe('HairStyleTab', () => {
  beforeEach(() => {
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    FakeObserver.all = []
  })
  afterEach(() => vi.unstubAllGlobals())

  // Plan 27 E2: eight portraits on a tab, most of them below the fold on a phone — each a lazy chibi.
  it('draws each hairstyle’s portrait only once it comes on screen, in a box of its own size meanwhile', () => {
    renderWithI18n(
      <HairStyleTab
        catalog={CATALOG}
        items={ITEMS}
        bodies={new Map([[BODY_F.gender, BODY_F]])}
        owned={new Set(['hair_f_bob01', 'hair_f_hime01'])}
        hints={{ achievements: [], gifts: [] }}
        draft={DRAFT}
        showLocked={false}
        onPick={vi.fn()}
        portraitSize={96}
      />,
      makeI18n('vi'),
    )

    const panel = screen.getByRole('tabpanel')
    const portraits = [...panel.querySelectorAll<HTMLElement>('[data-chibi-hash]')]
    expect(portraits).toHaveLength(2)
    for (const portrait of portraits) expect(portrait).toHaveStyle({ width: '96px', height: '96px' })
    expect(panel.querySelectorAll('img')).toHaveLength(0)
    expect(screen.getByRole('button', { name: new RegExp(`^${viNormal.items.hair_f_hime01}, `) })).toBeInTheDocument()

    FakeObserver.fire()
    for (const portrait of portraits) expect(portrait.querySelectorAll('img').length).toBeGreaterThan(0)
  })
})
