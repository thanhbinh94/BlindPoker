import { HAND_CATEGORY_KEYS, RANK_CHARS, SUIT_CHARS, rankOf, suitOf, type Card, type ErrorCode, type HandCategory } from '@bp/core'
import i18next, { type TFunction, type i18n } from 'i18next'
import { initReactI18next } from 'react-i18next'
import enCommon from './locales/en/common.json'
import enGame from './locales/en/game.json'
import viCommon from './locales/vi/common.json'
import viGame from './locales/vi/game.json'

export const SUPPORTED_LANGUAGES = ['vi', 'en'] as const
export type Language = (typeof SUPPORTED_LANGUAGES)[number]
export const LANGUAGE_STORAGE_KEY = 'bp.lang'

const isLanguage = (x: unknown): x is Language => typeof x === 'string' && (SUPPORTED_LANGUAGES as readonly string[]).includes(x)

export function detectLanguage(storage: Storage | null, navigatorLanguage: string | undefined): Language {
  let stored: string | null = null
  try {
    stored = storage?.getItem(LANGUAGE_STORAGE_KEY) ?? null
  } catch {
    stored = null
  }
  if (isLanguage(stored)) return stored
  if (navigatorLanguage === undefined) return 'vi'
  return navigatorLanguage.toLowerCase().startsWith('vi') ? 'vi' : 'en'
}

export interface CreateI18nOptions {
  language?: Language
  storage?: Storage | null
  navigatorLanguage?: string
  /** Extra namespaces per language (e.g. the Normal app's `normal` namespace). */
  extraResources?: Partial<Record<Language, Record<string, object>>>
}

export function createI18n(opts: CreateI18nOptions = {}): i18n {
  const storage = opts.storage === undefined ? (typeof localStorage === 'undefined' ? null : localStorage) : opts.storage
  const navigatorLanguage = Object.hasOwn(opts, 'navigatorLanguage')
    ? opts.navigatorLanguage
    : typeof navigator === 'undefined'
      ? undefined
      : navigator.language
  const language = opts.language ?? detectLanguage(storage, navigatorLanguage)
  const instance = i18next.createInstance()
  instance.use(initReactI18next)
  void instance.init({
    lng: language,
    fallbackLng: 'vi',
    supportedLngs: [...SUPPORTED_LANGUAGES],
    defaultNS: 'game',
    ns: ['common', 'game', ...Object.keys(opts.extraResources?.vi ?? {})],
    resources: {
      en: { common: enCommon, game: enGame, ...(opts.extraResources?.en ?? {}) },
      vi: { common: viCommon, game: viGame, ...(opts.extraResources?.vi ?? {}) },
    },
    interpolation: { escapeValue: false },
    initImmediate: false,
    returnNull: false,
  })
  return instance
}

export async function setLanguage(instance: i18n, lang: Language, storage: Storage | null): Promise<void> {
  await instance.changeLanguage(lang)
  try {
    storage?.setItem(LANGUAGE_STORAGE_KEY, lang)
  } catch {
    /* storage unavailable */
  }
}

export function cardLabel(card: Card, t: TFunction): string {
  const rank = t(`game:card.rank.${RANK_CHARS[rankOf(card)]}`)
  const suit = t(`game:card.suit.${SUIT_CHARS[suitOf(card)]}`)
  return t('game:card.of', { rank, suit })
}

export function handLabel(category: HandCategory, t: TFunction): string {
  return t(`game:${HAND_CATEGORY_KEYS[category]}`)
}

export function errorLabel(code: ErrorCode, t: TFunction): string {
  return t(`common:errors.${code}`, { defaultValue: t('common:errors.INTERNAL') })
}

export * from './format.js'
