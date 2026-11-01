import { useEffect, useMemo, useRef, useState } from 'react'
import { I18nextProvider } from 'react-i18next'
import { createI18n } from '../src/i18n/index.js'
import type { ClientEntrance, ClientHerald } from '../src/client/types.js'
import { attachGestureUnlock, createSoundEngine, type SoundEngine, type SoundOutcome } from '../src/sound/engine.js'
import { MuteButton } from '../src/sound/MuteButton.js'
// Dev-only: the playground may name the stinger table itself. The package index keeps `stingers.ts` out of Normal's entry chunk.
import { STINGER_IDS, STINGER_SECONDS, type StingerId } from '../src/sound/stingers.js'
import screens from '../src/screens/screens.module.css'
import { ChaosHerald } from '../src/table/ChaosHerald.js'
import { DICE_ROLL_MS } from '../src/table/chaos-detail.js'
import { EntranceBand } from '../src/table/EntranceBand.js'

/** What each stinger is heard with: the entrance band of its title, or the BP-41 band of its moment. */
type Band = { kind: 'entrance'; title: ClientEntrance['title'] } | { kind: 'herald'; herald: ClientHerald['kind']; dice?: number[] }

const BANDS: Record<StingerId, Band> = {
  'entrance.god': { kind: 'entrance', title: 'god' },
  'entrance.demigod': { kind: 'entrance', title: 'demigod' },
  'entrance.godslayer': { kind: 'entrance', title: 'godslayer' },
  'moment.ascend': { kind: 'herald', herald: 'god' },
  'moment.demigod': { kind: 'herald', herald: 'demigod' },
  'moment.godslain': { kind: 'herald', herald: 'godslain' },
  'moment.jackpot': { kind: 'herald', herald: 'dice', dice: [6, 6, 6] },
}

const SAMPLE_NAME = 'Lan'
/** How long a band stays up: the room's own `ENTRANCE_MS` / `HERALD_MS`. */
const BAND_MS = 3_000
/** The stingers load by `import()` on the first unlock; "Phát" waits this long for them before it gives up. */
const LOAD_WAIT_MS = 4_000
const POLL_MS = 50

/** `at` is fixed when Phát is pressed: a band re-read at every render would start its 3 s over. */
type Showing = { n: number; band: Band; at: number }

/**
 * `#sounds` (BP-42, Task 7): one row per stinger with its id and length. "Phát" plays it through a real engine (the click
 * unlocks the audio, and the page waits for the lazy stingers) and puts up the band the room would show with it — the three
 * entrance bands with a sample name, and the BP-41 herald for the four moments. A mute button at the top is the room's own.
 */
export function SoundsPage() {
  const i18n = useMemo(() => createI18n({ language: 'vi', storage: null }), [])
  const engine = useMemo<SoundEngine>(() => createSoundEngine(), [])
  const [showing, setShowing] = useState<Showing | null>(null)
  const [last, setLast] = useState<{ id: StingerId; outcome: SoundOutcome } | null>(null)
  const counter = useRef(0)
  const clear = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => attachGestureUnlock(engine), [engine])
  useEffect(
    () => () => {
      if (clear.current !== null) clearTimeout(clear.current)
    },
    [],
  )

  const present = (id: StingerId): void => {
    counter.current += 1
    setShowing({ n: counter.current, band: BANDS[id], at: Date.now() })
    if (clear.current !== null) clearTimeout(clear.current)
    clear.current = setTimeout(() => setShowing(null), BAND_MS + 100)
  }

  const play = (id: StingerId): void => {
    engine.unlock()
    present(id)
    const started = Date.now()
    const attempt = (): void => {
      const outcome = engine.play(id, { preempt: true })
      // 'blocked' is "not loaded or not running yet": the click has just asked for both, so ask again shortly.
      if (outcome === 'blocked' && Date.now() - started < LOAD_WAIT_MS) {
        setTimeout(attempt, POLL_MS)
        return
      }
      setLast({ id, outcome })
    }
    attempt()
  }

  const entrance: ClientEntrance | null =
    showing?.band.kind === 'entrance'
      ? { id: showing.n, title: showing.band.title, seat: 1, playerId: 'p', name: SAMPLE_NAME, at: showing.at }
      : null
  const heralds: ClientHerald[] =
    showing?.band.kind === 'herald'
      ? [
          {
            id: showing.n,
            kind: showing.band.herald,
            seat: 1,
            name: SAMPLE_NAME,
            // A 6-6-6 band shows from the dice landing: back-date the roll so the audition shows it at once.
            at: showing.band.herald === 'dice' ? showing.at - DICE_ROLL_MS : showing.at,
            ...(showing.band.dice === undefined ? {} : { dice: showing.band.dice, amount: 1_000_000 }),
          },
        ]
      : []

  return (
    <I18nextProvider i18n={i18n}>
      <main style={{ minHeight: '100dvh', padding: '20px 16px', background: 'var(--bg, #10161c)', color: 'var(--ink, #eee)', font: '14px var(--font-body, system-ui)' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>Sounds</h1>
          <MuteButton engine={engine} />
          <span data-testid="last-outcome" style={{ color: 'var(--ink-muted, #9aa)' }}>
            {last === null ? 'not played yet' : `${last.id}: ${last.outcome}`}
          </span>
        </header>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8, maxWidth: 520 }}>
          {STINGER_IDS.map((id) => (
            <li key={id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', border: '1px solid var(--line, #345)', borderRadius: 8 }}>
              <code style={{ flex: 1 }}>{id}</code>
              <span style={{ color: 'var(--ink-muted, #9aa)' }}>{STINGER_SECONDS[id].toFixed(1)} s</span>
              <button type="button" className="pg-btn" data-stinger={id} onClick={() => play(id)}>
                Phát
              </button>
            </li>
          ))}
        </ul>
      </main>
      <div className={screens.moments} data-surface="night">
        <EntranceBand entrance={entrance} onDismiss={() => setShowing(null)} />
        <ChaosHerald heralds={heralds} lang="vi" hold={null} />
      </div>
    </I18nextProvider>
  )
}
