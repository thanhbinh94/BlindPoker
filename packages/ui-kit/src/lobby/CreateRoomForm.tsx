import { ECONOMY, validateRoomConfig, type ErrorCode, type RoomConfig } from '@bp/core'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { errorLabel, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { Segmented } from '../primitives/Segmented.js'
import { Field } from '../primitives/Field.js'
import { Select } from '../primitives/Select.js'
import { cx } from '../primitives/cx.js'
import { BlindFields, HoldemFields } from './CreateRoomFields.js'
import s from './lobby.module.css'

export type RoomMode = 'holdem' | 'blind'

export interface CreateRoomFormProps {
  onSubmit: (config: RoomConfig) => void | Promise<unknown>
  busy?: boolean
  initialMode?: RoomMode
  lang: Language
}

const MODES: RoomMode[] = ['holdem', 'blind']
const DEFAULT_TIMER: Record<RoomMode, number> = { holdem: 30, blind: 15 }
const range = (from: number, to: number): number[] => Array.from({ length: to - from + 1 }, (_, i) => from + i)

interface ConfigDraft {
  name: string
  isPrivate: boolean
  password: string
  mode: RoomMode
  minBuyInBB: number
  maxBuyInBB: number
  botCount: number
  maxPlayers: number
}

/**
 * `validateRoomConfig` answers with an `ErrorCode` and a developer-facing English sentence. The code is
 * translatable and the sentence is not, so the sentence never reaches the page: the failing field is re-derived
 * here — from this form's own state, in the same order core checks it — and named in the player's language. Every
 * refusal a *user* can produce through these controls is covered; anything else shows the code's wording alone.
 */
function hintKeyFor(draft: ConfigDraft): string | null {
  const name = draft.name.trim()
  if (name.length < 1 || name.length > 30) return 'create.hint.name'
  if (draft.isPrivate && draft.password !== '' && (draft.password.length < 4 || draft.password.length > 20)) return 'create.hint.password'
  if (draft.mode === 'holdem') {
    const { min, max } = ECONOMY.buyInBBRange
    if (draft.minBuyInBB > draft.maxBuyInBB || draft.minBuyInBB < min || draft.maxBuyInBB > max) return 'create.hint.buyIn'
    return null
  }
  if (draft.botCount > draft.maxPlayers - 1) return 'create.hint.botCount'
  return null
}

/**
 * Room settings per spec §11.2. Every option comes from `ECONOMY`, so the form can only offer values the
 * server accepts; the raw draft still goes through `validateRoomConfig`, and it is the *validated* config
 * (defaults applied, name trimmed) that reaches `onSubmit`.
 */
export function CreateRoomForm({ onSubmit, busy = false, initialMode = 'holdem', lang }: CreateRoomFormProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [mode, setMode] = useState<RoomMode>(initialMode)
  const [seats, setSeats] = useState<number>(ECONOMY.defaultMaxPlayers)
  const [timer, setTimer] = useState<number>(DEFAULT_TIMER[initialMode])
  const [isPrivate, setIsPrivate] = useState(false)
  const [password, setPassword] = useState('')
  const [autoStart, setAutoStart] = useState(false)
  const [tierIndex, setTierIndex] = useState(0)
  const [minBuyInBB, setMinBuyInBB] = useState<number>(ECONOMY.defaultMinBuyInBB)
  const [maxBuyInBB, setMaxBuyInBB] = useState<number>(ECONOMY.defaultMaxBuyInBB)
  const [holeCards, setHoleCards] = useState<2 | 3>(2)
  const [decisionMode, setDecisionMode] = useState<'none' | 'playOrFold'>('playOrFold')
  const [fixedWager, setFixedWager] = useState<number>(ECONOMY.blindWagerTiers[0])
  const [botCount, setBotCount] = useState(0)
  const [error, setError] = useState<{ code: ErrorCode; hintKey: string | null } | null>(null)

  // Switching mode narrows the seat cap, the timer set and the bot ceiling: derive rather than reset,
  // so a mode round-trip never loses what the host already picked.
  const seatCap = mode === 'holdem' ? ECONOMY.maxPlayersHoldem : ECONOMY.maxPlayersBlind
  const maxPlayers = Math.min(seats, seatCap)
  const timers: readonly number[] = mode === 'holdem' ? ECONOMY.holdemTurnTimers : ECONOMY.blindTurnTimers
  const turnTimerSec = timers.includes(timer) ? timer : DEFAULT_TIMER[mode]
  const bots = Math.min(botCount, maxPlayers - 1)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) return
    const tier = ECONOMY.holdemBlindTiers[tierIndex] ?? ECONOMY.holdemBlindTiers[0]
    const parsed = validateRoomConfig({
      name,
      mode,
      maxPlayers,
      isPrivate,
      turnTimerSec,
      autoStart,
      password: isPrivate && password !== '' ? password : undefined,
      holdem: mode === 'holdem' ? { ...tier, minBuyInBB, maxBuyInBB } : undefined,
      blind: mode === 'blind' ? { holeCards, decisionMode, fixedWager, botCount: bots } : undefined,
    })
    if (!parsed.ok) {
      setError({ code: parsed.code, hintKey: hintKeyFor({ name, isPrivate, password, mode, minBuyInBB, maxBuyInBB, botCount: bots, maxPlayers }) })
      return
    }
    setError(null)
    void onSubmit(parsed.value)
  }

  return (
    <form className={s.form} onSubmit={submit} noValidate>
      <div className={s.grid}>
        <span className={s.wide}>
          <Field label={t('create.name')}>
            <input
              className={s.input}
              type="text"
              value={name}
              maxLength={30}
              autoComplete="off"
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </Field>
        </span>

        <span className={s.wide}>
          <span className={s.label}>{t('create.mode')}</span>
          <Segmented
            options={MODES.map((key) => ({ value: key, label: t(`mode.${key}`) }))}
            value={mode}
            onChange={setMode}
            label={t('create.mode')}
            disabled={busy}
          />
        </span>

        <Field label={t('create.maxPlayers')}>
          <Select<number>
            value={maxPlayers}
            options={range(2, seatCap).map((n) => ({ value: n, label: String(n) }))}
            disabled={busy}
            onChange={setSeats}
          />
        </Field>
        <Field label={t('create.turnTimer')}>
          <Select<number>
            value={turnTimerSec}
            options={timers.map((n) => ({ value: n, label: t('common:time.seconds', { count: n }) }))}
            disabled={busy}
            onChange={setTimer}
          />
        </Field>

        {mode === 'holdem' ? (
          <HoldemFields
            tierIndex={tierIndex}
            onTierIndex={setTierIndex}
            minBuyInBB={minBuyInBB}
            maxBuyInBB={maxBuyInBB}
            onMinBuyInBB={setMinBuyInBB}
            onMaxBuyInBB={setMaxBuyInBB}
            disabled={busy}
            lang={lang}
          />
        ) : (
          <BlindFields
            holeCards={holeCards}
            onHoleCards={setHoleCards}
            decisionMode={decisionMode}
            onDecisionMode={setDecisionMode}
            fixedWager={fixedWager}
            onFixedWager={setFixedWager}
            botCount={bots}
            onBotCount={setBotCount}
            maxBots={maxPlayers - 1}
            disabled={busy}
            lang={lang}
          />
        )}

        <label className={cx(s.check, s.wide)}>
          <input
            className={s.checkbox}
            type="checkbox"
            checked={isPrivate}
            disabled={busy}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          {t('create.private')}
        </label>

        {isPrivate ? (
          <span className={s.wide}>
            <Field label={t('create.password')}>
              <input
                className={s.input}
                type="password"
                value={password}
                minLength={4}
                maxLength={20}
                autoComplete="new-password"
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
          </span>
        ) : null}

        <label className={cx(s.check, s.wide)}>
          <input
            className={s.checkbox}
            type="checkbox"
            checked={autoStart}
            disabled={busy}
            onChange={(event) => setAutoStart(event.target.checked)}
          />
          {t('create.autoStart')}
        </label>
      </div>

      {error === null ? null : (
        <p className={s.alert} role="alert">
          <strong>{errorLabel(error.code, t)}</strong>
          {error.hintKey === null ? null : <span>{t(error.hintKey)}</span>}
        </p>
      )}

      <div className={s.formFoot}>
        <Button type="submit" variant="gold" size="lg" loading={busy}>
          {t('create.submit')}
        </Button>
      </div>
    </form>
  )
}
