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
    // a "Tích lũy" card holds nothing and adds points instead; the draw is Math.random
    const mine = mock.api.state.chaos.seats[0]!
    expect(mine.cards.length >= 1 || mine.points > 0).toBe(true)
  })

  // BP-39: the bonus hand and the "Bỏ qua" wait.
  it('refuses a bonus card that is not in my hand, and ignores a skip outside the result wait', async () => {
    const mock = open()
    await flush(0)
    const r = await mock.api.playBonus(12_345)
    expect(r.t === 'ERROR' && r.code).toBe('CHAOS_CANNOT_USE')
    expect((await mock.api.skipResult()).t).toBe('ACK')
    expect(mock.api.state.resultSkips).toBeNull()
  })

  it('the result wait counts my "Bỏ qua" and deals the next hand at once', async () => {
    const mock = open()
    await flush(0)
    await flush(15_100) // the draft runs out and the hand is dealt
    await mock.api.act({ kind: 'fold' })
    await flush(10_000) // the bots play on to the result
    expect(mock.api.state.hand?.phase).toBe('COMPLETE')
    expect(mock.api.state.resultSkips).toEqual({ skipped: 0, total: 1, mine: false })
    expect((await mock.api.skipResult()).t).toBe('ACK')
    // the press wakes the wait: the next round has begun already (its snapshot ends the count), well before the 6 s ran out
    expect(mock.api.state.hand).toBeNull()
    expect(mock.api.state.resultSkips).toBeNull()
  })
})
