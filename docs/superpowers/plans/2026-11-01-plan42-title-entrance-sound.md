# BP-42 Part A — the Thần titles' entrance, the game's first sound, the mute button — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a player wearing a Thần title who sits down at any Normal table is heralded to the whole room with a band and an
EDM stinger of their own; the BP-41 moments get stingers too; one tap mutes every sound, remembered on the device.

**Architecture:** the Normal server tells the room (`ROOM_EVENT TITLE_ENTRANCE`) after a successful sit, through a new
server-kit `TitlePort` that Normal backs with `players.equipped_title`; the room keeps the 10-minute cooldown. The client
keeps `state.entrances` outside `chaos`; a pure scheduler lays them one at a time around the BP-41 herald, the dice and the
reveal hold. Sound is Web Audio synthesis in a ui-kit `sound/` module (stingers composed in code, an engine with mute,
hidden-tab silence and one channel), wired by Normal only; Lite gets neither the button nor the sound.

**Tech Stack:** TypeScript, React 18, Web Audio API (browser built-in), Vitest, Playwright (Chromium). No new dependency.

**Spec:** `docs/superpowers/specs/2026-10-31-title-entrance-design.md` (BP-42), Part A only (§3, §4, §5, §7.1, §8, §10).
Part B (§6: the 15 pictures, aura CSS, the set grant, the retro-grant) is not in this plan.

**Branch / worktree:** `feature/BP-42-title-entrance` in `.worktrees/BP-42` (own `pnpm install`).

## Global Constraints

- No new runtime or dev dependency; `@bp/core` stays pure (types only here).
- Every player-facing string in `vi` and `en`, through the parity tests; `react/jsx-no-literals` (glyphs go in constants).
  English copy is the session's, listed for the user's review in the CHANGELOG.
- vi copy, verbatim: `Thần Bài {{name}} đã giáng lâm!` · `Bán Thần {{name}} đã xuất hiện!` ·
  `Kẻ Sát Thần {{name}} đã vào bàn — Thần Bài hãy cẩn thận!` · `Tắt tiếng` · `Bật tiếng` · settings `Âm thanh`.
- The stable e2e terms (CLAUDE.md §6) do not change.
- New motion has a reduced-motion path and a test; text never overlaps text; no horizontal scroll and no stage scroll at
  1920×940, 1366×768, 375×812, 360×780, 780×360.
- BP-41 anti-spoiler rulings 20b, 21, 22, 28 hold for the entrance band and every sound: nothing shows or sounds during the
  result's reveal hold that the hold is hiding.
- No money path changes. No write to any external service. Lite untouched in behaviour.
- Ops accounts only through `newPlayer` / `registerPatiently`; nothing new registers in `pnpm e2e:normal`.
- Toolchain: `export PATH="$PATH:/c/Users/thanh/AppData/Local/Temp/pnpm-shim"` before any `pnpm` in Bash. Edit Vietnamese
  files with the Edit tool only.

Constants (exact):

| Name | Value | Where |
|---|---|---|
| `entranceCooldownMs` | `600_000` | `DEFAULT_ROOM_OPTIONS` (server-kit) |
| `ENTRANCE_MS` | `3_000` | `packages/ui-kit/src/table/entrance-schedule.ts` |
| `ENTRANCE_QUEUE_MAX` | `3` (showing + waiting) | same |
| `ENTRANCE_STALE_MS` | `10_000` | same |
| `FRESH_MS` | `1_000` (a moment older than this when it first shows makes no sound) | same |
| `SOUND_MUTED_KEY` | `'bp.sound.muted'` (`'1'` = muted; absent = sound on) | `packages/ui-kit/src/sound/engine.ts` |
| `SOUND_EVENT` | `'bp:sound'` (`CustomEvent<{ id: StingerId; outcome: SoundOutcome }>` on `window`) | same |
| `MAX_SOUND_WAIT_S` | `4` | same |
| `MASTER_GAIN` | `0.6` | `packages/ui-kit/src/sound/stingers.ts` |
| `STINGER_SECONDS` | god 3.5, demigod 3.0, godslayer 4.0, ascend 2.5, moment.demigod 2.0, godslain 2.5, jackpot 2.0 | same |

## Rulings made while planning

- **Ruling 1: no toast line for an entrance at a chaos table** (spec §4 "Một dòng trong toast"). The toasts are card lines
  (`AppliedChaosView`, a `cardId` and an effect) tied to a hand and cleared at the next deal, under the BP-39/41 timing
  rules; an entrance mostly comes between hands. The band says it at every table. Costs if wrong: one small task later.
  A deviation for the CHANGELOG.
- **Ruling 2: `ENTRANCE_QUEUE_MAX` counts the one showing.** Eight people sitting at once give three bands, 9 s, not 12 s.
- **Ruling 3: the BP-41 band wins.** A Thần's herald or a 6-6-6 that arrives while an entrance shows cuts the entrance short;
  the BP-41 moments keep the timing their anti-spoiler rulings set. Costs if wrong: an entrance seen for less than 3 s.
- **Ruling 4: a sit with no Thần title sets no cooldown,** so equipping the title and sitting again is heralded.
- **Ruling 5: Cài đặt gets an "Âm thanh" choice** (spec §5.3 left it to the builder); it and the room's button are one engine.

## Amendments (pre-flight 2026-11-01)

An independent review against the code found these; each overrides the task text it names.

- **A1 (T9, blocker):** F-14a–d already exist (BP-41). The new cases are **F-15** and **F-15b**; run with `-g "F-15"`.
- **A2 (T6, blocker):** `.chaosToastBand[data-layout='landscape']` (`table.module.css` ~3801) keeps `right: 11rem` for the menu
  and "Rời phòng"; a third header button needs `right: 14rem`. Check it in the 780×360 screenshot.
- **A3 (T9):** the BP-42 matrix row starts a new section: add a `+ 1` term to the pinned matrix count in
  `tooling/arch/acceptance-links.test.ts` (and its comment), and update CLAUDE.md §3: the matrix expression, e2e Normal 24→25
  (T8), ops 72→74.
- **A4 (T1):** `createRoomHarness` (`packages/server-kit/src/testing/room-harness.ts`) gains `titles?: TitlePort` into `deps`.
  The lookup promise carries a `.catch` (no unhandled rejection). Bots never go through `sitDown`.
- **A5 (T5):** the seat root is `packages/ui-kit/src/table/Seat.tsx` (~440): `Seat` gets `entrance?: EntranceTitle`, `PokerTable`
  passes `flash` down. The flash must not fight the existing `seatGod`/`seatDemigod` glow on the same element (a separate
  pseudo-element or outline layer).
- **A6 (T6):** `RoomScreen.test.tsx` ~1020 queries `getByRole('status')` on a non-chaos room; a band slot with `role="status"` on
  every table breaks it — scope that query.
- **A7 (T5/T6):** the hold is tracked **once**: `RoomScreen` calls `useHeldWindow(held)` and passes the `HeraldHold` to both
  `ChaosHerald` (new prop `hold?: HeraldHold`, replacing its own tracking; keep `held` working for its tests or migrate them)
  and `useEntrances` (takes `hold` instead of `held`).
- **A8 (T5):** `scheduleEntrances` gains `ended: ReadonlyMap<number, number>` (id → time dismissed): a dismissed one ends then,
  frees the band and leaves the queue count. Test: dismissed at 1000 → the next starts at 1000.
- **A9 (T4/T6):** `play(id, opts?: { preempt?: boolean })`: `preempt` stops what is sounding and resets `busyUntil`; the
  BP-41 moments play with `preempt: true` (Ruling 3 for the ear). Engine test for it.
- **A10 (T2/T9):** there is no `GET /api/me/avatar`; read `avatar` from `GET /api/me/inventory` (or `/api/me`) and `PUT
  /api/me/avatar` the full config with `title: 'title_god'` (leaving `title` out unequips it). T2 grants with
  `h.app.services.gm.grantItem({ userId: null }, playerId, 'title_godslayer', 'test')` and uses the socket harness at
  `app.test.ts` ~871. T9 grants with `POST /api/gm/players/:id/items { itemId, reason }` (no 300,000 points), not the
  achievement unlock.
- **A11 (T9):** Bob creates the room and **does not sit** (a dealt hand's reveal hold would delay the band). The hidden-tab
  check is a third account Carol (`newPlayer`) whose page forces `document.hidden = true` by init script, joined before
  Alice's first sit: she logs `'hidden'` for the same `entrance.god`.
- **A12 (T7):** the one engine lives in `apps/normal-web/src/sound.ts` (lazy creation; `attachGestureUnlock` called from
  `main.tsx`, not on `App.tsx` import, which tests load). `RoomScreen` and the lazy `SettingsScreen` get it as a `sound` prop.
- **A13 (T4/T7), Ruling 6:** the Normal entry chunk is 171.5 KB of the 180 KB gzip budget
  (`apps/normal-web/test/footprint.test.ts`). The engine loads `stingers.ts` by dynamic `import()` on its first `unlock()`;
  until it has loaded, `play` answers `'blocked'`. Costs if wrong: the first moment after the first tap may be silent.
- **A14 (T6):** at ≤400 px wide the mute button is 32 px wide with a 44 px touch area by the `::after` pad trick
  (`table.module.css` ~2895); `MuteButton` renders a bare `<button>` as a direct child of `.headRight` so the sideways 30 px
  rule (~2888) applies. Squeeze tables upright: check the room name still shows (screenshot).
- **A15 (T3):** `applyRoomEvent` has no default: add `case 'TITLE_ENTRANCE': return room`. Add/clear `entrances` at the
  `ROOM_EVENT` return and the four clears (`NOT_IN_ROOM`, `ROOM_CLOSED`, `PLAYER_LEFT` mine, `leftRoom`) and `reset`.
- **A16 (T8):** `vite` 5.4 resolves from `apps/normal-web`; pass the absolute path to `transformWithEsbuild` with
  `{ format: 'iife', globalName }`. A `dist` must exist for the config's web server. Start the limiter at threshold ≈ −3 dB,
  ratio 20, knee 0 (the compressor adds makeup gain).
- **A17 (T5):** each title's band background has alpha ≥ 0.9 (the overlap check looks through thinner ones); no `data-kind` on
  the entrance's lines (BP-41's watcher reads `button[data-herald] [data-kind]`).
- **A18, Rulings 7–8:** Ruling 7 — the host's own first sit is announced like anyone's (usually to an empty room). Ruling 8 —
  `attachGestureUnlock` keeps resuming on every gesture while the context is not `running` (phones suspend it), not once.
  Add the Chromium-only sound residual to `docs/known-limitations.md` (T9's docs).

## Review Focus

1. **Muted or hidden at the moment a band shows:** no sound, and unmuting or returning to the tab later never plays the
   missed one (Task 4 engine tests; Task 6 RoomScreen test).
2. **Sit, stand, sit inside 10 minutes; equip a title after a first plain sit:** one herald only for the first; a sit with no
   title sets no cooldown, so the later titled sit is heralded (Task 1 tests).
3. **Several entrances together, over the BP-41 herald, dice and reveal hold:** at most 3, one at a time, never two bands at
   once, nothing during the hold, each dropped after 10 s waiting (Task 5 scheduler tests).
4. **Snapshot, reconnect, late joiner, remount:** an old entrance never replays its band from the start or its sound
   (Task 3 reducer tests; Task 5 `FRESH_MS` tests).
5. **The title lookup fails or is slow:** the sit succeeds at once, the room queue never waits on it, no herald, a warning
   logged (Task 1 tests).

---

### Task 1: The room announces a titled entrance (core + server-kit)

**Files:**
- Modify: `packages/core/src/protocol/messages.ts` (type + `RoomEvent` member)
- Create: `packages/server-kit/src/title-port.ts`; export from `packages/server-kit/src/index.ts`
- Modify: `packages/server-kit/src/room/types.ts` (`RoomOptions.entranceCooldownMs`, `RoomDeps.titles?`),
  `packages/server-kit/src/room/room.ts` (after `PLAYER_SAT` in `sitDown`), `packages/server-kit/src/server.ts`
  (`GameServerOptions.titles?` passed into `RoomManager` deps like `chaos`)
- Test: `packages/server-kit/src/room/room-entrance.test.ts`; `packages/core/src/protocol/messages.test.ts` (one case)
- Docs: `docs/server-kit.md` — a short "Title entrances (BP-42)" section

**Interfaces:**
- Produces (core): `export type EntranceTitle = 'god' | 'demigod' | 'godslayer'` and
  `| { type: 'TITLE_ENTRANCE'; title: EntranceTitle; seat: number; playerId: string }` in `RoomEvent`, with a doc comment
  (spec §3: equipped title, at a sit, the server decides; never in a snapshot).
- Produces (server-kit): `export interface TitlePort { equippedTitle(playerId: string): Promise<EntranceTitle | null> }`;
  `GameServerOptions.titles?: TitlePort`; `RoomOptions.entranceCooldownMs: number` (default `600_000`).

Behaviour (the room, per spec §3 and §11):
- After a successful `sitDown` of a **human** and only when `deps.titles` exists, the room asks the port **off its queue**
  (`void`), so the sit, its ACK and `PLAYER_SAT` never wait on it.
- If the player was announced in this room less than `entranceCooldownMs` ago (room-held `Map<playerId, at>`, clock-based),
  the port is not even asked.
- When the port answers a title, the room enqueues the broadcast and sends it only if the player still sits in that seat with
  the same `sitId`, the room is not closing/closed; then it records `now` in the map and calls
  `broadcastRoomEvent({ type: 'TITLE_ENTRANCE', title, seat, playerId })` (everyone connected, the sitter included).
- `null` answer: nothing sent, **no cooldown recorded**. A rejection: `log.warn('title lookup failed', …)`, nothing sent.
- Reconnect (`PLAYER_RECONNECTED`), sit-out/sit-in and spectating never announce. A bot never announces.

- [ ] **Step 1: Write the failing tests** in `room-entrance.test.ts`, using the room test fixtures the neighbouring
  `room.test.ts` uses (fake clock, memory repos, recording outbox) and a fake `TitlePort` backed by a `Map`:
  - `a human wearing title_god who sits is announced to everyone in the room` — two humans connected, A sits → both outboxes
    get `ROOM_EVENT { type: 'TITLE_ENTRANCE', title: 'god', seat, playerId: A }` after `PLAYER_SAT`.
  - `no title, no announcement, and no cooldown` — port answers `null` for A; A sits → no event; port now answers `'demigod'`;
    A stands and sits again → announced `'demigod'`.
  - `sitting again inside ten minutes is not announced` — A announced; stand; clock +599_999; sit → no event; stand;
    clock +2; sit → announced.
  - `the sit does not wait for the lookup` — port returns a never-resolving promise; `sitDown` resolves and `PLAYER_SAT` is
    sent; a second command on the room queue (`setReady`) still resolves.
  - `a failed lookup only warns` — port rejects; sit resolves; no event; logger got one warning.
  - `a player who left the seat before the answer is not announced` — port resolves after A stood up → no event.
  - `bots and reconnects are never announced` — a blind room with `botCount: 1` → port never asked for the bot;
    A disconnects and reconnects → no second event.
  - `no port, no announcement` — room without `titles` behaves exactly as today.
- [ ] **Step 2: Run** `pnpm --filter @bp/server-kit exec vitest run src/room/room-entrance.test.ts` → FAIL (type/feature missing).
- [ ] **Step 3: Implement** the type, the port, the option, the room logic above and the wiring through `createGameServer`.
- [ ] **Step 4: Run** the file → PASS; then `pnpm --filter @bp/server-kit test` and `pnpm --filter @bp/core test` → PASS.
- [ ] **Step 5: Commit** `feat(server-kit): a player wearing a Thần title who sits down is announced to the whole room, once per room in ten minutes`

### Task 2: Normal backs the port with the equipped title

**Files:**
- Create: `apps/normal-server/src/inventory/title-port.ts`, test `apps/normal-server/src/inventory/title-port.test.ts`
- Modify: `apps/normal-server/src/app.ts` (`createGameServer({ …, titles: createTitlePort(repos.players) })`)
- Test: one integration case in `apps/normal-server/src/app.test.ts` (or the nearest socket-level test file that already
  sits players through the harness)
- Docs: `docs/normal-server.md` — one paragraph

**Interfaces:**
- Consumes: `TitlePort`, `EntranceTitle` (Task 1); `NormalPlayerRepository.findByIdFull(playerId).equippedTitle`.
- Produces: `export function createTitlePort(players: Pick<NormalPlayerRepository, 'findByIdFull'>): TitlePort` with the map
  `title_god → 'god'`, `title_demigod → 'demigod'`, `title_godslayer → 'godslayer'`; any other id, `null`, or a missing
  player → `null`.

- [ ] **Step 1: Failing unit tests** — `maps the three Thần titles`, `other titles and none are null`, `a missing player is null`.
- [ ] **Step 2: Failing integration test** `a player wearing title_godslayer who sits at a Normal table is announced` —
  through the harness: register two accounts, grant `title_godslayer` to one and equip it (the inventory service's grant +
  the avatar save the routes use), both join a Blind room, the titled one sits → the other socket receives
  `TITLE_ENTRANCE { title: 'godslayer' }`.
- [ ] **Step 3: Run** `pnpm --filter @bp/normal-server exec vitest run src/inventory/title-port.test.ts` (+ the integration
  file) → FAIL.
- [ ] **Step 4: Implement** and wire.
- [ ] **Step 5: Run** both → PASS; `pnpm --filter @bp/normal-server typecheck` → clean.
- [ ] **Step 6: Commit** `feat(normal-server): the room reads a player's equipped Thần title to herald their entrance`

### Task 3: The client keeps the entrances

**Files:**
- Modify: `packages/ui-kit/src/client/types.ts` (`ClientEntrance`, `ClientState.entrances`, initial state),
  `packages/ui-kit/src/client/reducer.ts`
- Test: `packages/ui-kit/src/client/reducer.test.ts`

**Interfaces:**
- Produces: `export interface ClientEntrance { id: number; title: EntranceTitle; seat: number; playerId: string; name: string; at: number }`
  (`name` taken at arrival from the room's players, falling back like `nameOfPlayer`/`nameOfSeat`; `at` = the frame's `now`;
  `id` grows by one per entrance within the room); `ClientState.entrances: ClientEntrance[]` (latest 4 kept, oldest first).

Rules: `TITLE_ENTRANCE` appends; a `ROOM_SNAPSHOT` keeps the list as it is (a snapshot is no arrival); leaving, being
removed (`PLAYER_LEFT` mine), `ROOM_CLOSED`, `ERROR NOT_IN_ROOM` and `reset` empty it. It lives outside `chaos`, so a
non-chaos room keeps it.

- [ ] **Step 1: Failing tests** in a `describe('title entrances')`: `an entrance is kept with the name at arrival and the frame's time`;
  `ids grow and only the latest four are kept`; `a snapshot keeps them and adds none`; `leaving, a close and NOT_IN_ROOM empty them`;
  `a Hold'em room keeps them too` (no `chaos` config).
- [ ] **Step 2: Run** `pnpm --filter @bp/ui-kit exec vitest run src/client/reducer.test.ts` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): the client keeps the room's title entrances outside the chaos state`

### Task 4: The sound module — stingers composed in code, an engine with mute

**Files:**
- Create: `packages/ui-kit/src/sound/stingers.ts`, `packages/ui-kit/src/sound/engine.ts`,
  `packages/ui-kit/src/sound/useSound.ts`, `packages/ui-kit/src/sound/MuteButton.tsx`, `packages/ui-kit/src/sound/index.ts`;
  export from `packages/ui-kit/src/index.ts`
- Test: `packages/ui-kit/src/sound/stingers.test.ts`, `packages/ui-kit/src/sound/engine.test.ts`,
  `packages/ui-kit/src/sound/MuteButton.test.tsx`, and a small recording fake `packages/ui-kit/src/sound/fake-audio.ts`
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` — `"sound": { "mute": "Tắt tiếng" | "Mute", "unmute": "Bật tiếng" | "Unmute" }`

**Interfaces (produced):**
```ts
// stingers.ts — NO runtime imports (type-only imports allowed): Task 8 transpiles this one file alone for Chromium.
export type StingerId = 'entrance.god' | 'entrance.demigod' | 'entrance.godslayer' | 'moment.ascend' | 'moment.demigod' | 'moment.godslain' | 'moment.jackpot'
export const STINGER_IDS: readonly StingerId[]
export const STINGER_SECONDS: Readonly<Record<StingerId, number>>
export const MASTER_GAIN = 0.6
/** gain(volume) → limiter (DynamicsCompressor) → ctx.destination; returns the chain's input. */
export function createMaster(ctx: BaseAudioContext, volume?: number): AudioNode
/** Schedules the stinger into `out` from `when` (ctx seconds); returns its length in seconds (= STINGER_SECONDS[id]). */
export function scheduleStinger(ctx: BaseAudioContext, out: AudioNode, id: StingerId, when: number): number

// engine.ts
export type SoundOutcome = 'played' | 'muted' | 'hidden' | 'blocked' | 'unsupported' | 'busy'
export interface SoundEngine {
  readonly muted: boolean
  setMuted(muted: boolean): void
  subscribe(listener: () => void): () => void
  /** A user gesture: creates the AudioContext the first time, resumes it when suspended. */
  unlock(): void
  play(id: StingerId): SoundOutcome
}
export interface SoundEngineDeps {
  createContext?: () => AudioContext | null   // default: new (window.AudioContext ?? webkitAudioContext), null when absent
  storage?: Storage | null                    // default: localStorage, every read/write in try/catch
  isHidden?: () => boolean                    // default: () => document.hidden
  emit?: (id: StingerId, outcome: SoundOutcome) => void // default: window.dispatchEvent(new CustomEvent(SOUND_EVENT, …))
}
export const SOUND_MUTED_KEY = 'bp.sound.muted'
export const SOUND_EVENT = 'bp:sound'
export function createSoundEngine(deps?: SoundEngineDeps): SoundEngine
/** Adds once-only `pointerdown` and `keydown` listeners on `target` that call `engine.unlock()`; returns a remover. */
export function attachGestureUnlock(engine: SoundEngine, target?: EventTarget): () => void

// useSound.ts
export function useSoundMuted(engine: SoundEngine): boolean   // useSyncExternalStore over subscribe/muted

// MuteButton.tsx
export function MuteButton(props: { engine: SoundEngine; className?: string }): JSX.Element
```

`play` order of checks, each emitting its outcome through `emit`: muted → `'muted'`; `isHidden()` → `'hidden'`; no context
can be made → `'unsupported'`; context not `running` (never unlocked, or the browser refused) → `'blocked'` (it never
creates a context outside a gesture); the channel is busy more than `MAX_SOUND_WAIT_S` ahead → `'busy'`; else schedule at
`max(ctx.currentTime, busyUntil)` through the master, set `busyUntil` to the end, → `'played'`. Nothing is ever queued for
later replay. `setMuted` writes `'1'` / removes the key and notifies subscribers; muting also stops what is sounding
(disconnect the master's input and make a fresh one).

The composition (spec §5.2; a starting point for the ear, all at 128 BPM, deterministic: noise from a seeded PRNG so two
renders are identical; every voice ends with a gain ramp so the last 150 ms are silent):
- `entrance.god` 3.5 s, D major, majestic: 1.2 s white-noise riser (band-pass sweeping up) with a rising saw; drop at ~1.25 s:
  a heavy kick (sine, pitch 150→45 Hz in 0.12 s) and a brass-like supersaw chord (D3 F#3 A3 D4, several saws detuned a few
  cents, low-passed ~3 kHz, slow attack); a generated-noise reverb tail.
- `entrance.demigod` 3.0 s, A major, bright: rising pluck arpeggio in sixteenths (A4 C#5 E5 A5 C#6 E6), high sine sparkles,
  a light kick at ~0.9 s, a soft pad.
- `entrance.godslayer` 4.0 s, E minor, fierce: a reese bass (two detuned saws, an LFO on the low-pass), a tense 1.5 s riser,
  a heavy drop at ~1.6 s (kick + wave-shaped bass), and a final "slash" (noise swept high-pass 8 kHz→500 Hz in 0.25 s) at ~3.2 s.
- `moment.ascend` 2.5 s / `moment.demigod` 2.0 s / `moment.godslain` 2.5 s: short variants of the three (riser cut to ~0.4 s;
  godslain opens on the slash, then the low hit).
- `moment.jackpot` 2.0 s: slot-machine bells (quick square-wave dings around 1.3–2.1 kHz), a short drop, a bright chord.

- [ ] **Step 1: Failing tests.**
  - `stingers.test.ts` with the recording fake (it records created nodes, `start`/`stop` times and connections):
    `every stinger returns its table length`; `every voice stops by the stinger's end`; `every stinger reaches the master's input`
    (something connected to `out`); `two stingers schedule different note sets` (pairwise, compare the recorded oscillator
    frequency sets — all seven distinct); `the master is gain 0.6 into a compressor into the destination`.
  - `engine.test.ts`: `starts unmuted and reads a stored mute`; `a broken storage still works (unmuted, no throw)`;
    `setMuted persists and notifies`; `muted → 'muted', schedules nothing`; `hidden → 'hidden'`; `no AudioContext → 'unsupported'`;
    `before unlock → 'blocked' and no context is created`; `after unlock → 'played' at currentTime`; `a second play waits for the first
    (scheduled at its end)`; `one more than MAX_SOUND_WAIT_S ahead → 'busy'`; `every outcome is emitted with its id`;
    `unmuting never plays what was missed`; `attachGestureUnlock calls unlock once`.
  - `MuteButton.test.tsx`: `reads "Tắt tiếng" when sound is on and "Bật tiếng" when muted`; `a click toggles and persists`
    (aria-pressed = muted).
- [ ] **Step 2: Run** `pnpm --filter @bp/ui-kit exec vitest run src/sound` → FAIL.
- [ ] **Step 3: Implement** the four files; glyphs `🔊` / `🔇` as module constants; the button is `aria-label`led by the
  current action and styled from the tokens (icon button the header's height).
- [ ] **Step 4: Run** → PASS; `pnpm --filter @bp/ui-kit exec vitest run src/i18n` → PASS (parity).
- [ ] **Step 5: Commit** `feat(ui-kit): the game's first sound — seven EDM stingers synthesised in the browser, one channel, a mute that is remembered`

### Task 5: The entrance band and its scheduler

**Files:**
- Create: `packages/ui-kit/src/table/entrance-schedule.ts` (+ `.test.ts`), `packages/ui-kit/src/table/EntranceBand.tsx`
  (+ `.test.tsx`), `packages/ui-kit/src/table/useHeldWindow.ts`
- Modify: `packages/ui-kit/src/table/ChaosHerald.tsx` (+ test) — take the hold tracking from `useHeldWindow` and add `onShow`;
  `packages/ui-kit/src/table/table.module.css` (band colours per title, seat flash)
- Modify: `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` — `"entrance": { "god", "demigod", "godslayer", "label" }`
  (vi from Global Constraints; en: `The Card God {{name}} has descended!` · `The Demigod {{name}} has appeared!` ·
  `The Godslayer {{name}} has taken a seat — beware, Card God!` · label `Entrance` / vi `Màn ra mắt`)

**Interfaces:**
- Consumes: `ClientEntrance` (Task 3), `ClientHerald`, `ClientDiceRoll`, `heraldWindow`, `HeraldHold`, `DICE_MS`.
- Produces:
```ts
export const ENTRANCE_MS = 3_000, ENTRANCE_QUEUE_MAX = 3, ENTRANCE_STALE_MS = 10_000, FRESH_MS = 1_000
export interface Span { from: number; until: number }
export type EntranceSlot = Span | 'dropped' | 'waiting'
/** Pure: where each entrance falls, given what else holds the band. `started` = entrances already on screen (id → from). */
export function scheduleEntrances(
  entrances: readonly { id: number; at: number }[], busy: readonly Span[], hold: HeraldHold | null,
  started: ReadonlyMap<number, number>, now: number,
): Map<number, EntranceSlot>
/** The hold's start and end as a component saw them (ChaosHerald's logic, shared). */
export function useHeldWindow(held: boolean): HeraldHold | null
/** Runs the schedule in time: the entrance on screen now (or null), a dismiss, and whether it just began (for its sound). */
export function useEntrances(o: { entrances: readonly ClientEntrance[]; heralds: readonly ClientHerald[]; rolls: readonly ClientDiceRoll[]; held: boolean }):
  { shown: ClientEntrance | null; fresh: boolean; dismiss: () => void }
export function EntranceBand(props: { entrance: ClientEntrance | null; onDismiss: () => void }): JSX.Element
// ChaosHerald gains: onShow?: (h: ClientHerald) => void — once per herald id, only when it first shows within FRESH_MS of its window's start
```

Scheduler rules (spec §4): entrances in arrival order, one at a time, each `ENTRANCE_MS`; `busy` = the BP-41 heralds'
windows (`heraldWindow` with the hold) and the dice windows (`[r.at, r.at + DICE_MS)`); never inside the hold; an entrance
arriving while `ENTRANCE_QUEUE_MAX` others are showing or waiting is `'dropped'`; one whose start would be later than
`at + ENTRANCE_STALE_MS` is `'dropped'` (an open hold leaves it `'waiting'` until then); a started one keeps its `from` and is
cut short when a busy span begins inside it (the BP-41 band wins). `useEntrances` keeps `started` and the dismissed ids in
state and wakes on the next boundary (as `ChaosHerald` does). `fresh` = `now - shown.from < FRESH_MS` on the render where it
first shows.

Band: same slot, shape and motion as `ChaosHerald` (`s.herald`, `s.heraldMotion` unless reduced motion), its own
`data-herald="entrance"` and `data-title={title}`, colours per spec §4 (god gold–red like the Thần banner; demigod
white–silver–pale gold; godslayer black–crimson), `role="status"` `aria-live="assertive"` with `entrance.label`, a tap
dismisses it. Seat flash: `PokerTable` gets `flash?: { seat: number; title: EntranceTitle } | null`, putting
`data-entrance={title}` on that seat's root; the CSS glow is an animation in the title's colour.

- [ ] **Step 1: Failing scheduler tests** (`entrance-schedule.test.ts`), exact values:
  - `one entrance shows at once for 3 s` → id1 `{0, 3000}`.
  - `a second waits for the first` (at 0 and 100) → id2 `{3000, 6000}`.
  - `a fourth at once is dropped` (four at 0) → id4 `'dropped'`, ids 1–3 at 0/3000/6000.
  - `it waits for the BP-41 herald` (busy `{0, 3000}`, entrance at 500) → `{3000, 6000}`.
  - `it never shows during the hold` (hold `{since: 0, until: null}`, entrance at 100, now 5000) → `'waiting'`; same with
    hold `{0, 4000}` → `{4000, 7000}`.
  - `ten seconds waiting drops it` (busy `{0, 12000}`, entrance at 1000) → `'dropped'`; hold open, now 11_001, at 1000 → `'dropped'`.
  - `one already on screen is cut by a herald that comes` (started 1→0, busy `{1000, 4000}`) → `{0, 1000}`.
- [ ] **Step 2: Failing component tests:** `EntranceBand` shows the vi copy per title with the name and dismisses on click;
  reduced motion drops `heraldMotion`; `ChaosHerald` calls `onShow` once for a fresh herald and never for one older than
  `FRESH_MS` when first shown (fake timers); `PokerTable` puts `data-entrance` on the flashed seat.
- [ ] **Step 3: Run** `pnpm --filter @bp/ui-kit exec vitest run src/table` → FAIL.
- [ ] **Step 4: Implement**; `ChaosHerald` keeps every existing test green.
- [ ] **Step 5: Run** → PASS (whole `src/table`).
- [ ] **Step 6: Commit** `feat(ui-kit): the entrance band — one at a time, never over the Thần's banner, the dice or the reveal hold, in the title's colours`

### Task 6: The room screen plays it all (every table) and gets the mute button

**Files:**
- Modify: `packages/ui-kit/src/screens/RoomScreen.tsx` (+ `RoomScreen` tests in its existing test file),
  `packages/ui-kit/src/table/RoomHeader.tsx` (a `sound?: ReactNode` slot before `menu`, in the compact line and the full
  header's right cell), `packages/ui-kit/src/screens/screens.module.css` if the moments layer needs a rule for non-chaos rooms
- Docs: `docs/ui-kit.md` — a "Sound and entrances (BP-42)" section (the engine, the stingers, the hook event, Lite gets none)

**Interfaces:**
- Consumes: Tasks 3–5.
- Produces: `RoomScreenProps.sound?: SoundEngine` — absent (Lite) = no mute button and no sound; the band still draws any
  entrance the state holds (Lite never receives one).

Wiring: the `.moments` layer renders on **every** table: `EntranceBand` always, `ChaosHerald` and `ChaosDice` only on a
chaos table as today. `useEntrances` gets `state.entrances`, the chaos heralds and rolls (empty off a chaos table) and
`held`. When `shown` changes to a new id with `fresh`, `sound?.play('entrance.' + title)`. `ChaosHerald onShow` maps
`god → moment.ascend`, `demigod → moment.demigod`, `godslain → moment.godslain`, `dice → moment.jackpot`. `PokerTable flash`
= the shown entrance's seat and title, `null` under reduced motion. `MuteButton` goes into `RoomHeader`'s `sound` slot when
`sound` is given.

- [ ] **Step 1: Failing tests:** `a Hold'em room shows an entrance band` (no chaos config); `the entrance's stinger is played once
  when its band shows` (fake engine); `no sound for an entrance that was already old when the screen mounted`; `the Thần's
  herald plays moment.ascend`; `no mute button without an engine`; `the mute button sits in the header when given one`;
  `no seat flash under reduced motion`.
- [ ] **Step 2: Run** `pnpm --filter @bp/ui-kit exec vitest run src/screens` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pnpm --filter @bp/ui-kit test` → PASS; `pnpm --filter @bp/ui-kit typecheck` → clean.
- [ ] **Step 5: Commit** `feat(ui-kit): every table heralds a Thần's entrance and sounds the table's big moments; the header gets a mute button`

### Task 7: Normal turns the sound on; the playground's audition page

**Files:**
- Modify: `apps/normal-web/src/App.tsx` (one engine for the app: `createSoundEngine()` + `attachGestureUnlock` once at module or
  boot level, passed as `sound` to `RoomScreen`), `apps/normal-web/src/screens/SettingsScreen.tsx` (+ test) — a "Âm thanh"
  panel with the same on/off choice the theme panel uses, bound to the same engine through `useSoundMuted`
- Modify: `apps/normal-web/src/locales/{vi,en}…` — `settings.sound.title` `Âm thanh` / `Sound`, `settings.sound.on`
  `Bật` / `On`, `settings.sound.off` `Tắt` / `Off`
- Create: `packages/ui-kit/playground/sounds.tsx`; route `#sounds` in `packages/ui-kit/playground/main.tsx`
- Check: `apps/lite/web/src/App.tsx` stays without `sound` (a Lite test asserts no "Tắt tiếng" button in a room if the Lite
  App test already renders a room; otherwise note it in the report)

The `#sounds` page: one button per stinger (its id and length), "Phát" plays it through a real engine (unlocked by the
click) and shows its band — the three entrance bands with a sample name, and the BP-41 band for the four moments — plus a
mute toggle. Dev-only, reached by URL like `#peel`.

- [ ] **Step 1: Failing tests:** Settings `the sound panel turns the sound off and on, shared with the room's button`;
  normal-web App test `the room gets a mute button` (where `App.test.tsx` already reaches a room; else a RoomScreen-level
  assertion through the engine prop is enough and say so).
- [ ] **Step 2: Run** `pnpm --filter @bp/normal-web exec vitest run src/screens/SettingsScreen.test.tsx` → FAIL.
- [ ] **Step 3: Implement** + the playground page; check `pnpm --filter @bp/ui-kit playground` serves `#sounds` (read the
  Vite "Local:" line) and the page renders with no console error (Playwright one-off or the playground's own check).
- [ ] **Step 4: Run** `pnpm --filter @bp/normal-web test` (CI_SKIP_BUILD=1) and the locale parity tests → PASS.
- [ ] **Step 5: Commit** `feat(normal-web): the Normal app turns the sound on, Cài đặt gets Âm thanh, and the playground an audition page`

### Task 8: The stingers measured in Chromium

**Files:**
- Create: `apps/normal-web/e2e/sound.spec.ts` (runs in the Normal e2e config; it needs no server and registers nobody)

Approach: read `packages/ui-kit/src/sound/stingers.ts`, transpile it alone with Vite's `transformWithEsbuild` (`vite` is
already a dev dependency of `@bp/normal-web`) to an IIFE with a global name, `page.setContent` a page holding it, and
`page.evaluate` an `OfflineAudioContext(2, ceil(44100 × (len + 0.5)), 44100)` render per stinger through `createMaster`.
Measure in the page and return numbers only.

- [ ] **Step 1: Write the test** `the seven stingers render in Chromium: right length, no clipping, a silent tail, all different`:
  - length: the last sample above −60 dBFS lies within ±10 % of `STINGER_SECONDS[id]`;
  - peak: max |sample| < 1.0 (and > 0.05: it is not silent);
  - tail: RMS of the last 150 ms of the stinger's own length < −50 dBFS;
  - distinct: RMS envelopes in 50 ms frames, every pair's normalised correlation < 0.95.
  - When `BP_SOUND_WAV_DIR` is set, also write each render as a 16-bit stereo WAV `<id>.wav` there (for the user's audition).
- [ ] **Step 2: Run** `pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts sound` (the web server
  of the config starts anyway; a stale `dist` does not matter to this spec) → it may FAIL on a tuned value; adjust the
  stingers (Task 4's file) until it passes, re-running `src/sound` unit tests.
- [ ] **Step 3: Commit** `test(e2e): the seven stingers are measured in Chromium — length, peak, a silent tail, each its own`

### Task 9: The ops case and the docs it cites

**Files:**
- Create: `apps/normal-web/e2e/ops/11-entrance.spec.ts`
- Modify: `apps/normal-web/e2e/ops/ops-helpers.ts` if a helper is shared (e.g. `equipTitle(page, itemId)` via
  `GET`/`PUT /api/me/avatar`, and `unlockAchievement(gmPage, playerId, id, reason)` via
  `POST /api/gm/players/:id/achievements/:achievementId/unlock`)
- Modify: `docs/operation-test-plan.md` (rows F-14, F-14b in §F, Vietnamese), `docs/test-matrix.md` (one row citing the two
  test names verbatim), `tooling/arch/acceptance-links.test.ts` (bump the pinned matrix count for the row's group)

Two tests from one body: `F-14: a player wearing Thần Bài sits down and the whole room sees "đã giáng lâm!" once, with its
stinger, and the mute button holds after F5` (desktop) and the same title ending `@s25p` (360×780 touch).
Steps: a GM (`promoteToGm`) unlocks `chaos_god` for Alice; Alice equips `title_god`; Bob creates a Blind room with one bot;
an init script records `bp:sound` events into `window.__sounds`; Alice joins and sits → both pages show
`Thần Bài {Alice} đã giáng lâm!` (exact), it is gone within 4 s, `expectNoTextOverlap` while it shows, no horizontal or stage
scroll at the project's size; both pages logged `{ id: 'entrance.god' }` with outcome other than `'muted'`/`'hidden'`; Alice stands
and sits again → no band within 5 s and no second `entrance.god`; Bob presses "Tắt tiếng" → it reads "Bật tiếng", survives
F5, and a page with `document.hidden` forced true (init script) logs `'hidden'` for a moment (use the GM to put another
titled account at the table, or assert through a fresh entrance on the hidden page — the implementer picks the cheapest that
proves it, and says which).

- [ ] **Step 1: Write the spec** and the helpers.
- [ ] **Step 2: Run** `pnpm build:normal`, then
  `pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "F-14"` → PASS in `desktop` and `s25p`.
- [ ] **Step 3: Docs** — the two ops rows, the matrix row, the count; run `pnpm exec vitest run --root . tooling/arch` → PASS.
- [ ] **Step 4: Commit** `test(ops): F-14 a Thần Bài's entrance seen by the whole room once, its stinger asked for, the mute kept after F5`

---

## After the tasks (controller)

Final whole-branch review (opus) → one fix wave → re-review → screenshots (1920×940, 1366×768, 375×812, 360×780, 780×360 of
a room with an entrance band and the header's mute button) → full gate (typecheck → lint → test → build:normal → build:lite
→ avatar:check → e2e Normal → e2e Lite → ops) → merge `--no-ff` to `main` → CHANGELOG section (rulings, deviations, the new
English copy) + lessons → render the WAVs (`BP_SOUND_WAV_DIR`) and send them to the user with screenshots. **No deploy**
until the user has listened and approved the copy (spec §7.1).
