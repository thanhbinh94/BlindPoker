import { parseCard } from '@bp/core'
import { useMemo, useState, type CSSProperties } from 'react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../src/i18n/index.js'
import { PeelCard } from '../src/table/PeelCard.js'
import type { CardSize } from '../src/table/Card.js'

/** The cards on the page: the two sizes a seat draws, and one blown up (`--card-lg`) to look at the fold closely. */
const CARDS: { id: string; card: string; size: CardSize; width?: string }[] = [
  { id: 'md', card: 'Ah', size: 'md' },
  { id: 'lg', card: 'Kd', size: 'lg' },
  { id: 'zoom', card: '7s', size: 'lg', width: '220px' },
]

/**
 * `#peel`: the squeeze's `PeelCard` alone on the felt (Plan 21, Task 6) — drag a card from any edge or corner, flick it,
 * or press "Lật" to open them all from outside; "Again" deals them face down anew. Each card says when it has reported
 * `onRevealed`. Until Task 7 puts the cards on a seat this is the only place to try the gesture by hand.
 */
export function PeelPage() {
  const i18n = useMemo(() => createI18n({ language: 'vi', storage: null }), [])
  const [round, setRound] = useState(0)
  const [open, setOpen] = useState(false)
  const [revealed, setRevealed] = useState<string[]>([])
  const again = (): void => {
    setRound((n) => n + 1)
    setOpen(false)
    setRevealed([])
  }
  return (
    <I18nextProvider i18n={i18n}>
      <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--felt, #0d3b36)' }}>
        <div style={{ display: 'flex', alignItems: 'end', gap: 48 }}>
          {CARDS.map(({ id, card, size, width }) => (
            <figure key={`${round}:${id}`} data-peel-demo={id} style={{ margin: 0, display: 'grid', justifyItems: 'center', gap: 8, ...(width ? ({ '--card-lg': width } as CSSProperties) : {}) }}>
              <PeelCard card={parseCard(card)} size={size} open={open} onRevealed={() => setRevealed((ids) => [...ids, id])} />
              <figcaption style={{ color: 'var(--ink-muted)', font: '12px var(--font-body)' }}>
                {id} {revealed.includes(id) ? '· revealed' : ''}
              </figcaption>
            </figure>
          ))}
          <div style={{ display: 'grid', gap: 8 }}>
            <button type="button" className="pg-btn" onClick={() => setOpen(true)}>
              Lật
            </button>
            <button type="button" className="pg-btn" onClick={again}>
              Again
            </button>
          </div>
        </div>
      </div>
    </I18nextProvider>
  )
}
