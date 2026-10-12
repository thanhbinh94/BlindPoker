# Lessons learned

This file keeps the rulings each plan made and the lessons behind them. Until now they were spread over the bug log,
the known limitations, the CHANGELOG's deviation lists and a ledger per plan that is deleted when the plan finishes.
Read it before you write a plan. Add to it when a plan merges.

Sources: the plan ledgers that survived (Plan 21's in full; Plans 16–20 in part), `docs/bug-log.md`, `CHANGELOG.md`,
`docs/known-limitations.md`, `docs/ui-kit.md`, `docs/avatar-2d.md`, the git history, and the working notes kept between
sessions. Where a merge hash is given, it is the commit on `main` (called `master` until 2026-10-11).

---

## 1. The rule

Every plan that merges appends two things here, in the docs commit that fills in its merge hash:

1. **Its rulings, word for word, in ledger order.** Each is one line in the form
   `Ruling N: <what> — <why>. Costs if wrong: <…>`. A ruling with no stated cost is copied as it stands and marked
   that way; do not invent a cost afterwards.
2. **Its lessons.** Put each one under the right heading of §2 (toolchain, engineering, process, product) with the
   plan's name. If it is specific to the plan, put it in the plan's own block in §4.

New plans go at the top of §4, in the shape §3 gives Plan 21: what it built, its rulings, what the pre-flight and
final reviews found, how they were settled, and its residuals. The SDD ledger in `.superpowers/sdd/<plan>/`, like the
session's scratchpad, is deleted with the worktree. This file stays.

---

## 2. Lessons, grouped

### 2.1 Toolchain and environment

- **`pnpm` is not on PATH in Claude Code's Bash tool.** Use `export PATH="$PATH:$(npm prefix -g)"` first. pnpm was
  installed with `npm i -g pnpm`, because corepack needs admin rights. Every early session lost time rediscovering this.
- **Bash heredocs fail** on long bodies with single quotes ("unexpected EOF while looking for matching" quote). Write
  files with the Write/Edit tools, then run them. The Write and Edit tools have a trap of their own: a backslash-u
  escape typed into them arrives as the real character (see "Escapes through the tools" below).
- **Backticks inside a double-quoted `node -e "…"` are command-substituted by bash.** An edit containing backticks
  went wrong this way during the 2026-09-28 layout audit. Use the Edit tool.
- **Escapes through the tools.** The Edit tool turns a typed `\uXXXX` into the real character, and `\\u0300` stays two
  backslashes. Bash also eats `\\` before sed or perl sees it. A literal backslash escape for U+0300 (a backslash,
  then `u0300`) was finally written with `perl -pi -e 's/\x5c\x5cu0300/chr(92)."u0300"/ge'` (2026-10-01).
- **perl and UTF-8 (2026-10-11).** `perl -0pi` that splices a *decoded* string (`<:encoding(UTF-8)`) into a byte-read
  `$_` upgrades the whole file and double-encodes every non-ASCII byte. Commit `71b412d` shipped a mojibake'd
  `CHANGELOG.md`, and `9be001c` repaired it. If you must splice, read the snippet with `<:raw` and match anchors as
  bytes (`\xE2\x80\x94` for —). Vietnamese legitimately contains `â`, so `grep -c â` is no test for mojibake: read a
  heading back.
- **PowerShell 5.1 has no `&&`.** Use `A; if ($?) { B }`. Piping a command into `Select-Object -First N` ends it early
  and loses its exit code, so write output to a log and read the log. The PowerShell tool has reported exit 1 after a
  successful `stop.ps1`. The script prints its warning on stdout and ends `exit 0`, so the cause is unconfirmed (a
  truncated pipeline such as `| Select-Object -First` would do it). Read the output (`Đã dừng.`), not the exit code.
  `curl` there is an alias of `Invoke-WebRequest`, so use `curl.exe`, which works in both shells.
- **Playwright under pnpm 9 (Plan 21 gate).** `pnpm --filter @bp/normal-web e2e:ops -- --project=…` passes a literal
  `--` to Playwright, which then runs the whole pack. Pass filters with no `--`, or use
  `pnpm --filter @bp/normal-web exec playwright test -c <config> …`.
- **`pnpm --filter @bp/tooling test` matches nothing.** `tooling/` is a Vitest project in `vitest.workspace.ts`, not a
  workspace package. Plan 21's own Task 10 amendment named this command. Use
  `pnpm exec vitest run --root . tooling/arch`.
- **The avatar scripts have no root alias.** `pnpm avatar:check` fails ("Command not found"; the Plan 21 gate log
  shows it), so run `pnpm --filter @bp/normal-web avatar:check`. The root `avatar:assets` script points at a Plan 8
  script that no longer exists.
- **`pnpm lint` in the main checkout also lints `.worktrees/*`** (Plan 15), and fails there on the react-hooks rule
  lookup, because `eslint.config.js` does not ignore `.worktrees/`. Remove merged worktrees before the gate on `main`,
  or lint inside the worktree.
- **`git worktree remove` on Windows** refuses a worktree with untracked or ignored content (`node_modules`), and
  sometimes leaves "Directory not empty" behind. Check `git -C <wt> status` is clean, then
  `Remove-Item -Recurse -Force <wt>` and `git worktree prune`.
- **Never `git commit -a` in a worktree while an implementer subagent is working there.** In Plan 7 it swept the
  subagent's staged files into the controller's commit. The fix was `git reset --soft HEAD~1`,
  `git restore --staged <their files>`, recommit, and re-`git add` theirs.
- **Never run two commands that write `assets/avatar-src/registry.json` at the same time.** In Plan 19 one overwrote
  the other's registry.
- **The in-app browser pane is no tool for screenshots.** It hung on `file://` in Plan 14, and its captures are flaky.
  Use Playwright from `apps/normal-web`, where `@playwright/test` is installed.
- **The brainstorming visual-companion server stops itself when idle.** Before you point the user at its URL, check
  that it is alive (`server-info` present, `server-stopped` absent). Restart it with the same `--project-dir` and it
  reuses the port, so the user's open tab reconnects by itself. Mockups persist in `.superpowers/brainstorm/`.
- **Claude in Chrome and ChatGPT (Plan 12, the art loop).**
  - Extension disconnects and 45 s CDP timeouts are transient: wait about 30 s and retry.
  - ChatGPT keeps a draft across new chats, so clear it first. Insert the prompt with
    `execCommand('insertText')`, not keyboard `type` (and never a `\n` in `type`). Wait 2 s in a separate call, then
    click send only once the attached picture's thumbnail exists.
  - One asset takes about 2.5 minutes. The working procedure is `docs/avatar-2d.md` §10.3.
  - A CAPTCHA or an image limit means stop and tell the user.
- **Subagent plumbing changes.**
  - In Plan 7 the SendMessage tool disappeared mid-session, so fix rounds went to fresh agents briefed in full.
  - Through Plan 16, subagents could not write report files, so reports came back as text and the controller saved
    them. From Plan 17 on, implementers could write files (screenshots) in the worktree, but reports still come back
    as text.
- **Slow tests on a busy machine.** `avatar-registry-verify` runs the real pipeline, and its default 5 s timeout
  failed when the machine was busy. It has 60 s per case.
- **Environment facts, not decisions:**
  - There is no Docker daemon, so the Normal image has never been built.
  - The suite has never run against a real PostgreSQL (`TEST_DATABASE_URL`).
  - There is no ARM machine.
  - Each of these is a row in `docs/known-limitations.md`.

### 2.2 Engineering

**Rendering and motion**

- **Chrome sorts 3D layers wrongly when a fold is diagonal.** The squeeze peel (Plan 21) is 2D: clip-paths and a
  translate, never `rotate3d`. The face that was under the card slides along the peel, upright, rather than being
  mirrored. The decision is in `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md` §2. The prototype
  that settled it (v10) lives in `.superpowers/brainstorm/`, which is gitignored.
- **Measure in a layout effect, with the entrance animation off.** A dealt card reads the deck's box and its own in
  `useLayoutEffect` (`useDealFrom`), with `style.animation = 'none'` for the read. The wrapper's fade-in starts turned
  and raised, and would skew the box. The measurement is the card's arrival and is never repeated.
- **Latch per-mount values.** `Card` used to read `delayMs` live on every render. On a full table, the "dealt just now"
  window closed while the last cards still waited, and the cards jumped. It now latches the value with
  `useState(delayMs)`, and `--deal-delay` is set once (Plan 21, Task 5 review).
- **Key per hand.** Cards are keyed `${handId}:${i}` and the board by hand, so the next hand's cards are new
  components that deal afresh, even when the count is the same as last hand's.
- **Restored state must not animate.** A hand rebuilt from a snapshot is `restored`, and its cards fade in where they
  lie. Fixtures and frozen layout scenarios declare `restored: true` with null arrival stamps
  (`packages/ui-kit/src/test-fixtures.ts`, `packages/ui-kit/playground/scenarios.tsx`), so tests and measurements see
  cards at rest.
  A test about dealing opts in.
- **3D needs a clean wrapper.** No `filter`, `opacity` or `overflow` on a card's flipper
  (`packages/ui-kit/src/table/table.module.css`): any of them flattens the 3D below.
- **An overhanging child can grow a scroll area.** The peel's face overhangs the card mid-peel. Plan 21 measured
  `.roomMain`'s scroll height before and during a peel (621/621, 505/505) before deciding that no containment CSS was
  needed. Measure; do not assume either way.
- **A reserved height is a contract.** The create dialog's `.modeFields` reserve (14rem, Plan 16 No12) keeps the
  dialog's edge still between Hold'em and Blind. Plan 21 raised it to 19.5rem for one checkbox, and the dialog
  scrolled inside itself at 1920×940 with dead space in Hold'em. The fix (Rulings 24–25) was to put the box in an
  existing row's slack and go back to 14rem. Look for slack before you grow a reserve.
- **A phone `@media` placed before the base rules it overrides is dead.** `RoomHeader`'s was, until the layout audit L1.
- **One CSS-module file is one namespace.** The sign-in `.card` and the inventory `.card` in
  `apps/normal-web/src/screens/normal.module.css` merged rules (layout audit L3); one became `.authCard`. Before you trim a member of a grouped selector, check who
  else is in the group.
- **`prefers-reduced-motion` is global** (`packages/ui-kit/src/theme/global.css` turns off every animation and
  transition). Every moving class
  must still have a test listing it, and holds such as the reveal hold must not wait when nothing moves.

**Input**

- **Read the flick from coalesced events.** A real Playwright flick did not open the card when its speed was taken
  from "the last six samples" (Ruling 19). The speed now comes from the pointer's real and coalesced positions
  (`getCoalescedEvents`) over the last 100 ms, on the events' own clock (`event.timeStamp`). A 40 ms pause ends the run.
  The cost: a device that coalesces nothing reads a single quick move after a rest as no flick (a known limitation).
- **A cancelled pointer always snaps back** (Ruling 20). The plan had wired `pointercancel` to the release handler, so
  an OS gesture, such as a phone's home swipe from the bottom edge where the cards sit, could open a card for good.
- **Implicit touch capture fires `lostpointercapture` from a child.** On Firefox and WebKit a touch starts captured by
  the element under the finger. When the card takes the capture, that child loses it, and the event bubbles. Ignore a
  lost capture whose `target` is not the card itself, or every touch peel drops (Plan 21, Task 6 fix round 2). This
  is unit-tested only: Firefox and WebKit have never driven it.
- **CDP touch drags need pacing.** A burst of `Input.dispatchTouchEvent` moves makes the next tap lose its click, even
  on empty felt. `touchDrag` in `apps/normal-web/e2e/ops/04-blind.spec.ts` paces moves 16 ms apart and rests 64 ms
  before the lift.
  That is a harness adaptation, not a product defect.
- **Playwright's `setOffline` does not drop an open WebSocket.** Close the tab to simulate a lost connection (ops run 1).

**Protocol and money**

- **A client's "I did X" message must be idempotent and tolerate arriving late** (Plan 21, `REVEAL`):
  - a repeat is a no-op;
  - after `HAND_COMPLETE`, a seated player's `REVEAL` gets an `ACK`, not a "Bạn không tham gia ván này" toast;
  - outside a squeeze round the room answers `ACK` without calling the engine, because a submit would re-arm the
    hand's timers;
  - a `REVEAL` lost with the socket is sent again once, after the reconnect's snapshot.
- **When the server forces a value, validate the rest as usual and test both paths.** `blind.squeeze` forces the
  20 s timer whatever the client sends. The tests reject `'abc'`, `null` and `1.5` on a plain room, force the timer on
  a squeeze room, and refuse a Hold'em config that carries `blind.squeeze`.
- **A cast is acceptable when the runtime check is on the same path. Try a rewrite before mandating it.** In
  `packages/core/src/protocol/validate.ts` an `as number` was accepted at Task 2's gate (Ruling 15): the reviewer's
  cast-free version did not typecheck, and `isInt`/`includes` guard the value on the same path.
- **Never `ACK` a request that did nothing.** Bug 3: Start with only bots ready answered `ACK` and opened no hand.
  The server now refuses with `NOT_ENOUGH_PLAYERS`.
- **Money writes that may be retried carry a key** (Plan 20). A cash-out that committed but lost its reply was
  credited twice on retry. `ledger.apply(entries, meta, { key })` claims the key in `ledger_keys` inside the same
  transaction. The table is emptied at server start, because rooms live in memory, so one database must have exactly
  one server.
- **Settle before closing** (Plan 16). A hand that has just ended is settled before a room closes or the server shuts
  down (`wrapUp()`), and a hand that cannot be settled is voided with its carried-in pot restored
  (`voidUnsettledHand`). A seat counts as in the hand until settlement, so a host cannot kick it before then.
- **Keep the "seen" memory honest.** Bug E1: `advanceExpressionMemory` recorded the hand id on every render, so by the
  time a hand completed the reaction was skipped, and happy and sad faces never showed for a hand watched live.
  Record only when you act.

**Data that lives in two places drifts**

- Bug 7: a hat's `hidesHairFront` lived both in the art manifest and in `apps/normal-server/data/items.json`, and
  they disagreed. The
  catalogue loader now refuses to start on a mismatch.
- Bug 6: a withdrawn item stayed in the catalogue and in the daily draw.
- The server's `asset.clipsHair` is derived from the manifest, not written by hand.

**Security, contrast and the browser**

- **A test that accepts a broken image proves nothing** (Plan 16, No15/No16). Normal's CSP refused the `blob:` images
  that Plan 13's tinting creates, so hair colour made the head vanish. The e2e passed because `toBeVisible` accepts a
  broken `<img>`. It now waits for `complete && naturalWidth > 0` on every layer.
- **Measure contrast on the real ground.** Plan 20's badge test modelled a flat `--bg`; the review found 4.46:1 on the
  page's real mesh under the room header. `[data-surface='night']` redeclared `--ink` without setting `color`, so
  inherited text kept the page's dark ink (about 1.1:1). Firefox paints `::placeholder` at opacity 0.54 unless told
  `opacity: 1`.
- **Vitest empties CSS `?raw` imports.** The contrast tests need `test.css.include` in the Vitest config (Plan 20).
- **A `title` on text that is always there can be read twice by a screen reader.** Add it only while the text is cut
  and hovered (Plan 20).
- **A countdown inside a live region is announced every second.** The result card's live region holds only the
  title and the rows; the footer and countdown sit outside (Plan 17, R2-4).
- **A static scanner must count what it found** (Plan 7, `tooling/arch/security-static.test.ts`). The first
  secret-logging scanner used a hand-rolled lexer that treated everything after the first backtick as template text.
  It erased 47 of 67 logging calls while the suite stayed green. It now walks the TypeScript syntax tree and asserts
  how many call sites it sees.
- **Test a detector against the user's own bug first** (Plan 16, No11b). The first text-overlap rule shrank each box
  by 20 % of the font size, and missed exactly the countdown the user reported. It now insets each box by the
  line-box rule.

**Tests that cite and pin**

- **The docs are tested.** Every citation in `docs/acceptance-checklist.md` and `docs/test-matrix.md` must occur
  verbatim in the cited file, and the row counts are pinned in `tooling/arch/acceptance-links.test.ts` (today 64 + 3
  and 43 + 10). When the matrix check was first turned on, ten rows were wrong (Plan 7). Renaming a test or a string
  touches the docs in the same commit.
- **Locale parity is tested in three places.** A copy pass greps every old string across `packages`, `apps`, `docs`
  and `tooling`, and updates the e2e locators with it (`docs/copy-review-2026-10-10.md` §6). Historical records
  (CHANGELOG, bug log, old specs, plans and test runs) are not rewritten.
- **Flaky money checks** (Plan 16). An achievement can pay a moment after the hand settles, so a balance compared with
  the result card failed on lucky hands. Poll until the ledger sums to the balance, then take the achievement rows
  out before comparing.
- **The sign-up limit shapes the e2e suites.** The server allows ten sign-ups a minute per address. The rail check of
  bug 8 was folded into an existing spec, the busy-lobby case patches `ROOM_LIST` with `page.routeWebSocket` instead
  of registering players (Plan 17), and the ops pack registers through `registerPatiently`, which waits out a refusal.
- **Ops-pack habits** (ops run 1):
  - pre-action toggles share names with the action buttons, so match actions with `button:not([aria-pressed])`;
  - the next hand deals itself 5 s after a result, so sit out before leaving;
  - wait for `getAnimations({ subtree: true })` to be empty before measuring a dealt card.

**The avatar pipeline** (details in `docs/avatar-2d.md`)

- **Probe with the pipeline's own morphology** (hat-hair, `7841e1b`). The first hair clip used each column's lowest
  hat pixel. The nón lá's chin straps, about 8 px and diagonal, survived a circular opening and cut the side locks. A
  square-kernel probe would have hidden this, and the opus reviewer caught it.
- **A CSS mask that is still loading, or has failed, draws nothing.** Apply the clip only after the image has been
  preloaded (`useLoadedClip`).
- **A manual override of `verify` must re-run the pipeline's checks** (Plan 19: an overridden hairstyle then failed C13).
- **Generate from the original.** Generate every item and expression from the *original* base picture, in a new
  ChatGPT chat per picture. Save with the download button, never a screenshot. End every prompt with the size-lock line.
  ChatGPT redraws at another size and draws a bald chibi face shorter than the reference, hence C12's chin tolerance
  of 12.
- **Platinum hair on cream skin cannot be cut apart.** Generate it in cool silver and ingest with `--recolour-to`
  (Plan 19, wavy).
- **The pipeline's eye-line check misreads dark-haired bases.** It reported M01 at 39 %; that FAIL was a false alarm.
- **The source pictures exist in one place only:** the main checkout's gitignored `assets/avatar-src/`. Registry
  re-ingest needs them, so the user was advised to back them up.

**Deploying**

- **The host serves the main checkout's `apps/normal-web/dist`.** `pnpm build:normal` there changes what players
  download immediately, so restart the host right after building.
- **After a deploy, an old tab asks for chunks that no longer exist** (bug 4). `lazyScreen` reloads once per 30 s, and
  `UpdateBoundary` shows "Đã có phiên bản mới" instead of a blank screen.
- **A host started with `Start-Process -NoNewWindow` dies with its console, silently** (R2-5, twice). It now runs as
  the scheduled task `BlindLuckPoker-Normal`. Even so, check `/health` before you assume it is up: it stops when the
  user logs off.
- **`sslmode=require` draws a `pg` deprecation warning.** The host's `DATABASE_URL` uses `sslmode=verify-full` (T8).

### 2.3 Process

- **The pre-flight review earns its cost.** On every plan it ran, an independent opus review of the plan against the
  real code and screens found defects before any code was written:
  - Plan 16: 14 defects, among them a viewport of 1920×960 where the user's is 1920×940, and an overlap detector that
    would have missed the user's own bug;
  - Plan 17: 16 amendments;
  - Plan 20: 3 blockers, 7 important, 7 minor;
  - Plan 21: 2 blockers, 13 important, 14 minor.

  Its amendments are binding plan text (Plan 16 ruling).
- **Reviewers approve code that looks wrong.** Earlier rounds shipped UI that the reviewers had approved from the code
  and that looked wrong on screen; Plan 14 made screenshots a rule. Every UI task ships real-build screenshots at
  1920×940, 1366×768 and 375×812, and the reviewer opens them. The user put it this way:
  *"vì đây là big plan nên hãy self-review đảm bảo hạn chế rủi ro nhất có thể"* and *"xong thì báo tôi"*.
- **One fix wave.** After the final whole-branch review, send one dispatch with everything that must change, then a
  re-review. Minors parked during the tasks ride in that wave or stay parked, recorded.
- **Rulings, not stalls.** A choice the plan did not make is ruled, ledgered with its cost, and reported. Twenty-eight
  of them carried Plan 21 from the plan to the merge, and the user read them once, in the final report. Deviations from
  the user's own answers (the deck's position, Ruling 17) are reported as deviations, not buried.
- **Report once.** When the user says "xong thì báo tôi", run to the end (gate, merge, deploy) and report once: what
  shipped, the gate numbers, every ruling, the deviations, the residuals, and the hand checks left to the user.
- **Bug reports.**
  - A reported bug is logged in `docs/bug-log.md` first, with options (a)/(b)/… and a recommendation in bold, and is
    fixed on the user's word.
  - For sweeps the user said *"có, hãy fix các bug còn tồn đọng đi. không cần hỏi lại"* (Plan 20) and *"Đợt 2 làm
    theo đề xuất của bạn luôn"* (Plan 18). On such a sweep, do not ask again.
  - Rule changes, roadmap features and trade-offs with a recorded reason stay out of a bug sweep, each listed with
    its reason.
- **Review the flavour text, not only the instructions.** The first Vietnamese pass (Plan 18, about 100 lines) cleaned
  up instructions and terms. Titles and item names were still literal translations until the user asked what "Tay
  nóng" (hot hand) was meant to be: *"có những điểm về ngôn ngữ tiếng việt không phù hợp, không tự nhiên (ví dụ: Tay
  nóng?)"*.
  - Ask of every string: would a Vietnamese player say this?
  - A copy pass needs a second native read. The same-day review of the 2026-10-10 pass changed nine more lines and
    corrected one of the first pass's own (`errors.NOT_IN_ROOM`).
  - A name that matches its English but misdescribes the item ("Khung sáng lập" for a one-year login reward) is the
    user's call; it became "Khung một năm" (`628ebb7`).
- **The full gate runs on the branch's final tree, with every end-to-end suite on built bundles.** If `main` has moved,
  merge it into the branch first; when it has not, that tree is identical to what the `--no-ff` merge produces. Plan
  21's final review caught that the e2e suites had not been run on the branch, and that the result card's visible
  window had shrunk without anyone noticing.
- **Keep one writer per worktree.** A reviewer may read while another task's implementer writes disjoint files, but a
  fix round waits until the implementer reports (Plan 20).
- **"Docs must be true" is a ruling, not a nicety** (Plan 16). A doc that cites, measures or promises something wrong
  is fixed in the same plan.
- **The real-device check is the user's step.** List exactly what to try, with the ledger reference (Plan 21: peel by
  touch, a quick flick then a quick tap on "Lật", iOS Safari).
- **Pick the model per task.** Use haiku for removals, sonnet for small cross-package tasks and most reviews, and opus
  for queue re-entrancy, detectors, layout, accessibility, the pre-flight and the final review (Plan 16 ruling).

### 2.4 Product

- **Points only, permanently.** Nothing is purchasable and nothing converts (requirement.txt §3, spec §33). Every
  money path is pinned by conservation tests: `Σ balances + Σ sink rows`, and soak runs that create or destroy no point.
- **Normal and Lite stay separate products on one codebase.**
  - Lite has no password, no wardrobe and no per-account avatar.
  - It ships only the body, bot, default-hair and default-outfit layers.
  - It refuses a second instance on one data directory.
  - Shared code lives in the packages, never copied, and the arch tests hold the dependency graph.
- **What the user rejected, and why it matters:**
  - **Plan 8's 3D avatar** (Quaternius CC0, three.js). It shipped, then gave way to the user's wish for a chibi (CR1).
    The free packs were small approximations, and a cold first face took about 3 s.
  - **Plan 10's hand-drawn SVG chibi.** It was stopped at its style gate (2026-09-09) with *"xấu quá"*. The gate cost
    one plan's design work and no shipped code. Since then, AI-generated art goes through a style gate before the rest
    is generated.
  - **three.js and anime.js for the card motion** (Plan 21 spec §1). Three.js is real 3D, too heavy for a 2D flip;
    anime.js only sequences what the browser already does. No library was added.
  - **Vercel for hosting** (Plan 9). WebSockets and a same-origin cookie do not fit it.
  - **A per-device "squeeze" switch in Settings** (Plan 21, Q6). The user made squeeze a mode of the table instead.
- **The user's screen is 1920×940.** Desktop layouts are checked there, and also at 1366×768, 1536×730 and 1280×720.
  The phone is 375×812.
- **During the art transition, the LAN host deliberately kept the previous build.** Placeholder art would have looked
  worse to the user than the old 3D (Plan 11).
- **The product name changed twice:** "Just a Normal Poker" (2026-09-07), then "Blind Luck Poker" (2026-09-28,
  `22d1905`, which the user picked from a short list). Internal ids never changed, so sessions, databases and Lite
  installs carried over.

---

## 3. Plan 21 — the worked example

**Cards dealt from a deck and turned, the showdown's lift, and the Blind squeeze mode.** Merged `440997e`
(2026-10-09), docs `7255d0a`. Spec `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md`, plan
`docs/superpowers/plans/2026-10-09-plan21-card-motion-squeeze.md`. The user asked: *"lập plan và làm luôn, xong thì báo tôi"*.
Base `c12bf90`, ten tasks.

- **Gate on the branch tree:** 2621 unit tests, e2e Normal 24, Lite 4, ops 34, avatar check 1560.
- **Deployed** with `-NoMigrate`. No migration, one additive protocol change.

### 3.1 How it ran

1. **Pre-flight scan** (controller). Every producer → consumer pair between tasks was checked against the plan. It
   found a `Card` ↔ `Deck` import cycle, a hook to lift out of `Card.tsx`, and four test-geometry points: Rulings 1–5.
2. **Pre-flight review** (opus): "proceed with corrections" — 2 blockers, 13 important, 14 minor. All of them were
   accepted and spliced into each task as "Amendments (pre-flight 2026-10-09)", then committed. In summary:
   - `pnpm typecheck` must pass at every commit, so the kit's types follow the engine in Task 1 (Ruling 7), and Hold'em's
     command switch handles `REVEALED`.
   - A `REVEAL` outside a squeeze round must not re-arm the hand's timers (Ruling 8).
   - A seat that leaves mid-squeeze is turned for, so it cannot hold the round.
   - The hand records arrival stamps and `restored`, and cards are keyed by hand.
   - The deal measurement must switch off the entrance keyframe, and the turn gets its own delay.
   - The lift waits for the river (Ruling 9).
   - `PeelCard` uses the spec's names, keeps stable callbacks and honours reduced motion. The viewer's cards stay
     `PeelCard`s for the whole hand.
   - The e2e waits for animations to end before measuring.
   - No new sign-ups in the default e2e suite.
3. **Per task:** a fresh implementer, a review (spec, then quality), fix rounds and re-review. Minors were parked for
   the final wave.
   - **Screenshots** (Ruling 6) for Tasks 5, 7 and 8 at 1920×940, 1366×768 and 375×812, opened by the controller and
     the reviewers.
   - **Fix rounds:** Task 5 (staggered restored hands, live delays), Task 6 (×2: cancelled pointers, coalesced
     samples, the child-capture guard), Task 7 (the countdown, the pill's height), Task 8 (the dialog's reserve), Task 9
     (assert the drag took), Task 10 (the RoomConfig wire type and exact matrix titles).
4. **Final review** (opus, `c12bf90..106c5d7`): "With fixes", no Critical. It found four Important items:
   1. The deal's span (24 cards × 120 ms ≈ 2.8 s) ate into the 10 s play-or-fold timer, and no ruling covered it. That
      became **Ruling 26**.
   2. The full e2e suites had not run on the branch, and the result card's visible window had shrunk from 4.1 s to
      2.8 s. The first part became the full gate after the wave; the second became **Ruling 27**, reported for the
      user to decide.
   3. A 3 px stage overflow on 375×812 squeeze tables, with F-12 weakened to `expectPageFits` and a "by design"
      comment. Fixed for pure-luck tables (the tray's wait line gave back 8 px, and F-12 asserts the stage again). The
      play-or-fold table's 11 px became **Ruling 28**, a documented limitation.
   4. No room-level test of `REVEAL` during a play-or-fold squeeze decision. Fixed in the wave.

   The minors it found: a late `REVEAL` toasting `NOT_IN_HAND` (now an `ACK`), a `REVEAL` lost to a socket drop (now
   re-sent once), the pill's focus loss, and duplicated predicates.
5. **One fix wave** (opus, `43440ff`), then a re-review (sonnet): all addressed, nothing new. Out of scope and
   recorded: a second socket drop in one hand loses the re-send (auto-play and the deadline cover it), and the deal-step
   cap added to the CHANGELOG deviations at merge.
6. **Full gate on the branch tree**, merge `--no-ff`, a docs commit with the hash, deploy, one report.

### 3.2 The 28 rulings, as ledgered

- Ruling 1: the deck anchor context lives in `packages/ui-kit/src/table/deck-anchor.ts` (`DeckAnchorProvider`, `useDeckAnchor`), imported by `Card.tsx`; `Deck.tsx` imports `CardBack` from `Card.tsx` — no `Card` ↔ `Deck` cycle — because an import cycle between two component modules is a lint/ordering hazard for no gain. Costs if wrong: one extra tiny module.
- Ruling 2: T5 already exports `useDealFrom(ref, dealt)` from `Card.tsx` (the deck measurement, used by `Card`); T6 consumes it and adds `CardFace`'s `hidden` prop — T6 may edit `Card.tsx` for that one prop only. Costs if wrong: a small cross-task edit.
- Ruling 3: `peel.test` asserts `Math.abs(fold.angle) ≈ π/4` for the bottom-right diagonal; the code computes `Math.atan2(u[0], -u[1])` (0 for the bottom edge). Costs if wrong: a mirrored band on diagonal peels, visible in the playground check.
- Ruling 4: `peelDirection` and `peelFrame.faceShift` normalise `-0` to `0`; `keepBeyond` returns the empty polygon when the clipped polygon's area is below 1e-6 (shoelace), so p = 0 and p = 1 read as "nothing"/"all" exactly as the tests expect. Costs if wrong: an off-by-sliver clip at the ends of the peel.
- Ruling 5: `PeelCard.test` sets `window.PointerEvent = window.MouseEvent` (jsdom has no PointerEvent) before rendering so `fireEvent.pointer*` carries `clientX/Y`. Costs if wrong: nothing — test-only.
- Ruling 6 (routine from memory): T5, T7 and T8 implementers also capture screenshots at 1920×940, 1366×768 and 375×812 of their UI (playground/table) into `<workspace>/shots/t<N>/`; T9 captures the real-build shots. Costs if wrong: a few minutes per task.
- Ruling 7: T1 also lands the kit's type-level follow-through (`ClientPhase 'SQUEEZE'`, `ClientSeat.revealed?`, the three reducer cases) so `pnpm typecheck` passes at every commit; T4 keeps the behaviour and tests. Costs if wrong: T1 touches two ui-kit files.
- Ruling 8: `Room.reveal` is a no-op (ACK, no submit) outside a squeeze round, rather than changing `HandRunner.submit`; the runner's `applyAutoFolds` turns an auto-fold seat during `SQUEEZE`. Costs if wrong: a late REVEAL could still reach the engine in DECISION of a squeeze room — where it is a legitimate reveal.
- Ruling 9: the lift waits `DEAL_MS + FLIP_MS` (960 ms) when the showdown lands within 1 s of the river (`ClientHand.showdownAt/boardAt`), and the result-card hold grows by the same — 1270 ms alone, 2230 ms after the board. Costs if wrong: a result card that opens ~1 s late on Hold'em all-in run-outs.
- Ruling 10: "dealt" = arrived within `DEAL_WINDOW_MS` 1500 of the hand's `dealtAt`/`boardAt` (client-time stamps in the reducer); cards keyed by `handId:i`; in squeeze rooms the viewer's cards stay `PeelCard`s for the whole hand. Costs if wrong: a remount more than 1.5 s after the deal shows no slide (fine), a stamp drift on a slow device could skip a slide.
- Ruling 11: the deck sits above the board in the ring layout and in one row with the pot in the stack layout (phone), to keep the viewer's plate on screen (audit L1). Costs if wrong: the phone's deck is not "above the board" as the user chose; it is still on the felt beside the pot, which the same choice named. *(Superseded by Ruling 17.)*
- Ruling 12: names follow the spec where the plan drifted: `onRevealed`, `actions.revealCards`, `PEEL.snapMs` 200; `NOT_SEATED` kept for a spectator's REVEAL (as `action`); no `phase.squeeze` key (the `phase.*` namespace is never read). Costs if wrong: nothing user-visible.
- Ruling 13: the auto-play toggle is also offered on a pure-luck squeeze table (there it means "turn my cards at once"). Costs if wrong: one extra toggle on such tables.
- Ruling 14: the squeeze timer is drawn on the viewer's own plate (the decision phase shows no countdown today, so "như pha quyết định" has nothing to copy). Costs if wrong: a timer where the user did not picture one; a one-line CSS change to move it.
- Ruling 15: the brief's cast-free line did not typecheck (unknown past the squeeze skip) — the cast is accepted at this gate because runtime validation (isInt/includes) is intact. *(No cost stated in the ledger.)*
- Ruling 16 (Task 3, as ledgered): the plan-mandated dead try/catch in `Room.reveal` stays — "keep for parity with action". *(No cost stated in the ledger.)*
- Ruling 17: the deck sits beside the pot, under the board, in BOTH layouts (supersedes Ruling 11's ring placement). The implementer's probe (shots/t5/probe-*.txt) shows the deck above the board collides with the top seat's badges/hand-name line on every short ring (1366×768, 1536×730, 1280×720/800) and has 0–4 px clearance on full rings; in the pot's row at the pot pill's height the overlap set equals the no-deck baseline. Still mid-table (the user's choice was 'giữa bàn'); report it to the user as a deviation from 'phía trên các lá chung'. Costs if wrong: moving it back is the JSX order in PokerTable's centre plus the .deck size rule.
- Ruling 18: the round-robin deal stagger applies only to cards that are `dealt` (arrived just now); a restored or remounted hand keeps the old plain fade with no stagger (the implementer's concern 2: up to 3.1 s of staggered fade on a reconnect at 9 seats). Card captures its delay once at mount, so a `dealt` flag that goes false mid-deal cannot change a mounted card's --deal-delay. To be fixed in Task 5's fix round. Costs if wrong: a layout switch 1.5–3.6 s into a 9-seat deal shows the not-yet-dealt cards at once.
- Ruling 19 (Task 6, as ledgered): flick speed read over the last 100 ms rather than six samples — "accepted — a real Playwright flick did not open with six samples; the 0.9 px/ms threshold is unchanged". *(No cost stated in the ledger.)*
- Ruling 20 (Task 6 review): a cancelled pointer always snaps back (overrides the brief's wiring). *(No cost stated in the ledger; the risk it removes: `pointercancel` wired to release could open a card irreversibly on an OS gesture.)*
- Ruling 21: in a play-or-fold squeeze room the viewer's countdown stays until the viewer has DECIDED (not just revealed) — the 20 s covers both the peel and the decision; in a pure-luck room it hides once revealed. Costs if wrong: a countdown shown ~10 s longer than needed.
- Ruling 22: the Lật pill gets a minimum tap height of 28 px (the implementer measured 23 px). Costs if wrong: 5 px of plate space.
- Ruling 23: REVEAL is sent after the viewer's LAST card is up (spec §3/§5.3) — my Task 7 dispatch said the first; the implementer followed the spec, which is right. Costs if wrong: nothing.
- Ruling 24: the create dialog must not need an inner scroll at 1920×940 in any mode (as before Task 8) and Blind mode must not show an empty gap. The 'Nặn bài' control takes a free column of an existing Blind row (the timer's row: timer select, or a read-only '20 giây' when ticked | ☑ Nặn bài), its label carrying the 20 s note inline (no separate hint row; aria-describedby optional); .modeFields goes back to the smallest reserve that keeps Hold'em ↔ Blind steady. Costs if wrong: the hint sentence shrinks to a phrase.
- Ruling 25 (how to meet 24): the 'Nặn bài' checkbox sits under 'Số lượng bot' in the Wager | Bots row's slack, label text exactly 'Nặn bài'; its hint is visually hidden (screen readers via aria-describedby) and, when ticked, the timer's cell shows a read-only '20 giây · nặn bài' in place of the select (no empty half-cell); .modeFields back to the smallest steady reserve (≈14rem, re-measured); the dialog fits at 1920×940 without an inner scroll in both modes. Costs if wrong: sighted users see the 20 s only after ticking.
- Ruling 26: the deal's whole span is capped — the last card leaves the deck no later than DEAL_SPAN_MS = 1000 after the first: per-card stagger = min(DEAL_STAGGER_MS 120, floor(1000 / (cards − 1))) (6 seats × 2 cards keeps 90 ms; 8 × 3 gets ≈ 43 ms). Spec §4.1.2 assumed one card per step; the 10 s decision timer starts at the deal. Costs if wrong: big tables deal like a fast dealer rather than card by card.
- Ruling 27: the result card's shorter visible window (≈ 2.8 s on Blind tables, was ≈ 4.1 s) stays; handIntervalMs is a server pace shared by both modes — reported to the user for a decision. Costs if wrong: a result card the user finds too brief; one constant to change.
- Ruling 28: the 11 px stage scroll on a play-or-fold squeeze phone table is accepted as a documented limitation for this plan — the viewer's seat stays on screen and closing it needs a phone layout for the header or the seat (a design decision for the user). Costs if wrong: a phone user scrolls the stage 11 px on that one table type.

### 3.3 What it taught

- **The plan's own text can be wrong in ways only the code shows.** Ruling 11 placed the deck where the user chose,
  and Task 5's probe of real layouts overturned it (Ruling 17). Ruling 23 records a dispatch that contradicted the
  spec, and the implementer followed the spec.
- **A spec number written for one case breaks on another.** The 120 ms deal step assumed one card at a time, and the
  hand's timer runs during the deal (Ruling 26).
- **The cost line is what makes a ruling reviewable.** Every ruling with a cost could be checked in minutes by the
  final review. Rulings 15, 16, 19 and 20 were written inside task notes with no cost line, so state the cost every time.
- **Residuals belong with their measurements in `docs/known-limitations.md`:** the real-phone check, Firefox/WebKit
  capture, the uncoalesced flick, the 11 px phone scroll and the second `REVEAL` on a layout switch. The decision
  handed to the user (Ruling 27) and the deviation (Ruling 17) were in the final report.

---

## 4. Plan history, newest first

Each block gives what the plan built, its key rulings and decisions, its residuals, and its merge commit. Plans 16–20
quote their surviving ledgers. Earlier ledgers were deleted with their workspaces, so those blocks come from the
working notes and the CHANGELOG. The CHANGELOG has no sections for Plans 9, 10, 12, 13 and 14, and marks 7, 8 and 11
"unreleased (branch …)" although all of them merged. The hashes below come from `git log --merges`.

### 2026-10-11 — Vietnamese copy pass #2 and the random room name — `d5e9e45`, follow-up `628ebb7`

- The user asked *"check đa ngôn ngữ … cần sửa toàn bộ"* and *"khi tạo phòng thì random luôn tên phòng"*.
- **Copy:** 711 keys read, 31 changed (`docs/copy-review-2026-10-10.md`): "Tay nóng" → "Vận đỏ", "Mời nặn bài — hết giờ sẽ
  tự lật", "Chọn sẵn trước lượt", "Bạn không còn ở trong phòng", "Máy chủ sắp tắt", "Mất kết nối"… English was untouched.
- **Room names:** `randomRoomName(lang, rng?, avoid?)` (vi 5 × 31, en 24 × 4, ≤ 30 characters, no "Bàn Cầu"), plus a 🎲
  "Tên khác" button.
- **Gate:** 2637 unit tests, e2e 24, Lite 4, ops 34.
- `items.frame_founder` was then renamed "Khung một năm" / "One-year frame" on the user's decision (`628ebb7`).
- **Lessons:** review the flavour strings; get a second native read; perl encoding (`71b412d` → `9be001c`).
- **Open:** no e2e drives the 🎲.

### Plan 21 — card motion and the squeeze mode — `440997e`

See §3.

### 2026-10-06 — a covering hat keeps the hair under it — `7841e1b` (docs `4bf949c`)

- The user's report: *"khi đổi item mũ, thì có item bị lộ tóc, trông không tự nhiên"*.
- A sixth mask kind, `hairClip`, is cut from each covering hat (beanie, beret, nón lá, in every colour). The kit draws
  both hair layers through it as a CSS mask, applied only once it has loaded.
- The top hat, visor, crown and party cone are deliberately unclipped: clipping the top hat cut the ponytail flat.
- **Lesson:** probe with the pipeline's own circular morphology (§2.2).

### Plan 20 — the open bugs — `eb2fcc0` (docs `d90b70b`), deployed with migration `0003_ledger_keys`

- The user: *"có, hãy fix các bug còn tồn đọng đi. không cần hỏi lại"*.
- **Built:**
  - keyed ledger writes (`ledger_keys`, emptied at boot) with frozen seats for pending cash-outs;
  - `--red` split into ink and fill, and badges and placeholders at AA;
  - light result-card names; the scrim's edge; the 320 px lobby;
  - per-layer skin masks painted with a `ratio` tint (hairline specks and cream insteps gone);
  - three art seams mended.
- **Rulings (surviving ledger):**
  - Pre-flight 3 blockers / 7 important / 7 minor, folded in; the order is T1…T6, with T2 before T4.
  - "a T1 fix round waits until T2's implementer reports (one writer at a time)".
  - The T5 fix round takes both art seams "in scope under 'fix all remaining bugs'", as "ruled exceptions to the
    masks-only constraint".
  - "accept HAIR_BODY_LINE.tipReach 3".
  - The final dispatch prunes `ledger_keys` at boot in both editions and pushes `BALANCE` after a failed buy-in.
- **Excluded by ruling:** avatar upload (R1), email (No7), a bundled Vietnamese font, more poses, a carry-over pot
  paying sit-outs, relief counting table stacks, `SIT_OUT` on two seats, Docker and real PostgreSQL, dev-only
  advisories, and the pipeline's 1–2 px re-cut drift.
- **Residuals:** a few drawn light specks at deep tones; a frozen seat gives no Sit In feedback; a retried Hold'em
  buy-in uses the original amount.

### 2026-10-05 — brown and deep hands lose their orange rim — `d04276e`

- The user: *"sửa luôn viền tay ở tông nâu đậm"*.
- A fifth mask kind, `skinLine`, covers bodies, faces and the outfits' redrawn copy of the arm outline. A skin colour
  *shades* it (`min(1, tone L / skin meanL)`, hue kept) rather than recolouring it. Light tones are unchanged.

### Plan 19 — avatar v4: gender, hairstyle and skin tone apart; a pose with fingers — `76555ef` (docs `ea1dc0d`)

- **Built:**
  - config v4 (`gender`, `hairStyle`, `skinColor`), with v1–v3 read-migrated and the database written only on Save;
  - two bald bodies with five-fingered hands and six faces each, eight two-layer hairstyles, six outfits and eight bots,
    all generated through the registry;
  - skin masks; checks C11–C13; registration before cutting;
  - 274 old base files deleted (avatar art 26.2 → 17.6 MB).
- **Rulings (surviving ledger):**
  - The body template's underwear is "plain mid-gray tank top and plain charcoal shorts", to keep ΔE away from cream skin.
  - C11 compares (skin ∪ eye zone) with the neutral face's same area, 0.8–1.2.
  - `HAIR_EYE_LIMIT` goes from 1 % to 5 % ("blunt anime bangs rest on the upper lashes").
  - The wavy style is redrawn in silver and ingested with `--recolour-to #e0c9b3`.
  - The eye rule hands out a colour only when it is closer to the old eyes than the body's own.
  - On the review sheets, the gender's default hairstyle is its first `HAIR_CODES` entry.
- **Lessons:** no two registry writers at once; a verify override must re-run the checks; a build in the main checkout
  changes the live bundle; the source pictures exist only in the main checkout.

### Plan 18 — review 2026-09-29, round 2 — `a2bd8cc`; follow-ups `044b46a`, `a96e598`, `11ea2e1`

- **Built:**
  - the No9 copy list (`docs/copy-review-2026-10.md`);
  - an owned-only wardrobe with "Hiện cả món chưa có";
  - the inventory merged into the wardrobe;
  - tinted icons;
  - the expression stepper;
  - two-sided card flips with an 870 ms reveal hold.
- **Follow-ups:**
  - the seats hold the result until the cards have turned;
  - E1: live faces react;
  - the plate keeps its pre-payout stack.
- **Rulings (surviving ledger):**
  - "No9 list applied without a separate approval round — user said 'làm theo đề xuất của bạn luôn'; list committed + shown
    in final report — cost if wrong: copy rollbacks per line".
  - "No8a = tinted icons … not dots only — dots already exist and the user still flagged it".
  - The loss of the inventory's acquired date, source and total is accepted.
  - "families stay sorted by the original's rarity — re-sorting on equip would make cards jump".
  - The fix wave adds "a reveal hold (~0.9 s, none under reduced motion)".

### Plan 17 — review round 2 notes R2-1…R2-4 — `f6fe2f3` (docs `ac81259`)

- **Built:**
  - history reads "Tại Bàn 123", and bot chips are muted italic with a hidden "bot";
  - `trayWaitKey`;
  - the result card is a named group whose footer sits outside the live region;
  - `useSeatClearance`;
  - the busy-lobby e2e through `page.routeWebSocket`.
- **Rulings (surviving ledger):**
  - "R2-4 is fixed structurally … rather than tested on NVDA/JAWS — no screen reader here".
  - Bot chips use a hidden "bot", "not colour alone — humans may be called 'Bot 5'".
  - "phone (375×812) stays tier 3 … measured 174 px above the seat < 216".
  - "fix the lobby overflow in this plan rather than log it — R2-1 exists to catch exactly this".
- The pre-flight review found 16 amendments. The final review found the 3 px lobby overflow that the new test exposed.

### 2026-09-30 — the LAN host runs detached (R2-5) — `5228244`

- The host died silently twice, because `Start-Process -NoNewWindow` tied node to the console that launched it.
- The user chose (b): `run.ps1` registers and starts the per-user scheduled task `BlindLuckPoker-Normal`. `stop.ps1`
  kills only our `node`, then stops the task, and never touches a task it does not own.

### Plan 16 — review 2026-09-29, round 1 — `a836daa` (docs `dc79acc`)

- **Built:**
  - CSP `img-src … blob:` in Normal (No15/16);
  - the dead auth links removed;
  - readable history;
  - bot-only rooms close at once, with `wrapUp()` / `voidUnsettledHand`;
  - one modal footer;
  - the create dialog's 14rem reserve;
  - equal-height cards;
  - the table fits 1920×940 down to 1280×720;
  - `expectNoTextOverlap`.
- The pre-flight review found 14 plan defects.
- **Rulings (surviving ledger):**
  - "the pre-flight review stands in for the plan-level self-review the user asked for; its amendments are binding
    plan text".
  - A model is chosen per task.
  - The overlap helper's contract becomes the line-box inset (the 20 % rule missed the user's countdown).
  - "drop the one-column reserve … raise the two-column reserve to 14rem".
  - A fix round fixes the flaky money check before Task 9.
  - "all eight fixes + the three minors in one round — docs must be true".
  - **Parked:** a voided runner's queued timer can still send stray `GAME_EVENT` frames to a closing room (it moves no
    money).

### Plan 15 — the Blind table limit — `e0d7f57` (changelog `b222205`)

- A Blind seat brings `min(balance, 5 × wager)` to the table (`buy_in`), and every way off a seat cashes out.
- A seat that can no longer cover a hand is stood up with `TABLE_LIMIT_SPENT` and stays in the room as a spectator,
  still a claimant on a carried pot. Bots get a virtual limit.
- **Lessons:** `pnpm lint` in the main checkout lints the worktrees; worktree folders survive `git worktree remove`.

### 2026-09-29 — operation-test run 1 — `20c2e0e`; findings T1–T9 — `2111c55` (docs `60d027c`)

- The automated pack `apps/normal-web/e2e/ops/` has tests named by case id (`docs/operation-test-plan.md`), and the
  record is `docs/test-runs/2026-09-29-dot-1.md`.
- The nine findings were all fixed with option (a): a password equal to the email; kicking a bot; lost-connection
  return; the right hint when short of points; counting one's own rooms; a rename shows everywhere; `sslmode=verify-full`;
  the Lite SEA warning.
- **Lessons:** see the ops-pack habits in §2.2. The host had died overnight, so check `/health` first.

### 2026-09-28 — layout audit rounds 1–2 — `d9a5e89`, `1aa040c`; renamed to Blind Luck Poker — `22d1905`

- A self-audit of 37 real-build screenshots found L1–L8, U1–U6 and C1–C10. The user approved them in two rounds
  (*"theo đề xuất của bạn"*). Results: the `Segmented` primitive, `formatDay` / `formatMoment`, the "Quản lý bàn" dialog,
  and one colour rule: gold for primary actions and for money going into the pot, teal for check, call and ready.
- **Lessons:** the CSS-module collision (`.authCard`), dead phone `@media` blocks, `node -e` with backticks, grouped
  selectors.

### Plan 14 — the wardrobe as a dressing room — `8ace844`; bugs 2, 4–8 and tidy-ups (`4e11cc1`, `6d07222`, `e0ec40f`, `12b6062`, `efcf53e`, `3cb65dc`, `ddbf4a1`, `da11d6e`)

- The user chose a full redesign through mockups (option B, mockup "Hướng 1"; `docs/wardrobe-redesign/`).
- Rarity tokens `--rarity-*`.
- **Bug fixes:** an empty room shows "Đang đóng…"; stale chunks reload once; base names by hairstyle; the withdrawn
  hood leaves the catalogue; hat flags are checked against the manifest; the rail sheds items by width.
- **Lessons:** screenshot the real build and compare it with the mockup, because reviewers approve code that looks
  wrong; the built-in browser pane hangs on `file://`; the sign-up limit (bug 8's check was folded into an existing spec).

### Plan 13 — hair colour, eye colour, item colour variants — `b31fe6d`

- **Built:**
  - hair, eye and tint masks;
  - `free` common colours (owned by everyone, never in the daily draw);
  - `asset.tint` variants;
  - a canvas recolour shared with the pipeline, served as `blob:` URLs.
- Deployed 2026-09-25 with migration `0002_outfits` on Neon. The test account was granted the new items with
  `grant-wardrobe-cli`.
- **Lessons:**
  - The `blob:` URLs later met Normal's CSP (Plan 16 No15/16), and the e2e did not notice (§2.2).
  - Never sign in with the test account yourself; the user checks the UI.

### Plan 12 — the avatar asset registry and the ChatGPT loop — `44eac12`, `a82201c`

- The user chose route B: Claude drives ChatGPT Plus in the user's own Chrome (Claude in Chrome).
- `assets/avatar-src/registry.json` (65 assets) and `avatar-registry.mjs next|collect|verify|ingest|approve|reject|status`
  (`docs/avatar-2d.md` §10).
- The loop finished 2026-09-24 with 64 ok and 1 blocked (the hood cannot erase hair drawn into the base). `check`
  reported 1440 checks and 0 failures.
- **Lessons:** the Chrome procedure (§2.1); a size-lock line on every prompt; verify rules per kind of asset.

### Plan 11 — the chibi from AI-generated art — code `1efa0e1`, art `bfcf8cf` … `fea8f21`

- **Built:**
  - a PNG-layer chibi on a 384×448 frame;
  - a placeholder-first pipeline (`placeholder|ingest|check|sheet`), so every screen ran before any art existed;
  - config v3 and saved outfits;
  - the 3D system deleted, and CSP back to `script-src 'self'`.
- **Art phase (2026-09-15…21):** F01, M01, six real outfits, per-wear variants.
- **Rulings:**
  - The portrait crop is 208 at (88, 40) with a 260 ring (the first crop cut the face at the eyes).
  - Outfits hold clothing only, and the skin comes from the body. This superseded a shared-skin ruling the same day.
  - A base id is an open string validated against the registry.
- **Lessons:**
  - Generate from the original picture, in a new chat per item, using the download button.
  - An e2e run needs a fresh `pnpm build:normal`.
  - The LAN host kept the old build until real art landed.

### Plan 10 — hand-drawn SVG chibi — abandoned (branch `plan10/avatar-chibi-2d`, never merged)

Stopped at its style gate on 2026-09-09: the user said *"xấu quá"*. It was replaced by Plan 11. The lesson: a style
gate with real pictures comes before the rest of the art.

### 2026-09-08 — internal-test rounds — `55d4e32`, `6613db7`, `3ce6401`

- The bug-fix phase began: log in `docs/bug-log.md`, offer options, fix only on "fix".
- **Bug 1:** hide a bot's bankroll.
- **F1:** client-side pre-actions, with no protocol change.
- **F2:** the daily-reward nudge.
- **F3:** seat frames and eight SVG bot faces.
- **Bug 3:** the silent `ACK` became `NOT_ENOUGH_PLAYERS`.
- `grant-wardrobe-cli` (a third esbuild entry) gives the test account the whole catalogue.

### Plan 9 — free-tier deployment kits — `3a8dfc5`

- `deploy/normal-windows/` (Windows LAN on Neon's free PostgreSQL) and `deploy/oracle/` (Oracle Always Free, never yet
  executed). Spec `docs/superpowers/specs/2026-09-07-deployment-free-tiers-design.md`.
- The user's decision: the LAN host now, Oracle later. Vercel was rejected.
- The user registers Neon and Oracle themselves; Claude never enters cards or passwords.

### Plan 8 — 3D avatar — `1888c7f`

- Quaternius CC0 packs, a glTF pipeline with budgets, catalog v2 (`apps/normal-server/drizzle/0001_avatar_v2.sql`),
  and portraits rendered in the browser with three.js.
- Known at merge: small free packs (13 approximated meshes), a cold first face in about 3 s, no animation.
- Retired by Plan 11 when the user asked for a chibi.

### Plan 7 — hardening — `dc9569b`

- **Built:**
  - the soak (6 clients × 3 rooms × 20 hands; money exact; p95 3–14 ms for Hold'em, 4–34 ms for Blind);
  - `docs/test-matrix.md`;
  - `SIT_OUT` / `SIT_IN`;
  - a security pass with the AST secret-logging scan;
  - react-hooks lint at `--max-warnings=0`;
  - light-theme gold contrast;
  - the Lite start-up guard;
  - `docs/acceptance-checklist.md` (64 rows: 61 ✓, 3 partial), `docs/known-limitations.md` and `CHANGELOG.md`.
- **Lessons:** SendMessage vanished mid-session; `git commit -a` swept a subagent's files; the citation check found ten
  wrong rows on day one.

### Plan 6 — the Normal web app — `035acd4`

- A Vite/React app on the kit, a cookie session gate, account screens, SVG avatars, and the Playwright pass against
  the real server on PGlite.
- Deferred to Plan 7: react-hooks lint, `SIT_OUT`, a Vietnamese font subset, light-theme gold contrast, the Lite
  pid-reuse guard.

### Plan 5 — the Normal server — `bfb443d`

- **Built:**
  - Drizzle/PostgreSQL, with tests on PGlite;
  - argon2id and HMAC session ids;
  - the points ledger as the single source of truth;
  - the economy and 32 achievements;
  - `@bp/http-kit`;
  - the Compose stack.
- **Rulings (from notes):**
  - `apps/normal-server/data/achievements.json` has 32 rows, and the spec heading was fixed.
  - The daily random item excludes titles, badges and reserved reward ids.
  - `/health` reports `ok` or `degraded` (Lite: `error`).
  - Operator docs are in Vietnamese, developer docs in English.
- **Not verified:** the Docker image build and the real-PostgreSQL suite.

### Plans 1–4 — engine, server kit, UI kit, Lite — `546e460`, `57675a0`, `b0b89c8`, `e70fcfb` (2026-09-04)

- **Plan 1:** a pure engine (Hold'em, Blind Poker A/B, side pots, a brute-force-checked evaluator, conservation on
  every simulated hand).
- **Plan 2:** rooms as serialized actors, the gateway, reconnect and bots.
- **Plan 3:** the shared React client with vi/en parity and tokens.
- **Plan 4:** Lite as one SEA exe with `node:sqlite`.
- 582 tests at the end of Plan 4.

---

## 5. Open items

The single list is `docs/known-limitations.md`. As of this writing, the items a next session is most likely to meet:

- **Waiting on the user:**
  - the real-phone squeeze check (P21.3);
  - whether to lengthen the Blind result card (Ruling 27, `handIntervalMs`);
  - the deck's position (Ruling 17, reported as a deviation);
  - the 11 px phone scroll on play-or-fold squeeze tables (Ruling 28);
  - the human test rounds in `docs/operation-test-plan.md` (real phones, a LAN session, Lite on a second PC).
- **Environment:** the Normal Docker image has never been built, the suite has never run on a real PostgreSQL, the
  Oracle kit has never been executed, and seven dev-only npm advisories are deferred.
- **Roadmap (spec §34):** avatar upload (R1), email (No7), a bundled Vietnamese font, more poses, spectators and chat,
  top-up at the table.
- **Rule changes the user has not asked for:** a carry-over pot paying seats that sat out (spec §8.4); relief that
  ignores table stacks (§12.4).
- **Not shipped:** the Lite exe has been rebuilt locally after each plan but not handed out.
- **Repository housekeeping:**
  - The CHANGELOG lacks sections for Plans 9, 10, 12, 13 and 14, and still calls 7, 8 and 11 unreleased.
  - Its preamble says plans land on `master`.
  - README's per-package test counts and its Normal e2e paragraph (which still describes the 3D avatar) predate Plan 11.
  - The root `avatar:assets` script is dead.
