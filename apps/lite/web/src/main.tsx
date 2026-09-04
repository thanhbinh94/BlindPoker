import '@bp/ui-kit/theme.css'
import { applyTheme, createI18n } from '@bp/ui-kit'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { App } from './App.js'
import { createApi } from './api.js'
import enLite from './locales/en/lite.json'
import viLite from './locales/vi/lite.json'
import { loadTheme } from './prefs.js'

// Before React: the stored theme is on the root by the time the first frame paints, so the page never flashes
// the wrong palette. `index.html` ships `data-theme="dark"` for the frame before even this runs.
applyTheme(document.documentElement, loadTheme())

const i18n = createI18n({ extraResources: { vi: { lite: viLite }, en: { lite: enLite } } })

const host = document.getElementById('root')
if (host === null) throw new Error('#root is missing from index.html')

createRoot(host).render(
  <StrictMode>
    <I18nextProvider i18n={i18n}>
      <App api={createApi()} />
    </I18nextProvider>
  </StrictMode>,
)
