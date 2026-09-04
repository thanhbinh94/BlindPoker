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
loads Fraunces and Be Vietnam Pro from Google Fonts; Lite ships offline and lets the fallbacks (Georgia,
Segoe UI) stand. Never a runtime check — just a different `<head>`.

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

function App({ lang, onLanguage }: { lang: Language; onLanguage: (l: Language) => void }) {
  const client = useGameClient({ url: 'wss://…/ws', token: sessionToken })
  const { route, navigate } = useHashRoute()
  return (
    <GameClientProvider client={client}>
      {route.path.startsWith('/room') ? (
        <RoomScreen client={client} lang={lang} onLeft={() => navigate('/lobby')} />
      ) : (
        <LobbyScreen client={client} lang={lang} onLanguage={onLanguage} onEnteredRoom={() => navigate('/room')} />
      )}
    </GameClientProvider>
  )
}
```

`RoomScreen` fills the viewport by design (see [Responsive rules](#responsive-rules)). If the app draws its own bar
above it, set `--bp-stage` on the room's container: `--bp-stage: calc(100dvh - 64px)`, or `100%` inside a flex column
that already has a height.

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
| `act(action)` | `ACTION` with `baseSeq` = the latest applied `seq` |
| `resync()` | `RESYNC` |
| `clearError()`, `dismissNotification(id)` | local state only |
| `serverNow()` | `Date.now()` + the `WELCOME` clock offset — **always** compare deadlines against this |

`ClientState` carries `status` (`idle`/`connecting`/`open`/`reconnecting`/`closed`), `me`, `rooms`, `room`, `hand`,
`seq`, `deadlineAt`, `lastError`, `notifications`, `resyncNeeded`, `serverTimeOffset`.

The rules the client obeys — reconnect with exponential backoff 1 s → 30 s, auto-`HELLO`, auto-`PONG`, a `seq` that
goes backwards or a `STALE_STATE` / `INTERNAL "resync required"` error setting `resyncNeeded` and triggering
`RESYNC` — are the client half of **"Reconnecting and frame order"** in [`docs/server-kit.md`](./server-kit.md). A
test drives real `@bp/core` hands through `reduceClient` and asserts its view equals the engine's `playerView`, so
the reducer cannot drift from the server.

---

## Component catalogue

Everything is presentational and takes state plus callbacks. `lang` is threaded as a prop for number and date
formatting; strings come from `useTranslation()`.

### Screens

| Component | Props |
| --- | --- |
| `LobbyScreen` | `client`, `lang`, `onLanguage`, `onEnteredRoom`, `extraNav?`, `header?` |
| `RoomScreen` | `client`, `lang`, `onLeft`, `avatarFor?`, `header?`, `layout?` |

`onLeft` fires the moment the room is gone — left, closed or kicked — and the app decides where that lands.

### Table

| Component | Props |
| --- | --- |
| `PokerTable` | `room`, `hand`, `myPlayerId`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `canSit`, `layout?`, `avatarFor?`, `onSeatClick?` |
| `Seat` | `seat`, `player`, `isMe`, `isActing`, `isButton`, `winnerPayout`, `showdownLabel`, `deadlineAt`, `serverNow`, `turnTimerMs`, `lang`, `position`, `avatar?` |
| `Card` | `card?`, `faceDown?`, `size?` (`sm`/`md`/`lg`), `delayMs?`, `highlighted?`, `className?` |
| `CommunityCards` | `cards`, `highlight?` |
| `Pot` | `pot`, `carryOver`, `pulse`, `lang` |
| `TurnTimer` | `deadlineAt`, `serverNow`, `totalMs`, `size?` |
| `ActionBar` | `hand`, `room`, `onAct`, `disabled?`, `lang` |
| `HandResult` | `hand`, `room`, `myPlayerId`, `lang`, `onDismiss?` |
| `RoomHeader` | `room`, `status`, `onLeave`, `lang`, `right?` |

`ActionBar` offers only the kinds the server declared legal and clamps every preset into the legal range, so a click
can never produce an illegal amount. Keyboard: `F` fold, `C` check/call, `R` focus the amount, `Enter` submit — all
advertised through `aria-keyshortcuts`. Between turns it stays in place and says so rather than collapsing.

### Lobby

| Component | Props |
| --- | --- |
| `RoomList` | `rooms`, `onJoin`, `filter?`, `onFilter?`, `lang`, `busy?` |
| `CreateRoomForm` | `onSubmit`, `busy?`, `initialMode?`, `lang` |
| `JoinByCode` | `onJoin`, `busy?`, `lang`, `error?` |
| `PlayerBar` | `displayName`, `balance`, `status`, `lang`, `onLanguage`, `right?` |
| `LanguageSwitch` | `lang`, `onChange` |

`CreateRoomForm` only offers values from `ECONOMY` and still runs the draft through `validateRoomConfig`; it is the
*validated* config that reaches `onSubmit`.

### Primitives

| Component | Props |
| --- | --- |
| `Button` | `variant?` (`primary`/`gold`/`danger`/`ghost`), `size?` (`sm`/`md`/`lg`), `loading?`, `icon?`, plus every `<button>` attribute |
| `Field` | `label`, `hint?`, `error?`, `id?`, `children` (one control) |
| `Select<T>` | `value`, `options`, `onChange`, plus `<select>` attributes |
| `Panel` | `title?`, `tone?` (`ink`/`parchment`/`felt`), `className?` |
| `Badge` | `tone` (`gold`/`red`/`teal`/`muted`) |
| `Modal` | `open`, `title`, `onClose`, `closeLabel`, `children` |

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
| Space | `--space-1`…`--space-8` (4 px scale), `--radius-sm/md/lg/pill`, `--tap` (44 px) |
| Motion | `--dur-1`, `--dur-2`, `--ease` |
| Misc | `--focus`, `--shadow-1`, `--shadow-2`, `--z-modal` |

**Dark is the default**; `data-theme="light"` on the root swaps the page to parchment. The felt does not follow it —
a card table is a physical object and stays night-side in both themes. Anything printed on it therefore has to keep
dark-theme contrast, which is what `data-surface="night"` does: put it on an element and the ink half of the palette
is re-declared for that subtree. `PokerTable`, `ActionBar` and the hand-result overlay set it themselves; an app can
put it on any panel it lays over the felt.

The one layout knob is `--bp-stage` (see [Embedding](#embedding-it-in-an-app)).

**Motion** is CSS only — dealt cards flip in on a 60 ms stagger, the turn ring is a conic-gradient countdown, the pot
pulses once per `POT_UPDATED`, the winner seat glows. `prefers-reduced-motion: reduce` switches every animation and
transition off in `global.css`; there is no JS animation loop to disable.

---

## Responsive rules

Breakpoints 480 / 768 / 1024, per spec §27.1. No horizontal page scroll at any width.

- **The room is a stage, not a document.** `RoomScreen` is exactly `--bp-stage` (default `100dvh`) tall: header at
  the top, action tray at the foot, felt in between. The page itself never scrolls, so the tray is reachable
  without scrolling on every size — which is the whole point of it being a tray.
- **The ring table is height-led.** The oval takes the space between the header and the tray and derives its width
  from it (2:1, capped at 980 × 490). Seats ride the rim at fixed percentages of that box, spaced by equal *arc
  length* so a nine-handed table spreads evenly instead of bunching on the flanks; from seven seats up the plates
  go compact. Standing alone in a box of unknown height, `PokerTable` falls back to its intrinsic size.
- **Under 768 px wide *or* 620 px tall** the table switches to the vertical stack: opponents on top (that strip is
  the part that scrolls), board in the middle, the viewer's own seat pinned above the tray. A short window has no
  more to give than a narrow one, so both take the same layout. `layout="ring" | "stack"` overrides the choice.
- Under 768 px the bet slider drops out (a thumb cannot hit a one-point step); the presets and the number input
  take its place full-width, and the room header and tray tighten so the viewer's own cards stay on screen.
- Touch targets are ≥ 44 px (`--tap`) wherever the pointer is coarse.

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
- Hand categories translate through `handLabel(category, t)` off `HAND_CATEGORY_KEYS`; cards through
  `cardLabel(card, t)`; protocol errors through `errorLabel(code, t)`.

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

`pnpm --filter @bp/ui-kit build:playground` builds the playground (React 18 + i18next + the whole of `@bp/ui-kit`,
plus `@bp/core`'s engine and bot, which only the harness needs). Measured on the commit that added this document:

| Bundle | Raw | Gzip |
| --- | --- | --- |
| Playground JS (kit + React + i18next + core engine + bots) | 292.0 kB | **94.3 kB** |
| Playground CSS (all of the kit's styles) | 39.2 kB | **8.9 kB** |
| Kit only (barrel + React + i18next, no engine) | 272.8 kB | 88.6 kB |

Budgets for this plan were ≤ 250 kB gzip JS and ≤ 40 kB gzip CSS; both have a wide margin. `src/index.ts` exports
only ui-kit modules, and the kit imports just types and small helpers (`HAND_CATEGORY_KEYS`, `RANK_CHARS`,
`SUIT_CHARS`, `rankOf`, `suitOf`, `validateRoomConfig`, `ECONOMY`) from `@bp/core` — no engine, no bot code. The
~5.8 kB gzip difference between the two rows is the playground's own engine-driven mock server. Lite's hard bundle
budget is enforced by a test in Plan 4; this section only records the measurement.

---

## Testing utilities

Exported for consumers' tests as well as the kit's own:

- **`FakeSocket`** — a `SocketLike` with no network behind it. `open()`, `emit(msg)` to push a `ServerMessage`,
  `close(code)`, and `sent` for the frames the client wrote.
- **`fakeSocketFactory`** — pass it as `useGameClient({ socketFactory })` to drive a whole screen from a test
  without a server.
- **`reduceClient(state, action)` / `initialClientState`** — the reducer is pure, so protocol behaviour can be
  tested without React at all. This is how the engine-equivalence test works.
- Inside the package, `src/test-fixtures.ts` has ready-made `RoomView` / `RoomPlayerView` / `ClientHand` fixtures
  (not part of the public export map — copy what you need).

The kit's own tests run under jsdom with `@testing-library/react`: `pnpm --filter @bp/ui-kit test`.

For eyeballing changes, `pnpm --filter @bp/ui-kit playground` starts Vite on port 5175 with an engine-driven mock
server — real `@bp/core` hands, real `filterEvent` hole-card hiding, real reducer. Controls: game mode, room/lobby
view, seat count (4/6/9), theme, language, forced stack layout, and "next hand".

---

## Known gaps

- **Spectators** see the table read-only; there are no spectator controls and no spectator chrome.
- **No chat.** Nothing in the protocol carries it yet.
- **No avatar renderer.** `PokerTable` and `RoomScreen` take an `avatarFor(player)` slot and draw an initial disc
  when it is absent; Normal supplies a real one from its cosmetics.
- **No top-up.** `TOP_UP` is not in the protocol, so a short stack has to stand up and sit back down.
- **Sit-out is not exposed.** `SITTING_OUT` renders on a seat but there is no message to request it.
- The felt resizes slightly between the ring and stack layouts when a window crosses a breakpoint; the tray's height
  is reserved from 768 px up so it does not also move on every turn.
- Playground screenshots are described in `packages/ui-kit/playground/screenshots/README.md` rather than committed
  as images.
