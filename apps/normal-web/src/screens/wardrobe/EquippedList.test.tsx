import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, BaseDto, ItemDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { EquippedList } from './EquippedList.js'

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const OUTFIT_CASUAL = item({ id: 'outfit_casual01', slot: 'outfit', rarity: 'common', isDefault: true })
const HEAD_BEANIE = item({ id: 'head_beanie01', slot: 'head', rarity: 'epic' })
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'rare', colour: '#b3261e' })
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

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

const ITEMS = new Map([OUTFIT_CASUAL, HEAD_BEANIE, HAIRCOLOR_RED, TITLE_ROOKIE].map((it) => [it.id, it]))
const BASES = new Map([[BASE_F01.id, BASE_F01]])

const CONFIG: AvatarConfigDto = {
  v: 3,
  base: 'f01',
  outfit: 'outfit_casual01',
  head: 'head_beanie01',
  hairColor: 'haircolor_red01',
  title: 'title_rookie',
}

const render = (ui: React.ReactElement) => renderWithI18n(ui, makeI18n('vi'))

describe('EquippedList', () => {
  it('lists the rows in the fixed design order', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    const labels = [
      viNormal.wardrobe.tabs.base,
      viNormal.wardrobe.tabs.hairColor,
      viNormal.wardrobe.tabs.eyeColor,
      viNormal.wardrobe.tabs.head,
      viNormal.wardrobe.tabs.face,
      viNormal.wardrobe.tabs.outfit,
      viNormal.wardrobe.tabs.aura,
      viNormal.wardrobe.tabs.frame,
      viNormal.wardrobe.words.titles,
      viNormal.wardrobe.words.badges,
    ]
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(10)
    rows.forEach((row, index) => {
      expect(row).toHaveTextContent(labels[index]!)
    })
  })

  it('shows "Không có" for an empty optional slot, and the base/outfit names when filled', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getByText(viNormal.bases.f01)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.outfit_casual01)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
    // face, aura, frame and badge are all unset in CONFIG.
    expect(screen.getAllByText(viNormal.wardrobe.equipped.none)).toHaveLength(4)
  })

  it('shows "Tự nhiên" for an empty colour slot rather than "Không có"', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    // eyeColor is unset; hairColor is set to the red item.
    expect(screen.getByText(viNormal.wardrobe.natural)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.haircolor_red01)).toBeInTheDocument()
  })

  it('colours an equipped item name by its rarity', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getByText(viNormal.items.head_beanie01)).toHaveAttribute('data-rarity', 'epic')
    expect(screen.getByText(viNormal.items.haircolor_red01)).toHaveAttribute('data-rarity', 'rare')
  })

  it('never shows a remove button on the Thân or Trang phục rows', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.queryByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.bases.f01) })).toBeNull()
    expect(
      screen.queryByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.items.outfit_casual01) }),
    ).toBeNull()
  })

  it('shows a remove button on a filled optional slot, and none when that slot is empty', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(
      screen.getByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.items.head_beanie01) }),
    ).toBeInTheDocument()
    // face is empty — no remove button anywhere names it with "Không có".
    expect(
      screen.queryByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.wardrobe.equipped.none) }),
    ).toBeNull()
  })

  it('calls onRemove with the slot when its "×" is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={onRemove} onJump={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.items.head_beanie01) }))

    expect(onRemove).toHaveBeenCalledWith('head')
  })

  it('calls onJump with the base tab when the Thân row is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByText(viNormal.wardrobe.tabs.base).closest('button') as HTMLElement)

    expect(onJump).toHaveBeenCalledWith('base')
  })

  it('calls onJump with the words tab when the Danh hiệu row is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByText(viNormal.wardrobe.words.titles).closest('button') as HTMLElement)

    expect(onJump).toHaveBeenCalledWith('words')
  })

  it('does not also jump when the remove "×" is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} bases={BASES} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.equipped.remove.replace('{{item}}', viNormal.items.head_beanie01) }))

    expect(onJump).not.toHaveBeenCalled()
  })
})
