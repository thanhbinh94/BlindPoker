import { createI18n, type Language } from '@bp/ui-kit'
import { render, type RenderResult } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import enNormal from './locales/en/normal.json'
import viNormal from './locales/vi/normal.json'

export type I18n = ReturnType<typeof createI18n>

/** The app's i18n instance, without persistence — every test starts on a known language. */
export function makeI18n(language: Language = 'vi'): I18n {
  return createI18n({ language, storage: null, extraResources: { vi: { normal: viNormal }, en: { normal: enNormal } } })
}

export function renderWithI18n(ui: ReactElement, instance: I18n = makeI18n()): RenderResult & { i18n: I18n } {
  return { ...render(<I18nextProvider i18n={instance}>{ui}</I18nextProvider>), i18n: instance }
}
