# Bind Poker — Plan 6: Normal web (`apps/normal-web`: auth, profile, avatar, inventory, achievements, daily, e2e) — M7 (+ M8 client half)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Normal edition's browser app: a Vite/React shell around `@bp/ui-kit` with email + password sign-in (cookie session), the lobby and table with real avatars, and the Normal-only screens — profile (stats, history, ledger, rename), avatar customisation, inventory, achievements, daily reward with items, relief, settings — bilingual, responsive, served by `apps/normal-server` from `PUBLIC_DIR` and shipped inside its Docker image, with a Playwright end-to-end run against the real server on PGlite.

**Architecture:** `apps/normal-web` mirrors the Lite web app's shape (`apps/lite/web`): `api.ts` (REST client mirroring spec §19.2, cookie auth, `X-Requested-With`), `App.tsx` (session gate → hash routes), `screens/*`, `locales/{vi,en}/normal.json`, CSS modules on the kit's tokens. Only two ui-kit changes: a `captionFor` slot next to `avatarFor` so title/badge can sit under a seat name, and a `notify.ACHIEVEMENT_UNLOCKED` string. The avatar is an SVG layer stack drawn from a small in-app part library keyed by `assetKey` — no image assets, no CDN. Fonts come from Google Fonts in `index.html` (the CSP already allows it).

**Tech Stack:** React 18, Vite 5, `@bp/ui-kit`, `@bp/core` (types + `validateDisplayName`), i18next, Vitest + jsdom + Testing Library, Playwright (optional), esbuild (e2e server bundle in normal-server).

**Spec:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §10.2, §13, §14, §15 (avatar model, layer order base → face → clothing → hair → accessory → jewelry, `hairColor`), §19.2 (REST — the source of truth for every request), §16.2, §21, §24 (first chunk ≤ 500 KB gzip), §26, §27.2 (screens 1–13), §27.3, §28.1, §29.

## Global Constraints

- Dependency direction: `apps/normal-web → @bp/core, @bp/ui-kit` only (already in `tooling/arch/boundaries.test.ts`; add the ESLint block for `apps/normal-web/**` forbidding `@bp/server-kit`, `@bp/http-kit`, `@bp/lite`, `@bp/normal-server`, Node built-ins, `**/apps/**`).
- REST contract: `apps/normal-web/src/api.ts` mirrors spec §19.2 exactly (paths, methods, `X-Requested-With: bind-poker` on every mutating call, `credentials: 'same-origin'`, error envelope `{ error: { code, message } }` + side fields → `ApiError(status, code, message, extra)`); no retries, no caching, no state in the client.
- Auth: cookie only — the app never sees a token; `useGameClient({ url, token: null })`; the session gate probes `GET /api/auth/me` on boot; `401` anywhere → sign-in screen with a "session expired" note; logout = `POST /api/auth/logout` then `disconnect()`.
- i18n: no literal strings in JSX (`react/jsx-no-literals`); namespace `normal` in vi + en with key parity test; every `items.<id>` and `achievements.<id>.{name,desc}` key for every id in `apps/normal-server/data/*.json` (a test reads those JSON files — test-only cross-app read, allowed; production code never imports across apps). Points are never rendered as currency.
- Responsive per §27: no horizontal page scroll at 375 px; room is a stage (`--bp-stage`); touch targets ≥ 44 px.
- Budget (§24): first JS chunk ≤ 500 KB gzip; Normal-only screens lazy-loaded (`React.lazy`) so the lobby/table chunk stays near the kit's 96 KB.
- Tests colocated (Vitest jsdom); `.js` imports; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Consumed APIs (verified in the repo)
```ts
// @bp/ui-kit: createI18n({extraResources}), setLanguage, applyTheme, ThemeMode, Language, useGameClient({url, token, autoConnect?, socketFactory?}) → GameClientApi{state, connect, disconnect, …}, GameClientProvider, LobbyScreen{client, lang, onLanguage, onEnteredRoom, extraNav?, header?}, RoomScreen{client, lang, onLeft, avatarFor?(p: RoomPlayerView), header?, layout?}, PokerTable{…avatarFor?}, Seat{avatar?: ReactNode}, PlayerBar{displayName, balance, status, lang, onLanguage, right?}, LanguageSwitch, Button, Field, Select, Panel, Badge, Modal, Toasts, useHashRoute, formatPoints, formatCompactPoints, FakeSocket, fakeSocketFactory, ClientState.notifications[{id, kind, payload, at}], closeReason 'unauthenticated'
// ui-kit i18n: game:notify.<kind> with defaultValue notify.other (Toasts.tsx:57); keys KICKED, ROOM_CLOSED, DAILY_REWARD exist
// Normal REST (§19.2): /api/config, /api/catalog/items, /api/catalog/achievements, /api/auth/{register,login,logout,me}, /api/me (GET/PATCH), /api/me/{stats,history,ledger,inventory,avatar,achievements}, /api/players/:id/avatar, /api/rewards/daily (+/claim), /api/economy/relief; WS /ws authenticated by cookie at upgrade (HTTP 401 when missing)
// Server data: apps/normal-server/data/items.json (44 items, categories base|face|clothing|hair|accessory|jewelry|title|badge, assetKey `<category>/<id>`), achievements.json (32 rows)
// Lite web to mirror: apps/lite/web/{index.html, vite.config.ts, tsconfig.json, src/{main.tsx, App.tsx, api.ts, prefs.ts, session.ts, screens/Shell.tsx, screens/DailyScreen.tsx, screens/SettingsScreen.tsx, screens/lite.module.css, test-i18n.tsx, test-setup.ts}}, apps/lite/e2e/*
```

## File Structure (this plan)

```text
packages/ui-kit/src/table/{Seat.tsx,PokerTable.tsx}, screens/RoomScreen.tsx   (modify) captionFor slot; locales notify.ACHIEVEMENT_UNLOCKED; docs/ui-kit.md
apps/normal-web/package.json, index.html, vite.config.ts, tsconfig.json, vitest.config.ts
apps/normal-web/src/{main.tsx, App.tsx, api.ts, prefs.ts, session.ts, test-setup.ts, test-i18n.tsx}
apps/normal-web/src/locales/{vi,en}/normal.json
apps/normal-web/src/avatar/{parts.tsx, Avatar.tsx, useAvatars.ts}
apps/normal-web/src/screens/{Shell.tsx, AuthScreen.tsx, ProfileScreen.tsx, AvatarScreen.tsx, InventoryScreen.tsx, AchievementsScreen.tsx, DailyScreen.tsx, SettingsScreen.tsx, normal.module.css}
apps/normal-web/test/footprint.test.ts
apps/normal-web/e2e/{playwright.config.ts, normal.spec.ts}
apps/normal-server/src/e2e-entry.ts, scripts/e2e-server.mjs      (test-only server on PGlite serving the web build)
apps/normal-server/Dockerfile (web build + /app/public), deploy/normal/docker-compose.yml (PUBLIC_DIR), docs/normal-web.md, docs/deployment-normal.md, README.md, root package.json build:normal
```

---

### Task 1: ui-kit slots + Normal web scaffold, API client, i18n, shell, session gate and auth screens

**Files:**
- Modify: `packages/ui-kit/src/table/Seat.tsx` (`caption?: ReactNode` rendered under the name, small muted line), `PokerTable.tsx` + `screens/RoomScreen.tsx` (`captionFor?: (p: RoomPlayerView) => ReactNode` threaded like `avatarFor`), ui-kit locales vi/en `game.notify.ACHIEVEMENT_UNLOCKED` = "Mở khóa thành tựu: {{id}}" / "Achievement unlocked: {{id}}" (Toasts passes `payload` fields into `t` — verify how it interpolates; if it passes the payload object, `{{id}}` resolves), `docs/ui-kit.md` (slots table), tests for the slot.
- Create: `apps/normal-web/package.json` (`@bp/normal-web`, deps `@bp/core`, `@bp/ui-kit`, react, react-dom, i18next, react-i18next; devDeps as Lite's web: vite, @vitejs/plugin-react, vitest, jsdom, testing-library, typescript, `@playwright/test`), `index.html` (Google Fonts `<link rel="preconnect">` + Fraunces 500/700 + Be Vietnam Pro 400/600 with `display=swap`; same favicon/ink-ground pattern as Lite), `vite.config.ts` (root = file dir, `base: '/'`, outDir `dist`, dev proxy `/api` + `/ws` → 8080, `build.rollupOptions.output.manualChunks` not needed — lazy routes suffice), `tsconfig.json`, `vitest.config.ts` (jsdom, setup files), `src/main.tsx`, `src/App.tsx`, `src/api.ts` (+ test), `src/prefs.ts` (theme `bp.theme`, language via kit), `src/session.ts` (only `bp.normal.lastEmail` for the login form prefill — no token), `src/locales/{vi,en}/normal.json`, `src/screens/Shell.tsx` (+ CSS), `src/screens/AuthScreen.tsx` (+ test), `src/test-setup.ts`, `src/test-i18n.tsx`, root `eslint.config.js` block, root `package.json` `dev:normal-web`.

**Interfaces:**
```ts
// api.ts
export class ApiError extends Error { constructor(readonly status: number, readonly code: string, message: string, readonly extra: Record<string, unknown> = {}) }
export interface NormalApi {
  config(): Promise<ConfigDto>; catalogItems(): Promise<{ items: ItemDto[] }>; catalogAchievements(): Promise<{ achievements: AchievementDefDto[] }>
  register(input: { email; password; displayName }): Promise<AuthMeDto>; login(input: { email; password }): Promise<AuthMeDto>; logout(): Promise<void>; authMe(): Promise<AuthMeDto>
  me(): Promise<MeDto>; rename(displayName: string): Promise<{ playerId; displayName }>
  stats(): Promise<PlayerStatsDto>; history(limit?: number): Promise<HistoryEntryDto[]>; ledger(opts?: { limit?; before? }): Promise<{ entries: LedgerEntryDto[]; nextBefore: number | null }>
  inventory(): Promise<{ items: OwnedItemDto[]; avatar: AvatarConfigDto }>; setAvatar(config: AvatarConfigDto): Promise<{ config: AvatarConfigDto }>; playerAvatar(playerId: string): Promise<PlayerAvatarDto>
  achievements(): Promise<AchievementProgressDto[]>
  daily(): Promise<DailyStatusDto>; claimDaily(): Promise<DailyClaimDto>; relief(): Promise<ReliefDto>
}
export function createApi(fetchImpl?: typeof fetch): NormalApi     // every DTO field name copied from §19.2 / the server's response types (read apps/normal-server/src/http/*.ts and economy-service.ts for exact keys)
// App.tsx routes: '/' → lobby when signed in else auth; '/login' '/register' (AuthScreen mode), '/lobby', '/room', '/profile', '/avatar', '/inventory', '/achievements', '/daily', '/settings'
// Session gate: state 'checking' | 'anonymous' | 'signedIn' ; on boot api.authMe() → signedIn (connect socket) | 401 → anonymous ; any ApiError 401 from a screen → onUnauthenticated() → disconnect + anonymous + expired note
// Reconnect rule (ruling): the socket has no token, so a dead session shows as a socket that never opens; while state.status === 'reconnecting' for > 10 s the App re-probes authMe(); 401 → sign out. Test with fakeSocketFactory + fake timers.
```
AuthScreen: tabs Sign in / Register; fields email, password (min 8, show/hide), display name (register only, rules from `validateDisplayName` in core, live hint); submit via `useState` busy; errors mapped `normal:auth.errors.<code>` for INVALID_EMAIL, INVALID_PASSWORD, INVALID_NAME, EMAIL_TAKEN, DISPLAY_NAME_TAKEN, BAD_CREDENTIALS, RATE_LIMITED (+ retryAfterSec), NETWORK; success → `onSignedIn(me)`. Shell: lacquer rail like Lite with nav Lobby / Daily / Profile / Settings (+ overflow "more" on phones: Avatar, Inventory, Achievements reachable from Profile), balance + connection dot, language switch, "Bản Normal" edition mark.

- [ ] **Step 1: ui-kit slots** (tests: caption renders under the name; RoomScreen threads `captionFor`; notify key parity). Commit `feat(ui-kit): caption slot per seat and achievement notification string`.
- [ ] **Step 2: scaffold + api.ts tests** (each method: path, method, headers incl. `X-Requested-With` on mutating only, `credentials`, body; envelope parsing incl. side fields `retryAfterSec`, `claimed`, `granted`, `reason`, `retryAt`; network failure → `ApiError(0, 'NETWORK')`).
- [ ] **Step 3: App + Shell + AuthScreen tests** (boot probe → lobby; 401 → auth; register happy path; each error code; sign-out; reconnect probe ruling; rail fits 375 px — assert nav count and no literal strings).
- [ ] **Step 4:** `pnpm install`, `pnpm --filter @bp/normal-web test`, `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm --filter @bp/normal-web build`. Commit `feat(normal-web): scaffold, REST client, shell, session gate and auth screens`.

---
### Task 2: Avatar renderer, table avatars and captions, lobby/room wiring

**Files:**
- Create: `apps/normal-web/src/avatar/parts.tsx` (the part library), `Avatar.tsx` (+ test), `useAvatars.ts` (+ test), `src/screens/TableChrome.tsx` (avatarFor/captionFor factories), modify `App.tsx`

**Interfaces:**
```ts
// parts.tsx — one small vector per item, keyed by assetKey (`<category>/<id>`), drawn in a 64×64 viewBox; every id in data/items.json for the six visual categories must have an entry (test reads the JSON) — title/badge are text/glyph, not layers
export type PartRenderer = (props: { hairColor?: string }) => ReactNode
export const PARTS: Record<string, PartRenderer>
export const LAYER_ORDER = ['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry'] as const   // spec §15.1
// Avatar.tsx
export interface AvatarProps { config: AvatarConfigDto | null; size?: 'sm' | 'md' | 'lg'; label?: string; className? }   // null → the kit's initial disc look (a neutral silhouette)
export function Avatar(props: AvatarProps): JSX.Element   // <svg role="img" aria-label={label}> stacking PARTS in LAYER_ORDER; hair receives hairColor via a CSS variable; unknown assetKey → skipped (never throws)
// useAvatars.ts — one cache per app: Map<playerId, { config, displayName, title, badge } | 'missing'>; fetches GET /api/players/:id/avatar for ids not cached (dedupe in-flight), evicts after 60 s, refetches my own after PUT /api/me/avatar
export function useAvatars(api: NormalApi, playerIds: string[]): Map<string, PlayerAvatarDto | null>
// TableChrome.tsx
export function makeAvatarFor(avatars: Map<…>): (p: RoomPlayerView) => ReactNode   // bots (p.isBot) → a bot glyph, never a fetch
export function makeCaptionFor(avatars: Map<…>, t): (p: RoomPlayerView) => ReactNode   // equipped title (translated via items.<id>) and badge glyph; nothing when none
```
Design: parts are simple, characterful flat vectors on the kit's palette (ink, gold, lacquer red, teal) — a face shape with two eyes and a mouth, hair silhouettes, clothing collars, glasses/hat/mask outlines, a small jewel — deterministic per id, distinguishable at 32 px. Wire `RoomScreen avatarFor/captionFor` and `LobbyScreen extraNav` (Daily / Profile links + my `Avatar` size sm) in `App.tsx`.

- [ ] **Step 1: Tests** — `PARTS` covers every visual item id; `Avatar` renders layers in order and applies hairColor; null config → silhouette; `useAvatars` dedupes concurrent requests, caches, treats 404 as null, refetches after `invalidate(id)`; `makeAvatarFor` gives bots a glyph without fetching.
- [ ] **Step 2: Implement + wire.** Manual check in the built-in browser via the Vite dev server against the e2e server from Task 5 is done in Task 5; here rely on tests.
- [ ] **Step 3:** run, lint, commit `feat(normal-web): SVG avatar layers, per-seat avatars and captions`.

---

### Task 3: Profile, avatar customisation, inventory and achievements screens

**Files:**
- Create: `src/screens/ProfileScreen.tsx` (+ test), `AvatarScreen.tsx` (+ test), `InventoryScreen.tsx` (+ test), `AchievementsScreen.tsx` (+ test); modify `App.tsx` (lazy routes), `locales/*/normal.json`

**Behaviour:**
- **Profile**: header (Avatar lg, display name, title/badge, member since, balance); rename form (`validateDisplayName` live check; PATCH; 409 → `DISPLAY_NAME_TAKEN`; success updates the header and notes the table keeps the old name until the next join); stats panel — all 16 counters grouped Hold'em / Blind / streaks / login / social with `formatPoints` for point metrics and `handLabel` for `bestHandRank`; history list (last 20: mode, when, my net ±, won, best hand, opponents' labels with bot marks); ledger list with "load more" (`nextBefore`), reason translated `normal:ledger.reason.<reason>` (starting_balance, hand_settlement or whatever the server's `TxReason` values are — read `packages/server-kit/src/repositories.ts`), sink rows never appear (they have no player).
- **Avatar**: live preview (Avatar lg) + one picker per layer (base, face, clothing, hair, accessory, jewelry) showing only OWNED items (from `/api/me/inventory`) with rarity badge, "none" option for optional layers, hair colour swatches (8 presets + free `#rrggbb` input validated client-side), title and badge selects; Save = `PUT /api/me/avatar` with the full config; errors mapped (`NOT_OWNED`, `WRONG_CATEGORY`, `INVALID_COLOR`, `MISSING_LAYER`); on success invalidate my avatar cache. Dirty-state guard ("unsaved changes") on navigation is out of scope — note in docs.
- **Inventory**: grid of owned items grouped by category with rarity tone (common muted / rare teal / epic gold), source (default / daily / achievement) and acquired date; equipped items marked; empty-state copy for categories with nothing.
- **Achievements**: list from `/api/me/achievements` grouped by `category`; each row: name/desc (`normal:achievements.<id>.{name,desc}`), progress bar `progress/threshold`, reward (points and/or item name), unlocked date; summary "n / total unlocked".
- Mobile: single column, cards; no horizontal scroll at 375 px.

- [ ] **Step 1: Tests** with a fake `NormalApi` (each screen: loading, loaded, error, one interaction — rename 409, avatar save NOT_OWNED, load more ledger, achievement progress text).
- [ ] **Step 2: Implement** (lazy chunks: `React.lazy(() => import('./screens/ProfileScreen.js'))` etc. with a `Suspense` fallback in the Shell).
- [ ] **Step 3:** run, lint, commit `feat(normal-web): profile, avatar customisation, inventory and achievements`.

---

### Task 4: Daily reward with items, relief, settings, achievement toasts

**Files:**
- Create: `src/screens/DailyScreen.tsx` (+ test), `SettingsScreen.tsx` (+ test); modify `App.tsx`, locales

**Behaviour:**
- **Daily**: calendar of 31 days from `DailyStatus.calendar` (points; item marker on 7/14/21/28 — "common item", "rare item", "monthly badge + title"), today highlighted, claimed days marked, streak and next reset countdown (`nextResetAt` vs `Date.now()`); Claim → `POST /api/rewards/daily/claim` → receipt sheet listing points, items (names via `items.<id>`), fallback points when `fallbackPoints > 0` ("no new item left at this tier — 10,000 points instead"); `409 ALREADY_CLAIMED` → reload + note. Relief panel: eligibility (`reason` balance/cooldown with `retryAt`), Claim → `POST /api/economy/relief`; receipts; the balance itself comes from the socket's `BALANCE` frame (rail updates).
- **Settings**: theme (dark/light via `applyTheme` + `bp.theme`), language (kit `setLanguage`, `bp.lang`), account (email, display name, sign out → `POST /api/auth/logout`, confirm modal), about (edition, version from `package.json` via Vite define, links to docs).
- **Toasts**: `ACHIEVEMENT_UNLOCKED` notifications render through the kit's `notify.ACHIEVEMENT_UNLOCKED` string; the App additionally translates the payload's `id` into the achievement name by mapping `state.notifications` → `Toasts` with a `normal`-namespace lookup (ruling: implement as a small wrapper that rewrites the notification `payload.id` → `name` before handing to `Toasts`, or, if `Toasts` cannot take a transformed list, pass through `t` with `{{id}}` only and document).

- [ ] **Step 1: Tests** — calendar renders 31 cells with 4 item markers; claim flow incl. items and fallback; already-claimed; relief cooldown shows `retryAt`; settings theme/language persist; sign-out calls logout then `onSignedOut`.
- [ ] **Step 2: Implement.**
- [ ] **Step 3:** run, lint, commit `feat(normal-web): daily reward with items, relief, settings, achievement toasts`.

---

### Task 5: Build chain, server integration, footprint, e2e, Docker/docs

**Files:**
- Create: `apps/normal-web/test/footprint.test.ts`, `apps/normal-web/e2e/{playwright.config.ts, normal.spec.ts, tsconfig.json}`, `apps/normal-server/src/e2e-entry.ts`, `apps/normal-server/scripts/e2e-server.mjs`
- Modify: root `package.json` (`build:normal` = web build then server build; `e2e:normal`), `apps/normal-server/Dockerfile` (builder also builds `@bp/normal-web`; runtime copies `apps/normal-web/dist` → `/app/public`; `ENV PUBLIC_DIR=/app/public`), `deploy/normal/docker-compose.yml` (no change if ENV in image; verify), `apps/normal-server/src/config.ts` default `publicDir` stays null (documented), `docs/normal-web.md` (new, English: structure, api client, avatar parts, adding an item's vector, i18n keys, tests, e2e), `docs/deployment-normal.md` (Vietnamese: the image now serves the UI; `PUBLIC_DIR`), `README.md`, spec §27.2 (screens delivered), Appendix A (avatar renderer as in-app SVG parts; captionFor slot).

**e2e server:** `src/e2e-entry.ts` uses `createTestDb()` + `buildApp` (like `test-harness.ts`) with `publicDir` from `E2E_PUBLIC_DIR`, `allowedOrigins` = `http://127.0.0.1:<port>`, `cookieSecure: false`, cheap argon2, listens on `E2E_PORT`; `scripts/e2e-server.mjs` bundles it with esbuild to a temp file (externals as in `build.mjs` plus `@electric-sql/pglite`) and runs it. Excluded from the production build (`tsconfig.build.json`). Playwright config mirrors Lite's (one worker, vi-VN locale, desktop + mobile projects, `webServer` = the script). Spec: register → lobby; sign out / sign in; create a Blind room and play one hand against a bot to settlement, asserting balance from `/api/me` = before − ante/play ± payout − fee as shown on the result card; daily claim receipt; avatar change persists after reload and shows on the seat; achievements page shows `blind_hands_10`-style progress after the hand; @mobile: rail fits, table stack layout, profile page no horizontal scroll; screenshots to `e2e/screenshots/` (gitignored).

- [ ] **Step 1:** footprint test (`dist/assets/*.js` gzip: entry chunk ≤ 500 KB, total ≤ 900 KB; CSS ≤ 60 KB) — skips with a warning when `dist` is missing, like Lite's.
- [ ] **Step 2:** build chain + Dockerfile + docs; `pnpm build:normal` produces both; `node apps/normal-server/scripts/e2e-server.mjs` serves `GET /` from the web build (curl check).
- [ ] **Step 3:** e2e: `pnpm --filter @bp/normal-web e2e` (needs `pnpm exec playwright install chromium`; run it here if the browser can be installed — record the result either way). Also open the app in the built-in browser (Vite dev server against the e2e server) and eyeball auth, lobby, avatar screen, daily on desktop and 375 px; fix visual defects found.
- [ ] **Step 4:** `pnpm test && pnpm typecheck && pnpm lint`; commit `feat(normal-web): build chain, footprint, e2e against the real server, Docker and docs`.

---

## Self-review

- **Spec coverage:** §27.2 screens 1–13 → Task 1 (1, 12, 13 partly), ui-kit (2–6), Task 3 (7–10), Task 4 (11–13); §15 avatar → Task 2/3; §13 items → Task 4; §19.2 → Task 1 api.ts; §24 budget → Task 5; §28.1 image serves UI → Task 5; §29 e2e → Task 5.
- **Type consistency:** `NormalApi` (Task 1) is the only data source for Tasks 2–4; `AvatarConfigDto` shape = server `AvatarConfig`; `useAvatars` (Task 2) is used by Task 3's profile header and Task 4's shell avatar; `captionFor` (Task 1 ui-kit) consumed in Task 2.
- **Placeholders:** none; the toast-payload ruling in Task 4 names both acceptable implementations.
