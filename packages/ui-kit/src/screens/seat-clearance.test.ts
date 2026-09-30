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
    const hook = renderHook(({ active }) => useSeatClearance(ref, active), { initialProps: { active: true } })
    expect(hook.result.current).toBe(724 - 512 + CLEARANCE_GAP)
    hook.rerender({ active: false })
    expect(hook.result.current).toBeNull()
  })

  it('observes nothing while it is not active', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { stage: el } = stageWithSeat(512)
    const hook = renderHook(() => useSeatClearance({ current: el }, false))
    expect(hook.result.current).toBeNull()
    expect(FakeObserver.all).toHaveLength(0)
  })

  it('re-measures when the stage or the seat resizes, and follows a seat element that was replaced', () => {
    vi.stubGlobal('ResizeObserver', FakeObserver)
    const { stage: el, seat, moveSeat } = stageWithSeat(512)
    const ref = { current: el }
    const hook = renderHook(() => useSeatClearance(ref, true))
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
      const hook = renderHook(({ active }) => useSeatClearance(ref, active), { initialProps: { active: true } })
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
