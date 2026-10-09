# Known limitations

Everything here is known, deliberate and written down somewhere else in the codebase as well. This
page is the single place to read it all at once: what the thing does not do, **why**, and **where
it is tracked** — the spec's roadmap (§34), a decision in Appendix A, another spec, or an operator
guide.

It is not a bug list. A bug is something that is supposed to work and does not; everything below
either works as designed and the design has a cost, or was scoped out on purpose.

The three rows of [`acceptance-checklist.md`](acceptance-checklist.md) that are not a plain ✓
(40.8, 66.21 and 66.40) appear here too, under **Operations**; so does the one Plan 21 added
(P21.3, the squeeze peel not yet tried on a real phone), under **UI**.

---

## Gameplay

**A display-name or cosmetic change reaches the table only at the next join.** The room snapshot
captures the name, avatar and caption when a player joins; a rename or a new avatar saved while
sitting at a table updates the account immediately but not the seat plate the others are looking at.
Pushing it would mean a room-wide invalidation message for something purely cosmetic.
*Why it stays:* the cost is a stale label for the rest of one session. The profile screen says so
in as many words when a rename succeeds (`apps/normal-web/src/screens/ProfileScreen.test.tsx` →
"shows the 409 on the field, then updates the header and warns about the table on success").
*Tracked:* `docs/normal-web.md`.

**No spectators, no chat, no emotes, no leaderboard, no replay.** None of these is in the protocol.
Spectating in particular exists only as a *view* — `playerView` correctly blanks every hole card for
a viewer who is not seated (`packages/core/src/hand/engine.test.ts` → "hides every hand from a
spectator") — but there is no way to enter a room as one, and no spectator chrome.
*Why:* MVP scope (spec §33 puts all of them under COULD).
*Tracked:* roadmap §34 item 4; `docs/ui-kit.md` Known gaps.

**No top-up at the table.** `TOP_UP` is not in the protocol, so a Hold'em player whose stack is
short has to stand up and sit back down with a fresh buy-in. The stand-up returns the stack to the
balance in full, so nothing is lost — it is a click, not a leak.
*Why:* a mid-hand top-up needs its own rules about when it may be taken (never mid-hand, never to
reopen action), which is more rule surface than the MVP needed.
*Tracked:* `docs/ui-kit.md` Known gaps.

**Relief looks at the balance only.** Points on a table (a Hold'em buy-in, a Blind table limit) are
not counted, so a player with most of their points on a table can claim relief
(`POST /api/economy/relief`, once per 24 hours).
*Why it stays:* counting live table stacks would make the economy service ask the rooms, across
editions, for a once-a-day top-up of at most 5.000.
*Tracked:* here; spec §12.4.

**The `SIT_OUT` auto-stand-up cannot fire on a two-seat table.** A player who sits out is stood up
after five consecutive *dealt* hands they skipped. The counter ticks on hands, not on wall-clock
time — and on a table with two seats, one of them sitting out, no hand can start at all, so nothing
is ever skipped and the seat is held until the player leaves or the room closes empty
(`emptyRoomCloseMs`). The abandoned case is therefore covered by the empty-room close, not by the
sit-out counter.
*Why:* a wall-clock counter would stand people up during a legitimate pause between hands.
*Tracked:* `docs/server-kit.md` ("Where it does not fire") and spec §11.3.

**A carry-over pot released to the table also pays seats that asked to sit out.** When a Blind room
cannot start a hand for `carryOverReleaseMs`, the accumulated pot is split across every seated human
— which since Plan 7 includes seats that have asked to sit out — and, since the table limit, every
human stood up for a spent limit while that pot was carried who is still in the room
(`Room.releaseCarryOver`). Money is still exactly conserved — the `Σ balances + Σ sinks` identity is
untouched, and the Blind soak asserts it every run — but a player who declined to play shares a pot
they were never eligible for.
*Why it stays:* spec §8.4 predates `SIT_OUT` and says "the seated humans" without qualification, so
excluding sitters is a rule change rather than a bug fix, and it is a rule change in the direction
of taking points away from somebody. Ruled a roadmap item rather than a fix in this milestone.
*Tracked:* here; spec §8.4 needs either the exclusion or a sentence saying seated-but-sitting-out
still counts.

**History names opponents by their recorded label.** A hand's history row stores each seat's id and
a label. When the account behind a seat is gone, the listing falls back to that recorded label (the
account's id) rather than a live profile lookup
(`apps/normal-server/src/history/history-service.test.ts` → "falls back to the recorded id when the
account behind a seat is gone"). A bot has no account either; its recorded label is the engine id
`bot:<roomId>:<i>`, which the listing reads back as "Bot n" (n = i + 1, the name the room gave it) and
which reads as-is if it is not in that shape ("reads a bot seat as "Bot n"…", same file). Each hand
also names its table from the room config stored with it, and shows no table line when that is missing.
*Why:* history is an immutable record; resolving names live would rewrite the past every time
somebody renames themselves.
*Tracked:* `docs/normal-server.md`.

**A hand in progress does not survive a server restart.** Restarting cancels every live hand,
refunds every committed chip, cashes table stacks back into balances and notifies the clients. No
points are lost; the hand is.
*Why:* persisting mid-hand state means event sourcing per room, which spec Appendix A weighed and
rejected as the wrong complexity for the scope.
*Tracked:* spec §32 assumption 8, Appendix A ("Không lưu ván qua restart"), roadmap §34 item 5.

---

## Editions

**A hard kill of the Lite server loses live table stacks and the Blind carry-over pot.** On Windows,
`taskkill`, `schtasks /End`, `sc stop` and closing the console window give the process no chance to
drain: balances already written to SQLite stay correct, but table stacks (Hold'em and, since the
table limit, Blind) and a carried-over Blind pot are gone. Only `--stop`, `Ctrl`+`C` / `Ctrl`+`Break`, or NSSM (which sends
Ctrl+C) shut down cleanly, refunding everything first.
*Why:* there is no code path to run when no code runs. The recovery *after* such a kill is handled —
a stale `bind-poker.run.json` is detected and overwritten, and a second instance on the same data
directory refuses to start rather than corrupting it.
*Tracked:* spec §28.2 and the §30 edge-case table; `docs/deployment-lite.md`;
`apps/lite/release-src/README-lite.md` tells the operator which shutdowns are safe.

**Lite has no password.** A session is a display name and a 32-byte bearer token in the browser's
`localStorage`; whoever holds the token is that player, and the token does not expire.
*Why:* Lite is one executable on one trusted LAN, and a password store would be the single heaviest
thing in it. `ALLOWED_ORIGINS` defaults to same-host and `HOST=127.0.0.1` narrows it to one machine.
*Tracked:* spec §23 (last row) and §32 assumption 10; `docs/security.md` §1; an optional PIN is
roadmap §34 item 8.

**The Lite executable is Windows x64 only, and unsigned.** A Node SEA blob only loads in the Node
build that produced it, so `pnpm build:lite` must run on Windows x64 with Node 22; on any other
platform the exe step is skipped and the rest still builds. Being unsigned, SmartScreen and some
AV products will warn on first run.
*Why:* the target host has no Node, no Docker and no Internet; a signed binary needs a certificate
the project does not have.
*Tracked:* spec §31 (two risk rows) and §32 assumption 11; roadmap §34 item 3;
`docs/deployment-lite.md` documents the unblock steps.

**Normal runs as a single process.** One process holds every room in memory; there is no horizontal
scaling and no sticky routing.
*Why:* spec §25 sizes the target at a scale one Node process handles comfortably, and the soak
(6 clients × 3 rooms) says the headroom is real — with the caveat that the figure moves with machine
load. Nine runs on the development machine on 2026-09-05 (Windows 11 / Node 22.13 / pnpm 9.15.9)
gave p95 action → broadcast of **3–14 ms for Hold'em** and **4–34 ms for Blind** against spec §24's
50 ms budget, worst single sample 75 ms; the quiet end of that range (3–7 ms and 4–9 ms) came from
runs of the soak file alone, the loud end from runs sharing the machine with the rest of the suite.
Read it as a margin of roughly 1.5–15×, not the order of magnitude a single small number would
suggest, and re-measure on the target hardware before sizing a deployment from it.
*Tracked:* spec §25; roadmap §34 item 6.

**The two editions' write limiters key their buckets on slightly different paths.** Lite's hook
(`apps/lite/server/src/http/routes.ts`) keys on `req.routeOptions.url ?? req.url.split('?')[0]`;
Normal's otherwise line-for-line sibling (`apps/normal-server/src/http/routes.ts`) keys on
`req.url.split('?')[0]` alone. There is no behavioural difference today — neither edition has a
parameterised mutating route, so the matched route and the raw target are the same string. One side
effect is worth stating: because a `POST /api/<nonsense>` matches no route, Lite falls back to the
raw target, so a stream of 404s from one address spends the same 60/min bucket as that address's
legitimate daily claim. That is intended (it is the abuse case the bucket is for) but it is asserted
nowhere.
*Why it stays:* converging the two hooks is a refactor with no behaviour to verify against, which is
the kind of change a hardening milestone should not be making at the end of it. Ruled a roadmap
item.
*Tracked:* here; `docs/security.md` §3 describes both limiters.

**No email verification, no forgotten-password flow, no third-party sign-in.** Registration takes an
address and a password and trusts the address is spelled right.
*Why:* every one of them needs outbound mail, which the MVP deliberately does not have.
*Tracked:* spec §32 assumption 12; roadmap §34 item 2.

**Lite's dev server has no avatar files until the app has been built at least once.** The chibi's PNG
layers live at `apps/normal-web/public/avatar/`; `apps/lite/scripts/build.mjs` copies the `body_*`/
`bot_*` files, the default hairs and the default outfit — the ones it draws, and no mask — into `dist/public/avatar`
as one step of a full build. `pnpm --filter @bp/lite
dev` runs Vite's own dev server against `apps/lite/web` directly and proxies only `/api` and `/ws`
(`apps/lite/web/vite.config.ts`) — nothing serves `/avatar/` on that port, so every chibi 404s until
`apps/normal-web` has been built at least once and a full `pnpm build:lite` has copied its output over.
*Why it stays:* wiring a second dev-only proxy for a handful of PNGs is more machinery than the problem
is worth; building once before a session of Lite UI work is a one-line fix.
*Tracked:* `docs/avatar-2d.md`.

---

## Operations

**The Normal Docker image has never been built.** `deploy/normal/docker-compose.yml` is validated by
`docker compose config` (which substitutes every variable and fails loudly on a missing one), and the
server bundle has been run standalone against its production-only `node_modules` — but no
`docker build` has been executed, because the development machine has no Docker daemon.
*Why:* an environment limitation, not a decision.
*What to do:* treat the first deploy as a supervised trial and follow the pre-flight in
`docs/deployment-normal.md` §2 — `docker compose config`, then `up -d --build`, then read
`docker compose logs migrate` before `app`.
*Tracked:* acceptance checklist row 40.8; README's Normal-edition warning; `docs/deployment-normal.md` §2.

**…and the first build the project's own runbook recommends is an `arm64` one.** `deploy/oracle`
targets an Oracle Always Free `VM.Standard.A1.Flex`, which is ARM, so the first `docker build` is
likely to be both the image's first build anywhere *and* its first build off x86. `argon2` 0.45.1
ships musl prebuilds for **both** `linux-x64` and `linux-arm64`
(`prebuilds/linux-arm64/argon2.armv8.musl.node`), so `node-gyp-build` unpacks a binary on arm64 the
same way it does on x86 — there is no known source-compile step at this point. The builder stage's
`python3 make g++` toolchain is a fallback for a rejected prebuild (Node ABI or libc mismatch), not
the expected path. No other difference between the ARM and x86 build is known in advance; this is
still the image's first build on this architecture, and "should build the same way" is a reading of
`node-gyp-build`'s prebuild matching, not an observation.
*Why:* the same missing Docker daemon, plus no ARM machine of any kind here.
*What to do:* build it with `docker compose build --progress=plain 2>&1 | tee /tmp/build.log` the
first time, and read the log rather than the summary. `deploy/oracle/README.md` §8 has a symptom
table for this build specifically.
*Tracked:* `deploy/oracle/README.md` §8; the free-tier deployment design §6 lists it as risk 1.

**A free-tier PostgreSQL goes to sleep, and the Windows LAN kit runs on one.**
`deploy/normal-windows` points `DATABASE_URL` at a free hosted PostgreSQL (Neon is the one the
runbook names), whose free plan suspends a project's compute after a few minutes of no connections.
The first query after that wakes it, which takes roughly 1–2 seconds — so the first sign-in of a
session is slow, and the pool's very first connection can time out on an unlucky cold start rather
than merely being slow. Everything after it is normal.
*Why:* that is the free plan, and the kit exists to be free. The alternative — a PostgreSQL
installed on the Windows machine — is documented in the same runbook for anyone who would rather not
have this.
*What to do:* nothing, for a LAN trial; open the page once before inviting anyone. Do not deploy the
Normal edition publicly against a sleeping database — the Oracle kit runs `postgres:16-alpine` in
the stack itself and has no such pause.
*Tracked:* `deploy/normal-windows/README.md`; the free-tier deployment design §6.

**Oracle Cloud Always Free can reclaim an idle VM.** For accounts that have *not* upgraded to Pay As
You Go, Oracle's published policy stops instances judged idle over seven days — CPU, network and (on
an A1 shape) memory all below 20 % at the 95th percentile. A poker server with a handful of players
sits comfortably inside that window, so the deployment `deploy/oracle` produces can be stopped for
being quiet. The boot volume is not deleted and the instance can be started again, but a site that
goes down at a moment nobody is watching is down.
*Why:* it is the free tier's own rule, and neither the script nor the stack can opt out of it.
*What to do:* upgrade the account to PAYG — the policy does not apply to PAYG accounts and the
Always Free resources stay free — or accept it and put an external uptime check on
`https://$DOMAIN/health` so you learn about it in minutes rather than days. Artificially loading the
CPU to look busy is not a workaround and is not recommended. `deploy/oracle/README.md` §11.
*Tracked:* `deploy/oracle/README.md` §11; the free-tier deployment design §6.

**Stopping the Normal server on the Windows LAN kit is a hard kill.** `deploy/normal-windows/stop.ps1`
ends the process with `Stop-Process`. Windows has no way to deliver the Ctrl+C the server's graceful
path is written for, and — unlike Lite — the Normal edition has no `--stop` and no run file to ask
one instance to shut the other down. So the same thing is lost as in a hard kill of Lite: balances
already written to PostgreSQL stay correct, because every entry is inside a transaction, but table
stacks (Hold'em and, since the table limit, Blind) and a carried-over Blind pot are gone.
*Why it stays:* the kit is for an internal LAN trial, where the answer is to close the rooms first;
building a graceful stop for it means adding a run file and a stop protocol to the Normal server for
the sake of a test harness. Recorded as decision D3 of the free-tier deployment design.
*What to do:* wait for tables to empty before running `stop.ps1`. On a real deployment this does not
arise — `docker compose stop app` is a graceful stop, and the server refunds every committed chip and
cashes table stacks back into balances before it exits.
*Tracked:* `deploy/normal-windows/README.md`; the free-tier deployment design §3 and Appendix D3.

**The ledger's idempotency keys last one server process.** Since Plan 20 every money write the room may
retry — a buy-in, a cash-out, a carry-over release — carries a key, and the ledger claims it in
`ledger_keys` inside the write's own transaction, so a repeat is a no-op (`docs/server-kit.md` →
Repositories → Keys). A sitting leaves about two rows (its buy-in and its cash-out), a released pot one
more, and the table is emptied when a server starts (`pruneLedgerKeys`): Normal's `buildApp` before the
game server exists, Lite's `listen()` in the instance that owns the data directory (a `--smoke` run never
prunes — it may share a live server's database).
*Why it is safe, and its cost:* a key is only ever replayed by the room that claimed it, and rooms live
in memory, so no key outlives the process that could retry it. That rests on one server per database:
Normal is a single process (above), and Lite refuses a second instance on one data directory. A second
Normal process pointed at the same database would empty the first one's keys when it booted.
*Tracked:* here; `apps/normal-server/src/repos/balance-repo.ts` and `apps/lite/server/src/repos/sqlite-repos.ts`
(`pruneLedgerKeys`), `apps/normal-server/drizzle/0003_ledger_keys.sql`, Lite schema v3.

**The suite has never been run against a real PostgreSQL.** Every `apps/normal-server` test runs on
in-process **PGlite** through the same driver-neutral `AppDb` the production code uses, so the
queries under test are the production queries. PGlite is single-connection, though, which means the
row-lock serialization tests (`SELECT … FOR UPDATE` — what the whole money design rests on) only
genuinely execute when `TEST_DATABASE_URL` points at a real server, and that run has not happened
here.
*Why:* an environment limitation (same missing Docker daemon), plus a deliberate design choice —
spec Appendix A explains why PGlite was preferred to Testcontainers for the default path.
*What to do:* run it once before deploying; exact commands in `docs/deployment-normal.md` §2.
*Tracked:* acceptance checklist row 66.21; spec Appendix A.

**Seven npm advisories are deferred.** `pnpm audit --prod` is clean across 634 production
dependencies. The full `pnpm audit` reports seven, every one of them against a build- or test-only
package: the Vitest UI server (never started — `pnpm test` is `vitest run`), the Vite dev server
(only `pnpm dev:normal-web`, on a developer's own machine), and the esbuild dev server (both apps
use esbuild as a one-shot bundler). None is installed on a server or shipped inside the exe.
*Why:* clearing the list means Vitest 2 → 3 and Vite 5 → 6 across eight packages. An override on a
transitive `vite` would pin a version Vitest 2 was not built against — trading a dev-only advisory
for a broken test runner.
*Tracked:* acceptance checklist row 66.40; `docs/security.md` §2, with a disposition per advisory
and the `pnpm outdated -r` distance recorded on the same date.

**Backups are scheduled by the operator, not by the stack.** `deploy/normal/backup.sh` and
`deploy/normal/restore.md` are complete and tested procedures, but nothing in the Compose file runs
them on a timer.
*Why:* backup retention and destination are site decisions; baking a cron into the image would make
the wrong ones silently.
*Tracked:* `docs/deployment-normal.md` and `deploy/normal/restore.md`.

**The soak test is reproducible per seat, not per table.** `runSoak` seeds each client's own policy,
so the *decisions* replay; the server shuffles with `cryptoRng`, so the *cards* do not. Two runs of
the same seed therefore agree on who folded and disagree on who won — which is why the assertions
are invariants (money conserved, no `seq` gaps, latency budget) rather than fixed expected values,
and why the observed hand count is a floor (60–62 for a 3 × 20 target) rather than an equality.
*Why:* a seeded shuffle in the server would be a game-integrity defect; the RNG is not made
deterministic for the convenience of a test.
*Tracked:* `docs/server-kit.md` (soak driver) and `docs/test-matrix.md` §29.3.

---

## UI

**Badge contrast is measured on the grounds a badge sits on today.** `packages/ui-kit/src/theme/tokens.test.ts`
→ "badge text" composites each badge's ink over its own tint over every ground the app puts one on — the page,
a raised panel, the page's mesh under the room header, a dark panel's highlight, both ends of the paper islands,
`.panel.felt`, a seat on the table — and every one clears AA (4.5:1). A badge placed on a ground the test does
not list is not measured. The tightest is teal: a dark `.panel.ink` lays a white highlight along its top edge,
which the test holds at 2 %, above where any badge sits (Lite's "claimed" badge is at 0.8–1.4 %, none on a
phone); a teal badge on the very first line of a tall dark panel, at 3–4 %, would read 4.3–4.4:1. No such
placement exists.
*Why it stays:* paling the teal further would buy margin for a place nothing uses, at the cost of a visibly
washed-out badge everywhere.
*Tracked:* `docs/ui-kit.md` Known gaps.

**No Vietnamese web font is bundled.** `--font-display` names a face and then falls back to
Cambria / Constantia / Segoe UI, all of which carry the precomposed Vietnamese glyphs — and Windows,
which has all three, is the only host Lite runs on. A test pins the fallback list so a future edit
cannot quietly drop Vietnamese coverage.
*Why:* bundling one means downloading a font file at build time and running a subsetter, which is a
build-pipeline change of its own.
*Tracked:* `packages/ui-kit/src/theme/tokens.test.ts` → "reaches a Windows face with full Vietnamese
coverage before the generic serif"; roadmap §34 item 9.

**One wardrobe layer is still placeholder art, and a new item starts as one.** `apps/normal-web/public/avatar/`
ships real pictures for the whole v4 set (two bodies, their faces, eight hairstyles, the outfits, hats, glasses,
auras, frames and eight bots) except `item_head_hood_black01_L80`, a labelled stand-in `scripts/avatar-pipeline.mjs
placeholder` draws — a flat shape on the right frame and crop, not the chibi the design describes. The catalogue
no longer offers the hood (players who own it keep the row, and the daily draw skips it), so no screen draws it.
A future item gets a stand-in the same way until it is drawn or AI-generated, ingested and passes `avatar:check`
(avatar-chibi-ai design §6, §9 step 6): the catalogue, the server and every test run against it exactly as they
will against the real thing; nothing here is mocked, only undrawn.
*Why it stays:* the app, the pipeline and every screen had to work before a single real picture existed, and a
new item should be buildable the same way; the hood is a withdrawn item, not worth a picture of its own.
*Tracked:* `docs/avatar-2d.md` §6; avatar-chibi-ai design §9 lays out the ingest order.

**The art is AI-generated, and that carries a licensing question this repository does not resolve.**
Every body, face, hairstyle, outfit, hat, bot and other picture starts from a prompt against the character's
locked block (`docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md`) run through a third-party image generator.
No named character or artist's name is ever put in a prompt, but the commercial terms of whichever tool
generates the final art are the operator's to read and accept — this codebase does not vendor a licence
and cannot vouch for one on the operator's behalf.
*Why it stays:* it is a legal question about a tool's terms of service, not an engineering one this
repository can settle by writing code.
*Tracked:* avatar-chibi-ai design §10 (risk table, "Pháp lý ảnh AI"); originals are kept at `assets/avatar-src/`
(gitignored, with a README recording the tool, the seed and the date) rather than committed.

**The chibi has one view, and does not turn.** Unlike the 3D avatar it replaced, a chibi is a flat stack
of `<img>` layers on a fixed 384×448 frame — there is no camera, no yaw, and nothing to drag or
arrow-key around. The profile and the wardrobe show the same front-on figure the seat plates do, just
larger.
*Why it stays:* avatar-chibi-ai design §1 ruled out WebGL and model loading entirely in favour of PNG
layers that render instantly on both editions; a second angle would mean a second full set of art per
item.
*Tracked:* avatar-chibi-ai design §1, §2.

**The chibi stands in one pose, and a skin colour is a tint of one body.** Since avatar v4 (No14) every body is
the same relaxed standing pose with five-fingered hands — there is no second pose or emote to choose — and the six
skin tones are the cream body recoloured through a skin mask, not six drawings. The outlines are shaded with the
tone (a fifth mask, `skinLine`, 2026-10-05: darker by the tone's lightness over the cream's, never lighter), so a
brown or deep hand no longer carries the cream's orange rim; and the skin that a hair or outfit picture redrew — the
forehead between strands, the instep inside a slipper — takes the tone too (Plan 20: the `ratio` tint of a mask of
its own; the royal robe's instep shadow drawn over the body's outline included). Plan 20 also mended three seams in
the art itself, which change the natural tone on purpose: the wavy hairstyle's back half has its front's lightness
(the pipeline recolours both halves against the front's reference, so the two light rectangles at the temples are
gone), and the hime's, the ponytail's and the wavy's front layers no longer carry a copy of the body's line below
the head (thin orange-brown lines along an outfit's shoulders and sleeves). What a tint still leaves alone is what a
picture drew as its own: at deep tones a few light specks remain, visible when zoomed — the Tết insteps' drawn white
highlights (under chroma 8, which stays white, as the body's own highlights do), a handful of strand-edge pixels
within ΔE 10 of a light hair's own colour, the ponytail's own light-orange highlights, and two faint leftovers on
the royal robe (5 px under the hem's left side, which the palette check keeps out, and 3 px outside the body's skin
and line), the last two seen only at 8×. Hairstyles belong to a
gender (four each); there is no hairstyle both genders can wear, and no rare hairstyle exists yet (the system
allows one: a hairstyle is an item).
*Why it stays:* the user chose one new pose for this round (spec 2026-10-03 Q1) and a tint over six drawn bodies
(Q2); a second pose is a second full set of body, faces, hairs and outfits, and a drawn skin tone is a body each.
*Tracked:* `docs/superpowers/specs/2026-10-03-avatar-v4-design.md` §2 (Q1–Q3) and §3 ("Không làm"); the mask
rules in `docs/avatar-2d.md` §4.4.1.

**The felt resizes slightly at the ring/stack breakpoint.** Crossing the breakpoint changes the table
layout and the felt's height with it. The action tray's height is reserved from 768 px up so that it
does not also move on every turn.
*Why it stays:* the two layouts have genuinely different heights — a seat ring needs vertical room a
two-row opponent strip does not — and freezing the felt to the taller of them would waste a phone's
vertical space on every hand to spare a one-off jump at a breakpoint few sessions ever cross.
*Tracked:* `docs/ui-kit.md` Known gaps.

**The squeeze peel is proven in Chromium, and has not yet been tried on a real phone.** The gesture (`PeelCard`, spec
2026-10-08 §3) is driven in a browser twice — a mouse drag on the desktop (`apps/normal-web/e2e/ops/04-blind.spec.ts` →
F-11) and touch events on an emulated 375 × 812 phone (F-12) — and both are Desktop Chrome; the unit tests use synthetic
pointer events under jsdom. Firefox and WebKit differ on pointer capture for touch: a touch starts out implicitly
captured by the element under the finger, so the card taking the capture makes that child *lose* it, and the
`lostpointercapture` bubbles up mid-drag. The card ignores a lost capture that is not its own and always drops back on one
that is, which `PeelCard.test.tsx` checks with synthetic events; no Firefox or WebKit build drives it. The user's own
check on a real device (spec §8: peel by touch, a quick flick then a quick tap on "Lật", iOS Safari) is still to do.
*Why it stays:* a device is needed, and the e2e projects are Chromium only.
*Tracked:* `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md` §8; `CHANGELOG.md` (Plan 21).

**A flick needs a run of movement to be read as one, on a device that does not coalesce pointer events.** The flick's
speed is taken from the pointer's real and coalesced positions (`getCoalescedEvents`) over its last 100 ms, and a pointer
with no new position for 40 ms has stopped — what came before the pause is no part of the flick. Where the browser
reports one position per frame and coalesces nothing, a finger that rests and then makes a single quick move before
the release gives the run one sample, no speed, and the card opens only if that drag took it past half.
*Why it stays:* Chromium, which the project's e2e runs in, does coalesce; counting the rest into the speed instead
would make a slow drag that ends in a twitch a flick, which is the error the pause rule exists to prevent.
*Tracked:* `packages/ui-kit/src/table/PeelCard.tsx` (`releaseSpeed`); `docs/ui-kit.md` (The squeeze).

**On a 375 × 812 squeeze table the stage overflows by 3 px while the cards are dealt.** The room header's badge row —
the mode, the limit and the gold "Nặn bài" badge — wraps one line longer at that width, which takes 3 px more than
the stage has. The page itself still fits and does not scroll sideways, and that is what F-12 asserts, not the stage.
*Why it stays:* 3 px, in one state at one phone size, would be paid for with a second header layout.
*Tracked:* `apps/normal-web/e2e/ops/04-blind.spec.ts` → F-12.

**A ring↔stack switch in the middle of a squeeze round can send a second `REVEAL`.** The seat remounts: a card peeled but
not yet reported comes back down, and the next "Lật" tells the table again. The server takes a repeated `REVEAL` as the
no-op it is (spec 2026-10-08 §6), so the cost is one frame.
*Why it stays:* harmless by design, and a window crossing the breakpoint during a 20 s round is rare.
*Tracked:* `packages/ui-kit/src/table/Seat.tsx` (`onCardUp`).

**Playground and e2e screenshots are not committed.** `packages/ui-kit/playground/screenshots/README.md`
describes what each shot should show; the e2e runs write real ones into
`apps/normal-web/e2e/screenshots/` and `apps/lite/e2e/screenshots/`, neither of which is in git.
*Why:* binary churn in review diffs, for images nothing asserts against.
*Tracked:* `docs/ui-kit.md`, `docs/normal-web.md`.

---

## Not limitations — things that were never in scope

Real money in any form: deposits, withdrawals, cash-out, payment gateways, cryptocurrency, NFTs, a
real-money marketplace. All currency here is virtual points, nothing is purchasable, and nothing
converts. This is requirement.txt §3 and spec §33's WILL NOT list, and it is not going to move.
