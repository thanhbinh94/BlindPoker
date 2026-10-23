import { CHIBI_LIFE, useTintedLayer } from '@bp/ui-kit'
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** The lobby's part, cut down: the dialog while open. The lobby's own gift button is App's business (App.test.tsx). */
function Lobby({ api, status = statusWith(), onClaimed = vi.fn() }: Harness) {
  const [open, setOpen] = useState(true)
  return open ? (
    <WelcomeDialog api={api} lang="vi" status={status} avatar={AVATAR} items={ITEMS} bodies={BODIES} onClaimed={onClaimed} onClose={() => setOpen(false)} />
  ) : null
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
    // The status line is there from the start, empty, so a screen reader is already listening when the claim lands.
    const line = within(dialog()).getByRole('status')
    expect(line).toBeEmptyDOMElement()
    await user.click(card('outfit_dealer01'))
    expect(card('outfit_dealer01')).toHaveAttribute('aria-pressed', 'true')
    await user.click(claimButton())

    expect(api.welcomeClaim).toHaveBeenCalledWith('outfit_dealer01')
    const done = viNormal.welcome.done.replace('{{item}}', viNormal.items.outfit_dealer01).replace('{{amount}}', '100')
    await waitFor(() => expect(within(dialog()).getByRole('status')).toHaveTextContent(done))
    expect(within(dialog()).getByRole('status'), 'the same node, filled in rather than mounted').toBe(line)
    expect(onClaimed).toHaveBeenCalledTimes(1)
    expect(within(dialog()).queryByRole('button', { name: viNormal.welcome.claim })).toBeNull()
    // The button that pressed Nhận is gone: focus moves to Vào chơi rather than falling to the page.
    expect(within(dialog()).getByRole('button', { name: viNormal.welcome.start })).toHaveFocus()
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

  it('announces the reputation the server says the gift pays now, the default only when it says nothing', () => {
    renderDialog({ api: stubApi(), status: { ...statusWith(CHOICES), reputation: 250 } })

    expect(within(dialog()).getByRole('button', { name: viNormal.welcome.claimReputationOnly.replace('{{amount}}', '250') })).toBeInTheDocument()
  })

  it('closes on Để sau, claiming nothing', async () => {
    const api = stubApi()
    const user = userEvent.setup()
    renderDialog({ api })

    await user.click(within(dialog()).getByRole('button', { name: viNormal.welcome.later }))

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(api.welcomeClaim).not.toHaveBeenCalled()
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

  // BP-30 (spec K6 §3.2, R8, P16): the three figures stand still; the card just picked cheers once, on the pick, never
  // on the claim. A cheer lasts `CHIBI_LIFE.cheerFaceMs`, so each test lets one end on fake timers before it looks for
  // the next: no wall-clock wait to flake under load.
  describe('the picked card cheers', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    const setup = (): UserEvent => userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    /** A card's figure: the chibi inside its button (decorative, so found by its hash, not by a role). */
    const figureOf = (itemId: string): HTMLElement => card(itemId).querySelector('[data-chibi-hash]') as HTMLElement
    /** Runs the cheer under way to its end. */
    const cheerEnds = (): void => {
      act(() => {
        vi.advanceTimersByTime(CHIBI_LIFE.cheerFaceMs + 50)
      })
    }

    /** Counts each time a figure starts a cheer: its `data-reacting` turning to "cheer". Records the observer has not
     * delivered yet are taken when the count is read, so it never waits on the observer's microtask. A record holds the
     * old value only: its new value is the next record's old one, or — for the latest — the attribute now. */
    function countCheers(root: HTMLElement): { readonly count: number; stop: () => void } {
      let count = 0
      let latestOld: string | null | undefined
      const step = (old: string | null, next: string | null): void => {
        if (old !== 'cheer' && next === 'cheer') count += 1
      }
      const tally = (records: MutationRecord[]): void => {
        for (const record of records) {
          if (latestOld !== undefined) step(latestOld, record.oldValue)
          latestOld = record.oldValue
        }
      }
      const observer = new MutationObserver(tally)
      observer.observe(root, { attributes: true, attributeFilter: ['data-reacting'], attributeOldValue: true })
      return {
        get count() {
          tally(observer.takeRecords())
          if (latestOld !== undefined) step(latestOld, root.getAttribute('data-reacting'))
          latestOld = undefined
          return count
        },
        stop: () => observer.disconnect(),
      }
    }

    it('picking a card cheers it once; picking it again does not; claiming does not cheer', async () => {
      const api = stubApi()
      const user = setup()
      renderDialog({ api })
      const figure = figureOf('outfit_tet_red01')
      // Still (P7): ready to react, but no breathing and no blinking — three figures at once.
      expect(figure).toHaveAttribute('data-live', 'still')
      expect(figure).toHaveAttribute('data-breathing', 'false')
      expect(figure).not.toHaveAttribute('data-reacting')
      const cheers = countCheers(figure)

      await user.click(card('outfit_tet_red01'))
      expect(figureOf('outfit_tet_red01'), 'the same figure, not a new one').toBe(figure)
      expect(figure).toHaveAttribute('data-reacting', 'cheer')
      expect(cheers.count).toBe(1)
      cheerEnds()
      expect(figure).not.toHaveAttribute('data-reacting')

      // The same card again: it is already the pick, so nothing changes, its mood included.
      await user.click(card('outfit_tet_red01'))
      expect(figure).not.toHaveAttribute('data-reacting')
      expect(cheers.count).toBe(1)

      // Nhận (R8): the card is locked and the dialog is about to close — no cheer for the claim.
      await user.click(claimButton())
      await waitFor(() => expect(api.welcomeClaim).toHaveBeenCalledWith('outfit_tet_red01'))
      await waitFor(() => expect(within(dialog()).getByRole('status')).not.toBeEmptyDOMElement())
      expect(figure).not.toHaveAttribute('data-reacting')
      expect(cheers.count).toBe(1)
      cheers.stop()
    })

    it('the other cards stay still', async () => {
      const user = setup()
      renderDialog({ api: stubApi() })
      const [first, middle, last] = [figureOf('outfit_dealer01'), figureOf('outfit_tet_red01'), figureOf('head_conical_hat01')]
      const others = [countCheers(first), countCheers(last)]
      const picked = countCheers(middle)

      // The cards keep their names — the item's, nothing more: the figure is decorative and no greet button joins in
      // (a button inside the card's button would be invalid, and the card itself is the control).
      for (const id of CHOICES) expect(within(dialog()).getByRole('button', { name: viNormal.items[id as keyof typeof viNormal.items] })).toBe(card(id))
      expect(within(dialog()).queryByRole('button', { name: 'Nhân vật của bạn, bấm để chào' })).toBeNull()
      for (const figure of [first, middle, last]) expect(figure).toHaveAttribute('aria-hidden', 'true')

      await user.click(card('outfit_tet_red01'))
      expect(middle).toHaveAttribute('data-reacting', 'cheer')
      expect(first).not.toHaveAttribute('data-reacting')
      expect(last).not.toHaveAttribute('data-reacting')
      cheerEnds()

      // Another card: that one cheers, and the one left behind does not cheer again.
      await user.click(card('outfit_dealer01'))
      expect(first).toHaveAttribute('data-reacting', 'cheer')
      expect(middle).not.toHaveAttribute('data-reacting')
      cheerEnds()

      expect(others.map((c) => c.count)).toEqual([1, 0])
      expect(picked.count).toBe(1)
      for (const c of [...others, picked]) c.stop()
    })

    it('a pick the server calls stale is dropped without a cheer, and picking that card again cheers again', async () => {
      const api = stubApi({ welcomeClaim: vi.fn().mockRejectedValue(new ApiError(409, 'NOT_A_CHOICE', 'stale')) })
      const user = setup()
      renderDialog({ api })
      const figure = figureOf('outfit_tet_red01')
      const cheers = CHOICES.map((id) => countCheers(figureOf(id)))

      await user.click(card('outfit_tet_red01'))
      expect(cheers.map((c) => c.count)).toEqual([0, 1, 0])
      cheerEnds()

      await user.click(claimButton())
      expect(await within(dialog()).findByText(viNormal.welcome.refusal.NOT_A_CHOICE)).toBeInTheDocument()
      await waitFor(() => expect(api.welcome).toHaveBeenCalledTimes(1))
      // The pick is gone from every card, and its loss is no cause for a cheer.
      for (const id of CHOICES) expect(card(id)).toHaveAttribute('aria-pressed', 'false')
      expect(claimButton()).toBeDisabled()
      expect(figure).not.toHaveAttribute('data-reacting')
      expect(cheers.map((c) => c.count)).toEqual([0, 1, 0])

      // The same card, picked again, is a new pick: it cheers.
      await user.click(card('outfit_tet_red01'))
      expect(figureOf('outfit_tet_red01')).toBe(figure)
      expect(figure).toHaveAttribute('data-reacting', 'cheer')
      expect(cheers.map((c) => c.count)).toEqual([0, 2, 0])
      for (const c of cheers) c.stop()
    })

    it('a second pick inside the first one’s cheer leaves the sparkles on the new pick only', async () => {
      const user = setup()
      renderDialog({ api: stubApi() })
      /** The cheer's sparkle rings: the decorative span holding six marks (the class name is the kit's, hashed). */
      const sparkleRings = (scope: HTMLElement): Element[] =>
        [...scope.querySelectorAll('span[aria-hidden="true"]')].filter((el) => el.querySelectorAll(':scope > i').length === 6)

      await user.click(card('outfit_dealer01'))
      expect(sparkleRings(card('outfit_dealer01'))).toHaveLength(1)
      act(() => {
        vi.advanceTimersByTime(100)
      })
      await user.click(card('outfit_tet_red01'))

      expect(sparkleRings(dialog())).toHaveLength(1)
      expect(sparkleRings(card('outfit_tet_red01'))).toHaveLength(1)
      expect(sparkleRings(card('outfit_dealer01'))).toHaveLength(0)
    })
  })
})
