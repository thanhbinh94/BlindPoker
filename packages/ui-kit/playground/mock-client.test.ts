import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMockClient, type MockClient } from './mock-client.js'

// `blindC`: the playground's Poker hỗn loạn table drafts before the first hand, then deals it with the cards in play.
describe('the playground’s chaos table', () => {
  let client: MockClient | null = null
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    client?.stop()
    client = null
    vi.useRealTimers()
  })

  const open = (): MockClient => {
    client = createMockClient('blindC', 4, () => {})
    return client
  }
  const flush = async (ms: number): Promise<void> => {
    await vi.advanceTimersByTimeAsync(ms)
  }

  it('opens a draft with three cards for me and every seat holding nothing yet', async () => {
    const mock = open()
    await flush(0)
    const state = mock.api.state
    expect(state.room?.config.blind?.chaosCycle).toBe(5)
    expect(state.chaos.draft?.offer?.cardIds).toHaveLength(3)
    expect(state.chaos.draft?.picked).toBe(false)
    expect(state.hand).toBeNull()
  })

  it('takes my pick, hands every seat a card, and deals the hand', async () => {
    const mock = open()
    await flush(0)
    const offer = mock.api.state.chaos.draft!.offer!
    expect((await mock.api.pickChaos(offer.offerId, offer.cardIds[1]!)).t).toBe('ACK')
    expect(mock.api.state.chaos.draft?.picked).toBe(true)
    await flush(1_300)
    const state = mock.api.state
    expect(state.chaos.draft).toBeNull()
    expect(Object.keys(state.chaos.seats)).toHaveLength(4)
    // A "Tích lũy" (chaosPoints) is a card that holds nothing: it adds its points. The draw is `Math.random`, so either may come.
    expect(Object.values(state.chaos.seats).every((s) => s.cards.length >= 1 || s.points > 0)).toBe(true)
    expect(state.hand).not.toBeNull()
  })

  it('refuses a card that was not offered, and a pick with no draft open', async () => {
    const mock = open()
    await flush(0)
    const offer = mock.api.state.chaos.draft!.offer!
    expect((await mock.api.pickChaos(offer.offerId, 'not_a_card')).t).toBe('ERROR')
    expect((await mock.api.pickChaos('other', offer.cardIds[0]!)).t).toBe('ERROR')
  })

  it('picks for me when the 15 s run out', async () => {
    const mock = open()
    await flush(0)
    await flush(15_100)
    expect(mock.api.state.chaos.draft).toBeNull()
    expect(mock.api.state.chaos.seats[0]!.cards.length).toBeGreaterThanOrEqual(1)
  })
})
