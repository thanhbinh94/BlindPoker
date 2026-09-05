# Bind Poker — Plan 7: M9 hardening, acceptance and release readiness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gaps between "every plan merged" and "release candidate": a multiplayer soak test with money and sequence invariants (§29.3), coverage of every §30 edge case, the missing `SIT_OUT`/`SIT_IN` protocol message, a security and dependency pass (§23, §31), the deferred UI items that are cheap to close (light-theme contrast, Lite start-up guard), the acceptance checklist mapped to tests (Appendix B), known limitations, and a final README/docs pass. No new product features beyond `SIT_OUT`.

**Architecture:** Tests and docs land next to the code they verify: soak + edge tests in `packages/server-kit` (real WebSockets, in-memory repos), protocol additions in `@bp/core` → `server-kit` → `ui-kit` in dependency order, security fixes wherever the finding is. Nothing edition-specific enters shared packages. The acceptance checklist is a committed document whose every row names a test file or a manual step.

**Tech Stack:** unchanged (Vitest 2, `ws`, Fastify 5, React 18, esbuild). New devDependency: `eslint-plugin-react-hooks` (root).

**Spec:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §11.3 (seat statuses), §16.5–16.6, §20 (protocol), §23 (security), §24 (performance), §29 (testing incl. 29.3 multiplayer, 29.6), §30 (edge cases), §31 (risks), §33 (MVP scope), Appendix B (acceptance checklist ← `requirement.txt` sections 40 and 66).

## Global Constraints

- Dependency graph unchanged (`tooling/arch/boundaries.test.ts`); `packages/*` never mention an edition; `@bp/core` stays pure (no Node built-ins).
- Money invariant in every new test: Σ balances before = Σ balances after + fees (+ live stacks/carry-over), and per-connection `seq` strictly consecutive after every `ROOM_SNAPSHOT`.
- Protocol changes are additive: new `ClientMessage` kinds, no renamed fields; `parseClientMessage` rejects unknown kinds as today; both editions' web apps keep working without changes beyond ui-kit.
- Security fixes never weaken an existing guard; any new env var is documented in spec §22.5 and both `.env.example`s.
- Points never rendered as currency; i18n parity tests stay green; no literal strings in JSX.
- Tests colocated; `.js` imports; commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Consumed APIs (verified)
```ts
// server-kit testing: startTestServer({ players, roomOptions, gatewayOptions, seed }) → { url, repos, domainEvents, close }, TestClient.connect(url, headers) with next(type)/send/request helpers, createRoomHarness, ManualClock
// core protocol: ClientMessage kinds CREATE_ROOM|JOIN_ROOM|LEAVE_ROOM|SIT_DOWN|STAND_UP|SET_READY|START_GAME|KICK|ACTION|RESYNC|LIST_ROOMS|HELLO|PONG; SeatStatus 'SEATED'|'READY'|'IN_HAND'|'SITTING_OUT'|'DISCONNECTED'; room.ts already computes SITTING_OUT from `p.sittingOut` (auto after 3 timeouts / short stack)
// ui-kit: RoomScreen tray (ActionBar + between-hands controls), useGameClient API (sitDown, standUp, setReady, act …), i18n game namespace
// lite: apps/lite/server/src/run-file.ts (startup guard: refuses when run file pid is alive), main.ts `--stop/--status/--smoke`
// deferred items from Plans 3–6 (ledgered): SIT_OUT message; light-theme gold contrast 4.3:1; Lite pid-reuse false positive; Vietnamese font subset (ruling below: roadmap); eslint-plugin-react-hooks; Blind shows opponents' balances (documented limitation); cosmetics/displayName refresh at next join (documented)
```

## File Structure (this plan)

```text
packages/server-kit/src/testing/soak.ts, src/soak.test.ts, src/edge-cases.test.ts   Task 1
docs/test-matrix.md                                                                    Task 1 (§29/§30 → test file map)
packages/core/src/protocol/messages.ts, validate.ts (+tests)                            Task 2 SIT_OUT/SIT_IN
packages/server-kit/src/room/room.ts, gateway/gateway.ts (+tests)                       Task 2
packages/ui-kit/src/client/*, screens/RoomScreen.tsx, table/ActionBar.tsx, locales      Task 2
docs/server-kit.md, docs/ui-kit.md, spec §11.3/§20                                      Task 2
eslint.config.js (+react-hooks), package.json, security fixes across apps, docs/security.md   Task 3
packages/ui-kit/src/theme/tokens.css (+contrast test), apps/lite/server/src/run-file.ts (+test)   Task 4
docs/acceptance-checklist.md, docs/known-limitations.md, README.md, spec Appendix B + §32/§34   Task 5
```

---

### Task 1: Multiplayer soak test and §30 edge-case coverage

**Files:**
- Create: `packages/server-kit/src/testing/soak.ts` (driver), `packages/server-kit/src/soak.test.ts`, `packages/server-kit/src/edge-cases.test.ts`, `docs/test-matrix.md`
- Modify: `packages/server-kit/src/testing/index.ts` (export the driver), `docs/server-kit.md` (how to run the soak locally with bigger numbers)

**Interfaces:**
```ts
export interface SoakOptions { clients: number; rooms: number; handsPerRoom: number; mode: 'holdem' | 'blind'; seed: number; actionDelayMs?: [min, max] }
export interface SoakResult { hands: number; fees: number; startBalances: number; endBalances: number; seqGaps: number; resyncs: number; p95ActionToBroadcastMs: number; errors: string[] }
export async function runSoak(server: TestServer, opts: SoakOptions): Promise<SoakResult>
```
The driver connects `clients` `TestClient`s, spreads them over `rooms` rooms (`clients/rooms` seats each, bots filling Blind rooms to ≥ 2 players), each client plays a simple legal policy (call/check when legal, fold ~20 %, Blind: play ~70 %), measures the time from sending an `ACTION` to receiving the matching `ROOM_EVENT`, counts `seq` gaps (a gap must trigger `RESYNC`, and after the snapshot the count continues), and reads balances through `repos` at start and end.

- [ ] **Step 1: Soak test** (`soak.test.ts`): `6 clients × 3 rooms × 20 hands` for Hold'em and for Blind (§29.3), asserting `endBalances + fees === startBalances` (bots included; cancelled hands count as zero-fee), `seqGaps === 0`, `errors` empty, `p95ActionToBroadcastMs < 50` (§24, logged; assert `< 200` to stay robust on CI-class machines, log the real number). Timeout 120 s; seeded RNG so a failure is reproducible.
- [ ] **Step 2: Edge-case audit** — read `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §29.2 and §30, list every row, find the existing test that covers it (`grep` server-kit/core/lite/normal-server tests), and write `docs/test-matrix.md` (table: requirement → test file :: test name → status). For every row without a test, add one to `edge-cases.test.ts` (real WS via `startTestServer`): host leaves mid-hand → host transfers and the hand continues; timer and action arriving together → exactly one applied; two `SIT_DOWN` on one seat → second gets `SEAT_TAKEN`; 3 consecutive timeouts → stood up with the stack returned; player leaves mid Hold'em hand with chips in the pot → folded, chips stay; short-blind all-in; server `shutdown()` mid-hand → hand cancelled, bets refunded, stacks back to balance, clients notified; duplicate `reqId` after reconnect replays the same frame; `baseSeq` stale rejection; empty room closes after 60 s and releases carry-over per §8.4.
- [ ] **Step 3:** `pnpm --filter @bp/server-kit test && pnpm typecheck && pnpm lint`. Commit `test(server-kit): multiplayer soak with money and seq invariants, edge-case coverage matrix`.

---

### Task 2: `SIT_OUT` / `SIT_IN` end to end

**Files:**
- Modify: `packages/core/src/protocol/messages.ts` (`{ t: 'SIT_OUT' } | { t: 'SIT_IN' }` client messages; room event `PLAYER_SIT_OUT{playerId, sittingOut: boolean}`), `validate.ts` (+ tests), `packages/server-kit/src/room/room.ts` (`sitOut(playerId, out)` → takes effect at the next hand; a player sitting out is skipped by `createHand`; `SIT_IN` clears the flag and, if the stack ≥ minimum, they are dealt in next hand; sitting out ≥ 5 hands in a row → stood up with the stack returned (documented in spec §11.3)), `gateway.ts` (dispatch), `docs/server-kit.md`, `packages/ui-kit/src/client/{types,reducer,useGameClient}` (`sitOut()`, `sitIn()`, `state.room.players[].status` already carries `SITTING_OUT`), `packages/ui-kit/src/screens/RoomScreen.tsx` (tray control "Ngồi ngoài" / "Vào lại" beside Stand up; disabled when not seated), locales vi/en, `docs/ui-kit.md`, spec §11.3 + §20 message tables.

- [ ] **Step 1: Tests first** — core validators accept the two kinds; room tests: sit-out mid-hand keeps the player in the current hand and skips them from the next; sit-in re-deals; 5 skipped hands → stand; hand with only one non-sitting-out player does not start (`autoStart` waits); ui-kit reducer applies `PLAYER_SIT_OUT` and the RoomScreen control toggles label/state; Lite and Normal web suites unchanged and green.
- [ ] **Step 2: Implement** in dependency order (core → server-kit → ui-kit), commit per package: `feat(core): SIT_OUT/SIT_IN protocol messages`, `feat(server-kit): sit out at the next hand, auto-stand after five`, `feat(ui-kit): sit-out control in the room tray`.
- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm lint`; playground check (`pnpm --filter @bp/ui-kit playground`) that the control renders in both layouts.

---
### Task 3: Security and dependency pass (§23, §31)

**Files:**
- Modify: root `package.json` + `eslint.config.js` (`eslint-plugin-react-hooks` with `rules-of-hooks: error`, `exhaustive-deps: warn` → fix every error, review every warning), security fixes wherever found, `.env.example` files, spec §22.5/§23 if anything changes
- Create: `docs/security.md` (threat table from §23 with "how it is enforced" + "test that proves it" per row; dependency audit result; secrets handling; what an operator must still do: HTTPS, backups, `TRUST_PROXY`)

- [ ] **Step 1: Audit** — `pnpm audit --prod` (record; fix or justify every high/critical), `pnpm outdated` (record only), grep for `console.log` of request bodies/tokens/emails in apps, verify every mutating Normal/Lite route is CSRF-guarded and rate-limited (write a test that enumerates Fastify routes via `app.printRoutes()`/`onRoute` and asserts each `POST/PUT/PATCH/DELETE` under `/api` carries the CSRF preHandler), verify security headers on 404/500 responses in both editions, verify WS `Origin` rejection in both editions with a wrong origin, verify the Lite admin endpoint is loopback-only, verify argon2 params and the uniform-timing test still exist, verify `SESSION_SECRET` weak-value rejection, verify no stack traces in 5xx bodies, verify `frame-ancestors 'none'`.
- [ ] **Step 2: Fix** what the audit finds; add the route-enumeration tests to `apps/normal-server/src/app.test.ts` and `apps/lite/server/src/app.test.ts`.
- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm lint`. Commit `chore: security pass — react-hooks lint, route guard enumeration tests, audit notes`.

---

### Task 4: Deferred UI/ops items that are cheap to close

**Files:**
- Modify: `packages/ui-kit/src/theme/tokens.css` (light theme gold on parchment ≥ 4.5:1 — adjust `--gold-ink`/`--gold` for `data-theme="light"` only, felt untouched), `packages/ui-kit/src/theme/tokens.test.ts` (contrast test computing WCAG ratio for the token pairs used for text: ink/bg, gold-ink/bg, red-ink/bg in both themes), `apps/lite/server/src/run-file.ts` + test (startup guard: a live pid is only "another instance" if `GET /health` on the recorded host:port answers within 1 s with `edition: 'lite'`; otherwise the run file is stale and overwritten — pid reuse after a hard kill no longer blocks start-up), `apps/lite/release-src/README-lite.md` + `docs/deployment-lite.md` (one sentence), spec §28.2.
- Ruling recorded here: bundling a subsetted Vietnamese web font in ui-kit stays on the roadmap (needs font files fetched at build time and a subsetting tool; the Cambria/Segoe fallbacks cover Vietnamese on Windows, which is Lite's only target). Add it to §34.

- [ ] **Step 1:** contrast test (fails today at 4.3:1) → token fix → passes; visual check in the playground light theme (screenshot in the report).
- [ ] **Step 2:** run-file guard test (fake pid alive, no server answering → starts; server answering → refuses) → implement.
- [ ] **Step 3:** `pnpm test && pnpm typecheck && pnpm lint && pnpm --filter @bp/lite build` (footprint/smoke still green). Commit `fix: light-theme gold contrast, Lite start-up guard verifies the live instance`.

---

### Task 5: Acceptance checklist, known limitations, final docs

**Files:**
- Create: `docs/acceptance-checklist.md` (from `requirement.txt` sections 40 and 66 — read the file; every row: requirement → evidence: test file and name, or e2e step, or manual step with expected result; status ✓/partial/✗ with reason), `docs/known-limitations.md` (Blind shows opponents' balances; display-name/cosmetic changes reach the table at the next join; no spectators/chat/top-up; Lite hard-kill loses live stacks; Docker image and real-Postgres suite unverified on the dev machine; 3D avatar planned separately; font subset roadmap), `CHANGELOG.md` (one entry per plan with the merge commit)
- Modify: `README.md` (final structure: what it is, editions, quick starts, docs index, test commands, acceptance link), spec Appendix B (point to the checklist; mark completion), §32 assumptions/§34 roadmap updates, `docs/test-matrix.md` link from README.

- [ ] **Step 1:** write the checklist against the real tests (run `pnpm test` once and quote counts); no row may cite a test that does not exist — a test in Task 5's own file asserts every cited test path exists.
- [ ] **Step 2:** known limitations + changelog + README; `pnpm test && pnpm typecheck && pnpm lint`. Commit `docs: acceptance checklist, known limitations, changelog, final README`.

---

## Self-review
- Coverage: §29.3 (T1), §30 (T1), SIT_OUT gap (T2), §23/§31 (T3), deferred UI/ops (T4), Appendix B + §33/§34 (T5). Performance §24 measured in T1 and recorded in the checklist.
- Consistency: `SoakResult` used only in T1; `SIT_OUT` message names used identically in core/server-kit/ui-kit tasks; contrast test token names match `tokens.css`.
- Placeholders: none; the font-subset ruling is explicit.
