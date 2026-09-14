import type { PlayerAction, RoomPlayerView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTableExpressions, type ChibiSubject } from '../avatar2d/index.js'
import type { GameClientApi } from '../client/useGameClient.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { Field } from '../primitives/Field.js'
import { Modal } from '../primitives/Modal.js'
import { cx } from '../primitives/cx.js'
import { ActionBar } from '../table/ActionBar.js'
import { HandResult } from '../table/HandResult.js'
import { PokerTable, type TableLayout } from '../table/PokerTable.js'
import { RoomHeader } from '../table/RoomHeader.js'
import { Toasts } from './Toasts.js'
import { useRequest } from './useRequest.js'
import s from './screens.module.css'

export interface RoomScreenProps {
  client: GameClientApi
  lang: Language
  /** Fired the moment the room is gone — left, closed or kicked. The host app decides where to go next. */
  onLeft: () => void
  /** A human seat's chibi; `null` (or no answer) falls back to the name's initial. Threaded straight to
   * `PokerTable`, which draws bots' chibis on its own. */
  chibiFor?: (p: RoomPlayerView) => ChibiSubject | null
  /** One muted line under each seat's name — a title, a rank. Threaded straight to `PokerTable`. */
  captionFor?: (p: RoomPlayerView) => ReactNode
  /** App-specific banner above the room (edition branding, announcements…). */
  header?: ReactNode
  /** Forces the table layout; by default the table picks ring or stack from the viewport. */
  layout?: TableLayout
}

const MIN_TO_START = 2

/** Ticks once a second while a countdown is running; returns whole seconds left, or `null` when there is none. */
function useCountdown(target: number | null, now: () => number): number | null {
  const [, tick] = useState(0)
  // `now` is a fresh closure every render, so the schedule is keyed on the target and reads the clock from a ref.
  const nowRef = useRef(now)
  nowRef.current = now
  useEffect(() => {
    // A deadline already in the past has nothing left to count down: stop rather than re-render the whole room
    // once a second for a number that will read "0" forever.
    if (target === null || target - nowRef.current() <= 0) return
    const timer = setInterval(() => {
      tick((n) => n + 1)
      if (target - nowRef.current() <= 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [target])
  if (target === null) return null
  return Math.max(0, Math.ceil((target - now()) / 1000))
}

/**
 * The room: header, table, your seat's controls and the action tray.
 *
 * Everything shown is derived from `client.state`; every button is one `GameClientApi` call. The screen decides
 * nothing about the game — not whose turn it is, not what a legal bet is, not who may start.
 */
export function RoomScreen({ client, lang, onLeft, chibiFor, captionFor, header, layout }: RoomScreenProps) {
  const { t } = useTranslation()
  const { state } = client
  const room = state.room
  const expressionFor = useTableExpressions(state, client.serverNow)
  const onLeftRef = useRef(onLeft)
  onLeftRef.current = onLeft
  const [buyInSeat, setBuyInSeat] = useState<number | null>(null)
  const [buyIn, setBuyIn] = useState('')
  /** The hand whose result card the player has waved away; the next hand brings its own. */
  const [dismissedHandId, setDismissedHandId] = useState<string | null>(null)
  const request = useRequest()

  // Left, closed or kicked: the reducer drops the room and the host app takes it from here. A *stale* room is a
  // different thing — a refresh on `#/room` starts with no room and none confirmed yet, and bouncing then would
  // throw the player out of a room they are still sitting in. Wait for the answer to the reconnect `RESYNC`.
  const gone = room === null && !state.roomStale
  useEffect(() => {
    if (gone) onLeftRef.current()
  }, [gone])

  const nextHandIn = useCountdown(room?.nextHandAt ?? null, client.serverNow)

  const me = useMemo(
    () => (room === null ? undefined : room.players.find((p) => p.playerId === state.me?.playerId)),
    [room, state.me?.playerId],
  )

  const act = useCallback((action: PlayerAction) => void request.run(() => client.act(action)), [request, client])
  const closeBuyIn = useCallback(() => setBuyInSeat(null), [])
  const clearError = useCallback(() => {
    request.clear()
    client.clearError()
  }, [request, client])
  const dismiss = useCallback((id: number) => client.dismissNotification(id), [client])

  if (room === null) return null

  const hand = state.hand
  const holdem = room.config.holdem
  const seated = room.players.filter((p) => p.seat !== null)
  const canSit = me !== undefined && me.seat === null
  const isHost = me !== undefined && me.isHost
  // The same predicate the server counts with (`readySeats()`): a sitting-out seat is warm, not playing. Counting
  // it would show the host "2/2 ready", an enabled Start and no hint, for a table that answers NOT_ENOUGH_PLAYERS.
  const readyCount = seated.filter((p) => p.ready && !p.sittingOut).length
  // Bots are always ready, so the count alone can be all bots: the server refuses a hand with no human in it,
  // and the button says so before the click rather than after.
  const readyHumans = seated.filter((p) => p.ready && !p.sittingOut && !p.isBot).length
  const canStart = readyCount >= MIN_TO_START && readyHumans >= 1
  const startHint = canStart ? null : readyHumans === 0 && readyCount >= MIN_TO_START ? t('room.startNeedsYou') : t('room.startHint')
  const turnTimerMs = room.config.turnTimerSec * 1000
  const bb = holdem?.bigBlind ?? 0
  const minBuyIn = holdem === undefined ? 0 : holdem.minBuyInBB * bb
  const maxBuyIn = holdem === undefined ? 0 : holdem.maxBuyInBB * bb

  // Hold'em asks how much you bring; Blind mode has a fixed wager, so the seat is taken outright.
  const onSeatClick = (seat: number): void => {
    if (holdem === undefined) {
      void request.run(() => client.sitDown(seat))
      return
    }
    setBuyIn(String(minBuyIn))
    setBuyInSeat(seat)
  }

  const confirmBuyIn = async (): Promise<void> => {
    if (buyInSeat === null) return
    const typed = Number(buyIn)
    // Snap to the same grid the input's `step` offers, then clamp: a typed 10,350 must not become an illegal buy-in.
    const step = bb > 0 ? bb : 1
    const snapped = Math.round((Number.isFinite(typed) ? typed : minBuyIn) / step) * step
    const amount = Math.min(maxBuyIn, Math.max(minBuyIn, snapped))
    if (await request.run(() => client.sitDown(buyInSeat, amount))) setBuyInSeat(null)
  }

  const finished = hand !== null && hand.phase === 'COMPLETE' && hand.result !== null ? hand : null
  // The result card sits over the felt, so it has to be closable: between hands a player may well want to look at
  // the table underneath it rather than at the receipt.
  const resultCard = finished !== null && finished.handId !== dismissedHandId ? finished : null
  /** Between hands: the room is taking seats rather than dealing. */
  const waiting = room.status === 'OPEN'
  const mySeated = me !== undefined && me.seat !== null
  // Not `status`: that reports `IN_HAND` for the hand a fresh sitter is still finishing, so a snapshot taken
  // mid-hand (a RESYNC, a seq gap, a reconnect) would flip the toggle back and leave it unable to cancel.
  const sittingOut = me?.sittingOut === true

  const countdown =
    nextHandIn === null ? null : (
      <p className={s.countdown}>
        {t('labels.nextHandIn')} <strong>{t('common:time.seconds', { count: nextHandIn })}</strong>
      </p>
    )

  return (
    <div className={s.room}>
      {header}
      <RoomHeader room={room} status={state.status} onLeave={() => void request.run(() => client.leaveRoom())} lang={lang} />

      {state.status === 'open' ? null : (
        <p className={s.banner} role="status">
          <span className={s.bannerPulse} aria-hidden="true" />
          {t('room.reconnecting')}
        </p>
      )}

      <main className={s.roomMain}>
        <PokerTable
          room={room}
          hand={hand}
          myPlayerId={state.me?.playerId ?? null}
          deadlineAt={state.deadlineAt}
          serverNow={client.serverNow}
          turnTimerMs={turnTimerMs}
          lang={lang}
          canSit={canSit}
          onSeatClick={onSeatClick}
          layout={layout}
          chibiFor={chibiFor}
          expressionFor={expressionFor}
          captionFor={captionFor}
        />

        {/* the result card is dealt onto the felt, so it keeps the felt's night palette in either theme */}
        {resultCard === null ? null : (
          <div className={s.overlay} data-surface="night">
            <HandResult
              hand={resultCard}
              room={room}
              myPlayerId={state.me?.playerId ?? null}
              lang={lang}
              onDismiss={() => setDismissedHandId(resultCard.handId)}
            />
            {countdown}
          </div>
        )}
      </main>

      <footer className={s.roomFoot}>
        <div className={s.controls} role="group" aria-label={t('room.controls')}>
          {mySeated && waiting ? (
            <Button
              variant={me.ready ? 'ghost' : 'primary'}
              disabled={request.busy}
              aria-pressed={me.ready}
              onClick={() => void request.run(() => client.setReady(!me.ready))}
            >
              {t(me.ready ? 'actions.notReady' : 'actions.ready')}
            </Button>
          ) : null}
          {mySeated ? (
            <Button variant="ghost" disabled={request.busy} onClick={() => void request.run(() => client.standUp())}>
              {t('actions.standUp')}
            </Button>
          ) : null}
          {/* Keep the seat, skip the hands. It stays put (disabled) while standing so the tray does not
              reshuffle under the player the moment they take a seat. */}
          <Button
            variant="ghost"
            disabled={request.busy || !mySeated}
            aria-pressed={mySeated ? sittingOut : undefined}
            onClick={() => void request.run(() => (sittingOut ? client.sitIn() : client.sitOut()))}
          >
            {t(sittingOut ? 'room.sitIn' : 'room.sitOut')}
          </Button>

          {waiting ? (
            <span className={s.readyCount}>{t('room.readyCount', { ready: readyCount, total: seated.length })}</span>
          ) : // While the result card is up the countdown lives on it; here it covers the gap once it is dismissed.
          resultCard === null ? (
            countdown
          ) : null}

          {!waiting ? null : isHost ? (
            <>
              <Button variant="gold" disabled={request.busy || !canStart} onClick={() => void request.run(() => client.startGame())}>
                {t('actions.start')}
              </Button>
              {startHint === null ? null : <span className={s.hint}>{startHint}</span>}
            </>
          ) : (
            <span className={s.hint}>{t('room.waitingForHost')}</span>
          )}
        </div>

        {/* Managing the roster is a between-hands job: the tray stays clear while cards are out. */}
        {!waiting || !isHost || room.players.length < 2 ? null : (
          <ul className={s.roster} aria-label={t('labels.players')}>
            {room.players
              .filter((p) => p.playerId !== me?.playerId)
              .map((p) => (
                <li key={p.playerId} className={cx(s.rosterRow, !p.connected && s.rosterOffline)}>
                  <span className={s.rosterName}>{p.displayName}</span>
                  {p.seat === null || p.isBot ? null : <span className={s.rosterStack}>{formatPoints(p.stack, lang)}</span>}
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={request.busy}
                    aria-label={`${t('actions.kick')} — ${p.displayName}`}
                    onClick={() => void request.run(() => client.kick(p.playerId))}
                  >
                    {t('actions.kick')}
                  </Button>
                </li>
              ))}
          </ul>
        )}

        {/* The tray belongs to a seated player in a live hand — it holds its place between turns rather than
            appearing and disappearing under the felt. */}
        {hand === null || hand.mySeat === null ? null : (
          <ActionBar
            hand={hand}
            room={room}
            onAct={act}
            disabled={request.busy || state.status !== 'open'}
            lang={lang}
            preAction={state.preAction?.kind ?? null}
            onPreAction={client.setPreAction}
            autoPlay={state.autoPlay}
            onAutoPlay={client.setAutoPlay}
          />
        )}
      </footer>

      <Modal
        open={buyInSeat !== null}
        title={t('room.buyInTitle')}
        closeLabel={t('actions.close')}
        onClose={closeBuyIn}
      >
        <div className={s.buyIn}>
          <Field
            label={t('labels.buyIn')}
            hint={`${formatPoints(minBuyIn, lang)} – ${formatPoints(maxBuyIn, lang)}`}
          >
            <input
              className={s.buyInInput}
              type="number"
              inputMode="numeric"
              min={minBuyIn}
              max={maxBuyIn}
              step={bb}
              value={buyIn}
              disabled={request.busy}
              onChange={(event) => setBuyIn(event.target.value)}
            />
          </Field>
          <div className={s.buyInFoot}>
            <Button variant="ghost" onClick={closeBuyIn}>
              {t('actions.cancel')}
            </Button>
            <Button variant="gold" size="lg" loading={request.busy} onClick={() => void confirmBuyIn()}>
              {t('actions.sitDown')}
            </Button>
          </div>
        </div>
      </Modal>

      <Toasts
        error={request.error ?? state.lastError}
        notifications={state.notifications}
        onClearError={clearError}
        onDismiss={dismiss}
        lang={lang}
      />
    </div>
  )
}
