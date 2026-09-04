import type { PlayerAction, RoomPlayerView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
  avatarFor?: (p: RoomPlayerView) => ReactNode
  /** App-specific banner above the room (edition branding, announcements…). */
  header?: ReactNode
  /** Forces the table layout; by default the table picks ring or stack from the viewport. */
  layout?: TableLayout
}

const MIN_TO_START = 2

/** Ticks once a second while a countdown is running; returns whole seconds left, or `null` when there is none. */
function useCountdown(target: number | null, now: () => number): number | null {
  const [, tick] = useState(0)
  useEffect(() => {
    if (target === null) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
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
export function RoomScreen({ client, lang, onLeft, avatarFor, header, layout }: RoomScreenProps) {
  const { t } = useTranslation()
  const { state } = client
  const room = state.room
  const onLeftRef = useRef(onLeft)
  onLeftRef.current = onLeft
  const [buyInSeat, setBuyInSeat] = useState<number | null>(null)
  const [buyIn, setBuyIn] = useState('')
  const request = useRequest()

  // Left, closed or kicked: the reducer drops the room and the host app takes it from here.
  const gone = room === null
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
  const readyCount = seated.filter((p) => p.ready).length
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
  /** Between hands: the room is taking seats rather than dealing. */
  const waiting = room.status === 'OPEN'
  const mySeated = me !== undefined && me.seat !== null

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
          avatarFor={avatarFor}
        />

        {/* the result card is dealt onto the felt, so it keeps the felt's night palette in either theme */}
        {finished === null ? null : (
          <div className={s.overlay} data-surface="night">
            <HandResult hand={finished} room={room} myPlayerId={state.me?.playerId ?? null} lang={lang} />
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

          {waiting ? (
            <span className={s.readyCount}>{t('room.readyCount', { ready: readyCount, total: seated.length })}</span>
          ) : // While a hand is up the countdown lives on the result card; here it covers the gap after it is dismissed.
          finished === null ? (
            countdown
          ) : null}

          {!waiting ? null : isHost ? (
            <>
              <Button
                variant="gold"
                disabled={request.busy || readyCount < MIN_TO_START}
                onClick={() => void request.run(() => client.startGame())}
              >
                {t('actions.start')}
              </Button>
              {readyCount < MIN_TO_START ? <span className={s.hint}>{t('room.startHint')}</span> : null}
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
                  {p.seat === null ? null : <span className={s.rosterStack}>{formatPoints(p.stack, lang)}</span>}
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
          <ActionBar hand={hand} room={room} onAct={act} disabled={request.busy || state.status !== 'open'} lang={lang} />
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
