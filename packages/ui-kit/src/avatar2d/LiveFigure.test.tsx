import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from '../i18n/index.js'
import { defaultChibi } from './defaults.js'
import { CHIBI_LIFE } from './life.js'
import s from './live-figure.module.css'
import { flipFacing, LiveFigure, nextReaction, TurnButton } from './LiveFigure.js'
import type { ChibiFacing, ChibiReaction } from './types.js'

const SUBJECT = defaultChibi('ann')
const GREET_VI = 'Nhân vật của bạn, bấm để chào'

const vi18n = () => createI18n({ language: 'vi', storage: null })

function renderVi(ui: ReactElement) {
  const i18n = vi18n()
  const result = render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>)
  return {
    ...result,
    rerender: (next: ReactElement) => result.rerender(<I18nextProvider i18n={i18n}>{next}</I18nextProvider>),
  }
}

/** The `Chibi` root inside a `LiveFigure`: the element that carries the life state. */
const figureRoot = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-chibi-hash]')!
const sparkleRing = (container: HTMLElement) => container.querySelector(`.${s.sparkleRing}`)
const cheer = (key: number): ChibiReaction => ({ kind: 'cheer', key })
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms))

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion: reduce'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('LiveFigure', () => {
  it("keeps the figure's role img and name", () => {
    renderVi(<LiveFigure subject={SUBJECT} label="Phòng thay đồ" />)
    const figure = screen.getByRole('img', { name: 'Phòng thay đồ' })
    expect(figure).toHaveAttribute('data-live', 'idle')
    // Decorative without a label, as a plain `Chibi` is.
    const decorative = renderVi(<LiveFigure subject={SUBJECT} />)
    expect(figureRoot(decorative.container)).toHaveAttribute('aria-hidden', 'true')
    expect(figureRoot(decorative.container)).not.toHaveAttribute('role')
  })

  it('the greet button is a sibling with the vi label and a tap sets a wave on the figure root', () => {
    const { container } = renderVi(<LiveFigure subject={SUBJECT} label="Phòng thay đồ" className="outer" figureClassName="inner" />)
    const button = screen.getByRole('button', { name: GREET_VI })
    const root = figureRoot(container)
    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper).toHaveClass(s.liveFigure!, 'outer')
    expect(root).toHaveClass('inner')
    expect(button).toHaveAttribute('type', 'button')
    // A sibling of the figure, not a wrapper around it: the figure keeps its own name.
    expect(button.parentElement).toBe(wrapper)
    expect(root.parentElement).toBe(wrapper)
    expect(button.contains(root)).toBe(false)
    expect(button).toHaveClass(s.greet!)
    expect(root).not.toHaveAttribute('data-reacting')
    fireEvent.click(button)
    expect(root).toHaveAttribute('data-reacting', 'wave')
  })

  it('a tap during a cheer is ignored', () => {
    vi.useFakeTimers()
    const { container, rerender } = renderVi(<LiveFigure subject={SUBJECT} react={null} />)
    rerender(<LiveFigure subject={SUBJECT} react={cheer(1)} />)
    const root = figureRoot(container)
    expect(root).toHaveAttribute('data-reacting', 'cheer')
    fireEvent.click(screen.getByRole('button', { name: GREET_VI }))
    expect(root).toHaveAttribute('data-reacting', 'cheer')
    advance(CHIBI_LIFE.cheerFaceMs)
    expect(root).not.toHaveAttribute('data-reacting')
    // Once the cheer is over, a tap waves again.
    fireEvent.click(screen.getByRole('button', { name: GREET_VI }))
    expect(root).toHaveAttribute('data-reacting', 'wave')
  })

  it('an external react change cheers once; the value present at mount does not', () => {
    vi.useFakeTimers()
    const { container, rerender } = renderVi(<LiveFigure subject={SUBJECT} react={cheer(5)} />)
    const root = figureRoot(container)
    expect(root).not.toHaveAttribute('data-reacting')
    const next = cheer(6)
    rerender(<LiveFigure subject={SUBJECT} react={next} />)
    expect(root).toHaveAttribute('data-reacting', 'cheer')
    advance(CHIBI_LIFE.cheerFaceMs)
    expect(root).not.toHaveAttribute('data-reacting')
    // The same reaction again (same key, new object or not) plays nothing.
    rerender(<LiveFigure subject={SUBJECT} react={{ ...next }} />)
    expect(root).not.toHaveAttribute('data-reacting')
    // An unrelated re-render with a new key cheers again, after a tap bumped the internal sequence.
    fireEvent.click(screen.getByRole('button', { name: GREET_VI }))
    advance(CHIBI_LIFE.waveFaceMs)
    rerender(<LiveFigure subject={SUBJECT} react={cheer(7)} />)
    expect(root).toHaveAttribute('data-reacting', 'cheer')
  })

  it('TurnButton toggles via onTurn and reports aria-pressed', () => {
    const onTurn = vi.fn<(next: ChibiFacing) => void>()
    const { rerender } = renderVi(<TurnButton facing="right" onTurn={onTurn} className="turn" />)
    const button = screen.getByRole('button', { name: 'Xoay' })
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveClass('turn')
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(onTurn).toHaveBeenLastCalledWith('left')
    rerender(<TurnButton facing="left" onTurn={onTurn} />)
    expect(screen.getByRole('button', { name: 'Xoay' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Xoay' }))
    expect(onTurn).toHaveBeenLastCalledWith('right')
    expect(onTurn).toHaveBeenCalledTimes(2)
  })

  it('a turned LiveFigure hands its facing to the figure', () => {
    const { container } = renderVi(<LiveFigure subject={SUBJECT} facing="left" />)
    expect(figureRoot(container)).toHaveAttribute('data-facing', 'left')
  })

  it('the sparkle ring shows six marks only during a cheer and never under reduced motion', () => {
    vi.useFakeTimers()
    const { container, rerender, unmount } = renderVi(<LiveFigure subject={SUBJECT} react={null} />)
    expect(sparkleRing(container)).toBeNull()
    // A wave never sparkles.
    fireEvent.click(screen.getByRole('button', { name: GREET_VI }))
    expect(sparkleRing(container)).toBeNull()
    advance(CHIBI_LIFE.waveFaceMs)

    rerender(<LiveFigure subject={SUBJECT} react={cheer(1)} />)
    const ring = sparkleRing(container)!
    expect(ring).not.toBeNull()
    expect(ring).toHaveAttribute('aria-hidden', 'true')
    expect(ring.querySelectorAll('i')).toHaveLength(6)
    // Outside the figure root, inside the wrapper.
    expect(ring.parentElement).toBe(container.firstElementChild)
    advance(CHIBI_LIFE.sparkleMs - 1)
    expect(sparkleRing(container)).not.toBeNull()
    // A tap mid-cheer neither cuts the sparkles short nor adds any.
    fireEvent.click(screen.getByRole('button', { name: GREET_VI }))
    expect(sparkleRing(container)).not.toBeNull()
    advance(1)
    expect(sparkleRing(container)).toBeNull()

    // A second cheer remounts the ring (a fresh `key`), so its fade starts over.
    rerender(<LiveFigure subject={SUBJECT} react={cheer(2)} />)
    const first = sparkleRing(container)
    advance(300)
    rerender(<LiveFigure subject={SUBJECT} react={cheer(3)} />)
    expect(sparkleRing(container)).not.toBe(first)
    advance(CHIBI_LIFE.sparkleMs)
    expect(sparkleRing(container)).toBeNull()
    unmount()
    expect(vi.getTimerCount()).toBe(0)

    stubReducedMotion(true)
    const reduced = renderVi(<LiveFigure subject={SUBJECT} react={null} />)
    reduced.rerender(<LiveFigure subject={SUBJECT} react={cheer(1)} />)
    expect(sparkleRing(reduced.container)).toBeNull()
    expect(figureRoot(reduced.container)).not.toHaveAttribute('data-reacting')
  })

  it('a figure that is not live never sparkles', () => {
    const { container, rerender } = renderVi(<LiveFigure subject={SUBJECT} live="off" react={null} />)
    rerender(<LiveFigure subject={SUBJECT} live="off" react={cheer(1)} />)
    expect(sparkleRing(container)).toBeNull()
  })

  it('greet=false renders no button', () => {
    const { container } = renderVi(<LiveFigure subject={SUBJECT} live="still" greet={false} label="Ann" />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(figureRoot(container)).toHaveAttribute('data-live', 'still')
  })
})

describe('nextReaction and flipFacing', () => {
  it('nextReaction counts on from the previous key, or from 1', () => {
    expect(nextReaction(null, 'cheer')).toEqual({ kind: 'cheer', key: 1 })
    expect(nextReaction({ kind: 'wave', key: 4 }, 'cheer')).toEqual({ kind: 'cheer', key: 5 })
  })

  it('flipFacing turns right to left and back', () => {
    expect(flipFacing('right')).toBe('left')
    expect(flipFacing('left')).toBe('right')
  })
})
