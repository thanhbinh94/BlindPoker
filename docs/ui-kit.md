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
| `PokerTable` | `room`, `hand`, `myPlayerId`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `canSit`, `layout?`, `chibiFor?`, `expressionFor?`, `captionFor?`, `onSeatClick?`, `resultPending?` |
| `Seat` | `seat`, `player`, `isMe`, `isActing`, `isButton`, `winnerPayout`, `showdownLabel`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `position`, `chibi`, `expression`, `bounce`, `caption?` |
| `Card` | `card?`, `faceDown?`, `size?` (`sm`/`md`/`lg`), `delayMs?`, `highlighted?`, `className?` |
| `CommunityCards` | `cards`, `highlight?` |
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
bạn" otherwise — Hold'em between turns, or a Blind seat whose own decision is on its way. The pre-action and auto-play
rows under the line are unchanged.

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
viewer's had been drawn face down on this screen. That is 870 ms, counted from the numbers the CSS turns by: the 600 ms
turn (`FLIP_MS` in `Card.tsx`, the `--dur-flip` token — `Card.test` holds the two equal), the stagger to the last of
three cards (2 × `CARD_STAGGER_MS`, the 60 ms `Seat` multiplies by), and 150 ms to settle. The card shows at once under
`prefers-reduced-motion: reduce` (nothing turns), for a hand won by a fold (no showdown), and for a hand that was
already over when the screen first saw it (the snapshot that rebuilds the room after a refresh draws the shown cards
face up). Everything that follows the card follows the card actually drawn: the seat clearance, the close button and
the countdown's place. While the card is held, the countdown is not printed in the tray either — it would sit there
for under a second, then jump onto the card and shift the tray's buttons after it.

**The table waits with it** (the same fix wave, follow-up to No1). With the card held, the seats must not give the result
away either — the hand's name and the payout under each seat, the winner's glow, the gold edge on the best hand's board
cards (and, by design, the happy and sad faces) all used to land the moment `HAND_COMPLETE` did, over a turn the player
had not yet watched. `RoomScreen` passes `PokerTable` `resultPending={held}`: the payouts and the shown hands are left out of what
the seats are given, so no result line, no `.seatWin` and no `highlight` for the board, while every card is drawn exactly
as without it and the turn still plays. The faces take the same flag, as the third argument of
`useTableExpressions(state, serverNow, resultPending)`: it does not fold the state in while the flag is up, so the
reaction (4 s happy, 3 s sad) starts when the hold ends and runs its full length rather than losing 870 ms of it. A seat
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
seat below is not darkened (the ellipse is as tall as that box, so it is transparent by the box's foot and draws no
line across the felt). `RoomScreen` sets the clearance from `useSeatClearance(stageRef, active, seat)`
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

### Avatars (`src/avatar2d/`)

The kit does render an avatar — a **chibi**: pre-rendered PNG layers on a shared frame, not a 3D rig or anything
drawn at runtime. `Chibi` (`Chibi.tsx`) takes a `ChibiSubject` (a `ChibiConfig` — base plus equipped wearables — or
a bot's `BotChibi`), an `expression` and a `frame` (`'full'` the whole body, `'head'` the round 208×208 crop), and
stacks one `<img>` per layer `layersFor` (`layers.ts`) returns, z-ordered by layer number. `AvatarAssets`
(`AvatarAssets.tsx`) is the context provider that resolves a layer name to a URL — `assetUrl(base, file, density)`
— so a host app points the whole tree at wherever its avatar files are served from. `expressions.ts` exports
`useTableExpressions`, the per-seat expression schedule `RoomScreen` feeds `PokerTable`. `defaults.ts` builds a
brand-new human's `ChibiConfig` (`defaultChibi(seed)`) with no wardrobe and no request involved — what Lite draws,
having no cosmetics of its own — and `bot.ts` builds a bot's two-layer `BotChibi` (`botChibi(seed)`) the same
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
| `BlindFields` | `holeCards`, `onHoleCards`, `decisionMode`, `onDecisionMode`, `fixedWager`, `onFixedWager`, `botCount`, `onBotCount`, `maxBots`, `disabled`, `lang` |

`CreateRoomForm` only offers values from `ECONOMY` and still runs the draft through `validateRoomConfig`; it is the
*validated* config that reaches `onSubmit`.

`HoldemFields` (blind tier plus the buy-in window in big blinds) and `BlindFields` (hole cards, decision mode, fixed
wager — whose field carries the table-limit hint, "Table limit per player: … (5× the wager)" — and bot filler) are the mode-specific building blocks `CreateRoomForm` swaps between; both are fully controlled,
and an app only reaches for them directly when it builds its own room form. The swap happens in a box that reserves
the taller mode's height in the two-column layout (`.modeFields`: 14rem from 22rem of form width up), so the
create-room dialog does not change height when the host flips the mode; a field added to either set must fit that
height or raise it (the create-room height check in `apps/normal-web/e2e/normal.spec.ts` fails when it does not).
On a phone (one column) nothing is reserved: the dialog is as tall as its `max-height` in both modes, so it does not
move either.

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
| Accents | `--gold`, `--gold-soft`, `--gold-ink`, `--red`, `--red-soft`, `--red-ink`, `--teal`, `--teal-fill`, `--teal-ink` |
| Table | `--felt`, `--felt-edge` |
| Cards | `--card-face`, `--card-ink`, `--card-red` |
| Type | `--font-display`, `--font-body` |
| Space | `--space-1`…`--space-8` (4 px scale), `--radius-sm/md/lg/pill`, `--tap` (44 px), `--measure-wide` (1180 px: lobby, wardrobe) and `--measure-narrow` (44rem: pages read top to bottom) — content widths, padding not included |
| Motion | `--dur-1`, `--dur-2`, `--dur-flip` (a revealed card's turn), `--ease` |
| Misc | `--focus`, `--shadow-1`, `--shadow-2`, `--z-modal` |

**Dark is the default**; `data-theme="light"` on the root swaps the page to parchment. The felt does not follow it —
a card table is a physical object and stays night-side in both themes. Anything printed on it therefore has to keep
dark-theme contrast, which is what `data-surface="night"` does: put it on an element and the ink half of the palette
is re-declared for that subtree. `PokerTable`, `ActionBar` and the hand-result overlay set it themselves; an app can
put it on any panel it lays over the felt.

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

A few components are **parchment islands** — a room ticket, `.panel.parchment` — that re-declare the
light inks locally so they stay printed paper whatever the page theme is (`.panel.felt` is the
mirror image for the night side). They carry their own paper gradient rather than `--bg`, so the
test checks them separately against its darker stop; a value copied there has to be one that clears
AA on paper, not merely the one the theme happens to use today.

The one layout knob is `--bp-stage` (see [Embedding](#embedding-it-in-an-app)).

**Motion** is CSS only — dealt cards flip in on a 60 ms stagger, the turn ring is a conic-gradient countdown, the pot
pulses once per `POT_UPDATED`, the winner seat glows. `prefers-reduced-motion: reduce` switches every animation and
transition off in `global.css`; there is no JS animation loop to disable.

A face-down card that is revealed where it lies — an opponent's hand at the showdown — **turns over** (review
2026-09-29, No1): a two-sided turn about the vertical axis, `--dur-flip` (600 ms), ease-in-out so the back shows for
the first half and the face for the second, on the same 60 ms stagger. `Card` is an HTML wrapper (`.card`: size, drop
shadow, deal-in, `perspective`), a flipper and the side(s) it shows. The 3D is the turning state's alone: `.cardTurn`
puts the flipper in `preserve-3d` and gives its sides `backface-visibility: hidden`, and it stays on while the turned
face is up, so the back rotated behind it stays hidden; a card that never turns — the board, the viewer's own, the
result card's, most of the table — draws one side and stays flat. The face is the flipper's resting style and the
keyframe holds only the start (`from { rotateY(180deg) }`), so with motion off the reveal is instant. The side that
shows is the card's one `role="img"` with the label and `data-card` / `data-face`, from the render that reveals it; the
back behind a turned face is `aria-hidden` with none of them, so counts by role or label never see it, and nothing
waits on `animationend`. A card that mounts face up does not turn; it keeps its deal-in. The result card waits for the
turn to end (`REVEAL_HOLD_MS`, see `HandResult` above), and so do the table's own result cues (`resultPending`, same place).

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
  "Tay nóng" card sitting on the "HUY HIỆU" heading is one, and it is the grid spacing assertion (group gap ≥ 16 px,
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
plus `@bp/core`'s engine and bot, which only the harness needs). Re-measured after the final-review fix wave:

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
server — real `@bp/core` hands, real `filterEvent` hole-card hiding, real reducer. Controls: game mode, room/lobby
view, seat count (4/6/9), theme, language, forced stack layout, and "next hand". `#worst/<state>/<seats>/<lang>`
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
- **`--red` as ink on the dark ground is 3.6:1 (`--bg`) and 3.2:1 (`--bg-elev`)**, below AA — an error line or a
  red badge in the dark theme. One token cannot fix it: on `#0b1020` an ink needs a luminance above ~0.20 to reach
  4.5:1, while the same token used as a fill under `--red-ink` needs one below ~0.17. Closing it means splitting
  the token the way `--teal` / `--teal-fill` already are, which is a palette change across `ui-kit`, `lite-web`
  and `normal-web`. The same defect repeats on `.panel.felt`'s own `--bg` (`#0c2226`, darker than the theme's
  `#0b1020`), at **3.13:1**. `tokens.test.ts` (`BELOW_AA`) records five entries covering those three distinct
  token pairs — `--bg` and `--bg-elev` in *both* the dark and the night palette, plus the felt — and fails if any
  of them gets worse, or if one is fixed and its line is left behind.
- A badge is ink on its own tint (`--gold` on `--gold-soft`, and the same for red and teal), which lands near
  4.1–4.4:1 rather than 4.5:1. The contrast test covers flat token pairs only; the composited tints are not
  asserted. The alert in `lobby.module.css` already avoids the pattern by keeping `--ink` text and letting the
  rule and the tint carry the signal.
