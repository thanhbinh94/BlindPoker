import { useTintedLayer } from '@bp/ui-kit'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, type AvatarConfigDto, type BodyDto, type Gender, type ItemDto, type NormalApi, type WelcomeStatusDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../test-i18n.js'
import { WelcomeDialog } from './WelcomeDialog.js'

vi.mock('@bp/ui-kit', async (importOriginal) => ({ ...(await importOriginal<typeof import('@bp/ui-kit')>()), useTintedLayer: vi.fn() }))
beforeEach(() => {
  vi.mocked(useTintedLayer).mockReturnValue(null)
})

const EXPRESSIONS = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep'] as const
const facesOf = (g: Gender): Record<string, string> => Object.fromEntries(EXPRESSIONS.map((e) => [e, `body_${g}_face_${e}_L50`]))
const BODY_F: BodyDto = { gender: 'f', body: 'body_f_L30', faces: facesOf('f'), naturalEyeColour: '#2e6a9b' }

const drawn = (id: string, slot: ItemDto['slot'], rarity: ItemDto['rarity'], layer: number, patch: Partial<ItemDto> = {}): ItemDto => ({
  id,
  slot,
  rarity,
  nameKey: `items.${id}`,
  assetKey: `${slot}/${id}`,
  isDefault: false,
  asset: { layer, file: `item_${id}_L${layer}`, fitsAvatarCrop: true },
  ...patch,
})

const HAIR_BOB = drawn('hair_f_bob01', 'hairStyle', 'common', 60, {
  gender: 'f',
  free: true,
  asset: { layer: 60, file: 'item_hair_f_bob01_L60', back: 'item_hair_f_bob01_L20', fitsAvatarCrop: true },
})
const OUTFIT_CASUAL = drawn('outfit_casual01', 'outfit', 'common', 40, { isDefault: true })
const OUTFIT_DEALER = drawn('outfit_dealer01', 'outfit', 'rare', 40)
const OUTFIT_TET = drawn('outfit_tet_red01', 'outfit', 'rare', 40)
const HEAD_HAT = drawn('head_conical_hat01', 'head', 'rare', 80)

const ITEMS = new Map([HAIR_BOB, OUTFIT_CASUAL, OUTFIT_DEALER, OUTFIT_TET, HEAD_HAT].map((item) => [item.id, item]))
const BODIES = new Map([[BODY_F.gender, BODY_F]])
const AVATAR: AvatarConfigDto = { v: 4, gender: 'f', hairStyle: 'hair_f_bob01', outfit: 'outfit_casual01' }

const CHOICES = ['outfit_dealer01', 'outfit_tet_red01', 'head_conical_hat01']
const statusWith = (owned: string[] = [], claimed = false): WelcomeStatusDto => ({
  claimed,
  choices: CHOICES.map((itemId) => ({ itemId, owned: owned.includes(itemId) })),
})

const CLAIM = { ok: true as const, itemId: 'outfit_dealer01', reputation: 100, rank: 2, rankUp: true }

function stubApi(overrides: Partial<NormalApi> = {}): NormalApi {
  return {
    welcome: vi.fn().mockResolvedValue(statusWith()),
    welcomeClaim: vi.fn().mockResolvedValue(CLAIM),
    ...overrides,
  } as unknown as NormalApi
}

interface Harness {
  api: NormalApi
  status?: WelcomeStatusDto
  onClaimed?: () => void
}

/** The lobby's part, cut down: the dialog while open, and the gift button that stays until the gift is taken. */
function Lobby({ api, status = statusWith(), onClaimed = vi.fn() }: Harness) {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        gift
      </button>
      {open ? (
        <WelcomeDialog api={api} lang="vi" status={status} avatar={AVATAR} items={ITEMS} bodies={BODIES} onClaimed={onClaimed} onClose={() => setOpen(false)} />
      ) : null}
    </>
  )
}

const renderDialog = (harness: Harness) => renderWithI18n(<Lobby {...harness} />, makeI18n('vi'))
const dialog = () => screen.getByRole('dialog', { name: viNormal.welcome.title })
const card = (itemId: string) => within(dialog()).getByRole('button', { name: new RegExp(viNormal.items[itemId as keyof typeof viNormal.items]) })
const claimButton = () => within(dialog()).getByRole('button', { name: viNormal.welcome.claim })

describe('WelcomeDialog', () => {
  it('draws the player’s own figure three times, each wearing a different choice', () => {
    renderDialog({ api: stubApi() })

    expect(within(dialog()).getByText(viNormal.welcome.lead)).toBeInTheDocument()
    const hashes = CHOICES.map((id) => card(id).querySelector('[data-chibi-hash]')?.getAttribute('data-chibi-hash'))
    expect(hashes.every((hash) => typeof hash === 'string' && hash.length > 0)).toBe(true)
    expect(new Set(hashes).size).toBe(3)
    for (const id of CHOICES) expect(card(id).querySelector('[data-frame="full"]')).not.toBeNull()
  })

  it('keeps Nhận disabled until a card is picked, then claims that item and says so', async () => {
    const api = stubApi()
    const onClaimed = vi.fn()
    const user = userEvent.setup()
    renderDialog({ api, onClaimed })

    expect(claimButton()).toBeDisabled()
    await user.click(card('outfit_dealer01'))
    expect(card('outfit_dealer01')).toHaveAttribute('aria-pressed', 'true')
    await user.click(claimButton())

    expect(api.welcomeClaim).toHaveBeenCalledWith('outfit_dealer01')
    const done = viNormal.welcome.done.replace('{{item}}', viNormal.items.outfit_dealer01).replace('{{amount}}', '100')
    expect(await within(dialog()).findByText(done)).toBeInTheDocument()
    expect(onClaimed).toHaveBeenCalledTimes(1)
    expect(within(dialog()).getByRole('button', { name: viNormal.welcome.start })).toBeInTheDocument()
    expect(within(dialog()).queryByRole('button', { name: viNormal.welcome.claim })).toBeNull()
  })

  it('disables a choice the player already owns, and marks it', () => {
    renderDialog({ api: stubApi(), status: statusWith(['head_conical_hat01']) })

    expect(card('head_conical_hat01')).toBeDisabled()
    expect(within(card('head_conical_hat01')).getByText(viNormal.welcome.owned)).toBeInTheDocument()
    expect(card('outfit_dealer01')).toBeEnabled()
  })

  it('offers only the reputation when all three are owned, and claims it with no item', async () => {
    const api = stubApi({ welcomeClaim: vi.fn().mockResolvedValue({ ...CLAIM, itemId: null }) })
    const user = userEvent.setup()
    renderDialog({ api, status: statusWith(CHOICES) })

    expect(within(dialog()).queryByRole('button', { name: viNormal.welcome.claim })).toBeNull()
    const only = within(dialog()).getByRole('button', { name: viNormal.welcome.claimReputationOnly.replace('{{amount}}', '100') })
    await user.click(only)

    expect(api.welcomeClaim).toHaveBeenCalledWith(null)
    expect(await within(dialog()).findByText(viNormal.welcome.doneReputationOnly.replace('{{amount}}', '100'))).toBeInTheDocument()
  })

  it('closes on Để sau, claiming nothing, and leaves the lobby’s gift button in place', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderDialog({ api })

    await user.click(within(dialog()).getByRole('button', { name: viNormal.welcome.later }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.welcomeClaim).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'gift' })).toBeInTheDocument()
  })

  it('closes when the server says the gift was already taken, and has the lobby read the status again', async () => {
    const onClaimed = vi.fn()
    const api = stubApi({ welcomeClaim: vi.fn().mockRejectedValue(new ApiError(409, 'WELCOME_CLAIMED', 'taken')) })
    const user = userEvent.setup()
    renderDialog({ api, onClaimed })

    await user.click(card('outfit_tet_red01'))
    await user.click(claimButton())

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(onClaimed).toHaveBeenCalledTimes(1)
  })

  it('reads the choices again when the server says the pick is already owned', async () => {
    const api = stubApi({
      welcomeClaim: vi.fn().mockRejectedValue(new ApiError(409, 'ALREADY_OWNED', 'owned')),
      welcome: vi.fn().mockResolvedValue(statusWith(['outfit_dealer01'])),
    })
    const user = userEvent.setup()
    renderDialog({ api })

    await user.click(card('outfit_dealer01'))
    await user.click(claimButton())

    expect(await within(dialog()).findByText(viNormal.welcome.refusal.ALREADY_OWNED)).toBeInTheDocument()
    expect(api.welcome).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(card('outfit_dealer01')).toBeDisabled())
    expect(claimButton()).toBeDisabled()
  })
})
