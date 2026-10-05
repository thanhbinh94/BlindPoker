# Plan 20 — The open defects (bug tồn đọng) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every defect still recorded as open, after the user's "có, hãy fix các bug còn tồn đọng đi. không cần hỏi lại. lúc nào xác nhận đã hoàn thành toàn bộ rồi thì báo" (2026-10-05).

**Architecture:** six bounded tasks over existing flows.
- **T1 Money:** a ledger idempotency key, so a write whose commit went through but whose reply was lost is never applied twice. This needs one additive table per edition.
- **T2 Contrast:** red ink and badge text reach WCAG AA, light-theme result-card names become legible, and the Lite parchment island gets a contrast test.
- **T3 Wardrobe:** two fixes:
  - the worn pill clears the skin swatch at every width;
  - a locked original's unlock hint stays visible when an owned colour variant is shown.
- **T4 Table and lobby:**
  - the result-card scrim loses its edge step;
  - the room-name tooltip shows only for truncated names;
  - the narrowest ticket width gets tested;
  - the 320 px sideways scroll is fixed.
- **T5 Avatar:** the cream skin that hair and outfit pictures redrew (forehead specks, slipper insteps) takes the skin colour.
- **T6 Docs.**

**Tech Stack:**
- TypeScript, React 18.3, CSS modules, Vitest + Testing Library, Playwright.
- Drizzle on Postgres (PGlite in tests), node:sqlite (Lite).
- The Node asset pipeline: `apps/normal-web/scripts/avatar-pipeline*`.

**Source of truth:**
- `docs/bug-log.md` §7: the "Ghi nhận, chưa làm" notes of Đợt 2, Plan 17 and Đợt 3.
- `docs/known-limitations.md`: the cash-out double credit, `--red` below AA, the badges, and the Lite parchment test.
- The three investigations of 2026-10-05:
  - in this plan's SDD workspace: `inv-cashout.md`, `inv-contrast.md`, `inv-ui.md`;
  - their scripts and screenshots in the session scratchpad: `inv-ui/`, `inv-cashout/`, `inv-contrast/`.
- The avatar prototypes, also in the scratchpad:
  - `layerskin-proto2.mjs` (outfit masks);
  - `layerskin-proto.mjs` (hair masks);
  - `heads-render5.mjs` (renders with the multiplicative tint);
  - `cream/`, `lskin/`, `lskin2/` (images).

**Scope ruling (controller, 2026-10-05).**
- **In:** every item below.
- **Out**, and why:
  - **Roadmap features, not defects:** avatar photo upload (R1), email notifications (No7), a bundled Vietnamese web font, more poses.
  - **Rule changes that are the user's to decide:**
    - a released carry-over pot paying seats that sit out (spec §8.4);
    - relief looking at the balance only (§12.4).
  - **Deliberate design trade-offs recorded in `docs/known-limitations.md`:**
    - `SIT_OUT` on a two-seat table;
    - the felt resizing at the breakpoint;
    - a cosmetic change reaching the table only at the next join;
    - one pose.
  - **Infrastructure facts:**
    - the Docker image has never been built;
    - no real-Postgres suite;
    - free-tier sleep and Oracle reclaim;
    - stopping the Normal server is a hard kill;
    - backups are run by the operator.
  - **Dev-only npm advisories.**
  - **The pipeline note "a re-cut lands 1–2 px off".** It is a reproducibility note, not a user-visible defect.

## Global Constraints

- **Worktree.**
  - Work only in `D:\Work\Other Project\bind-poker\.worktrees\plan20`, branch `plan20/open-bugs`.
  - Never touch the main checkout, never merge or push, never open a real `.env`.
  - Never stop or start the user's LAN host on :8080. Test servers on other ports are fine (e2e 8091, ops 8093, playground 5175); stop them afterwards.
- **Shell.**
  - In Bash, run `export PATH="$PATH:/c/Users/lathanhbinh/AppData/Roaming/npm:/c/Users/lathanhbinh/AppData/Local/pnpm"` before pnpm.
  - Edit files with Edit/Write, not Bash heredocs. Keep each file's line endings (many are CRLF in the working tree).
- **Lint and locales.**
  - Lint rules: `react/jsx-no-literals`, `react-hooks/*`, `--max-warnings=0`.
  - vi/en locale key sets stay identical; new visible text goes through i18n in both languages.
  - Vietnamese copy reads naturally (`docs/copy-review-2026-10.md`).
- **Money.**
  - Σ balances + Σ sinks + table stacks + carried pot is conserved. Every money test asserts it (`books(h) === 0` in `packages/server-kit/src/room/room-hands.test.ts`).
  - Both editions keep the same room semantics.
- **Avatar art.**
  - No committed layer picture (`apps/normal-web/public/avatar/*@1x/@2x.png` that is not a `*mask*`) changes.
  - New and changed masks only.
  - The natural tone (no `skinColor`) renders exactly as before.
  - `pnpm --filter @bp/normal-web avatar:check` reports 0 failures.
- **e2e accounts.**
  - The e2e server allows 10 sign-ups a minute, and the suite already registers several accounts.
  - Extend existing tests rather than adding ones that register. If a new registration is unavoidable, use `registerPatiently`-style waits.
- **Visual proof.**
  - Every UI task ships real-build screenshots: 1920×940 (the user's screen), 1366×768 and 375×812, dark and light where the change is theme-dependent.
  - Put them in the SDD workspace `shots/<task>/`; the task reviewer opens them.
- **Tests first.** A test that fails on the old code comes before each fix.
- **Commits.**
  - One or more per task, message style `fix(<area>): …` like the repo's history.
  - Each message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: A ledger write is applied once, however often it is retried

**Why.** `docs/known-limitations.md`, "An automatic cash-out retry after a write that committed but reported an error credits twice". The investigation (`inv-cashout.md`) found more:
- **Carry-over release:** the same hole.
- **Buy-in:** a re-pressed Sit debits twice.
- **Cash-out on a live seat:** several retry paths leave the seat playing before its cash-out is settled. A key alone would then credit a stale stack, so the seat must also be frozen.

**Files:**
- `packages/server-kit/src/repositories.ts`: the `BalanceRepository.apply` contract.
- `packages/server-kit/src/room/room.ts`, `types.ts`, `memory-repositories.ts` (the test fake), and the room tests.
- Normal:
  - `apps/normal-server/src/db/schema.ts`;
  - `apps/normal-server/src/economy/balance-repo.ts` (or wherever `apply`/`creditWithin` live; see `inv-cashout.md`);
  - new `apps/normal-server/drizzle/0003_ledger_keys.sql`, plus the journal entry and snapshot through `pnpm --filter @bp/normal-server db:generate --name ledger_keys` if that script exists, otherwise by hand in the existing style;
  - a migration test in the style of `migrate-outfits.test.ts`.
- Lite:
  - `apps/lite/server/**/migrations.ts`: a v3 step;
  - `sqlite-repos.ts`: `transact`;
  - the Lite repository tests.
- `docs/server-kit.md`: the `apply` contract.

**Design** (from `inv-cashout.md`; follow it unless the code shows otherwise, and ledger any deviation):
1. **Contract.**
   - The new signature:
     ```ts
     apply(entries, meta?, opts?: { key?: string }): Promise<{ applied: boolean }>
     ```
   - The key is claimed first, inside the same transaction.
   - When it was already claimed, the call is a no-op and returns `{ applied: false }`, with no balance check and no write.
   - A batch rejected (insufficient balance, any error) rolls back, so its key stays unclaimed.
   - Callers that pass no key behave exactly as today.
2. **Storage.**
   - Each edition gets a table `ledger_keys(key text primary key, created_at)`.
   - Normal: migration `0003_ledger_keys.sql` uses `CREATE TABLE IF NOT EXISTS`. Its journal `when` must be greater than the last entry's (1789171200000).
   - Lite: a v3 migration in the append-only array.
   - Purely additive: no existing row or column changes.
3. **Room.**
   - **New seat state:** each seat gets `sitId` (a new id per sitting, set in `sitDown`), `cashOutPending: boolean` and `pendingBuyIn?: { sitId, amount }`.
   - **Cash-out** (`standUpNow`):
     - before writing, set `cashOutPending = true`;
     - write with key `cash_out:${roomId}:${sitId}` (no amount in the key);
     - clear the flag and `sitId` only on success.
   - **Frozen seat:** `eligibleForHand` excludes `cashOutPending` seats. Neither a rejoin nor Sit In clears the flag.
   - **Buy-in** (`sitDown`): a retry after a failed buy-in reuses `pendingBuyIn` (same key `buy_in:${roomId}:${sitId}`, same amount). Whether that write was a duplicate or not, the player is seated with that amount.
   - **Carry-over release:**
     - `carryOverReleaseKey ??= \`carry_over:${roomId}:${newId()}\``, cleared on success;
     - while it is set, `startHand` retries the release first;
     - if the release still fails, the hand deals with `carryOverIn: 0` and keeps the pot aside.
   - **Logs:** every money error log line names the key.
4. **Docs:**
   - remove the limitation from `docs/known-limitations.md`;
   - state the new contract in `docs/server-kit.md`.

**Tests** (fail first):
- **Repository, in all three implementations (memory fake, Normal on PGlite, Lite):**
  - the same key twice moves the balance once (`applied: false` the second time);
  - a replayed key skips the balance check;
  - a rejected batch leaves its key unclaimed;
  - Normal: two concurrent same-key calls apply once.
- **Room, "committed but threw":** wrap the real `apply` to throw after it resolves, once. Cover:
  - reconnect expiry;
  - end of hand;
  - Stand Up pressed twice (Hold'em and Blind);
  - a failed Leave and then a rejoin;
  - Sit In after a failed sit-out sweep;
  - a carry-over release and then a new deal;
  - Sit pressed again after a buy-in.

  Each case asserts the balance moved once, the pending seat was not dealt in, and `books(h) === 0`.
- **Migrations:**
  - Normal: apply 0000–0002, insert players and ledger rows, apply 0003, and check the rows are untouched and the key is unique;
  - Lite: upgrade a v2 database to v3 and check balances are kept.
- **Existing fakes:** the fakes in `room-hands.test.ts` (around :223, :481, :502, :618) pass `opts` through.

**Acceptance:**
- the server-kit, normal-server and lite suites are green;
- the ops pack (`pnpm --filter @bp/normal-web e2e:ops`, port 8093) is green;
- the migration applies on a fresh PGlite and on an upgraded one.

**Deploy note (controller):** the LAN host needs `run.ps1` *without* `-NoMigrate` once, to apply 0003 to the user's Neon database.
- The migration is additive: one new table, no existing rows touched.
- The user authorised the work end to end ("không cần hỏi lại"); this is recorded in the ledger.

### Task 2: Red ink, badges, light-theme result names and the Lite parchment reach AA

**Why.** `docs/known-limitations.md` UI section. The investigation (`inv-contrast.md`) also found the light-theme result-card names at about 1.1:1, invisible: `[data-surface='night']` resets `--ink` but not `color`.

**Changes** (values from `inv-contrast.md`; recompute and pin them in tests):
1. **Split `--red` the way `--teal` / `--teal-fill` are split.**
   - `--red` becomes the ink:

     | Where | `--red` |
     |---|---|
     | dark and night palettes | `#e0737b` (6.23:1 on `--bg`, 5.60 on `--bg-elev`, 5.43 on the felt's local bg) |
     | `.panel.felt` | `#e0737b`, or `#e37d83` if the felt's highlight peak must also pass |
     | light theme and the parchment islands | unchanged |

   - The new `--red-fill` takes the old value: `#c8323c` in dark and night, `#a9242d` in light. Declare it in `tokens.css` (dark, light, night blocks) and in `.panel.felt`.
   - Move the 7 FILL uses and the 8 HAIRLINE uses that `inv-contrast.md` lists to `var(--red-fill)`, so fills and rules stay pixel-identical. The 7 INK uses keep `var(--red)` and get the new value.
   - `--red-soft` stays.
2. **Badges** (12px/600 text, so 4.5:1 applies): in `.badge.*` (`packages/ui-kit/src/primitives/primitives.module.css` ~270–295), mix the ink toward `--ink`:

   | Badge | Ink |
   |---|---|
   | teal | `color-mix(in srgb, var(--teal) 83%, var(--ink))` |
   | gold | 86% |
   | muted | 92% |
   | red | the new `--red` |

   The table's opaque badge background (`table.module.css` ~427) must be modelled in the test.
3. **Night surface:** add `color: var(--ink)` to `[data-surface='night']` in `tokens.css`, so the result card's names are legible in the light theme.
4. **Lite parchment island.**
   - Extract `luminance` / `contrast` / `tokensOf` from `packages/ui-kit/src/theme/tokens.test.ts` into a non-test module (e.g. `theme/contrast.ts`), exported through a testing subpath.
   - Add a contrast test under `apps/lite/web` that reads `lite.module.css` `.ticket` and asserts AA on `#f0e9d9` and `#fbf7ee`.
   - Fix the name input's placeholder (`lite.module.css` ~370, 3.44:1) to reach 4.5:1.
5. **`tokens.test.ts`:**
   - empty `BELOW_AA` (keep the guard);
   - `TEXT_PAIRS` uses `--red-ink` on `--red-fill`;
   - add a 3:1 non-text check for `--red-fill`;
   - add a composited-tint badge test, including the table's opaque mix;
   - assert that the night block declares `--red`, `--red-fill` and `color`.

**Tests:** the contrast tests above fail first. Fills stay pixel-identical: the fold button, "Rời phòng", sign-out, connection dots, the urgent timer.

**Shots** (real build plus the ui-kit playground), dark and light:
- a disconnected seat badge (playground scenario seat 2);
- a field error (auth);
- an error toast;
- the profile ledger with a loss;
- the lobby and room badges;
- the result card in light;
- the Lite name prompt with an invalid name.

### Task 3: Wardrobe — the pill clears the swatch; a locked original keeps its hint

**Why.** `inv-ui.md` items 1 and 2.

1. **Pill and swatch.**
   - Remove the `@media (max-width: 767px)` wrapper around the swatch `margin-top: 1.25rem` (`apps/normal-web/src/screens/wardrobe/wardrobe.module.css` ~448–453), so it applies at every width. Colour cards become about 20 px taller on desktop, and all colour cards stay one height.
   - e2e, in `wardrobe-layout.spec.ts`:
     - turn the phone-only block (~404–421) into `expectSwatchClearsPill`, called in `expectCardGrids` when the Màu da tab opens (1920×940, 1366×768, 900×1100, 375×812);
     - add `expectPillOnTop`: `elementFromPoint` at the pill's centre and both ends, inset by half its height, must hit the pill, on the worn hairstyle card.
2. **Owned variant and the locked original's hint.**
   - Keep "ticking only adds".
   - (a) `ItemTab` passes `hint: hintFor(member, …)` with each colour dot. A locked dot's `aria-label` and `title` become `"<name>, Chưa có: <hint>"`, in the same wording as `cardLabel`.
   - (b) When the box is ticked, the original is not owned and the card shows another member, render a `LockHint` line `"<original name>: <hint>"`. It goes between `.cardPick` and `.colourDots`, outside the pick button (a new `familyHint` prop on `ItemCard`).
   - Tests: extend `WardrobeScreen.test.tsx` (~814–861) and `cards.test.tsx` (~240). Fix the exact-name dot assertions this changes.

**Shots:** the Màu da tab and the hairstyle tab, at 1920×940, 1366×768 and 375×812.

### Task 4: Table and lobby — scrim edge, room-name tooltip, the narrowest ticket, 320 px

**Why.** `inv-ui.md` items 3–5, plus the 320 px sideways scroll it found.

1. **Scrim.**
   - In `packages/ui-kit/src/screens/screens.module.css` (~139–141), the scrim becomes `radial-gradient(50% 50% at 50% 50%, …)` (closest-side), transparent at all four edges.
   - e2e, after `shot(page, 'room-result-desktop')` (`normal.spec.ts` ~411):
     - sample the pixels 3 px either side of the overlay's content-box edge (x≈32);
     - assert a brightness difference of 3 or less;
     - repeat in light (`document.documentElement.dataset.theme = 'light'`) and take a light screenshot.
2. **Room-name tooltip.**
   - `RoomList.tsx` ~92: drop the static `title`.
   - On `onMouseEnter`, set `el.title = room.name` only when `el.scrollHeight > el.clientHeight + 1`; remove it `onMouseLeave`.
   - Replace the `RoomList.test.tsx` (~83–86) assertions: no title by default; a title when truncated (mocked heights); none otherwise.
   - Lite shares the component.
3. **The narrowest ticket.**
   - In the busy-lobby block of `normal.spec.ts` (before the phone switch, ~429), loop over widths 656 and 976 at 900 tall:
     - assert the narrowest ticket is ≤ 305 px;
     - `expectNoSidewaysScroll`;
     - `expectNoTextOverlapDown`;
     - a screenshot.
   - No new account.
4. **320 px.**
   - At 320 px the lobby scrolls 14 px sideways; the "Tạo phòng" button in the section heading causes it.
   - Fix the heading so it wraps or shrinks, then assert no sideways scroll at 320×640 in the same test.

**Shots:** the result card in dark and light at 1920×940 and 1366×768; the lobby at 656, 976 and 320.

### Task 5: Hair and outfit pictures' redrawn skin takes the skin colour

**Why.**
- Under brown and deep tones, the forehead shows cream specks and a light jagged line along every hairline (spiky, neat and curly the most): `scratchpad/cream/hairline-deep.png`.
- The royal robe's and the Tết áo dài's slippers (f and m) show a cream instep: `scratchpad/skinline/royal-ankle.png`.
- Cause: these pictures repainted some of the body's skin — the forehead between strands in the hair's shadow, the instep inside a slipper, skin through a cuff, a slit or a collar.
  - The ingest's body-skin rule (`extract.mjs` `bodySkinRule` / `applyBodySkinRule`) only drops redrawn skin that touches skin the layer leaves bare.
  - These pixels sit in the hair or outfit layer, which no skin colour reaches.
- The art must not change (Global Constraints), so the fix is masks plus one tint mode.

**Design:**
1. **Pipeline:** each real hair `L60` and v4 outfit `L40` gets a **skin** mask, `<layer>_skinmask@1x/@2x.png` with `masks.skin` in the manifest. It holds the layer's redrawn skin. A pixel is in when:
   - the body beneath is skin. The body is the `cutOn` body for an outfit, or the gender's body L30 ∪ its neutral face for hair, using their skin masks at ≥ 128;
   - and the pixel reads as skin by the body's own rule (`SKIN_MASK`: C* ≥ 8, and ΔE ≤ 22 to the body's seed `baseSkinColour`, or hue 44–100° with L* ≥ 50). For hair, extend the hue window down to the pink of skin in shadow; measure it (the prototype's misses are the pink patches between the hime and bob bangs);
   - and the pixel is at least `GAP` ΔE from every colour of the layer's own palette, k-means (k = 12) over its solid pixels lying over no skin. This keeps platinum and orange hair, gold and tan cloth out: the wavy style gets an empty mask by design.
   - **Outfits** additionally get a morphological opening (erode 1, dilate 1, within the candidates) and keep only pieces of at least 40 px @2x. Thin trim edges drop out; compact patches stay (insteps, skin through a cuff, slit or collar).
   - **Edge blends** (strand tips mixing hair and cream) may get a soft value: the skin share from projecting the pixel between its nearest pure neighbour and the skin beneath. The mask's alpha carries the share.
   - Prototypes: `scratchpad/layerskin-proto.mjs`, `layerskin-proto2.mjs`.
2. **Hair masks:** a hair layer's **hair** mask becomes its ink × (1 − skin share), so a hair colour no longer paints redrawn skin. Re-cut every hair layer's masks.
3. **Tint mode:** a new `TintRef` mode `'ratio'`, in `packages/ui-kit/src/avatar2d/recolour.mjs`, exported and typed in `recolour.d.mts`.
   - It takes the colour's hue and saturation, like `recolour`.
   - Lightness becomes l × (colour lightness ÷ `meanL`), clamped, instead of `recolour`'s additive shift. Additive shifting clamps shaded skin on a deep tone to black and left dark dots along hairlines (`scratchpad/lskin/cmp-hair.png` vs `cmp-hair-ratio.png`).
   - Blended by the mask like the others.
   - The body's own skin keeps `recolour`; this is not a change to the approved body look.
4. **Server:** `deriveTint` adds a set `layerSkin = { meanL: <body skin meanL>, files: [every hair L60 and outfit L40 file whose masks.skin is non-empty] }` (per body; files are only membership). Add it to the types in `bodies.ts`, `apps/normal-web/src/api.ts` and `packages/ui-kit/src/avatar2d/types.ts`.
5. **Kit:** `layersFor` adds `regionTint(file, body.tint?.layerSkin, skinColor, 'skinmask')` with `mode: 'ratio'`:
   - on the outfit layer, after its own colour tint and before its skin-line shade;
   - on the hair front layer, after its hair tint.

   No job when no skin colour is set. `tinted.ts` dispatches `'ratio'`, and `tintKey` already carries mask + colour + meanL.
6. **Checks (C11):**
   - on a hair or outfit layer, skin shares no pixel ≥ 128 with hair, tint or skinLine;
   - a real hair L60 or v4 outfit may have an empty skin mask; it is not required.
7. **Sheet:** the review sheet's toned cards apply the layer skin at the same tone (`sheet.mjs` `layerReader`). Re-render `docs/avatar-2d-sheet.png`.
8. **Docs:** a short §4.4.1 paragraph in `docs/avatar-2d.md`, and the tint spec amendment line.

**Tests** (fail first):
- `ratio()` unit tests: light tones unchanged within rounding, deep darker, the hue taken from the colour, mask blending, a `meanL` of 0 is a no-op;
- a synthetic layer-skin mask: a cream patch over skin is in, an orange hair the colour of skin is out by palette, a white cloth (C* < 8) is out, a thin 1 px trim line on an outfit is out;
- `layersFor` order and mode;
- `deriveTint` `layerSkin`;
- C11 overlap failures;
- a pipeline test that every real hair L60 and outfit L40 mask is cut and listed.

**Acceptance** (measure with the prototype scripts, adapted):
- at `#643e2b` and `#9c6140`, the count of light cream pixels in each hairstyle's hairline band (L* ≥ 62, C* 8–40 in the deep composite, method of `scratchpad/find-light.mjs`) drops by at least 80 % for every style except wavy;
- the slipper insteps of the royal robe and the Tết áo dài (f, m) read as the skin tone;
- at the natural tone, every composite is byte-identical to before (masks only);
- `avatar:check` is clean.

**Shots:**
- the real-build wardrobe at deep and brown, for all eight hairstyles (head crops) and for the royal robe and the Tết (feet);
- the same at natural, as no-change proof.

### Task 6: Docs

- **`docs/known-limitations.md`:**
  - remove the four fixed entries: the cash-out double credit, `--red` below AA, the badges, the Lite parchment test;
  - update "The chibi stands in one pose…" (outlines are now shaded; redrawn skin in hair and outfits now takes the tone).
- **`docs/ui-kit.md`:** the Known gaps and the tokens (`--red-fill`).
- **`docs/bug-log.md` §7:**
  - mark each open note fixed, with commits;
  - add the light-theme result-name bug and the 320 px scroll as found and fixed;
  - add a short "Plan 20" block listing what was fixed and the out-of-scope items with their reasons.
- **`CHANGELOG.md`:** a Plan 20 section in the style of Plan 18 and 19, with the merge hash filled in by the controller after the merge.
