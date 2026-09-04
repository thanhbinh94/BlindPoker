import { ECONOMY } from '@bp/core'
import type { ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatPoints, type Language } from '../i18n/index.js'
import { Field } from '../primitives/Field.js'
import { Select } from '../primitives/Select.js'
import s from './lobby.module.css'

export interface HoldemFieldsProps {
  tierIndex: number
  onTierIndex: (i: number) => void
  minBuyInBB: number
  maxBuyInBB: number
  onMinBuyInBB: (n: number) => void
  onMaxBuyInBB: (n: number) => void
  disabled: boolean
  lang: Language
}

const toInt = (event: ChangeEvent<HTMLInputElement>): number => {
  const n = Number(event.target.value)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** Hold'em stakes: a blind tier from `ECONOMY` plus the buy-in window in big blinds. */
export function HoldemFields({
  tierIndex,
  onTierIndex,
  minBuyInBB,
  maxBuyInBB,
  onMinBuyInBB,
  onMaxBuyInBB,
  disabled,
  lang,
}: HoldemFieldsProps) {
  const { t } = useTranslation()
  const { min, max } = ECONOMY.buyInBBRange
  const tiers = ECONOMY.holdemBlindTiers.map((tier, index) => ({
    value: index,
    label: `${formatPoints(tier.smallBlind, lang)}/${formatPoints(tier.bigBlind, lang)}`,
  }))

  return (
    <>
      <Field label={t('create.blindTier')}>
        <Select value={tierIndex} options={tiers} disabled={disabled} onChange={onTierIndex} />
      </Field>
      <Field label={t('create.minBuyIn')}>
        <input
          className={s.input}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={String(minBuyInBB)}
          disabled={disabled}
          onChange={(event) => onMinBuyInBB(toInt(event))}
        />
      </Field>
      <Field label={t('create.maxBuyIn')}>
        <input
          className={s.input}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={String(maxBuyInBB)}
          disabled={disabled}
          onChange={(event) => onMaxBuyInBB(toInt(event))}
        />
      </Field>
    </>
  )
}

export interface BlindFieldsProps {
  holeCards: 2 | 3
  onHoleCards: (n: 2 | 3) => void
  decisionMode: 'none' | 'playOrFold'
  onDecisionMode: (m: 'none' | 'playOrFold') => void
  fixedWager: number
  onFixedWager: (n: number) => void
  botCount: number
  onBotCount: (n: number) => void
  maxBots: number
  disabled: boolean
  lang: Language
}

/** Blind Poker: how many face-down cards, whether players may fold, the fixed wager and the bot filler. */
export function BlindFields({
  holeCards,
  onHoleCards,
  decisionMode,
  onDecisionMode,
  fixedWager,
  onFixedWager,
  botCount,
  onBotCount,
  maxBots,
  disabled,
  lang,
}: BlindFieldsProps) {
  const { t } = useTranslation()
  const wagers = ECONOMY.blindWagerTiers.map((n) => ({ value: n, label: formatPoints(n, lang) }))
  const bots = Array.from({ length: maxBots + 1 }, (_, n) => ({ value: n, label: String(n) }))

  return (
    <>
      <Field label={t('create.holeCards')}>
        <Select<2 | 3>
          value={holeCards}
          options={[
            { value: 2, label: t('blind.cards2') },
            { value: 3, label: t('blind.cards3') },
          ]}
          disabled={disabled}
          onChange={onHoleCards}
        />
      </Field>
      <Field label={t('create.decisionMode')}>
        <Select<'none' | 'playOrFold'>
          value={decisionMode}
          options={[
            { value: 'playOrFold', label: t('blind.decision.playOrFold') },
            { value: 'none', label: t('blind.decision.none') },
          ]}
          disabled={disabled}
          onChange={onDecisionMode}
        />
      </Field>
      <Field label={t('create.wager')}>
        <Select value={fixedWager} options={wagers} disabled={disabled} onChange={onFixedWager} />
      </Field>
      <Field label={t('create.botCount')}>
        <Select value={botCount} options={bots} disabled={disabled} onChange={onBotCount} />
      </Field>
    </>
  )
}
