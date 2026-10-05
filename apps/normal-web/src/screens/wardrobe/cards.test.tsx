import { useTintedLayer, type LayerRef } from '@bp/ui-kit'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ItemDto } from '../../api.js'
import enNormal from '../../locales/en/normal.json'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { ColourCard, ItemCard, WordCard } from './cards.js'

// Plan 18 (No8a): `ItemPreview` tints a colour variant's icon through the kit's own `useTintedLayer`. Whether the
// canvas really paints is `tinted.test.ts`'s business (ui-kit); here the hook answers a fake blob URL for any layer
// with tints, and `null` — "draw the plain icon" — for one without, as the real hook does under jsdom.
vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
const tintedLayer = vi.mocked(useTintedLayer)
const fakeBlob = (layer: LayerRef): string | null => (layer.tints === undefined || layer.tints.length === 0 ? null : `blob:http://localhost/${layer.tints[0]!.colour}`)
beforeEach(() => {
  tintedLayer.mockReset()
  tintedLayer.mockImplementation((_prefix, layer) => fakeBlob(layer))
})

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const HEAD_BERET = item({
  id: 'head_beret_red01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true },
})
const HEAD_BERET_BLUE = item({
  id: 'head_beret_blue01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true, tint: '#3f6fd8', tintMeanL: 0.5 },
})
const HEAD_TOPHAT = item({
  id: 'head_tophat01',
  slot: 'head',
  rarity: 'epic',
  asset: { layer: 80, file: 'item_head_tophat01_L80', fitsAvatarCrop: true },
})
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', colour: '#b3261e' })
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

const render = (ui: React.ReactElement) => renderWithI18n(ui, makeI18n('vi'))

describe('cards', () => {
  describe('ItemCard', () => {
    it('names an owned, unworn card "<name>, <rarity>"', () => {
      render(<ItemCard item={HEAD_BERET} owned wearing={false} hint="" onPick={vi.fn()} />)

      expect(screen.getByRole('button', { name: `${viNormal.items.head_beret_red01}, ${viNormal.inventory.rarity.rare}` })).toBeInTheDocument()
    })

    it('shows the wearing pill and names the card as wearing, with aria-pressed true', () => {
      render(<ItemCard item={HEAD_BERET} owned wearing hint="" onPick={vi.fn()} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.head_beret_red01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.wearingBadge}`,
      })
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
    })

    it('names a locked card with the hint, marks it aria-disabled, and a click does not call onPick', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ItemCard item={HEAD_TOPHAT} owned={false} wearing={false} hint="Điểm danh hằng ngày" onPick={onPick} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.head_tophat01}, ${viNormal.inventory.rarity.epic}, ${viNormal.wardrobe.filter.locked}: Điểm danh hằng ngày`,
      })
      expect(card).toHaveAttribute('aria-disabled', 'true')
      expect(screen.getByText('Điểm danh hằng ngày')).toBeInTheDocument()

      await user.click(card)

      expect(onPick).not.toHaveBeenCalled()
    })

    it('calls onPick with the item id on a click of an owned card', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ItemCard item={HEAD_BERET} owned wearing={false} hint="" onPick={onPick} />)

      // The exact label: a prefix of the name would also match the original's own dot in a family's row (No8a).
      await user.click(screen.getByRole('button', { name: `${viNormal.items.head_beret_red01}, ${viNormal.inventory.rarity.rare}` }))

      expect(onPick).toHaveBeenCalledWith('head_beret_red01')
    })

    it('renders a colour dot per variant, clickable only when owned', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(
        <ItemCard
          item={HEAD_BERET}
          owned={false}
          wearing={false}
          hint="hint"
          variants={[{ item: HEAD_BERET_BLUE, owned: true, wearing: false, hint: '' }]}
          onPick={onPick}
        />,
      )

      const dot = screen.getByRole('button', { name: viNormal.items.head_beret_blue01 })
      expect(dot).toHaveAttribute('aria-disabled', 'false')

      await user.click(dot)

      expect(onPick).toHaveBeenCalledWith('head_beret_blue01')
    })

    // Plan 19 (spec §6.1): a hairstyle card shows a head portrait, not an icon.
    it('draws a given thumb instead of the icon', () => {
      const HAIR = item({ id: 'hair_f_bob01', slot: 'hairStyle', rarity: 'common', asset: { layer: 60, file: 'item_hair_f_bob01_L60', back: 'item_hair_f_bob01_L20', fitsAvatarCrop: true } })
      render(<ItemCard item={HAIR} owned wearing={false} hint="" thumb={<span data-testid="portrait" />} onPick={vi.fn()} />)

      const card = screen.getByRole('button', { name: `${viNormal.items.hair_f_bob01}, ${viNormal.inventory.rarity.common}` })
      expect(within(card).getByTestId('portrait')).toBeInTheDocument()
      expect(card.querySelector('img')).toBeNull()
      expect(tintedLayer).not.toHaveBeenCalled()
    })

    it('does not call onPick when a variant dot is not owned', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(
        <ItemCard
          item={HEAD_BERET}
          owned
          wearing={false}
          hint=""
          variants={[{ item: HEAD_BERET_BLUE, owned: false, wearing: false, hint: 'daily hint' }]}
          onPick={onPick}
        />,
      )

      // A locked dot says how to get it, in the card's own wording (no rarity: the dot has no rarity line).
      const dot = screen.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${viNormal.wardrobe.filter.locked}: daily hint` })
      expect(dot).toHaveAttribute('aria-disabled', 'true')

      await user.click(dot)

      expect(onPick).not.toHaveBeenCalled()
    })
  })

  // Review 2026-09-29, No8a (Plan 18, pre-flight amendment 1): a family card *is* the member it shows — the one being
  // worn, when one is — in every respect, and its picture is that member's colour.
  describe('ItemCard — a colour family', () => {
    const ICON = 'item_head_beret_red01_icon'

    it("tints a colour variant's icon with its own colour, from the icon's tint mask, and draws the blob without srcset", () => {
      const { container } = render(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" onPick={vi.fn()} />)

      expect(tintedLayer).toHaveBeenCalledWith('/avatar/', {
        order: 80,
        file: ICON,
        tints: [{ mask: `${ICON}_tintmask`, colour: '#3f6fd8', meanL: 0.5 }],
      })
      const icon = container.querySelector('img')!
      expect(icon).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      expect(icon.hasAttribute('srcset')).toBe(false)
      expect(icon).toHaveAttribute('data-item-icon', 'head_beret_blue01')
    })

    it('falls back to the plain two-density icon when the tinted one fails to load', () => {
      const { container } = render(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" onPick={vi.fn()} />)

      fireEvent.error(container.querySelector('img')!)

      const icon = container.querySelector('img')!
      expect(icon).toHaveAttribute('src', `/avatar/${ICON}@1x.png`)
      expect(icon).toHaveAttribute('srcset', `/avatar/${ICON}@1x.png 1x, /avatar/${ICON}@2x.png 2x`)
    })

    it('asks for no tint for an untinted item, which keeps its two-density icon', () => {
      const { container } = render(<ItemCard item={HEAD_BERET} owned wearing={false} hint="" onPick={vi.fn()} />)

      expect(tintedLayer).toHaveBeenCalledWith('/avatar/', { order: 80, file: ICON })
      const icon = container.querySelector('img')!
      expect(icon).toHaveAttribute('src', `/avatar/${ICON}@1x.png`)
      expect(icon).toHaveAttribute('srcset', `/avatar/${ICON}@1x.png 1x, /avatar/${ICON}@2x.png 2x`)
    })

    it('names, marks and picks the member it shows — the worn variant — and keeps the family name on the dot row', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(
        <ItemCard
          item={HEAD_BERET_BLUE}
          family={HEAD_BERET}
          owned
          wearing
          hint=""
          variants={[
            { item: HEAD_BERET, owned: false, wearing: false, hint: 'daily hint' },
            { item: HEAD_BERET_BLUE, owned: true, wearing: true, hint: '' },
          ]}
          onPick={onPick}
        />,
      )

      const card = screen.getByRole('button', {
        name: `${viNormal.items.head_beret_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.wearingBadge}`,
      })
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(card).toHaveAttribute('aria-disabled', 'false')
      expect(within(card).getByText(viNormal.items.head_beret_blue01)).toBeInTheDocument()
      expect(within(card).getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
      expect(screen.getByRole('group', { name: viNormal.items.head_beret_red01 })).toBeInTheDocument()

      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('head_beret_blue01')
    })

    it("titles every dot with its member's name, marks the worn one pressed, and draws the original's as an untinted swatch", async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(
        <ItemCard
          item={HEAD_BERET_BLUE}
          family={HEAD_BERET}
          owned
          wearing
          hint=""
          variants={[
            { item: HEAD_BERET, owned: true, wearing: false, hint: '' },
            { item: HEAD_BERET_BLUE, owned: true, wearing: true, hint: '' },
          ]}
          onPick={onPick}
        />,
      )

      const dots = within(screen.getByRole('group', { name: viNormal.items.head_beret_red01 })).getAllByRole('button')
      expect(dots.map((dot) => [dot.getAttribute('aria-label'), dot.getAttribute('title'), dot.getAttribute('aria-pressed')])).toEqual([
        [viNormal.items.head_beret_red01, viNormal.items.head_beret_red01, 'false'],
        [viNormal.items.head_beret_blue01, viNormal.items.head_beret_blue01, 'true'],
      ])
      // The original wears no tint: its dot is the natural swatch, not a colour.
      expect(dots[0]!.style.background).toBe('')
      expect(dots[1]!.style.background).not.toBe('')

      await user.click(dots[0]!)

      expect(onPick).toHaveBeenCalledWith('head_beret_red01')
    })

    // Plan 20 (T3): a locked dot carries the same "<name>, Chưa có: <hint>" its card would, in its label and its title —
    // an owned variant's card hides the original's own lock line, and the dot is where the original shows up.
    it('names a locked dot "<name>, Chưa có: <hint>" in its label and its title, and an owned one by its name alone', () => {
      const lockedName = `${viNormal.items.head_beret_red01}, ${viNormal.wardrobe.filter.locked}: how to get it`
      render(
        <ItemCard
          item={HEAD_BERET_BLUE}
          family={HEAD_BERET}
          owned
          wearing={false}
          hint=""
          variants={[
            { item: HEAD_BERET, owned: false, wearing: false, hint: 'how to get it' },
            { item: HEAD_BERET_BLUE, owned: true, wearing: false, hint: '' },
          ]}
          onPick={vi.fn()}
        />,
      )

      const dots = within(screen.getByRole('group', { name: viNormal.items.head_beret_red01 })).getAllByRole('button')
      expect(dots.map((dot) => [dot.getAttribute('aria-label'), dot.getAttribute('title')])).toEqual([
        [lockedName, lockedName],
        [viNormal.items.head_beret_blue01, viNormal.items.head_beret_blue01],
      ])
      expect(dots[0]).toHaveAttribute('aria-disabled', 'true')
      expect(dots[1]).toHaveAttribute('aria-disabled', 'false')
    })

    // Plan 20 (T3): with the box ticked the card shows an owned variant, and the original it varies is locked. Touch has no
    // tooltip, so the dot's hint is not enough: one visible line names the original and says how to get it.
    describe('the locked original’s hint line', () => {
      const HINT = 'how to get it'
      const variants = [
        { item: HEAD_BERET, owned: false, wearing: false, hint: HINT },
        { item: HEAD_BERET_BLUE, owned: true, wearing: true, hint: '' },
      ]

      it('draws "<original name>: <hint>" between the pick button and the dot row — outside the button', () => {
        render(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" familyHint={HINT} variants={variants} onPick={vi.fn()} />)

        const line = screen.getByText(`${viNormal.items.head_beret_red01}: ${HINT}`)
        const pick = screen.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.wearingBadge}` })
        const dotRow = screen.getByRole('group', { name: viNormal.items.head_beret_red01 })
        expect(pick.contains(line), 'not inside the pick button').toBe(false)
        expect(pick.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING, 'after the pick button').toBeTruthy()
        expect(line.compareDocumentPosition(dotRow) & Node.DOCUMENT_POSITION_FOLLOWING, 'before the dot row').toBeTruthy()
        // It is a line of text beside the button, not part of what the button says.
        expect(pick).toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.wearingBadge}`)
      })

      it('words the line by the `wardrobe.familyHint` template, in either language', () => {
        const i18n = makeI18n('vi')
        i18n.addResource('vi', 'normal', 'wardrobe.familyHint', '{{hint}} ({{name}})')
        renderWithI18n(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" familyHint={HINT} variants={variants} onPick={vi.fn()} />, i18n)
        expect(screen.getByText(`${HINT} (${viNormal.items.head_beret_red01})`)).toBeInTheDocument()

        renderWithI18n(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" familyHint={HINT} variants={variants} onPick={vi.fn()} />, makeI18n('en'))
        expect(screen.getByText(`${enNormal.items.head_beret_red01}: ${HINT}`)).toBeInTheDocument()
      })

      it('draws no line without a familyHint', () => {
        render(<ItemCard item={HEAD_BERET_BLUE} family={HEAD_BERET} owned wearing hint="" variants={variants} onPick={vi.fn()} />)

        expect(screen.queryByText(new RegExp(`^${viNormal.items.head_beret_red01}: `))).toBeNull()
      })
    })
  })

  describe('ColourCard', () => {
    it('names the Natural card and calls onPick(undefined) on a click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ColourCard item={null} owned wearing hint="" onPick={onPick} />)

      const natural = screen.getByRole('button', { name: viNormal.wardrobe.natural })
      await user.click(natural)

      expect(onPick).toHaveBeenCalledWith(undefined)
    })

    it('names an owned colour card, and calls onPick with the item id', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ColourCard item={HAIRCOLOR_RED} owned wearing={false} hint="" onPick={onPick} />)

      const card = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })
      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('haircolor_red01')
    })

    it('locks an unowned colour card and blocks the click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ColourCard item={HAIRCOLOR_RED} owned={false} wearing={false} hint="daily hint" onPick={onPick} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}, ${viNormal.wardrobe.filter.locked}: daily hint`,
      })
      expect(card).toHaveAttribute('aria-disabled', 'true')

      await user.click(card)

      expect(onPick).not.toHaveBeenCalled()
    })
  })

  describe('WordCard', () => {
    it('names an owned title card and calls onPick on click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<WordCard item={TITLE_ROOKIE} owned wearing={false} hint="" onPick={onPick} />)

      const card = screen.getByRole('button', { name: `${viNormal.items.title_rookie}, ${viNormal.inventory.rarity.common}` })
      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('title_rookie')
    })

    it('locks an unowned title card, shows the hint, and blocks the click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<WordCard item={TITLE_ROOKIE} owned={false} wearing={false} hint="how to get it" onPick={onPick} />)

      expect(screen.getByText('how to get it')).toBeInTheDocument()
      const card = screen.getByRole('button', {
        name: `${viNormal.items.title_rookie}, ${viNormal.inventory.rarity.common}, ${viNormal.wardrobe.filter.locked}: how to get it`,
      })

      await user.click(card)

      expect(onPick).not.toHaveBeenCalled()
    })

    it('shows the wearing pill on a worn title card', () => {
      render(<WordCard item={TITLE_ROOKIE} owned wearing hint="" onPick={vi.fn()} />)

      expect(screen.getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: `${viNormal.items.title_rookie}, ${viNormal.inventory.rarity.common}, ${viNormal.wardrobe.wearingBadge}` }),
      ).toHaveAttribute('aria-pressed', 'true')
    })
  })
})
