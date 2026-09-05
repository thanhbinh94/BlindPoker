import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
// The server's catalogue, read straight from its data directory — the same escape hatch `locales.test.ts`
// takes, and for the same reason: the ids live there, the drawings live here, and an item nobody drew must
// fail the build rather than ship as a hole in a face. It is data, it is a test, and it never reaches the bundle.
import itemDefs from '../../../normal-server/data/items.json'
import type { AvatarConfigDto } from '../api.js'
import { Avatar } from './Avatar.js'
import { DEFAULT_HAIR_COLOR, HAIR_PRESETS, LAYER_ORDER, PARTS } from './parts.js'

const CONFIG: AvatarConfigDto = {
  base: 'base_01',
  face: 'face_01',
  clothing: 'clothing_tee',
  hair: 'hair_short',
  hairColor: DEFAULT_HAIR_COLOR,
}

const svgOf = (container: HTMLElement): SVGSVGElement => {
  const found = container.querySelector('svg')
  if (found === null) throw new Error('no avatar was drawn')
  return found
}

const layersOf = (container: HTMLElement): string[] =>
  [...container.querySelectorAll('g[data-layer]')].map((g) => g.getAttribute('data-layer') ?? '')

describe('the part library', () => {
  it('draws every visual item in the catalogue, and nothing that is not one', () => {
    const visual = itemDefs.filter((item) => (LAYER_ORDER as readonly string[]).includes(item.category))
    // 5 bases, 5 faces, 7 garments, 6 hairstyles, 6 accessories, 5 pieces of jewelry.
    expect(visual).toHaveLength(34)

    expect(Object.keys(PARTS).sort()).toEqual(visual.map((item) => item.assetKey).sort())
  })

  it('keys every part by `<category>/<id>`, exactly as the catalogue spells the assetKey', () => {
    for (const item of itemDefs) {
      if (!(LAYER_ORDER as readonly string[]).includes(item.category)) continue
      expect(item.assetKey, item.id).toBe(`${item.category}/${item.id}`)
      expect(PARTS[item.assetKey], item.assetKey).toBeTypeOf('function')
    }
  })

  it('leaves title and badge out: they are text on the plate, not layers on the face', () => {
    expect([...LAYER_ORDER]).toEqual(['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry'])
    for (const item of itemDefs) {
      if (item.category === 'title' || item.category === 'badge') expect(PARTS[item.assetKey]).toBeUndefined()
    }
  })

  it('renders every part without throwing', () => {
    for (const [key, part] of Object.entries(PARTS)) {
      const { container } = render(<svg viewBox="0 0 64 64">{part({})}</svg>)
      expect(container.querySelector('svg')?.childElementCount, key).toBeGreaterThan(0)
    }
  })

  it('offers a hair palette of distinct hex colours', () => {
    expect(new Set(HAIR_PRESETS).size).toBe(HAIR_PRESETS.length)
    for (const colour of HAIR_PRESETS) expect(colour).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('Avatar', () => {
  it('stacks the equipped layers in LAYER_ORDER, whatever order the config lists them in', () => {
    const { container } = render(
      <Avatar
        config={{ jewelry: 'jewelry_stud', accessory: 'accessory_glasses', ...CONFIG }}
        label="Bình"
      />,
    )

    expect(layersOf(container)).toEqual(['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry'])
  })

  it('draws only the slots that are filled', () => {
    const { container } = render(<Avatar config={CONFIG} label="Bình" />)

    expect(layersOf(container)).toEqual(['base', 'face', 'clothing', 'hair'])
  })

  it('publishes the hair colour as --avatar-hair on the svg, so every hair path fills from one declaration', () => {
    const { container } = render(<Avatar config={{ ...CONFIG, hairColor: '#c8323c' }} label="Bình" />)

    expect(svgOf(container).style.getPropertyValue('--avatar-hair')).toBe('#c8323c')
  })

  it('falls back to the default ink when the config carries no colour', () => {
    const { container } = render(<Avatar config={{ ...CONFIG, hairColor: '' }} label="Bình" />)

    expect(svgOf(container).style.getPropertyValue('--avatar-hair')).toBe(DEFAULT_HAIR_COLOR)
  })

  it('skips a layer whose assetKey this bundle does not know, rather than throwing', () => {
    // The server may publish an item before the bundle that draws it: a missing hat is not a broken table.
    const { container } = render(<Avatar config={{ ...CONFIG, accessory: 'accessory_from_the_future' }} label="Bình" />)

    expect(layersOf(container)).toEqual(['base', 'face', 'clothing', 'hair'])
  })

  it('draws a neutral silhouette and no layers when there is no config at all', () => {
    const { container } = render(<Avatar config={null} label="Bình" />)

    expect(svgOf(container)).toHaveAttribute('data-avatar', 'none')
    expect(layersOf(container)).toEqual([])
    expect(svgOf(container).childElementCount).toBeGreaterThan(0)
  })

  it('is an image with the given name, and decoration without one', () => {
    const named = render(<Avatar config={CONFIG} label="Bình" />)
    expect(svgOf(named.container)).toHaveAttribute('aria-label', 'Bình')
    expect(svgOf(named.container)).not.toHaveAttribute('aria-hidden')

    const bare = render(<Avatar config={CONFIG} />)
    expect(svgOf(bare.container)).toHaveAttribute('aria-hidden', 'true')
  })

  it('sizes itself from the size prop and keeps a 64-unit box at every size', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      const { container } = render(<Avatar config={CONFIG} size={size} label="Bình" />)
      expect(svgOf(container)).toHaveAttribute('data-size', size)
      expect(svgOf(container)).toHaveAttribute('viewBox', '0 0 64 64')
    }
  })
})
