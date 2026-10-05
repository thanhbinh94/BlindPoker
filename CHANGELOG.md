# Changelog

Blind Luck Poker (called Just a Normal Poker until 2026-09-28) is built one plan at a time; each plan lands on `master` as a single merge commit. This
file has one section per plan, newest first, with the merge commit that carried it.

Nothing here has been released. Versions in `package.json` are `0.1.0` throughout; the sections
below are the real history.

---

## Plan 19 — avatar v4: gender, hairstyle and skin tone chosen separately; a natural pose with fingers (No13, No14) — merged `76555ef` (2026-10-05)

This is round 3 of the 2026-09-29 review, the new-generation character the user approved on 2026-10-03 ("lập plan và
làm luôn"). The record is `docs/bug-log.md` §7. The spec is `docs/superpowers/specs/2026-10-03-avatar-v4-design.md`.
There is no schema change and no SQL migration: old configs are read as v4, and the database is only written when a
player saves.

- **Gender, hairstyle and skin tone are separate choices (No13).**
  - The wardrobe's character group opens with a **Nữ | Nam** switch. Under it are the tabs **Kiểu tóc**, Màu tóc,
    **Màu da** and Màu mắt. The old "Nhân vật" tab, which picked a whole pre-drawn figure, is gone.
  - Each gender has four hairstyles, all free:
    - women: bob, long with a blunt fringe (hime), wavy, ponytail;
    - men: tousled, neat, curly, spiked.
  - Hairstyle cards are head portraits in the hair colour and skin tone being worn.
  - Skin comes in seven tones, all free: "Tự nhiên" (cream) and six more, from porcelain to deep brown.
  - Switching gender swaps only the hairstyle (to its counterpart) and the outfit's cut. Colours and every other item
    stay.
- **A new pose with fingers (No14).**
  - Every character, the eight bots included, now stands on one of two new bodies, one per gender. The pose is
    relaxed, and the hands have five fingers.
  - All art was redrawn with ChatGPT through the asset registry, after a style check the user approved:
    - 2 bodies with 6 expressions each;
    - 8 two-layer hairstyles;
    - 6 outfits, with male cuts of the dealer outfit and the Tết áo dài;
    - 8 bots.
- **Data.**
  - The avatar config is now v4: `gender`, a `hairStyle` item slot and a `skinColor` colour slot.
  - v1–v3 configs, both the one being worn and saved outfits, are read as v4. Hair and eye colours now survive that
    read; the old conversion dropped them.
  - An old figure's eyes get a free eye-colour item only when it keeps the look better than the new body's own eyes.
  - The server refuses a v3 config, an old base id, and a hairstyle of the other gender (`WRONG_GENDER`).
  - `/api/catalog/avatar` returns `bodies` instead of `bases`.
- **Hats.** No hat hides the hair any more. The front hair layer now holds the whole crown, so hiding it left a bald
  head; the hair sits under the hat instead.
- **Size.**
  - The 274 old base pictures are gone: avatar art is 17.6 MB, down from 26.2 MB.
  - The Lite exe ships only the files it draws, and is 95.3 MB.
- **Pipeline.** New tools and checks:
  - skin masks;
  - checks C11 (face skin), C12 (the head stays put) and C13 (a clean hair split);
  - registration before cutting, so a slightly zoomed ChatGPT picture no longer costs an attempt;
  - a hair or outfit picture's redraw of the body's skin is kept out of its layer, so the skin tone shows through.
- **Follow-up 2026-10-05: brown and deep hands lose their orange rim** (user: "sửa luôn viền tay ở tông nâu đậm"; merge
  `d04276e`).
  - The skin's outline was drawn for cream, and kept its saturated red-brown under every tone.
  - Every outfit picture also carries a redrawn copy of the arms' and hands' outline, drawn over the body.
  - A fifth mask kind, `skinLine`, covers both, and a skin colour now *shades* it rather than recolouring it: darker by
    the tone's lightness over the cream's, never lighter, keeping its own hue. Porcelain, fair and natural look exactly
    as before.

---

## Plan 18 — review 2026-09-29, round 2 (No1, No5, No8a, No9, No10, No11a) — merged `a2bd8cc` (2026-10-02)

This round covers six improvements the user approved on 2026-10-01 ("Đợt 2 làm theo đề xuất của bạn luôn"). The
record is `docs/bug-log.md` §7. There is no protocol or schema change and no migration. The asset pipeline gains one
output, icon tint masks: 8 new PNGs.

- **Natural Vietnamese (No9).** About a hundred strings were rewritten to read like a Vietnamese game rather than a
  translation, and two redundant Settings hints are gone. The full old → new list is in `docs/copy-review-2026-10.md`.
  Notable renames:
  - "Tạm nghỉ / Chơi tiếp" (sit out / sit in) and "Hủy sẵn sàng";
  - "Mời ra" instead of "Đuổi";
  - the wardrobe's "Nhân vật" / "Quần áo" / "Đang dùng";
  - "Đạt thành tựu mới".
- **The wardrobe shows what you own (No11a).** By default each tab lists only items you own. A box, **"Hiện cả món
  chưa có"**, adds the rest, and a tab with nothing owned says so. A colour variant you own keeps its family visible
  even when you don't own the original, and ticking the box only adds cards; it never replaces one.
- **One place for your items (No5).** The profile's separate inventory screen is gone, and the wardrobe holds
  everything. The old `#/inventory` address opens the wardrobe without leaving a step behind in the Back history.
- **Colour variants look their colour (No8a).** The red, navy, green and yellow tees (and the beret, beanie and party
  hat colours) used to share one white icon. Each now shows its own colour, and a family's card follows the variant
  you are wearing. The colour dots include the original, carry names, and have thumb-sized tap targets on phones.
- **Expression stepper (No10).** The six crowded expression buttons under the preview are now one `‹ Vui ›` row with
  previous and next buttons, arrow keys, and the name read out politely.
- **Cards turn over (No1).** An opponent's cards revealed at the showdown now flip over in about 0.6 s instead of
  snapping face-up. The result card waits for the turn (about 0.9 s), so the reveal can be seen. With
  reduced motion on, nothing flips and nothing waits.

---

## Plan 17 — review round 2 notes (R2-1 … R2-4) — merged `f6fe2f3` (2026-10-01)

These are the four notes the Plan 16 final review left open (`docs/bug-log.md` §7). There is no protocol, schema or
server change, and no migration.

- **Recent hands say the table once (R2-2).** A room named "Bàn 123" used to read "Tại bàn Bàn 123"; it now reads
  "Tại Bàn 123" (en "At Table 5").
  - The check is on the first word, in the page's language, ignoring case, with Unicode normalised first.
  - A bot opponent no longer reads "Bot 5 bot". Its chip shows "Bot 5" in muted italics, with the word "bot" kept for
    screen readers, so a human who calls themselves "Bot 5" still reads differently.
- **The tray says what the seat waits for (R2-3).** Under a finished hand it said "Waiting for your turn". It now says
  one of:
  - "Hand over";
  - "You folded — waiting for the next hand";
  - "You're all in — waiting for the result";
  - "Decided — waiting for the others" (Blind);
  - "Waiting for the reveal" (Blind, and a Hold'em run-out);
  - "Waiting for your turn" (between turns).
- **The viewer's own seat stays in sight (R2-3).**
  - Your own name plate on the table widens to fit the name, within a limit set by the neighbouring seats, so
    "Tam6z80" no longer reads "Tam…" on a 1280 or 1536 px screen.
  - The result card stops above your own seat on every desktop size (1920×940, 1536×730, 1366×768, 1280×720), so your
    stack, badges and hand stay visible. Its dark backdrop follows the card.
  - A 375×812 phone has no room for that, so there the card still covers the seat and closes with its button.
  - On short screens the card is shorter and scrolls inside itself.
- **The countdown is never announced (R2-4).** The result card is now a named group. Its live region holds only the
  title, the cancel note and the rows. The footer (fee, carry-over, uncalled return, countdown) sits outside every live
  region, so no screen reader re-reads the card each second. The fee lines are no longer read out automatically when
  the card appears.
- **A busy lobby is tested, and fits (R2-1).**
  - The browser suite now fills the lobby with six rooms of every kind by patching the room list on the page's
    WebSocket.
  - The new check found that two wrapped room names pushed a six-room lobby 3 px past the user's 1920×940 screen. A
    long room name now wraps beside its status badge, at most two lines, with the whole name in its tooltip.

---

## Plan 16 — review 2026-09-29, round 1 — merged `a836daa` (2026-09-30)

Ten items from the user's review of 2026-09-29 are fixed: the two P1 avatar-colour bugs, a dead pair of sign-in
links, how hand history reads, when an emptied room closes, four layout problems, and an automatic check that no text
sits on top of other text. The items that need the user's choice (round 2) or a spec of their own (round 3) are
untouched; email notifications (No7) are noted on the roadmap, not scheduled. The record of what was found and why is
`docs/bug-log.md` §7. Nothing here needs a database migration.

- **Hair and eye colours work again (No15, No16).** Normal's security policy (`img-src 'self' data:`) refused the
  recoloured avatar pictures, which the browser makes itself (`blob:`). Picking a hair colour made the whole head
  vanish, and picking an eye colour changed nothing (the base's blue eyes showed through). `img-src` now allows `blob:`
  in Normal, and nothing else in the policy moves; Lite is not affected. A recoloured layer that still fails to load
  falls back to the plain layer instead of leaving a hole. The twelve coloured items (a red t-shirt, say) show their
  colour for the first time. The test that should have caught it now checks that every avatar picture really decoded,
  and that the face and outfit layers are recoloured.
- **Sign-in and Register tabs (No6).** The links "No account yet? Register" and "Already have an account? Sign in"
  did nothing (the address flipped back mid-click) and only repeated what the two tabs do; they are gone.
- **Recent hands read properly (No4).** Profile → Recent hands showed a bot as `bot:<room code>:4` under a label that
  read as a table code. A bot is now "Bot 4", each hand says "At table `<room name>`", and the opponents' label is
  "Opponents". Old rows read the same way.
- **A room left with only bots closes at once (No3).** The last human leaving used to leave the room in the lobby as
  "Closing…" for 60 seconds. When bots are still seated the room now closes there and then (at the end of the hand if
  the player left in the middle of one), and a carried-over pot is released as it closes. A room with nobody at all,
  bots included, keeps its 60-second grace. A player who has only lost connection still counts as in the room until the
  five-minute spectator timeout. Two edge cases were settled while doing it: a hand that has just ended is settled
  before the room closes or the server shuts down (no player is paid their pre-hand stack, no pot is stranded on a
  closed room), and a Leave or Stand that arrives between a hand's last move and its settlement waits for the settlement (the
  seat counts as still in the hand until then), so **a host cannot kick a seat until the hand it is dealt into is
  settled**.
- **One footer for every dialog (No17).** The leave-without-saving, saved-outfit, sign-out (Normal and Lite) and
  buy-in dialogs each laid out their buttons their own way, flush against the text and pushed left or right. They now
  share one centred, wrapping button row with a clear gap above it. The create-room form's buttons follow the same rule.
- **The create-room dialog keeps its height (No12).** Flipping between Hold'em and Blind Poker made the dialog grow
  and shrink by a few pixels. The mode-specific fields now reserve the taller mode's height on wide screens.
- **Wardrobe and inventory cards line up (No8b, No11b).** Cards in a row share one height, the rarity sits under the
  name, and only the bottom lines (hint or date, colour dots) hug the card's foot. In the Title & Badge tab the
  "Badges" heading no longer sits against the "Hot Hand" card above it.
- **The table fits the screen (No2, No11b).** Joining a table no longer brings a vertical scrollbar on a desktop
  screen (checked at 1920×940 and three smaller laptop sizes): your own seat is two lines at most under the plate, the
  compact table starts at a taller threshold, and the lobby is no taller than the page. The "Next hand in…" countdown
  moved into the result card's footer, where it no longer prints over your seat; the card is capped at the table's
  height and its body scrolls inside it, fading at the foot while there is more to see (the pot ledger below the rows).
- **Text may not sit on text — checked automatically (No11b).** `expectNoTextOverlap` measures every visible line of
  text on a page and fails on any two that overlap within one layer (page, each dialog, the toasts). It measures the
  line box, not a share of the font size: an earlier 20 % rule missed exactly the countdown the user reported. It has
  self-tests on static fixtures, a failing twin for each passing case, and runs inside the existing end-to-end tests on
  the sign-in card, lobby, create-room dialog, table (waiting, in hand, result), profile, daily check-in,
  achievements, settings and the wardrobe tabs, at 1920×940, 1366×768 and 375×812; the operation pack adds Hold'em
  hands at 1440×900, 1920×940, 1366×768 and 375×812, and Blind hands at 1440×900. Besides the two spots the user
  reported, it found one more, on the phone: the viewer's pinned seat block let the board's "Pot" show under the
  hand name. That is fixed too (the block is solid now). It found nothing else.
- **The Blind end-to-end money check no longer flakes.** "One account plays a whole Blind hand against bots" compared
  the balance with the result card, but a flush or better pays an achievement (+3,000 and up) a moment after the hand
  settles, which made the check fail on those hands. It now waits until the ledger sums to the balance and takes
  achievement rows out before comparing (24 of 24 runs green, one of them a full house).
- **Docs.** `docs/bug-log.md` §7 records each fix; the main spec (§11.1, FR-R05, §30, §19.3) says when a room closes
  and why Normal accepts `blob:` images, and §34 lists email notifications (daily reminder, password reset,
  account-security mail) as future work; the operation test plan's S-06 and C-06 change and C-07, A-09, D-07, J-08 and
  M-05 are new.

---

## Plan 15 — Blind Poker table limit — merged `e0d7f57` (2026-09-29)

A Blind seat no longer plays from the whole balance. Sitting down brings `min(balance, 5 × wager)` to the table
(`buy_in`); hands move table stacks only, and the ledger records just the fee; every way off a seat takes the stack home
(`cash_out`). A seat whose stack can no longer cover a hand is stood up when the hand ends, told so
(`TABLE_LIMIT_SPENT`), and stays in the room until the player picks a seat again. The room header shows "Mức cược W ·
Hạn mức L", the create form says what the wager means as a limit, and a spectator who cannot afford a seat is told what
it needs. Bots play from a virtual limit topped back up to 5 × wager. Design:
`docs/superpowers/specs/2026-09-29-blind-table-limit-design.md`.

---

## 2026-09-28 — Renamed to Blind Luck Poker

The product name changes from "Just a Normal Poker" to **Blind Luck Poker** — a pun on the game's own Blind Poker mode, and no longer
colliding with the Normal edition's name ("Just a Normal Poker · Bản Normal"). Display names, page titles, the Lite shell, the
deploy kits' messages and the live docs change; internal ids stay (`@bp/*`, the `bp_session` cookie, `bind-poker-lite.exe`, the
repository name), so existing sessions, databases and Lite installs are untouched. Historical specs and plans keep the old name.

---

## Plan 11 — Chibi avatar from AI-generated art (Normal + Lite) — *unreleased (branch `plan11/avatar-chibi-ai`)*

Plan 8's 3D character is gone. In its place: a chibi assembled from PNG layers on a fixed 384×448
frame — two locked bases (F01/M01), six hand-driven expressions, wardrobe slots head/face/outfit/aura/
frame, five saved outfits — fed by a pipeline that turns AI-generated pictures into validated layers.
Design: `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` (supersedes the Plan 8 and
Plan 10 designs, both marked so).

- **An asset pipeline that runs before the art exists.** `apps/normal-web/scripts/avatar-pipeline.mjs`
  (Node + `sharp`) has four commands: `placeholder` draws the whole stage-1 set as labelled stand-ins
  so every screen and every test runs on synthetic layers from day one; `ingest` turns one generated
  picture into `@1x`/`@2x` layers, removing the green-screen background and, for a wardrobe item,
  extracting it by diffing against the aligned base rather than by any manual selection; `check` runs
  ten acceptance criteria (frame size, no stray alpha, no white fringe, the crop, the manifest, the
  budget); `sheet` composites everything for an eyeballed style gate. A manifest entry is marked
  `placeholder` or `real`, and `placeholder` never overwrites a `real` one — ingesting is a one-way door.
- **Server config v3.** `base`/`outfit`/`head?`/`face?`/`aura?`/`frame?`/`title?`/`badge?` replaces the
  3D config's body/skin/eyes/hair and seven geometric slots; old item ids remap through
  `data/item-aliases.json` so nobody's wardrobe goes empty on upgrade. Five saved outfits (a snapshot
  of a whole configuration, not of one item) get their own table and routes.
- **`@bp/ui-kit/src/avatar2d/`**: `Chibi` stacks one `<img>` per layer inside a 6:7 box or a round
  160×160 head-crop, both densities in `srcset`, lazy-loaded; `hashChibi` is the configuration's
  identity, stamped as `data-chibi-hash` for every test and every outfit-bar tile to key off. Bots draw
  their own two-layer art, never a wardrobe. Lite copies only the base and bot layers into its build and
  seeds every human seat from `defaultChibi(displayName)` — no wardrobe, no per-account config, the same
  figure on every device that ever reads that name.
- **The 3D system removed, end to end.** `src/avatar3d/` (three.js, the hidden WebGL renderer, the
  portrait cache, the turnable stage), the old asset pipeline and its `.glb` bundles, and the CSP
  directives they needed (`'wasm-unsafe-eval'`, `blob:` in `img-src`) are gone; the avatar is same-origin
  PNG `<img>`s and needs nothing wider than `default-src 'self'`. `test/footprint.test.ts` drops every
  three.js budget and adds one for the chibi's own `@2x` layers (≤ 6 MB, design §8); `e2e/avatar2d.spec.ts`
  replaces `avatar3d.spec.ts` and asserts the wardrobe, a seat and the outfit bar all agree on one hash.

## Plan 8 — 3D avatar (Normal) — *unreleased (branch `feat/plan8-avatar-3d`)*

The Normal edition's flat six-layer SVG avatar is gone, and in its place is a 3D character: pick a
body, a skin tone, an eye colour, a hair colour and a piece for each of seven slots, and the figure
in front of you is that person. Design: `docs/superpowers/specs/2026-09-05-avatar-3d-design.md`.

- **An asset pipeline, and its output committed.** `scripts/avatar-assets.mjs` turns 400 MB of CC0
  Quaternius packs into five `.glb` bundles and a `manifest.json` — 0.9 MB against a 6 MB budget —
  renaming every node to `<slot>/<itemId>/<body>` and every material to one of six names the
  renderer can recolour. Textures are dropped on purpose: the body's base-colour map bakes in one
  skin tone and the player picks from eight. `--check` re-verifies the committed artefact against
  the map that describes it, and a build that would exceed a budget writes nothing.
- **Clothes fitted to the bodies they are worn on.** The two packs were not modelled for each other,
  so every garment is retargeted onto the body's own rig and shrinkwrapped onto its skin at build
  time. Without it a garment sinks up to 5 cm into the body: trousers were a few ragged patches on a
  bare thigh and a t-shirt read as a crop top. `scripts/avatar-shots.mjs` renders the contact sheet
  that is the only way to see any of this.
- **Catalog v2, migrated in place.** `category` became `slot`, `clothing` split into `top`/`bottom`/
  `shoes`, `hat` was added, `base`/`face` were dropped, and every item now names the mesh it was
  modelled from for each body. A v1 configuration is migrated when it is read, so nobody loses an
  outfit; every account was granted the new default pieces.
- **Portraits rendered by the player's own browser.** One hidden WebGL context, one sequential
  queue, 128 px WebP cached in memory and IndexedDB by a hash of the configuration. Nothing is
  uploaded, nothing is rendered on the server, and a machine without WebGL gets the initial-letter
  disc it always had. three.js and everything under it sit behind one dynamic import — 150 KB gzip,
  downloaded only by a browser that actually draws a face.
- **A stage, and a wardrobe built around it.** The profile header and `/avatar` show the figure
  itself: a `role="img"` frame you can drag or arrow-key through ±60°, drawn only when something
  changes. The wardrobe offers only what the player owns, previews every tile as a portrait of *that
  outfit* — head and shoulders for what is worn above the chest, the whole figure for trousers and
  shoes — re-dresses what a change of body would have invalidated and says which, and guards an
  unsaved change on the way out.
- **Tested on a real GPU.** `e2e/avatar3d.spec.ts` asserts that portraits have pixels, that three
  configurations give three hashes, that a saved outfit survives a reload and reaches a second
  browser identically, and that the wardrobe works at 375 px — and logs how long a face takes to
  appear. Budgets are held by `test/footprint.test.ts` and by the pipeline itself.

## Plan 7 — Hardening — *unreleased (branch `feat/plan7-hardening`)*

The M9 milestone: prove what was built, close what the earlier plans left open, and write the
acceptance record.

- **A real multiplayer soak.** `runSoak` drives 6 clients over 3 rooms for 20 hands each (spec
  §29.3) through actual WebSockets, then asserts the invariants: money conserved, no `seq` gaps, no
  resyncs, latency inside budget. Measured 2026-09-05 over nine runs on the development machine
  (Windows 11 / Node 22.13) — 60–62 hands, 0 gaps, 0 resyncs, not one point created or destroyed,
  and p95 action → broadcast of 3–14 ms (Hold'em) / 4–34 ms (Blind) against §24's 50 ms, worst
  single sample 75 ms. The spread is machine load: the low end is the soak file alone, the high end
  the same runs sharing the machine with the rest of the suite. The test's own assertion is
  `< 200 ms`.
- **Edge-case coverage, written down.** `docs/test-matrix.md` maps every row of spec §29.2, §29.3
  and §30 to the test that holds it up — 42 rows, 11 of them new here, 1 partly covered with the
  reason stated, none skipped. The `reqId` replay contract was ruled on (it is per connection) and
  `docs/server-kit.md` corrected to match.
- **`SIT_OUT` / `SIT_IN`.** A seated player can sit out and back in: the current hand plays out, the
  ones after it are skipped, and five skipped hands in a row return the seat and the stack. Protocol
  in `@bp/core`, enforcement in `@bp/server-kit`, a toggle in the `@bp/ui-kit` room tray.
- **A security pass.** Every mutating route in *both* editions is now enumerated out of the
  assembled app and asserted to be CSRF-guarded and metered — Lite's general limiter was missing
  some. Added a static scan that no token, password, cookie, email or request body reaches a logging
  call, the `react-hooks` ESLint plugin, and `docs/security.md`: a threat table with the test that
  proves each row, a dated dependency audit, and what the operator still has to do.
- **Contrast and start-up.** The light theme's gold reached AA (3.93 → 4.93 on `--bg`), the three
  parchment islands that carried a copy of the old value came with it, and the remaining sub-AA
  pairs are pinned as `BELOW_AA` so they cannot quietly get worse. Lite's second-instance guard now
  verifies the live instance instead of trusting a stale run file.
- **The acceptance record.** `docs/acceptance-checklist.md` answers all 64 items of requirement.txt
  §40 and §66 with a citation each, machine-checked by `tooling/arch/acceptance-links.test.ts`;
  `docs/known-limitations.md` says what the thing does not do and why; this changelog; and the final
  README and spec pass.

## Plan 6 — Normal web — `035acd4` (2026-09-05)

The Normal edition's browser client, and the image that serves it.

- Vite/React app on `@bp/ui-kit`, served by the Normal server itself from `/app/public`: one origin,
  one cookie, nothing extra to deploy.
- Session gate on the cookie alone — no token in JavaScript, no `HELLO` on the socket — with a
  reconnect probe that tells a dead session apart from a bad network.
- Account screens: sign-in and registration, profile with sixteen counters and a paged ledger, daily
  check-in with the 31-day calendar, inventory, achievements, and an avatar editor.
- Avatars as SVG components keyed by the catalogue's `assetKey`, cached per player id, with a
  neutral silhouette for anyone the cache has not answered for yet.
- A Playwright pass over the built app against the real server on in-process PGlite: register, sign
  out, sign back in, play a Blind hand to settlement, and reconcile the balance against the payout
  and the fee from three independent sources.

## Plan 5 — Normal server — `bfb443d` (2026-09-05)

The Normal edition's backend, and the HTTP plumbing both editions share.

- PostgreSQL 16 + Drizzle with committed SQL migrations, run as a one-shot Compose job; the whole
  test suite runs on in-process PGlite through the same driver-neutral `AppDb`.
- Accounts: argon2id at OWASP parameters, a session whose database id is `HMAC(SESSION_SECRET,
  token)` so a stolen dump is not a set of cookies, rotated on sign-in and swept on expiry.
- A points ledger that is the single source of truth: every movement is a row, sinks included, and
  `Σ balance + Σ sink rows` is the invariant.
- Economy and progression: the 31-day daily table with item tiers, relief with a 24-hour cooldown,
  a 2% table fee, 32 achievements unlocked from a domain event bus, and an item catalogue.
- `@bp/http-kit` extracted: `.env` reading, JSON logger, rate limiter, static assets, security
  headers, CSRF guard and error envelope — identical in both editions, so kept in one place.
- A four-service Compose stack (app, `postgres:16`, migrate, Caddy) with backup and restore
  procedures.

## Plan 4 — Lite edition — `e70fcfb` (2026-09-04)

One Windows executable: server, web UI and database in a single file.

- Fastify + `node:sqlite` (WAL, `PRAGMA user_version` migrations), no native modules, no database
  server, no Internet.
- A React web app embedded in the executable as a SEA asset and read through `sea.getAsset()`;
  in development the same server reads `dist/public`.
- Sessions are a display name and a bearer token — no password, deliberately, for one trusted LAN.
- A single-exe build via Node SEA, with footprint budgets (JS, CSS, executable size) and a smoke
  test that boots the real `.exe`, reads `/health` and checks the exit code.
- A run file beside the data directory: a second instance on the same directory refuses to start,
  `--stop` drains the rooms and gives every buy-in back, and the wreckage of a hard kill is detected
  rather than trusted.

## Plan 3 — `@bp/ui-kit` — `b0b89c8` (2026-09-04)

The shared React client both editions render.

- A game client — connection with backoff and `HELLO` replay, a reducer that mirrors `playerView`
  frame by frame, snapshot/`RESYNC` recovery — verified against the engine over whole random hands.
- The poker table: a ring layout that becomes a two-row stack on narrow screens, seats for two to
  nine, community cards, pot, turn timer, and an action tray that holds its height between turns.
- Lobby, room and result screens, with the app supplying avatars and captions through slots so the
  kit never learns what a cosmetic is.
- i18n in Vietnamese and English with key parity enforced, and a theme in light, dark and night-felt
  variants driven entirely by tokens.

## Plan 2 — `@bp/server-kit` — `57675a0` (2026-09-04)

Rooms, realtime and everything around a hand that is not the hand itself.

- A WebSocket gateway with origin policy, authentication, heartbeat, per-connection ordering, flood
  and payload limits, and a 32-deep `reqId` replay buffer per connection.
- Rooms as serialized actors: joins, seat changes, actions, disconnects and hand completion never
  interleave, so a timer and an action arriving together apply exactly one of the two.
- Reconnect with a 90-second window and a full snapshot rather than a replay; expiry stands the
  player up and returns the stack.
- Bots scheduled with a think delay, timers for turns and decisions, carry-over pot release, and a
  shutdown path that cancels hands, refunds and notifies.
- Repository interfaces (players, balances, history) that an edition implements — the seam where
  PostgreSQL and SQLite plug in without the engine noticing.

## Plan 1 — Core engine — `546e460` (2026-09-04)

The pure game engine: no I/O, no edition, no dependencies.

- No-Limit Texas Hold'em: blinds, streets, min-raise, all-in that does not reopen raising, side
  pots, run-out, showdown, odd chips clockwise from the button, a 2% table fee capped at one big
  blind.
- Blind Poker in both variants (2 and 3 cards) and both modes (A: no decision; B: play or fold),
  with the carry-over pot when everyone folds.
- A hand evaluator checked against brute force over every 5-card subset of random 7- and 8-card
  hands.
- A deterministic reducer with timers left outside it, a filtered `playerView` per seat, and a
  money-conservation invariant asserted on every simulated hand.
- The wire protocol, display-name normalization for Vietnamese, the economy constants, and the
  pnpm/TypeScript monorepo scaffold with the dependency-graph test that has guarded the boundaries
  ever since.
