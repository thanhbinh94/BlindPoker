# Known limitations

Everything here is known, deliberate and written down somewhere else in the codebase as well. This
page is the single place to read it all at once: what the thing does not do, **why**, and **where
it is tracked** — the spec's roadmap (§34), a decision in Appendix A, another spec, or an operator
guide.

It is not a bug list. A bug is something that is supposed to work and does not; everything below
either works as designed and the design has a cost, or was scoped out on purpose.

The three rows of [`acceptance-checklist.md`](acceptance-checklist.md) that are not a plain ✓
(40.8, 66.21 and 66.40) appear here too, under **Operations**.

---

## Gameplay

**Blind Poker shows opponents' balances.** In a Blind room the seat *is* the balance (spec §8.1):
the ante comes straight out of it, there is no separate table stack to buy in with, and the room
snapshot has to carry a number for each seat so the client can tell who can still afford the wager.
Hiding it would mean inventing a second figure and keeping it in step with the real one for no
gameplay benefit. Hold'em is unaffected — there the table stack is genuinely separate from the
balance, and only the stack is published.
*Why it stays:* it is what the ruleset is. *Tracked:* spec §8.1 and §11.3; a design limitation, not
a roadmap item.

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
(`Room.seatedHumans()`), which since Plan 7 includes seats that have asked to sit out. Money is
still exactly conserved — the `Σ balances + Σ sinks` identity is untouched, and the Blind soak
asserts it every run — but a player who declined to play shares a pot they were never eligible for.
*Why it stays:* spec §8.4 predates `SIT_OUT` and says "the seated humans" without qualification, so
excluding sitters is a rule change rather than a bug fix, and it is a rule change in the direction
of taking points away from somebody. Ruled a roadmap item rather than a fix in this milestone.
*Tracked:* here; spec §8.4 needs either the exclusion or a sentence saying seated-but-sitting-out
still counts.

**History names opponents by their recorded label.** A hand's history row stores each seat's id and
a label. When the account behind a seat is gone — or the seat was a bot, which has no account — the
listing falls back to that recorded label rather than a live profile lookup
(`apps/normal-server/src/history/history-service.test.ts` → "falls back to the recorded id when the
account behind a seat is gone").
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
drain: balances already written to SQLite stay correct, but chips sitting on a Hold'em table and a
carried-over Blind pot are gone. Only `--stop`, `Ctrl`+`C` / `Ctrl`+`Break`, or NSSM (which sends
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
already written to PostgreSQL stay correct, because every entry is inside a transaction, but chips
sitting on a Hold'em table and a carried-over Blind pot are gone.
*Why it stays:* the kit is for an internal LAN trial, where the answer is to close the rooms first;
building a graceful stop for it means adding a run file and a stop protocol to the Normal server for
the sake of a test harness. Recorded as decision D3 of the free-tier deployment design.
*What to do:* wait for tables to empty before running `stop.ps1`. On a real deployment this does not
arise — `docker compose stop app` is a graceful stop, and the server refunds every committed chip and
cashes table stacks back into balances before it exits.
*Tracked:* `deploy/normal-windows/README.md`; the free-tier deployment design §3 and Appendix D3.

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

**`--red` as ink is below WCAG AA on dark surfaces.** Five entries covering three distinct token
pairs are on record: `--red` on `--bg` (3.59:1) and on `--bg-elev` (3.22:1) in **both** the dark and
the night palette — that is four of the five — and the same defect repeated on the felt's own darker
ground, `.panel.felt`'s `--red` on its local `--bg` (**3.13:1**). One token cannot fix it — on `#0b1020` an ink needs a luminance
above ~0.20 to reach 4.5:1, while the same token used as a *fill* under `--red-ink` needs one below
~0.17. Everything else in all three palettes is at or above AA, including the light-theme gold that
Plan 7 corrected (3.93 → 4.93 on `--bg`, 4.26 → 5.34 on `--bg-elev`, 4.30 → 5.39 for `--gold-ink`).
*Why it stays:* closing it means splitting `--red` into ink and fill the way `--teal` / `--teal-fill`
already are — a palette change across `ui-kit`, `lite-web` and `normal-web`.
*Tracked:* the pairs are pinned as `BELOW_AA` in `packages/ui-kit/src/theme/tokens.test.ts`, which
fails if any of them gets *worse* — or if one is fixed and its line is left behind; roadmap §34
item 10; `docs/ui-kit.md` Known gaps.

**Badges are ink on their own tint, at roughly 4.1–4.4:1.** `--gold` on `--gold-soft`, and the same
for red and teal. The contrast test measures flat token pairs; a composited translucent tint is not
asserted.
*Why:* the pattern is used for decoration that always has a text label beside it, and the alert in
`lobby.module.css` already avoids it by keeping `--ink` text and letting the rule and the tint carry
the signal.
*Tracked:* `docs/ui-kit.md` Known gaps.

**No Vietnamese web font is bundled.** `--font-display` names a face and then falls back to
Cambria / Constantia / Segoe UI, all of which carry the precomposed Vietnamese glyphs — and Windows,
which has all three, is the only host Lite runs on. A test pins the fallback list so a future edit
cannot quietly drop Vietnamese coverage.
*Why:* bundling one means downloading a font file at build time and running a subsetter, which is a
build-pipeline change of its own.
*Tracked:* `packages/ui-kit/src/theme/tokens.test.ts` → "reaches a Windows face with full Vietnamese
coverage before the generic serif"; roadmap §34 item 9.

**Most of the wardrobe is an approximation of a mesh that does not exist.** The 3D avatar is built from
the **free tier** of two CC0 Quaternius packs, which between them ship five hairstyles and two outfits
per body — against a catalogue of six hairstyles, seven tops, four bottoms, three pairs of shoes, three
hats, three accessories and five pieces of jewellery. So `hair_curly` is the parted cut puffed out,
`bottom_skirt` is the peasant leggings cut short and flared, and eleven items (every hat, accessory and
piece of jewellery) are **generated from boxes, spheres, cones and tori** by the asset script itself,
because a fantasy hood is not a nón lá and a pauldron is not a wedding ring. The mask and the sunglasses
are honestly placeholder-grade.
*Why it stays:* the paid tiers have eight bodies, twenty hairstyles and more outfits; buying one, or
adding a Casual pack, is what replaces these, and each item is one map entry away from being swapped.
*Tracked:* the full table is in `docs/avatar-assets.md` → "Approximations and known limitations"; the
avatar-3d design §9 lists it as the plan's first risk.

**The bodies and the clothes come from packs that were not modelled for each other.** The bodies are the
base pack's muscular *Superhero* build; every garment is cut for the outfit pack's slimmer *Regular*
body, which no free download contains. The build closes the gap by retargeting each garment onto the
body's rig and then **shrinkwrapping it onto the skin** plus a per-slot margin (`docs/avatar-assets.md`
→ "Fitting a garment"), so what a player sees is close-cut clothes rather than a shirt with a chest
coming through it. Two consequences to know about: a fitted garment takes the body's silhouette, so
nothing drapes or hangs; and a garment whose mesh is coarse enough — or has been stretched far enough —
that a flat triangle spans a limb can still show a patch of skin through it, which is why three items
carry a larger `fit` margin of their own.
*Why it stays:* the alternative is redrawing meshes, which avatar-3d design §2.2 puts out of scope.
*Tracked:* `docs/avatar-assets.md`; `apps/normal-web/scripts/avatar-shots.mjs` is how a regression here
is seen.

**The avatar does not move, and never has more than two poses.** The `.glb` files ship the packs' bind
pose (a T-pose) and one published recipe for standing it up (`manifest.pose.armsDown`, four arm joints);
the portrait camera crops that to head and shoulders and the stage frames the whole of it. There is no
idle animation, no expression, no gesture, and no walk — every animation track is stripped by the asset
pipeline, deliberately, because they are 400 MB of the source packs and nothing in the product plays one.
The stage turns, and that is the extent of the motion.
*Why it stays:* avatar-3d design §2.2 puts animation out of Plan 8 and §10 lists idle animation as the
first thing after it.
*Tracked:* avatar-3d design §10.

**The metals are lit by a procedural environment, not a real one.** `metal` materials (the crown, the
glasses' rims, the earrings, the pauldron) have `metalness = 0.9` and therefore almost no diffuse
response, so under directional lights alone they render as black silhouettes however bright the lights
are. What lights them is three.js' own `RoomEnvironment` prefiltered by `PMREMGenerator` — a procedural
box of area lights, ~2 KB gzip of code and no HDR file to download — at `environmentIntensity = 0.55`.
It reads as a plausible interior and not as jewellery photographed in a studio; gold looks slightly flat
and there are no sharp reflections. A driver that cannot build a PMREM gets `null` back and dull metal
rather than no figure.
*Why it stays:* an HDR environment map is a download nobody has budgeted, for jewellery seen at 128 px.
*Tracked:* `apps/normal-web/src/avatar3d/environment.ts`.

**A cold browser takes about three seconds to draw its first face.** The design's budget is ≤ 80 ms per
portrait *after the assets are loaded* and ≤ 2 s to fill a nine-seat table; both hold — the e2e measures
~60–100 ms per re-render and ~0.3 s from joining a room to every seat portrait drawn. The first one is
different: it pays for the 150 KB gzip three.js chunk, the manifest and up to five `.glb` files before it
can render anything, and `avatar3d.spec.ts` measures ~3.0–3.5 s for it on a headless SwiftShader machine.
Until then every face is the player's initial on a disc, which is the designed fallback. That number is
now **asserted** against a 5 s ceiling from a fresh browser context, so a cold regression turns the suite
red rather than only making it slower; the 5 s is a guard rail set clear of the measurement, not a target.
*Why it stays:* it is one cold start per browser — everything after it is cached in IndexedDB by
configuration hash — and the alternative is server-rendered images, which avatar-3d design §2.2 rules out.
*Tracked:* avatar-3d design §5, §7; `apps/normal-web/e2e/avatar3d.spec.ts` asserts and logs both numbers
every run.

**Nothing tests nine cold seats at once.** Design §7's budget is *nine* faces inside two seconds, and the
e2e's table is one human and one bot. The two timings it does assert bracket that case rather than cover
it: the warm one measures a table reached through the lobby, where the player's own face is already a blob
in IndexedDB, and the cold one measures a single first face from an empty browser. Nine cold portraits
would queue behind one shared asset download and one renderer, and nothing here would notice if that
queue started serialising badly.
*Why it stays:* nine seats means eight more accounts, each registered, dressed and seated, in one test —
several minutes of an e2e suite that runs on every change, to defend a case (nine strangers, all
first-seen, all at once, on a cold browser) that the lobby's own portraits usually warm up first. The
per-portrait cost is covered instead: `avatar-shots.mjs` renders 68 of them through the real pipeline and
reports a median of ~69 ms.
*Tracked:* here; avatar-3d design §7.

**The felt resizes slightly at the ring/stack breakpoint.** Crossing the breakpoint changes the table
layout and the felt's height with it. The action tray's height is reserved from 768 px up so that it
does not also move on every turn.
*Why it stays:* the two layouts have genuinely different heights — a seat ring needs vertical room a
two-row opponent strip does not — and freezing the felt to the taller of them would waste a phone's
vertical space on every hand to spare a one-off jump at a breakpoint few sessions ever cross.
*Tracked:* `docs/ui-kit.md` Known gaps.

**The Lite parchment island has no contrast test of its own.**
`apps/lite/web/src/screens/lite.module.css` re-declares `--ink`, `--ink-muted`, `--gold` and `--red`
on the same printed-paper gradient as ui-kit's `.ticket` and `.panel.parchment`, and Plan 7 had to
correct its `--gold` by hand. `packages/ui-kit/src/theme/tokens.test.ts` → "keeps the parchment
islands at AA on the darker end of their paper" covers the two ui-kit islands, but it reads
`ui-kit`'s own stylesheets and cannot reach an app's CSS, so a future edit to the Lite copy could
regress AA with nothing turning red.
*Why it stays:* the fix is a small contrast test under `apps/lite/web` (or exporting `contrast` /
`tokensOf` from ui-kit so the app can reuse them rather than copy eight lines) — worth doing, and
not worth doing in the last fix wave of a hardening milestone.
*Tracked:* here, and `docs/ui-kit.md` Known gaps.

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
