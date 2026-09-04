import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { I18nextProvider } from 'react-i18next'
import { HandCategory, parseCards, type RoomView } from '@bp/core'
import { createI18n } from '../i18n/index.js'
import type { ClientHand } from '../client/types.js'
import { HandResult } from './HandResult.js'

describe('HandResult', () => {
  it('names the winner, the hand and the payout', () => {
    const room = {
      players: [
        { playerId: 'a', displayName: 'Ann', seat: 0 },
        { playerId: 'b', displayName: 'Bob', seat: 1 },
      ],
    } as unknown as RoomView
    const hand = {
      phase: 'COMPLETE',
      mode: 'holdem',
      seats: [
        { seat: 0, playerId: 'a', displayName: 'Ann' },
        { seat: 1, playerId: 'b', displayName: 'Bob' },
      ],
      result: {
        payouts: [{ seat: 1, amount: 588 }],
        fee: 12,
        showdown: [{ seat: 1, cards: parseCards('Ah Kh'), rank: 0, category: HandCategory.FLUSH, best: parseCards('Ah Kh 9h 5h 2h') }],
        carryOverOut: 0,
        uncalledReturned: null,
        cancelled: false,
        reason: null,
      },
    } as unknown as ClientHand
    render(
      <I18nextProvider i18n={createI18n({ language: 'vi', storage: null })}>
        <HandResult hand={hand} room={room} myPlayerId="a" lang="vi" />
      </I18nextProvider>,
    )
    expect(screen.getByText('Bob')).toBeInTheDocument()
    expect(screen.getByText('Thùng')).toBeInTheDocument()
    expect(screen.getByText(/588/)).toBeInTheDocument()
  })
})
