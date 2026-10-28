import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLEARANCE_GAP, MIN_CARD, clearanceFor, useSeatClearance } from './seat-clearance.js'

/** A box from its top and bottom edges; the sides do not enter the rule. */
const box = (top: number, bottom: number): DOMRect =>
  ({ top, bottom, left: 0, right: 400, x: 0, y: top, width: 400, height: bottom - top, toJSON: () => ({}) }) as DOMRect

/** The stage of the room's felt: 103 px down the page, 621 px tall (the 1920 × 940 screen with the tray up). */
const stage = box(103, 724)

describe('clearanceFor', () => {
  it('keeps the gap and the card floor the review settled on', () => {
    expect(CLEARANCE_GAP).toBe(8)
    expect(MIN_CARD).toBe(216)
  })

  it('tier 1: with room for the card above the whole seat, the stage stops a gap above the seat', () => {
    // 409 px above the seat (the 1920 × 940 measurement): cards, plate and lines all stay clear
    expect(clearanceFor(stage, box(512, 679), box(581, 629))).toBe(724 - 512 + CLEARANCE_GAP)
  })

  it('tier 2: with room above the plate only, the stage stops a gap above the plate', () => {
    // 200 px above the seat is too little; 260 px above its plate is enough — the card may lie over the hole cards
    expect(clearanceFor(stage, box(303, 470), box(363, 411))).toBe(724 - 363 + CLEARANCE_GAP)
  })

  it('tier 3: with no room above the plate either, the card keeps the whole stage', () => {
    // the 375 × 812 phone: 174 px above the seat, 223 above its plate
    const phone = box(136, 461)
    expect(clearanceFor(phone, box(310, 461), box(359, 407))).toBeNull()
  })

  it('leaves a spectator the whole stage: there is no seat of theirs to clear', () => {
    expect(clearanceFor(stage, null, null)).toBeNull()
  })

  it('takes a tier the moment its room is exactly the card floor, and not a pixel before', () => {
    const exactly = stage.top + MIN_CARD + CLEARANCE_GAP
    expect(clearanceFor(stage, box(exactly, 700), box(exactly + 50, 690))).toBe(stage.bottom - exactly + CLEARANCE_GAP)
    expect(clearanceFor(stage, box(exactly - 1, 700), box(exactly - 1 + 50, 690))).toBe(stage.bottom - (exactly + 49) + CLEARANCE_GAP)
    expect(clearanceFor(stage, box(exactly - 51, 700), box(exactly, 690))).toBe(stage.bottom - exactly + CLEARANCE_GAP)
    expect(clearanceFor(stage, box(exactly - 51, 700), box(exactly - 1, 690))).toBeNull()
  })

  it('falls back to the whole stage when the seat has no plate to measure and no room above it', () => {
    expect(clearanceFor(stage, box(300, 470), null)).toBeNull()
  })

  it('never asks for a negative clearance: a seat below the stage leaves the stage whole', () => {
    // a seat laid out past the stage's foot (a stage scrolled away from it) has nothing to clear on screen
    expect(clearanceFor(stage, box(740, 900), box(800, 850))).toBe(0)
  })
})

/** A stage holding the viewer's own seat, each box pinned to what the test says it is. */
function stageWithSeat(seatTop: number): { stage: HTMLElement; seat: HTMLElement; moveSeat: (top: number) => void } {
  const el = document.createElement('main')
  el.getBoundingClientRect = () => stage
  const seat = document.createElement('div')
  seat.setAttribute('data-me', 'true')
  const plate = document.createElement('div')
  plate.setAttribute('data-plate', '')
  seat.append(plate)
  el.append(seat)
  document.body.append(el)
  let top = seatTop
  seat.getBoundingClientRect = () => box(top, top + 160)
  plate.getBoundingClientRect = () => box(top + 60, top + 108)
  return { stage: el, seat, moveSeat: (next) => (top = next) }
}

/** A `ResizeObserver` the test drives by hand: it records what is observed and fires when told to. */
class FakeObserver {
  static all: FakeObserver[] = []
  observed = new Set<Element>()
  constructor(private readonly callback: ResizeObserverCallback) {
    FakeObserver.all.push(this)
  }
  observe(el: Element): void {
    this.observed.add(el)
  }
  unobserve(el: Element): void {
    this.observed.delete(el)
  }
  disconnect(): void {
    this.observed.clear()
  }
  fire(): void {
    this.callback([], this as unknown as ResizeObserver)
  }
}

describe('useSeatClearance', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeObserver.all = []
    document.body.innerHTML = ''
  })

  it('measures once where there is no ResizeObserver (jsdom), and gives the stage back when it is not active', () => {
    const { stage: el } = stageWithSeat(512)
    const ref = { current: el }
    const hook = renderHook(({ active }) => useSeatClearance(ref, active, 2), { initialProps: { active: true } })
    expect(hook.result.current).toBe(724 - 512 + CLEARANCE_GAP)
    hook.rerender({ active: false })
    expect(hook.result.current).toBeNull()
  })

  it('forgets the last card’s clearance once it is switched off, so the next card never starts from it', () => {
    const { stage: el, moveSeat } = stageWithSeat(512)
    const ref = { current: el }
    const seen: (number | null)[] = []
    const hook = renderHook(
      ({ active }) => {
        const clearance = useSeatClearance(ref, active, 2)
        seen.push(clearance)
        return clearance
      },
      { initialProps: { active: true } },
    )
    const last = 724 - 512 + CLEARANCE_GAP
    expect(hook.result.current).toBe(last)
    hook.rerender({ active: false })
    // the next hand's card: the seat has moved since, and not one render hands out the last card's number
    moveSeat(480)
    seen.length = 0
    hook.rerender({ active: true })
    expect(seen).not.toContain(last)
    expect(hook.result.current).toBe(724 - 480 + CLEARANCE_GAP)
  })

  it('looks for the viewer’s seat again when they take one, or leave it, while the card is up', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const el = document.createElement('main')
    el.getBoundingClientRect = () => stage
    document.body.append(el)
    const ref = { current: el }
    const hook = renderHook(({ seat }) => useSeatClearance(ref, true, seat), { initialProps: { seat: null as number | null } })
    // watching: no seat of theirs on the felt, nothing to clear
    expect(hook.result.current).toBeNull()

    // they sit down: the seat is drawn with its markers, and neither the stage nor anything watched changes size
    const seat = document.createElement('div')
    seat.setAttribute('data-me', 'true')
    seat.getBoundingClientRect = () => box(512, 672)
    el.append(seat)
    hook.rerender({ seat: 2 })
    expect(hook.result.current).toBe(724 - 512 + CLEARANCE_GAP)
    expect(FakeObserver.all.at(-1)!.observed.has(seat)).toBe(true)

    // and stand up again
    seat.remove()
    hook.rerender({ seat: null })
    expect(hook.result.current).toBeNull()
  })

  it('observes nothing while it is not active', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { stage: el } = stageWithSeat(512)
    const hook = renderHook(() => useSeatClearance({ current: el }, false, 2))
    expect(hook.result.current).toBeNull()
    expect(FakeObserver.all).toHaveLength(0)
  })

  it('re-measures when the stage or the seat resizes, and follows a seat element that was replaced', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { stage: el, seat, moveSeat } = stageWithSeat(512)
    const ref = { current: el }
    const hook = renderHook(() => useSeatClearance(ref, true, 2))
    expect(hook.result.current).toBe(724 - 512 + CLEARANCE_GAP)
    const observer = FakeObserver.all[0]!
    expect([...observer.observed]).toEqual([el, seat])

    moveSeat(480)
    act(() => observer.fire())
    expect(hook.result.current).toBe(724 - 480 + CLEARANCE_GAP)

    // A switch between the ring and the stack draws the seat anew: the new element is the one watched from then on.
    const fresh = seat.cloneNode(true) as HTMLElement
    fresh.getBoundingClientRect = () => box(450, 610)
    seat.replaceWith(fresh)
    act(() => observer.fire())
    expect(hook.result.current).toBe(724 - 450 + CLEARANCE_GAP)
    expect(observer.observed.has(fresh)).toBe(true)
    expect(observer.observed.has(seat)).toBe(false)

    hook.unmount()
    expect(observer.observed.size).toBe(0)
  })

  it('re-measures once the fonts land, but not after it has been switched off', async () => {
    let land: () => void = () => {}
    const ready = new Promise<void>((resolve) => (land = resolve))
    vi.stubGlobal('ResizeObserver', undefined)
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } })
    try {
      const { stage: el, moveSeat } = stageWithSeat(512)
      const ref = { current: el }
      const hook = renderHook(({ active }) => useSeatClearance(ref, active, 2), { initialProps: { active: true } })
      moveSeat(480)
      await act(async () => {
        land()
        await ready
      })
      expect(hook.result.current).toBe(724 - 480 + CLEARANCE_GAP)

      // switched off, then on with a fresh wait, then off again before the fonts answer: nothing is measured late
      let later: () => void = () => {}
      const second = new Promise<void>((resolve) => (later = resolve))
      Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: second } })
      hook.rerender({ active: false })
      hook.rerender({ active: true })
      hook.rerender({ active: false })
      const spy = vi.spyOn(el, 'getBoundingClientRect')
      await act(async () => {
        later()
        await second
      })
      expect(spy).not.toHaveBeenCalled()
      expect(hook.result.current).toBeNull()
    } finally {
      delete (document as { fonts?: unknown }).fonts
    }
  })
})

// BP-40: the chaos draft (`{ minRoom: 0, aboveHand: true }`) from the second draft on, when the last hand's fan is still on the
// viewer's seat.
describe('useSeatClearance for the chaos draft (BP-40)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeObserver.all = []
    document.body.innerHTML = ''
  })

  /** What the draft passes (`RoomScreen`), one object so the hook's effect sees the same options each render. */
  const DRAFT = { minRoom: 0, aboveHand: true } as const

  /** The viewer's seat from `seatTop` (plate 60 px lower) with a fan of two cards in `[data-hand]`, its box from `handTop`. */
  function seatWithFan(seatTop: number, handTop: number) {
    const { stage: el, seat } = stageWithSeat(seatTop)
    const hand = document.createElement('div')
    hand.setAttribute('data-hand', '')
    hand.getBoundingClientRect = () => box(handTop, handTop + 90)
    const cards = [document.createElement('div'), document.createElement('div')]
    for (const card of cards) {
      card.getBoundingClientRect = () => box(handTop - 3, handTop + 88)
      hand.append(card)
    }
    seat.prepend(hand)
    return { el, seat, hand, cards }
  }

  it('counts a fan card still flying in from the deck where it will lie, and measures again once it has landed', () => {
    // Upright, the result strip hides the viewer's seat with `display: none`; the draft shows it again, which restarts its cards'
    // deal from the deck. Measured mid-flight, the card near the deck (300 px) put the draft's foot over the board for the
    // whole draft: nothing that a ResizeObserver watches changes size when a transform ends.
    const { el, cards } = seatWithFan(560, 552)
    const ref = { current: el }
    const flying = [{ playState: 'running' }]
    let inFlight = true
    for (const card of cards) {
      Object.assign(card, { getAnimations: () => (inFlight ? flying : []) })
      card.getBoundingClientRect = () => (inFlight ? box(300, 330) : box(549, 640))
    }
    const hook = renderHook(() => useSeatClearance(ref, true, 2, DRAFT))
    // the fan's own box stands where the cards will lie: 724 − 552 + 8, never 724 − 300 + 8
    expect(hook.result.current).toBe(724 - 552 + CLEARANCE_GAP)

    inFlight = false
    act(() => {
      cards[1]!.dispatchEvent(new Event('animationend', { bubbles: true }))
    })
    // landed: the fanned cards' own tops, as a draft with no deal running measures them
    expect(hook.result.current).toBe(724 - 549 + CLEARANCE_GAP)
  })

  it('measures a resting fan the way it always has: the highest card', () => {
    const { el } = seatWithFan(560, 552)
    const ref = { current: el }
    const hook = renderHook(() => useSeatClearance(ref, true, 2, DRAFT))
    expect(hook.result.current).toBe(724 - 549 + CLEARANCE_GAP)
  })

  /** The overlay whose first child is the draft panel: it has to scroll while `overflowAt(clearance)` says so. */
  function overlayWith(overflowAt: (clearance: string) => boolean) {
    const overlay = document.createElement('div')
    const panel = document.createElement('section')
    overlay.append(panel)
    document.body.append(overlay)
    Object.defineProperty(panel, 'clientHeight', { configurable: true, get: () => 120 })
    Object.defineProperty(panel, 'scrollHeight', { configurable: true, get: () => (overflowAt(overlay.dataset.clearance ?? '') ? 160 : 120) })
    return overlay
  }

  it('steps down to the plate, then to the whole stage, while the panel would have to scroll inside', () => {
    // On its side (the landscape frame), the last hand's fan and lines lift the viewer's seat: above them the draft had half
    // its height, the third card cut. It stands above the fan only when the whole panel fits there.
    const { el } = seatWithFan(560, 552)
    const ref = { current: el }
    const overlay = overlayWith((c) => c !== 'null')
    const fit = { current: overlay }
    const hook = renderHook(() => {
      const clearance = useSeatClearance(ref, true, 2, { ...DRAFT, fit })
      overlay.dataset.clearance = String(clearance)
      return clearance
    })
    expect(hook.result.current).toBeNull()
  })

  it('stays above the fan when the panel fits there, and on the plate when it fits only there', () => {
    const { el } = seatWithFan(560, 552)
    const ref = { current: el }
    const above = overlayWith(() => false)
    const aboveOpts = { ...DRAFT, fit: { current: above } }
    const first = renderHook(() => useSeatClearance(ref, true, 2, aboveOpts))
    expect(first.result.current).toBe(724 - 549 + CLEARANCE_GAP)
    first.unmount()

    const plateOnly = String(724 - 620 + CLEARANCE_GAP)
    const overlay = overlayWith((c) => c !== plateOnly && c !== 'null')
    const plateOpts = { ...DRAFT, fit: { current: overlay } }
    const hook = renderHook(() => {
      const clearance = useSeatClearance(ref, true, 2, plateOpts)
      overlay.dataset.clearance = String(clearance)
      return clearance
    })
    // the plate is 60 px under the seat's top (620): the panel lies over the last hand's cards, the plate stays clear
    expect(hook.result.current).toBe(724 - 620 + CLEARANCE_GAP)
  })

  it('starts again from above the fan for the next draft', () => {
    const { el } = seatWithFan(560, 552)
    const ref = { current: el }
    let tight = true
    const overlay = overlayWith((c) => tight && c !== 'null')
    const opts = { ...DRAFT, fit: { current: overlay } }
    const hook = renderHook(
      ({ active }) => {
        const clearance = useSeatClearance(ref, active, 2, opts)
        overlay.dataset.clearance = String(clearance)
        return clearance
      },
      { initialProps: { active: true } },
    )
    expect(hook.result.current).toBeNull()
    hook.rerender({ active: false })
    tight = false
    hook.rerender({ active: true })
    expect(hook.result.current).toBe(724 - 549 + CLEARANCE_GAP)
  })
})
