# BP-30 — Chibi idle life (K6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The figure on the wardrobe, shop, profile and welcome stages breathes, blinks, cheers when an item goes on, greets when tapped and turns around, all with CSS on the PNG layers it already has; the table and every card stay exactly as they are.

**Architecture:** `Chibi` gains `live`, `react` and `facing` props driven by a new `useChibiLife` hook; when `live !== 'off'` it mounts the base, `closed` and `happy` face layers together and switches them by `data-face` + CSS opacity (no runtime expression change). A new ui-kit `LiveFigure` wraps a `Chibi` with the transparent greet button, the sparkle ring overlay and the "Xoay" button, so the four stages in normal-web only pass `live`/`react` events. Breathing/blinking run only while on screen (`useOnScreen`, a continuous observer) and the tab is visible; `prefers-reduced-motion` kills every animation (global rule) and the hook stops changing faces.

**Tech Stack:** TypeScript, React 18, CSS modules (ui-kit tokens), Vitest + jsdom (fake timers, `matchMedia` mock, `IntersectionObserver` mock), Playwright ops pack, pnpm 9 (`corepack pnpm` on this machine).

**Spec:** `docs/superpowers/specs/2026-10-22-k6-chibi-idle-life-design.md` (Q1–Q3, R1–R8). Read it whole first.

## Global Constraints

- No new PNG layers, no new pose, no new runtime dependency; every effect is a CSS `animation`/`transition` on existing layers so `packages/ui-kit/src/theme/global.css:137` (`prefers-reduced-motion: reduce` → `animation: none !important`) disables it; the hook also stops automatic face changes under reduce (R4).
- `live` defaults to `'off'` and the `off` DOM is byte-for-byte what it is today (R1): the table, PlayerBar, seats, cards, portraits and GM screens must not change.
- The figure keeps `role="img"` and its current accessible names ("Phòng thay đồ", `shop.figure`, the player's name); e2e and unit tests locate it by those (R6).
- New copy in both `vi` and `en` (ui-kit `game.json`): `avatar.turn` "Xoay"/"Turn", `avatar.greet` "Nhân vật của bạn, bấm để chào"/"Your figure, tap to say hi". No other visible text. Parity tests: `packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts`.
- Timings (spec 3.1): breathe scale 1 → 1.015, 4 s, ease-in-out, infinite, `transform-origin: 50% 100%`; blink `closed` 120 ms every 3–6 s random, 10 % double; cheer: `happy` 1.2 s + hop `translateY(-6%)` 420 ms + 6 sparkles 700 ms; wave: `happy` 800 ms + tilt `rotate(-4deg)` 600 ms; spin: `scaleX(1) → 0.06 → -1` 500 ms then `data-facing="left"` held; one live figure per screen.
- Commits: Conventional Commits, trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; stage by name; never push. Worktree `.worktrees/BP-30`, branch `feature/BP-30-chibi-idle-life`. One writer per worktree; commit with `git commit --only <paths>` when another agent is reading.
- UI tasks ship Playwright screenshots at 1920×940, 1366×768, 375×812 (throwaway `apps/normal-web/e2e/zz-preview.spec.ts`, one account, deleted before commit). Text never overlaps text.
- Pinned counts: ops cases 50 (CLAUDE.md §3), matrix `43 + 10 + 4 + 7 + 5 + 8 + 3 + 5 + 5`, checklist `64 + 3 + 2 + 3 + 3 + 5` in `tooling/arch/acceptance-links.test.ts`. BP-28 and BP-29 are in flight on other branches and may bump these first; rebase the numbers on `main` before the gate.
- K6 merges **after** BP-29 (it adds `isolation: isolate` on `.chibi`); before the gate, merge `main` into this branch and keep the test that `.chibi` is isolated.

## Review Focus

1. **A `live` figure whose `closed` or `happy` face is still loading** must blink nothing (no blank face, no untinted face): the hook starts blinking only after all mounted faces reported loaded — test in Task 1.
2. **A reduced-motion user** must never see a face change or a transform: with `matchMedia('(prefers-reduced-motion: reduce)')` matching, `data-face` stays on the base face and no `.breathe/.cheer/.wave/.spin` class is applied; "Xoay" flips instantly — Task 1 and Task 2.
3. **Two reactions in quick succession** (buy then tap, or two try-ons within 1.2 s): the later `cheer` restarts cleanly, a `wave` during a `cheer` is ignored, and no timer leaks after unmount — Task 1 (fake timers, unmount asserts no pending timers).
4. **A figure scrolled out of view or a hidden tab** stops breathing and blinking and resumes when back — Task 1 (`useOnScreen` mock + `visibilitychange`).
5. **A `live='off'` figure anywhere** renders the same DOM as before this plan: a snapshot of a table seat's `Chibi` markup (head frame) and a card icon must not change — Task 1.

---

## File structure

- `packages/ui-kit/src/avatar2d/on-screen.ts` (+ `.test.tsx`) — `useOnScreen(ref, rootMargin?)`: continuous `IntersectionObserver` + `visibilitychange`; `true` when no API.
- `packages/ui-kit/src/avatar2d/life.ts` (+ `life.test.tsx`) — `useChibiLife`, timing constants, the reaction state machine.
- `packages/ui-kit/src/avatar2d/Chibi.tsx`, `avatar2d.module.css`, `types.ts` — `live`/`react`/`facing` props, three mounted faces, `data-face`/`data-live`/`data-facing`, keyframes `chibiBreathe`, `chibiHop`, `chibiTilt`, `chibiSpin`, the sparkle ring CSS.
- `packages/ui-kit/src/avatar2d/LiveFigure.tsx` (+ `.test.tsx`, `live-figure.module.css`) — the greet button wrapper, sparkle ring, "Xoay" button; exported from the avatar2d index and the kit index.
- `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` — `avatar.turn`, `avatar.greet`.
- `apps/normal-web/src/screens/wardrobe/StagePanel.tsx`, `screens/shop/ShopStage.tsx`, `screens/WelcomeDialog.tsx`, `screens/ProfileScreen.tsx` (+ tests) — wiring.
- `apps/normal-web/e2e/ops/08-shop.spec.ts` — P-06, P-07; docs: `docs/ui-kit.md`, `docs/avatar-2d.md` (one paragraph), `docs/known-limitations.md` (R2 mirror text), `docs/test-matrix.md`, `tooling/arch/acceptance-links.test.ts`, CLAUDE.md §3 count, `docs/operation-test-plan.md` (P-06/P-07 rows), `docs/bug-log.md` §9 K6, `CHANGELOG.md` `## BP-30 — …`.

Task order: 1 → 2 → 3 → 4 → 5 → 6 → 7.

---

### Task 1: `useOnScreen`, `useChibiLife` and the `live`/`react`/`facing` props on `Chibi`

**Files:**
- Create: `packages/ui-kit/src/avatar2d/on-screen.ts`, `on-screen.test.tsx`, `life.ts`, `life.test.tsx`
- Modify: `packages/ui-kit/src/avatar2d/Chibi.tsx` (props at :11, `layersFor` call :16, `renderLayer` :30, `rootProps` :41-46), `types.ts`, `avatar2d.module.css` (after the `.bounce` block ending :102), `Chibi.test.tsx`, `index.ts`

**Interfaces:**
- Produces:
  ```ts
  export type ChibiLive = 'off' | 'idle'
  export type ChibiReactionKind = 'cheer' | 'wave' | 'spin'
  export interface ChibiReaction { kind: ChibiReactionKind; key: number }
  export type ChibiFacing = 'right' | 'left'          // 'right' = today's art
  export interface ChibiProps { …existing…; live?: ChibiLive; react?: ChibiReaction | null; facing?: ChibiFacing; onFacesReady?: () => void }
  export const LIFE = { breatheMs: 4000, blinkMs: 120, blinkMinGapMs: 3000, blinkMaxGapMs: 6000, doubleBlinkRate: 0.1, cheerFaceMs: 1200, hopMs: 420, sparkleMs: 700, waveFaceMs: 800, tiltMs: 600, spinMs: 500 } as const
  export function useOnScreen(ref: RefObject<Element | null>, rootMargin = '0px'): boolean   // continuous; also false while document.visibilityState !== 'visible'; true when the API is missing
  export interface ChibiLifeState { face: 'base' | 'closed' | 'happy'; motion: 'none' | 'hop' | 'tilt' | 'spin'; breathing: boolean }
  export function useChibiLife(opts: { live: ChibiLive; react: ChibiReaction | null; onScreen: boolean; facesReady: boolean; baseExpression: Expression; reducedMotion: boolean; rng?: () => number }): ChibiLifeState
  export function prefersReducedMotion(): boolean    // matchMedia guard, false when matchMedia is missing
  ```
  `Chibi`: when `live !== 'off'` it renders the face layers for `baseExpression`, `closed` and `happy` (via `layersFor` per expression, deduplicated by file; faces only, the other layers once) each wrapped in a `<span data-face-layer="base|closed|happy">`; the root carries `data-live`, `data-face`, `data-facing` and the classes `breathe` / `hop` / `tilt` / `spin` from the hook's state; CSS shows only the `[data-face-layer]` that matches `data-face` (`opacity` + `visibility`, no transition). `facesReady` becomes true when every face `<img>` has fired `load` (or errored) **and** its tint (if any) resolved — reuse `ChibiLayer`'s existing load/`useTintedLayer` results via an `onReady` callback. `facing === 'left'` sets `data-facing="left"` and the root `transform: scaleX(-1)` (combined with the breathe scale in one `transform` through CSS variables `--chibi-sx`/`--chibi-s`). When `live === 'off'` none of the new attributes or wrappers render.
- Consumes: `Expression`, `layersFor`, `ChibiLayer`, `useTintedLayer` as they exist.

- [ ] **Step 1: Failing tests** — `on-screen.test.tsx`: `reports false until the observer sees the element, true after, false again when it leaves` (mock observer kept alive, not disconnected on first hit), `follows document.visibilityState` (dispatch `visibilitychange`), `is true without the API`, `disconnects on unmount`. `life.test.tsx` (fake timers, seeded `rng`): `breathes only while live, on screen and not reduced`; `blinks closed for 120 ms every 3–6 s and doubles 10 % of the time` (seed-driven); `never blinks before facesReady`; `never blinks when the base expression is closed or sleep`; `cheer sets happy for 1200 ms and hop for 420 ms, once per key`; `a new cheer key restarts; a wave during a cheer is ignored`; `spin runs 500 ms`; `reduced motion: face stays base and motion none, even with a react`; `unmount clears every timer` (`vi.getTimerCount() === 0`). `Chibi.test.tsx`: `live off renders the same markup as before` (serialize a head-frame seat chibi and a full-frame figure with `live` unset and compare to a stored snapshot captured on `main`); `live idle mounts the base, closed and happy faces once each and shows only data-face`; `facing left flips the root and keeps data-facing`; `onFacesReady fires once every face loaded`.
- [ ] **Step 2: Run** `corepack pnpm --filter @bp/ui-kit exec vitest run src/avatar2d` → FAIL.
- [ ] **Step 3: Implement** per Interfaces; keyframes in `avatar2d.module.css` under the existing reduced-motion block's reach; `.breathe { animation: chibiBreathe var(--life-breathe, 4000ms) ease-in-out infinite }`, `.hop`, `.tilt`, `.spin` one-shot with `animation-fill-mode: forwards`; `[data-face-layer] { opacity: 0; visibility: hidden }` and `[data-face="closed"] [data-face-layer="closed"] { opacity: 1; visibility: visible }` etc.
- [ ] **Step 4: Run** `corepack pnpm --filter @bp/ui-kit test` → PASS (all 600+). Typecheck + eslint.
- [ ] **Step 5: Commit** `feat(ui-kit): a chibi can breathe, blink, cheer, greet and turn on the layers it already has, and is byte-for-byte the same when it is not asked to`.

### Task 2: `LiveFigure` — greet button, sparkle ring, "Xoay"

**Files:**
- Create: `packages/ui-kit/src/avatar2d/LiveFigure.tsx`, `LiveFigure.test.tsx`, `live-figure.module.css`
- Modify: `packages/ui-kit/src/i18n/locales/vi/game.json`, `en/game.json` (`avatar.turn`, `avatar.greet`), `packages/ui-kit/src/avatar2d/index.ts`, `packages/ui-kit/src/index.ts`, `docs/ui-kit.md` (a "Live figure" paragraph)

**Interfaces:**
- Produces:
  ```ts
  export interface LiveFigureProps {
    subject: ChibiSubject; frame?: ChibiFrame; size?: number; label: string; expression?: Expression; lazy?: boolean
    live?: ChibiLive            // default 'idle'
    react?: ChibiReaction | null
    greet?: boolean             // default true: wraps the figure in the transparent button
    turn?: boolean              // default false: renders the "Xoay" button under the figure
    className?: string
    onTurn?: (facing: ChibiFacing) => void
  }
  export function LiveFigure(props: LiveFigureProps): JSX.Element
  export function nextReaction(prev: ChibiReaction | null, kind: ChibiReactionKind): ChibiReaction   // { kind, key: (prev?.key ?? 0) + 1 }
  ```
  Markup: `<div class="liveFigure" data-reacting={kind|undefined}>` → `[greet ? <button type="button" class="greet" aria-label={t('avatar.greet')}>` wrapping `<Chibi … live react facing />` `</button> : <Chibi … />]` + `<span class="sparkleRing" aria-hidden>` with six `<i>` placed on a circle around the figure box, visible only while `data-reacting="cheer"` (700 ms) + `[turn ? <button type="button" class="turn">{t('avatar.turn')}</button>]`. A tap on the greet button calls `nextReaction(current, 'wave')` unless the current reaction is `cheer`/`spin` and still running; "Xoay" toggles `facing` and fires `spin` (instant flip under reduced motion, no `spin` class). The figure's `role="img"` and `label` are untouched. The internal reaction state merges the prop `react` (external cheer) with the internal wave/spin: the latest `key` wins.
- Consumes: Task 1.

- [ ] **Step 1: Failing tests** `LiveFigure.test.tsx`: `keeps the figure's role img and name`; `the greet button has the vi label and a tap sets a wave`; `a tap during a cheer is ignored`; `Xoay toggles data-facing and runs spin; under reduced motion it flips with no spin class`; `the sparkle ring shows six marks only during a cheer`; `turn=false renders no Xoay`. i18n parity test passes with the two new keys.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `corepack pnpm --filter @bp/ui-kit test`, typecheck, eslint → PASS.
- [ ] **Step 5: Commit** `feat(ui-kit): LiveFigure — a tap greets, Xoay turns, and a cheer sparkles around the figure`.

### Task 3: Wardrobe stage

**Files:**
- Modify: `apps/normal-web/src/screens/wardrobe/StagePanel.tsx:42-75` (+ `StagePanel.test.tsx`), `WardrobeScreen.tsx` (pass a `cheerKey`/reaction when the worn config changes by an item or colour pick, not on tab change), `wardrobe.module.css` (room for the Xoay button beside the existing stage buttons)

**Interfaces:**
- Consumes: `LiveFigure`, `nextReaction`.
- Produces: `StagePanelProps` gains `react?: ChibiReaction | null`; `WardrobeScreen` keeps `const [stageReact, setStageReact] = useState<ChibiReaction | null>(null)` and calls `setStageReact(r => nextReaction(r, 'cheer'))` from the pick handlers (`onPick` for items and colours) when the draft actually changes; the stage renders `<LiveFigure … live="idle" turn react={react} label={t('wardrobe.stage')} />` for both the full and the head frame (the head variant keeps `greet`, no `turn`).

- [ ] **Step 1: Failing tests** `StagePanel.test.tsx`: `renders the figure live with a Xoay button and keeps the name "Phòng thay đồ"`; `WardrobeScreen.test.tsx`: `picking an item cheers the stage once; switching a tab does not` (assert `data-reacting="cheer"` appears then the key increments only on picks).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `CI_SKIP_BUILD=1 corepack pnpm --filter @bp/normal-web test` → PASS; e2e locators `getByRole('img', { name: 'Phòng thay đồ' })` still resolve (grep `e2e/avatar2d.spec.ts:34`, `avatar-tint.spec.ts:28`, `wardrobe-layout.spec.ts:40` — unchanged).
- [ ] **Step 5: Screenshots** 1920×940, 1366×768, 375×812 of the wardrobe, plus one mid-cheer (pause via `page.clock` or capture within 300 ms of a pick), `expectNoTextOverlap`; save `.superpowers/sdd/bp30/shots/T3-*.png`; delete `zz-preview`.
- [ ] **Step 6: Commit** `feat(normal-web): the wardrobe figure breathes, blinks, cheers when an item goes on, greets when tapped and turns`.

### Task 4: Shop stage

**Files:**
- Modify: `apps/normal-web/src/screens/shop/ShopStage.tsx:45-60` (+ test), `ShopScreen.tsx` (cheer on try-on and after a successful buy), `shop.module.css`

**Interfaces:**
- Consumes: Task 2. Produces: `ShopStage` prop `react?: ChibiReaction | null`; `ShopScreen` cheers on `onTry` (a card pick that changes the try-on) and on a successful `shopBuy`; the 375 px strip keeps `greet`, no `turn` (space); desktop/tablet show `turn`.

- [ ] **Step 1: Failing tests** `ShopScreen.test.tsx`: `trying a card cheers the stage; a successful buy cheers again`; `ShopStage.test.tsx`: `the strip has no Xoay, the column has`.
- [ ] **Step 2–4:** red → implement → `CI_SKIP_BUILD=1 corepack pnpm --filter @bp/normal-web test` green; ops selectors unchanged (`shop.figure` name, `data-item`, `Mua`).
- [ ] **Step 5: Screenshots** shop at 1920×940, 1366×768, 375×812 + one mid-cheer; delete `zz-preview`.
- [ ] **Step 6: Commit** `feat(normal-web): the shop figure lives, cheers a try-on and a purchase, and turns`.

### Task 5: Welcome dialog and profile

**Files:**
- Modify: `apps/normal-web/src/screens/WelcomeDialog.tsx:150-170` (+ test), `ProfileScreen.tsx:253` (+ test)

**Interfaces:**
- Consumes: Task 2. Produces: WelcomeDialog cards render `<LiveFigure live="off" greet={false} react={picked === choice.itemId ? pickReact : null} …/>` where `pickReact = nextReaction(prev, 'cheer')` on each pick (R8: not on claim); ProfileScreen's large figure is `<LiveFigure live="idle" greet turn={false} label={displayName} />`, the 56 px head stays a plain `Chibi`.

- [ ] **Step 1: Failing tests** `WelcomeDialog.test.tsx`: `picking a card cheers that card only; claiming cheers nothing`; `ProfileScreen.test.tsx`: `the large figure is live and tappable; the small head is not`.
- [ ] **Step 2–4:** red → implement → web suite green. **Step 5: Screenshots** welcome at 375×812 mid-cheer, profile 1366×768. **Step 6: Commit** `feat(normal-web): a welcome card cheers when picked and the profile figure breathes`.

### Task 6: Ops cases and docs

**Files:**
- Modify: `apps/normal-web/e2e/ops/08-shop.spec.ts` (+ P-06, P-07), `docs/operation-test-plan.md` (section P rows), `docs/test-matrix.md` (+2 rows), `tooling/arch/acceptance-links.test.ts` (matrix count), CLAUDE.md §3 (ops count), `docs/ui-kit.md`, `docs/avatar-2d.md` (one paragraph: life without new layers), `docs/known-limitations.md` (R2 mirrored text/frames; one live figure per screen; no back view), `docs/bug-log.md` §9 (K6 → shipped as BP-30, the pose spike stays open), `CHANGELOG.md` (`## BP-30 — … — merged \`MERGE\` (date)`, rulings R1–R8, "Still open": the real-pose spike)

**Cases (titles verbatim for the matrix):**
- `P-06 the shop figure lives: it breathes, a tap greets, Xoay turns it, and a try-on cheers @mobile` — `newPlayer`, claim the welcome gift via the API (reuse `playerState` from P-04/P-05), open `/shop`, assert the figure root has `data-live="idle"` and the class list contains the breathe class, tap the greet button (`getByRole('button', { name: 'Nhân vật của bạn, bấm để chào' })`) → `data-reacting="wave"`, press `Xoay` → `data-facing="left"`, pick a card → `data-reacting="cheer"` then it clears within 2 s.
- `P-07 with reduced motion the figure keeps still: no animation class, no face change, Xoay flips at once` — a context with `reducedMotion: 'reduce'` (desktop project): no `breathe` class, `data-face="base"` stays for 8 s (`page.clock` fast-forward), `Xoay` sets `data-facing="left"` with no `spin` class.

- [ ] **Step 1: Write** the cases; `pnpm build:normal` (shim on PATH) then `corepack pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "P-06|P-07"` → green (mobile + desktop). **Step 2: Docs** as listed, counts bumped, `corepack pnpm exec vitest run --root . tooling/arch` → green; read a Vietnamese heading back. **Step 3: Commit** `test(e2e), docs: the ops pack watches the shop figure live and still, and the docs say how the chibi came alive without a new layer`.

### Task 7: Final review, merge order, gate, merge, deploy

- [ ] Whole-branch review (opus) → one fix wave → re-review.
- [ ] Wait for BP-29 to be merged into `main` (it owns `.chibi { isolation: isolate }`); then `git merge main` into this branch, resolve, re-run ui-kit + web unit suites; keep/add the `.chibi` isolation assertion.
- [ ] Full gate (typecheck → lint → test → build:normal → build:lite → avatar:check → e2e Normal → e2e Lite → ops) with logs; merge `--no-ff` (`Merge feature/BP-30-chibi-idle-life: <one sentence>`); docs commit filling `MERGE` and the gate line; VPS deploy (no migration: `backup.sh`, pull, rooms 0, `compose up -d --build`, `/health`, smoke `/shop`); CHANGELOG deploy line; one report.

---

## Self-review notes (2026-10-22)

- Spec coverage: 3.1 table → Task 1 (hook + CSS) and Task 2 (sparkles, greet, turn); 3.2 → Tasks 3–5; a11y/copy → Task 2; performance (on-screen, visibility, one per screen) → Task 1 + Tasks 3–5 (`live` only on the stage); 3.3 "không làm" → Global Constraints; 4 tests → Tasks 1–6; 5 risks → Review Focus 1–5 and Task 7's merge order; R1–R8 → Tasks 1, 2, 5, 7.
- Open to the implementer: the exact `rng` seeding in tests; how `facesReady` collects load events from `ChibiLayer` (an `onReady` prop on `ChibiLayer` is the obvious shape); where the Xoay button sits relative to existing stage buttons.

## Amendments (pre-flight 2026-10-22)

An independent opus review of the plan against the code at `f9eb46c`. Each amendment overrides the task text it names. Lead decisions are marked.

- **P1 (Task 1, BLOCKER).** Split Step 1 into its own FIRST commit on the untouched `Chibi.tsx`: `Chibi.test.tsx` → `live off renders the same markup as before` renders four cases (a head-frame 72 px human with tints, a hair-clipping hat and a frame item; a full-frame human with an aura; a bot; a `lazy` chibi not yet in view), serialises `outerHTML` after mapping every hashed class back through the imported `avatar2d.module.css` object (`_chibi_x1y2z` → `chibi`), records an inline snapshot, commit `test(ui-kit): pin the chibi's markup before it learns to live`. Only then edit `Chibi.tsx`; the snapshot must pass unedited (no `-u`).
- **P2 (Task 1, BLOCKER).** No `<span>` wrappers and no `[data-face="x"] [data-face-layer="x"]` CSS. `Chibi` computes `faces = unique([baseExpression, 'closed', 'happy'])` and `shown = state.face === 'base' ? baseExpression : state.face`; each face layer goes through `renderLayer(layer, expr === shown ? undefined : s.faceHidden)` with a new `ChibiLayer` prop `face?: Expression` that sets `data-face-layer={face}` and `data-face-hidden=""` when hidden; `.faceHidden { opacity: 0 }` only (no `visibility: hidden`, so lazy loading is never deferred); base face first in the DOM, extra faces right after it at z-index 50 (`avatar-tint.spec.ts:61` picks the first order-50 layer); the root keeps `data-face="base|closed|happy"`. The dedup by file is sound: `layersFor` (`layers.ts:72-101`) varies only the L50 face by expression; faces are tinted (skin + eye), so each extra face is one tint job.
- **P3 (Task 1, BLOCKER).** Readiness: `tinted.ts` gains `export function useTintedLayerState(prefix, layer, priority?, density?): { url: string | null; settled: boolean }` (`settled = key === null || settledKey === key`, set in the existing `promise.then`); `useTintedLayer` becomes `useTintedLayerState(...).url` (tinted.test.ts unchanged). `ChibiLayer` gains `onReady?: (file: string, ready: boolean) => void` with `ready = settled && loadedSrc === <rendered src>` (`loadedSrc` from `onLoad`/`onError`); pass `onReady` only to face layers in live mode; `facesReady` resets when any face's tint key changes (a colour pick).
- **P4 (Task 1, BLOCKER).** No `--chibi-sx`/`--chibi-s` (plain variables do not interpolate). Use the individual transform properties: breathe `scale` 1 → 1.015; hop `translate: 0 -6%` (reads `var(--chibi-hop, -6%)`, see P14); tilt `rotate: -4deg`; facing static `transform: scaleX(-1)` on `[data-facing="left"]`; spin two keyframes on `transform`, `chibiSpinLeft` (1 → 0.06 → −1) and `chibiSpinRight` (−1 → −0.06 → 1), picked by `data-facing`; `transform-origin: 50% 100%` only on `.chibi[data-live]`; the hook returns `breathing: false` while `motion !== 'none'` so one `animation` applies at a time; no `will-change`. `global.css:137-144` already has `transition: none !important` under reduce.
- **P5 (Task 1, MINOR).** `useOnScreen(ref, { rootMargin = '0px', enabled = true })`: when `enabled` is false it creates no observer and no `visibilitychange` listener and returns `false`; `Chibi` enables it only for `live === 'idle'`.
- **P6 (Task 1, MINOR).** Delete `prefersReducedMotion()`; `Chibi` uses `useMediaQuery('(prefers-reduced-motion: reduce)')` (`table/useMediaQuery.ts`; precedent `reveal-hold.ts:64`, `PeelCard.tsx:109`).
- **P7 (Task 1, BLOCKER).** `ChibiLive = 'off' | 'still' | 'idle'`: `still` mounts the three faces and reacts to `react`/`facing` with no breathe, no blink, no observer (the welcome cards need it); `off` stays the byte-identical path.
- **P8 (Task 1, BLOCKER).** `useChibiLife({ live, react, facing, onScreen, facesReady, baseExpression, reducedMotion, rng })` returns `{ face, motion, breathing, reacting: 'cheer' | 'wave' | 'spin' | null }`. Spin is derived from a `facing` change after mount (not from `react`); a `react` key present at mount counts as seen; cheer always restarts (face `happy` 1200 ms only if `facesReady`, motion `hop` 420 ms); wave is ignored while reacting is `cheer` or motion is `spin`; spin replaces `hop`/`tilt` and leaves the face timer alone; reactions do not depend on `onScreen`; under reduce `face='base'`, `motion='none'`, `reacting=null`, facing applies at once; double-blink gap 160 ms. The live root renders `data-reacting`, `data-breathing="true|false"`, `data-motion` (class names are hashed in production). Rename `LIFE` → `CHIBI_LIFE`.
- **P9 (Task 2, BLOCKER).** `LiveFigure` API: props `subject, frame?, size?, label?: string` (Welcome is decorative), `figureClassName?: string` (to `Chibi`; Welcome's `w.figure`), `facing?: ChibiFacing` (controlled, default `'right'`), `live` (default `'idle'`), `react`, `greet`, `expression?`, `lazy?`, `className?`. No `turn`/`onTurn`: add `export function TurnButton({ facing, onTurn, className }: { facing: ChibiFacing; onTurn: (next: ChibiFacing) => void; className?: string })` (ghost sm `Button` with `t('avatar.turn')`) and `flipFacing(f)`; stages place it. Internal sequence: `useEffect([react?.key])` turns a changed external `react` into `{ kind, key: ++seq }`, a tap gives `{ kind: 'wave', key: ++seq }` (no cross-source key comparison). `data-reacting` lives on the `Chibi` root. Sparkle ring: `aria-hidden` sibling `position: absolute; inset: 0` INSIDE the figure box (`.stage`/`.stripFigure` are `overflow: hidden` anyway), six `<i>` at fixed percentage positions, `key={seq}` per cheer, base `opacity: 0` with a 700 ms fade keyframe, not rendered under reduce. Wrapper `position: relative; display: inline-block; max-width: 100%`.
- **P10 (Task 2, lead decision: ADOPT).** The greet control is a transparent `<button>` overlaid as a sibling (`position: absolute; inset: 0`, `:focus-visible` ring), not a wrapper, so the figure's `role="img"` name survives for screen readers (R6's intent). Record as a deviation from the spec's "bọc".
- **P11 (Task 2, MINOR).** The new keys are a new top-level `avatar` object in ui-kit `game.json`; `LiveFigure` uses `useTranslation()` (default namespace `game`). `locales.test.ts` of normal-web is unaffected.
- **P12 (Task 3, BLOCKER).** The label stays `t('wardrobe.title')` (`StagePanel.tsx:67,69`; `wardrobe.stage` does not exist). Render ONE `<LiveFigure frame={portrait ? 'head' : 'full'} size={portrait ? 240 : fullSize} …>` so the hook and facing survive the Khung swap; `facing` state lives in `StagePanel`; `TurnButton` shows for both frames; place it beside the expression row but OUTSIDE `role="group"` (wrap `.expressionRow` + `TurnButton` in a new flex row; `StagePanel.test.tsx:69` pins the group's buttons as [prev, next]); check the fit at 375 px (343 px row: 44 + name + 44 + Xoay).
- **P13 (Task 3, MINOR).** `stageReact` state at `WardrobeScreen.tsx:150-163` (before the early returns :246/:257); cheer from `pick` (:285) only when the result wears the item (not a take-off) and from the colour `onPick` (:461), each only when `!sameConfig(next, config)` (:102); no cheer from `onGender`, `onRemove`, `undo`, the `initialItem` effect or `onOutfitApplied` (ruling). Tests assert `data-reacting`, not `data-face` (jsdom never loads images).
- **P14 (Task 3, MINOR).** At 1920×940 the 290 px figure already loses ~11.5 % at the top of the 300 px stage; take the mid-hop shot there, and if the hair clips set `--chibi-hop: -3%` on this stage.
- **P15 (Task 4, lead decision).** Xoay is present on every shop size, strip included: `TurnButton` at the end of `.strip` (after `.stripText`) and in the column after the stage ahead of `.stageActions`. One `LiveFigure` with conditional `frame`/`size` (`ShopStage.tsx:50-54`); `react`/`facing` state at `ShopScreen.tsx:125-147`; cheer in `tryItem` (:206) only when `tryOn[item.slot] !== item.id`, and once in `buy()` after `setStatus` (:238). Create `ShopStage.test.tsx`.
- **P16 (Task 5, MINOR).** Welcome: `<LiveFigure live="still" greet={false} figureClassName={w.figure} react={picked === choice.itemId ? pickReact : null} …/>` inside the existing card button; `pickReact` state at `WelcomeDialog.tsx:59-65`, bumped in the `onClick` at :159. Profile: `<LiveFigure live="idle" frame="full" size={200} label={displayName} />` at :253; :257 stays a plain `Chibi`.
- **P17 (Task 6, BLOCKER).** Ops: no class-name assertions — use `data-live`, `data-breathing`, `data-reacting`, `data-facing`, `data-face` and `getComputedStyle(root).animationName` (`!== 'none'` in P-06, `=== 'none'` in P-07). P-06 uses `newPlayer`; wait for `data-reacting` to clear between tap, Xoay and try-on. Blinks: a `MutationObserver` on `data-face` — P-06 expects at least one `closed` within 7 s, P-07 none in 7 s. P-07 context: `playerState` + `browser.newContext({ ...LOOK, reducedMotion: 'reduce', storageState })`. No `page.clock` (if used: `install()` before `goto`, `runFor` not `fastForward`).
- **P18 (Task 6 / Task 1, BLOCKER).** P-05's `wardrobeHasDrawn` (`08-shop.spec.ts:373-391`) requires every stage `img` to load within 2 s on fast 3G: make it ignore `img[data-face-hidden]`; and `Chibi` defers mounting the extra faces until the base face reported ready (state `extrasWanted`) so they never compete with first paint. Record the new P-04/P-05 numbers.
- **P19 (Task 6, MINOR).** Docs: `operation-test-plan.md:286` "Cả sáu ca (P-01…P-05 và P-03b)" → "Cả tám ca (P-01…P-07 và P-03b)", P-06 in `mobile`, P-06/P-07 rows; `test-matrix.md` new "BP-30" section (2 rows; the P-02/P-04 project sentence at :265); `acceptance-links.test.ts:270` `+ 2`; CLAUDE.md `:63`/`:68`.
- **P20 (Global / Task 7, BLOCKER).** Merge `main` (once BP-29 is on it) BEFORE Task 6, not in Task 7: Task 6 edits the same ten files BP-29 does. Final counts after BP-29: ops **54**, matrix `43 + 10 + 4 + 7 + 5 + 8 + 3 + 5 + 5 + 3 + 2`, checklist unchanged `64 + 3 + 2 + 3 + 3 + 5`. Keep BP-29's isolation test (its regex `/\.chibi\s*\{/` must still match a `.chibi {` rule — do not rename that selector). If BP-29 is not merged by the end of Task 5, do Task 6 anyway and resolve the conflicts at the merge.
- **P21 (Global, MINOR).** Trailer: the session prescribes `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` — keep it. `Chibi.tsx` refs: props :72-93, `layersFor` :115, `renderLayer` :129, `rootProps` :140-150; `lazy.ts` `useInView` :18-41. Review Focus 2's `.cheer/.wave` classes are `.hop/.tilt/.spin` (and tests read `data-*`, not classes).

**Order kept** 1 → 2 → 3 → 4 → 5 → (merge main) → 6 → 7, with Task 1 split into the P1 snapshot commit first.
