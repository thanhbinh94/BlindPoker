import { ECONOMY, validateRoomConfig, type ErrorCode, type RoomConfig } from '@bp/core'
import { useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, InputHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { errorLabel, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { Segmented } from '../primitives/Segmented.js'
import { Field } from '../primitives/Field.js'
import { Select } from '../primitives/Select.js'
import { cx } from '../primitives/cx.js'
import { BlindFields, HoldemFields } from './CreateRoomFields.js'
import s from './lobby.module.css'
import { randomRoomName } from './room-names.js'

export type RoomMode = 'holdem' | 'blind'

export interface CreateRoomFormProps {
  onSubmit: (config: RoomConfig) => void | Promise<unknown>
  busy?: boolean
  initialMode?: RoomMode
  lang: Language
  /**
   * Whether this host deals chaos cards: offers "Poker hỗn loạn" on a Blind table. The Normal edition says yes; Lite has
   * no chaos port, so it leaves this off and the option is not there.
   */
  chaosOffered?: boolean
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

/** The 🎲's face, a named value rather than a literal in the markup (`react/jsx-no-literals`, `eslint.config.js`). */
const ROLL_GLYPH = '\u{1F3B2}'

interface RoomNameInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string
  onChange: (name: string) => void
  /** Puts another name in the field; the field takes focus after it, with the new name selected. */
  onRoll: () => void
  /** Accessible name of the 🎲 (i18n string from the host). */
  rollLabel: string
}

/**
 * The name field and the 🎲 that rolls another name, in one row. It is the single control `Field` wires its label onto
 * — the `id` and the aria props `Field` hands down go to the input, as with `Select` — so the label points at the field
 * and not at the row. The button is as tall as the field (`--tap`), so the row, and with it the dialog, is as tall as the
 * field alone was. Focus returns to the field after a roll, with the new name selected, so the host can type over it at once.
 */
function RoomNameInput({ value, onChange, onRoll, rollLabel, disabled, ...rest }: RoomNameInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [rolls, setRolls] = useState(0)
  // Selecting waits for the commit: the field still holds the old name when the click handler runs, and React's write of
  // the new one would move the caret to the end, undoing a selection made earlier.
  useLayoutEffect(() => {
    if (rolls === 0) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [rolls])
  return (
    <span className={s.nameRow}>
      <input
        ref={inputRef}
        className={s.input}
        type="text"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        {...rest}
      />
      <Button
        variant="ghost"
        size="sm"
        className={s.rollName}
        aria-label={rollLabel}
        disabled={disabled}
        onClick={() => {
          onRoll()
          setRolls((n) => n + 1)
        }}
      >
        {ROLL_GLYPH}
      </Button>
    </span>
  )
}

/**
 * Room settings per spec §11.2. Every option comes from `ECONOMY`, so the form can only offer values the
 * server accepts; the raw draft still goes through `validateRoomConfig`, and it is the *validated* config
 * (defaults applied, name trimmed) that reaches `onSubmit`.
 */
export function CreateRoomForm({ onSubmit, busy = false, initialMode = 'holdem', lang, chaosOffered = false }: CreateRoomFormProps) {
  const { t } = useTranslation()
  // The dialog opens with a name already in the field, drawn once in the form's language: the host may type over it, roll
  // another with the 🎲, or press "Create room" at once.
  const [name, setName] = useState(() => randomRoomName(lang))
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
  const [squeeze, setSqueeze] = useState(false)
  const [chaos, setChaos] = useState(false)
  const [chaosCycle, setChaosCycle] = useState<5 | 10>(ECONOMY.chaosCycles[0])
  const [error, setError] = useState<{ code: ErrorCode; hintKey: string | null } | null>(null)

  // Switching mode narrows the seat cap, the timer set and the bot ceiling: derive rather than reset,
  // so a mode round-trip never loses what the host already picked.
  const seatCap = mode === 'holdem' ? ECONOMY.maxPlayersHoldem : ECONOMY.maxPlayersBlind
  const maxPlayers = Math.min(seats, seatCap)
  const timers: readonly number[] = mode === 'holdem' ? ECONOMY.holdemTurnTimers : ECONOMY.blindTurnTimers
  const turnTimerSec = timers.includes(timer) ? timer : DEFAULT_TIMER[mode]
  // A squeeze table's round is the server's fixed 20 s (spec 2026-10-08 §4.2.1): the timer's select gives way to that
  // length, read-only, and the config carries it. The box is Blind's own, so a Hold'em table never sees it, and a trip
  // through Hold'em keeps it ticked, like the rest of the draft.
  const squeezing = mode === 'blind' && squeeze
  const bots = Math.min(botCount, maxPlayers - 1)
  // The tick is Blind's own and the host's to offer; like the squeeze box it keeps its value through a trip to Hold'em.
  const chaotic = mode === 'blind' && chaosOffered && chaos

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (busy) return
    const tier = ECONOMY.holdemBlindTiers[tierIndex] ?? ECONOMY.holdemBlindTiers[0]
    const parsed = validateRoomConfig({
      name,
      mode,
      maxPlayers,
      isPrivate,
      turnTimerSec: squeezing ? ECONOMY.squeezeTurnTimerSec : turnTimerSec,
      autoStart,
      password: isPrivate && password !== '' ? password : undefined,
      holdem: mode === 'holdem' ? { ...tier, minBuyInBB, maxBuyInBB } : undefined,
      blind: mode === 'blind' ? { holeCards, decisionMode, fixedWager, botCount: bots, squeeze, ...(chaotic ? { chaosCycle } : {}) } : undefined,
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
            <RoomNameInput
              value={name}
              onChange={setName}
              onRoll={() => setName(randomRoomName(lang, Math.random, name))}
              rollLabel={t('create.rollName')}
              maxLength={30}
              autoComplete="off"
              disabled={busy}
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
          {squeezing ? (
            // A value, not a control: out of the Tab order (its label and the squeeze box's hint say it to a screen
            // reader), and dimmed with the rest of the form while it is busy.
            <input
              className={cx(s.input, s.inputFixed)}
              type="text"
              readOnly
              tabIndex={-1}
              disabled={busy}
              value={t('create.squeezeTimer', { time: t('common:time.seconds', { count: ECONOMY.squeezeTurnTimerSec }) })}
            />
          ) : (
            <Select<number>
              value={turnTimerSec}
              options={timers.map((n) => ({ value: n, label: t('common:time.seconds', { count: n }) }))}
              disabled={busy}
              onChange={setTimer}
            />
          )}
        </Field>

        {/* One box for both modes' fields, as tall as the taller of the two, so flipping the mode never moves the
            dialog's edge (No12; the heights are in lobby.module.css). */}
        <div className={cx(s.wide, s.modeBox)}>
          <div className={cx(s.grid, s.modeFields, chaosOffered && s.modeFieldsChaos)}>
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
                squeeze={squeeze}
                onSqueeze={setSqueeze}
                {...(chaosOffered ? { chaos: { on: chaos, onChange: setChaos, cycle: chaosCycle, onCycle: setChaosCycle } } : {})}
                disabled={busy}
                lang={lang}
              />
            )}
          </div>
        </div>

        {/* Where chaos is offered the form is one row taller (the "Poker hỗn loạn" row), which on the user's 940 px screen
            would push the last checkbox under the dialog's sticky footer; the two ticks share a row instead, which is the
            row it costs. The grid's own `auto-fit` puts them back in one column on a phone. */}
        <label className={cx(s.check, !chaosOffered && s.wide)}>
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

        <label className={cx(s.check, !chaosOffered && s.wide)}>
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
