import { Chibi, type ChibiConfig, type Expression } from '@bp/ui-kit'
import { useId, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import s from './wardrobe.module.css'

/** The six faces every base ships (design §3.1 item 2) — same list `WardrobeScreen` used before this
 * component existed, moved here because the expression row is now this component's own. The order is the
 * stepper's order: "next" from the last wraps to the first, "previous" from the first to the last. */
const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/** Plain-glyph arrows on the stepper's two buttons (aria-hidden, like `WardrobeScreen`'s `UNDO_GLYPH`): each
 * button's own `aria-label` names it, the glyph only draws it. */
const PREV_GLYPH = '‹'
const NEXT_GLYPH = '›'

export interface StagePanelProps {
  subject: ChibiConfig
  expression: Expression
  onExpression: (expression: Expression) => void
  /** `true` on the Khung (frame) tab (design §3.1 item 1): the stage swaps its full-body figure for a
   * 240 px framed head portrait rather than showing both. */
  portrait: boolean
  /** Tablet/phone stages are shorter — 250/280 px instead of 300 px (design §3.2, §3.3) — and the caller
   * is the one that knows which; this sets `.stage[data-compact]`'s own height, and the podium glow
   * (`.stage::before`/`::after`, both sized in percentages of `.stage` itself) follows it for free. */
  compact?: boolean
  /** The full-body figure's own width (V5 fix, 2026-09-27): a fixed 320 px regardless of the stage's own
   * height used to run the figure's head straight into the stage's `overflow: hidden` top edge once that
   * stage was shorter than desktop's — the box shrank, the figure inside it did not. Defaults to 290, the
   * value for the 300 px desktop stage; a caller with a shorter stage passes a smaller one down. */
  fullSize?: number
}

/**
 * The left column's stage (design §3.1 items 1–2): a lit podium the chibi stands on, and the expression
 * stepper beneath it — `‹  Vui  ›`, two buttons around the current face's name (review 2026-09-29 round 2,
 * No10; the six chips it replaces were cramped, Vietnamese names and all, and wrapped on a narrow column).
 * `portrait` is a swap, not an addition — the frame tab replaces the full figure with its own framed portrait
 * rather than showing a second small chibi beside the first, unlike the picker column's pre-redesign
 * behaviour.
 */
export function StagePanel({ subject, expression, onExpression, portrait, compact = false, fullSize = 290 }: StagePanelProps) {
  const { t } = useTranslation('normal')
  const nameId = useId()

  /** One step along `EXPRESSIONS`, wrapping at both ends — a list of six is short enough that going the
   * other way round is how a player reaches "Ngủ" from "Bình thường". */
  const step = (delta: 1 | -1) => {
    const next = EXPRESSIONS[(EXPRESSIONS.indexOf(expression) + delta + EXPRESSIONS.length) % EXPRESSIONS.length]
    if (next !== undefined) onExpression(next)
  }

  /** ArrowLeft/ArrowRight anywhere in the group step as well, whichever of the two buttons holds focus. A
   * chord with Alt, Ctrl or Meta is the browser's own (Alt+← is "back") and is left alone. */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    step(event.key === 'ArrowRight' ? 1 : -1)
  }

  return (
    <div className={s.stagePanel}>
      <div className={s.stage} data-compact={compact}>
        <div className={s.stageFigure}>
          {portrait ? (
            <Chibi subject={subject} frame="head" size={240} expression={expression} label={t('wardrobe.title')} />
          ) : (
            <Chibi subject={subject} frame="full" size={fullSize} expression={expression} label={t('wardrobe.title')} />
          )}
        </div>
      </div>

      {/* Each button is described by the name between them (final fix wave, B5): focusing one reads the current face. */}
      <div className={s.expressionRow} role="group" aria-label={t('wardrobe.expression.legend')} onKeyDown={onKeyDown}>
        <button
          type="button"
          className={s.expressionStep}
          aria-label={t('wardrobe.expression.prev')}
          aria-describedby={nameId}
          onClick={() => step(-1)}
        >
          <span aria-hidden="true">{PREV_GLYPH}</span>
        </button>
        <output id={nameId} className={s.expressionName} aria-live="polite">
          {t(`wardrobe.expression.${expression}`)}
        </output>
        <button
          type="button"
          className={s.expressionStep}
          aria-label={t('wardrobe.expression.next')}
          aria-describedby={nameId}
          onClick={() => step(1)}
        >
          <span aria-hidden="true">{NEXT_GLYPH}</span>
        </button>
      </div>
    </div>
  )
}
