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

  it('#worst/chaosReveal/6/vi: the three cards that fired are up as toasts', () => {
    draw('#worst/chaosReveal/6/vi')
    const toasts = document.querySelectorAll('[data-chaos-toasts] [data-outcome]')
    expect(toasts).toHaveLength(3)
    expect(toasts[0]).toHaveTextContent('Bot 1 dùng Rút lá lẻ → Nguyễn Thị Phương Anh')
    expect(toasts[0]).toHaveTextContent('Bị chặn')
  })

  it('#worst/chaosBoard/6/vi: five board cards up, the reveal cards as toasts, and "Thế giới đảo ngược" pinned first', () => {
    draw('#worst/chaosBoard/6/vi')
    const board = screen.getByRole('group', { name: 'Bài chung' })
    expect(board.querySelectorAll('[data-card]')).toHaveLength(5)
    const band = document.querySelector<HTMLElement>('[data-chaos-toasts]')!
    expect(band.querySelector('[data-chaos-toast]')).toHaveAttribute('data-chaos-note')
    expect(band.textContent).toMatch(/dùng Thế giới đảo ngược/)
    expect(within(band).getByText('+1 thẻ khác'), 'the note takes one of the three places').toBeInTheDocument()
  })

  it('#worst/chaosBurst/8/vi: the eight cards come with the settlement — three toasts and "+5 thẻ khác" beside the open result', () => {
    draw('#worst/chaosBurst/8/vi')
    const band = document.querySelector<HTMLElement>('[data-chaos-toasts]')!
    expect(band.querySelectorAll('[data-outcome]')).toHaveLength(3)
    expect(within(band).getByText('+5 thẻ khác')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Người thắng' })).toBeInTheDocument()
  })

  it('#worst/chaosResult/6/vi: "Thẻ đã dùng", the credits, and the winner’s shout', () => {
    draw('#worst/chaosResult/6/vi')
    // Each card's name is its own button on the line (BP-39), so the line is read whole rather than by its own text alone.
    expect(screen.getByText(/^Thẻ đã dùng:/)).toHaveTextContent(/^Thẻ đã dùng: Nguyễn Thị Phương Anh — Đổi bài, Nhìn trộm;/)
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
  // BP-39: the pages Tasks 8-11 take their screenshots from.
  it('knows the bonus pages by name', () => {
    expect(parseWorstHash('#worst/chaosBonus/6/vi')?.state).toBe('chaosBonus')
    expect(parseWorstHash('#worst/chaosBurst/8/en')?.state).toBe('chaosBurst')
  })

  it('#worst/chaosBurst/8/vi: all eight seats fired a card, in one "Thẻ đã dùng" line, with the next hand counted down', () => {
    draw('#worst/chaosBurst/8/vi')
    const line = screen.getByText(/^Thẻ đã dùng: /)
    expect(line.textContent!.split('; ')).toHaveLength(8)
    expect(line).toHaveTextContent('Bot 1 — Rút lá lẻ (Bị chặn)')
    expect(document.body.textContent).toMatch(/Ván tiếp theo sau [0-9]+ giây/)
  })

  it('#worst/chaosBurst with fewer seats lets only those seats fire', () => {
    draw('#worst/chaosBurst/4/vi')
    expect(screen.getByText(/^Thẻ đã dùng: /).textContent!.split('; ')).toHaveLength(4)
  })

  it('#worst/chaosBonus/6/vi: my decision with a full bonus hand behind it', () => {
    draw('#worst/chaosBonus/6/vi')
    expect(screen.getByRole('button', { name: /^Chơi/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bỏ bài' })).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Thẻ thưởng' })).getAllByRole('button')).toHaveLength(3)
    // the others' counts, never their cards: Bot 1 and Bot 4 hold one, Bot 3 two
    expect(screen.getAllByRole('img', { name: 'Thẻ thưởng: 1' })).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'Thẻ thưởng: 2' })).toBeInTheDocument()
  })

  it('#worst/chaosArmed/6/vi: the board re-deal set to play, the other two cards still in my hand', () => {
    expect(parseWorstHash('#worst/chaosArmed/6/vi')?.state).toBe('chaosArmed')
    draw('#worst/chaosArmed/6/vi')
    const cards = within(screen.getByRole('group', { name: 'Thẻ thưởng' })).getAllByRole('button')
    expect(cards).toHaveLength(3)
    expect(cards[0]).toHaveAccessibleName('Chia lại lá chung (Vàng) · Đã đặt dùng · ván này')
  })

  // BP-41: the pages Task 9 takes its screenshots from.
  it('#worst/chaosGod/6/vi: the herald, the Thần’s aura and mark, the Bán Thần, a bomb, and no "Bỏ bài"', () => {
    draw('#worst/chaosGod/6/vi')
    expect(screen.getByText('Cảnh báo: Bot 1 đã tích luỹ đủ năng lượng và trở thành Thần Bài!')).toBeInTheDocument()
    expect(document.querySelector('[data-seat="1"]')).toHaveAttribute('data-reign', 'god')
    expect(screen.getByRole('img', { name: 'Thần Bài · còn 5 ván' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Bán Thần · còn 5 ván' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Đang giữ bom · còn 2 ván' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Bỏ bài' })).toBeNull()
    expect(screen.getByText('Không được bỏ bài ván này')).toBeInTheDocument()
  })

  it('#worst/chaosDice/6/vi: the dice roll for the table beside the result', () => {
    draw('#worst/chaosDice/6/vi')
    expect(screen.getByRole('region', { name: 'Xúc xắc vận may' })).toHaveTextContent('Bot 1')
    expect(screen.getByRole('heading', { name: 'Người thắng' })).toBeInTheDocument()
    expect(screen.getByText(/Nổ hũ \+120\.000/)).toBeInTheDocument()
  })

  it('#worst/chaosSlain/6/vi: the fall of the Thần — its banner and its own toast line beside the result', () => {
    draw('#worst/chaosSlain/6/vi')
    expect(screen.getByText(/đã đánh bại Thần Bài!$/)).toBeInTheDocument()
    expect(document.querySelector('[data-chaos-toast][data-reign="godslain"]')).toHaveTextContent(/hạ Thần Bài Bot 1$/)
    expect(screen.getByRole('heading', { name: 'Người thắng' })).toBeInTheDocument()
  })

  it('#worst/chaosSix/6/vi: six board cards, my five hole cards with the wild one marked, one seat down to one card', () => {
    draw('#worst/chaosSix/6/vi')
    expect(screen.getByRole('group', { name: 'Bài chung' }).querySelectorAll('[data-card]')).toHaveLength(6)
    expect(document.querySelector('[data-me="true"] [data-hand]')!.querySelectorAll('[data-card]')).toHaveLength(5)
    expect(document.querySelector('[data-seat="1"] [data-hand]')!.children).toHaveLength(1)
    expect(document.querySelector('[data-seat="2"] [data-hand]')).toHaveAttribute('data-count', '5')
  })
})
