import { fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import { createI18n, type Language } from '../i18n/index.js'
import { BetPanel, betStep, sliderIndex, sliderLast, sliderValue, type BetPanelProps } from './BetPanel.js'
import s from './table.module.css'
import TABLE_CSS from './table.module.css?raw'

type HarnessProps = Omit<BetPanelProps, 'value' | 'onChange' | 'lang'> & { start?: number; lang?: Language; spy?: (v: number) => void }

/** The panel with its value held the way `ActionBar` will hold it: in state, set by `onChange`. */
function Harness({ start, lang = 'en', spy, ...rest }: HarnessProps) {
  const [value, setValue] = useState(start ?? rest.min)
  return (
    <BetPanel
      {...rest}
      lang={lang}
      value={value}
      onChange={(v) => {
        spy?.(v)
        setValue(v)
      }}
    />
  )
}

const wrap = (ui: React.ReactElement, lang: Language = 'en') =>
  render(<I18nextProvider i18n={createI18n({ language: lang, storage: null })}>{ui}</I18nextProvider>)

const slider = (): HTMLInputElement => screen.getByRole('slider')
const chip = (name: string): HTMLElement => within(screen.getByRole('group', { name: /^(Bet size|Mức cược)$/ })).getByRole('button', { name })

describe('BetPanel', () => {
  // Review Focus 1, P7: a native range with step 200 from 600 could never land on 2 950; the panel steps itself.
  it('the slider reaches max when the range is not a multiple of the step', () => {
    wrap(<Harness min={600} max={2_950} step={200} pot={1_000} lang="vi" />, 'vi')
    const range = slider()
    expect(range).toHaveAttribute('min', '600')
    expect(range).toHaveAttribute('max', '2950')
    expect(range).toHaveAttribute('step', '1')
    expect(range).toHaveAccessibleName('Thanh trượt mức cược')
    fireEvent.keyDown(range, { key: 'End' })
    expect(range.value).toBe('2950')
    expect(range).toHaveAttribute('aria-valuetext', '2.950')
    fireEvent.keyDown(range, { key: 'ArrowLeft' })
    expect(range.value).toBe('2800')
    expect(range).toHaveAttribute('aria-valuetext', '2.800')
    fireEvent.keyDown(range, { key: 'ArrowRight' })
    expect(range.value).toBe('2950')
    // a drag lands on any integer; it snaps to the grid, and the last cell snaps to max
    fireEvent.change(range, { target: { value: '2930' } })
    expect(range.value).toBe('2950')
    fireEvent.change(range, { target: { value: '1310' } })
    expect(range.value).toBe('1400')
  })

  it('chips set min, half pot, pot and all-in and light the matching one', () => {
    wrap(<Harness min={400} max={10_000} step={100} pot={1_500} />)
    const names = ['Min', '½ pot', 'Pot', 'All-in']
    const pressed = (): string[] => names.map((name) => chip(name).getAttribute('aria-pressed') ?? 'none')
    for (const name of names) {
      expect(chip(name)).toHaveClass(s.preset!, s.betChip!)
      expect(chip(name)).toHaveAttribute('type', 'button')
    }
    expect(pressed()).toEqual(['true', 'false', 'false', 'false'])
    fireEvent.click(chip('½ pot'))
    expect(slider().value).toBe('750')
    expect(pressed()).toEqual(['false', 'true', 'false', 'false'])
    fireEvent.click(chip('Pot'))
    expect(slider().value).toBe('1500')
    expect(pressed()).toEqual(['false', 'false', 'true', 'false'])
    fireEvent.click(chip('All-in'))
    expect(slider().value).toBe('10000')
    expect(pressed()).toEqual(['false', 'false', 'false', 'true'])
    fireEvent.click(chip('Min'))
    expect(slider().value).toBe('400')
    // a value no chip names lights none of them
    fireEvent.keyDown(slider(), { key: 'ArrowRight' })
    expect(pressed()).toEqual(['false', 'false', 'false', 'false'])
  })

  it('chips clamp into the legal range, and a pot past max lights Pot and All-in together', () => {
    wrap(<Harness min={2_000} max={6_000} step={100} pot={20_000} />)
    fireEvent.click(chip('Pot'))
    expect(slider().value).toBe('6000')
    expect(chip('Pot')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('All-in')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('½ pot')).toHaveAttribute('aria-pressed', 'true')
  })

  it('keys move one step, ten steps, home and end', () => {
    wrap(<Harness min={1_000} max={50_000} step={500} pot={1_000} />)
    const range = slider()
    const press = (key: string): string => {
      const notPrevented = fireEvent.keyDown(range, { key })
      expect(notPrevented, `${key} is the panel's, not the browser's`).toBe(false)
      return range.value
    }
    expect(press('ArrowRight')).toBe('1500')
    expect(press('ArrowUp')).toBe('2000')
    expect(press('ArrowDown')).toBe('1500')
    expect(press('ArrowLeft')).toBe('1000')
    expect(press('ArrowLeft')).toBe('1000')
    expect(press('PageUp')).toBe('6000')
    expect(press('PageDown')).toBe('1000')
    expect(press('End')).toBe('50000')
    expect(press('ArrowRight')).toBe('50000')
    expect(press('Home')).toBe('1000')
    // other keys are left alone
    expect(fireEvent.keyDown(range, { key: 'a' })).toBe(true)
  })

  it('keys from a value off the grid go to the next grid value in that direction', () => {
    // ½ pot of 1 500 is 750, between the 600 and 800 cells of a 600 + 200k grid
    wrap(<Harness min={600} max={5_000} step={200} pot={1_500} start={750} />)
    fireEvent.keyDown(slider(), { key: 'ArrowRight' })
    expect(slider().value).toBe('800')
    fireEvent.change(slider(), { target: { value: '750' } })
    expect(slider().value).toBe('800')
  })

  it('betStep: (1_000, 500_000, 500) → 2_500; (1_000, 20_000, 500) → 500; (0, 100_000, 1_000) → 1_000', () => {
    expect(betStep(1_000, 500_000, 500)).toBe(2_500)
    expect(betStep(1_000, 20_000, 500)).toBe(500)
    expect(betStep(0, 100_000, 1_000)).toBe(1_000)
    // exactly 200 steps keeps the small blind; one more rounds up to a multiple of it
    expect(betStep(0, 200_000, 1_000)).toBe(1_000)
    expect(betStep(0, 201_000, 1_000)).toBe(2_000)
    expect(betStep(5_000, 5_000, 100)).toBe(100)
    expect(betStep(0, 1_000, 0)).toBe(5)
  })

  it('the slider index helpers clamp the last cell to max', () => {
    expect(sliderLast(600, 2_950, 200)).toBe(12)
    expect(sliderValue(11, 600, 2_950, 200)).toBe(2_800)
    expect(sliderValue(12, 600, 2_950, 200)).toBe(2_950)
    expect(sliderValue(40, 600, 2_950, 200)).toBe(2_950)
    expect(sliderIndex(2_950, 600, 2_950, 200)).toBe(12)
    expect(sliderIndex(2_800, 600, 2_950, 200)).toBe(11)
    expect(sliderIndex(600, 600, 2_950, 200)).toBe(0)
    expect(sliderLast(1_000, 1_000, 500)).toBe(0)
  })

  // P24: a short stack or a capped raise leaves one legal size.
  it('a single legal size disables the slider and every chip sets it', () => {
    const spy = vi.fn()
    const onConfirm = vi.fn()
    wrap(<Harness min={5_000} max={5_000} step={500} pot={1_000} spy={spy} confirmLabel="Raise 5,000" onConfirm={onConfirm} />)
    expect(slider()).toBeDisabled()
    for (const name of ['Min', '½ pot', 'Pot', 'All-in']) {
      expect(chip(name)).toBeEnabled()
      expect(chip(name)).toHaveAttribute('aria-pressed', 'true')
      fireEvent.click(chip(name))
    }
    expect(spy.mock.calls).toEqual([[5_000], [5_000], [5_000], [5_000]])
    fireEvent.click(screen.getByRole('button', { name: 'Raise 5,000' }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('Enter confirms and Escape cancels when handlers are given; no confirm row without them', () => {
    const onConfirm = vi.fn()
    const onCancel = vi.fn()
    const first = wrap(<Harness min={2_000} max={9_000} step={500} pot={3_000} confirmLabel="Raise 2,000" onConfirm={onConfirm} onCancel={onCancel} />)
    const panel = screen.getByRole('group', { name: 'Choose the bet' })
    expect(within(panel).getByRole('group', { name: 'Bet size' })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Cancel' })).toHaveTextContent('Cancel▾')
    expect(fireEvent.keyDown(slider(), { key: 'Enter' })).toBe(false)
    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(within(panel).getByRole('button', { name: 'Raise 2,000' }))
    expect(onConfirm).toHaveBeenCalledTimes(2)
    fireEvent.click(within(panel).getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
    // Escape closes from anywhere in the panel, not from the slider alone
    expect(fireEvent.keyDown(within(panel).getByRole('button', { name: 'Min' }), { key: 'Escape' })).toBe(false)
    expect(onCancel).toHaveBeenCalledTimes(3)
    first.unmount()

    // the ring's panel: chips and slider only; Enter and Escape go on to the tray
    wrap(<Harness min={2_000} max={9_000} step={500} pot={3_000} label="Sizing" />)
    expect(screen.getByRole('group', { name: 'Sizing' })).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(4)
    expect(fireEvent.keyDown(slider(), { key: 'Enter' })).toBe(true)
    expect(fireEvent.keyDown(slider(), { key: 'Escape' })).toBe(true)
  })

  it('a confirm label without its handler draws no confirm, and Hủy alone draws the row', () => {
    const onCancel = vi.fn()
    wrap(<Harness min={2_000} max={9_000} step={500} pot={3_000} confirmLabel="Raise 2,000" onCancel={onCancel} />, 'vi')
    expect(screen.queryByRole('button', { name: 'Raise 2,000' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Hủy' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Chọn mức cược' })).toBeInTheDocument()
  })

  it('shows the amount over the thumb, hidden from the reader, and follows the value', () => {
    wrap(<Harness min={600} max={2_950} step={200} pot={1_000} lang="vi" />, 'vi')
    const label = document.querySelector<HTMLElement>(`.${s.betValue}`)!
    expect(label).toHaveAttribute('aria-hidden', 'true')
    expect(label).toHaveTextContent('600')
    fireEvent.keyDown(slider(), { key: 'End' })
    expect(label).toHaveTextContent('2.950')
  })

  it('the stack’s sheet draws no floating amount, and packs its rows 4 px apart; its confirm carries the amount', () => {
    wrap(<Harness min={600} max={2_950} step={200} pot={1_000} lang="vi" confirmLabel="Tố 600" onConfirm={vi.fn()} onCancel={vi.fn()} />, 'vi')
    expect(screen.getByRole('group', { name: 'Chọn mức cược' })).toHaveAttribute('data-shape', 'sheet')
    expect(document.querySelector(`.${s.betValue}`)).toBeNull()
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', '600')
    expect(TABLE_CSS).toMatch(/\.betPanel\[data-shape='sheet'\]\s*\{[^}]*gap:\s*var\(--space-1\)/)
    expect(TABLE_CSS).toMatch(/\.betPanel\[data-shape='sheet'\] \.betSlider\s*\{[^}]*padding-top:\s*0/)
  })

  it('bet chips are 36 px even under pointer: coarse (declared after the coarse block); the pre-action toggles keep the tap height; landscape chips are 36 px and 32 px on the short tier', () => {
    const coarse = /@media \(pointer: coarse\)\s*\{\s*\.preset\s*\{\s*min-height:\s*var\(--tap\);?\s*\}\s*\}/.exec(TABLE_CSS)
    expect(coarse, 'the coarse block still lifts .preset (the pre-action toggles) to the tap height').not.toBeNull()
    const chipRule = /^\.betChip\s*\{[^}]*min-height:\s*36px/m.exec(TABLE_CSS)
    expect(chipRule, 'a top-level .betChip rule at 36 px').not.toBeNull()
    expect(chipRule!.index).toBeGreaterThan(coarse!.index)
    // every coarse block, rules and all: none of them names the chips
    const coarseBlocks = TABLE_CSS.match(/@media \(pointer: coarse\)\s*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g) ?? []
    expect(coarseBlocks.length).toBeGreaterThan(0)
    for (const block of coarseBlocks) expect(block, 'no coarse block lifts the chips again').not.toMatch(/\.betChip/)
    expect(TABLE_CSS).not.toMatch(/\.preToggle[^{]*\{[^}]*min-height/)
    expect(TABLE_CSS).toMatch(/\.tray\[data-frame='landscape'\] \.betChip\s*\{[^}]*min-height:\s*36px/)
    expect(TABLE_CSS).toMatch(/\.tray\[data-frame='landscape'\] \.betPanel\[data-compact\] \.betChip\s*\{[^}]*min-height:\s*32px/)
  })

  it('the slider is a 44 px row with a 28 px thumb on both engines, coloured by tokens, with no motion', () => {
    const rule = (sel: string): string => new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(TABLE_CSS)?.[1] ?? ''
    expect(rule('.slider')).toMatch(/height:\s*44px/)
    for (const thumb of ['.slider::-webkit-slider-thumb', '.slider::-moz-range-thumb']) {
      expect(rule(thumb)).toMatch(/width:\s*28px/)
      expect(rule(thumb)).toMatch(/height:\s*28px/)
      expect(rule(thumb)).toMatch(/var\(--gold\)/)
    }
    for (const sel of ['.betPanel', '.betChips', '.betChip', '.slider', '.betValue', '.betConfirm']) {
      expect(rule(sel), sel).not.toMatch(/#[0-9a-f]{3,8}\b/i)
      expect(rule(sel), sel).not.toMatch(/animation/)
    }
    expect(rule('.betChip')).toMatch(/transition:\s*none/)
  })
})
