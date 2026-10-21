# CLAUDE.md — Blind Luck Poker

Operating instructions for an AI session or a new developer. Read it whole before the first command. It links to the
docs instead of repeating them; where a doc and this file disagree, the doc that owns the topic wins, and fix this file.

## 1. What this is

A real-time multiplayer poker game (No-Limit Texas Hold'em and Blind Poker), played for **virtual points only**. One pnpm
monorepo builds two editions: **Normal** (accounts, PostgreSQL, a web app; today a Windows LAN host on the user's Neon
database) and **Lite** (one Windows `.exe` with SQLite). Internal ids keep the old name: `@bp/*`, `bp_session`, `bind-poker-lite.exe`.

| Read | For |
| --- | --- |
| `docs/superpowers/specs/2026-09-04-bind-poker-design.md` | **Start here.** The SRS (Vietnamese): rules, architecture, protocol, data, decisions. Later specs in the same folder amend it. |
| `requirement.txt` | The master prompt the SRS answers. |
| `docs/acceptance-checklist.md` | requirement.txt §40 and §66, each row with its evidence. |
| `docs/known-limitations.md` | What the product does not do, why, and where it is tracked. Residuals go here. |
| `CHANGELOG.md` | One section per plan, with the merge commit, deviations from the spec, and what is still open. |
| `docs/lessons-learned.md` | Every plan's rulings and the lessons behind them. Read before planning. |
| `docs/test-matrix.md` | Which test holds up which row of spec §29.2, §29.3 and §30. |
| `docs/server-kit.md`, `docs/ui-kit.md`, `docs/normal-server.md`, `docs/normal-web.md`, `docs/avatar-2d.md`, `docs/security.md` | Per-package developer docs. |
| `docs/bug-log.md`, `docs/operation-test-plan.md` | The user's bug and feedback record, and the manual test rounds (Vietnamese). |
| `docs/copy-review-2026-10.md`, `docs/copy-review-2026-10-10.md` | Vietnamese copy rules and the glossary of stable terms. |
| `docs/player-guide.md` | Hướng dẫn chơi, for players (Vietnamese). |
| `docs/deployment-normal.md`, `docs/deployment-lite.md`, `deploy/normal-windows/README.md`, `deploy/oracle/README.md` | Operator guides (Vietnamese). |
| `docs/superpowers/plans/` | Every plan as executed, with its pre-flight amendments. |

## 2. Toolchain

- Node ≥ 22.13, pnpm 9 (`packageManager: pnpm@9.15.9`), Windows 11. The Lite exe step builds only on Windows x64 with Node 22.
- **Claude Code's Bash tool does not have `pnpm` on PATH.** Start every pnpm command with
  `export PATH="$PATH:$(npm prefix -g)"`.
- **Bash heredocs are unreliable** in that tool (long ones with quotes fail with "unexpected EOF"). Write files with the
  Write/Edit tools and keep Bash commands short. Never put backticks inside a double-quoted `node -e "…"`: bash runs them.
- **PowerShell 5.1:** no `&&` or `||` (use `A; if ($?) { B }`). Piping into `Select-Object -First N` stops the
  producer early and loses its exit code, so send long output to a log file and read the file. The PowerShell tool has
  reported exit 1 after a successful `stop.ps1`. The script prints its warning on stdout and ends `exit 0`, so the
  cause is unconfirmed (a truncated pipeline such as `| Select-Object -First` would do it). Read the output
  (`Đã dừng.`), not the exit code. Here `curl` is an alias of `Invoke-WebRequest`, so write `curl.exe`.
- **Playwright under pnpm 9:** `pnpm <script> -- --flag` hands Playwright a literal `--`, which drops your filter and
  runs the whole suite. Pass filters without `--`, or call Playwright directly:
  `pnpm --filter @bp/normal-web exec playwright test -c e2e/ops/ops.config.ts -g "F-12"`.
- Files are UTF-8 and full of Vietnamese. Edit them with the Edit tool, not perl/sed splices: one perl splice
  double-encoded `CHANGELOG.md` (commit `71b412d`, repaired in `9be001c`). After any scripted edit, read a Vietnamese
  heading back. `grep â` proves nothing, because `â` is a Vietnamese letter.
- Git: the default branch is **`main`** (renamed from `master` on 2026-10-11; older docs still say `master`). LF→CRLF
  warnings are noise. There is a GitHub remote, `origin`. **Never push unless the user asks.** Never use a bare
  `git stash`: the stash stack is shared by every worktree and session of this repo, so a bare `pop` can take someone
  else's. Use `git stash push -u -m <tag>`, then `git stash apply <sha>`.

## 3. Gates

| Gate | Command | Notes |
| --- | --- | --- |
| Types | `pnpm typecheck` | `pnpm -r run typecheck`, about 1 min. |
| Lint | `pnpm lint` | `eslint . --max-warnings=0`. Run in the checkout you changed. From the main checkout it also lints `.worktrees/*`, so remove merged worktrees first. |
| Unit | `pnpm test` | Every workspace plus `tooling/` and `deploy/`, about 2,640 tests in 14–15 min. Needs no database, Docker or network. It runs the real Normal production build; `CI_SKIP_BUILD=1` skips that one file. |
| Doc citations | `pnpm exec vitest run --root . tooling/arch` | About 5 s. There is no `@bp/tooling` package, so `pnpm --filter @bp/tooling test` matches nothing. |
| Builds | `pnpm build:normal`, `pnpm build:lite` | Normal → `apps/normal-web/dist` + `apps/normal-server/dist`. Lite → `apps/lite/release/lite/`. |
| Avatar art | `pnpm --filter @bp/normal-web avatar:check` | There is no root alias. `pnpm avatar:check` fails, and the root `avatar:assets` script is a dead alias left from Plan 8. |
| e2e Normal | `pnpm build:normal`, then `pnpm e2e:normal` | 24 tests, about 2.5 min, port 8091, throwaway PGlite. A stale `dist` fails every test. |
| e2e Lite | `pnpm build:lite`, then `pnpm --filter @bp/lite e2e` | 4 tests, about 40 s, port 8090. |
| Ops pack | `pnpm --filter @bp/normal-web e2e:ops` | 43 cases, about 10 min, port 8093, throwaway PGlite. Projects are `desktop` (1440×900), `mobile` (375×812 touch; titles tagged `@mobile`) and `landscape` (915×412 touch; titles tagged `@landscape`). |

- **The doc-citation rule.** In `docs/acceptance-checklist.md`, every `` `path` → `title` `` pair must occur verbatim in
  the cited file. In `docs/test-matrix.md`, every test-name fragment must occur verbatim in one of the files its row
  names. If you rename a test, update both docs in the same commit. If you add a row, bump the pinned counts in
  `tooling/arch/acceptance-links.test.ts`: today the checklist is `64 + 3 + 2 + 3 + 3` and the matrix `43 + 10 + 4 + 7 + 5 + 8 + 3`.
- **Sign-ups are rate-limited.** The server allows 10 sign-ups a minute per address. `pnpm e2e:normal` already
  registers close to that many accounts, so never add a test there that registers unless you remove one. In the ops
  pack, make new accounts only through `newPlayer` / `registerPatiently` (`apps/normal-web/e2e/ops/ops-helpers.ts`),
  which wait out the limit.
- **Browsers.** Only Chromium is installed. `pnpm --filter <pkg> exec playwright install chromium` is about 150 MB, and
  Firefox or WebKit builds are more. Ask the user before you download any of them.
- **The full gate before a merge to `main`** runs on the branch's final tree. If `main` has moved, merge it into the
  branch first; when it has not, that tree is the one the `--no-ff` merge produces. Run one step at a time, in this
  order: typecheck → lint → test → build:normal → build:lite → avatar:check → e2e Normal → e2e Lite → ops. It takes
  about 35 min. Write each step's output to a log, and report the numbers.

## 4. Deploying the LAN host (Normal, Windows)

The host is the per-user scheduled task `BlindLuckPoker-Normal` (`deploy/normal-windows/run.ps1`). It runs
`apps/normal-server/dist/main.js` from the **main checkout**, serving `apps/normal-web/dist` on port 8080. The pid is in
`deploy/normal-windows/normal.pid`, and the logs are `normal.log`, `normal.err.log` and `normal.serve.log` beside it.
The kit's `.env` (gitignored) holds the user's Neon `DATABASE_URL` and `SESSION_SECRET`. Deploy from the main checkout
after the merge:

1. Run `curl.exe -s http://localhost:8080/health`. If `rooms` is not 0, wait or ask. **`stop.ps1` is a hard kill**,
   and it loses every stack on a table and any carried-over pot.
2. `pnpm build:normal`. This replaces the bundle the live host serves, so do the next steps right away.
3. In the PowerShell tool: `& 'deploy\normal-windows\stop.ps1'`. It checks that the pid is our `node`, kills it, then
   stops the task.
4. `& 'deploy\normal-windows\run.ps1' -NoMigrate`. Drop `-NoMigrate` only when `apps/normal-server/drizzle/` gained a
   migration, because that writes the user's Neon database. **Ask first.**
5. Run `curl.exe -s http://localhost:8080/health` again and expect `"status":"ok"` and `"db":"ok"`. Report the new
   pid.

An open browser tab keeps the old bundle until F5. `index.html` is `no-cache` and the hashed assets are immutable, and
`apps/normal-web/src/stale-chunk.ts` reloads once when a chunk is gone. The task stops when the user logs off Windows
(`-AutoStart` adds a log-on trigger), so before you assume the host is running, check `/health`. Never start the Lite
exe while the host runs, because it also defaults to port 8080.

**Lite:** `pnpm build:lite` writes `apps/lite/release/lite/`. Nothing ships it automatically: record it as "rebuilt
locally, not shipped".

## 5. Security rules

- Never commit `other/`, the user's untracked scratch folder (review notes, screenshots), or any `.env`, secret,
  database dump or the original pictures in `assets/avatar-src/`. `other/` is in `.gitignore` since 2026-10-14 (an
  editor had staged it once); still stage files by name, and never use `git add -A` or `git add .` without first
  reading `git status`.
- **Never print** `DATABASE_URL`, `SESSION_SECRET` or the contents of any `.env`: no `cat`, `Get-Content` or echo.
  `run.ps1 -DryRun` masks the password, but its output still shows the database user and host, so never paste it
  anywhere public. If a host `.env` needs a change, change only that one key and never echo the file.
- An API key that a task needs lives in a gitignored `.env`, never in a commit or a log. Tell the user to revoke it when
  the task is done.
- Never type a password into a browser session on the live host or on any third-party site, and never sign in with the
  test account (`neon.test@example.com`). The user checks the UI themselves. Never write that account's password
  anywhere. The e2e suites register throwaway accounts on a local PGlite server, and that is fine.
- No write to the user's Neon database or to any external service without the user's yes. That covers a migration
  (`run.ps1` without `-NoMigrate`), `grant-wardrobe-cli`, a push, and any upload. No CAPTCHA solving and no account
  sign-ups on third-party services: Neon, Oracle and the like are the user's to register.
- **Points only, permanently.** No deposits, withdrawals, payment, crypto or marketplace code (requirement.txt §3, spec §33).
  Any change to a money path (ledger, buy-in, cash-out, pots, fees) keeps `Σ balances + Σ sink rows` conserved and is
  pinned by a conservation test.

## 6. Conventions

- **Commits:** Conventional Commits, with a scope where it helps (`fix(ui-kit)`, `feat(server-kit)`, `fix(avatar)`,
  `test(e2e)`). The types in use are `feat`, `fix`, `docs`, `test`, `chore`, `refactor`, `perf`, `build`, plus the
  project's own: `copy` for locale text (`copy(vi)`), `art` for avatar picture batches, and `spec` / `plan` (also
  written `docs(spec)` and `docs(plan)`). After the colon, write one sentence in the repo's voice that says what a
  player or operator now gets, e.g. `fix(ui-kit, normal-web): the result scrim leaves no edge, a room name's tooltip
  only when cut, the lobby heading wraps at 320 px`. Read `git log` before your first commit. End with the attribution trailer the session prescribes.
- **Branches and merges (gitflow, since 2026-10-13):** `<prefix>/BP-<n>-<slug>` — the prefix is `feature/` for a
  plan or a new capability, `bugfix/` for a fix, `hotfix/` for an urgent fix on what is deployed, `release/` when a
  release branch is ever needed, `docs/` for documentation-only work; `BP-<n>` is the plan number for a plan and
  otherwise the next free number (the last used one is in the CHANGELOG); the slug is short and kebab-case, e.g.
  `feature/BP-22-monthly-daily-gifts`, `bugfix/BP-23-blind-timeout-standup`. Branches older than this date keep their
  old names in history (`plan21/…`, `fix/…`). There is no `develop` branch: features merge `--no-ff` into `main`,
  with the message `Merge <branch>: <one sentence>`. Work in worktrees under `.worktrees/` (gitignored); each
  worktree needs its own `pnpm install`. The user pushes; the assistant never does.
- **CHANGELOG:** one section per plan, newest first, titled ``## Plan N — <title> — merged `MERGE` (date)``. Replace
  `MERGE` with the merge hash in a `docs:` commit right after merging. The body lists what changed (what the player
  sees first), what is under it, tests and docs, **"Khác với spec / Deviations from the spec"**, and **"Still open"**.
- **Where things are recorded:** residuals go in `docs/known-limitations.md` (what, why it stays, where tracked). User
  reports go in `docs/bug-log.md` with options (a)/(b)/… and a recommendation. Rulings and lessons go in
  `docs/lessons-learned.md`.
- **Language:** developer docs are in English. Operator and player docs are in Vietnamese: the deployment guides, the
  Lite README, the bug log, the copy reviews, the operation test plan and the player guide. Specs are in Vietnamese.
- **i18n:** every player-facing string lives in both `vi` and `en`. Parity tests enforce it:
  `packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts` and
  `apps/lite/web/src/App.test.tsx`. `react/jsx-no-literals` forbids literal strings in JSX. Numbers go through
  `formatPoints`, dates through `formatDay` / `formatMoment`. English copy changes only when the user asks.
- **Stable Vietnamese terms.** The e2e suites match on these, so rename one only with every locator, test and doc in
  the same commit (glossary: `docs/copy-review-2026-10-10.md` §3):
  - In hand: Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Lật, Đã lật, Đã chọn, Xem/Bỏ, Theo mọi mức, Tự động chơi.
  - Room settings: Blind Poker, Hoàn toàn may rủi, Chơi hoặc bỏ, Nặn bài, Mức cược cố định, Hạn mức, Số lượng bot,
    Tạo phòng.
  - Room actions: Sẵn sàng / Hủy sẵn sàng, Bắt đầu, Tạm nghỉ / Chơi tiếp, Mời ra, Người thắng, Ván bị hủy, Mời nặn bài.
  - Screens: Phòng thay đồ, Điểm danh, Cứu trợ, Quản trị (with Khóa tài khoản, Mở khóa, Cộng/trừ điểm, Đóng phòng, Nhật ký).
  - The page heading is "Blind Luck Poker".
- **UI:**
  - Style with CSS modules and the tokens in `packages/ui-kit/src/theme/tokens.css`. A phone `@media` block goes
    *after* the base rules it overrides.
  - `prefers-reduced-motion` is honoured globally (`packages/ui-kit/src/theme/global.css`). New motion needs a
    reduced-motion path and a test.
  - The user's desktop is **1920×940**. Also check 1366×768 and 375×812.
  - Text must never overlap text. `expectNoTextOverlap` (`apps/normal-web/e2e/overlap.ts`) runs on every main screen.
- **Dependencies:** add no new runtime dependency without a reason written in the spec. Plan 21 weighed three.js and
  anime.js and added neither. `@bp/core` stays pure, with no I/O and no dependencies
  (`tooling/arch/boundaries.test.ts`). Normal and Lite share code through the packages and never by copy. Lite picks up
  ui-kit changes only after `pnpm build:lite`.

## 7. How work is run

- **Classify each request first:**
  - **Spike:** a question or a prototype. Answer it; nothing merges.
  - **Bounded:** a bug, copy or a small UI change. Log it in `docs/bug-log.md` if it is a report, and propose options
    with a recommendation. Fix on the user's word, on a `fix/…` branch with tests, then gate → merge → deploy → CHANGELOG
    and bug log. If the user said "không cần hỏi lại", do not ask again.
  - **Architectural:** a new mode, data model, protocol or art pipeline. Brainstorm (superpowers:brainstorming, with
    prototypes the user can open) → write a spec in `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` (user
    decisions as a Q-table) → write a plan in `docs/superpowers/plans/YYYY-MM-DD-planN-<slug>.md` → execute it with
    subagent-driven development.
- **Subagent-driven development (SDD):**
  - The workspace is `.superpowers/sdd/<plan>/` (gitignored), and its ledger is `progress.md`.
  - Pre-flight: scan the producer → consumer pairs between tasks. Then have an independent opus subagent review the plan
    against the real code and screens. Splice its amendments into the plan as "Amendments (pre-flight <date>)" and commit.
  - Each task gets a fresh implementer subagent, then a reviewer (spec, then quality), then fix rounds with re-review.
    Park minors for the final wave.
  - Then: a final whole-branch review (opus) → **one** fix wave → re-review → the full gate → merge → a docs commit with
    the hash → deploy → one report.
- **Rulings, not stalls.** When a choice is needed and the user is away, decide it and ledger it as
  `Ruling N: <what> — <why>. Costs if wrong: <…>`. List every ruling in the final report. A deviation from the spec
  goes in the CHANGELOG's deviations list.
- **The big-plan routine the user asked for** ("self-review đảm bảo hạn chế rủi ro…", "xong thì báo tôi"):
  - Every UI task ships real screenshots at 1920×940, 1366×768 and 375×812, and reviewers open them.
  - For kit work, use the playground: `pnpm --filter @bp/ui-kit playground` (port 5175). Its modes are Hold'em, Blind
    A/B, `blindS` and `blindBS` (squeeze), and it has the pages `#peel` and `#worst/<state>/<seats>/<lang>[/long][/landscape|/desktop]`.
  - For the real build: `pnpm build:normal`, then a throwaway `apps/normal-web/e2e/zz-preview.spec.ts` run on its own
    (`pnpm --filter @bp/normal-web exec playwright test -c e2e/playwright.config.ts zz-preview`). Delete it before the
    gate and the commit, because its sign-ups count toward the limit.
  - Take every screenshot with Playwright from `apps/normal-web` (`@playwright/test` lives there). Never use the in-app
    browser tools for screenshots: they hang on `file://` and are flaky.
  - Run to the end (merge and deploy), then report **once**: what shipped, the gate numbers, every ruling, the
    deviations, the residuals, and what the user must check by hand.
- **After a plan merges,** append its rulings and lessons to `docs/lessons-learned.md`. The SDD workspace and the
  session scratchpad are deleted, and that file is the only record that survives.
- **Subagents** may write files in their worktree, but they return their reports as text. Keep one writer per worktree
  at a time, and never `git commit -a` while an implementer is running. Never run two commands that write
  `assets/avatar-src/registry.json` at once.

## 8. Pitfalls worth a line each

- **Real-phone checks are manual.** The squeeze peel has only been driven in Chromium. iOS Safari and Firefox Android
  are the user's to try (`docs/known-limitations.md` → UI).
- **CDP touch drags need pacing.** A burst of touch moves makes the next tap lose its click. Space the moves 16 ms
  apart and rest 64 ms before the lift (`touchDrag` in `apps/normal-web/e2e/ops/ops-helpers.ts`).
- **Playwright `setOffline` keeps an open WebSocket alive.** To drop the connection, close the tab.
- **Pre-action toggles share names with the action buttons.** Match the actions with `button:not([aria-pressed])`.
- **Encoding:** see §2. Use the Edit tool for Vietnamese text and read a heading back afterwards.
- **Removing a worktree:** `git worktree remove` refuses one that holds untracked or ignored files (`node_modules`).
  Check that `git -C <wt> status` is clean, then `Remove-Item -Recurse -Force <wt>` and `git worktree prune`.
- **The e2e `--` trap** (§2), and **`pnpm --filter @bp/tooling test` matches nothing** (§3).
- **Never spawn `node <pkg>/bin/esbuild`.** On Linux that file is the native binary (esbuild swaps its shim at install),
  so the Docker build dies with `SyntaxError … ELF`. The three build scripts use esbuild's JS API (BP-24).
- **Ports:** 8080 is the LAN host and the Lite exe, 8090 the Lite e2e, 8091 the Normal e2e, 8093 the ops pack, 5173
  Vite dev and 5175 the playground.
- Everything else, with its story, is in `docs/lessons-learned.md`.
