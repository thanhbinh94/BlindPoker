import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type Language } from '../i18n/index.js'
import { Segmented } from '../primitives/Segmented.js'

export interface LanguageSwitchProps {
  lang: Language
  onChange: (l: Language) => void
}

/** The two languages as a `Segmented` pill; each half is a real button carrying its own `aria-pressed`. */
export function LanguageSwitch({ lang, onChange }: LanguageSwitchProps) {
  const { t } = useTranslation()
  return (
    <Segmented
      options={SUPPORTED_LANGUAGES.map((code) => ({ value: code, label: t(`common:language.${code}`) }))}
      value={lang}
      onChange={onChange}
      label={t('nav.language')}
    />
  )
}
