import type { ChibiConfig } from '@bp/ui-kit'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { BaseDto, ItemDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { BaseCard, ColourCard, ItemCard, WordCard } from './cards.js'

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

      expect(screen.getByRole('button', { name: `${viNormal.items.head_beret_red01}, ${viNormal.wardrobe.rarity.rare}` })).toBeInTheDocument()
    })

    it('shows the wearing pill and names the card as wearing, with aria-pressed true', () => {
      render(<ItemCard item={HEAD_BERET} owned wearing hint="" onPick={vi.fn()} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.head_beret_red01}, ${viNormal.wardrobe.rarity.rare}, ${viNormal.wardrobe.wearingBadge}`,
      })
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
    })

    it('names a locked card with the hint, marks it aria-disabled, and a click does not call onPick', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ItemCard item={HEAD_TOPHAT} owned={false} wearing={false} hint="Điểm danh hằng ngày" onPick={onPick} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.head_tophat01}, ${viNormal.wardrobe.rarity.epic}, ${viNormal.wardrobe.filter.locked}: Điểm danh hằng ngày`,
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

      await user.click(screen.getByRole('button', { name: new RegExp(`^${viNormal.items.head_beret_red01}`) }))

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
          variants={[{ item: HEAD_BERET_BLUE, owned: true, wearing: false }]}
          onPick={onPick}
        />,
      )

      const dot = screen.getByRole('button', { name: viNormal.items.head_beret_blue01 })
      expect(dot).toHaveAttribute('aria-disabled', 'false')

      await user.click(dot)

      expect(onPick).toHaveBeenCalledWith('head_beret_blue01')
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
          variants={[{ item: HEAD_BERET_BLUE, owned: false, wearing: false }]}
          onPick={onPick}
        />,
      )

      const dot = screen.getByRole('button', { name: viNormal.items.head_beret_blue01 })
      expect(dot).toHaveAttribute('aria-disabled', 'true')

      await user.click(dot)

      expect(onPick).not.toHaveBeenCalled()
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

      const card = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.wardrobe.rarity.common}` })
      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('haircolor_red01')
    })

    it('locks an unowned colour card and blocks the click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<ColourCard item={HAIRCOLOR_RED} owned={false} wearing={false} hint="daily hint" onPick={onPick} />)

      const card = screen.getByRole('button', {
        name: `${viNormal.items.haircolor_red01}, ${viNormal.wardrobe.rarity.common}, ${viNormal.wardrobe.filter.locked}: daily hint`,
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

      const card = screen.getByRole('button', { name: `${viNormal.items.title_rookie}, ${viNormal.wardrobe.rarity.common}` })
      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('title_rookie')
    })

    it('locks an unowned title card, shows the hint, and blocks the click', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<WordCard item={TITLE_ROOKIE} owned={false} wearing={false} hint="how to get it" onPick={onPick} />)

      expect(screen.getByText('how to get it')).toBeInTheDocument()
      const card = screen.getByRole('button', {
        name: `${viNormal.items.title_rookie}, ${viNormal.wardrobe.rarity.common}, ${viNormal.wardrobe.filter.locked}: how to get it`,
      })

      await user.click(card)

      expect(onPick).not.toHaveBeenCalled()
    })

    it('shows the wearing pill on a worn title card', () => {
      render(<WordCard item={TITLE_ROOKIE} owned wearing hint="" onPick={vi.fn()} />)

      expect(screen.getByText(viNormal.wardrobe.wearingBadge)).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: `${viNormal.items.title_rookie}, ${viNormal.wardrobe.rarity.common}, ${viNormal.wardrobe.wearingBadge}` }),
      ).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('BaseCard', () => {
    const BASE_F01: BaseDto = {
      id: 'f01',
      nameKey: 'bases.f01',
      wear: 'f',
      layers: { hairBack: 'base_f01_L20', body: 'base_f01_L30', hairFront: 'base_f01_L60' },
      faces: {
        neutral: 'base_f01_face_neutral_L50',
        happy: 'base_f01_face_happy_L50',
        sad: 'base_f01_face_sad_L50',
        surprised: 'base_f01_face_surprised_L50',
        closed: 'base_f01_face_closed_L50',
        sleep: 'base_f01_face_sleep_L50',
      },
    }
    const PORTRAIT: ChibiConfig = {
      kind: 'human',
      base: {
        id: 'f01',
        hairBack: 'base_f01_L20',
        body: 'base_f01_L30',
        hairFront: 'base_f01_L60',
        faces: {
          neutral: 'base_f01_face_neutral_L50',
          happy: 'base_f01_face_happy_L50',
          sad: 'base_f01_face_sad_L50',
          surprised: 'base_f01_face_surprised_L50',
          closed: 'base_f01_face_closed_L50',
          sleep: 'base_f01_face_sleep_L50',
        },
      },
      outfit: { id: 'outfit_casual01', order: 40, file: 'item_outfit_casual01_L40' },
    }

    it('names the base and reflects selection via aria-pressed', async () => {
      const user = userEvent.setup()
      const onPick = vi.fn()
      render(<BaseCard base={BASE_F01} portrait={PORTRAIT} selected onPick={onPick} />)

      const card = screen.getByRole('button', { name: viNormal.bases.f01 })
      expect(card).toHaveAttribute('aria-pressed', 'true')

      await user.click(card)

      expect(onPick).toHaveBeenCalledWith('f01')
    })
  })
})
