import { useTranslation } from 'react-i18next'
import { formatPoints, type Language } from '../i18n/index.js'
import s from './table.module.css'

export interface PotProps {
  pot: number
  carryOver: number
  /** Bumped on every `POT_UPDATED`; a change replays the chip pulse (CSS only, via a remount key). */
  pulse: number
  lang: Language
}

/** Gold chip stack + the running total, with the carried-over pot called out separately. */
export function Pot({ pot, carryOver, pulse, lang }: PotProps) {
  const { t } = useTranslation()
  const carryText = `${t('labels.carryOver')} ${formatPoints(carryOver, lang)}`
  return (
    <div className={s.pot}>
      <span key={pulse} className={s.potChips} aria-hidden="true">
        <svg viewBox="0 0 34 26" className={s.chipStack}>
          <ellipse className={s.chipShadow} cx="17" cy="22" rx="13" ry="3.4" />
          <ellipse className={s.chipB} cx="17" cy="17.5" rx="11" ry="4.4" />
          <ellipse className={s.chipA} cx="17" cy="13" rx="11" ry="4.4" />
          <ellipse className={s.chipB} cx="17" cy="8.5" rx="11" ry="4.4" />
          <ellipse className={s.chipTop} cx="17" cy="8.5" rx="6" ry="2.4" />
        </svg>
      </span>
      <span className={s.potLabel}>{t('labels.pot')}</span>
      <strong key={`v${pulse}`} className={s.potValue}>
        {formatPoints(pot, lang)}
      </strong>
      {carryOver > 0 ? <span className={s.potCarry}>{carryText}</span> : null}
    </div>
  )
}
