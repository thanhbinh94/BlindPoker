import { CHAOS_CARDS_SPEC, type ChaosBonusPayload, type ChaosTier, type HeldCardView } from '@bp/core'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AckOrError } from '../client/connection.js'
import { ChaosCardInfo, tierOfCardId, type ChaosCardInfoAction } from './ChaosCardInfo.js'
import s from './table.module.css'

/** How long a refusal stays written in the bonus hand (A14: there, not as the room's error slip over the result strip). */
export const BONUS_ERROR_MS = 4_000
/** The mark on a pressed card where its name has no room (a phone on its side). */
const ARMED_MARK = '✓'

const TIER_BY_ID = new Map(CHAOS_CARDS_SPEC.map((def) => [def.id, def.tier]))

export interface BonusHandProps {
  /** `ClientChaos.bonus`: the viewer's own bonus hand and the card pressed and not yet fired. */
  bonus: ChaosBonusPayload
  /**
   * Whether a card may be pressed now (spec 2026-10-27 §3.4): between hands, or in this hand's play-or-fold round with the
   * viewer dealt in and not folding — and nothing pressed already. Otherwise the cards still open, "Dùng" is greyed.
   */
  canUse: boolean
  /** `GameClientApi.playBonus`. A refusal is written in the hand for a few seconds. */
  onUse: (uid: number) => Promise<AckOrError>
  /** Where the room draws it: the felt's left edge (upright), the corner over "Tự động chơi" (sideways), the controls' row. */
  layout: 'stack' | 'landscape' | 'desktop'
}

/** One card of the hand as it is drawn: a held one, or the one pressed (`armed`, its uid and id only). */
interface Shown {
  uid: number
  cardId: string
  tier: ChaosTier
  handsLeft: number | null
  armed: boolean
}

/**
 * The viewer's bonus hand (BP-39, spec 2026-10-27 §3.4): up to three cards waiting to be played. A tap on one opens its
 * `ChaosCardInfo` — name, tier, the whole text — with "Dùng" under it: the second step that plays it, so the tap that reads
 * a card never plays it. The card pressed and not yet fired stays in the hand marked "Đã đặt dùng" until it fires (the server
 * then takes it away), and while it waits the others' "Dùng" is greyed. Nothing at all while the hand is empty.
 *
 * Only the viewer sees which cards these are; the other seats see a count on this seat (`Seat`'s badge).
 */
export function BonusHand({ bonus, canUse, onUse, layout }: BonusHandProps) {
  const { t } = useTranslation()
  const [pending, setPending] = useState<number | null>(null)
  const sending = useRef(false)
  const [error, setError] = useState<{ text: string; at: number } | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (error === null) return
    const timer = setTimeout(() => setError(null), BONUS_ERROR_MS)
    return () => clearTimeout(timer)
  }, [error])

  const shown: Shown[] = [
    ...(bonus.armed === null
      ? []
      : [{ uid: bonus.armed.uid, cardId: bonus.armed.cardId, tier: TIER_BY_ID.get(bonus.armed.cardId) ?? tierOfCardId(bonus.armed.cardId), handsLeft: null, armed: true }]),
    ...bonus.cards.map((c: HeldCardView) => ({ uid: c.uid, cardId: c.cardId, tier: c.tier, handsLeft: c.handsLeft, armed: false })),
  ]
  if (shown.length === 0) return null

  const refuse = (code: string | null): void => {
    if (!alive.current) return
    const fallback = t('common:errors.CHAOS_CANNOT_USE')
    setError({ text: code === null ? fallback : t(`common:errors.${code}`, { defaultValue: fallback }), at: Date.now() })
  }
  const play = (uid: number): void => {
    if (sending.current) return
    sending.current = true
    setPending(uid)
    setError(null)
    const done = (): void => {
      sending.current = false
      if (alive.current) setPending(null)
    }
    onUse(uid).then(
      (r) => {
        done()
        if (r.t === 'ERROR') refuse(r.code)
      },
      () => {
        done()
        refuse(null)
      },
    )
  }

  const usable = canUse && bonus.armed === null && pending === null
  return (
    <div className={s.bonusHand} role="group" data-surface="night" data-layout={layout} aria-label={t('chaos.bonus.title')} data-bonus-hand="">
      {/* Its name on a desktop; a card back on a phone, where the words have no room — the mark the other seats' count wears. */}
      <span className={s.bonusTitle} aria-hidden="true">
        {t('chaos.bonus.title')}
      </span>
      <span className={s.bonusMark} aria-hidden="true">
        <span className={s.bonusBack} />
      </span>
      <span className={s.bonusCards}>
        {shown.map((card) => {
          const name = t(`chaos.cards.${card.cardId}.name`, { defaultValue: card.cardId })
          const left = card.handsLeft === null ? null : t('chaos.handsLeft', { count: card.handsLeft })
          const label = `${name} (${t(`chaos.tier.${card.tier}`)})${left === null ? '' : ` · ${left}`}${card.armed ? ` · ${t('chaos.bonus.armed')}` : ''}`
          const action: ChaosCardInfoAction = card.armed
            ? { kind: 'status', label: t('chaos.bonus.armed') }
            : { kind: 'button', label: t('chaos.bonus.use'), disabled: !usable, onPress: () => play(card.uid) }
          return (
            <ChaosCardInfo key={card.uid} cardId={card.cardId} handsLeft={card.handsLeft} label={label} action={action} className={s.bonusTrigger}>
              <span className={s.bonusCard} data-tier={card.tier} data-armed={card.armed ? 'true' : undefined} data-uid={card.uid}>
                <span className={s.chaosIcon} data-tier={card.tier} aria-hidden="true">
                  <span className={s.chaosGlyph}>{name.trim().slice(0, 1).toUpperCase()}</span>
                  {card.armed ? <span className={s.bonusArmedMark}>{ARMED_MARK}</span> : null}
                </span>
                <span className={s.bonusName} aria-hidden="true">
                  {card.armed ? t('chaos.bonus.armed') : name}
                </span>
              </span>
            </ChaosCardInfo>
          )
        })}
      </span>
      {error === null ? null : (
        <p key={error.at} className={s.bonusError} role="alert">
          {error.text}
        </p>
      )}
    </div>
  )
}
