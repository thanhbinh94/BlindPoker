import { blindBuyInCap, ECONOMY } from '@bp/core'
import { useId, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatPoints, type Language } from '../i18n/index.js'
import { Field } from '../primitives/Field.js'
import { Select } from '../primitives/Select.js'
import { cx } from '../primitives/cx.js'
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
  const bigBlind = ECONOMY.holdemBlindTiers[tierIndex]?.bigBlind ?? 0
  // The window is counted in big blinds, which a number field alone never said (layout audit C9): each field
  // names the unit and what it comes to in points at the chosen stakes.
  const inPoints = (bb: number): string =>
    t('create.buyInHint', { bb, points: `${formatPoints(bb * bigBlind, lang)} ${t('common:units.pointsShort')}` })
  const tiers = ECONOMY.holdemBlindTiers.map((tier, index) => ({
    value: index,
    label: `${formatPoints(tier.smallBlind, lang)}/${formatPoints(tier.bigBlind, lang)}`,
  }))

  return (
    <>
      <Field label={t('create.blindTier')}>
        <Select value={tierIndex} options={tiers} disabled={disabled} onChange={onTierIndex} />
      </Field>
      <Field label={t('create.minBuyIn')} hint={inPoints(minBuyInBB)}>
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
      <Field label={t('create.maxBuyIn')} hint={inPoints(maxBuyInBB)}>
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
  squeeze: boolean
  onSqueeze: (on: boolean) => void
  /**
   * "Poker hỗn loạn" (Plan 37): the tick and the card cycle beside it. Absent where the host has no chaos (Lite), and
   * then nothing about it is drawn.
   */
  chaos?: { on: boolean; onChange: (on: boolean) => void; cycle: 5 | 10; onCycle: (cycle: 5 | 10) => void }
  disabled: boolean
  lang: Language
}

/**
 * Blind Poker: how many face-down cards, whether players may fold, the fixed wager, the bot filler, whether the
 * cards are turned by hand ("Nặn bài", Plan 21) and whether the table plays with chaos cards (Plan 37).
 */
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
  squeeze,
  onSqueeze,
  chaos,
  disabled,
  lang,
}: BlindFieldsProps) {
  const { t } = useTranslation()
  const hintId = useId()
  const chaosHintId = useId()
  const wagers = ECONOMY.blindWagerTiers.map((n) => ({ value: n, label: formatPoints(n, lang) }))
  const bots = Array.from({ length: maxBots + 1 }, (_, n) => ({ value: n, label: String(n) }))
  // The table limit the wager sets: ten wagers at a plain Blind table, none at all with "Poker hỗn loạn" ticked (BP-39, spec
  // 2026-10-27 §3.7) — the seat brings the whole balance there.
  const cap = blindBuyInCap({ fixedWager, chaosCycle: chaos?.on === true ? chaos.cycle : undefined })
  const limitHint =
    cap === null
      ? t('create.tableLimitNoneHint')
      : t('create.tableLimitHint', { points: `${formatPoints(cap, lang)} ${t('common:units.pointsShort')}`, times: ECONOMY.blindTableLimitMultiplier })

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
      <Field
        label={t('create.wager')}
        hint={limitHint}
      >
        <Select value={fixedWager} options={wagers} disabled={disabled} onChange={onFixedWager} />
      </Field>
      {/* The wager's hint runs two lines, so its row is taller than the bot count by about a line and a half: the "Nặn bài"
          box takes that slack, under the bots and level with the hint's last line, and Blind's fields end where they did.
          Not a `Field`, which would re-label the box with its own caption: the box is its own label, as the form's other
          checkboxes are, so its name is just "Nặn bài". What it does to the round (a fixed 20 s, over early when everyone
          has turned) is its description, said to a screen reader and not drawn: the timer's cell, which turns into that
          length while the box is ticked, shows it. */}
      <div className={s.botsCell}>
        <Field label={t('create.botCount')}>
          <Select value={botCount} options={bots} disabled={disabled} onChange={onBotCount} />
        </Field>
        <label className={cx(s.check, s.checkCompact)}>
          <input
            className={s.checkbox}
            type="checkbox"
            checked={squeeze}
            disabled={disabled}
            aria-describedby={hintId}
            onChange={(event) => onSqueeze(event.target.checked)}
          />
          {t('create.squeeze')}
        </label>
        <span id={hintId} className="visually-hidden">
          {t('create.squeezeHint')}
        </span>
      </div>
      {/* Poker hỗn loạn: one row under the others, the tick on the left and the cycle it applies to on the right (the select
          is its own caption through `aria-label`, so the row stays one tap tall). Its height is in the modeFields reserve. */}
      {chaos === undefined ? null : (
        <div className={cx(s.wide, s.chaosRow)}>
          <label className={s.check}>
            <input
              className={s.checkbox}
              type="checkbox"
              checked={chaos.on}
              disabled={disabled}
              aria-describedby={chaosHintId}
              onChange={(event) => chaos.onChange(event.target.checked)}
            />
            {t('create.chaos')}
          </label>
          <span className={s.chaosCycle}>
            <Select<5 | 10>
              aria-label={t('create.chaosCycle')}
              value={chaos.cycle}
              options={ECONOMY.chaosCycles.map((n) => ({ value: n, label: t('create.chaosCycleOption', { count: n }) }))}
              disabled={disabled || !chaos.on}
              onChange={chaos.onCycle}
            />
          </span>
          <span id={chaosHintId} className="visually-hidden">
            {t('create.chaosHint')}
          </span>
        </div>
      )}
    </>
  )
}
