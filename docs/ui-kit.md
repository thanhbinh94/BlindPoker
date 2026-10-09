# `@bp/ui-kit`

## Purpose

The React layer both web apps embed: a WebSocket game client, i18n (Vietnamese and English), the "Đêm Sài Gòn"
design system, the poker table, the lobby, and the two shared screens. It knows the wire protocol and nothing about
either edition — no routes, no fonts, no branding, no edition switches. Normal and Lite each supply their own shell
and drop these screens into it.

It depends on `@bp/core` only (types, `filterEvent`-shaped events, `validateRoomConfig`, `HAND_CATEGORY_KEYS`,
`ECONOMY`), plus `react`, `react-dom`, `i18next` and `react-i18next`. It never imports `@bp/server-kit`, `ws` or a
Node built-in, and never decides gameplay: it renders `ServerMessage`s and sends `ClientMessage`s.

---

## Embedding it in an app

Five things, in this order.

**1. Fonts are the app's job.** `ui-kit` only names them (`--font-display`, `--font-body`). Normal's `index.html`
loads Fraunces and Be Vietnam Pro from Google Fonts; Lite ships offline and lets the fallbacks (Cambria,
Segoe UI) stand. Never a runtime check — just a different `<head>`.

The display fallbacks are ordered for Vietnamese, and that ordering is load-bearing rather than taste:

```css
--font-display: 'Fraunces', 'Playfair Display', Cambria, Constantia, 'Times New Roman', Times, serif;
```

Georgia used to sit where Cambria is, and it is the wrong choice here. Georgia's Windows build has no
precomposed glyphs for the stacked Vietnamese vowels (`ế ộ ữ ằ`), so a heading or a player's name that falls
back to it is rendered per character from whatever face the system substitutes — the diacritics land visibly
off the baseline and at a different weight from the letters around them. Cambria and Constantia ship with
Windows and cover the whole Vietnamese repertoire, which matters most on exactly the machine Lite runs on,
where nothing is downloaded. `tokens.test.ts` asserts the stack never names Georgia again.

**2. Styles.** One import, at the app entry, before your own CSS:

```ts
import '@bp/ui-kit/theme.css' // tokens + reset + atmosphere
```

**3. i18n.** One instance for the app; wrap the tree in `I18nextProvider`.

```tsx
import { I18nextProvider } from 'react-i18next'
import { createI18n, setLanguage, type Language } from '@bp/ui-kit'

const i18n = createI18n({ extraResources: { vi: { normal: viNormal }, en: { normal: enNormal } } })
// later: await setLanguage(i18n, 'en', localStorage)
```

`createI18n({ language?, storage?, navigatorLanguage?, extraResources? })` picks the language from `storage`
(`bp.lang`), then the navigator, then `vi`. `storage: null` disables persistence (tests, the playground).

**4. Theme.** `applyTheme(document.documentElement, 'dark' | 'light')` sets `data-theme`. Dark is the default;
the light theme repaints the page, never the felt (see [Theming](#theming)).

**5. Client + screens.** `useGameClient` is the only place that owns a socket. Put it above the router and share
it through `GameClientProvider`, or pass it down as the `client` prop.

```tsx
import { GameClientProvider, LobbyScreen, RoomScreen, useGameClient, useHashRoute } from '@bp/ui-kit'

function App({ lang }: { lang: Language }) {
  const client = useGameClient({ url: 'wss://…/ws', token: sessionToken })
  const { route, navigate } = useHashRoute()
  return (
    <GameClientProvider client={client}>
      {route.path.startsWith('/room') ? (
        <RoomScreen client={client} lang={lang} onLeft={() => navigate('/lobby')} />
      ) : (
        <LobbyScreen client={client} lang={lang} onEnteredRoom={() => navigate('/room')} />
      )}
    </GameClientProvider>
  )
}
```

`RoomScreen` fills the viewport by design (see [Responsive rules](#responsive-rules)). If the app draws its own bar
above it, set `--bp-stage` on the room's container: `--bp-stage: calc(100dvh - 64px)`, or `100%` inside a flex column
that already has a height. `LobbyScreen` takes the same value as its minimum height, so a short lobby under the bar
fills the window without adding the bar's height as a scrollbar (a bare `100vh` did, review 2026-09-29).

---

## Client contract

`useGameClient({ url, token?, autoConnect?, socketFactory? })` returns a `GameClientApi`:

| Member | Sends / does |
| --- | --- |
| `state: ClientState` | everything the screens render |
| `connect()` / `disconnect()` | opens or closes the socket (auto-connects by default) |
| `listRooms()` | `LIST_ROOMS` |
| `createRoom(config)` | `CREATE_ROOM`, resolves with the `ACK` or `ERROR` |
| `joinRoom({ roomId?, code?, password? })` | `JOIN_ROOM` |
| `leaveRoom()`, `sitDown(seat, buyIn?)`, `standUp()`, `setReady(r)`, `startGame()`, `kick(playerId)` | the matching frame |
| `sitOut()` / `sitIn()` | `SIT_OUT` / `SIT_IN` — keep the seat but skip the hands from the next one on, and take it back. The seat's own `sittingOut` flag is the state (`status` only shows `SITTING_OUT` once the hand on the table is over); `ERROR{NOT_SEATED}` if there is no seat. |
| `act(action)` | `ACTION` with `baseSeq` = the latest applied `seq` |
| `reveal()` | `REVEAL` — squeeze mode: "every one of my cards is turned" (spec 2026-10-08). Resolves with the `ACK` or `ERROR`; `RoomScreen` swallows a refusal or a dropped socket, since a late or repeated `REVEAL` is a no-op on the server. With auto-play on in a squeeze room the hook sends it by itself, once per hand, as soon as my cards are dealt face down (keyed on the hand id, so a re-render or StrictMode never sends it twice). |
| `resync()` | `RESYNC` |
| `clearError()`, `dismissNotification(id)` | local state only |
| `renamed(displayName)` | local state only — `state.me` takes the new name at once, for an app whose own rename just succeeded; it came from `WELCOME` and would otherwise keep the old one until the next. The table roster is left as the server named it: the room the player is in keeps the old name, and the server's `renameIdentity` gives the new one to the next room they create or join. |
| `reset()` | local state only — back to `initialClientState`. For a session ending: the reducer outlives any number of sessions, so without it a sign-out leaves the previous account's `me`, `balance`, `room` and notifications in place until the next `WELCOME`. Call it beside `disconnect()`, never on a live socket. |
| `serverNow()` | `Date.now()` + the `WELCOME` clock offset — **always** compare deadlines against this |

`ClientState` carries `status` (`idle`/`connecting`/`open`/`reconnecting`/`closed`), `closeReason`, `me`,
`balance`, `lobby`, `room`, `roomStale`, `roomReturns`, `hand`, `seq`, `deadlineAt`, `lastError`, `notifications`,
`resyncNeeded`, `replaced`, `serverTimeOffset`.

The rules the client obeys — reconnect with exponential backoff 1 s → 30 s, auto-`HELLO`, auto-`PONG`, a `seq` that
goes backwards or a `STALE_STATE` / `INTERNAL "resync required"` error setting `resyncNeeded` and triggering
`RESYNC` — are the client half of **"Reconnecting and frame order"** in [`docs/server-kit.md`](./server-kit.md). A
test drives real `@bp/core` hands through `reduceClient` and asserts its view equals the engine's `playerView`, so
the reducer cannot drift from the server.

### The reconnect handshake, and `roomStale`

`WELCOME` comes first, and a `ROOM_SNAPSHOT` follows **only if the server still has you in a room**. So the room the
client is holding when a socket comes up is unconfirmed, and `roomStale` says so:

| Frame | Effect |
| --- | --- |
| (initial state) | `roomStale: true` — nothing is confirmed until a session exists |
| `WELCOME` | `room`/`hand` are kept on screen, `roomStale = true`, `resyncNeeded = true` (the hook sends `RESYNC`) |
| `ROOM_SNAPSHOT` | the room is confirmed: `roomStale = false`; if it was stale, `roomReturns += 1` |
| `ERROR{NOT_IN_ROOM}` | the probe's other answer: `room`/`hand` cleared, `seq = 0`, `roomStale = false`, and no `lastError` when the room was stale or already gone |

**A screen must not act on `room === null` alone** — wait for `!roomStale`. `RoomScreen` does exactly that, which is
why a refresh on `#/room` no longer bounces the player out of a room they are still sitting in.

The other direction is `useRoomReturn(state, onReturn)`: it calls `onReturn` once for every `roomReturns` bump — each
time a (re)connect is answered with "you are still in a room" — and both apps pass `() => navigate('/room')`. A player
who reopens the app after a long drop, while the server still keeps them in the room as a spectator (spec §16.6), lands
on that room rather than on a lobby that refuses every other room with `ALREADY_IN_ROOM` (finding T5, 2026-09-28). A
room the player creates, joins or has just left never counts.

A frame the reducer cannot apply to anything — a game event with no hand, a `HAND_STARTED` or room event with no
room — takes its `seq` and sets `resyncNeeded` rather than being dropped.

### What the hand carries for the motion and the squeeze

Three additions to `ClientHand` and `ClientSeat` (Plan 21, spec 2026-10-08), all read by the table rather than decided
by it:

- **`restored`.** `true` for a hand built from a `ROOM_SNAPSHOT` (a refresh, a reconnect, a `RESYNC`), `false` for one
  followed from its `HAND_STARTED`. A snapshot is no arrival: its cards were already on the table, so nothing is dealt
  and nothing turns for it (spec §4.1.4).
- **`dealtAt`, `boardAt`, `showdownAt`.** When the hand's first `CARDS_DEALT`, its latest `COMMUNITY_REVEALED` and its
  `SHOWDOWN` arrived, in **client** time (the `now` of the frame that carried them — not `serverNow()`, which is the
  server's clock). `null` until the event comes, on every new hand, and on any hand built from a snapshot, a reconnect
  snapshot of a hand that was being followed included. The table paces its motion by these (see **Card motion** below).
- **Squeeze.** `ClientPhase` gains `'SQUEEZE'`. `SQUEEZE_PHASE` sets the phase and `deadlineAt` (the event arrives
  stamped, as `DECISION_PHASE` does), `PLAYER_REVEALED` sets the seat's `revealed`, and `SQUEEZE_ENDED` moves to `REVEAL`
  and clears the deadline. `ClientSeat.revealed?` exists **only in a squeeze room** (`room.config.blind.squeeze`): `true`
  for a bot from the deal, `false` for a person until they turn their cards, and a snapshot copies the view's flag. The
  engine's view always has one (`true` on a plain table), so the reducer drops it outside a squeeze room — plain hands and
  existing fixtures stay byte for byte what they were. A play-or-fold squeeze room starts its hand in `DECISION`, a
  pure-luck one in `SQUEEZE`.

### Authentication is terminal

The backoff ladder resets on `WELCOME`, not on `onopen`: a server that accepts the socket and then drops the session
would otherwise be hammered once a second forever. A close with code **4001**, or any `ERROR{UNAUTHENTICATED}`
received on the socket, stops reconnecting for good and reports `state.closeReason === 'unauthenticated'` — the app's
cue to send the player back to sign in. Nothing else in the kit distinguishes close reasons.

### Handing over a token later (the Lite flow)

Lite has no token until the player types a name. Either wait — `useGameClient({ autoConnect: false })`, then
`connect()` once a token exists — or connect straight away and set the token when it arrives: `setToken` on a live
socket sends `HELLO` on the spot rather than waiting out a reconnect. It greets once per socket, and never after
that socket has been welcomed. Both routes are supported; `autoConnect: false` is the quieter one, since a socket
that opens with no token sends nothing until it has one.

---

## Component catalogue

Everything is presentational and takes state plus callbacks. `lang` is threaded as a prop for number and date
formatting; strings come from `useTranslation()`.

### Screens

| Component | Props |
| --- | --- |
| `LobbyScreen` | `client`, `lang`, `onEnteredRoom`, `avatar?`, `header?` — navigation and the language switch are the host app's rail (layout audit U2) |
| `RoomScreen` | `client`, `lang`, `onLeft`, `chibiFor?`, `captionFor?`, `header?`, `layout?` |
| `Toasts` | `error`, `notifications`, `onClearError`, `onDismiss`, `lang` |

`onLeft` fires the moment the room is gone — left, closed or kicked — and the app decides where that lands.

`RoomScreen`'s tray carries Ready, Stand up and one sit-out toggle (`room.sitOut` / `room.sitIn`), whose label and
`aria-pressed` follow `RoomPlayerView.sittingOut` rather than anything the screen remembers — and rather than the
seat's `status`, which reports `IN_HAND` for the hand a fresh sitter is still finishing, so a snapshot taken mid-hand
would otherwise flip the control back and leave it unable to cancel. It is disabled while the viewer has no seat (and
announces no toggle state then), so it keeps its place rather than appearing under the player's hand when they sit
down. The tray's ready count and the host's Start gate read the same flag, so they agree with the server's
`readySeats()`: a sitting-out seat is not counted, however ready it is.

Both screens already render `Toasts` from their own `client.state`; it is exported separately so an app can raise
its own slips in the same stack. Errors are assertive (`role="alert"`, red edge), notifications are polite
(`role="status"`, gold edge) — each also carries its own glyph, so hue is never the only signal. **Every slip clears
itself**: errors after 6 s, notifications after 8 s, and the reducer keeps at most **5** undismissed notifications,
dropping the oldest, so a chatty server cannot stack slips off the top of the screen.

`useRequest()` is exported too: it runs one `GameClientApi` call, exposes `busy` and the refusal as a
`ClientError` that `Toasts` renders unchanged, and is what both screens use for their own buttons.

### Table

| Component | Props |
| --- | --- |
| `PokerTable` | `room`, `hand`, `myPlayerId`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `canSit`, `layout?`, `chibiFor?`, `expressionFor?`, `captionFor?`, `onSeatClick?`, `resultPending?`, `onReveal?` |
| `Seat` | `seat`, `player`, `isMe`, `isActing`, `isButton`, `winnerPayout`, `showdownLabel`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `position`, `chibi`, `expression`, `bounce`, `caption?`, and for the motion and the squeeze (`PokerTable` fills them): `handId`, `dealt`, `dealIndex`, `dealCount`, `reveal`, `liftAfter`, `squeezeRoom`, `squeezeRound`, `squeezeDecides`, `restored?`, `onReveal?` |
| `Card` | `card?`, `faceDown?`, `size?` (`sm`/`md`/`lg`), `delayMs?`, `highlighted?`, `className?`, `dealt?`, `reveal?` (`'flip'`/`'lift'`), `turnDelayMs?` |
| `Deck` | none (`forwardRef` to its `div`) — the pile every card is dealt from; `DeckAnchorProvider` / `useDeckAnchor` (`deck-anchor.ts`) hand its ref to the cards |
| `PeelCard` | `card`, `size?`, `open`, `onRevealed`, `dealt?`, `delayMs?`, `className?` — the viewer's own card in a squeeze room, turned by dragging it |
| `CommunityCards` | `cards`, `highlight?`, `dealt?`, `handId?` |
| `Pot` | `pot`, `carryOver`, `pulse`, `lang` |
| `TurnTimer` | `deadlineAt`, `serverNow`, `totalMs`, `size?` |
| `ActionBar` | `hand`, `room`, `onAct`, `disabled?`, `lang` |
| `HandResult` | `hand`, `room`, `myPlayerId`, `lang`, `onDismiss?` |
| `RoomHeader` | `room`, `status`, `onLeave`, `lang`, `right?` |

`ActionBar` offers only the kinds the server declared legal and clamps every preset into the legal range, so a click
can never produce an illegal amount. Keyboard: `F` fold, `C` check/call, `R` focus the amount, `Enter` submit — all
advertised through `aria-keyshortcuts`. With no legal action it stays in place rather than collapsing, and its one
`role="status"` line says what the seat is waiting for (review round 2, R2-3) — so a change of line is announced once.
`trayWaitKey(hand, mine)` picks it, first match wins: "Ván đã kết thúc" once the hand is complete (the result card may
still be held on the felt), "Bạn đã bỏ bài — chờ ván sau" for a folded seat, "Bạn đã tất tay — chờ kết quả" for an
all-in seat, "Đã chọn — chờ người chơi khác" for a Blind seat that has decided, "Chờ lật bài" for a Blind hand past its
decision and for a Hold'em run-out (fewer than two seats that can still act: no turn is coming), and "Đang chờ đến lượt
bạn" otherwise — Hold'em between turns, or a Blind seat whose own decision is on its way. In a pure-luck squeeze round
(Plan 21) the line comes before those Blind rows: "Mời nặn bài — hết giờ sẽ tự lật" (`labels.waitSqueeze`) while the
viewer's cards are down, "Đã lật — chờ người chơi khác" (`labels.waitOthersReveal`) once they are up, and a spectator,
who has none to turn, "Chờ lật bài". The pre-action and auto-play rows under the line are unchanged, except that
auto-play is offered in a squeeze room too, where it means "turn my cards the moment they are dealt" (in a play-or-fold
room it still answers `play`).

`RoomHeader` shows the blinds for a Hold'em room and "wager · limit" for a Blind one ("Mức cược 5.000 · Hạn mức 25.000"; the
limit is `blindTableLimit`, five wagers).

`HandResult` reads `hand.result`. Alongside `payouts` (the same money summed per seat) it carries **`pots`** — the
engine's layered pots straight from `SETTLEMENT.pots`, each with its `amount`, `eligibleSeats` and `winners` — and
prints a main/side-pot ledger whenever there is more than one, which is the only way a hand with a short all-in
reads as fair. `pots` is empty for a cancelled hand. A cancelled hand's `reason` is an operator-facing token, so it
is normalised to a `cancel.*` key and translated; the raw token is never rendered. Pass `onDismiss` to make the card
closable — `RoomScreen` does, and the between-hands countdown moves to the tray once it is waved off. While the card
is up, the countdown is the card's own last line: `RoomScreen` passes it as `countdown`, and `HandResult` prints it at
the right end of the footer, beside the fee, in a plain `<p>` (review 2026-09-29, No2: printed under the card, it
landed on the viewer's own seat). A line ticking inside a live region would have the whole receipt read out every
second, so the card keeps it out of one by structure (review round 2, R2-4; the first answer was an `aria-live="off"`
nested in a `role="status"` card, which the WAI-ARIA rules honour and Chromium does, but nobody had tried NVDA or JAWS):
the card is a `role="group"` named by its title (`aria-labelledby`, an id from `useId`), its head, cancel note and
scrolling body sit in the one `role="status"` wrapper (`.resultLive`), and the footer — fee, carry-over, uncalled
return, countdown — follows it as the group's last child, outside every live region. The cost: the fee, carry-over and
uncalled lines are no longer part of what is announced when the card appears; they stay on the card and are read on
navigation. The countdown is never inside a row's `<li>` or the fee line, which is what the e2e suites read the card by
— and they find the card as `getByRole('group', { name: /^(Người thắng|Ván bị hủy)$/ })`, since a
`status` locator would now match the inner region alone and lose the footer.

**The card waits for the cards to turn** (review round 2, fix wave, No1). Opened in the render that turned an
opponent's cards over, it covered the very turn it was meant to follow: the top-centre seat's at 1920 × 940, every
opponent's on a 375 × 812 phone. `RoomScreen` now holds it back with `useRevealHold(hand)`
(`src/screens/reveal-hold.ts`) for `REVEAL_HOLD_MS` when a hand completes with a showdown in which a seat other than the
viewer's had been drawn face down on this screen. That is 1270 ms since Plan 21, counted from the numbers the CSS moves
by (`motion.ts`): the 720 ms lift-and-turn (`LIFT_MS`, the `--dur-lift` token — `Card.test` holds the two equal), the
stagger to the last of three cards (2 × `SHOWDOWN_STAGGER_MS`, the 200 ms `Seat` multiplies by), and 150 ms to settle
(it was 870 ms: a 600 ms flat turn on a 60 ms stagger). When the showdown arrived together with the river — the engine
settles in the `ADVANCE` that deals it, so a Blind hand and a Hold'em run-out always do (`showdownWithBoard`) — the
opponents' cards wait for the river to slide in and turn, and the hold grows by that much, `REVEAL_HOLD_AFTER_BOARD_MS`
(`DEAL_MS + FLIP_MS` = 960 ms): 2230 ms in all. The card shows at once under
`prefers-reduced-motion: reduce` (nothing turns), for a hand won by a fold (no showdown), and for a hand that was
already over when the screen first saw it (the snapshot that rebuilds the room after a refresh draws the shown cards
face up). Everything that follows the card follows the card actually drawn: the seat clearance, the close button and
the countdown's place. While the card is held, the countdown is not printed in the tray either — it would sit there
for a moment, then jump onto the card and shift the tray's buttons after it.

**The table waits with it** (the same fix wave, follow-up to No1). With the card held, the seats must not give the result
away either — the hand's name and the payout under each seat, the winner's glow, the gold edge on the best hand's board
cards (and, by design, the happy and sad faces) all used to land the moment `HAND_COMPLETE` did, over a turn the player
had not yet watched. `RoomScreen` passes `PokerTable` `resultPending={held}`: the payouts and the shown hands are left out of what
the seats are given, so no result line, no `.seatWin` and no `highlight` for the board, and each plate prints the
stack it had before the settlement paid it (`ClientSeat.stackBeforeResult`, kept by the reducer), while every card is drawn exactly
as without it and the turn still plays. The faces take the same flag, as the third argument of
`useTableExpressions(state, serverNow, resultPending)`: it does not fold the state in while the flag is up, so the
reaction (4 s happy, 3 s sad) starts when the hold ends and runs its full length rather than losing the hold's time. A seat
still shows what its own state says in the meantime (folded, sitting out, disconnected). Everything appears in the one
render that deals the card, and nothing else about the hold changes. (Until bug-log §7 E1 was fixed on 03/10, the
happy and sad reactions only fired for a hand first seen already complete: `advanceExpressionMemory` recorded the hand
id on every live render, so the completed hand's id was already "seen". It now records the id only when it reacts —
which also restarts the 60 s idle-to-sleep clock on every completed hand, live ones included.)

The card is at most as tall as the felt less the seat clearance (`max-height: 100%` of the content box of
`RoomScreen`'s overlay, which ends above the viewer's own seat — below): past that its body — the rows, then the pot
ledger under them — scrolls inside it, and the title, the close button and the footer stay put. While the body can
still scroll down, its foot fades out (a CSS mask, switched by `data-more`, which `HandResult` measures on scroll and
on resize), so a ledger below the fold reads as more to come; scrolled to the end, the fade goes.

**The card stops above the viewer's own seat** (review round 2, R2-3: on a short stage it covered that seat whole, and
at 1920 × 940 its plate). The overlay still spans the stage, but its bottom padding grows by `--seat-clearance`, and
its scrim paints the padded content box alone — the card's stage — so the scrim's centre rises with the card and the
seat below is not darkened (the ellipse is as tall and as wide as that box — `50% 50%`, closest-side — so it is
transparent by all four of the box's edges and draws no line across the felt, nor a step at either side; the e2e
reads the pixels 3 px either side of each edge and allows a step of 3 levels, and the shade near the rim is a little
lighter for it). `RoomScreen` sets the clearance from `useSeatClearance(stageRef, active, seat)`
(`src/screens/seat-clearance.ts`) while a card is up; `seat` is the viewer's seat number, `null` while they watch. The
hook finds the seat and its plate by `Seat`'s markers, `data-me="true"` on the viewer's own seat and `data-plate` on a
plate — a contract of their own, not the hashed class names — and measures before paint, on a `ResizeObserver` over
the stage and the seat (looked up afresh each time: the ring and the stack draw it anew), once the fonts land, and
whenever `seat` changes (a seat taken or left under the card resizes nothing it observes); without `ResizeObserver`
(jsdom) it measures once per change. Switched off, it forgets its answer, so the next card never starts from the last
one's. `clearanceFor(stage, seat, plate)` picks the first of three tiers that leaves the card `MIN_CARD` (216 px: a
title, one full row and the footer, ≈ 184 px of card, plus the overlay's 2 × 16 px padding) above what it clears,
with a `CLEARANCE_GAP` of 8 px:

1. above the whole seat block — cards, plate and the lines under it: every desktop room screen with six seats
   (`seat.top − stage.top` with the card held is about 405–410 px at 1920 × 940, 255 at 1536 × 730, 290 at
   1366 × 768 and 245 at 1280 × 720, where that leaves the card about 205 px and a longer receipt scrolls inside it),
   and a tall phone: 412 × 915 with touch has 331 px above the seat, room for a card of about 290 px;
2. above the plate — the plate and its lines stay clear; the card may lie over the top of the viewer's hole cards,
   which its own row repeats: a 390 × 844 phone with touch (206 px above the seat, 255 above the plate; room for a
   card of about 215 px), and a 375 × 812 window without touch (190 and 239; about 200 px);
3. neither: no clearance, and the card keeps the whole stage over the seat, closable as before — the 375 × 812 touch
   screen the e2e phone runs at: 174 px above the pinned seat and 223 above its plate, **one pixel short of tier 2**
   (its coarse-pointer touch targets in the bar and the tray take the 16 px that a mouse-driven window of the same
   size has). A spectator has no seat to clear and keeps the whole stage too.

So a phone's tier is a matter of a few pixels of stage, measured with six seats and the card held (2026-10-01): a
change to the room's bar, tray or seat can move the small phone into tier 2, which is benign — the card then stops
above the plate, as on 390 × 844.

`normal.spec.ts` holds the held card to it at the four desktop sizes (`expectCardClearsMySeat`: the card meets
neither the plate nor a line under it, and is still at least `MIN_CARD − 32` px tall, or whole, with its title on
screen); it never runs it on the phone.

**Seat slots.** A seat has two places the host app may write into, and they are threaded identically —
`RoomScreen` → `PokerTable` → `Seat`. `chibiFor(player)` replaces the initial disc; `captionFor(player)` adds one
muted, single-line, truncated line under the name (a title, a rank), and returning `null`/`undefined` leaves the
plate exactly as it was. The caption is the plate's only decoration rather than state, so the compact plates
(seven opponents and up in the stack layout) drop it to keep the third row on screen.

**Under the plate, two lines at most** (review 2026-09-29, No2): the badges with the bet chip beside them, then the
hand's name with the payout. On the ring those lines may run wider than the plate, centred under it — up to 30 % of
the table's width for an opponent and 48 % for the viewer's own seat at six seats or fewer (the neighbours are a
third of the table away), the plate's own width and 30 % from seven seats up — and wrap only past that.

**The viewer's own plate grows to its name** on the ring (review round 2, R2-3: at the seat's 104 px floor, 1280 × 720,
"Tam6z80" printed as "Tam…"). It is `max-content` wide, never narrower than its seat, and capped by
`--seat-plate-max`: 30 % of the table's width up to six seats, 26 % at seven and eight, 22 % at nine. The caps come
from the bottom neighbours in `geometry.ts` on the smallest ring (480 px wide), where the opponents' plate floors
weigh most: they keep 10, 24, 8 and 5 px between the own plate and the nearest neighbour's plate or lines. Centred in
its seat's column, the plate widens evenly both ways; a name longer than the cap still ends in "…" (the playground's
`#worst/<state>/<seats>/<lang>/long` gives the viewer a 30-character name to see it). The opponents' plates keep their
seat's width, and the phone's own plate (`.mine`, 340 px) is not on the ring. `normal.spec.ts` checks the name is whole
at every desktop room size (`expectMyNameWhole`).

Under 768 px the table becomes the vertical stack (spec §27.1): opponents, felt, your own seat. **The opponents'
strip never scrolls inside itself** — it wraps, holds a floor of two plate rows, and from seven seats up the plates
go compact (avatar, name, stack, then bet and state badge side by side) so a third row of three fits at 360 px.

### Card motion (Plan 21, spec 2026-10-08 §3, §4.1)

Every card on the table comes out of a **deck** and is turned where it lands. The numbers live in `table/motion.ts`
(twins of the CSS tokens, which `Card.test` holds equal); the rest is CSS keyframes on the card's wrapper and flipper.
No library: CSS 3D and keyframes for the cards, and a small `requestAnimationFrame` tween for the peel.

| Move | What the player sees | Numbers |
| --- | --- | --- |
| **Deal** | A card `dealt` slides from the deck to its place, back up, leaving at the pile's size (`--deal-scale`, the deck's width over the card's) and growing as it travels, a little rotated. A card that will be face up then turns where it landed, `DEAL_MS` after the slide began. | `DEAL_MS` 360 (`--dur-deal`, the `--ease` curve); `FLIP_MS` 600 (`--dur-flip`, ease-in-out) |
| **Hole cards, round the table** | Clockwise from the seat after the button, one card per seat at a time (`dealOrderOf`): card `i` of the seat `k`-th in that order waits `(i × seats + k) × dealStaggerMs(seats × cards)` — `DEAL_STAGGER_MS`, or less when the last card would leave the deck more than `DEAL_SPAN_MS` after the first (ruling 26: the hand's timer runs during the deal; six seats of two get 90 ms, eight of three 43 ms). | `DEAL_STAGGER_MS` 120; `DEAL_SPAN_MS` 1000 |
| **Board** | The flop's three cards come in `BOARD_STAGGER_MS` apart, each sliding in while the one before it turns; the turn and the river come alone. The server's 1.5 s pace between steps (spec §8.3 step 5) is unchanged: one card takes about a second, so it is at rest before the next. | `BOARD_STAGGER_MS` 300 |
| **Showdown** | An opponent's face-down cards **lift** off the felt (rise by about a fifth of their height, grow by a tenth, the shadow spreads), turn in the air, and set down with a small overshoot (`reveal="lift"`: `.cardLift` with `liftShadow` on the wrapper, `--ease-lift`). One seat's cards go `SHOWDOWN_STAGGER_MS` apart. | `LIFT_MS` 720 (`--dur-lift`); `SHOWDOWN_STAGGER_MS` 200 |
| **The result card's cards** | Unchanged: they fade in on the old stagger. | `CARD_STAGGER_MS` 60 |

**The deck** (`Deck`, in `PokerTable`) is three stacked backs, one `role="img"` named `labels.deck` and no card of any
count (its backs are `aria-hidden` artwork, as the back behind a turned face is). It sits **beside the pot, under the
board, in both layouts** — the spec put it above the board, but a layout probe showed that on a ring a deck there runs
into the top seat's lines on a short window (1366 × 768, 1536 × 730, 1280 × 720) and on the phone pushes the pot onto
the viewer's cards. Sharing the pot's row, at the pot's height (38 px), it adds no height to the felt (`.centreRow`).
`PokerTable` hands its ref to every card under it through `DeckAnchorProvider` (`deck-anchor.ts`); `Card` and `Deck`
never import each other, which is why the context is a module of its own. The *card* does the measuring: a `Card`
(or a `PeelCard`) mounted `dealt` reads the deck's box and its own in a layout effect — through `useDealFrom(ref,
dealt)`, with its entrance keyframe switched off for the read, because the wrapper's fade starts turned and raised and
would skew the box — and sets `--deal-dx`, `--deal-dy`, `--deal-scale`. The measure is the card's arrival and is never
repeated. With no deck under it (the result card, the playground's lone cards, a test) a card has nothing to come
from and keeps its plain fade-in.

**Which cards are "dealt".** A card slides out of the deck only if it *arrived just now*, and a card reads that once, when
it mounts:

- The hole cards are dealt when the hand is not `restored` and its `dealtAt` is within `DEAL_WINDOW_MS` (1500 ms) of
  now; the board when `boardAt` is. A hand rebuilt from a snapshot, or a table remounted later in the hand (a switch
  between the ring and the stack, say), shows its cards where they lie: they fade in with no stagger, and the deck does
  not replay anything the player never saw happen (spec §4.1.4).
- Cards are keyed `${handId}:${i}`, so the next hand's cards are new cards, dealt afresh, even with as many as the last
  hand had.
- A card keeps the delay it mounted with (`delayMs` is latched, in `Card` and `PeelCard` alike): on a full table the
  "dealt just now" window runs out while the last cards are still waiting on the deck, and a delay that followed it would
  jump them. Revealing a card never touches its deal delay either: the turn has its own, `--turn-delay`.
- The showdown's lift waits for the river when the two arrived together (`showdownWithBoard`: the `SHOWDOWN` within 1 s of
  the latest board card): `Seat` gets `liftAfter = DEAL_MS + FLIP_MS` and card `i` turns after `liftAfter + i ×
  SHOWDOWN_STAGGER_MS`. `useRevealHold` adds the same wait to the result card's (see `HandResult` above).

**The turn is two-sided.** A card that turns — a dealt face-up card, a board card, an opponent's at the showdown — is a
turn about the vertical axis (review 2026-09-29, No1): `Card` is an HTML wrapper (`.card`: size, drop shadow, the slide
or fade-in, `perspective`), a flipper and the side(s) it shows. The 3D is the turning state's alone: `.cardTurn` (or
`.cardLift`) puts the flipper in `preserve-3d` and gives its sides `backface-visibility: hidden`, and it stays on while
the turned face is up, so the back rotated behind it stays hidden; a card that never turns draws one side and stays flat.
The face is the flipper's resting style and the keyframe holds only the start, so with motion off the reveal is instant.
The side that shows is the card's one `role="img"` with the label and `data-card` / `data-face`, from the render that
reveals it; the back behind a turned face is `aria-hidden` with none of them, so counts by role or label never see it,
and nothing waits on `animationend`. A card that mounts face up under no deck does not turn.

**Reduced motion.** `prefers-reduced-motion: reduce` switches every moving class off (`.cardDealt`, `.cardTurn`,
`.cardLift`, `.cardLifting`, the fade-in; `Card.test` lists them), so every card is where it ends up at once, and the
result card is not held (nothing turns). The peel keeps working (below).

### The squeeze: `PeelCard` and the room's round (Plan 21, spec 2026-10-08 §3, §4.2)

A Blind room created with "Nặn bài" (`room.config.blind.squeeze`) deals the viewer's cards face down, and the viewer
turns them by hand. The server knows only the outcome (`REVEAL`, see `docs/server-kit.md`); the peel is a gesture on
the viewer's own screen.

`PeelCard` (`table/PeelCard.tsx`, props `{ card, size?, open, onRevealed, dealt?, delayMs?, className? }`) is a face-down
card that is pressed anywhere and dragged inward. Its geometry is pure, in `table/peel.ts`:

- **Direction and fold.** The card peels *from the pressed point into its centre* (`peelDirection`: not snapped to an edge
  or a corner; a press within `centreDead` = 16 px of the centre peels from the bottom edge). The fold is a line
  perpendicular to that, a distance from the pressed edge proportional to the drag: dragging `travel` = 0.75 of the
  card's length along the peel peels it right over. `peelFrame(u, p, w, h)` gives, for the peel `p` ∈ [0, 1], the back's
  clip (the part not yet lifted), the face's clip and its shift (the face that was *under* the card, slid along the peel
  by 2f − L, upright — not mirrored) and the fold line for the thin light-then-dark band (10 px) along it, which stays
  inside the card. 2D only — clip and translate, no `rotate3d`: Chrome stacks the layers wrongly when the fold is diagonal.
- **The numbers**, `PEEL = { threshold 0.5, flick 0.9, travel 0.75, snapMs 200, finishMs 260, slideMs 220, centreDead 16 }`.
  Let go past `threshold`, or moving inward at `flick` px/ms once `p` > 0.12 (`shouldOpen`), and the card peels the rest
  of the way (`finishMs`, scaled by what is left of the peel) and slides back into place face up (`slideMs`); let go
  earlier and it snaps back face down (`snapMs`: the spec's 0.2 s, where the plan had written 220 ms).
- **The flick** is read from the pointer's real and coalesced positions (`getCoalescedEvents`, the raw 120–240 Hz samples
  a touch screen reports between frames) over the last 100 ms of its run, on the events' own clock
  (`event.timeStamp`); a pointer that has paused for 40 ms has stopped, so a drag that ends in a rest is no flick. Where
  the browser coalesces nothing (jsdom, older Safari) it reads the events it gets — see Known gaps.
- **Pointer handling.** `setPointerCapture`, and `touch-action: none` while the card is down so the page does not scroll
  under the finger, `auto` once it is up (a face-up card lets a touch scroll the room). One pointer at a time: a second
  finger is ignored. A pointer the system takes away (`pointercancel`, a lost capture — a phone's home swipe starts at
  the bottom edge, where the viewer's cards sit) *always* snaps the card back, however far or fast it went; a
  `lostpointercapture` from a child as the card takes a touch is not the card's own and changes nothing.
- **From outside.** `open` turning true (the "Lật" pill, a decision, the server's forced turn, the round ending) opens the
  card once, from wherever the peel is, taking over a drag in progress; a card dealt from the deck waits to land first.
  A card mounted with `open` true is simply up. `onRevealed` is called once when the card is face up and at rest,
  however it got there, and is read when called, so a new arrow each render neither restarts the open nor reports twice.
- **Names.** While down (or mid-peel) the card's root is the one `role="img"` named `labels.peelHint` ("Lá úp — kéo để
  lật"; it carries `data-peel` and `data-face="down|peeling|up"`); once up, the face names itself with `cardLabel` and the
  root has no role. Under reduced motion every tween jumps to its end: a drag still peels, and opens or drops back the
  moment it is let go.

The playground's `#peel` page is the card alone on the felt, for trying the gesture at any edge or corner.

**On the table.** `Seat` draws the viewer's own cards as `PeelCard`s *for the whole hand* of a squeeze room (swapped for
`Card`s mid-hand they would remount and come out of the deck again), each `open = openAll || seat.revealed || !squeezeRound`:
the "Lật" pill below the cards turns both at once, the server turning the seat (a decision, the forced turn at the
deadline) opens what is still down, and so does the round ending. `REVEAL` goes out **once per hand, after the viewer's last
card is up** (`onCardUp`, then `onReveal` → `PokerTable` → `RoomScreen`'s `client.reveal()`), not when the first card
turns and not at all if the server turned the seat itself. The "Lật" pill is 28 px tall at least, and it keeps its place for
the whole hand (out of sight and reach once nothing is left to turn): taken out, it would move the seat's block and the
cards opening in it. A ring↔stack switch in the middle of a round remounts the seat; a card peeled but not yet reported
comes back down, and the next "Lật" may send a second `REVEAL`, which the engine takes as the no-op it is. A `REVEAL` lost
with the socket is sent once more: when the reconnect's snapshot rebuilds the hand (`restored`, which `PokerTable` passes
on) with the seat still unturned while this seat's cards are up from before, `Seat` tells the table again — not for a hand
that was already a snapshot when it told. Auto-play's own `REVEAL` (`useGameClient`) is keyed on the hand and the
reconnect (`roomReturns`) the same way. The pill hands keyboard focus to the seat (a `tabIndex={-1}` group) as it hides,
so a player who pressed it from the keyboard is not dropped to the page.

**The round's clock.** The squeeze round's countdown (`TurnTimer`) is drawn on the **viewer's own plate**, while their
cards are not all turned — in a pure-luck round, until they are; in a play-or-fold one, until they have *chosen* too (its
20 s covers the peel and then the choice). Nobody is acting in a squeeze round, so no other seat gets the deadline.
Opponents show "Đã lật" (`labels.revealed`) while the round is on and they have turned; a seat that has decided shows
only "Đã chọn", which stands for both (the line under the plate stays one badge long).

**Strings.** `labels.deck`, `labels.peelHint`, `actions.revealCards` ("Lật"), `labels.revealed`, `labels.waitSqueeze`,
`labels.waitOthersReveal`, `labels.squeezeMode` ("Nặn bài", the badge), `create.squeeze`, `create.squeezeHint` and
`create.squeezeTimer` ("{{time}} · nặn bài"); no `phase.squeeze` — nothing prints the round's name.

### Avatars (`src/avatar2d/`)

The kit does render an avatar — a **chibi**: pre-rendered PNG layers on a shared frame, not a 3D rig or anything
drawn at runtime. `Chibi` (`Chibi.tsx`) takes a `ChibiSubject` (a `ChibiConfig` — since avatar v4 a `BodyRef` for its
gender, a two-layer `HairRef`, the equipped wearables and up to three colours, `hairColor`/`eyeColor`/`skinColor` — or
a bot's `BotChibi`), an `expression` and a `frame` (`'full'` the whole body, `'head'` the round 208×208 crop), and
stacks one `<img>` per layer `layersFor` (`layers.ts`) returns, z-ordered by layer number: L10 aura, L20 the hair's
back half, L30 the body, L40 the outfit, L50 the face, L60 the hair's front half, L70 a face item, L80 a head item,
L90 the frame, a colour landing only on the layers its mask set lists. `hashChibi` (prefix `human4:`) is the
configuration's identity — gender, hairstyle, items and colours, never the expression or the crop. `AvatarAssets`
(`AvatarAssets.tsx`) is the context provider that resolves a layer name to a URL — `assetUrl(base, file, density)`
— so a host app points the whole tree at wherever its avatar files are served from. `expressions.ts` exports
`useTableExpressions`, the per-seat expression schedule `RoomScreen` feeds `PokerTable`. `defaults.ts` builds a
brand-new human's `ChibiConfig` (`defaultChibi(seed)`) with no wardrobe and no request involved — the gender by the
parity of the seed's hash, that gender's `DEFAULT_HAIR`, the starter tee (`DEFAULT_OUTFIT_FILE`), no colours; what Lite
draws, having no cosmetics of its own — and `bot.ts` builds a bot's two-layer `BotChibi` (`botChibi(seed)`) the same
deterministic way. `chibiFor(player)` (on `RoomScreen` and `PokerTable`) is how a host app supplies a *human*
seat's `ChibiConfig`; a bot never asks it — `PokerTable` draws `botChibi` for a bot seat on its own. Full design:
`docs/avatar-2d.md`.

### Lobby

| Component | Props |
| --- | --- |
| `RoomList` | `rooms`, `onJoin`, `filter?`, `onFilter?`, `lang`, `busy?` |
| `CreateRoomForm` | `onSubmit`, `busy?`, `initialMode?`, `lang` |
| `JoinByCode` | `onJoin`, `busy?`, `lang`, `error?` |
| `PlayerBar` | `displayName`, `balance`, `status`, `lang`, `avatar?` (the initial in a gold disc when absent) |
| `LanguageSwitch` | `lang`, `onChange` |
| `HoldemFields` | `tierIndex`, `onTierIndex`, `minBuyInBB`, `maxBuyInBB`, `onMinBuyInBB`, `onMaxBuyInBB`, `disabled`, `lang` |
| `BlindFields` | `holeCards`, `onHoleCards`, `decisionMode`, `onDecisionMode`, `fixedWager`, `onFixedWager`, `botCount`, `onBotCount`, `maxBots`, `squeeze`, `onSqueeze`, `disabled`, `lang` |

`CreateRoomForm` only offers values from `ECONOMY` and still runs the draft through `validateRoomConfig`; it is the
*validated* config that reaches `onSubmit`.

`RoomList` lets a long room name wrap beside its status badge, two lines at most. The name carries no `title`
until the pointer is over it *and* it is cut (`scrollHeight > clientHeight + 1`), and loses it again on leaving — a
static `title` equal to the visible text is read twice by some screen readers. A touch screen therefore has no
tooltip, as before. The lobby's heading row (`.sectionHead`: title, hairline, "create a room") wraps: under about
342 px of window the button drops to a line of its own below the title, which is what keeps a 320 px page from
scrolling sideways; from 342 px it is one line. The narrowest ticket is the grid's floor, 304 px at 320, 656 and
976 px, and the busy-lobby step of `normal.spec.ts` checks it (≤ 305, no sideways scroll, no overlapping text) at
those three windows.

`HoldemFields` (blind tier plus the buy-in window in big blinds) and `BlindFields` (hole cards, decision mode, fixed
wager — whose field carries the table-limit hint, "Table limit per player: … (5× the wager)" — bot filler and the
"Nặn bài" box) are the mode-specific building blocks `CreateRoomForm` swaps between; both are fully controlled,
and an app only reaches for them directly when it builds its own room form. The swap happens in a box that reserves
the taller mode's height in the two-column layout (`.modeFields`: 14rem from 22rem of form width up), so the
create-room dialog does not change height when the host flips the mode; a field added to either set must fit that
height or raise it (the create-room height check in `apps/normal-web/e2e/normal.spec.ts` fails when it does not).
On a phone (one column) nothing is reserved: the dialog is as tall as its `max-height` in both modes, so it does not
move either.

**The "Nặn bài" box** (Plan 21, spec 2026-10-08 §4.2.1) is a checkbox in the Blind fields, off to begin with, under "Số
lượng bot" in the same cell (`.botsCell`): the wager's hint runs two lines, so that row is taller than the bot count by
about a line and a half, and the box takes the slack — Blind's fields end where they did and `.modeFields` stays 14rem.
It is its own label (not a `Field`, which would re-caption it), so its accessible name is just "Nặn bài"; what it does to
the round ("each round lasts up to 20 s, less once everyone has turned") is its description, `aria-describedby` text that
is screen-reader-only (`visually-hidden`) rather than a line of the dialog. While it is ticked the turn-timer cell — the
box's visible consequence — stops being a select and reads, read-only, "20 giây · nặn bài" (`create.squeezeTimer`); the
form submits `turnTimerSec: 20` and `blind.squeeze: true` whatever timer was picked before (the server forces it anyway),
and unticking gives the select back with the timer that was chosen. The box belongs to Blind only: ticked and then
flipped to Hold'em, the timer and the config are Hold'em's own. A Blind room with `config.blind.squeeze === true` wears
a gold "Nặn bài" badge (`labels.squeezeMode`) in `RoomList` and in `RoomHeader`.

### Primitives

| Component | Props |
| --- | --- |
| `Button` | `variant?` (`primary`/`gold`/`danger`/`ghost`), `size?` (`sm`/`md`/`lg`), `loading?`, `icon?`, plus every `<button>` attribute |
| `Field` | `label`, `hint?`, `error?`, `id?`, `children` (one control) |
| `Select<T>` | `value`, `options`, `onChange`, plus `<select>` attributes |
| `Panel` | `title?`, `tone?` (`ink`/`parchment`/`felt`), `className?` |
| `Badge` | `tone` (`gold`/`red`/`teal`/`muted`) |
| `Modal` | `open`, `title`, `onClose`, `closeLabel`, `children`, `footer?` — the action row: centred, `--space-5` below the body, `--space-3` between buttons; a dialog puts its buttons here and never spaces them itself. A form dialog keeps its submit button inside the `<form>` (the create-room dialog's sticky `.formFoot`, centred to match) |
| `Segmented<T>` | `options` (`{ value, label }[]`), `value`, `onChange`, `label` (the group's name), `disabled?`, `className?` — the one "pick one of a few" pill: language, lobby filter, create-form mode, theme |

### Router

`useHashRoute()` → `{ route: { path, segments, query }, navigate(path) }`. `parseHash(hash)` is the pure part. Deliberately
tiny: `#/lobby`, `#/room/ABC234`. An app that wants a real router can ignore it.

---

## Theming

Tokens live in `src/theme/tokens.css` and are all an app needs to restyle the kit.

| Group | Tokens |
| --- | --- |
| Surfaces | `--bg`, `--bg-elev`, `--bg-mesh`, `--line` |
| Ink | `--ink`, `--ink-muted` |
| Accents | `--gold`, `--gold-soft`, `--gold-ink`, `--red` (ink), `--red-fill` (paint), `--red-soft`, `--red-ink`, `--teal`, `--teal-fill`, `--teal-ink` |
| Table | `--felt`, `--felt-edge` |
| Cards | `--card-face`, `--card-ink`, `--card-red` |
| Type | `--font-display`, `--font-body` |
| Space | `--space-1`…`--space-8` (4 px scale), `--radius-sm/md/lg/pill`, `--tap` (44 px), `--measure-wide` (1180 px: lobby, wardrobe) and `--measure-narrow` (44rem: pages read top to bottom) — content widths, padding not included |
| Motion | `--dur-1`, `--dur-2`, `--dur-flip` (a card's turn), `--dur-deal` (the slide out of the deck), `--dur-lift` (the showdown's lift and turn), `--ease`, `--ease-lift` |
| Misc | `--focus`, `--shadow-1`, `--shadow-2`, `--z-modal` |

**Dark is the default**; `data-theme="light"` on the root swaps the page to parchment. The felt does not follow it —
a card table is a physical object and stays night-side in both themes. Anything printed on it therefore has to keep
dark-theme contrast, which is what `data-surface="night"` does: put it on an element and the ink half of the palette
is re-declared for that subtree — the red pair and the text `color` too, so text the subtree merely inherits (the
hand-result card's names) stays light under the light theme instead of reading the page's dark ink on the night card.
`PokerTable`, `ActionBar` and the hand-result overlay set it themselves; an app can put it on any panel it lays over
the felt.

**The atmosphere covers the whole page, not one screenful.** `body` carries the mesh background and two
pseudo-element layers (grain, vignette); `background-attachment: fixed` used to pin all three to the
*viewport*, so on a page taller than one screen (a long account screen such as the wardrobe) the gradient
only ever painted the first ~900 px and the rest of the page fell back to a flat, seam-edged `--bg`.
`body` is now `position: relative` and the two pseudo-elements are `absolute` rather than `fixed`, which
ties them to `body`'s own document-height box instead of the viewport — the atmosphere now always covers
exactly as much page as there is, and scrolls with the content instead of staying pinned in place. No
visual change on any page short enough to fit one screen; a page longer than that no longer goes flat past
its first screenful.

**Contrast is a test, not a habit.** `src/theme/tokens.test.ts` parses the palettes back out of
`tokens.css` and asserts WCAG AA (4.5:1) for every pair the kit prints text on — the three inks on
`--bg` and `--bg-elev`, each `*-ink` on the fill it belongs to, the card ranks on the card face, and
the night palette again over `--felt`. Adding an accent means adding its pair there. The light
theme's `--gold` was darkened from `#9a6e15` to `#856011` (same 40° hue) because the lighter value
reached only 3.93:1 as ink on parchment and 4.30:1 under `--gold-ink`; `--gold-soft` follows it.

A few components are **parchment islands** — a room ticket, `.panel.parchment`, and Lite's copy of the ticket
(`lite.module.css`) — that re-declare the light inks locally so they stay printed paper whatever the page theme is
(`.panel.felt` is the mirror image for the night side). They carry their own paper gradient rather than `--bg`, so the
test checks them separately against its darker stop; a value copied there has to be one that clears
AA on paper, not merely the one the theme happens to use today. An app's own island is covered the same way: the
helpers the test uses (`luminance`, `contrast`, `tokensOf`, `parseColor`, `over`, `declarationsOf`, `placeholderColour`
and the palettes read out of `tokens.css`) live in `src/theme/contrast.ts` and are exported as **`@bp/ui-kit/testing`**
(`package.json` → `exports["./testing"]`; not from `src/index.ts`, only tests import it).
`apps/lite/web/src/screens/lite.contrast.test.ts` checks Lite's island with them, and
`apps/normal-web/src/screens/normal.contrast.test.ts` Normal's placeholder. Vitest blanks every CSS import,
`?raw` included, so an app that reads a stylesheet in a test needs `test.css.include: [/\.css\?raw$/]` in its
`vitest.config.ts` (Lite and Normal have it); the helpers throw on a blank stylesheet rather than pass on nothing.

**Red is split the way teal is** (Plan 20, T2). One value cannot be both an ink that clears 4.5:1 on `#0b1020` and a fill
dark enough for `--red-ink` to read on it, so:

- **`--red` is ink** — an error line, a loss (`.amount[data-sign='down']`), a full table's count, `.badge.red`, a toast's
  glyph. Dark, night and `.panel.felt`: `#e0737b`, 6.23:1 on `--bg`, 5.60:1 on `--bg-elev`, 5.43:1 on the felt's own
  ground (it was 3.59, 3.22 and 3.13). Light: `#a9242d`, unchanged.
- **`--red-fill` is paint** — the danger button, a connection's dot, the urgent timer's ring, and every red rule or
  border (an invalid field, an alert, a banner, a toast, Lite's notice). Dark and night: `#c8323c`, the old value, which
  holds 3:1 as a non-text mark on every ground it is painted on, with `--red-ink` at AA on it (4.84:1). Light: the same
  `#a9242d` as `--red`, since on paper one value already does both. The fills measure 0 px different from before.
- **An island that re-declares `--red` declares `--red-fill` beside it**, or a fill inside takes the page theme's:
  the dark theme's `#c8323c` on paper. The room ticket, `.panel.parchment` and Lite's ticket declare `#a9242d` for
  both; `.panel.felt` declares `#e0737b` and `#c8323c`; `[data-surface='night']` the same pair.
- A usage guard enforces the split in every stylesheet the kit ships, and in Lite's and Normal's own: `--red` may only
  be a `color`, `--red-fill` never. A fill left on `--red` fails (it would turn pink on the dark ground), and so does
  an ink moved onto `--red-fill` (it would fall back to 3.6:1).

**Badge text is a composite, and is tested as one.** A badge is 12 px at weight 600, so its ink needs 4.5:1 on its
own translucent tint over whatever is under it. The inks are drawn toward `--ink` — gold and teal 20 %, the muted
grey 12 % — and red is the `--red` ink; the tints are unchanged, and the border and the table's opaque tint follow
`currentColor`. `tokens.test.ts` → "badge text" measures every tone on every ground a badge is printed on: `--bg`
and `--bg-elev` in the dark, light and night palettes; the page's mesh under the room header (`--bg-mesh`, derived
from the token and pinned to a pixel sampled on the real build); a dark `.panel.ink` under its highlight (held at
2 %); both ends of both paper islands under both themes; `.panel.felt`; and a seat on the table. Its
`BADGES_BELOW_AA` is empty, and guarded both ways like `BELOW_AA`: a badge that gets worse fails, and so does one that
is fixed while its line is left behind.

**Placeholders.** A placeholder is text, so it is held to AA too: `color-mix(in srgb, var(--ink-muted) 94%, transparent)`
(Lite's name field 5.03:1 on the paper, Normal's fields 4.69 light and 6.82 dark, the kit's `JoinByCode` fields the
same as Normal's), with `opacity: 1` because Firefox draws `::placeholder` at 0.54 by default and would undo it. The
browser's own default, `#757575`, is 3.98 on the light field and 4.11 on the dark one. `placeholderColour(rule,
palette)` in the testing export models the least forgiving engine for that test.

The one layout knob is `--bp-stage` (see [Embedding](#embedding-it-in-an-app)).

**Motion** is CSS, and one script. The cards' slide out of the deck, their turn and the showdown's lift are keyframes —
**Card motion**, under the table above, has them and their numbers (`--dur-flip` 600 ms, `--dur-deal` 360 ms,
`--dur-lift` 720 ms, `--ease-lift`); the turn ring is a conic-gradient countdown, the pot pulses once per `POT_UPDATED`,
the winner seat glows. The script is `PeelCard`'s `requestAnimationFrame` tween (the squeeze's peel, snap and slide).
`prefers-reduced-motion: reduce` switches every animation and transition off in `global.css` and in the card's own list in
`table.module.css`, and `PeelCard` reads the same media query and jumps each of its tweens to its end — the gesture still
works, the card opens or drops back at once. The result card waits for the showdown's turn to end (`REVEAL_HOLD_MS`, see
`HandResult` above), and so do the table's own result cues (`resultPending`, same place).

---

## Responsive rules

Breakpoints 480 / 768 / 1024, per spec §27.1. No horizontal page scroll at any width.

- **The room is a stage, not a document.** `RoomScreen` is exactly `--bp-stage` (default `100dvh`) tall: header at
  the top, action tray at the foot, felt in between. The page itself never scrolls, so the tray is reachable
  without scrolling on every size — which is the whole point of it being a tray.
- **The ring table is height-led.** The oval takes the space between the header and the tray and derives its width
  from it (2:1, capped at 980 × 490). Seats ride the rim at fixed percentages of that box, spaced by equal *arc
  length* so a nine-handed table spreads evenly instead of bunching on the flanks; from seven seats up the plates
  go compact. Standing alone in a box of unknown height, `PokerTable` falls back to its intrinsic size. On a felt
  400 px tall or less (a laptop window with the tray up: 1366 × 768, 1536 × 730, 1280 × 720) the cards and the gaps
  in the seat blocks shrink — never the plates, which carry the names — so the viewer's own block, cards, plate and
  its two lines, stays inside the stage.
- **The room fits the screen** (review 2026-09-29, No2). With six seats, neither the page nor the stage scrolls at
  1920 × 940 (the user's screen), 1536 × 730, 1280 × 720 or 1366 × 768, whether the room is taking seats, a hand is
  on with the tray up, or the result card is showing: `normal.spec.ts` asserts it at all four. The worst each state
  can show — every plate with a caption, six hands shown down with two side pots, the Hold'em sizing tray — is
  frozen in the playground at `#worst/<waiting|turn|result>/<seats>/<vi|en>[/long]` for measuring against a new size
  (`/long`: the viewer's own name is 30 characters). At all four sizes the held result card stops above the viewer's
  own seat; on a 375 × 812 phone it still covers it, closable (see `HandResult` above).
- **Under 768 px wide *or* 620 px tall** the table switches to the vertical stack: opponents on top (that strip is
  the part that scrolls), board in the middle, the viewer's own seat pinned above the tray. A short window has no
  more to give than a narrow one, so both take the same layout. `layout="ring" | "stack"` overrides the choice.
- Under 768 px the bet slider drops out (a thumb cannot hit a one-point step); the presets and the number input
  take its place full-width, and the room header and tray tighten so the viewer's own cards stay on screen.
- Touch targets are ≥ 44 px (`--tap`) wherever the pointer is coarse.

---

## The text-overlap rule

**No visible text is drawn over other visible text**, on any screen, at any viewport (review 2026-09-29, No11b: the
"Ván tiếp theo sau 6 giây" countdown printed across the viewer's own seat plate, `No2-1`). The Normal e2e asserts it
with `expectNoTextOverlap(page, label, opts?)` from `apps/normal-web/e2e/overlap.ts`, whose own proof is
`e2e/overlap.spec.ts` (static fixtures, no account). A spec that calls it sets
`test.use({ contextOptions: { reducedMotion: 'reduce' } })` — or calls it through `expectNoTextOverlapAt(page, label,
viewports?)` (`e2e/support.ts`), which switches reduced motion on for the reading (and off again when the test was
not running under it), sets each viewport in turn and walks a page taller than the window down in window-high
steps. The helper waits for fonts and for *finite* animations (2 s at most — an infinite one is never waited on),
then measures once:

- **Text runs, not boxes.** Every non-blank text node's line boxes (`Range.getClientRects()`), clipped by every
  ancestor that clips its overflow (an ellipsis, a scroll area — an absolutely positioned box escapes the ones below
  its containing block) and by the viewport. Text in `svg`, `[role=img]` or `[aria-hidden=true]` is artwork and is
  skipped, as is anything failing `checkVisibility`.
- **Cut to the line-height, nothing more.** A line box is the font's full height (about 1.25 em for Be Vietnam Pro
  and Fraunces). Where the element's computed line-height is smaller — `line-height: 1` — each box loses half the
  difference at the top and half at the bottom, so consecutive lines of one block just touch instead of overlapping.
  Under `normal` or any line-height at least the box's height nothing is cut, so two loosely set texts whose boxes
  run 4–5 px into each other (the countdown over the viewer's badges at 1920×940) are an overlap.
- **Layers.** Text inside a modal (`[role=dialog][aria-modal=true]`) or the toast stack is compared only with its own
  layer; everything else is one page layer.
- **Overlap** is two runs of one layer intersecting by more than 2 px in both axes — unless the lower one is covered:
  at the centre of the intersection, some element painted above it (not its own ancestor) has a background at least
  0.9 opaque — a solid `background-color`, or a gradient whose every stop is — after multiplying in its opacity. A
  card's own title over the felt text beneath it, or a sticky footer over the fields it scrolls over, is covering, not
  overlapping.
- **The failure** lists each pair: both texts (trimmed to 40 characters), their measured boxes and a short CSS path.

**`data-overlap-ok="<reason>"`** on an element exempts the text inside it. It is for the rare overlap that is there by
design, the reason is mandatory (an empty attribute exempts nothing), and it is never a way to silence a layout bug.
The helper's `ignore` option (CSS selectors skipped entirely) is for the same kind of rare, documented case.

What the rule does **not** catch:

- **Text against a box.** Text touching or crossing a card's or a badge's edge is a box-spacing problem: `No11-1`'s
  "Tay nóng" card (now "Vận đỏ") sitting on the "HUY HIỆU" heading is one, and it is the grid spacing assertion (group gap ≥ 16 px,
  equal card heights in a row) that covers it. Likewise text over a badge's pill that stays clear of the badge's own
  text.
- **Words inside `aria-hidden`.** An `aria-hidden="true"` subtree is skipped even when it shows real words to the eye
  — the wardrobe cards' rarity line (`RarityLabel`, "THƯỜNG", "HIẾM") is one — so an overlap involving such text goes
  unreported. The rule does not look inside; words that need checking have to live outside the hidden subtree.
- **What is not on screen or not a text node:** text below the fold (scroll and call again), form-control values and
  placeholders, CSS generated content (`::before { content }`).
- **Partial covers:** the cover test samples one point, the centre of the intersection; a cover that is a
  pseudo-element, or less than 0.9 opaque, does not count as hiding anything.

**Where it runs** (Plan 16, Task 9): `docs/test-matrix.md`, section "Review 2026-09-29 — the text-overlap rule
(No11b)", lists every screen and state that is read, the sizes each is read at, and the tests. In short: the default
e2e reads the main screens at 1920 × 940, 1366 × 768 and 375 × 812 inside tests that already go there — not every
state at every size (the wardrobe's other six tabs, for one, are not read) — and the operation-test pack reads
Hold'em hands at its own 1440 × 900 and those three sizes, Blind hands at 1440 × 900 only. No screen carries a
`data-overlap-ok` today.

---

## i18n

Two namespaces per language: `common` (units, time, generic words) and `game` (everything else; the default
namespace). Keys are dotted and grouped by role — `game`: `app.*`, `nav.*`, `actions.*`, `labels.*`, `mode.*`,
`blind.*`, `phase.*`, `street.*`, `card.*`, `hand.*`, `status.*`, `lobby.*`, `create.*`, `room.*`, `notify.*`,
`presets.*`; `common`: `errors.*`, `language.*`, `units.*`, `time.*`.

Rules:

- **No literal strings in JSX.** `react/jsx-no-literals` enforces it for `packages/ui-kit/**` and `apps/**`.
- **Every key exists in both languages.** A test asserts key parity between `en` and `vi`; adding one to a single
  locale fails the build.
- Numbers go through `formatPoints` / `formatCompactPoints`, never `toLocaleString` at the call site.
- Dates go through `formatDay` ("28 thg 9, 2026") and `formatMoment` ("08:46, 28 thg 9", the year only when it is
  not this one) — both editions, every screen.
- Hand categories translate through `handLabel(category, t)` off `HAND_CATEGORY_KEYS`; cards through
  `cardLabel(card, t)`; protocol errors through `errorLabel(code, t)`.
- `NOTIFICATION` slips look up `notify.<kind>` and fall back to `notify.other`. `Toasts` hands `t` exactly two
  values off the payload — `amount` (already formatted) and `id` — so a string may use `{{amount}}` or `{{id}}`
  and nothing else. An app wanting a *name* where the server sent an id (`ACHIEVEMENT_UNLOCKED`) rewrites the
  notification before passing it in.
- `TABLE_LIMIT_SPENT` (a Blind seat stood up because its table limit can no longer cover a hand; `payload.amount` is
  what went back to the balance) reads `notify.TABLE_LIMIT_SPENT`, or `notify.TABLE_LIMIT_SPENT_none` when that amount
  is 0 — `Toasts` picks the variant, so the string never announces a return of nothing.

An app adds its own namespace without forking the resources:

```ts
const i18n = createI18n({
  extraResources: { vi: { normal: viNormal }, en: { normal: enNormal } },
})
// in the app's own components: useTranslation('normal')
```

Namespace names are taken from the `vi` map, so both languages must declare the same set.

---

## Footprint

**The budgets are ≤ 250 kB gzip JS and ≤ 40 kB gzip CSS.** Gzip over the shipped bundle is the only figure held to a
budget here — it is what a browser actually downloads. Raw sizes are recorded because they are useful when hunting
a regression, not because anything is measured against them.

`pnpm --filter @bp/ui-kit build:playground` builds the playground (React 18 + i18next + the whole of `@bp/ui-kit`,
plus `@bp/core`'s engine and bot, which only the harness needs). Re-measured after the final-review fix wave (before
Plan 21: the deck, `PeelCard` and the new styles are not in these figures, and the table has not been measured since):

| Bundle | Raw (informational) | Gzip (**budgeted**) |
| --- | --- | --- |
| Playground JS (kit + React + i18next + core engine + bots) | 296.2 kB | **95.9 kB** of ≤ 250 kB |
| Playground CSS (all of the kit's styles) | 41.2 kB | **9.4 kB** of ≤ 40 kB |
| Kit only (barrel + React + i18next, no engine) | 277.3 kB | 90.1 kB |

Both packages declare `sideEffects` so a bundler may drop what an app does not import: `false` for `@bp/core`, and
`["**/*.css"]` for `@bp/ui-kit`, whose stylesheet imports are the one thing that must survive tree-shaking.

The kit's stylesheets are 56.8 kB of CSS source (comments and formatting included), which minifies to the 41.2 kB
shipped above and compresses to 9.4 kB on the wire. The source figure is informational only: it is not held to a
budget, and an earlier raw-size ceiling has been retired in favour of the gzip numbers.

`src/index.ts` exports only ui-kit modules, and the kit imports just types and small helpers
(`HAND_CATEGORY_KEYS`, `RANK_CHARS`, `SUIT_CHARS`, `rankOf`, `suitOf`, `validateRoomConfig`, `ECONOMY`) from
`@bp/core` — no engine, no bot code. The ~5.8 kB gzip difference between the first and last rows is the
playground's own engine-driven mock server. Lite's hard bundle budget is enforced by a test in Plan 4; this section
only records the measurement.

---

## Testing utilities

Exported for consumers' tests as well as the kit's own:

- **`FakeSocket`** — a `SocketLike` with no network behind it. `open()`, `receive(msg)` to push a `ServerMessage`,
  `serverClose(code, reason)` for a close from the other end, `close(code)` for one from this side, and `sent` for
  the frames the client wrote. `FakeSocket.instances` / `FakeSocket.reset()` track every socket a test opened.
- **`fakeSocketFactory`** — pass it as `useGameClient({ socketFactory })` to drive a whole screen from a test
  without a server.
- **`reduceClient(state, action)` / `initialClientState`** — the reducer is pure, so protocol behaviour can be
  tested without React at all. This is how the engine-equivalence test works.
- Inside the package, `src/test-fixtures.ts` has ready-made `RoomView` / `RoomPlayerView` / `ClientHand` fixtures
  (not part of the public export map — copy what you need).

The kit's own tests run under jsdom with `@testing-library/react`: `pnpm --filter @bp/ui-kit test`.

For eyeballing changes, `pnpm --filter @bp/ui-kit playground` starts Vite on port 5175 with an engine-driven mock
server — real `@bp/core` hands, real `filterEvent` hole-card hiding, real reducer. Controls: game mode (Hold'em,
Blind A, Blind B, and — Plan 21 — "Blind A · nặn bài" and "Blind B · nặn bài", `blindS` / `blindBS`: squeeze rooms whose
viewer's cards come face down to peel or turn with "Lật"; the first also seats a second, non-bot player who turns in
their own time), room/lobby view, seat count
(4/6/9), theme, language, forced stack layout, and "next hand". `#peel` is the squeeze's `PeelCard` alone on the felt, for
trying the gesture from any edge or corner. `#worst/<state>/<seats>/<lang>`
(`playground/scenarios.tsx`) skips the engine and freezes the room at its tallest — `waiting`, `turn` (the Hold'em
sizing tray, my turn ring running) or `result` (every seat shown down, two side pots, the countdown on the card) —
full-viewport, for measuring a layout against a screen size.

---

## Known gaps

- **Spectators** see the table read-only; there are no spectator controls and no spectator chrome.
- **No chat.** Nothing in the protocol carries it yet.
- **No top-up.** `TOP_UP` is not in the protocol, so a short stack has to stand up and sit back down.
- The felt resizes slightly between the ring and stack layouts when a window crosses a breakpoint; the tray's height
  is reserved from 768 px up so it does not also move on every turn.
- Playground screenshots are described in `packages/ui-kit/playground/screenshots/README.md` rather than committed
  as images.
- **The squeeze peel** is driven in Chromium only, and not yet on a real phone: Firefox's and WebKit's touch-capture
  semantics are guarded in `PeelCard` and unit-tested with synthetic events, never run in those browsers. On a device
  that does not coalesce pointer events a single quick move after a rest is not read as a flick. A play-or-fold squeeze
  table on a 375 × 812 phone (six seats, one bot) scrolls its stage 11 px in the round (its header takes a third line and
  the viewer's seat the "Lật" pill's row; the seat stays on screen); a pure-luck one fits since the phone's tray wait
  line gave back 8 px (the final fix wave: it was 3 px over). A ring↔stack switch in the middle of a round can send a
  second, harmless `REVEAL`. All four are written up in `docs/known-limitations.md`.
- **The badge test measures the grounds a badge sits on today** (see Theming → Badge text). A badge on a ground it
  does not list is not measured, and one place is tight: teal under a dark `.panel.ink`'s highlight. The test holds
  that highlight at 2 %, above anywhere a badge is (Lite's "claimed" badge: 0.8–1.4 %, none on a phone; titled panels put
  their content below the title and its rule). A teal badge on the first line of a tall dark panel, at 3–4 %, would
  read 4.44–4.32:1; no such placement exists, and a lighter teal would buy the margin for it at the price of a paler
  badge everywhere. The page's mesh is modelled where a badge is (under the room header, top-left), not at its other
  washes.
