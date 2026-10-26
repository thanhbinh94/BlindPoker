import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AckOrError } from '../client/connection.js'
import type { ClientChaosDraft } from '../client/types.js'
import { cx } from '../primitives/cx.js'
import type { RoomFrame } from './frame.js'
import type { TableLayout } from './PokerTable.js'
import { TurnTimer } from './TurnTimer.js'
import s from './table.module.css'

/** The ring's size in the panel's head. */
const TIMER_PX = 36
/** …and in the short tier (`data-short`, whose box in the CSS is as big). */
const SHORT_TIMER_PX = 28

export interface ChaosDraftProps {
  draft: ClientChaosDraft
  serverNow: () => number
  /** `useGameClient().pickChaos`. A refusal (an error frame, a rejected request) lets the player choose again. */
  onPick: (offerId: string, cardId: string) => Promise<AckOrError>
  /** The room's table layout: the stack (a phone held upright) draws the panel as a sheet, three rows. Defaults to `ring`. */
  layout?: TableLayout
  /** The room's frame: `landscape` (a phone on its side) draws the compact row. Defaults to `desktop`. */
  frame?: RoomFrame
  /** The landscape frame's short tier (a stage under 300 px): the panel trims its padding, its type and its timer to fit. */
  short?: boolean
}

/**
 * The draft (spec 2026-10-26 §3.2): the three cards on offer to this player, the tier they share, and the 15 s the table
 * waits. A click or Enter on a card picks it, once; the panel then says it is waiting on the others. A spectator, and a
 * seat with no offer, see the countdown and who the table is waiting on instead. `RoomScreen` mounts it over the felt and
 * gives it the stage above the viewer's own seat.
 *
 * The three cards are real buttons in the offer's order, so Tab and Enter work; the first takes focus when the offer lands.
 */
export function ChaosDraft({ draft, serverNow, onPick, layout = 'ring', frame = 'desktop', short = false }: ChaosDraftProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const offer = draft.offer
  const offerId = offer?.offerId ?? null
  // The card clicked, before the server's ACK flips `draft.picked`: the panel answers at once, and a second click does nothing.
  const [chosen, setChosen] = useState<{ offerId: string; cardId: string } | null>(null)
  const sent = useRef<string | null>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  const mine = chosen !== null && chosen.offerId === offerId ? chosen.cardId : null
  const picked = draft.picked || mine !== null

  useEffect(() => {
    if (offerId !== null && !draft.picked) firstRef.current?.focus({ preventScroll: true })
  }, [offerId, draft.picked])

  const pick = (cardId: string): void => {
    if (offer === null || picked || sent.current === offer.offerId) return
    sent.current = offer.offerId
    setChosen({ offerId: offer.offerId, cardId })
    const undo = (): void => {
      sent.current = null
      setChosen(null)
    }
    onPick(offer.offerId, cardId).then((r) => (r.t === 'ACK' ? undefined : undo()), undo)
  }

  const tierName = t(`chaos.tier.${draft.tier}`)
  const title = offer === null ? t('chaos.draft.watching') : t('chaos.draft.title', { tier: tierName })

  return (
    <section className={s.draft} aria-labelledby={titleId} data-tier={draft.tier} data-layout={layout} data-frame={frame} data-short={short ? 'true' : undefined} data-state={offer === null ? 'watching' : picked ? 'picked' : 'choosing'}>
      <header className={s.draftHead}>
        <h2 id={titleId} className={s.draftTitle}>
          {title}
        </h2>
        <span className={s.draftTimer}>
          <TurnTimer deadlineAt={draft.deadlineAt} serverNow={serverNow} totalMs={draft.totalMs} size={short ? SHORT_TIMER_PX : TIMER_PX} />
        </span>
      </header>

      {offer === null ? null : (
        <div className={s.draftCards} role="group" aria-label={t('chaos.draft.group')}>
          {offer.cardIds.map((cardId, i) => {
            return (
              <button
                key={cardId}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                className={cx(s.draftCard, mine === cardId && s.draftCardChosen)}
                data-tier={draft.tier}
                data-chaos-card={cardId}
                aria-current={mine === cardId ? 'true' : undefined}
                aria-disabled={picked ? true : undefined}
                onClick={() => pick(cardId)}
              >
                <span className={s.draftCardTier}>{tierName}</span>
                <span className={s.draftCardName} data-part="name">{t(`chaos.cards.${cardId}.name`, { defaultValue: cardId })}</span>
                <span className={s.draftCardDesc}>{t(`chaos.cards.${cardId}.desc`, { defaultValue: '' })}</span>
              </button>
            )
          })}
        </div>
      )}

      {picked ? (
        <p className={s.draftWait} role="status">
          {t('chaos.draft.picked')}
        </p>
      ) : null}
    </section>
  )
}
