import { defaultChibi } from '@bp/ui-kit'
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it } from 'vitest'
import viNormal from '../../locales/vi/normal.json'
import { makeI18n, renderWithI18n } from '../../test-i18n.js'
import s from './shop.module.css'
import { ShopStage, type ShopStageProps } from './ShopStage.js'

/** The kit's own words (`avatar.turn`, `avatar.greet` in ui-kit's `game.json`), on the live figure's two controls. */
const TURN = 'Xoay'
const GREET = 'Nhân vật của bạn, bấm để chào'
/** The figure's name, which the ops pack finds it by (`shop.figure`). */
const FIGURE = viNormal.shop.figure

const BASE: ShopStageProps = {
  subject: defaultChibi('shop'),
  portrait: false,
  layout: 'desktop',
  balance: 128_000,
  lang: 'vi',
  standing: { reputation: 455, rank: 3, ranks: [{ rank: 1, threshold: 0 }, { rank: 3, threshold: 400 }, { rank: 4, threshold: 1800 }] },
  tryingName: null,
}

/** Renders the stage, and hands back a way to render it again with other props inside the same i18n provider:
 * testing-library's own `rerender` drops the provider `renderWithI18n` wrapped it in, and that remounts the tree. */
function renderStage(props: Partial<ShopStageProps> = {}): (next: Partial<ShopStageProps>) => void {
  const view = renderWithI18n(<ShopStage {...BASE} {...props} />, makeI18n('vi'))
  return (next) =>
    view.rerender(
      <I18nextProvider i18n={view.i18n}>
        <ShopStage {...BASE} {...props} {...next} />
      </I18nextProvider>,
    )
}

const figure = (): HTMLElement => screen.getByRole('img', { name: FIGURE })

describe('ShopStage', () => {
  // BP-30 (spec K6 §3.2, R6): the figure lives and keeps the name the ops pack finds it by.
  it('keeps the figure\'s name "Nhân vật của bạn" and draws it live, with a greet button', () => {
    expect(FIGURE).toBe('Nhân vật của bạn')
    renderStage()

    expect(figure()).toHaveAttribute('data-live', 'idle')
    expect(screen.getByRole('button', { name: GREET })).toBeInTheDocument()
  })

  // P15 (lead decision): Xoay on every size — at the end of the phone's strip, under the column's stage.
  it('the strip has a Xoay and the column has one', () => {
    const update = renderStage({ layout: 'phone' })
    const stripTurn = screen.getByRole('button', { name: TURN })
    // The strip is one row: the figure, the balance and reputation, then Xoay last.
    const strip = stripTurn.parentElement as HTMLElement
    expect(strip.contains(figure())).toBe(true)
    expect(within(strip).getByText('Số dư: 128.000 điểm')).toBeInTheDocument()
    expect(strip.lastElementChild).toBe(stripTurn)

    for (const layout of ['tablet', 'desktop'] as const) {
      update({ layout, tryingName: 'Mũ len', onReset: () => {} })
      const turns = screen.getAllByRole('button', { name: TURN })
      expect(turns).toHaveLength(1)
      const turn = turns[0]!
      // Under the stage, outside its clipped box, ahead of the try-on caption and "Về đồ đang mặc".
      const box = figure().closest(`.${s.stage}`)
      expect(box).not.toBeNull()
      expect(box!.contains(turn)).toBe(false)
      const reset = screen.getByRole('button', { name: viNormal.shop.reset })
      const caption = screen.getByText('Mặc thử: Mũ len')
      expect(turn.compareDocumentPosition(caption) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(turn.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
      expect(figure().compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    }
  })

  it('Xoay toggles data-facing on the figure', async () => {
    const user = userEvent.setup()
    const update = renderStage()
    const turn = screen.getByRole('button', { name: TURN })
    expect(figure()).toHaveAttribute('data-facing', 'right')
    expect(turn).toHaveAttribute('aria-pressed', 'false')

    await user.click(turn)
    expect(figure()).toHaveAttribute('data-facing', 'left')
    expect(turn).toHaveAttribute('aria-pressed', 'true')

    // A frame on try-on swaps the whole figure for the framed head: the same figure, its frame changed, still turned.
    const full = figure()
    update({ portrait: true })
    expect(figure()).toBe(full)
    expect(full).toHaveAttribute('data-frame', 'head')
    expect(full).toHaveAttribute('data-facing', 'left')

    await user.click(screen.getByRole('button', { name: TURN }))
    expect(figure()).toHaveAttribute('data-facing', 'right')
  })

  it('Xoay in the strip turns the strip\'s figure', async () => {
    const user = userEvent.setup()
    renderStage({ layout: 'phone' })

    await user.click(screen.getByRole('button', { name: TURN }))
    expect(figure()).toHaveAttribute('data-facing', 'left')
  })

  it('plays the reaction the screen hands it', () => {
    const update = renderStage({ react: null })
    expect(figure()).not.toHaveAttribute('data-reacting')

    update({ react: { kind: 'cheer', key: 1 } })
    expect(figure()).toHaveAttribute('data-reacting', 'cheer')
  })
})
