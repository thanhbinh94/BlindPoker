import { CHIBI_LIFE, hashChibi, useTintedLayer, type LayerRef } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ApiError,
  type AchievementDefDto,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type BodyDto,
  type Gender,
  type InventoryDto,
  type ItemDto,
  type NormalApi,
  type OutfitDto,
} from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import { sameConfig, WardrobeScreen } from './WardrobeScreen.js'

// Plan 18 (No8a): a card's icon is tinted through the kit's `useTintedLayer` (`ItemPreview`). The hook answers a fake
// blob URL for a layer with tints and `null` — the plain icon — for one without, as the real one does under jsdom.
// Only the export the wardrobe's cards import is replaced; the stage's `Chibi` keeps the kit's own.
vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
beforeEach(() => {
  vi.mocked(useTintedLayer).mockImplementation((_prefix: string, layer: LayerRef) =>
    layer.tints === undefined || layer.tints.length === 0 ? null : `blob:http://localhost/${layer.tints[0]!.colour}`,
  )
})

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const facesOf = (g: Gender): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`]))
const BODY_F: BodyDto = { gender: 'f', body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' }
const BODY_M: BodyDto = { gender: 'm', body: 'body_m_L30', faces: facesOf('m'), naturalEyeColour: '#cc924c' }

const item = (patch: Partial<ItemDto> & Pick<ItemDto, 'id' | 'slot' | 'rarity'>): ItemDto => ({
  nameKey: `items.${patch.id}`,
  assetKey: `${patch.slot}/${patch.id}`,
  isDefault: false,
  ...patch,
})

/** The catalogue's eight hairstyles, `free` like every hairstyle a player starts with, each naming its counterpart of
 * the other gender (spec §4.2) — the female four, then the male four, in `items.json`'s order. */
const HAIR_PAIRS: readonly [string, string][] = [
  ['hair_f_bob01', 'hair_m_tousled01'],
  ['hair_f_hime01', 'hair_m_neat01'],
  ['hair_f_wavy01', 'hair_m_curly01'],
  ['hair_f_ponytail01', 'hair_m_spiky01'],
]
const hairStyle = (id: string, gender: Gender, counterpart: string): ItemDto =>
  item({
    id,
    slot: 'hairStyle',
    rarity: 'common',
    gender,
    counterpart,
    free: true,
    asset: { layer: 60, file: `item_${id}_L60`, back: `item_${id}_L20`, fitsAvatarCrop: true },
  })
const HAIRS: ItemDto[] = [...HAIR_PAIRS.map(([f, m]) => hairStyle(f, 'f', m)), ...HAIR_PAIRS.map(([f, m]) => hairStyle(m, 'm', f))]
const FEMALE_HAIRS = HAIR_PAIRS.map(([f]) => f)
const MALE_HAIRS = HAIR_PAIRS.map(([, m]) => m)

/** Two skin tones, `free` like all six (spec §4.2). */
const SKIN_PORCELAIN = item({ id: 'skin_porcelain01', slot: 'skinColor', rarity: 'common', free: true, colour: '#fcefe6' })
const SKIN_DEEP = item({ id: 'skin_deep01', slot: 'skinColor', rarity: 'common', free: true, colour: '#5c3a28' })

const OUTFIT_CASUAL = item({
  id: 'outfit_casual01',
  slot: 'outfit',
  rarity: 'common',
  isDefault: true,
  asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false },
})
const OUTFIT_TUXEDO = item({
  id: 'outfit_tuxedo01',
  slot: 'outfit',
  rarity: 'epic',
  asset: { layer: 40, file: 'item_outfit_tuxedo01_L40', fitsAvatarCrop: false },
})
const HEAD_TOPHAT = item({
  id: 'head_tophat01',
  slot: 'head',
  rarity: 'epic',
  asset: { layer: 80, file: 'item_head_tophat01_L80', fitsAvatarCrop: true },
})
const HEAD_BEANIE = item({
  id: 'head_beanie01',
  slot: 'head',
  rarity: 'common',
  asset: { layer: 80, file: 'item_head_beanie01_L80', fitsAvatarCrop: true },
})
/** A gendered outfit: one item, one id, a layer per wear (2026-09-20). */
const OUTFIT_DEALER = item({
  id: 'outfit_dealer01',
  slot: 'outfit',
  rarity: 'rare',
  asset: { layer: 40, file: 'item_outfit_dealer01_L40', variants: { m: 'item_outfit_dealer01_m_L40' }, fitsAvatarCrop: false },
})
const TITLE_ROOKIE = item({ id: 'title_rookie', slot: 'title', rarity: 'common' })

/** Plan 13 (design §6): a hair colour the player owns, one they don't, and a head card whose colour
 * variant they own even though the card itself (the original, untinted item) is locked — the case
 * the task brief calls out by name. */
const HAIRCOLOR_RED = item({ id: 'haircolor_red01', slot: 'hairColor', rarity: 'common', colour: '#b3261e' })
const HAIRCOLOR_BLUE = item({ id: 'haircolor_blue01', slot: 'hairColor', rarity: 'rare', colour: '#3355aa' })
const HEAD_BERET_RED = item({
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
/** A second beret variant the player does not own (No11a): its dot is hidden while the box is unticked. */
const HEAD_BERET_GREEN = item({
  id: 'head_beret_green01',
  slot: 'head',
  rarity: 'rare',
  asset: { layer: 80, file: 'item_head_beret_red01_L80', fitsAvatarCrop: true, tint: '#2e7d4f', tintMeanL: 0.5 },
})
/** No11a: a tab with something in it and nothing owned — the face tab's empty line. */
const FACE_SUNGLASSES = item({
  id: 'face_sunglasses01',
  slot: 'face',
  rarity: 'rare',
  asset: { layer: 70, file: 'item_face_sunglasses01_L70', fitsAvatarCrop: true },
})
const BADGE_BRONZE = item({ id: 'badge_bronze', slot: 'badge', rarity: 'common' })

const CATALOG = [
  ...HAIRS,
  SKIN_PORCELAIN,
  SKIN_DEEP,
  OUTFIT_CASUAL,
  OUTFIT_TUXEDO,
  OUTFIT_DEALER,
  HEAD_TOPHAT,
  HEAD_BEANIE,
  TITLE_ROOKIE,
  BADGE_BRONZE,
  HAIRCOLOR_RED,
  HAIRCOLOR_BLUE,
  HEAD_BERET_RED,
  HEAD_BERET_BLUE,
  HEAD_BERET_GREEN,
  FACE_SUNGLASSES,
]

const AVATAR: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01', head: 'head_beanie01' }

/** An inventory row for an item every player owns without a grant (`free`). */
const freeRow = (row: ItemDto): InventoryDto['items'][number] => ({
  itemId: row.id,
  acquiredAs: row.id,
  slot: row.slot,
  rarity: row.rarity,
  nameKey: row.nameKey,
  assetKey: row.assetKey,
  source: 'free',
  acquiredAt: 0,
})

const INVENTORY: InventoryDto = {
  items: [
    ...HAIRS.map(freeRow),
    freeRow(SKIN_PORCELAIN),
    freeRow(SKIN_DEEP),
    { itemId: 'outfit_casual01', acquiredAs: 'outfit_casual01', slot: 'outfit', rarity: 'common', nameKey: 'items.outfit_casual01', assetKey: 'outfit/outfit_casual01', source: 'default', acquiredAt: 0 },
    { itemId: 'head_beanie01', acquiredAs: 'head_beanie01', slot: 'head', rarity: 'common', nameKey: 'items.head_beanie01', assetKey: 'head/head_beanie01', source: 'default', acquiredAt: 0 },
    { itemId: 'haircolor_red01', acquiredAs: 'haircolor_red01', slot: 'hairColor', rarity: 'common', nameKey: 'items.haircolor_red01', assetKey: 'hairColor/haircolor_red01', source: 'default', acquiredAt: 0 },
    { itemId: 'head_beret_blue01', acquiredAs: 'head_beret_blue01', slot: 'head', rarity: 'rare', nameKey: 'items.head_beret_blue01', assetKey: 'head/head_beret_blue01', source: 'default', acquiredAt: 0 },
  ],
  avatar: AVATAR,
}

const AVATAR_CATALOG: AvatarCatalogDto = { frame: { w: 384, h: 448 }, crop: { x: 88, y: 40, size: 208 }, bodies: [BODY_F, BODY_M], manifestVersion: 1 }

const ACHIEVEMENTS: AchievementDefDto[] = [
  { id: 'login_days_100', category: 'login', metric: 'totalLoginDays', threshold: 100, reward: { itemId: 'head_tophat01' } },
]

const noOutfits: (OutfitDto | null)[] = [null, null, null, null, null]

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    inventory: vi.fn().mockResolvedValue(INVENTORY),
    catalogItems: vi.fn().mockResolvedValue({ items: CATALOG }),
    avatarCatalog: vi.fn().mockResolvedValue(AVATAR_CATALOG),
    outfits: vi.fn().mockResolvedValue({ outfits: noOutfits }),
    catalogAchievements: vi.fn().mockResolvedValue({ achievements: ACHIEVEMENTS }),
    setAvatar: vi.fn().mockResolvedValue({ config: AVATAR }),
    saveOutfit: vi.fn(),
    deleteOutfit: vi.fn(),
    applyOutfit: vi.fn(),
    ...overrides,
  } as unknown as NormalApi
}

const renderScreen = (api: NormalApi = stubApi()) => renderWithI18n(<WardrobeScreen api={api} playerId="p1" />, makeI18n('vi'))

/**
 * `CategoryNav` nests two `tablist`s (design §3.1): the three groups, and the active group's own
 * sub-tabs. A group's label can equal one of its own sub-tabs' (`wear`'s "Trang phục" names both the
 * group and the `outfit` tab), so a bare `getByRole('tab', { name })` is ambiguous the moment that
 * group is active — this scopes each click to the right `tablist` by its `aria-label`, the same way
 * `CategoryNav.test.tsx` does. Passing no `tabLabel` lands on the group's first tab (its default).
 */
const GROUP_LABEL = viNormal.wardrobe.groups
async function goTo(user: UserEvent, group: keyof typeof GROUP_LABEL, tabLabel?: string): Promise<void> {
  const groupList = screen.getByRole('tablist', { name: viNormal.wardrobe.title })
  await user.click(within(groupList).getByRole('tab', { name: GROUP_LABEL[group] }))
  if (tabLabel === undefined) return
  const subList = screen.getByRole('tablist', { name: GROUP_LABEL[group] })
  // Every sub-tab carries an "n/m" count in its own accessible name (`CategoryNav`'s `.tabCount`), so a
  // caller's bare label only ever matches as a prefix.
  await user.click(within(subList).getByRole('tab', { name: new RegExp(`^${tabLabel}`) }))
}

/** No11a (design §3.1 item 3): the box that also lists what the account does not own yet. Unticked whenever the
 * wardrobe opens; a test about a locked card ticks it first. */
const showLockedBox = (): HTMLElement => screen.getByRole('checkbox', { name: viNormal.wardrobe.showLocked })

/** The wardrobe has loaded: its page title is drawn only once the five reads have answered (the loading and the
 * failure states draw a line of their own instead). */
const opened = (): Promise<HTMLElement> => screen.findByRole('heading', { name: viNormal.wardrobe.title, level: 1 })

/** The hair colour tab's red swatch, owned. A prefix, since a worn card's accessible name gains ", Đang dùng". */
const redSwatch = (): HTMLElement => screen.getByRole('button', { name: new RegExp(`^${viNormal.items.haircolor_red01}, `) })

/** One click to dirty the draft: the red hair colour, from Màu tóc (the wardrobe opens on Kiểu tóc since Plan 19). */
async function pickRedHair(user: UserEvent): Promise<void> {
  await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
  await user.click(redSwatch())
}

/** The Nữ | Nam switch heading the look group (spec §6.1): a `Segmented`, so a `group` of two pressed-or-not buttons,
 * named "Giới tính" — scoped to it, since "Nữ" is also the wearing list's first value. */
const genderButton = (gender: Gender): HTMLElement =>
  within(screen.getByRole('group', { name: viNormal.wardrobe.gender.legend })).getByRole('button', { name: viNormal.wardrobe.gender[gender] })

/** A card in the open tab by its item's name: "<name>, <rarity>[, …]" (design §7). */
const card = (name: string): HTMLElement => within(screen.getByRole('tabpanel')).getByRole('button', { name: new RegExp(`^${name}, `) })

/** The open tab's card names, in order (the part of each accessible name before its first comma). A card's pick button
 * only: a colour dot sits in its own `group` and, when it is not owned, is named "<name>, Chưa có: <hint>" too. Only a
 * group inside the panel counts — one the panel itself sits in would otherwise hide every card. */
const cardNames = (): string[] => {
  const panel = screen.getByRole('tabpanel')
  return within(panel)
    .getAllByRole('button', { name: /,/ })
    .filter((each) => !panel.contains(each.closest('[role="group"]')))
    .map((each) => each.getAttribute('aria-label')!.split(',')[0]!)
}

/** The stage's own figure: the first `Chibi` on the screen (the left column comes before the cards). */
const stage = (): HTMLElement => document.querySelector('[data-chibi-hash]') as HTMLElement
const sourcesIn = (root: Element): string[] => [...root.querySelectorAll('img')].map((img) => img.getAttribute('src') ?? '')

describe('WardrobeScreen', () => {
  // Re-homed from the inventory screen's own test when the inventory folded into the wardrobe (No5): the wardrobe
  // reads what the account owns from the same `inventory` call, so a failure of it is the wardrobe's to report.
  it('says so when the wardrobe cannot be read, and asks again when told to', async () => {
    const inventory = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(INVENTORY)
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory }))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.inventory.error)
    expect(viNormal.inventory.error).toBe('Không tải được phòng thay đồ')

    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByRole('heading', { name: viNormal.wardrobe.title, level: 1 })).toBeInTheDocument()
    expect(inventory).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).toBeNull()
  })

  // Plan 27 E2: the stage and the cards need the inventory, the two catalogues and the achievements a locked card's hint
  // names (in the first group, so a hint never changes its words under the player); the saved outfits come in after,
  // without holding the screen up.
  it('draws the stage and the cards before the saved outfits answer', async () => {
    let answerOutfits: (value: { outfits: (OutfitDto | null)[] }) => void = () => {}
    const outfits = vi.fn(() => new Promise((resolve) => (answerOutfits = resolve)))
    const catalogAchievements = vi.fn().mockResolvedValue({ achievements: ACHIEVEMENTS })
    renderScreen(stubApi({ outfits, catalogAchievements } as Partial<NormalApi>))

    await opened()
    expect(stage()).not.toBeNull()
    expect(card(viNormal.items.hair_f_bob01)).toBeInTheDocument()
    // Asked at once, alongside the other four — only the drawing waits less.
    expect(outfits).toHaveBeenCalledTimes(1)
    expect(catalogAchievements).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('heading', { name: viNormal.outfits.title })).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()

    answerOutfits({ outfits: noOutfits })
    expect(await screen.findByRole('heading', { name: viNormal.outfits.title })).toBeInTheDocument()
  })

  it('waits for the achievements before drawing the cards, so a locked card’s hint is worded once', async () => {
    let answerAchievements: (value: { achievements: AchievementDefDto[] }) => void = () => {}
    const catalogAchievements = vi.fn(() => new Promise((resolve) => (answerAchievements = resolve)))
    renderScreen(stubApi({ catalogAchievements } as Partial<NormalApi>))

    expect(await screen.findByRole('status')).toHaveTextContent(viNormal.screens.loading)
    expect(stage()).toBeNull()
    answerAchievements({ achievements: ACHIEVEMENTS })
    await opened()
  })

  it('does not ask for the saved outfits again on "Thử lại" while they are still on their way', async () => {
    const inventory = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue(INVENTORY)
    const outfits = vi.fn(() => new Promise<never>(() => undefined))
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory, outfits } as Partial<NormalApi>))

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.inventory.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    await waitFor(() => expect(inventory).toHaveBeenCalledTimes(2))
    expect(outfits).toHaveBeenCalledTimes(1)
  })

  it('says so when the saved outfits cannot be read, and asks again only for them', async () => {
    const outfits = vi.fn().mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'nope')).mockResolvedValue({ outfits: noOutfits })
    const api = stubApi({ outfits })
    const user = userEvent.setup()
    renderScreen(api)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.inventory.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByRole('heading', { name: viNormal.outfits.title })).toBeInTheDocument()
    expect(outfits).toHaveBeenCalledTimes(2)
    expect(api.inventory).toHaveBeenCalledTimes(1)
  })

  // Plan 19 (avatar v4, spec §6.1): the base tab is gone. The look group opens on Kiểu tóc, under the Nữ | Nam switch,
  // and the wearing list's first row says which body the figure is drawn on.
  it('opens on Kiểu tóc under the Nữ | Nam switch, with Giới tính: Nữ first in Đang dùng', async () => {
    renderScreen()
    await opened()

    const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.look })
    expect(within(subList).getAllByRole('tab').map((tab) => tab.id)).toEqual(['hairStyle', 'hairColor', 'skinColor', 'eyeColor'].map((id) => `wardrobe-subtab-${id}`))
    expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })).toHaveAttribute('aria-selected', 'true')
    // Not a tab: a group of two buttons, Nữ pressed.
    expect(genderButton('f')).toHaveAttribute('aria-pressed', 'true')
    expect(genderButton('m')).toHaveAttribute('aria-pressed', 'false')
    expect(card(viNormal.items.hair_f_bob01)).toHaveAttribute('aria-pressed', 'true')
    const [first] = screen.getAllByRole('listitem')
    expect(first).toHaveTextContent(`${viNormal.wardrobe.gender.legend}${viNormal.wardrobe.gender.f}`)
    expect(screen.queryByRole('tab', { name: 'Nhân vật' })).toBeNull()
  })

  it('keeps the Nữ | Nam switch on every look tab, and only there', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()

    for (const tab of [viNormal.wardrobe.tabs.hairColor, viNormal.wardrobe.tabs.skinColor, viNormal.wardrobe.tabs.eyeColor]) {
      await goTo(user, 'look', tab)
      expect(screen.getByRole('group', { name: viNormal.wardrobe.gender.legend }), tab).toBeInTheDocument()
    }
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    expect(screen.queryByRole('group', { name: viNormal.wardrobe.gender.legend })).toBeNull()
  })

  // Spec §6.2: the hairstyle follows the gender to its counterpart, the outfit to its cut; nothing else changes.
  it('the Nữ | Nam switch swaps the hairstyle to its counterpart and dresses the male cut', async () => {
    const dealerRow = { itemId: 'outfit_dealer01', acquiredAs: 'outfit_dealer01', slot: 'outfit' as const, rarity: 'rare' as const, nameKey: 'items.outfit_dealer01', assetKey: 'outfit/outfit_dealer01', source: 'default' as const, acquiredAt: 0 }
    const dressed: InventoryDto = { items: [...INVENTORY.items, dealerRow], avatar: { ...AVATAR, outfit: 'outfit_dealer01', hairColor: 'haircolor_red01' } }
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(dressed) }))
    await opened()
    expect(sourcesIn(stage()).some((src) => src.includes('item_outfit_dealer01_L40'))).toBe(true)
    const before = stage().getAttribute('data-chibi-hash')

    await user.click(genderButton('m'))

    expect(genderButton('m')).toHaveAttribute('aria-pressed', 'true')
    expect(genderButton('f')).toHaveAttribute('aria-pressed', 'false')
    expect(card(viNormal.items.hair_m_tousled01)).toHaveAttribute('aria-pressed', 'true')
    const drawn = sourcesIn(stage())
    expect(drawn.some((src) => src.includes('item_outfit_dealer01_m_L40')), 'the male cut').toBe(true)
    expect(drawn.some((src) => src.includes('body_m_L30')), 'the male body').toBe(true)
    expect(drawn.some((src) => src.includes('item_hair_m_tousled01_L60')), 'the counterpart hairstyle').toBe(true)
    // The hat stays on.
    expect(drawn.some((src) => src.includes('item_head_beanie01_L80'))).toBe(true)
    expect(stage().getAttribute('data-chibi-hash')).not.toBe(before)
    expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(`${viNormal.wardrobe.gender.legend}${viNormal.wardrobe.gender.m}`)

    // A second press on the pressed button changes nothing.
    await user.click(genderButton('m'))
    expect(card(viNormal.items.hair_m_tousled01)).toHaveAttribute('aria-pressed', 'true')
  })

  it('the Kiểu tóc tab lists only the current gender’s hairstyles', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()

    const names = (ids: readonly string[]): string[] => ids.map((id) => viNormal.items[id as keyof typeof viNormal.items])
    expect(cardNames()).toEqual(names(FEMALE_HAIRS))
    const tab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })
    expect(tab).toHaveTextContent('4/4')

    await user.click(genderButton('m'))

    expect(cardNames()).toEqual(names(MALE_HAIRS))
    expect(tab).toHaveTextContent('4/4')
    // The box adds nothing of the other gender.
    await user.click(showLockedBox())
    expect(cardNames()).toEqual(names(MALE_HAIRS))
  })

  it('picks a hairstyle with a click, and a second click on the worn one keeps it on', async () => {
    const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, hairStyle: 'hair_f_ponytail01' } })
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await opened()

    await user.click(card(viNormal.items.hair_f_ponytail01))
    expect(card(viNormal.items.hair_f_ponytail01)).toHaveAttribute('aria-pressed', 'true')
    expect(card(viNormal.items.hair_f_bob01)).toHaveAttribute('aria-pressed', 'false')
    expect(sourcesIn(stage()).some((src) => src.includes('item_hair_f_ponytail01_L60'))).toBe(true)

    // Required, like the outfit: a figure always wears a hairstyle.
    await user.click(card(viNormal.items.hair_f_ponytail01))
    expect(card(viNormal.items.hair_f_ponytail01)).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ hairStyle: 'hair_f_ponytail01' })))
  })

  // Pre-flight #20: a hat that hides the front hair would make every portrait the same; the portrait is the hairstyle in
  // the draft's colours and gender, and nothing else.
  it('a hairstyle card’s portrait leaves the worn hat off', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await pickRedHair(user)
    await goTo(user, 'look', viNormal.wardrobe.tabs.hairStyle)

    expect(sourcesIn(stage()).some((src) => src.includes('item_head_beanie01_L80')), 'the stage wears the hat').toBe(true)
    const items = new Map(CATALOG.map((row) => [row.id, row]))
    const bodies = new Map(AVATAR_CATALOG.bodies.map((body) => [body.gender, body]))
    for (const id of FEMALE_HAIRS) {
      const portrait = card(viNormal.items[id as keyof typeof viNormal.items]).querySelector('[data-chibi-hash]') as HTMLElement
      expect(portrait, id).not.toBeNull()
      expect(portrait).toHaveAttribute('data-frame', 'head')
      const drawn = sourcesIn(portrait)
      expect(drawn.some((src) => src.includes('item_head_beanie01_L80')), `${id}: no hat`).toBe(false)
      expect(drawn.some((src) => src.includes(`item_${id}_L60`)), `${id}: its own hairstyle`).toBe(true)
      expect(drawn.some((src) => src.includes('body_f_L30')), `${id}: the draft's body`).toBe(true)
      // Exactly the draft's look with this hairstyle: the red hair colour in, the hat out.
      const expected = chibiFromApi({ v: 4, gender: 'f', hairStyle: id, outfit: 'outfit_casual01', hairColor: 'haircolor_red01' }, items, bodies)!
      expect(portrait).toHaveAttribute('data-chibi-hash', hashChibi(expected))
    }
  })

  // A6 review: the portrait is the draft's look — its skin tone too, the saved one and one just picked.
  it('a hairstyle card’s portrait carries the draft’s skin tone', async () => {
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue({ ...INVENTORY, avatar: { ...AVATAR, skinColor: 'skin_deep01' } }) }))
    await opened()

    const items = new Map(CATALOG.map((row) => [row.id, row]))
    const bodies = new Map(AVATAR_CATALOG.bodies.map((body) => [body.gender, body]))
    const expectPortraits = (skinColor: string): void => {
      for (const id of FEMALE_HAIRS) {
        const portrait = card(viNormal.items[id as keyof typeof viNormal.items]).querySelector('[data-chibi-hash]') as HTMLElement
        const withSkin = chibiFromApi({ v: 4, gender: 'f', hairStyle: id, outfit: 'outfit_casual01', skinColor }, items, bodies)!
        const without = chibiFromApi({ v: 4, gender: 'f', hairStyle: id, outfit: 'outfit_casual01' }, items, bodies)!
        expect(portrait, `${id} in ${skinColor}`).toHaveAttribute('data-chibi-hash', hashChibi(withSkin))
        expect(hashChibi(withSkin), 'the skin tone is part of the hash').not.toBe(hashChibi(without))
      }
    }
    // The saved skin tone…
    expectPortraits('skin_deep01')

    // …and one picked in the draft.
    await goTo(user, 'look', viNormal.wardrobe.tabs.skinColor)
    await user.click(card(viNormal.items.skin_porcelain01))
    await goTo(user, 'look', viNormal.wardrobe.tabs.hairStyle)
    expectPortraits('skin_porcelain01')
  })

  it('the Màu da tab equips a skin colour, and Tự nhiên takes it off', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    const before = stage().getAttribute('data-chibi-hash')

    await goTo(user, 'look', viNormal.wardrobe.tabs.skinColor)

    const panel = within(screen.getByRole('tabpanel'))
    const natural = panel.getByRole('button', { name: viNormal.wardrobe.natural })
    expect(natural).toHaveAttribute('aria-pressed', 'true')
    // "Tự nhiên" is the body's own cream, filled in — not the checker the hair and eye tabs draw.
    expect((natural.querySelector('span[style]') as HTMLElement).style.background).toBe('rgb(251, 224, 202)')
    // Then the tones, in catalogue order.
    expect(cardNames()).toEqual([viNormal.items.skin_porcelain01, viNormal.items.skin_deep01])

    await user.click(card(viNormal.items.skin_deep01))

    expect(card(viNormal.items.skin_deep01)).toHaveAttribute('aria-pressed', 'true')
    expect(natural).toHaveAttribute('aria-pressed', 'false')
    expect(stage().getAttribute('data-chibi-hash')).not.toBe(before)
    expect(screen.getAllByRole('listitem')[2]).toHaveTextContent(`${viNormal.wardrobe.tabs.skinColor}${viNormal.items.skin_deep01}`)

    await user.click(natural)

    expect(natural).toHaveAttribute('aria-pressed', 'true')
    expect(stage().getAttribute('data-chibi-hash')).toBe(before)
    expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
  })

  it('Đang dùng lists Giới tính, Kiểu tóc, Màu da, Màu tóc and Màu mắt first', async () => {
    renderScreen()
    await opened()

    const rows = screen.getAllByRole('listitem').slice(0, 6)
    expect(rows.map((row) => row.textContent)).toEqual([
      `${viNormal.wardrobe.gender.legend}${viNormal.wardrobe.gender.f}`,
      `${viNormal.wardrobe.tabs.hairStyle}${viNormal.items.hair_f_bob01}`,
      `${viNormal.wardrobe.tabs.skinColor}${viNormal.wardrobe.natural}`,
      `${viNormal.wardrobe.tabs.hairColor}${viNormal.wardrobe.natural}`,
      `${viNormal.wardrobe.tabs.eyeColor}${viNormal.wardrobe.natural}`,
      // …then the items, as before.
      `${viNormal.wardrobe.tabs.head}${viNormal.items.head_beanie01}×`,
    ])
  })

  it('Hoàn tác brings the gender back', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    const before = stage().getAttribute('data-chibi-hash')

    await user.click(genderButton('m'))
    expect(card(viNormal.items.hair_m_tousled01)).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.undo }))

    expect(genderButton('f')).toHaveAttribute('aria-pressed', 'true')
    expect(card(viNormal.items.hair_f_bob01)).toHaveAttribute('aria-pressed', 'true')
    expect(cardNames()).toEqual(FEMALE_HAIRS.map((id) => viNormal.items[id as keyof typeof viNormal.items]))
    expect(stage().getAttribute('data-chibi-hash')).toBe(before)
    expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
  })

  it('saving after a gender change sends gender and hairStyle together', async () => {
    const male: AvatarConfigDto = { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01', head: 'head_beanie01' }
    const setAvatar = vi.fn().mockResolvedValue({ config: male })
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await opened()

    await user.click(genderButton('m'))
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(male))
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
    expect(genderButton('m')).toHaveAttribute('aria-pressed', 'true')
  })

  describe('on a phone', () => {
    // jsdom has no `matchMedia`; this one answers the phone query (`PHONE_QUERY`) and nothing else.
    beforeEach(() => {
      vi.stubGlobal('matchMedia', (query: string) => ({
        matches: query === '(max-width: 767px)',
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }))
    })
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('counts gender, hairstyle and outfit in the Đang dùng summary, with every optional slot filled', async () => {
      const withSkin: InventoryDto = { ...INVENTORY, avatar: { ...AVATAR, skinColor: 'skin_deep01' } }
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(withSkin) }))
      await opened()

      // Giới tính, Kiểu tóc, Quần áo, plus the hat and the skin tone.
      expect(screen.getByText(viNormal.wardrobe.equipped.count.replace('{{n}}', '5'))).toBeInTheDocument()
    })

    it('draws the hairstyle portraits 72 px wide (96 px on a wider screen)', async () => {
      renderScreen()
      await opened()

      const portrait = card(viNormal.items.hair_f_bob01).querySelector('[data-chibi-hash]') as HTMLElement
      expect(portrait.style.width).toBe('72px')
    })
  })

  it('draws the hairstyle portraits 96 px wide off a phone', async () => {
    renderScreen()
    await opened()

    const portrait = card(viNormal.items.hair_f_bob01).querySelector('[data-chibi-hash]') as HTMLElement
    expect(portrait.style.width).toBe('96px')
  })

  it('draws the preview from the body of the saved gender and its hairstyle', async () => {
    renderScreen()
    await opened()

    const stage = document.querySelector('[data-chibi-hash]') as HTMLElement
    const sources = [...stage.querySelectorAll('img')].map((img) => img.getAttribute('src'))
    expect(sources.some((src) => src?.includes('body_f_L30'))).toBe(true)
    expect(sources.some((src) => src?.includes('item_hair_f_bob01_L60'))).toBe(true)
  })

  it('marks a draft dirty when only the gender differs', () => {
    // The wardrobe compares a draft with what is saved key by key (`sameConfig`): `v`, `gender`, then every slot —
    // the hairstyle and the skin colour among them. A gender switch alone must read as a change to save.
    expect(sameConfig(AVATAR, { ...AVATAR })).toBe(true)
    expect(sameConfig(AVATAR, { ...AVATAR, gender: 'm' })).toBe(false)
    expect(sameConfig(AVATAR, { ...AVATAR, hairStyle: 'hair_m_tousled01' })).toBe(false)
    expect(sameConfig(AVATAR, { ...AVATAR, skinColor: 'skin_deep01' })).toBe(false)
  })

  it('switches tabs on click', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()

    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    expect(screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default equipped head.
    expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
  })

  it('draws a head tile as the item icon, not as a figure wearing it', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const tile = screen.getByText(viNormal.items.head_tophat01).closest('button') as HTMLElement
    const icon = tile.querySelector('img')
    expect(icon).not.toBeNull()
    // Named after the layer (`item_head_tophat01_L80`) without its `_L80`, at both densities, from the asset base.
    expect(icon).toHaveAttribute('src', '/avatar/item_head_tophat01_icon@1x.png')
    expect(icon).toHaveAttribute('srcset', '/avatar/item_head_tophat01_icon@1x.png 1x, /avatar/item_head_tophat01_icon@2x.png 2x')
    expect(icon).toHaveAttribute('alt', '')
    expect(tile.querySelectorAll('img')).toHaveLength(1)
    expect(tile.querySelector('[data-chibi-hash]')).toBeNull()
  })

  it('draws a gendered outfit’s tile in the cut of the draft’s gender', async () => {
    // 2026-09-20: one item, two cuts. The tile has to show the cut the figure on the stage beside it is wearing — since
    // v4, the cut of the draft's gender (it was the base's `wear`).
    const male: AvatarConfigDto = { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_casual01' }
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue({ ...INVENTORY, avatar: male }) }))
    await opened()

    // The dealer uniform is not owned: the box lists it.
    await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
    await user.click(showLockedBox())

    const icon = screen.getByText(viNormal.items.outfit_dealer01).closest('button')!.querySelector('img')
    expect(icon).toHaveAttribute('src', '/avatar/item_outfit_dealer01_m_icon@1x.png')
    expect(icon).toHaveAttribute('srcset', '/avatar/item_outfit_dealer01_m_icon@1x.png 1x, /avatar/item_outfit_dealer01_m_icon@2x.png 2x')
    // An item with no cut for this gender is untouched: the tuxedo is one layer for everybody.
    const tuxedo = screen.getByText(viNormal.items.outfit_tuxedo01).closest('button')!.querySelector('img')
    expect(tuxedo).toHaveAttribute('src', '/avatar/item_outfit_tuxedo01_icon@1x.png')
  })

  it('draws a gendered outfit’s tile in the shared cut for gender f', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
    await user.click(showLockedBox())

    const icon = screen.getByText(viNormal.items.outfit_dealer01).closest('button')!.querySelector('img')
    expect(icon).toHaveAttribute('src', '/avatar/item_outfit_dealer01_icon@1x.png')
  })

  it('locks an unowned tile, and a click on it does not equip anything', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const locked = screen.getByText(viNormal.items.head_tophat01).closest('button')
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(locked).toHaveAttribute('aria-pressed', 'false')

    await user.click(locked as HTMLElement)

    expect(locked).toHaveAttribute('aria-pressed', 'false')
    // The locked tile names how it could be earned — here, the achievement that rewards it.
    expect(within(locked as HTMLElement).getByText(viNormal.achievements.login_days_100.name)).toBeInTheDocument()
  })

  it('names the check-in month on a locked tile the schedule hands out', async () => {
    // No achievement here rewards the top hat, so the schedule's line is the one that shows (spec 2026-10-12 §4.4).
    const user = userEvent.setup()
    renderScreen(
      stubApi({
        catalogItems: vi.fn().mockResolvedValue({ items: CATALOG, dailyGifts: [{ itemId: 'head_tophat01', day: 28, month: '2026-11' }] }),
        catalogAchievements: vi.fn().mockResolvedValue({ achievements: [] }),
      }),
    )
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
    await user.click(showLockedBox())

    const locked = screen.getByText(viNormal.items.head_tophat01).closest('button') as HTMLElement
    expect(locked).toHaveAttribute('aria-disabled', 'true')
    expect(within(locked).getByText('Quà điểm danh ngày 28 tháng 11/2026')).toBeInTheDocument()
  })

  it('equips an owned tile, and a second click on the equipped one unequips it', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default
    // equipped head.
    const panel = within(screen.getByRole('tabpanel'))
    const owned = panel.getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
    expect(owned).toHaveAttribute('aria-pressed', 'true')

    await user.click(owned)

    expect(owned).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows no false "unsaved changes" after unequipping and re-equipping the same slot, key order and all', async () => {
    // `sameConfig` used to compare drafts via `JSON.stringify`, which is sensitive to *key order* — and
    // `withSlot`'s `{ ...config, [slot]: itemId }` always appends a re-added key at the *end* of the
    // object, wherever it used to sit. Two optional slots (`head`, then `hairColor`) are what expose the
    // reorder: unequipping `head` and equipping it again moves it from before `hairColor` to after it, so
    // a config with the exact same slots and values as the saved one used to still read as "changed".
    const withHairColor: AvatarConfigDto = { ...AVATAR, hairColor: 'haircolor_red01' }
    const user = userEvent.setup()
    renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue({ ...INVENTORY, avatar: withHairColor }) }))
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

    // Scoped to the tile grid: "Mũ len" is also the wearing-list row's value, since it is the default
    // equipped head.
    const owned = within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
    await user.click(owned)
    expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

    await user.click(owned)

    expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
  })

  it('cannot unequip the required outfit — a second click on it stays equipped', async () => {
    const user = userEvent.setup()
    renderScreen()
    await opened()
    await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)

    // Scoped to the tile grid: "Bộ thường ngày" is also the wearing-list row's value, since it is the
    // default equipped outfit.
    const panel = within(screen.getByRole('tabpanel'))
    const equipped = panel.getByText(viNormal.items.outfit_casual01).closest('button') as HTMLElement
    expect(equipped).toHaveAttribute('aria-pressed', 'true')

    await user.click(equipped)

    expect(equipped).toHaveAttribute('aria-pressed', 'true')
  })

  it('sends the v4 draft to setAvatar on save', async () => {
    const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, hairColor: 'haircolor_red01' } })
    const user = userEvent.setup()
    renderScreen(stubApi({ setAvatar }))
    await opened()

    await pickRedHair(user)
    await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

    await waitFor(() =>
      expect(setAvatar).toHaveBeenCalledWith({
        v: 4,
        gender: 'f',
        hairStyle: 'hair_f_bob01',
        outfit: 'outfit_casual01',
        head: 'head_beanie01',
        hairColor: 'haircolor_red01',
      }),
    )
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
  })

  // The saved-outfit portraits' own behaviour (menu, save/overwrite/rename/delete, empty-slot save) now
  // lives entirely in `SavedOutfits.test.tsx` — this is only the wiring: `WardrobeScreen` passes the
  // right props through and reacts to `onApplied` by pushing the config into the draft and showing
  // "saved", same as a direct `save()` (design §5.3, §3.1 item 4).
  it('wires the saved-outfit portraits in: applying one updates the draft and shows the saved notice', async () => {
    const outfitOne: OutfitDto = { slot: 1, name: 'Đi làm', config: { v: 4, gender: 'm', hairStyle: 'hair_m_tousled01', outfit: 'outfit_tuxedo01' }, updatedAt: 0 }
    const applyOutfit = vi.fn().mockResolvedValue({ config: outfitOne.config })
    const user = userEvent.setup()
    renderScreen(stubApi({ outfits: vi.fn().mockResolvedValue({ outfits: [outfitOne, null, null, null, null] }), applyOutfit }))
    await opened()

    await user.click(screen.getByRole('button', { name: viNormal.outfits.menu.replace('{{name}}', 'Đi làm') }))
    await user.click(screen.getByRole('button', { name: viNormal.outfits.apply }))

    await waitFor(() => expect(applyOutfit).toHaveBeenCalledWith(1))
    expect(await screen.findByText(viNormal.wardrobe.saved)).toBeInTheDocument()
  })

  // BP-30 (spec K6 §3.2, P13): the stage cheers when an item or a colour goes on, and at nothing else.
  describe('the live stage', () => {
    /** Counts each time the stage's figure starts a cheer: its `data-reacting` turning to "cheer". The figure's root is
     * one element for the whole visit (a pick changes its layers, not the root), so one observer sees every cheer. */
    function countCheers(root: HTMLElement): { readonly count: number; stop: () => void } {
      let count = 0
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.oldValue !== 'cheer' && root.getAttribute('data-reacting') === 'cheer') count += 1
        }
      })
      observer.observe(root, { attributes: true, attributeFilter: ['data-reacting'], attributeOldValue: true })
      return {
        get count() {
          return count
        },
        stop: () => observer.disconnect(),
      }
    }

    /** Runs `ms` of the fake clock, inside `act`. */
    const advance = (ms: number): void => {
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }
    /** The cheer's sparkle ring on the stage: the decorative span holding six marks (the kit's class name is hashed). */
    const sparkleRing = (): Element | undefined =>
      [...document.querySelectorAll('span[aria-hidden="true"]')].find((el) => el.querySelectorAll(':scope > i').length === 6)

    it('picking an item cheers the stage once; switching a tab does not', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderScreen()
        await opened()
        const figure = stage()
        expect(figure).toHaveAttribute('data-live', 'idle')
        expect(figure).not.toHaveAttribute('data-reacting')
        const cheers = countCheers(figure)

        await user.click(card(viNormal.items.hair_f_ponytail01))
        expect(stage()).toBe(figure)
        expect(figure).toHaveAttribute('data-reacting', 'cheer')
        expect(cheers.count).toBe(1)

        // The cheer runs its 1.2 s and ends; a tab change after it starts nothing.
        advance(CHIBI_LIFE.cheerFaceMs + 50)
        expect(figure).not.toHaveAttribute('data-reacting')
        await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
        await goTo(user, 'look', viNormal.wardrobe.tabs.hairStyle)
        expect(figure).not.toHaveAttribute('data-reacting')
        expect(cheers.count).toBe(1)

        // The next pick is the next cheer.
        await user.click(card(viNormal.items.hair_f_hime01))
        expect(figure).toHaveAttribute('data-reacting', 'cheer')
        expect(cheers.count).toBe(2)
        cheers.stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it('a second pick inside the first one’s cheer starts the cheer and its sparkles over', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      try {
        const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
        renderScreen()
        await opened()
        const figure = stage()
        const cheers = countCheers(figure)

        await user.click(card(viNormal.items.hair_f_ponytail01))
        expect(figure).toHaveAttribute('data-reacting', 'cheer')
        const first = sparkleRing()
        expect(first).toBeDefined()
        advance(CHIBI_LIFE.cheerFaceMs / 2)

        await user.click(card(viNormal.items.hair_f_hime01))
        // A new ring, its fade from the start.
        expect(sparkleRing()).toBeDefined()
        expect(sparkleRing()).not.toBe(first)
        // Past the end of the first cheer, the second is still under way…
        advance(CHIBI_LIFE.cheerFaceMs / 2 + 50)
        expect(figure).toHaveAttribute('data-reacting', 'cheer')
        // …until its own 1.2 s are up. `data-reacting` never left "cheer", so the observer saw one start.
        advance(CHIBI_LIFE.cheerFaceMs)
        expect(figure).not.toHaveAttribute('data-reacting')
        expect(cheers.count).toBe(1)
        cheers.stop()
      } finally {
        vi.useRealTimers()
      }
    })

    it('switching the gender, and Hoàn tác, do not cheer', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      const figure = stage()
      const cheers = countCheers(figure)

      await user.click(genderButton('m'))
      expect(genderButton('m')).toHaveAttribute('aria-pressed', 'true')
      expect(figure).not.toHaveAttribute('data-reacting')

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.undo }))
      expect(genderButton('f')).toHaveAttribute('aria-pressed', 'true')
      expect(stage()).not.toHaveAttribute('data-reacting')
      expect(cheers.count).toBe(0)
      cheers.stop()
    })

    it('taking an item off does not cheer', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      const cheers = countCheers(stage())
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

      // The worn beanie, clicked again: off it comes, and the draft is dirty — but nothing went on.
      const beanie = within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01).closest('button') as HTMLElement
      await user.click(beanie)
      expect(beanie).toHaveAttribute('aria-pressed', 'false')
      expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

      expect(stage()).not.toHaveAttribute('data-reacting')
      expect(cheers.count).toBe(0)
      cheers.stop()
    })

    it('a colour pick cheers', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      const cheers = countCheers(stage())

      await pickRedHair(user)

      expect(stage()).toHaveAttribute('data-reacting', 'cheer')
      expect(cheers.count).toBe(1)
      cheers.stop()
    })
  })

  describe('colour tabs (Plan 13)', () => {
    it('lists a Natural swatch plus owned and locked colour swatches in the hair colour tab', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)

      // A card's accessible name is "<name>, <rarity>[, wearing|, locked: <hint>]" (design §7) — the redesign's
      // `cardLabel`, not the bare item name Plan 13 queried by.
      const lockedName = `${viNormal.items.haircolor_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.filter.locked}: ${viNormal.wardrobe.hint.daily.rare}`
      // No11a: by default only "Tự nhiên" and the owned swatches; the box adds the locked ones.
      expect(screen.getByRole('button', { name: viNormal.wardrobe.natural })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: lockedName })).toBeNull()

      await user.click(showLockedBox())

      expect(screen.getByRole('button', { name: viNormal.wardrobe.natural })).toBeInTheDocument()
      const owned = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })
      expect(owned).toHaveAttribute('aria-disabled', 'false')
      const locked = screen.getByRole('button', { name: lockedName })
      expect(locked).toHaveAttribute('aria-disabled', 'true')
    })

    it('a click on a locked swatch does not equip anything', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      await user.click(showLockedBox())

      const locked = screen.getByRole('button', {
        name: `${viNormal.items.haircolor_blue01}, ${viNormal.inventory.rarity.rare}, ${viNormal.wardrobe.filter.locked}: ${viNormal.wardrobe.hint.daily.rare}`,
      })
      await user.click(locked)

      expect(locked).toHaveAttribute('aria-pressed', 'false')
    })

    it('picks an owned hair colour, changes the preview hash, sends it to setAvatar, and Natural clears it back', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, hairColor: 'haircolor_red01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await opened()
      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      const before = chibi.getAttribute('data-chibi-hash')

      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      const natural = screen.getByRole('button', { name: viNormal.wardrobe.natural })
      expect(natural).toHaveAttribute('aria-pressed', 'true')

      const red = screen.getByRole('button', { name: `${viNormal.items.haircolor_red01}, ${viNormal.inventory.rarity.common}` })
      await user.click(red)

      expect(red).toHaveAttribute('aria-pressed', 'true')
      expect(natural).toHaveAttribute('aria-pressed', 'false')
      expect(chibi.getAttribute('data-chibi-hash')).not.toBe(before)

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ hairColor: 'haircolor_red01' })))

      await user.click(natural)

      expect(natural).toHaveAttribute('aria-pressed', 'true')
      expect(red).toHaveAttribute('aria-pressed', 'false')
    })

    // Final fix wave (B2): ticking the box only adds cards and dots. It used to turn this card — the owned blue beret —
    // into the locked original.
    it('with the box ticked, keeps the beret card on the owned blue variant and adds the locked members as dots — equips a variant by its dot, and never lists a variant as its own card', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, head: 'head_beret_blue01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      const rare = viNormal.inventory.rarity.rare
      const panel = within(screen.getByRole('tabpanel'))
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${rare}` })
      // Plan 20 (T3): the original's hint line belongs to the ticked box — unticked, the original is not on the screen at all.
      const originalHint = new RegExp(`^${viNormal.items.head_beret_red01}: `)
      expect(panel.queryByText(originalHint)).toBeNull()

      await user.click(showLockedBox())

      // The same card, still the blue beret the player owns: not the locked original, and no card of the original's.
      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${rare}`)
      expect(card).toHaveAttribute('aria-disabled', 'false')
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      expect(panel.queryByText(viNormal.items.head_beret_red01)).toBeNull()
      const cardCount = cardNames().length

      // Plan 20 (T3): the owned variant's card hides the original's own lock line, so the original's hint is written out
      // on the card (touch has no tooltip), outside the pick button — "<original name>: <hint>".
      const hint = viNormal.wardrobe.hint.daily.rare
      const hintLine = panel.getByText(`${viNormal.items.head_beret_red01}: ${hint}`)
      expect(hintLine).toBeVisible()
      expect(card).not.toContainElement(hintLine)
      expect(card, 'the pick button says nothing of it').toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${rare}`)

      // No8a: the dot row is the whole family, the original first, each dot titled with its member's name; the box adds
      // the two the player does not own, locked — and a locked dot says how to get it, as its card would ("Chưa có: …").
      const locked = (name: string) => `${name}, ${viNormal.wardrobe.filter.locked}: ${hint}`
      const row = panel.getByRole('group', { name: viNormal.items.head_beret_red01 })
      expect(within(row).getAllByRole('button').map((each) => each.getAttribute('title'))).toEqual([
        locked(viNormal.items.head_beret_red01),
        viNormal.items.head_beret_blue01,
        locked(viNormal.items.head_beret_green01),
      ])
      expect(within(row).getByRole('button', { name: locked(viNormal.items.head_beret_red01) })).toHaveAttribute('aria-disabled', 'true')
      const dot = within(row).getByRole('button', { name: viNormal.items.head_beret_blue01 })
      expect(dot).toHaveAttribute('aria-disabled', 'false')
      const green = within(row).getByRole('button', { name: locked(viNormal.items.head_beret_green01) })
      expect(green).toHaveAttribute('aria-disabled', 'true')

      await user.click(green)
      expect(card, 'a locked dot equips nothing').toHaveAttribute('aria-pressed', 'false')

      await user.click(dot)
      expect(dot).toHaveAttribute('aria-pressed', 'true')
      // No8a: the card follows the variant now worn — its name, owned, worn, its own colour — and is still one card.
      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_blue01}, ${rare}, ${viNormal.wardrobe.wearingBadge}`)
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      expect(cardNames()).toHaveLength(cardCount)

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ head: 'head_beret_blue01' })))
    })

    it('with the box ticked, a family the player owns nothing of shows its locked original with its own lock line, and no second hint line', async () => {
      // Plan 20, final wave: the "<original name>: <hint>" line is for a card that shows another member. The top hat is
      // a family of one the player does not own, so its card is the original, and its own lock line already says how.
      const user = userEvent.setup()
      renderScreen()
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      await user.click(showLockedBox())
      const panel = within(screen.getByRole('tabpanel'))
      const hint = viNormal.achievements.login_days_100.name
      const card = panel.getByRole('button', { name: `${viNormal.items.head_tophat01}, ${viNormal.inventory.rarity.epic}, ${viNormal.wardrobe.filter.locked}: ${hint}` })
      expect(card).toHaveAttribute('aria-disabled', 'true')
      expect(within(card).getByText(hint), 'the card’s own lock line').toBeVisible()
      expect(panel.queryByText(new RegExp(`^${viNormal.items.head_tophat01}: `)), 'no family hint line').toBeNull()
      expect(panel.getAllByText(hint), 'the hint once, on the card').toHaveLength(1)
    })

    it('with the box unticked, a family whose original is not owned shows its first owned variant — named, owned, a click equips it — and hides the dots not owned', async () => {
      // No11a, pre-flight amendment 5: the beret's original (`head_beret_red01`) is not owned, its blue variant is.
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, head: 'head_beret_blue01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      expect(showLockedBox()).not.toBeChecked()

      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.queryByText(viNormal.items.head_beret_red01)).toBeNull()
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${viNormal.inventory.rarity.rare}` })
      expect(card).toHaveAttribute('aria-disabled', 'false')
      expect(card).toHaveAttribute('aria-pressed', 'false')
      // Drawn in its own colour (No8a).
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      // The dots not owned are hidden — the original's and the green one's — which leaves the shown variant alone, and a
      // row of one dot repeating the card is no row at all (No8a).
      expect(panel.queryByRole('group', { name: viNormal.items.head_beret_red01 })).toBeNull()
      expect(panel.queryByRole('button', { name: viNormal.items.head_beret_green01 })).toBeNull()

      await user.click(card)
      expect(card).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ head: 'head_beret_blue01' })))
    })

    it('follows the family member being worn: the original’s untinted dot puts the original back, and a second press on the worn card takes it off', async () => {
      // Review 2026-09-29, No8a (Plan 18, pre-flight amendment 1): both the original and the blue variant are owned, the
      // blue one is worn.
      const withBothBerets: InventoryDto = {
        items: [
          ...INVENTORY.items,
          { itemId: 'head_beret_red01', acquiredAs: 'head_beret_red01', slot: 'head', rarity: 'rare', nameKey: 'items.head_beret_red01', assetKey: 'head/head_beret_red01', source: 'default', acquiredAt: 0 },
        ],
        avatar: { ...AVATAR, head: 'head_beret_blue01' },
      }
      const user = userEvent.setup()
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(withBothBerets) }))
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

      const panel = within(screen.getByRole('tabpanel'))
      const rare = viNormal.inventory.rarity.rare
      const wearing = viNormal.wardrobe.wearingBadge
      const card = panel.getByRole('button', { name: `${viNormal.items.head_beret_blue01}, ${rare}, ${wearing}` })
      expect(card).toHaveAttribute('aria-pressed', 'true')
      expect(within(card).getByText(wearing)).toBeInTheDocument()
      expect(card.querySelector('img')).toHaveAttribute('src', 'blob:http://localhost/#3f6fd8')
      const row = panel.getByRole('group', { name: viNormal.items.head_beret_red01 })
      const [original, blue] = within(row).getAllByRole('button')
      expect(original).toHaveAccessibleName(viNormal.items.head_beret_red01)
      expect(original).toHaveAttribute('aria-pressed', 'false')
      expect(blue).toHaveAccessibleName(viNormal.items.head_beret_blue01)
      expect(blue).toHaveAttribute('aria-pressed', 'true')

      await user.click(original!)

      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_red01}, ${rare}, ${wearing}`)
      expect(original).toHaveAttribute('aria-pressed', 'true')
      expect(blue).toHaveAttribute('aria-pressed', 'false')
      // The original is drawn as it is, from its plain two-density icon.
      expect(card.querySelector('img')).toHaveAttribute('src', '/avatar/item_head_beret_red01_icon@1x.png')

      // Mũ is optional: a second press on the worn card takes it off, and the card stays the (owned) original.
      await user.click(card)

      expect(card).toHaveAccessibleName(`${viNormal.items.head_beret_red01}, ${rare}`)
      expect(card).toHaveAttribute('aria-pressed', 'false')
      expect(original).toHaveAttribute('aria-pressed', 'false')

      // Plan 20 (T3): with the box ticked the original is owned, so there is nothing to explain — no hint line — while the
      // green variant, which is not owned, still carries its hint on its dot.
      await user.click(showLockedBox())
      expect(panel.queryByText(new RegExp(`^${viNormal.items.head_beret_red01}: `))).toBeNull()
      const green = within(row).getByRole('button', {
        name: `${viNormal.items.head_beret_green01}, ${viNormal.wardrobe.filter.locked}: ${viNormal.wardrobe.hint.daily.rare}`,
      })
      expect(green).toHaveAttribute('aria-disabled', 'true')
    })

    // Final fix wave (B1): the outfit slot is required, so a press on the worn tee keeps it on — the original's dot is
    // the one way back to "Bộ thường ngày", and it has to say so.
    it('takes a coloured outfit back to the original by the original’s dot, named after it', async () => {
      const OUTFIT_CASUAL_RED = item({
        id: 'outfit_casual_red01',
        slot: 'outfit',
        rarity: 'common',
        asset: { layer: 40, file: 'item_outfit_casual01_L40', fitsAvatarCrop: false, tint: '#c0392b', tintMeanL: 0.5 },
      })
      const wearingTheTee: InventoryDto = {
        items: [
          ...INVENTORY.items,
          { itemId: 'outfit_casual_red01', acquiredAs: 'outfit_casual_red01', slot: 'outfit', rarity: 'common', nameKey: 'items.outfit_casual_red01', assetKey: 'outfit/outfit_casual_red01', source: 'default', acquiredAt: 0 },
        ],
        avatar: { ...AVATAR, outfit: 'outfit_casual_red01' },
      }
      const setAvatar = vi.fn().mockResolvedValue({ config: AVATAR })
      const user = userEvent.setup()
      renderScreen(
        stubApi({ catalogItems: vi.fn().mockResolvedValue({ items: [...CATALOG, OUTFIT_CASUAL_RED] }), inventory: vi.fn().mockResolvedValue(wearingTheTee), setAvatar }),
      )
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)

      const panel = within(screen.getByRole('tabpanel'))
      const common = viNormal.inventory.rarity.common
      const wearing = viNormal.wardrobe.wearingBadge
      const card = panel.getByRole('button', { name: `${viNormal.items.outfit_casual_red01}, ${common}, ${wearing}` })
      // Required: pressing the worn tee leaves it on.
      await user.click(card)
      expect(card).toHaveAttribute('aria-pressed', 'true')

      const row = panel.getByRole('group', { name: viNormal.items.outfit_casual01 })
      const original = within(row).getByRole('button', { name: viNormal.items.outfit_casual01 })
      expect(original, 'titled for a pointer too').toHaveAttribute('title', viNormal.items.outfit_casual01)
      expect(original).toHaveAttribute('aria-pressed', 'false')
      expect(original).toHaveAttribute('aria-disabled', 'false')

      await user.click(original)

      expect(original).toHaveAttribute('aria-pressed', 'true')
      expect(card).toHaveAccessibleName(`${viNormal.items.outfit_casual01}, ${common}, ${wearing}`)
      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(setAvatar).toHaveBeenCalledWith(expect.objectContaining({ outfit: 'outfit_casual01' })))
    })
  })

  describe('header (design §3.1): dirty label, undo', () => {
    it('shows the dirty label only while the draft differs from the saved config, and clears it on save', async () => {
      const setAvatar = vi.fn().mockResolvedValue({ config: { ...AVATAR, hairColor: 'haircolor_red01' } })
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await opened()
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()

      await pickRedHair(user)
      expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))

      await waitFor(() => expect(setAvatar).toHaveBeenCalled())
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
    })

    it('undoes a change without calling the server, restoring the preview hash and clearing the dirty label', async () => {
      const setAvatar = vi.fn()
      const user = userEvent.setup()
      renderScreen(stubApi({ setAvatar }))
      await opened()
      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      const before = chibi.getAttribute('data-chibi-hash')
      const undoButton = screen.getByRole('button', { name: viNormal.wardrobe.undo })
      expect(undoButton).toBeDisabled()

      await pickRedHair(user)
      expect(chibi.getAttribute('data-chibi-hash')).not.toBe(before)
      expect(undoButton).toBeEnabled()

      await user.click(undoButton)

      expect(chibi.getAttribute('data-chibi-hash')).toBe(before)
      expect(undoButton).toBeDisabled()
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
      expect(setAvatar).not.toHaveBeenCalled()
    })
  })

  /** Plan 27 (P22): `#/avatar?item=<id>`, the shop's "Mặc" on an owned card. */
  describe('initialItem', () => {
    it('opens the item’s tab and puts it on the draft, unsaved, for "Lưu trang phục" to keep', async () => {
      const user = userEvent.setup()
      const api = stubApi()
      renderWithI18n(<WardrobeScreen api={api} playerId="p1" initialItem="head_beret_blue01" />, makeI18n('vi'))
      await opened()

      const subList = await screen.findByRole('tablist', { name: viNormal.wardrobe.groups.wear })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
      expect(card(viNormal.items.head_beret_blue01)).toHaveAttribute('aria-pressed', 'true')
      expect(screen.getByText(viNormal.wardrobe.dirty)).toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.save }))
      await waitFor(() => expect(api.setAvatar).toHaveBeenCalledWith({ ...AVATAR, head: 'head_beret_blue01' }))
    })

    it('opens the tab of an item the player does not own without wearing it', async () => {
      renderWithI18n(<WardrobeScreen api={stubApi()} playerId="p1" initialItem="head_tophat01" />, makeI18n('vi'))
      await opened()

      const subList = await screen.findByRole('tablist', { name: viNormal.wardrobe.groups.wear })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
    })

    it('ignores an id the catalogue does not know', async () => {
      renderWithI18n(<WardrobeScreen api={stubApi()} playerId="p1" initialItem="hat_from_the_future" />, makeI18n('vi'))
      await opened()

      const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.look })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })).toHaveAttribute('aria-selected', 'true')
      expect(screen.queryByText(viNormal.wardrobe.dirty)).toBeNull()
    })
  })

  describe('CategoryNav wiring (design §3.1, §5.5)', () => {
    it('jumps to a slot’s group and tab when its wearing-list row is clicked', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      // "Mũ" (head) is rendered once at this point — the wearing-list row — since the default group,
      // "look", does not show the "wear" group's own sub-tabs yet.
      await user.click(screen.getByText(viNormal.wardrobe.tabs.head).closest('button') as HTMLElement)

      const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.wear })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })).toHaveAttribute('aria-selected', 'true')
      // Scoped to the tile grid: "Mũ len" is also the wearing-list row just clicked.
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.head_beanie01)).toBeInTheDocument()
    })

    // Review 2026-09-29, No11a (design §3.1 item 3, §5.5): owned items by default, one box for the rest. Acceptance
    // row 66.19 cites this title.
    it('lists only what the account owns by default, and the box shows the rest', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      // The box is on the tab the wardrobe opens on, and unticked.
      expect(showLockedBox()).not.toBeChecked()

      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      expect(showLockedBox()).not.toBeChecked()
      // Owned: the beanie, and the beret family through its blue variant. Not owned: the top hat.
      expect(cardNames()).toEqual([viNormal.items.head_beanie01, viNormal.items.head_beret_blue01])
      expect(screen.queryByText(viNormal.items.head_tophat01)).toBeNull()

      await user.click(showLockedBox())

      expect(showLockedBox()).toBeChecked()
      // The box only adds: the beret family is still the blue beret the account owns (final fix wave, B2).
      expect(cardNames()).toEqual([viNormal.items.head_beanie01, viNormal.items.head_beret_blue01, viNormal.items.head_tophat01])
      const tophat = screen.getByText(viNormal.items.head_tophat01).closest('button')
      expect(tophat).toHaveAttribute('aria-disabled', 'true')

      await user.click(showLockedBox())

      expect(showLockedBox()).not.toBeChecked()
      expect(screen.queryByText(viNormal.items.head_tophat01)).toBeNull()
    })

    it('keeps the box ticked or unticked across tab changes — a jump from the wearing list included', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()
      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)

      await user.click(showLockedBox())
      expect(screen.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()

      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
      expect(showLockedBox()).toBeChecked()
      expect(within(screen.getByRole('tabpanel')).getByText(viNormal.items.outfit_tuxedo01)).toBeInTheDocument()

      // Through the hair colour tab, another group, and back by the wearing list's "Mũ" row.
      await goTo(user, 'look', viNormal.wardrobe.tabs.hairColor)
      expect(showLockedBox()).toBeChecked()
      await user.click(screen.getByText(viNormal.wardrobe.tabs.head).closest('button') as HTMLElement)
      expect(showLockedBox()).toBeChecked()
      expect(screen.getByText(viNormal.items.head_tophat01)).toBeInTheDocument()

      await user.click(showLockedBox())
      await goTo(user, 'wear', viNormal.wardrobe.tabs.outfit)
      expect(showLockedBox()).not.toBeChecked()
      expect(within(screen.getByRole('tabpanel')).queryByText(viNormal.items.outfit_tuxedo01)).toBeNull()
    })

    it('replaces the grid with one line, inside the same tabpanel, on a tab where nothing is owned', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      await goTo(user, 'wear', viNormal.wardrobe.tabs.face)

      const faceTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.face}`) })
      const panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', faceTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', faceTab.id)
      const line = within(panel).getByText(viNormal.wardrobe.emptyOwned)
      expect(line.tagName).toBe('P')
      expect(within(panel).queryAllByRole('button')).toHaveLength(0)
      // Nothing in it to Tab to, so the panel takes the focus itself (the ARIA tabs pattern).
      expect(panel).toHaveAttribute('tabindex', '0')

      await user.click(showLockedBox())

      // The same panel, now holding the grid: the locked sunglasses card, and no line.
      expect(screen.getByRole('tabpanel')).toBe(panel)
      expect(within(panel).queryByText(viNormal.wardrobe.emptyOwned)).toBeNull()
      expect(panel, 'its cards take the focus now').not.toHaveAttribute('tabindex')
      expect(within(panel).getByText(viNormal.items.face_sunglasses01).closest('button')).toHaveAttribute('aria-disabled', 'true')
    })

    // No11a on Kiểu tóc: every hairstyle is free, so this only happens to an account the catalogue has outgrown — but
    // the box and the empty line work there as on every tab.
    it('on Kiểu tóc with no hairstyle of the gender owned, says so in one line, and the box lists them locked', async () => {
      const user = userEvent.setup()
      const bare: InventoryDto = { ...INVENTORY, items: INVENTORY.items.filter((row) => row.slot !== 'hairStyle') }
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(bare) }))
      await opened()

      const panel = screen.getByRole('tabpanel')
      expect(within(panel).getByText(viNormal.wardrobe.emptyOwned)).toBeInTheDocument()
      expect(panel).toHaveAttribute('tabindex', '0')
      expect(screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })).toHaveTextContent('0/4')

      await user.click(showLockedBox())

      expect(screen.getByRole('tabpanel')).toBe(panel)
      expect(within(panel).queryByText(viNormal.wardrobe.emptyOwned)).toBeNull()
      expect(cardNames()).toEqual(FEMALE_HAIRS.map((id) => viNormal.items[id as keyof typeof viNormal.items]))
      expect(card(viNormal.items.hair_f_hime01)).toHaveAttribute('aria-disabled', 'true')
    })

    it('swaps the stage to the framed head portrait on the frame tab', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      await goTo(user, 'decor', viNormal.wardrobe.tabs.frame)

      const chibi = document.querySelector('[data-chibi-hash]') as HTMLElement
      expect(chibi).toHaveAttribute('data-frame', 'head')
    })

    it('draws the words tab (title/badge) as one tabpanel wrapping both headings and grids, correctly labelled', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)
      // Neither word is owned (pre-flight amendment 2): the box lists them.
      await user.click(showLockedBox())

      // Two `ItemTab` calls (title, badge) used to each draw their own `role="tabpanel"`, with the heading
      // sitting outside either one — exactly one tabpanel, wrapping both headings and both grids, is the fix.
      const panels = screen.getAllByRole('tabpanel')
      expect(panels).toHaveLength(1)
      const panel = within(panels[0]!)
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.titles })).toBeInTheDocument()
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.badges })).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.title_rookie)).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.badge_bronze)).toBeInTheDocument()

      // The panel and its tab name each other (design §7): the tab's `aria-controls` is the panel's own
      // `id`, and the panel's `aria-labelledby` is the tab's own `id`.
      const wordsTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.words}`) })
      expect(wordsTab.id).not.toBe('')
      expect(panels[0]).toHaveAttribute('id', wordsTab.getAttribute('aria-controls'))
      expect(panels[0]).toHaveAttribute('aria-labelledby', wordsTab.id)
    })

    it('on the words tab with the box unticked, hides a heading with nothing owned under it, and says so once inside the panel when neither has anything', async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)

      const panels = screen.getAllByRole('tabpanel')
      expect(panels).toHaveLength(1)
      const wordsTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.words}`) })
      expect(panels[0]).toHaveAttribute('id', wordsTab.getAttribute('aria-controls'))
      expect(panels[0]).toHaveAttribute('aria-labelledby', wordsTab.id)
      const panel = within(panels[0]!)
      expect(panel.queryByRole('heading')).toBeNull()
      expect(panel.getAllByText(viNormal.wardrobe.emptyOwned)).toHaveLength(1)
      expect(panel.queryAllByRole('button')).toHaveLength(0)
      expect(panels[0], 'the panel takes the focus, having nothing else to give it').toHaveAttribute('tabindex', '0')
    })

    it('on the words tab, an owned badge alone shows the badge heading and its card — no title heading, no empty line', async () => {
      const user = userEvent.setup()
      const withBadge: InventoryDto = {
        ...INVENTORY,
        items: [
          ...INVENTORY.items,
          { itemId: 'badge_bronze', acquiredAs: 'badge_bronze', slot: 'badge', rarity: 'common', nameKey: 'items.badge_bronze', assetKey: 'badge/badge_bronze', source: 'default', acquiredAt: 0 },
        ],
      }
      renderScreen(stubApi({ inventory: vi.fn().mockResolvedValue(withBadge) }))
      await opened()

      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)

      const panel = within(screen.getByRole('tabpanel'))
      expect(panel.queryByRole('heading', { name: viNormal.wardrobe.words.titles })).toBeNull()
      expect(panel.getByRole('heading', { name: viNormal.wardrobe.words.badges })).toBeInTheDocument()
      expect(panel.getByText(viNormal.items.badge_bronze).closest('button')).toHaveAttribute('aria-disabled', 'false')
      expect(panel.queryByText(viNormal.items.title_rookie)).toBeNull()
      expect(panel.queryByText(viNormal.wardrobe.emptyOwned)).toBeNull()
      expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex')
    })

    it('gives every tab a roving tabindex: only the selected one sits in the page Tab order', async () => {
      renderScreen()
      await opened()

      const groupList = screen.getByRole('tablist', { name: viNormal.wardrobe.title })
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.look })).toHaveAttribute('tabindex', '0')
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.wear })).toHaveAttribute('tabindex', '-1')
      expect(within(groupList).getByRole('tab', { name: viNormal.wardrobe.groups.decor })).toHaveAttribute('tabindex', '-1')

      const subList = screen.getByRole('tablist', { name: viNormal.wardrobe.groups.look })
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })).toHaveAttribute('tabindex', '0')
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairColor}`) })).toHaveAttribute('tabindex', '-1')
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.skinColor}`) })).toHaveAttribute('tabindex', '-1')
      expect(within(subList).getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.eyeColor}`) })).toHaveAttribute('tabindex', '-1')
    })

    it("every sub-tab's aria-controls names its own panel's id, for every one of the four panel shapes", async () => {
      const user = userEvent.setup()
      renderScreen()
      await opened()

      // `hairStyle` (`HairStyleTab`) is the tab this screen opens on — no navigation needed for it.
      const styleTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.hairStyle}`) })
      let panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', styleTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', styleTab.id)

      // `ColourTab`, for the skin tone as for the hair colour.
      for (const label of [viNormal.wardrobe.tabs.hairColor, viNormal.wardrobe.tabs.skinColor]) {
        await goTo(user, 'look', label)
        const colourTab = screen.getByRole('tab', { name: new RegExp(`^${label}`) })
        panel = screen.getByRole('tabpanel')
        expect(panel).toHaveAttribute('id', colourTab.getAttribute('aria-controls'))
        expect(panel).toHaveAttribute('aria-labelledby', colourTab.id)
      }

      await goTo(user, 'wear', viNormal.wardrobe.tabs.head)
      const headTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.head}`) })
      panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', headTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', headTab.id)

      // `words` — the one panel two `ItemTab` calls share, the last of the four shapes.
      await goTo(user, 'decor', viNormal.wardrobe.tabs.words)
      const wordsTab = screen.getByRole('tab', { name: new RegExp(`^${viNormal.wardrobe.tabs.words}`) })
      panel = screen.getByRole('tabpanel')
      expect(panel).toHaveAttribute('id', wordsTab.getAttribute('aria-controls'))
      expect(panel).toHaveAttribute('aria-labelledby', wordsTab.id)
    })
  })

  describe('leaving with unsaved changes', () => {
    // The guard is document-level (any `#/…` link anywhere counts, matching how every route in the app is
    // reached), so a plain link stands in for the rail here rather than mounting the whole app shell.
    const renderWithLink = () =>
      renderWithI18n(
        <>
          <a href="#/profile">profile link</a>
          <WardrobeScreen api={stubApi()} playerId="p1" />
        </>,
        makeI18n('vi'),
      )

    it('asks before leaving a dirty draft, and does not navigate until the player says so', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await opened()

      await pickRedHair(user) // dirties the draft
      expect(redSwatch()).toHaveAttribute('aria-pressed', 'true')

      await user.click(screen.getByRole('link', { name: 'profile link' }))

      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(screen.getByText(viNormal.wardrobe.leaveBody)).toBeInTheDocument()
      // The click was intercepted before the browser acted on it.
      expect(window.location.hash).toBe('#/wardrobe')
    })

    it('stays on the wardrobe, draft intact, when the player chooses to stay', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await opened()
      await pickRedHair(user)
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveStay }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/wardrobe')
      expect(redSwatch()).toHaveAttribute('aria-pressed', 'true')
    })

    it('navigates away and drops the draft when the player chooses to discard it', async () => {
      const user = userEvent.setup()
      window.location.hash = '#/wardrobe'
      renderWithLink()
      await opened()
      await pickRedHair(user)
      await user.click(screen.getByRole('link', { name: 'profile link' }))

      await user.click(screen.getByRole('button', { name: viNormal.wardrobe.leaveDiscard }))

      expect(screen.queryByRole('dialog')).toBeNull()
      expect(window.location.hash).toBe('#/profile')
    })
  })
})
