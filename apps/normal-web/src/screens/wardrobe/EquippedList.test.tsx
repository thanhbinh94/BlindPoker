import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, ItemDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { EquippedList } from './EquippedList.js'

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

const HAIR_BOB = item({ id: 'hair_f_bob01', slot: 'hairStyle', rarity: 'common', gender: 'f', free: true })
const OUTFIT_CASUAL = item({ id: 'outfit_casual01', slot: 'outfit', rarity: 'common', isDefault: true })
const HEAD_BEANIE = item({ id: 'head_beanie01', slot: 'head', rarity: 'epic' })
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'rare', colour: '#b3261e' })
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

const ITEMS = new Map([HAIR_BOB, OUTFIT_CASUAL, HEAD_BEANIE, HAIRCOLOR_RED, TITLE_ROOKIE].map((it) => [it.id, it]))

const CONFIG: AvatarConfigDto = {
  v: 4,
  gender: 'f',
  hairStyle: 'hair_f_bob01',
  outfit: 'outfit_casual01',
  head: 'head_beanie01',
  hairColor: 'haircolor_red01',
  title: 'title_rookie',
}

const render = (ui: React.ReactElement) => renderWithI18n(ui, makeI18n('vi'))

const removeLabel = (name: string): string => viNormal.wardrobe.equipped.remove.replace('{{item}}', name)

describe('EquippedList', () => {
  it('lists the rows in the fixed design order', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    const labels = [
      viNormal.wardrobe.gender.legend,
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

  // Plan 19 (avatar v4): the body is chosen by gender, not by a base — so the first row names the gender. It is chosen,
  // never worn, so it has no "×".
  it('reads Giới tính: Nữ on its first row, which has no "×"', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    const [first] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent(`${viNormal.wardrobe.gender.legend}${viNormal.wardrobe.gender.f}`)
    expect(first!.querySelectorAll('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: removeLabel(viNormal.wardrobe.gender.f) })).toBeNull()
  })

  it('reads Nam on the first row for a male figure', () => {
    render(<EquippedList config={{ ...CONFIG, gender: 'm', hairStyle: 'hair_m_tousled01' }} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(`${viNormal.wardrobe.gender.legend}${viNormal.wardrobe.gender.m}`)
  })

  it('shows "Không có" for an empty optional slot, and the gender/outfit names when filled', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getByText(viNormal.wardrobe.gender.f)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.outfit_casual01)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
    // face, aura, frame and badge are all unset in CONFIG.
    expect(screen.getAllByText(viNormal.wardrobe.equipped.none)).toHaveLength(4)
  })

  it('shows "Tự nhiên" for an empty colour slot rather than "Không có"', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    // eyeColor is unset; hairColor is set to the red item.
    expect(screen.getByText(viNormal.wardrobe.natural)).toBeInTheDocument()
    expect(screen.getByText(viNormal.items.haircolor_red01)).toBeInTheDocument()
  })

  it('colours an equipped item name by its rarity', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getByText(viNormal.items.head_beanie01)).toHaveAttribute('data-rarity', 'epic')
    expect(screen.getByText(viNormal.items.haircolor_red01)).toHaveAttribute('data-rarity', 'rare')
  })

  it('never shows a remove button on the Giới tính or Trang phục rows', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.queryByRole('button', { name: removeLabel(viNormal.wardrobe.gender.f) })).toBeNull()
    expect(screen.queryByRole('button', { name: removeLabel(viNormal.items.outfit_casual01) })).toBeNull()
  })

  it('shows a remove button on a filled optional slot, and none when that slot is empty', () => {
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={vi.fn()} />)

    expect(screen.getByRole('button', { name: removeLabel(viNormal.items.head_beanie01) })).toBeInTheDocument()
    // face is empty — no remove button anywhere names it with "Không có".
    expect(screen.queryByRole('button', { name: removeLabel(viNormal.wardrobe.equipped.none) })).toBeNull()
  })

  it('calls onRemove with the slot when its "×" is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={onRemove} onJump={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: removeLabel(viNormal.items.head_beanie01) }))

    expect(onRemove).toHaveBeenCalledWith('head')
  })

  it('calls onJump with the hair colour tab when the Giới tính row is clicked', async () => {
    // Until the gender switch heads the look group (A6), the hair colour is the look group's first tab.
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByText(viNormal.wardrobe.gender.legend).closest('button') as HTMLElement)

    expect(onJump).toHaveBeenCalledWith('hairColor')
  })

  it('calls onJump with the words tab when the Danh hiệu row is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByText(viNormal.wardrobe.words.titles).closest('button') as HTMLElement)

    expect(onJump).toHaveBeenCalledWith('words')
  })

  it('does not also jump when the remove "×" is clicked', async () => {
    const user = userEvent.setup()
    const onJump = vi.fn()
    render(<EquippedList config={CONFIG} items={ITEMS} onRemove={vi.fn()} onJump={onJump} />)

    await user.click(screen.getByRole('button', { name: removeLabel(viNormal.items.head_beanie01) }))

    expect(onJump).not.toHaveBeenCalled()
  })
})
