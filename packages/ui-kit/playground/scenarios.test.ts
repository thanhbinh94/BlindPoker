import { render, screen, within } from '@testing-library/react'
import { createElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../src/i18n/index.js'
import { WorstPage, parseWorstHash } from './scenarios.js'

describe('parseWorstHash', () => {
  it('reads #worst/<state>/<seats>/<lang> with no frame and a short name', () => {
    expect(parseWorstHash('#worst/turn/6/vi')).toEqual({ state: 'turn', seats: 6, lang: 'vi', long: false, frame: null })
  })

  it('keeps /long working, read by name', () => {
    expect(parseWorstHash('#worst/turn/6/vi/long')).toEqual({ state: 'turn', seats: 6, lang: 'vi', long: true, frame: null })
  })

  it('knows the squeeze table as a state', () => {
    expect(parseWorstHash('#worst/blindS/9/en')?.state).toBe('blindS')
  })

  it('reads landscape and desktop as a forced frame', () => {
    expect(parseWorstHash('#worst/blindS/9/vi/landscape')).toMatchObject({ state: 'blindS', seats: 9, frame: 'landscape', long: false })
    expect(parseWorstHash('#worst/waiting/4/vi/desktop')).toMatchObject({ frame: 'desktop', long: false })
  })

  it('reads the tokens after the language by name, in either order', () => {
    expect(parseWorstHash('#worst/turn/9/vi/long/landscape')).toMatchObject({ long: true, frame: 'landscape' })
    expect(parseWorstHash('#worst/turn/9/vi/landscape/long')).toMatchObject({ long: true, frame: 'landscape' })
    expect(parseWorstHash('#worst/turn/9/vi/short/landscape')).toMatchObject({ long: false, frame: 'landscape' })
  })

  // BP-28: the user's phone with its address bar, whatever the window.
  it('reads /short as the room in an 855 × 319 box, in the landscape frame', () => {
    expect(parseWorstHash('#worst/blindP/6/vi/short')).toEqual({ state: 'blindP', seats: 6, lang: 'vi', long: false, frame: 'landscape', box: { w: 855, h: 319 } })
    expect(parseWorstHash('#worst/blindW/8/en/long/short')).toMatchObject({ state: 'blindW', long: true, frame: 'landscape', box: { w: 855, h: 319 } })
    expect(parseWorstHash('#worst/turn/8/vi/landscape')?.box).toBeUndefined()
  })

  it('reads /rank<N> as the viewer’s own rank, 1 to 5', () => {
    expect(parseWorstHash('#worst/turn/8/vi/rank5')).toMatchObject({ seats: 8, meRank: 5 })
    expect(parseWorstHash('#worst/turn/8/vi/long/rank2')).toMatchObject({ long: true, meRank: 2 })
    expect(parseWorstHash('#worst/turn/8/vi/rank9')?.meRank).toBeUndefined()
    expect(parseWorstHash('#worst/turn/8/vi')?.meRank).toBeUndefined()
  })

  it('ignores a token it does not know', () => {
    expect(parseWorstHash('#worst/result/6/vi/sideways/long')).toMatchObject({ long: true, frame: null })
  })

  it('falls back on an unknown state, seat count and language', () => {
    expect(parseWorstHash('#worst/nope/12/xx')).toEqual({ state: 'result', seats: 6, lang: 'vi', long: false, frame: null })
  })

  it('is null for any other hash', () => {
    expect(parseWorstHash('#peel')).toBeNull()
    expect(parseWorstHash('')).toBeNull()
  })
})

// Plan 37: the chaos states are pages of their own, and each one renders the thing it exists to show.
describe('the chaos worst-case pages', () => {
  const draw = (hash: string) => {
    const spec = parseWorstHash(hash)!
    return render(createElement(I18nextProvider, { i18n: createI18n({ language: spec.lang, storage: null }) }, createElement(WorstPage, { spec })))
  }

  it('knows every chaos state by name', () => {
    for (const state of ['chaosDraft', 'chaosReveal', 'chaosFour', 'chaosPeel', 'chaosBlind', 'chaosResult', 'chaosBoard']) {
      expect(parseWorstHash(`#worst/${state}/6/vi`)?.state, state).toBe(state)
    }
    expect(parseWorstHash('#worst/chaosDraft/6/vi')).toEqual({ state: 'chaosDraft', seats: 6, lang: 'vi', long: false, frame: null })
  })

  it('#worst/chaosDraft/6/vi: three Vàng cards to pick over the felt, and the last hand’s result card out of the way', () => {
    draw('#worst/chaosDraft/6/vi')
    const panel = screen.getByRole('region', { name: 'Chọn một thẻ Vàng' })
    expect(within(panel).getAllByRole('button')).toHaveLength(3)
    expect(within(panel).getByRole('timer')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Người thắng' })).toBeNull()
    // the cards in the seats' lines, the viewer’s fan still on the table
    expect(document.querySelectorAll('[data-chaos-cards]').length).toBeGreaterThan(3)
    expect(document.querySelector('[data-me="true"] [class*="seatCards"]')!.children.length).toBe(3)
  })

  it('#worst/chaosReveal/6/vi: the banner is up over the board', () => {
    draw('#worst/chaosReveal/6/vi')
    
    expect(document.querySelector('[data-outcome]')).toHaveTextContent('Bot 1 dùng Rút lá lẻ lên Nguyễn Thị Phương Anh')
    expect(document.querySelector('[data-outcome]')).toHaveTextContent('Bị chặn')
  })

  it('#worst/chaosBoard/6/vi: five board cards up, the banner on their feet, and "Thế giới đảo ngược" on', () => {
    draw('#worst/chaosBoard/6/vi')
    const board = screen.getByRole('group', { name: 'Bài chung' })
    expect(board).toHaveAttribute('data-board', 'up')
    expect(board.querySelectorAll('[data-card]')).toHaveLength(5)
    expect(within(board).getByText(/dùng Thế giới đảo ngược/)).toBeInTheDocument()
  })

  it('#worst/chaosResult/6/vi: "Thẻ đã dùng", the credits, and the winner’s shout', () => {
    draw('#worst/chaosResult/6/vi')
    expect(screen.getByText(/^Thẻ đã dùng: Nguyễn Thị Phương Anh — Đổi bài, Nhìn trộm;/)).toBeInTheDocument()
    expect(screen.getByText(/Bạo kích ×2 \+6\.000/)).toBeInTheDocument()
    expect(screen.getByText('Bạo kích ×2!')).toBeInTheDocument()
    expect(screen.getByText(/Đã chạm trần thẻ hôm nay/)).toBeInTheDocument()
    expect(document.querySelector('[data-me="true"] [data-borrowed]')).toHaveTextContent('Mượn')
  })

  it('#worst/chaosFour: four cards in my hand, and the peeked board cards in the ghost slots', () => {
    draw('#worst/chaosFour/6/vi')
    expect(document.querySelector('[data-me="true"] [class*="seatCards"]')!.children).toHaveLength(4)
    expect(document.querySelectorAll('[data-peek]')).toHaveLength(3)
    expect(within(document.querySelector<HTMLElement>('[data-me="true"]')!).getByText('+1')).toBeInTheDocument() // five cards in my row: four icons and "+1"
  })

  it('#worst/chaosPeel: four cards to peel on a squeeze table', () => {
    draw('#worst/chaosPeel/6/vi')
    expect(document.querySelector('[data-me="true"]')!.querySelectorAll('[data-peel]')).toHaveLength(4)
  })

  it('#worst/chaosBlind: three backs I cannot turn, and the word for it', () => {
    draw('#worst/chaosBlind/6/vi')
    expect(within(document.querySelector<HTMLElement>('[data-me="true"]')!).getByText('Bị che mắt')).toBeInTheDocument()
  })
})
