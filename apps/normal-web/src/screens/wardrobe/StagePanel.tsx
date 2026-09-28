import { Chibi, type ChibiConfig, type Expression } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import s from './wardrobe.module.css'

/** The six faces every base ships (design §3.1 item 2) — same list `WardrobeScreen` used before this
 * component existed, moved here because the expression row is now this component's own. */
const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

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
 * picker beneath it. `portrait` is a swap, not an addition — the frame tab replaces the full figure with
 * its own framed portrait rather than showing a second small chibi beside the first, unlike the picker
 * column's pre-redesign behaviour.
 */
export function StagePanel({ subject, expression, onExpression, portrait, compact = false, fullSize = 290 }: StagePanelProps) {
  const { t } = useTranslation('normal')

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

      <div className={s.expressionRow} role="group" aria-label={t('wardrobe.expression.legend')}>
        {EXPRESSIONS.map((expr) => (
          <button
            key={expr}
            type="button"
            className={s.expressionBtn}
            aria-pressed={expression === expr}
            aria-label={t(`wardrobe.expression.${expr}`)}
            onClick={() => onExpression(expr)}
          >
            {t(`wardrobe.expression.${expr}`)}
          </button>
        ))}
      </div>
    </div>
  )
}
