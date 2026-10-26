import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { AckOrError } from '../client/connection.js'
import type { ClientChaosDraft } from '../client/types.js'
import { createI18n } from '../i18n/index.js'
import { ChaosDraft, type ChaosDraftProps } from './ChaosDraft.js'

const ACK: AckOrError = { t: 'ACK', reqId: 'x' }
const REFUSED: AckOrError = { t: 'ERROR', code: 'CHAOS_NO_OFFER', message: 'no', reqId: 'x' }

const OFFER = { offerId: 'o1', cardIds: ['g_swap_all', 'g_shield_3', 'g_rescue'] }
const draft = (patch: Partial<ClientChaosDraft> = {}): ClientChaosDraft => ({ tier: 'gold', deadlineAt: 1_015_000, totalMs: 15_000, offer: OFFER, picked: false, ...patch })

const mount = (patch: Partial<ChaosDraftProps> = {}, lang: 'vi' | 'en' = 'vi') => {
  const onPick = vi.fn<ChaosDraftProps['onPick']>().mockResolvedValue(ACK)
  const props: ChaosDraftProps = { draft: draft(), serverNow: () => 1_000_000, onPick, ...patch }
  const view = render(
    <I18nextProvider i18n={createI18n({ language: lang, storage: null })}>
      <ChaosDraft {...props} />
    </I18nextProvider>,
  )
  return { ...view, onPick }
}

describe('ChaosDraft', () => {
  it('shows the three cards by name and tier, with the one-line text and a 15 s timer', () => {
    mount()
    expect(screen.getByRole('heading', { name: 'Chọn một thẻ Vàng' })).toBeInTheDocument()
    const cards = within(screen.getByRole('group', { name: 'Ba thẻ để chọn' })).getAllByRole('button')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveTextContent('Vàng')
    expect(cards.map((c) => c.querySelector('span:nth-child(2)')?.textContent)).toEqual(['Đổi bài', 'Khiên sắt', 'Cấp cứu vàng'])
    for (const c of cards) expect(c.querySelector('span:nth-child(3)')?.textContent).toMatch(/\S/)
    expect(screen.getByRole('timer')).toHaveTextContent('15')
  })

  it('marks each card and its name for the ops pack, not by a hashed class (data-chaos-card, data-part="name")', () => {
    mount()
    const cards = within(screen.getByRole('group', { name: 'Ba thẻ để chọn' })).getAllByRole('button')
    expect(cards.map((c) => c.getAttribute('data-chaos-card'))).toEqual(OFFER.cardIds)
    expect(cards.map((c) => c.querySelector('[data-part="name"]')?.textContent)).toEqual(['Đổi bài', 'Khiên sắt', 'Cấp cứu vàng'])
  })

  it('draws the ring against the window the GM set, not a fixed 15 s (M2)', () => {
    // 15 s left: a full circle of a 15 s draft, half of a 30 s one.
    const { unmount } = mount({ draft: draft({ totalMs: 15_000 }) })
    expect(screen.getByRole('timer').style.getPropertyValue('--pct')).toBe('100.00%')
    unmount()
    mount({ draft: draft({ totalMs: 30_000 }) })
    expect(screen.getByRole('timer').style.getPropertyValue('--pct')).toBe('50.00%')
  })

  it('names the tier of each card in words, not only in colour', () => {
    mount({ draft: draft({ tier: 'diamond', offer: { offerId: 'o2', cardIds: ['d_pick_3', 'd_luck_5', 'd_mirror'] } }) })
    expect(screen.getByRole('heading', { name: 'Chọn một thẻ Kim cương' })).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b).toHaveTextContent('Kim cương')
  })

  it('takes focus on the first card when the offer lands, and Enter picks it', async () => {
    const { onPick } = mount()
    const [first] = screen.getAllByRole('button')
    expect(first).toHaveFocus()
    await userEvent.keyboard('{Enter}')
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('o1', 'g_swap_all')
  })

  it('a click picks once, and shows the waiting line at once', async () => {
    const { onPick } = mount()
    const [, second] = screen.getAllByRole('button')
    await userEvent.click(second!)
    await userEvent.click(second!)
    await userEvent.click(screen.getAllByRole('button')[2]!)
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith('o1', 'g_shield_3')
    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn — chờ người chơi khác')
    expect(screen.getAllByRole('button').map((b) => b.getAttribute('aria-current'))).toEqual([null, 'true', null])
  })

  it('lets the player choose again when the server refuses the pick', async () => {
    const onPick = vi.fn<ChaosDraftProps['onPick']>().mockResolvedValueOnce(REFUSED).mockResolvedValue(ACK)
    mount({ onPick })
    await userEvent.click(screen.getAllByRole('button')[0]!)
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await userEvent.click(screen.getAllByRole('button')[1]!)
    expect(onPick).toHaveBeenCalledTimes(2)
    expect(onPick).toHaveBeenLastCalledWith('o1', 'g_shield_3')
  })

  it('lets the player choose again when the request itself fails', async () => {
    const onPick = vi.fn<ChaosDraftProps['onPick']>().mockRejectedValueOnce(new Error('socket closed')).mockResolvedValue(ACK)
    mount({ onPick })
    await userEvent.click(screen.getAllByRole('button')[0]!)
    await vi.waitFor(() => expect(screen.queryByRole('status')).toBeNull())
    await userEvent.click(screen.getAllByRole('button')[0]!)
    expect(onPick).toHaveBeenCalledTimes(2)
  })

  it('shows the waiting line and no pick for an offer that is already picked (a reconnect)', async () => {
    const { onPick } = mount({ draft: draft({ picked: true }) })
    expect(screen.getByRole('status')).toHaveTextContent('Đã chọn — chờ người chơi khác')
    for (const b of screen.getAllByRole('button')) expect(b).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getAllByRole('button')[0]!)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('shows a spectator, or a seat with nothing to choose, the countdown and who is being waited on', () => {
    mount({ draft: draft({ offer: null }) })
    expect(screen.getByRole('heading', { name: 'Các tay chơi đang chọn thẻ' })).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByRole('timer')).toBeInTheDocument()
  })

  it('stamps the layout and the frame the panel is drawn for', () => {
    const { container } = mount({ layout: 'stack', frame: 'landscape' })
    const panel = container.querySelector('section')!
    expect(panel).toHaveAttribute('data-layout', 'stack')
    expect(panel).toHaveAttribute('data-frame', 'landscape')
    expect(panel).toHaveAttribute('data-state', 'choosing')
  })

  it('speaks English with the same cards', () => {
    mount({}, 'en')
    expect(screen.getByRole('heading', { name: 'Pick a Gold card' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('Full Swap')
  })
})
