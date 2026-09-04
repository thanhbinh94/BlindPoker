import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type Language } from '../i18n/index.js'
import s from './lobby.module.css'

export interface LanguageSwitchProps {
  lang: Language
  onChange: (l: Language) => void
}

/** Two-state segmented control; each half is a real button carrying its own `aria-pressed`. */
export function LanguageSwitch({ lang, onChange }: LanguageSwitchProps) {
  const { t } = useTranslation()
  return (
    <div className={s.segment} role="group" aria-label={t('nav.language')}>
      {SUPPORTED_LANGUAGES.map((code) => (
        <button
          key={code}
          type="button"
          className={s.segBtn}
          aria-pressed={code === lang}
          onClick={() => onChange(code)}
        >
          {t(`common:language.${code}`)}
        </button>
      ))}
    </div>
  )
}
