import { applyTheme, setLanguage, type Language, type ThemeMode } from '@bp/ui-kit'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deviceStorage } from './session.js'

/** Shared with the Normal edition on purpose: the two apps read the same preference off the same device. */
export const THEME_KEY = 'bp.theme'

/** Dark is the room's default; only an explicit `light` turns the lamps up. */
export function loadTheme(storage: Storage | null = deviceStorage()): ThemeMode {
  try {
    return storage?.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

export function saveTheme(mode: ThemeMode, storage: Storage | null = deviceStorage()): void {
  try {
    storage?.setItem(THEME_KEY, mode)
  } catch {
    /* storage unavailable: the theme lasts for this visit only */
  }
}

export interface ThemePref {
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => void
}

/**
 * The one way the theme ever changes: paint the root, remember the choice, re-render the control. Boot applies
 * the stored value before React runs (`main.tsx`), so there is no flash of the wrong palette.
 */
export function useThemePref(): ThemePref {
  const [theme, setState] = useState(loadTheme)
  const setTheme = useCallback((mode: ThemeMode) => {
    applyTheme(document.documentElement, mode)
    saveTheme(mode)
    setState(mode)
  }, [])
  return { theme, setTheme }
}

export interface LanguagePref {
  lang: Language
  setLang: (lang: Language) => void
}

export function languageOf(raw: string | undefined): Language {
  return raw === 'en' ? 'en' : 'vi'
}

/**
 * The language half of the same idea. `setLanguage` persists to `bp.lang` itself; every component reading
 * `useTranslation` re-renders on the change, so nothing else has to be told.
 */
export function useLanguagePref(): LanguagePref {
  const { i18n } = useTranslation()
  const lang = languageOf(i18n.resolvedLanguage ?? i18n.language)
  const setLang = useCallback(
    (next: Language) => {
      void setLanguage(i18n, next, deviceStorage())
    },
    [i18n],
  )
  return { lang, setLang }
}
