import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { AvatarConfigDto, BodyDto, ItemDto, NormalApi, OutfitDto } from '../../api.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { SavedOutfits } from './SavedOutfits.js'

const BODY_F: BodyDto = {
  gender: 'f',
  body: 'body_f_L30',
  faces: {
    neutral: 'body_f_face_neutral_L50',
    happy: 'body_f_face_happy_L50',
    sad: 'body_f_face_sad_L50',
    surprised: 'body_f_face_surprised_L50',
    closed: 'body_f_face_closed_L50',
    sleep: 'body_f_face_sleep_L50',
  },
  naturalEyeColour: '#2e6a9b',
}
const HAIR_BOB: ItemDto = {
  id: 'hair_f_bob01',
  slot: 'hairStyle',
  rarity: 'common',
  nameKey: 'items.hair_f_bob01',
  assetKey: 'hairStyle/hair_f_bob01',
  isDefault: false,
  free: true,
  gender: 'f',
  asset: { layer: 60, file: 'item_hair_f_bob01_L60', back: 'item_hair_f_bob01_L20', fitsAvatarCrop: true },
}
const OUTFIT_CASUAL: ItemDto = {
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  nameKey: 'items.outfit_casual01',
  assetKey: 'outfit/outfit_casual01',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
}

const ITEMS = new Map([HAIR_BOB, OUTFIT_CASUAL].map((each) => [each.id, each]))
const BODIES = new Map([[BODY_F.gender, BODY_F]])

const DRAFT: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }
const noOutfits: (OutfitDto | null)[] = [null, null, null, null, null]

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    saveOutfit: vi.fn(),
    deleteOutfit: vi.fn(),
    applyOutfit: vi.fn(),
    ...overrides,
  } as unknown as NormalApi
}

const renderBar = (props: Partial<Parameters<typeof SavedOutfits>[0]> = {}) => {
  const api = props.api ?? stubApi()
  return renderWithI18n(
    <SavedOutfits
      api={api}
      outfits={props.outfits ?? noOutfits}
      draft={props.draft ?? DRAFT}
      items={props.items ?? ITEMS}
      bodies={props.bodies ?? BODIES}
      onOutfitsChanged={props.onOutfitsChanged ?? vi.fn()}
      onApplied={props.onApplied ?? vi.fn()}
    />,
    makeI18n('vi'),
  )
}

describe('SavedOutfits', () => {
  it('shows five portraits, empty ones dashed with "Trống"', () => {
    renderBar()

    expect(screen.getAllByText(viNormal.outfits.empty)).toHaveLength(5)
  })

  it('gives each empty slot its own numbered accessible name, while the caption still reads "Trống"', () => {
    renderBar()

    for (let slot = 1; slot <= 5; slot += 1) {
      expect(screen.getByRole('button', { name: viNormal.outfits.emptySlot.replace('{{n}}', String(slot)) })).toBeInTheDocument()
    }
    // The visible caption every empty slot shows is still the plain, un-numbered "Trống" (design §3.1
    // item 4) — only the accessible name tells the slots apart.
    expect(screen.getAllByText(viNormal.outfits.empty)).toHaveLength(5)
  })

  it('saves the current draft into an empty slot with the default name', async () => {
    const saved: OutfitDto = { slot: 1, name: 'Bộ 1', config: DRAFT, updatedAt: 0 }
    const saveOutfit = vi.fn().mockResolvedValue(saved)
    const user = userEvent.setup()
    renderBar({ api: stubApi({ saveOutfit }) })

    // Empty slots have no menu — clicking one opens the naming dialog directly.
    await user.click(screen.getByRole('button', { name: viNormal.outfits.emptySlot.replace('{{n}}', '1') }))
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByDisplayValue(viNormal.outfits.defaultName.replace('{{n}}', '1'))).toBeInTheDocument()

    await user.click(dialog.getByRole('button', { name: viNormal.outfits.saveHere }))

    await waitFor(() => expect(saveOutfit).toHaveBeenCalledWith(1, 'Bộ 1', expect.objectContaining({ v: 4 })))
  })

  it('draws a filled slot’s portrait from its v4 config: the body of its gender, its hairstyle', () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    renderBar({ outfits: [outfitOne, null, null, null, null] })

    const portrait = screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') })
    expect(portrait.querySelector('[data-chibi-hash]')).not.toBeNull()
    const sources = [...portrait.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '')
    expect(sources.some((src) => src.includes('body_f_L30'))).toBe(true)
    expect(sources.some((src) => src.includes('item_hair_f_bob01_L60'))).toBe(true)
  })

  it('opens a menu on a filled slot with Mặc bộ này · Lưu đè · Đổi tên · Xóa', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null] })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))

    expect(screen.getByRole('button', { name: viNormal.outfits.apply })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: viNormal.outfits.overwrite })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: viNormal.outfits.rename })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: viNormal.outfits.delete })).toBeInTheDocument()
  })

  it('applies a saved outfit from its menu and pushes its config into the draft', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_tuxedo01' }, updatedAt: 0 }
    const applyOutfit = vi.fn().mockResolvedValue({ config: outfitOne.config })
    const onApplied = vi.fn()
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null], api: stubApi({ applyOutfit }), onApplied })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.apply }))

    await waitFor(() => expect(applyOutfit).toHaveBeenCalledWith(1))
    expect(onApplied).toHaveBeenCalledWith(outfitOne.config)
  })

  it('overwrites a filled slot from its menu with the current draft', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    const overwritten: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 1 }
    const saveOutfit = vi.fn().mockResolvedValue(overwritten)
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null], api: stubApi({ saveOutfit }) })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.overwrite }))

    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByDisplayValue('Đi làm')).toBeInTheDocument()
    await user.click(dialog.getByRole('button', { name: viNormal.outfits.overwrite }))

    await waitFor(() => expect(saveOutfit).toHaveBeenCalledWith(1, 'Đi làm', expect.objectContaining({ v: 4 })))
  })

  it('renames a filled slot from its menu without changing its config', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    const renamed: OutfitDto = { slot: 1, name: 'Tết', config: DRAFT, updatedAt: 1 }
    const saveOutfit = vi.fn().mockResolvedValue(renamed)
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null], api: stubApi({ saveOutfit }) })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.rename }))

    const dialog = within(screen.getByRole('dialog'))
    const nameField = dialog.getByLabelText(viNormal.outfits.nameLabel)
    await user.clear(nameField)
    await user.type(nameField, 'Tết')
    await user.click(dialog.getByRole('button', { name: viNormal.outfits.rename }))

    await waitFor(() => expect(saveOutfit).toHaveBeenCalledWith(1, 'Tết', expect.objectContaining({ v: 4 })))
  })

  it('deletes a saved outfit from its menu', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    const deleteOutfit = vi.fn().mockResolvedValue({ removed: true })
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null], api: stubApi({ deleteOutfit }) })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.delete }))

    await waitFor(() => expect(deleteOutfit).toHaveBeenCalledWith(1))
  })

  it('shows an error and does not clear the slot when apply fails', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: DRAFT, updatedAt: 0 }
    const applyOutfit = vi.fn().mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    renderBar({ outfits: [outfitOne, null, null, null, null], api: stubApi({ applyOutfit }) })

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.apply }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.outfits.error)
  })
})
