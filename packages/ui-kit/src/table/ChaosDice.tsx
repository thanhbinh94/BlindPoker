import { useEffect, useReducer, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientDiceRoll } from '../client/types.js'
import type { Language } from '../i18n/index.js'
import { cx } from '../primitives/cx.js'
import { DICE_MS, DICE_ROLL_MS, diceText, rollText } from './chaos-detail.js'
import { useMediaQuery } from './useMediaQuery.js'
import s from './table.module.css'

// The roll's two moments live with the words that wait for them (the toast's line, Ruling 22); said again here, where they show.
export { DICE_MS, DICE_ROLL_MS }
/** How often a tumbling die shows another face. */
const TUMBLE_STEP_MS = 90

/** Where the pips of each face lie on a 3 × 3 grid (cells 0–8, row by row). */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
}

/** One die, drawn: a rounded square with its pips. Artwork; the row says the faces in words. */
function Die({ face, tumbling }: { face: number; tumbling: boolean }) {
  const pips = PIPS[face] ?? []
  return (
    <span className={cx(s.die, tumbling && s.dieTumble)} data-face={face} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={pips.includes(i) ? s.diePip : s.dieCell} />
      ))}
    </span>
  )
}

export interface ChaosDiceProps {
  /** `ClientState.chaos.rolls`: the latest rolls, oldest first. */
  rolls: readonly ClientDiceRoll[]
  lang: Language
}

/**
 * Xúc xắc vận may (BP-41 §5, G9), for the whole table: each roll of the end of the hand as its seat's name, its dice tumbling for
 * `DICE_ROLL_MS`, then the faces they landed on and what they gave ("Bộ ba! · Nổ hũ 60.000 · 2 thẻ Kim cương"), until `DICE_MS`
 * after it came. Rolls that come together share the panel, a row each. A tap puts it away early.
 *
 * It lies in the room's moment layer (`RoomScreen`) with the herald, fixed to the screen, so it never makes the page scroll and
 * covers the result or the draft no longer than its 3 s. A roll that arrived before this mounted shows only for what is left of
 * its time. Under `prefers-reduced-motion` the dice do not tumble: the result shows at once.
 */
export function ChaosDice({ rolls, lang }: ChaosDiceProps) {
  const { t } = useTranslation()
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)')
  const [dismissed, setDismissed] = useState(0)
  const [, tick] = useReducer((n: number) => n + 1, 0)
  const now = Date.now()
  const live = rolls.filter((r) => r.id > dismissed && now - r.at < DICE_MS)
  const tumbling = !reduce && live.some((r) => now - r.at < DICE_ROLL_MS)
  // While a die tumbles, a new face every step — but never past the moment one lands, so the panel lands on time (the toast
  // waits for it, Ruling 22); then one wake when the dice land and one when the panel goes.
  const moments = live.flatMap((r) => [r.at + DICE_ROLL_MS, r.at + DICE_MS]).filter((at) => at > now)
  const next = tumbling ? Math.min(now + TUMBLE_STEP_MS, ...moments) : Math.min(...moments)
  useEffect(() => {
    if (!Number.isFinite(next)) return
    const timer = setTimeout(tick, Math.max(0, next - Date.now()) + 16)
    return () => clearTimeout(timer)
  }, [next])

  if (live.length === 0) return null
  return (
    <section className={s.diceSlot} data-surface="night" aria-label={t('chaos.dice.label')}>
      {/* The panel is one button, as the herald's band is: a tap or a key puts it away (BP-41 Task 9 M7). */}
      <button type="button" className={s.dicePanel} onClick={() => setDismissed(Math.max(...live.map((r) => r.id)))}>
        {live.slice(-4).map((roll) => {
          const rolling = !reduce && now - roll.at < DICE_ROLL_MS
          // A tumbling die shows a face that changes every step, from the clock: no state to keep, and nothing random to test.
          const faces = rolling ? roll.dice.map((_, i) => 1 + ((Math.floor(now / TUMBLE_STEP_MS) + i * 2 + roll.id) % 6)) : roll.dice
          return (
            <span key={roll.id} className={s.diceRow} data-rolling={rolling ? 'true' : undefined} data-herald={roll.result.herald === true ? 'true' : undefined}>
              <strong className={s.diceName}>{roll.name}</strong>
              <span className={s.diceFaces} role="img" aria-label={rolling ? t('chaos.dice.rolling') : t('chaos.dice.faces', { dice: diceText(roll.dice) })}>
                {faces.map((face, i) => (
                  <Die key={i} face={face} tumbling={rolling} />
                ))}
              </span>
              <span className={s.diceResult} role="status">
                {rolling ? t('chaos.dice.rolling') : rollText(roll.result, t, lang)}
              </span>
            </span>
          )
        })}
      </button>
    </section>
  )
}
