import type { PlayerAction, RoomPlayerView } from '@bp/core'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useTableExpressions, type ChibiSubject } from '../avatar2d/index.js'
import type { GameClientApi } from '../client/useGameClient.js'
import { formatPoints, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { Field } from '../primitives/Field.js'
import { MenuButton, type MenuItem } from '../primitives/MenuButton.js'
import { Modal } from '../primitives/Modal.js'
import { cx } from '../primitives/cx.js'
import { ActionBar } from '../table/ActionBar.js'
import { HandResult } from '../table/HandResult.js'
import { STACK_LAYOUT_QUERY, useRoomFrame, useStageTier, type RoomFrame } from '../table/frame.js'
import { PokerTable, type TableLayout } from '../table/PokerTable.js'
import { RankLabel } from '../table/RankLabel.js'
import { RoomHeader } from '../table/RoomHeader.js'
import { useMediaQuery } from '../table/useMediaQuery.js'
import { useFullscreenNudge } from './fullscreen-nudge.js'
import { useRevealHold } from './reveal-hold.js'
import { useSeatClearance } from './seat-clearance.js'
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
  /** A human player's reputation rank 1..5 (Plan 27): after the name on their seat, and as a numeral in the host's
   * "Mời ra" list. `null` (or no answer) shows nothing. Threaded to `PokerTable`. */
  rankFor?: (p: RoomPlayerView) => number | null
  /** App-specific banner above the room (edition branding, announcements…). */
  header?: ReactNode
  /** Forces the table layout; by default the table picks ring or stack from the viewport. */
  layout?: TableLayout
  /** Forces the room's frame; by default a phone held sideways gets `landscape` and everything else `desktop`. */
  frame?: RoomFrame
}

const MIN_TO_START = 2
/** The full-screen nudge's close mark; its name is the button's `aria-label`. */
const NUDGE_CLOSE_GLYPH = '✕'

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

/** Whether the page is full screen right now, kept in step with the browser (Esc, a swipe, our own menu item). */
function useFullscreenActive(): boolean {
  const [active, setActive] = useState(() => typeof document !== 'undefined' && document.fullscreenElement != null)
  useEffect(() => {
    const sync = (): void => setActive(document.fullscreenElement != null)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  return active
}

/** In or out of full screen. A refusal (no user gesture, a policy, an old browser) leaves the page as it was. */
function toggleFullscreen(): void {
  try {
    const pending = document.fullscreenElement != null ? document.exitFullscreen() : document.documentElement.requestFullscreen()
    void Promise.resolve(pending).catch(() => undefined)
  } catch {
    // a browser without the promise form throws instead; staying windowed is the answer either way
  }
}

/**
 * The room: header, table, your seat's controls and the action tray.
 *
 * Everything shown is derived from `client.state`; every button is one `GameClientApi` call. The screen decides
 * nothing about the game — not whose turn it is, not what a legal bet is, not who may start.
 */
export function RoomScreen({ client, lang, onLeft, chibiFor, captionFor, rankFor, header, layout, frame: frameOverride }: RoomScreenProps) {
  const { t } = useTranslation()
  const { state } = client
  const room = state.room
  const hand = state.hand
  // A showdown that turns an opponent's cards over where they lie is watched first: the card waits out the turn
  // (`REVEAL_HOLD_MS`, none under reduced motion) instead of opening over it (review round 2, fix wave, No1). The table
  // waits with it — the lines under the seats, the winner's glow, the board's gold edge and the faces' reaction — so
  // nothing on screen gives the result away before the card (the same fix wave, follow-up). The faces take the flag
  // themselves: their reaction counts from the end of the hold, so it shows for its full length.
  const held = useRevealHold(hand)
  const expressionFor = useTableExpressions(state, client.serverNow, held)
  const onLeftRef = useRef(onLeft)
  onLeftRef.current = onLeft
  const [buyInSeat, setBuyInSeat] = useState<number | null>(null)
  const [buyIn, setBuyIn] = useState('')
  /** The hand whose result card the player has waved away; the next hand brings its own. */
  const [dismissedHandId, setDismissedHandId] = useState<string | null>(null)
  /**
   * The hand (or `none`) between whose deals the host opened "Manage table". Keyed rather than a flag, so a hand
   * that starts under the open list closes it for good instead of bringing it back once that hand is over.
   */
  const [managingAfter, setManagingAfter] = useState<string | null>(null)
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
  // Squeeze mode: my cards are all up (the seat asks only while the round is on). Not through `request`, which would grey
  // the controls while it is out for something the player did not ask the tray for; a refusal reaches the reducer like
  // any other, and the rejection a socket closing mid-request produces has no one to report to, as with auto-play's.
  const reveal = useCallback(() => void client.reveal().catch(() => undefined), [client])
  const closeBuyIn = useCallback(() => setBuyInSeat(null), [])
  const closeManage = useCallback(() => setManagingAfter(null), [])
  const clearError = useCallback(() => {
    request.clear()
    client.clearError()
  }, [request, client])
  const dismiss = useCallback((id: number) => client.dismissNotification(id), [client])

  const finished = hand !== null && hand.phase === 'COMPLETE' && hand.result !== null ? hand : null
  // The result card sits over the felt, so it has to be closable: between hands a player may well want to look at
  // the table underneath it rather than at the receipt. Everything that follows the card — the seat clearance, the
  // close button, the countdown's place — follows this one, the card actually drawn.
  const resultCard = finished !== null && finished.handId !== dismissedHandId && !held ? finished : null
  // The card's stage stops above the viewer's own seat when there is room for the card there (review round 2, R2-3),
  // measured again when the viewer takes a seat or leaves one under it. Up here, above the early return, because it is
  // a hook — and worked out from `resultCard` itself, so what is measured for and what is drawn cannot disagree.
  const stageRef = useRef<HTMLElement>(null)
  const clearance = useSeatClearance(stageRef, resultCard !== null, me?.seat ?? null)
  // Also a hook, so also above the early return: the frame is what every landscape rule of the room keys on.
  const frame = useRoomFrame(frameOverride)
  const fullscreen = useFullscreenActive()
  // The landscape frame's tier (BP-28): the stage itself is measured, so a phone that keeps its browser bars — or any
  // stage under 300 px (`SHORT_STAGE_PX`) — gets the short one. A hook too, so above the early return; it starts measuring once the stage
  // is in the tree.
  const tier = useStageTier(stageRef, frame, room !== null)
  const [nudgeDone, dismissNudge] = useFullscreenNudge()
  // The stacked table (BP-31 R9), measured once here so the table and the tray agree; a hook, so above the early return.
  const stackMatch = useMediaQuery(STACK_LAYOUT_QUERY)

  if (room === null) return null

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

  /** Between hands: the room is taking seats rather than dealing. */
  const waiting = room.status === 'OPEN'
  const mySeated = me !== undefined && me.seat !== null
  // Not `status`: that reports `IN_HAND` for the hand a fresh sitter is still finishing, so a snapshot taken
  // mid-hand (a RESYNC, a seq gap, a reconnect) would flip the toggle back and leave it unable to cancel.
  const sittingOut = me?.sittingOut === true
  /**
   * The one line under the controls between hands, saying what *this* player can do next (layout audit C5,
   * 2026-09-28 — "press Ready" used to show to a host who had not even sat down): take a seat, press Ready,
   * wait for a second player, or wait for the host.
   */
  const hintKey = !waiting
    ? null
    : !mySeated
      ? canSit
        ? 'room.sitFirst'
        : null
      : !isHost
        ? 'room.waitingForHost'
        : canStart
          ? null
          : readyHumans === 0
            ? 'room.startNeedsYou'
            : 'room.startHint'
  /**
   * What sitting down needs, when the balance cannot cover it (finding T4 of the 2026-09-28 run, reworked for the table
   * limit of 2026-09-29): one wager (plan 27 D2, R11). Blind only, and only for a player who is not seated: a seat
   * plays from the stack it brought down to 0 and is stood up there — so the one who can be short is the one watching.
   * Hold'em's buy-in dialog states its own range.
   */
  const needed = room.config.blind === undefined ? null : room.config.blind.fixedWager
  const shortToSit = canSit && needed !== null && state.balance < needed ? needed : null
  const hint = shortToSit !== null ? t('room.shortToSit', { amount: formatPoints(shortToSit, lang) }) : hintKey === null ? null : t(hintKey)
  /** Everyone the host could ask to leave: the other seats and the spectators, bots included. */
  const others = room.players.filter((p) => p.playerId !== me?.playerId)
  // Managing the roster is a between-hands job: the dialog closes itself the moment cards are dealt. "Between
  // hands" is the server's own kick rule — no seat holds cards — so it is also the countdown to the next deal, where
  // the room still says IN_GAME (a Blind table with bots never goes back to OPEN between its hands). The server counts
  // a hand as over once it has settled it, a moment after `HAND_COMPLETE` lands here: a kick sent in that moment is
  // refused with GAME_IN_PROGRESS, and the same kick a moment later goes through.
  const handLive = hand !== null && hand.phase !== 'COMPLETE'
  const canManage = (waiting || !handLive) && isHost && others.length > 0
  const manageKey = hand?.handId ?? 'none'

  const nextHandText =
    nextHandIn === null ? null : (
      <>
        {t('labels.nextHandIn')} <strong>{t('common:time.seconds', { count: nextHandIn })}</strong>
      </>
    )
  // Padding, not `bottom`: the overlay keeps the stage's box, and its scrim paints the padded content box alone — the
  // card's stage — so the scrim's centre rises with the card and the seat below it is not darkened.
  const overlayStyle = clearance === null ? undefined : ({ '--seat-clearance': `${clearance}px` } as CSSProperties)
  // While the result card is up the countdown lives on it; here it covers the gap once it is dismissed. While the card
  // is held it is on its way: printed here for the hold, the line would jump onto the card a moment later and shift the
  // buttons after it.
  const countdownHere = !waiting && resultCard === null && !held && nextHandText !== null

  // The pieces both frames draw — under the felt on a desktop, in the corner dock on a phone held sideways.
  const readyButton =
    mySeated && waiting ? (
      <Button
        variant={me.ready ? 'ghost' : 'primary'}
        disabled={request.busy}
        aria-pressed={me.ready}
        onClick={() => void request.run(() => client.setReady(!me.ready))}
      >
        {t(me.ready ? 'actions.notReady' : 'actions.ready')}
      </Button>
    ) : null
  const readyLine = waiting ? <span className={s.readyCount}>{t('room.readyCount', { ready: readyCount, total: seated.length })}</span> : null
  const countdownLine = countdownHere ? <p className={s.countdown}>{nextHandText}</p> : null
  const startButton =
    waiting && isHost ? (
      <Button variant="gold" disabled={request.busy || !canStart} onClick={() => void request.run(() => client.startGame())}>
        {t('actions.start')}
      </Button>
    ) : null
  const hintLine = hint === null ? null : <span className={s.hint}>{hint}</span>
  const standUp = (): void => void request.run(() => client.standUp())
  const toggleSitOut = (): void => void request.run(() => (sittingOut ? client.sitIn() : client.sitOut()))
  const openManage = (): void => setManagingAfter(manageKey)

  /**
   * A phone on its side (Plan 26, B2) has no height for a row of buttons under the felt. The seat's own controls go
   * into the header's "More" menu — each only when the desktop row would show it — and what starts a hand into a dock
   * in the bottom-right corner, the one the action tray takes during a hand. The two never share it: while the dock is
   * up (the room is waiting, or the countdown runs with the result card closed) no hand is being played, and the tray's
   * right part, which would only say the hand is over, waits for the next deal (`betweenHands`). Its left part — the
   * toggles, "Tự động chơi" among them — stays, so auto-play can be turned off during the countdown (B4).
   */
  const landscape = frame === 'landscape'
  /** The table's layout, one answer for the table and the tray: an override, else the ring in landscape, else the query. */
  const tableLayout: TableLayout = layout ?? (frame === 'landscape' ? 'ring' : stackMatch ? 'stack' : 'ring')
  /**
   * A phone held upright (BP-31 §3.1, R11) — or any window the stack query catches (R9) — keyed on the resolved layout,
   * never on the raw query, which a phone on its side also answers (P2). It takes landscape's two pieces: the seat's
   * controls in the header's "Thêm" menu and a dock for what starts a hand; there the dock is a row in the footer, in
   * the tray's place, shown to whoever can press something in it — a seated player, or the host, seated or not (R14).
   * A spectator who does not host gets no footer at all.
   */
  const stack = !landscape && tableLayout === 'stack'
  const short = landscape && tier === 'short'
  const dockShown = (landscape && (waiting || countdownHere)) || (stack && (waiting || countdownHere) && (mySeated || isHost))
  // R3: only where the browser offers it (iOS Safari on a phone does not).
  const fullscreenOffered = typeof document !== 'undefined' && document.fullscreenEnabled === true
  /**
   * BP-28, R3: the short tier's one-time nudge towards full screen, in the bottom-left corner — the corner the tray's
   * toggles take during a hand, so only while there is no tray (`hand` with my seat in it), and never in full screen.
   * Using it or closing it is remembered for good (`useFullscreenNudge`). No motion: it is there or it is not.
   */
  const nudgeShown = short && fullscreenOffered && !fullscreen && !nudgeDone && (hand === null || hand.mySeat === null)
  const takeFullscreen = (): void => {
    dismissNudge()
    toggleFullscreen()
  }
  const menuItems: MenuItem[] = []
  const menuShown = landscape || stack
  if (menuShown) {
    if (mySeated) menuItems.push({ id: 'standUp', label: t('actions.standUp'), disabled: request.busy, onSelect: standUp })
    menuItems.push({
      id: 'sitOut',
      label: t(sittingOut ? 'room.sitIn' : 'room.sitOut'),
      checked: sittingOut,
      disabled: request.busy || !mySeated,
      onSelect: toggleSitOut,
    })
    if (canManage) menuItems.push({ id: 'manage', label: t('room.manage'), onSelect: openManage })
    if (fullscreenOffered) {
      menuItems.push({ id: 'fullscreen', label: t(fullscreen ? 'room.exitFullscreen' : 'room.fullscreen'), onSelect: toggleFullscreen })
    }
  }
  const leave = (): void => void request.run(() => client.leaveRoom())
  const tray =
    hand === null || hand.mySeat === null ? null : (
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
        frame={frame}
        layout={tableLayout}
        tier={tier}
        betweenHands={dockShown}
      />
    )
  /** The dock's content, both frames: what starts a hand, then the count or the countdown. */
  const dockLine = readyLine ?? countdownLine
  /** The stack's footer holds the dock or the tray, or nothing: a spectator has no footer (spec §3.1). */
  const footerShown = !stack || dockShown || tray !== null || nudgeShown

  return (
    <div className={s.room} data-frame={frame} data-tier={landscape ? tier : undefined} data-layout={stack ? 'stack' : undefined}>
      {header}
      <RoomHeader
        room={room}
        status={state.status}
        onLeave={leave}
        lang={lang}
        // The stack keeps the full header — its meta line carries the stakes and the limit — and adds the menu (P3).
        compact={landscape}
        menu={menuShown ? <MenuButton label={t('room.more')} items={menuItems} /> : undefined}
      />

      {state.status === 'open' ? null : (
        <p className={s.banner} role="status">
          <span className={s.bannerPulse} aria-hidden="true" />
          {t('room.reconnecting')}
        </p>
      )}

      <main ref={stageRef} className={s.roomMain}>
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
          layout={tableLayout}
          frame={frame}
          tier={tier}
          chibiFor={chibiFor}
          expressionFor={expressionFor}
          captionFor={captionFor}
          rankFor={rankFor}
          resultPending={held}
          onReveal={reveal}
          // The short tier's felt has no free band under the board for it (BP-28, R2): the dock carries it there. The
          // stack's one-row footer has no room for it either, so it is the felt's last line there (BP-31 P4).
          note={(stack || (landscape && !short)) && waiting ? hint : null}
        />

        {/* The result card is dealt onto the felt, so it keeps the felt's night palette in either theme. The countdown
            to the next deal is the card's own footer line: printed under the card, it landed on the viewer's seat
            (review 2026-09-29, No2). Its stage stops above the viewer's own seat when that leaves it room (R2-3). */}
        {resultCard === null ? null : (
          <div className={s.overlay} data-surface="night" data-frame={frame} style={overlayStyle}>
            <HandResult
              hand={resultCard}
              room={room}
              myPlayerId={state.me?.playerId ?? null}
              lang={lang}
              onDismiss={() => setDismissedHandId(resultCard.handId)}
              countdown={nextHandText}
              frame={frame}
            />
          </div>
        )}
      </main>

      {footerShown ? (
        // The stack's dock row is the footer itself: one night bar, the tray's height, holding the dock and — between
        // hands — whatever the tray keeps beside it ("Tự động chơi", R13). In a hand the tray is the bar, as on every frame.
        <footer className={s.roomFoot} {...(stack && dockShown ? { 'data-dock': 'true', 'data-surface': 'night' } : {})}>
          {nudgeShown ? (
            <div className={s.nudge} data-surface="night">
              <button type="button" className={s.nudgeUse} onClick={takeFullscreen}>
                {t('room.fullscreenNudge')}
              </button>
              <button type="button" className={s.nudgeClose} aria-label={t('room.fullscreenNudgeDismiss')} onClick={dismissNudge}>
                <span aria-hidden="true">{NUDGE_CLOSE_GLYPH}</span>
              </button>
            </div>
          ) : null}
          {landscape ? (
            dockShown ? (
              <div className={s.dock} role="group" aria-label={t('room.controls')} data-surface="night">
                {readyButton}
                {startButton}
                {readyLine}
                {countdownLine}
                {/* BP-28, R2: in the short tier the hint is the dock's second line, under the ready count. */}
                {short ? hintLine : null}
              </div>
            ) : null
          ) : stack ? (
            // No row of controls in the stack (P5): the seat's own are in the header's menu, and the dock keeps what
            // starts a hand under the same group name, in one row. No live region of its own: the tray's line and the
            // reconnect banner are the room's, and a third would make "the status" ambiguous.
            dockShown ? (
              <div className={s.dock} role="group" aria-label={t('room.controls')}>
                {readyButton}
                {startButton}
                {dockLine}
              </div>
            ) : null
          ) : (
            <div className={s.controls} role="group" aria-label={t('room.controls')}>
              {readyButton}
              {mySeated ? (
                <Button variant="ghost" disabled={request.busy} onClick={standUp}>
                  {t('actions.standUp')}
                </Button>
              ) : null}
              {/* Keep the seat, skip the hands. It stays put (disabled) while standing so the tray does not
                  reshuffle under the player the moment they take a seat. */}
              <Button variant="ghost" disabled={request.busy || !mySeated} aria-pressed={mySeated ? sittingOut : undefined} onClick={toggleSitOut}>
                {t(sittingOut ? 'room.sitIn' : 'room.sitOut')}
              </Button>

              {dockLine}

              {startButton}
              {/* The roster used to sit open in the tray, a red "Kick" per player, taking a row a phone did not
                  have; it is one quiet button now, and the list opens on demand (layout audit C5). */}
              {canManage ? (
                <Button variant="ghost" onClick={openManage}>
                  {t('room.manage')}
                </Button>
              ) : null}
              {hintLine}
            </div>
          )}

          {/* The tray belongs to a seated player in a live hand — it holds its place between turns rather than
              appearing and disappearing under the felt. */}
          {tray}
        </footer>
      ) : null}

      <Modal
        open={buyInSeat !== null}
        title={t('room.buyInTitle')}
        closeLabel={t('actions.close')}
        onClose={closeBuyIn}
        footer={
          <>
            <Button variant="ghost" onClick={closeBuyIn}>
              {t('actions.cancel')}
            </Button>
            <Button variant="gold" size="lg" loading={request.busy} onClick={() => void confirmBuyIn()}>
              {t('actions.sitDown')}
            </Button>
          </>
        }
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
        </div>
      </Modal>

      <Modal open={canManage && managingAfter === manageKey} title={t('room.manageTitle')} closeLabel={t('actions.close')} onClose={closeManage}>
        <ul className={s.roster} aria-label={t('labels.players')}>
          {others.map((p) => (
            <li key={p.playerId} className={cx(s.rosterRow, !p.connected && s.rosterOffline)}>
              <span className={s.rosterName}>{p.displayName}</span>
              {p.isBot ? null : <RankLabel rank={rankFor?.(p)} lang={lang} compact />}
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
