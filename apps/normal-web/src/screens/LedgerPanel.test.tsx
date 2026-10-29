import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import type { LedgerPageDto } from '../api.js'
import viNormal from '../locales/vi/normal.json'
import { renderWithI18n } from '../test-i18n.js'
import { LedgerPanel } from './LedgerPanel.js'

const PAGE_ONE: LedgerPageDto = {
  entries: [
    { id: 42, amount: 5_880, reason: 'settlement', refId: 'h1', createdAt: Date.UTC(2026, 8, 3, 10, 5) },
    { id: 41, amount: -2_000, reason: 'gm_adjust', refId: null, createdAt: Date.UTC(2026, 8, 3, 9, 55) },
  ],
  nextBefore: 41,
}
const PAGE_TWO: LedgerPageDto = {
  entries: [{ id: 1, amount: 1_000_000, reason: 'starting_balance', refId: null, createdAt: Date.UTC(2026, 0, 15) }],
  nextBefore: null,
}

describe('LedgerPanel', () => {
  it('prints the rows a load stub returns, under the title it is given', async () => {
    const load = vi.fn().mockResolvedValue({ entries: PAGE_ONE.entries, nextBefore: null })
    renderWithI18n(<LedgerPanel load={load} lang="vi" title="Sổ của Bình" />)

    expect(await screen.findByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    expect(screen.getByText(viNormal.ledger.reason.gm_adjust)).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Sổ của Bình' })).toBeInTheDocument()
    expect(load).toHaveBeenCalledWith({ limit: 50 })
    expect(screen.queryByRole('button', { name: viNormal.profile.ledger.loadMore })).toBeNull()
  })

  it('names the six chaos reasons rather than falling back to "Khác"', async () => {
    const reasons = ['chaos_rescue', 'chaos_crit', 'chaos_fortune', 'chaos_to_table', 'chaos_jackpot', 'chaos_dice']
    const entries = reasons.map((reason, i) => ({ id: 10 - i, amount: i < 3 || i === 4 ? 1_000 : -3_000, reason, refId: `k${String(i)}`, createdAt: Date.UTC(2026, 9, 26, 10, i) }))
    renderWithI18n(<LedgerPanel load={vi.fn().mockResolvedValue({ entries, nextBefore: null })} lang="vi" />)

    expect(await screen.findByText('Thẻ cấp cứu')).toBeInTheDocument()
    expect(screen.getByText('Thẻ bạo kích')).toBeInTheDocument()
    expect(screen.getByText('Thẻ thần tài')).toBeInTheDocument()
    expect(screen.getByText('Thẻ hỗn loạn lên bàn')).toBeInTheDocument()
    expect(screen.getByText('Thẻ nổ hũ')).toBeInTheDocument()
    expect(screen.getByText('Thẻ xúc xắc')).toBeInTheDocument()
    expect(screen.queryByText(viNormal.ledger.reason.other)).toBeNull()
  })

  it('pages on the cursor and appends', async () => {
    const load = vi.fn().mockResolvedValueOnce(PAGE_ONE).mockResolvedValue(PAGE_TWO)
    const user = userEvent.setup()
    renderWithI18n(<LedgerPanel load={load} lang="vi" />)
    await screen.findByText(viNormal.ledger.reason.settlement)

    await user.click(screen.getByRole('button', { name: viNormal.profile.ledger.loadMore }))

    expect(await screen.findByText(viNormal.ledger.reason.starting_balance)).toBeInTheDocument()
    expect(load).toHaveBeenLastCalledWith({ limit: 50, before: 41 })
    expect(screen.getByText(viNormal.ledger.reason.settlement)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: viNormal.profile.ledger.loadMore })).toBeNull()
  })

  it('fetches once even when the caller passes a new closure on every render', async () => {
    const inner = vi.fn().mockResolvedValue({ entries: [], nextBefore: null })
    const { rerender, i18n } = renderWithI18n(<LedgerPanel load={(o) => inner(o)} lang="vi" />)
    await screen.findByText(viNormal.profile.ledger.empty)
    rerender(
      <I18nextProvider i18n={i18n}>
        <LedgerPanel load={(o) => inner(o)} lang="vi" />
      </I18nextProvider>,
    )

    expect(inner).toHaveBeenCalledTimes(1)
  })

  it('says it could not load, and retries the first page', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValue(PAGE_TWO)
    const user = userEvent.setup()
    renderWithI18n(<LedgerPanel load={load} lang="vi" />)

    expect(await screen.findByRole('alert')).toHaveTextContent(viNormal.profile.ledger.error)
    await user.click(screen.getByRole('button', { name: viNormal.screens.retry }))

    expect(await screen.findByText(viNormal.ledger.reason.starting_balance)).toBeInTheDocument()
  })
})
