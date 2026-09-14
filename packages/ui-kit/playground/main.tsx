import { useEffect, useMemo, useReducer, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { I18nextProvider } from 'react-i18next'
import { SUPPORTED_LANGUAGES, createI18n, setLanguage, type Language } from '../src/i18n/index.js'
import { LobbyScreen } from '../src/screens/LobbyScreen.js'
import { RoomScreen } from '../src/screens/RoomScreen.js'
import { THEME_MODES, applyTheme, type ThemeMode } from '../src/theme/index.js'
import { Avatar2dPage } from './avatar2d.js'
import { PLAYGROUND_MODES, PLAYGROUND_SEAT_COUNTS, createMockClient, type PlaygroundMode, type PlaygroundSeats } from './mock-client.js'
import '../src/theme/index.css'

type View = 'room' | 'lobby'

const MODE_LABEL: Record<PlaygroundMode, string> = { holdem: "Hold'em", blindA: 'Blind A (pure luck)', blindB: 'Blind B (play or fold)' }

function App() {
  const [mode, setMode] = useState<PlaygroundMode>('holdem')
  const [view, setView] = useState<View>('room')
  const [theme, setTheme] = useState<ThemeMode>('dark')
  const [lang, setLang] = useState<Language>('vi')
  const [seats, setSeats] = useState<PlaygroundSeats>(4)
  const [stacked, setStacked] = useState(false)
  const [, bump] = useReducer((n: number) => n + 1, 0)

  const i18n = useMemo(() => createI18n({ language: 'vi', storage: null }), [])
  const client = useMemo(() => createMockClient(mode, seats, bump), [mode, seats])

  useEffect(() => () => client.stop(), [client])
  useEffect(() => applyTheme(document.documentElement, theme), [theme])
  useEffect(() => void setLanguage(i18n, lang, null), [i18n, lang])

  return (
    <I18nextProvider i18n={i18n}>
      <div className="pg">
        <div className="pg-bar" role="group" aria-label="Playground controls">
          <label className="pg-ctl">
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as PlaygroundMode)}>
              {PLAYGROUND_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </select>
          </label>
          <label className="pg-ctl">
            View
            <select value={view} onChange={(e) => setView(e.target.value as View)}>
              <option value="room">Room</option>
              <option value="lobby">Lobby</option>
            </select>
          </label>
          <label className="pg-ctl">
            Seats
            <select value={seats} onChange={(e) => setSeats(Number(e.target.value) as PlaygroundSeats)}>
              {PLAYGROUND_SEAT_COUNTS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <label className="pg-ctl">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeMode)}>
              {THEME_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="pg-ctl">
            Language
            <select value={lang} onChange={(e) => setLang(e.target.value as Language)}>
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="pg-ctl">
            <input type="checkbox" checked={stacked} onChange={(e) => setStacked(e.target.checked)} />
            Force stack layout
          </label>
          <button type="button" className="pg-btn" onClick={client.nextHand}>
            Next hand
          </button>
        </div>

        <div className="pg-screen">
          {view === 'lobby' ? (
            <LobbyScreen client={client.api} lang={lang} onLanguage={setLang} onEnteredRoom={() => setView('room')} />
          ) : (
            <RoomScreen client={client.api} lang={lang} onLeft={() => setView('lobby')} layout={stacked ? 'stack' : undefined} />
          )}
        </div>
      </div>
    </I18nextProvider>
  )
}

// `#avatar2d` is a static gallery of every placeholder PNG layer T1 produced — no mock client, no rooms, nothing
// the rest of this harness sets up. A plain hash check is enough: it is a dev-only page reached by typing the
// URL, not a route `useHashRoute` needs to know about.
// No <StrictMode>: its double-invoked render would spin up a second engine driver behind the first.
createRoot(document.getElementById('root')!).render(window.location.hash === '#avatar2d' ? <Avatar2dPage /> : <App />)
