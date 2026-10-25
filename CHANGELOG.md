# Changelog

Blind Luck Poker (called Just a Normal Poker until 2026-09-28) is built one plan at a time; each plan lands on `main`
(named `master` until 2026-10-11) as a single merge commit. This file has one section per plan, newest first, with the
merge commit that carried it. Branches follow `<prefix>/BP-<n>-<slug>` since 2026-10-13 (`CLAUDE.md` §6).

Nothing here has been released. Versions in `package.json` are `0.1.0` throughout; the sections
below are the real history.

---

## BP-35 — eight outfits and twelve accessories for Halloween, winter and the beach, three of them epic, and five achievements — merged `2375317c` (2026-10-25)

The user, 2026-10-25: "thêm 8 bộ trang phục, 12 phụ kiện (thuộc ít nhất 3 chủ đề tự chọn trong đó có halloween, có siêu
hiếm), chạy luôn". Spec `2026-10-25-wardrobe-halloween-design.md` (themes Đêm Halloween, Đông & Noel, Hè biển; §6 records
the result). Branch `feature/BP-35-wardrobe-halloween`. Task A put the catalogue on stand-ins; the lead drew the twenty
pictures in ChatGPT in the user's Chrome and ingested them; Task C moved the pins and wrote the docs.

- **What a player sees.** Twenty new pieces in the Phòng thay đồ and the Cửa hàng, each drawn on the chibi and worn by
  both bodies, three of them epic ("Cực hiếm"). Fifteen are sold at the shop's seed price (common
  10,000 points from rank 1, rare 30,000 from rank 3, epic 150,000 from rank 4; a GM can change any): the commons Bộ đồ
  bộ xương, Áo len Giáng sinh, Áo phao mùa đông, Sơ mi Hawaii, Sừng quỷ nhỏ, Mặt nạ dơi, Chụp tai lông, Mũi đỏ tuần lộc
  and Mũ rơm; the rares Váy phù thủy, Mũ phù thủy, Mũ Noel, Vòng hoa Hawaii and Kính trái tim; the epic Bá tước ma cà
  rồng. Five are won, never sold, through five new achievements on counters the game already keeps: **Ông già Noel của
  sảnh** (200 check-in days) gives the epic Áo Ông già Noel; **Tuần lộc chăm chỉ** (a 14-day check-in streak) the rare
  Bờm sừng tuần lộc; **Bí ngô mù quáng** (500 Blind hands) the epic Mũ bí ngô; **Thủy thủ khắp bàn** (50 rooms joined)
  the rare Đồ thủy thủ; **Đi ngang vẫn thắng** (7 hands won in a row) the rare Cua cưỡi đầu. Each achievement also adds
  the item reward's reputation. The witch hat, the pumpkin, the Santa hat and the straw hat clip the hair under their
  crown; the devil horns, the earmuffs, the antlers, the flower crown and the crab sit on the hair. The witch hat is a
  soft emerald hat whose tip droops to the side, not a tall black cone (below).
- **Under it.** `items.json` (twenty rows, 107 → 127), `achievements.json` (five rows, 39 → 44), both locales (names and
  achievement texts in vi and en); the pipeline's `STAGE_ONE_ITEMS` (156 names) and `HAIR_CLIP` (ten hats);
  `assets/avatar-src/registry.json` (twenty-one `v4/item_<slot>_<code>` entries: the twenty, plus
  `v4/item_head_witch_hat01_b`, which supersedes the blocked first witch hat); 120 files in
  `apps/normal-web/public/avatar/` (each outfit's L40, skin and skin-line masks and icon, each head and face item's layer
  and icon, the four covering hats' hair clips, at @1x and @2x) and both manifests (157 real entries, one stand-in: the
  withdrawn hood); both contact sheets. No engine, protocol, schema, migration or dependency change; the shop seeds twenty
  price rows at the next boot (`seedPrices`, 107 → 127), the five rewards' rows disabled.
- **Tests.** Task A: the catalogue (127 items), the achievement catalogue (44, the five pinned), the shop seed (127 rows,
  the vampire count at the epic seed, the five rewards off sale), the locale parity, the stage-1 list (156), the sheets'
  card counts (44 outfit cards, 272 fit cards). Task C, on the real art: the clipping hats (`items.test.ts`, sixteen with
  the witch hat, the pumpkin, the Santa hat and the straw hat), the skin lines of twenty-four outfit layers and the
  redrawn skin of six (`bodies.test.ts`; `avatar-pipeline.test.ts` — the witch dress joins for a sliver of neck above its
  cape's brooch, the one outfit skin not at the feet), and the "never takes a covering hat's hair from below the hat's
  edge" case walks all ten `HAIR_CLIP` hats again (80 composed pairs, 120 s timeout). The sheets were regenerated from the
  final layers and match the pinned layouts (129 cards, 2460 × 3548; 272 fit cards, 1772 × 8716). The avatar layers weigh
  21,584.5 KB at @2x across 360 files, under the 32 MB footprint budget. Unit: normal-server 797 + 1 skipped, normal-web
  1,092 + 4 skipped (the footprint test's four bundle checks, with no `dist`; the ten-hat walk took 5.9 s under load).
  `avatar:check`: 158 files, 2,054 checks, 0 failures.
- **Docs.** `docs/avatar-2d.md` (§2 the clip on ten hats, §6 the mix back to one stand-in, §10.1 the `_b` entry, §10.7
  extended: tall hats and the shrinking figure, the bob and a hat colour clear of purple, drafts judged before
  `collect`), `docs/known-limitations.md` (the floppy witch hat, `verify`'s advisory width for head items, no male cuts,
  the antlers on brown hair, no backfill; the shop shelf's counts), `docs/lessons-learned.md` (a BP-35 section), the
  spec's §6.
- **Khác với spec / Deviations from the spec.** The witch hat is a soft, floppy deep-emerald hat with a black band whose
  tip droops to the side, drawn over `f_bob01`, not the spec's tall pointed black hat with a wide brim and a purple band
  over `f_wavy01` (§3.2): three tall black pictures shrank or redrew the figure and pulled face and hair into the hat
  layer, and the replacement entry is `v4/item_head_witch_hat01_b`. The vampire count's cape hangs straight and close
  behind the body, never wider than the arms, not "falling to the calves" in a sweep (its first picture flared past the
  hands). The earmuffs' prompt gained a line about the transparent background. The English names and texts of the twenty
  pieces and five achievements were written by the session, not asked for by the user.
- **Gate** (on the branch after `main` with BP-34 was merged in, the merge tree): typecheck and lint clean; unit 3,467
  passed, 18 skipped; `build:normal` ok; `build:lite` up to the exe step, which needs Node 22 (this machine has 24);
  `avatar:check` 158 files, 2,054 checks, 0 failures; e2e Normal 24/24; e2e Lite 4/4; ops 56/56 — all on the first run.
- **Deployed.** Not yet.
- **Still open.** The witch hat is not the classic tall cone; a taller one waits on a way to keep the figure from
  shrinking. `verify` only notes a head item's width ratio, so a shrunken figure under a hat passes it; a hard limit
  (about 0.985–1.015, measured on the head so an arms-out party hat still passes) is recommended in
  `docs/known-limitations.md`, not built. No male cut was drawn: all eight outfits render on body m from the f cut, and the
  witch's dress is a dress on body m too. The brown antlers read faintly on a brown hair colour. The new achievements are
  not granted back: a player already past a threshold gets it the next time its counter moves. The pieces on a real phone
  and the sheets (`docs/avatar-2d-sheet.png`, `docs/avatar-2d-fit-sheet.png`) are the user's to look at; "<id> ng" sends a
  piece back to the queue. Lite draws none of them.

## BP-34 — the Blind e2e tour sits out before it plays, so a slow reveal can no longer cost it a second ante — merged `d85cde5` (2026-10-25)

The user, 2026-10-25: harden "một tài khoản chơi trọn một ván Blind với bot", which lost one ante under CPU load during
BP-33's gate (BP-33 "Still open"; `docs/bug-log.md` §11). Branch `bugfix/BP-34-blind-e2e-second-hand`. Test only.

- **What a player gets.** Nothing changes for a player: no game code, no copy, and the five-second next-hand timer stays.
- **Under it.** The test played its hand seated and left after reading the result card and taking a screenshot. The
  server's timer runs from the settlement, not from the card. Under load the card appeared about 8.6 s after "Chơi", the
  footer read "Ván tiếp theo sau 0 giây" before the "Rời phòng" click, a second hand was dealt, and the leave folded it
  and lost its ante (balance off by 1,000). The test now presses "Tạm nghỉ" while the hand is on and then "Chơi" (the
  existing `sitOutAndPlay`, as step 6 and ops `04-blind` already do). With only the bot left in, no next hand is dealt, so
  the card's numbers are final however late the leave comes. The ledger could not have caught the extra ante: a hand
  moves only the table stack, and a Blind seat writes only its buy-in and cash-out rows.
- **Tests.** `apps/normal-web/e2e/normal.spec.ts` → "một tài khoản chơi trọn một ván Blind với bot" (name unchanged, still
  one sign-up). `--repeat-each 5` with every core but one busy-looping: 5/5. One run with a temporary 7 s pause before
  "Rời phòng" (longer than the timer, so a second hand was certain without the fix) passed. The pause was taken out
  before the commit.
- **Docs.** `docs/bug-log.md` §11; BP-33's open item points here; `docs/lessons-learned.md` (three rulings, two lessons).
- **Khác với spec / Deviations from the spec.** None.
- **Gate** (branch tree after merging `main` at `96571c3`; `main` then gained only `98c745e`, a CHANGELOG line, which was
  merged in and the doc citations re-run, 42 passed): typecheck and lint clean; unit 3,471 passed, 14 skipped, no
  timeouts; `build:normal` ok; `build:lite` up to the exe step, which needs Node 22 (this machine has 24);
  `avatar:check` 138 files, 1,794 checks, 0 failures; e2e Normal 24/24; e2e Lite 4/4; ops 56/56.
- **Deployed.** Nothing to deploy: the change is a test and its docs.
- **Still open.** Nothing from this item. `docs/bug-log.md` E6 (the room drops "ready" on its way back to open without
  telling the client) is untouched: the test leaves the room before it could matter.


## BP-33 — eight outfits, ten accessories and five achievements, drawn in ChatGPT — merged `799d307` (2026-10-25)

The user, 2026-10-24: "chạy quy trình liên kết với ChatGPT (trên Chrome) để sinh thêm ít nhất 8 bộ trang phục và 10 phụ
kiện mới (từ cấp độ thường đến hiếm, tự phân loại có mua được không hay mở theo thành tựu)", then "tự chọn chủ đề đi, chạy
luôn". Spec `2026-10-24-wardrobe-batch-design.md` (the theme "Đêm Sài Gòn" goes out on the street; §6 records the result).
Branch `feature/BP-33-wardrobe-batch`. Task A put the catalogue on stand-ins; the lead drew the eighteen pictures in
ChatGPT in the user's Chrome and ingested them; Task C moved the pins and wrote the docs.

- **What a player sees.** Eighteen new pieces in the Phòng thay đồ and the Cửa hàng, each drawn on the chibi and worn by
  both bodies. Thirteen are sold at the shop's seed price (common 10,000 points from rank 1, rare 30,000 from rank 3; a GM
  can change either): the commons Áo hoodie xanh than, Bộ thể thao đỏ, Áo bà ba nâu, Mũ lưỡi trai xanh than, Mũ tai bèo
  kaki, Băng đô đỏ, Kính gọng vuông đen and Băng cá nhân; the rares Áo bomber đêm neon, Áo dài xanh ngọc, Bờm tai mèo, Hoa
  sen cài tóc and Kính phi công. Five are won, never sold, through five new achievements on counters the game already
  keeps: **Tri kỷ của bot** (200 hands with a bot at the table) gives the common Áo khoác jean; **Thám tử bàn bài** (500
  Hold'em hands) the rare Áo măng tô thám tử; **Phúc lộc đầy nhà** (250 Blind hands won) the rare Áo gấm đỏ; **Tay chơi
  lớn** (250,000 points won in one hand) the rare Mũ phớt đen; **Khách quen** (60 check-in days) the rare Kính một tròng
  vàng. Each achievement also adds the item reward's reputation, as every item achievement does. The cap, the bucket hat
  and the fedora clip the hair under their crown; the headband, the cat ears and the lotus pin sit on the hair.
- **Under it.** `items.json` (eighteen rows, before the hairstyles), `achievements.json` (five rows, 34 → 39), both locales
  (names and achievement texts in vi and en); the pipeline's `STAGE_ONE_ITEMS` (136 names) and `HAIR_CLIP` (six hats);
  `assets/avatar-src/registry.json` (twenty `v4/item_<slot>_<code>` entries: the eighteen, plus `v4/item_head_cap_navy01_w`
  and `v4/item_head_fedora01_w`, which supersede the first cap and fedora); 110 files in `apps/normal-web/public/avatar/`
  (each outfit's L40, skin and skin-line masks and icon, each hat's and face item's layer and icon, the three covering hats'
  hair clips, at @1x and @2x) and both manifests (137 real entries, one stand-in: the withdrawn hood); both contact sheets.
  The source pictures were not on this machine, so the references `verify` reads were rebuilt from the committed layers
  (`docs/avatar-2d.md` §10.7). No engine, protocol, schema, migration or dependency change; the shop seeds the thirteen
  prices at the next boot (`seedPrices`, 89 → 107 rows) and keeps the five rewards off sale.
- **Tests.** Task A: the achievement catalogue (39, the five pinned), the reputation chain (`login_days_60` before
  `login_days_100`), the shop seed (107 rows, a sold piece at its rarity's price, the five rewards off sale), the daily
  draw's reserved ids, the locale parity, the stage-1 list (136), the sheets' card counts (28 outfit cards, 176 fit cards).
  Task C, on the real art: the clipping hats (`items.test.ts`, twelve with the cap, the bucket hat and the fedora), the
  skin lines of sixteen outfit layers and the redrawn skin of five (`bodies.test.ts`; `avatar-pipeline.test.ts`), and
  the "never takes a covering hat's hair from below the hat's edge" case now walks every hat in `HAIR_CLIP` (six, 48
  composed pairs, with a 60 s timeout: with three it had already timed out at 5 s under a full run). The sheets were
  regenerated from the final layers and match the pinned layouts (113 cards, 2460 × 3276; 176 fit cards, 1772 × 5644).
  Unit: normal-server 797 + 1 skipped, normal-web 1,092 + 4 skipped (the GM-console route and `GiftsTab` timed out under
  load and pass alone), ui-kit 777. `avatar:check`: 138 files, 1,794 checks, 0 failures.
- **Docs.** `docs/avatar-2d.md` (§2 the clip, §6 the mix back to one stand-in, §10.1 the `_w` entries, §10.7 new: the
  rebuilt references, dark hats over a light hairstyle, the composed-figure look), `docs/known-limitations.md` (the brim
  specks, the rebuilt references, no male cuts, no backfill; the shop shelf's counts), `docs/lessons-learned.md` (a BP-33
  section), the spec's §6.
- **Khác với spec / Deviations from the spec.** The trench coat is camel-brown, not beige (the beige one lost its pocket
  area to the skin cut). The áo dài wears black closed shoes, not white flat ones (one white shoe was cut as skin). The cap
  and the fedora were drawn over `f_wavy01`, not the default `f_bob01` (§1: "đội kiểu tóc mặc định"), under new registry
  ids with a `_w` suffix. `bot_hands_200` is "Tri kỷ của bot / One of the machines", not the spec's first "Bạn của bot /
  Bot buddy", so it outranks the 50-hand "Bạn thân của bot" (the spec's table was amended). The English names and texts
  of the eighteen pieces and five achievements were written by the session, not asked for by the user.
- **Gate** (branch tree = the merge tree; the machine was under heavy load from another program): typecheck and lint
  clean; unit 3,463 passed, 18 skipped, 4 timed out at 5 s (two in `AuthScreen.test.tsx`, two in `ShopTab.test.tsx`; all
  four, and the GM-console route and `GiftsTab` that timed out in a normal-web re-run, pass alone); `build:normal` ok;
  `build:lite` up to the exe step, which needs Node 22 (this machine has 24); `avatar:check` 138 files, 1,794 checks, 0
  failures; e2e Normal 24/24 on the second run (the first lost "một tài khoản chơi trọn một ván Blind với bot" to a
  next-hand race, below); e2e Lite 4/4; ops 56/56.
- **Deployed.** On the VPS since 2026-10-25, shipped by git bundle ahead of the push (`6487c36..96571c3`; backup
  `bp-2026-10-25-1027`, no migration, the shop seeded 18 price rows, health ok; the user's own test room was closed by
  the restart, on their word). The LAN host was not touched. Lite rebuilt locally up to the exe step, not shipped.
- **Still open.** A few light specks of the wavy fringe under the cap's brim and at the fedora's brim ends, over a dark
  hairstyle. No male cut was drawn: all eight outfits render on body m from the f cut, the áo dài included. The new
  achievements are not granted back: a player already past a threshold gets it the next time its counter moves. The
  pieces on a real phone and the sheets (`docs/avatar-2d-sheet.png`, `docs/avatar-2d-fit-sheet.png`) are the user's to
  look at; "<id> ng" sends a piece back to the queue. Lite draws none of them (it ships only the default outfit and hairs).
  The Blind e2e "một tài khoản chơi trọn một ván Blind với bot" can lose one ante under CPU load: the result card shows
  late, the server's five-second timer (started at settlement) deals the next hand before the test leaves, and the
  balance comes out 1,000 short (seen in the trace as "Ván tiếp theo sau 0 giây" before the "Rời phòng" click). No game
  code changed here; hardening the test is a separate task (done in BP-34: the test sits out before it plays).

## BP-31 — the phone table gets a fanned hand and a one-row tray, a raise is a slider on every frame, and a Blind table takes ten wagers — merged `e35ea39` (2026-10-23)

The user, 2026-10-23: "khi xoay ngang màn hình hoặc xoay dọc ở lúc vào bàn, thiết kế các nút quá to, khá khó nhìn bài",
"trên điện thoại ở cả 2 mode". The brainstorm the same day chose layout B with a fanned hand (Q1), a slider instead of a
typed amount (Q2), on the desktop too (Q3), a Blind limit of ten wagers (Q4), and four rows of the 2026-10-22 UI review
that sit on the table: P1, P7, P10, P13 (Q5) — spec `2026-10-23-phone-table-bet-slider-design.md`, rulings R1–R12. Branch
`feature/BP-31-phone-table-bet-slider` from `main` after BP-30; Task 1 ran on its own branch and was merged in (`14d4b9d`).

- **What a player sees.** On a phone held upright (or any window under 768 px wide or 620 px tall) my two or three cards
  are big — 56 px wide at 375 px, 60 px from 400 px — and fan out over the felt's foot, above a one-line strip with my
  face (the turn ring and the D on it), name, stack, bet, Chủ phòng and rank. The tray is one row of 44 px buttons:
  Bỏ bài · Xem or Theo · Tố ▴ in Hold'em, Tự động chơi · Bỏ bài · Chơi in Blind. "Tố ▴" opens a panel in place of the row —
  Min · ½ pot · Pot · Tất tay over a slider, "Hủy ▾" and "Tố 48.000" — and "Hủy ▾" or Esc folds it back. Đứng dậy, Tạm nghỉ
  / Chơi tiếp, Quản lý bàn and Toàn màn hình move into the header's ⋯ ("Thêm"), as on a landscape phone, and between hands
  a one-row dock holds Sẵn sàng / Hủy sẵn sàng, Bắt đầu and the ready count; the pre-hand hint lies on the felt. On a
  landscape phone the left corner becomes the same panel after the first tap on Tố, and the right corner's button turns
  into "Tố N"; the "✎" and its "Nhập số điểm" dialog are gone. On the desktop the chips and the slider stand over the
  buttons whenever a size is legal, the amount stands beside the slider, the number field is gone, and the tray stops at
  980 px under the felt instead of running 1 880 px across a 1920 screen (the controls row above it is centred). Desktop seats are at least 132 px wide (118 px from seven seats), so a name fits
  on one line, and from seven seats other players' titles step aside. The smallest table text on a phone is 11 px (the
  chips' bets 12 px). A Blind table takes ten wagers from the balance at sit-down (wager 1.000 → limit 10.000), and the
  create-room hint says "(10× mức cược)"; bots sit with the same.
- **Under it.** core: `ECONOMY.blindTableLimitMultiplier` 5 → 10 (`blindTableLimit`); no engine, protocol, schema or
  migration change, and the amount sent is still a street total clamped into `[min, max]`. ui-kit: `BetPanel` (new:
  chips with `aria-pressed`, a native range with `step="1"` that steps itself along `min + i·step` — `betStep` is the small
  blind, at most 200 steps — and whose last cell is `max` exactly, `sliderLast` / `sliderValue` / `sliderIndex`);
  `ActionBar` takes `layout` (`'stack' | 'ring'`) and `tier`, is two-step in the stack and in landscape and one-step on the
  ring, stamps `data-layout` and `data-panel`, resets the amount and shuts the panel per hand, turn and street, re-clamps
  on new bounds, and never raises from a focused button's Enter; `AmountDialog`, `labels.amount`, `labels.amountDialog`,
  `presets.max` and `SLIDER_STEPS` are gone, `presets.half` reads "½ pot" and `labels.betPanel` is new. `STACK_LAYOUT_QUERY`
  in `frame.ts`; `RoomScreen` resolves the layout once and hands it to `PokerTable` and `ActionBar`, draws the header menu
  and the dock in the stack (`footer[data-dock]`, `data-layout="stack"` on the room), and `RoomHeader` draws a menu in its
  full form too. `Seat strip` gives the viewer's stack seat its strip (still `.plate[data-plate]`) and a fan
  (`[data-fan="2|3|none"]`); `PokerTable` stamps `data-mine-cards`. CSS: the fan (`--fan-card`, `--fan-drop`, `--fan-over`,
  the `rotate` property), the stack felt's padding, the 11 / 12 px floor, the 980 px cap, the wider ring seats, the panel's
  three shapes (`inline`, `sheet`, `corner`, compact on the short tier).
- **Tests.** Unit: core 197, server-kit 182 (every 5× number doubled), ui-kit 715 → 766 (BetPanel's 14, the ActionBar
  rewrite, the stack seat and table, the stack room, raw-CSS pins for the fan, the strip, the chips, the 11 / 12 px floor,
  the 980 px cap and the seat widths). e2e: `normal.spec.ts`'s `@mobile` test sits through the header menu, sits out
  through its checkbox (and reads "Chơi tiếp" checked), and measures the tray (≤ 64 px) and my cards (≥ 52 px,
  `offsetWidth`) in the hand; Lite's `@mobile` test sits through the menu and finds Sẵn sàng in the dock. Ops: L-04
  rewritten (the panel in the left corner, `aria-pressed` chips, one slider, no number field, "Tố 400" → 600 by keyboard →
  the big blind has 400 to call), L-06 opens the compact panel at 855 × 319 and holds it clear of the seats, the board, my
  cards and the dock, F-12 / F-12b sit through the menu, and M-06 is new (`09-phone.spec.ts`, `@mobile`: the header menu
  and the dock, the one-row tray, the fan ≥ 52 px clear of the pot, the panel — End reaches the slider's maximum and the
  confirm names it — Hủy, a raise of 600; a full Blind table of seven bots fits in the hand). New helpers in
  `ops-helpers.ts`: `raiseButton`, `betSlider`, `openBetPanel`, `setBet` (keyboard). The ops pack is 56 cases.
- **Docs.** SRS §27.1 (the stack, the landscape tray, the desktop, the card sizes), §8.8 and the constants (ten wagers),
  `docs/ui-kit.md` ("The bet panel and the one-row tray", "The stack layout", the landscape panel, the props), the
  player guide (the phone table, the slider and its keys, ten wagers), `docs/operation-test-plan.md` (L-04, L-06, M-06; S-05,
  F-10, H-02), `docs/test-matrix.md` (a BP-31 section, four rows; the B4 row), `docs/acceptance-checklist.md` (P26.2),
  `docs/known-limitations.md` (four UI entries), `docs/copy-review-2026-10-10.md` (the chips, the panel's names),
  `docs/ui-review-2026-10-22.md` (P1, P7, P10, P11, P13), the deployment guides and the Lite README (ten wagers), `CLAUDE.md` §3.
- **Rulings** (the spec's, then each task's):
  - Lead, at the gate: `MAX_ENTRY_GZIP` rises from 140 to 150 KB. The bet panel, the phone tray's branches and the fan/strip
    markup took the entry chunk to 140.3 KB gzip, 0.3 KB over the headroom Plan 27 left (its Ruling 13 had raised the
    budget 130 → 140); the SRS's own §24 limit is 500 KB, and the locale-namespace split stays the recorded way back.
    Costs if wrong: a step change under 10 KB could now pass unnoticed.
  - Spec: R1 Hold'em and plain Blind hands fan, a peel hand does not turn. R2 all in on a phone is the panel's chip, not a
    row button or a menu item. R3 the slider steps by the small blind, at most 200 steps. R4 the desktop ring keeps its
    controls row and its Tất tay button, with no ⋯. R5 bots take the new limit. R6 two steps in the stack and landscape,
    one on the ring. R7 P13 is a check, not a fix, unless it measures wrong. R8 wider desktop seats, one-line names,
    others' titles hidden from seven seats. R9 the tray's "phone" is the stack layout, resolved in `RoomScreen`. R10 my
    strip keeps the disc, the ring, the D and the bet, and drops "Bạn" and the caption. R11 the ⋯ in the stack's header,
    a one-row dock between hands. R12 the chips are 36 px even under touch. Pre-flight: R13 the stack keeps Tự động chơi
    beside the dock between hands; R14 a host who is not seated still gets the dock with Bắt đầu.
  - Task 1: the shutdown cases of `room-hands.test.ts` are doubled, not seeded (the all-fold run-down keeps its story on
    seeded 5.000 balances); the cosmetic bot stacks and `engine.test.ts` were brought along (`blindTableLimit`); the
    `04-blind:336` comment was reworded.
  - Task 2a: chips set their target exactly, not snapped to the grid; a 16 px band above the slider for the floating
    amount; `data-shape` `inline` / `sheet` / `corner`; `compact` means the short tier; `presets.max` stayed for 2b to
    drop; a table without a small blind steps by 1.
  - Task 2b: a `tier` prop; the landscape corner panel is 76 px with no floating amount; `data-panel` on the ring tray too;
    Hủy keeps the amount; the focus goes to the slider on open and back to Tố on close; no Tất tay action in landscape
    while sizing is legal; the stack's toggles keep the `.preset` height; the amount re-clamps on new bounds; a throwaway
    Playwright config for the shots. Fix round: the reset keys on the board's length too (a new street with the same
    seat to act starts at the minimum with the panel shut), and opening the stack's panel by keyboard lands on the slider.
  - Task 3: the rank pill is always on the strip; an overfull strip wraps; ring cards stay 40 px; `--plate-h` stays 54 px;
    the fan pivots at its foot; the stack grid's column is `minmax(0, 1fr)`.
  - Task 4a: the footer is the dock bar; the empty tray stays in the DOM (`data-between`); no footer when it would be
    empty; a 38 px countdown dock; the stack's sheet drops the floating amount; Quản lý bàn only between hands; the felt
    note's padding.
  - Task 4b: the 980 px cap skips the empty between-hands tray (`[data-between]`), a regression it found; the caption rule
    needs no media query; the nine-seat Hold'em shots come from an engine snapshot.
  - Task 5: the new ops case is **M-06**, not M-01 — `docs/operation-test-plan.md` §M already owns M-01…M-05 (manual,
    cited by the copy review and the test runs), and the phone case belongs in that section. The Blind part seats seven
    bots at `maxPlayers: 8` (Blind's cap), not eight at nine. After-hand states of the full Blind table are read for text
    overlap but their stage scroll is recorded, not asserted (the final wave asserts it). `setBet` drives the keyboard (P8), never `fill`.
    P11 of the UI review is marked done too (its number field is gone).
  - Final fix wave (after the whole-branch review): the desktop controls row is centred, not capped (the cap wrapped the
    pre-hand hint at 1280–1536 px and failed `normal.spec.ts`'s desktop Blind test by 12 px); from seven opponents a chip
    with a showdown line hides its badge row (`.othersDense .seat:has(> .seatResult) > .tags`) and keeps that line to one
    line (payout 14 px, a long hand name cut with "…"), and a strip with a state badge hides Chủ phòng
    (`.stripLine:has(> .tagState) > .tagWho`), so a 375 × 812 Blind table of eight fits after the hand, card up or closed
    (M-06 now asserts it: 0 px over seven runs, against 75–96 px before); the dock's labels wrap to two lines instead of an
    ellipsis, and "Tự động chơi" beside them is at most 6em wide (one line of it left "Hủy sẵn sàng" three lines deep);
    the desktop panel prints its amount beside the slider (the tray is 132 px on and off the turn, 145 before on it); a
    dealt card's offset rides the `translate` property, outside a fanned card's `rotate`; one chip lights at a time (the
    first that names the amount); the sheet's chips drop `.preset`'s 52 px floor (the last chip ended 13 px past the
    tray's padding, now at its edge); the table-limit hint reads its multiplier from `ECONOMY`; `ActionBar`'s reset and
    key listener are layout effects (no frame of the old panel, no key reaching the old turn); and the cheap tests the
    reviews asked for. ui-kit 766 → 777.
- **Khác với spec / Deviations from the spec.** The stack's sheet has no floating amount over the thumb (its confirm
  reads "Tố N"), and the landscape corner panel is 76 px without it. The countdown dock is 38 px, not 44. My strip runs to
  66 px when the host badge, the rank and a bet wrap (spec: 44 / 56); with a state badge it hides Chủ phòng instead. The
  caption rule (others' titles hidden from seven seats) has no media query, so it also hides the titles in landscape and
  at 768–1023 px. The desktop controls row is centred, not capped: a 980 px cap wrapped the pre-hand hint at 1280–1536
  and pushed the stage 12 px (spec §3.3 / P10 capped both). The dock's labels wrap to two lines inside their 44 px
  buttons. Hủy keeps the amount chosen this turn (the panel reopens on it). After a hand at a table of seven opponents
  and more, a chip shows its hand's line in place of its badges and bet. The dock has no `role="status"` (it would
  compete with the tray's wait line and the reconnect banner). The stack keeps the two-row header (so "Mức cược … · Hạn
  mức …" stays). The chips are 36 px (spec R12, recorded in SRS §27.1). The nine-seat fallback of R8 (13 % / 94 px) was
  not needed. The ops case is M-06, not M-01. M-06's Blind part has seven opponents, not eight.
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-23, before the user's push: the commits went over SSH as
  a `git bundle` (`git pull --ff-only /tmp/bp31.bundle main` to `6487c36`), after `backup.sh` (`bp-2026-10-23-1151.dump`)
  and a health check with 0 rooms; no new migration; `docker compose up -d --build`; health `ok`. Lite: not rebuilt
  (the exe step needs Node 22), not shipped. The Windows LAN host was not deployed.
- **Still open.** UI review P3 (the lobby's void), P5 (the GM overview), P8 (tracked labels), P9 (emoji), P15 ("Lưu
  tên"), P16 (the shop), P22 (the light theme) — the next round. Bug E6 (pre-existing since 2026-09-04, found by the
  BP-31 review): after a sit-out empties the table of humans and the room returns to waiting, the client still shows
  "Hủy sẵn sàng" and "8/8 sẵn sàng", and "Chơi tiếp" then "Bắt đầu" is refused ("Chưa đủ người chơi": `toOpen()` clears
  the ready flags without a `PLAYER_READY`) — logged in `docs/bug-log.md` §10 with options, (a)
  recommended, for a bugfix branch after BP-31. Small corners in `docs/known-limitations.md`: "Tố ▴" may break to two
  lines on landscape corners narrower than ~70 px; between hands on the upright phone an empty "Hành động" group stays
  in the DOM; the upright phone's dealer button sits on the strip's right corner. A finger on the slider (iOS Safari,
  Chrome on Android, both orientations) and VoiceOver / TalkBack on it are the user's to try. Lite picks the kit up at
  its next `pnpm build:lite`.

## BP-30 — the chibi breathes, blinks, cheers, greets and turns in the wardrobe and the shop — merged `30d7661` (2026-10-23)

K6 of the 2026-10-21 requests (`docs/bug-log.md` §9): "dáng đứng của nhân vật quá cố định nên cũng làm giảm hứng thú của
người chơi". The brainstorm of 2026-10-22 chose life before poses (spec `2026-10-22-k6-chibi-idle-life-design.md`, Q1–Q3,
R1–R8): the figure moves with CSS on the PNG layers it already has, and nothing new is drawn. Branch
`feature/BP-30-chibi-idle-life`, merged after BP-28 and BP-29 (it relies on BP-29's `isolation: isolate` on `.chibi`).

- **What a player sees.** In the Phòng thay đồ, the Cửa hàng and the Hồ sơ, the figure breathes (1.5 % taller and back
  every 4 s, from the feet) and blinks every 3–6 s. Put an item or a colour on in the wardrobe, or try a card on or buy it in
  the shop, and it smiles, hops once and six sparkles fade around it. Tap it and it smiles and tilts its head ("Nhân vật
  của bạn, bấm để chào" for a screen reader). "Xoay" under the stage (in the shop on every size, at the end of the
  phone's strip) turns it to face left in half a second, and again to face right. In the welcome dialog, the card a player
  picks cheers once, but not on Nhận. The table, the lobby bar, the seats, every card and portrait and the GM screens look
  exactly as before. With reduced motion on, nothing moves and the face never changes, and "Xoay" flips at once.
- **Under it.** ui-kit: `Chibi` gains `live` (`'off' | 'still' | 'idle'`, `off` by default and byte-for-byte the old
  markup), `react`, `facing` and `onFacesReady`. A live chibi mounts its `closed` and `happy` faces hidden beside the
  shown one, after that face is in, and switches them by `data-face` and `opacity` (a `still` one, which never blinks,
  mounts only `happy`). `useChibiLife` (`life.ts`, timings in `CHIBI_LIFE`) is the state machine; it starts the turn in a
  layout effect, in the same commit as the new `data-facing`, so no mirrored frame is painted before the spin. `useOnScreen` (`on-screen.ts`) keeps watching, so breathing and blinking pause off
  screen and in a hidden tab. `useTintedLayerState` says when a tint has settled. The keyframes `chibiBreathe`, `chibiHop`
  (`--chibi-hop`), `chibiTilt`, `chibiSpinLeft` / `chibiSpinRight` each animate their own transform property. `LiveFigure`
  adds the greet button, the sparkle ring and `TurnButton`, with `nextReaction` and `flipFacing`; a `react` taken back to
  `null` takes the ring away, so a quick second welcome pick leaves the sparkles on the new card only. Two strings in both
  languages, `avatar.turn` and `avatar.greet`. normal-web: `StagePanel` / `WardrobeScreen`, `ShopStage` / `ShopScreen`,
  `WelcomeDialog` and `ProfileScreen` wire it. No protocol, schema, picture or dependency change.
- **Tests.** Unit (+66 in ui-kit, 649 → 715 in 50 files; +25 in normal-web, 1071 → 1096 in 56 files): an inline snapshot of four `live="off"` chibis committed
  before `Chibi` changed (`Chibi.test.tsx`), `life.test.tsx` (fake timers: blinks, cheer restarts, a wave ignored mid-cheer
  or mid-turn, reduced motion, no timer after unmount), `on-screen.test.tsx`, `LiveFigure.test.tsx`, and the four screens'
  tests (a cheer on a pick, not on a tab switch or a take-off; on a try-on and a buy; the welcome card cheers on pick and
  not on claim). Ops: P-06 `@mobile` (the shop figure breathes, blinks within 7 s, a tap waves, Xoay spins it and leaves it
  facing left, a try-on cheers and clears within 2 s) and P-07 (with `reducedMotion: 'reduce'`: no animation on the root,
  no face change in 7.5 s, no greet button, no cheer or sparkles, an instant flip). Both read `data-*` and the computed
  `animation-name`, never a class name. P-05's `wardrobeHasDrawn` ignores `img[data-face-hidden]`. P-04 now counts 18
  requests on open (16 before: the stage's two spare faces). P-05 is unchanged: about 850 ms shown and 1.75 s drawn at
  both sizes. The ops pack is 55 cases.
- **Docs.** `docs/ui-kit.md` ("Live figure", "The chibi's life"), `docs/avatar-2d.md` (life without new layers),
  `docs/known-limitations.md` (five UI entries: the mirror turn, one live figure per screen, a second cheer within
  420 ms, the shop strip at 104 px, the wardrobe's face name 35 px left of centre), `docs/test-matrix.md` (a BP-30 section, two rows; the pinned count),
  `docs/operation-test-plan.md` (P-06, P-07), `docs/normal-web.md` (P-04's count), bug log §9 K6, `CLAUDE.md` §3.
- **Rulings** (the lead's, then each task's):
  - Lead: P10, the greet control is a transparent button laid over the figure, not a wrapper, so the figure keeps its
    `role="img"` and name. P15, Xoay is on every shop size, the phone's strip included. `main` (with BP-28 and BP-29) was
    merged into the branch before the docs task, not at the gate.
  - Task 3: the desktop wardrobe stage hops at −3 % (`--chibi-hop`), because its 290 px figure already touches the top.
    A colour pick ("Tự nhiên" included) cheers like an item. Xoay is 30 px tall from 768 px and 44 px on a phone.
  - Task 4: the shop strip's gaps went from 12 to 8 px so Xoay fits and a new player's strip stays 96 px. The shop sets no
    hop override. In the column, Xoay sits under the stage, before the caption. A card the figure already wears does not
    cheer (a literal same-card guard at first; the final wave widened it to the whole look, so trying on the saved
    outfit is quiet too).
  - Task 5: pressing the already-picked welcome card again is a no-op, with no second cheer. The welcome cards' figures
    stay unlabelled (decorative); the card button carries the name.
  - Task 6: P-06 asserts a blink only after the spare faces are loaded, then within 7 s, as the hook waits for them. P-07
    proves stillness by a `MutationObserver` that must record no change to `data-face`, `data-reacting` or `data-motion`
    over the whole case. Both use real time, no `page.clock`. `docs/normal-web.md`'s P-04 count was brought up to date.
  - Final wave (after the whole-branch review): the turn is set in a layout effect (a test outside `act` with a clock
    that makes React's scheduler yield proves the spin is on when the new facing lands); the CSS durations, the 1.015
    breath, the −4° tilt and the 0.06 turn are pinned to `CHIBI_LIFE` by tests (every number already matched); the
    shop's try-on guard compares the whole look; a welcome card whose pick is replaced loses its sparkles at once; a
    `still` figure mounts only the `happy` face beside its own. A restarted cheer keeps `data-reacting` at "cheer", so the
    tests prove a restart by a new sparkle ring and a cheer still running past the first one's 1.2 s, not by a count.
- **Khác với spec / Deviations from the spec.** The greet control is an overlaid sibling button, not the spec's "bọc"
  wrapper (P10; R6's intent kept). The welcome cards are `live="still"`, a third mode the spec's `'idle' | 'off'` did not
  have: they react but never breathe. The sparkle ring is drawn inside the figure's box by `LiveFigure`, not around the
  frame by each stage. `useChibiLife` returns `{ face, motion, breathing, reacting }` and `Chibi` stamps it as `data-*`,
  not `{ expression, className, style }`. Spin comes from a `facing` change, not from `react`. The ops cases assert
  attributes and `animation-name`, not class names (they are hashed in production).
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-23, before the user's push: the commits went over SSH as
  a `git bundle` (`git pull --ff-only /tmp/bp30.bundle main` to `c25bb25`), after `backup.sh` (`bp-2026-10-23-0803.dump`)
  and a health check with 0 rooms; no new migration; `docker compose up -d --build`; health `ok`. Lite: not rebuilt, not
  shipped. The Windows LAN host was not deployed.
- **Still open.** The real-pose spike (a three-quarter or back view, sitting poses) stays open in bug log §9. One breathing
  figure per screen: the welcome cards cheer but stay still, and the shop cards, portraits and seats stay still by design. A turned figure is a mirror. A second cheer
  inside 420 ms does not replay the hop. Real phones (iOS Safari, Firefox Android) are the user's to check. Lite picks the
  kit change up at its next `pnpm build:lite` (it draws no live figure).

## BP-28 — a landscape phone that keeps its browser bars seats the table on a stadium as wide as the screen — merged `7ecea0c` (2026-10-23)

The user's review round of 2026-10-22 (bug log §10, E1 and E2, photos 1–4): "lỗi chủ yếu ở ảnh 1-4 là giao diện không hợp
lý, bài đè lên nhau hoặc không hiển thị đúng vị trí chia ô người chơi khi xoay ngang". Held sideways with Chrome's bars
showing, the user's Android leaves an 855 × 319 viewport and a 255 px stage, under the 290 px Plan 26's landscape frame
was drawn for: the 10 : 3 ellipse came out 500 × 150 px, the flank seats stood on each other, "Bot · Đã chọn · 2.000" ran
over the next plate, the viewer's 50 px cards covered the board, and the waiting hint lay on the viewer's own name. Branch
`bugfix/BP-28-short-landscape-table`.

- **What a player sees.** On a stage under 300 px the landscape frame takes a second tier, `short`. The table is a
  stadium as wide as the screen: my seat at the bottom centre with my cards *beside* my plate, the two seats next to me
  at the stadium's two ends, everyone else on one line along the top — no seat above or below another, the board alone
  in the middle. The plates lose their caption; a bot's three face-down cards are 16 px, mine `clamp(40px, 16cqh,
  56px)` (a peel card 48 px); under an opponent only the bet stays, the "Bot" and "Chủ phòng" badges go and "Đã chọn"
  (or any state) becomes a dot of its colour. Before a hand the hint ("Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một
  người chơi thật.") is the corner dock's second line, under "N/M sẵn sàng". Where the browser offers full screen, a slim
  "Dùng Toàn màn hình để bàn rộng hơn" sits once in the bottom-left corner: its words go full screen, its ✕ puts it away,
  and either is remembered. 915 × 412, 844 × 390 and every desktop size look as before; 915 × 355 (a 291 px stage) is in
  the short tier now.
- **Under it.** `table/frame.ts`: `FrameTier`, `SHORT_STAGE_PX = 300`, `stageTier`, `useStageTier` (the stage, `.roomMain`,
  measured before the first paint and on every resize). `table/geometry.ts`: `shortRingPositions(order, anchor, box)` and
  `SHORT_SEAT`. `PokerTable` takes `tier`, stamps `data-tier` and gives an empty seat `data-half` / `data-edge` in the short
  tier; `Seat` wraps the cards and the plate in `.seatTop` (`display: contents` except the short tier's own seat) and
  marks its who-badges `.tagWho` and its state pill `.tagState`; the `[data-tier='short']` rules in `table.module.css` and
  `screens.module.css`; `screens/fullscreen-nudge.ts` (`bp.fullscreenNudge` in `localStorage`); two strings in both
  languages, `room.fullscreenNudge` and `room.fullscreenNudgeDismiss`. The playground gains `#worst/blindP`, `#worst/blindW`
  and the `/short` 855 × 319 box, and its bots draw no caption, as in Normal. No protocol, schema or dependency change.
- **Tests and docs.** Unit: `frame.test.ts` (+5), `geometry.test.ts` (+7, among them a block model at 855 × 319 and
  915 × 355 with six and eight seats), `PokerTable.test.tsx` (+1), `Seat.test.tsx` (+2), `RoomScreen.test.tsx` (+6),
  `scenarios.test.ts` (+1). Ops: L-06 (855 × 319: a seven-seat Blind play-or-fold table waiting and after every bot has
  chosen, an eight-seat Hold'em table on the flop; every seat box against the others, the board, my cards, the dock, the
  tray's corners and the nudge, the room fitting, no text over text). `docs/ui-kit.md` ("The short tier"),
  `docs/known-limitations.md` (a new entry, two rewritten), `docs/test-matrix.md` (three rows), `docs/operation-test-plan.md`
  (L-06), bug log §10 E1/E2, CLAUDE.md §3 (51 ops cases, the matrix count).
- **Rulings** (the session lead's R1–R3, then the implementer's):
  - R1: a second landscape tier, `short`, measured on the stage with `LANDSCAPE_PHONE` still the trigger; compact plates,
    the bots' face-down cards shrunk rather than counted, the viewer's cards smaller, an opponent's line cut to the bet,
    and seats placed so no seat box meets another or the board.
  - R2: in the short tier the waiting hint moves into the corner dock beside "N/M sẵn sàng"; it stays on the felt in the
    normal tier.
  - R3: the result card and the menu's "Toàn màn hình" are unchanged; a one-time nudge, only in the short tier and only
    where `document.fullscreenEnabled`, dismissable and remembered, with no motion.
  - Ruling 1: the threshold is **300 px**, not R1's 290 — the stage at 915 × 355 measures 291 px, and there the normal tier
    laid a bot's "Bot · Đã chọn · 2.000" over the pot's figure and another's over the deck on a six-seat Blind table (the
    playground's `blindP`); from 915 × 365 (301 px) the ellipse is clear. Costs if wrong: 915 × 355 (and L-02) shows the
    stadium instead of the ellipse.
  - Ruling 2: an anchor layout (`shortRingPositions`: the viewer, two ends, a top line clear of the ends across), not a
    re-measured ellipse — any ellipse of the stage's height puts two seats on one line of sight at each flank. Costs if
    wrong: the table reads less like an oval on a short phone.
  - Ruling 3: the viewer's cards go *beside* the plate in the short tier, with the line of badges under both, so the
    viewer's block is one card tall and the board keeps the middle. Costs if wrong: the cards are no longer above the
    plate, as everywhere else.
  - Ruling 4: R1's "min 34 px" for the bots' cards could not be read as a card width (the landscape frame already drew
    them at 20 px); the cards are 16 px wide (the bug log's 14–16 px), aspect kept, which makes a two-card hand 34 px
    wide. Costs if wrong: three 16 px backs are small on a phone.
  - Ruling 5: R1's `clamp(40px, 22cqh, 56px)` for the viewer's cards was a share of the old ring (≈ 150 px tall); the
    short ring is the whole stage, so it is `clamp(40px, 16cqh, 56px)` — the same 40 px at 855 × 319. A peel card is 48 px
    in the short tier (60 elsewhere): three 60 px cards beside a plate do not fit between the corner docks. Costs if
    wrong: a narrower card to peel on a short phone.
  - Ruling 6: "under 120 px plate width" is every opponent in the short tier (their plates are 92–110 px), so the rule is
    keyed on the tier, not measured per seat. The state pill is a 9 px dot of its colour rather than dropped, its words
    kept for a screen reader, and a showdown's hand name is cut short before its payout is. Costs if wrong: a player must
    know the dot's colours (teal chosen or turned, gold all-in, red disconnected, grey folded or sitting out).
  - Ruling 7: the hint is the dock's *second* line, under the buttons and the count, and the dock wraps capped at
    `min(38%, 20rem)` — a column beside the count would have run four lines at 855 px. Costs if wrong: the dock is two
    lines tall while the room waits.
  - Ruling 8: the nudge sits in the bottom-left corner while no tray holds it (no hand, or a spectator), new copy "Dùng
    Toàn màn hình để bàn rộng hơn" / "Use Full screen for a wider table" and its ✕ "Ẩn gợi ý Toàn màn hình" / "Hide the
    Full screen tip"; using it also counts as done. Costs if wrong: a player who first sits down mid-hand sees it only at
    the next pre-hand moment with no tray.
  - Ruling 9: L-06 makes its rooms at the project's 915 × 412 and shrinks to 855 × 319 once inside: the lobby's create
    dialog at 319 px is another screen, out of this fix. Costs if wrong: the create dialog on a short phone stays untested.
- **Khác với spec / Deviations from the spec.** Plan 26's spec §3 B3 lays out one landscape frame from 290 px up; below
  300 px it is now the short tier's stadium (Rulings 1–3). The waiting hint is in the dock there, as B3 had it before the
  felt note (R2).
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-23: `backup.sh` (`bp-2026-10-23-0700.dump`), `git pull`
  to `50633b9`, no new migration, `docker compose up -d --build`, health `ok` with 0 rooms before and after. Lite: not
  rebuilt, not shipped. The Windows LAN host was not deployed (it still lacks `0004`–`0006`, see Plan 27).
- **Still open.** No real phone has run it (the user's Android is the check, L-06 in the operation test plan). Below a
  230 px stage the lines run into each other; after a showdown with the card closed the viewer's block ends 1 px under the
  board at 855 × 319; nine seats on a stage under about 800 px wide pass the top line over the end seats; the reconnect
  banner lies over the top line while it shows (`docs/known-limitations.md`). The lobby's create dialog at 855 × 319 is
  untested. Lite picks this up at its next `pnpm build:lite`.
- **Gate** (on the branch, 2026-10-23, before the merge gate): typecheck and lint clean; unit ui-kit 649/649 (47 files),
  normal-web 1071/1071 (55 files, `CI_SKIP_BUILD=1`), `tooling/arch` 42/42; build:normal; ops L-01 … L-06 6/6 in 1.7 min;
  e2e Normal 24/24 in 2.1 min. Not yet run: the whole `pnpm test`, build:lite, avatar:check, e2e Lite and the whole ops
  pack — the merge gate's.

## BP-29 — the face stays under the rail, a refusal is read over its dialog, and the Blind fee is pinned in a browser — merged `4cd43dd` (2026-10-23)

Three items of the 2026-10-22 review round (`docs/bug-log.md` §10): E4 from the user's phone screenshot, confirmed in words
("khi scroll top, icon avatar đè lên khung"); E5 reported in words the same day ("lỗi này bị ẩn sau modal vào bàn"); E3 a
screenshot taken before Plan 27 was deployed. Branch `bugfix/BP-29-chibi-over-rail-and-hidden-notice`.

- **What a player gets.** On a phone, the lobby's face and the profile's figure slide under the sticky rail when the page
  scrolls, instead of drawing their hair, hat and frame over "Sảnh chờ" (E4). A Hold'em buy-in the balance cannot cover now
  shows "Số dư không đủ" on top of the open buy-in dialog, not under its dimmed, blurred backdrop; the dialog stays open for
  another amount (E5). The same holds for every refusal or notification that arrives while a dialog is open — "Tạo phòng",
  "Quản lý bàn", the welcome gift.
- **Under it.** `.chibi` (`packages/ui-kit/src/avatar2d/avatar2d.module.css`) is `isolation: isolate`, so its layers'
  z-index 10–90 rank only among themselves; the seat disc and the wardrobe's portrait cards keep their own, now redundant,
  rules. A new token `--z-toast: 110` (`tokens.css`) sits above `--z-modal: 100`, and `.toasts` stands on it: the toast and
  the backdrop had the same z-index, and the backdrop, portalled to the end of `<body>`, won on DOM order. Lite takes both
  through the kit.
- **Tests.** Unit: `Chibi.test.tsx` → "the .chibi root opens its own stacking context…"; `RoomScreen.test.tsx` → "keeps the
  buy-in dialog open on INSUFFICIENT_BALANCE and draws the refusal above its backdrop" (reads the z-indexes off the
  stylesheets the two elements carry). Ops: B-05 `@mobile` (`01-accounts.spec.ts`: lobby and profile scrolled under the
  rail, `elementFromPoint` with the layers made hit-testable must answer the rail) and E-13 (`03-holdem.spec.ts`: a
  2.500/5.000 table, the refusal on top of the dialog by hit test, nothing charged); F-01 now asserts a Blind result card
  prints no "Phí bàn" (E3). Both new ops cases were run against a build with the two CSS lines reverted and failed there
  ("found a IMG on top", "the refusal is drawn over the dialog's backdrop, not under it"). The ops pack is 52 cases.
- **Docs.** `docs/bug-log.md` §10 (E5 logged with options, E3 and E4 updated), `docs/operation-test-plan.md` (B-05, E-13),
  `docs/test-matrix.md` (a BP-29 section, three rows; the pinned count in `tooling/arch/acceptance-links.test.ts`),
  `docs/known-limitations.md` (UI: a toast can cover the foot of a tall dialog on a phone for a few seconds),
  `docs/ui-kit.md` and `docs/avatar-2d.md` (the token and the isolation), `CLAUDE.md` §3.
- **Khác với spec / Deviations from the spec.** None. E5 took option (a) of the bug log (toasts above dialogs) rather than
  a refusal line inside the buy-in dialog.
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-23: `backup.sh` (`bp-2026-10-23-0056.dump`), `git pull`
  to `39fbef2`, no new migration, `docker compose up -d --build`, health `ok` with 0 rooms before and after. The Windows
  LAN host was not deployed (it still lacks `0004`–`0006`, see Plan 27).
- **Still open.** E3 waits for the user to play a Blind hand on the deployed build. E1/E2 (the short landscape table) are
  BP-28's. The GM player page's chibi was not screenshotted (it takes the same root rule).

## Plan 27 — a shop for points behind a reputation rank, a welcome gift, Blind played to zero, a lazy wardrobe and a monthly check-in — merged `da8ca8a` (2026-10-22)

The round the user asked for on 2026-10-20/21 (`docs/bug-log.md` §9, K1–K5, plus Q13 from the spec review): players saw
many outfits and no way to earn them, Blind tables threw out accounts with 5–6k left, and the wardrobe loaded slowly.
Six parts: **A** a reputation that only rises and a rank beside the name, **B** a Cửa hàng that sells catalogue items for
points behind that rank, **C** a welcome gift and a seven-claim newcomer calendar, **D** Blind with no table fee, played
down to the last point, **E** a wardrobe that loads only what is on screen, **G** a check-in calendar that counts the
month's claims; **F** wrote K1 (two devices) down as a rule. Spec
`docs/superpowers/specs/2026-10-21-plan27-shop-reputation-welcome-blind-zero-design.md` (the Q-table is §1, Q1–Q13; the
session's rulings are R1–R21, §10), plan `docs/superpowers/plans/2026-10-22-plan27-shop-reputation-welcome-blind-zero.md`
(36 pre-flight amendments, P1–P36, one rejected), branch `feature/BP-27-shop-reputation-welcome-blind-zero`. Points only,
as always: "mua" in every screen and doc here means in-game points; there is no payment, conversion or trading.
Gate on the branch's final tree (`0f111ca`; `main` had not moved): typecheck, lint, 3296 unit tests passed and 14 skipped
(216 files, 6 min 49 s), build:normal, build:lite up to the exe step (skipped on Node 24, "rebuilt locally, not shipped"),
avatar:check 1560/1560, e2e Normal 24/24 (1.6 min), e2e Lite 4/4, ops pack 50/50 across desktop, mobile and landscape
(12.6 min). The first ops run was 49/50: A-08 signs in with English chosen and the welcome box read "Later", which the
e2e helper only knew as "Để sau"; the helper now dismisses it in either language (`0f111ca`). The final review's own fix
wave also landed: a boot probe that meets the read limit waits the server's `retry-after` (at most 5 s) and asks once more
before showing the sign-in card; an achievement unlock and the welcome claim lock the player's row first, so two of them
on one player cannot deadlock on Postgres; the ops test server reads 2400 a minute because every browser shares one address.

- **What a player sees first (Part C).** The first visit to the lobby — a new account or an old one — opens "Chào mừng
  đến Blind Luck Poker": three rare items ("Đồng phục chia bài", "Áo dài Tết đỏ", "Nón lá"), each worn by the player's
  own figure on its card. "Nhận" puts the pick in the wardrobe, wears it at once and adds **100 reputation** (rank 2,
  Tay bài); a status line in the dialog says so and "Vào chơi" closes it. "Để sau" leaves a "🎁 Quà chào mừng" pill on
  the lobby. An item already owned is greyed "✓ Đã có"; with all three owned the dialog offers only "Nhận 100 danh vọng".
  The starting balance stays 100,000. From then on Điểm danh carries a **"Tuần đầu tiên"** panel under the summary: seven
  cells (Đã nhận / Hôm nay / Chưa tới), "1 món thường" on day 3, "1 món hiếm +200 danh vọng" on day 7; one "Nhận thưởng"
  claims both calendars and the receipt lists both. It counts claim days, so a missed day costs nothing.
- **What a player sees (Part B).** A **"Cửa hàng"** pill beside "Phòng thay đồ" on the lobby's player bar (the same line
  as the name and the balance, so a lobby of six still fits 1920×940) opens `#/shop`: the player's
  own figure on the left (a 96 px strip on top at phone width) with the balance and the rank's progress, **"Kệ tuần
  này"** (up to six items, a GM's pick or a rotation fixed from Monday), then shelves Thường / Hiếm / Cực hiếm, filtered
  by slot ("Lọc theo ô", the wardrobe's own labels, plus "Màu sắc" for the rare and epic hair and eye colours). A tap
  **tries the item on** the figure ("Mặc thử: …", "Về đồ đang mặc"). A card says "Mua · 30.000", "thiếu N điểm", "🔒 cần
  Bậc thầy", "✓ Đã có" with "Mặc" (opens the wardrobe on that item), or where an unsold item comes from ("🏆 Thành tựu:
  …", "📅 Quà tháng 11/2026", "📅 Quà điểm danh", "Miễn phí — có sẵn trong Phòng thay đồ"). "Mua" asks "Mua món này?"
  with the price and what is left; after it the card turns "✓ Đã có", the figure keeps the item and "Mặc luôn" saves it.
  A lost answer says "Chưa rõ đã mua được chưa…" and the next "Mua" resends the same purchase id, so nobody is charged
  twice. Seed prices: common 10,000 at rank 1, rare 30,000 at Cao thủ, epic 150,000 at Bậc thầy (spec Q1: a rare after a
  week of evenings, an epic after a month). At launch 2 epics, 27 rares and 12 commons sell; a month's check-in epic goes
  on sale the month after (Q12). The ledger line is "Mua ở Cửa hàng".
- **What a player sees (Part A).** Every dealt hand (+1), win (+3 more), check-in (+10), achievement (+50 / +150 / +500 by
  its reward), the welcome gift (+100) and newcomer day 7 (+200) add **reputation**, which is not points and never goes
  down. Five ranks — Tân binh 0, Tay bài 100, Cao thủ 400, Bậc thầy 1,800, Huyền thoại 5,000 — and the rank is the
  highest reached, so a GM raising a threshold lowers nobody. From rank 2 the rank's name stands after the player's name
  on a wide seat plate, in its colour (`--rank-2` … `--rank-5`, AA on the plate); on a narrow plate, in the landscape
  frame and in the "Mời ra" list it is a roman-numeral pill ("III") with the name as its title. The lobby bar shows it
  after the name, the profile reads "Danh vọng 455 · Cao thủ · còn 1.345 tới Bậc thầy" with a bar, and a rank-up toasts
  "Bạn vừa lên bậc Cao thủ" and shows on the player's own bar and seat at once (the app reads its own avatar again,
  past the browser's cache). A GM's grant reads "+500 danh vọng — <lý do>".
- **What a player sees (Part D).** A Blind table takes **no fee**, and a seat plays **down to its last point**. Sitting
  down needs one wager in both modes (play-or-fold asked for two). A seat short of the wager antes what it has and is all
  in, winning only the pots it matched; in play-or-fold a seat the ante emptied is played for it (never asked, never
  timed out) and a seat short for the second commit sees "Tất tay N" instead of "Chơi". A seat that ends a hand at
  exactly 0 — Hold'em too — is stood up and told "Bạn đã hết điểm ở bàn này. Nhận Cứu trợ nếu số dư dưới 5.000 điểm,
  hoặc chọn ghế trống khi có điểm." The old "Bạn đã dùng hết hạn mức ở bàn này" is gone. The Blind result card has no
  "Phí bàn" line.
- **What a player sees (Part G).** The Normal check-in counts **the month's claims**: the N-th claim of the month lights
  tile N, and a missed day no longer sends anyone back to tile 1. The page reads "Lần điểm danh thứ 12 của tháng 10/2026 ·
  không cần liên tiếp" and "Còn 19 ngày trong tháng cho 20 ô"; the "Hôm nay" tile follows the count. "Chuỗi 7 ngày" and
  "Chuỗi 28 ngày" still need consecutive days. Lite keeps its consecutive streak.
- **What a player sees (Part E).** The wardrobe draws the stage and the cards near the screen first: the saved-outfit
  heads, the Kiểu tóc portraits and every card icon wait until they are within 200 px of the screen, tinted layers render
  four at a time with the figures first, and a picture that stalls gives up after 15 s and leaves the plain layer.
  Measured on "fast 3G": the stage and the first row are on screen in about 850 ms at 1366×768 and 375×812; the first
  row's pictures arrive in about 1.7 s at both sizes, the phone's because a small portrait loads its pictures @1x
  whatever the screen (Ruling 16; 3.2 s before). Opening the wardrobe at 375×812 asks for 16 small avatar pictures
  instead of every layer of every card.
- **What a GM sees.** Quản trị has six tabs: the new **Cửa hàng** tab edits prices, minimum rank and on/off per item (the
  "chưa định giá" rows first, each row with its lock), picks "Kệ tuần này" for this week and the eight after, sets the
  three welcome choices (outfit, head, face, aura or frame only), and holds two small **Danh vọng** tables (the eight
  sources and the five thresholds; "Nâng ngưỡng không làm ai tụt bậc"). A player's page reads "Danh vọng: 455 (Cao thủ)"
  with **"Cộng danh vọng"** (1 to 100,000, a reason, no button to subtract). The overview counts players per rank, the
  ledger panel names "Mua ở Cửa hàng" and "Cửa hàng (bể)", and Nhật ký names the six new kinds.
- **Under it (Parts A, C, G).** Migration `0006_plan27` (additive, guarded, `when` after 0005): `reputation_events`
  (unique `(player_id, reason, ref_id)`, `delta > 0`), `reputation_rules`, `reputation_ranks`, `shop_prices`,
  `shop_featured`, `shop_config`, `newcomer_progress` (with `last_day_key`), `players.reputation`, `players.rank`,
  `players.welcome_claimed_at`, `daily_logins.consecutive`, and two data steps: `consecutive` starts from the old streak,
  then this month's `streak` is lifted to `claimed_days`. `daily_logins.streak` keeps its name and now holds the month's
  count; `DAILY_CLAIMED` carries `consecutive`, which feeds `loginStreak` / `bestLoginStreak`; "Đặt lại điểm danh" steps
  `consecutive` back too. `ReputationService` grants inside the transactions that already pay (the claim, `unlockWithin`,
  the welcome claim) through `tx`, and from the post-commit `HAND_SETTLED` listener for hands, one transaction per seat;
  `players.reputation = Σ events` is an invariant test. `RANK_UP` is a notification sent after the commit. The rank
  rides `GET /api/players/:id/avatar` and `GET /api/me` (no protocol change, R9); `PokerTable` takes `rankFor` and hands
  `Seat` its own `frame`. `WelcomeService` claims in one transaction, guard first, and wears the item through the new
  `wearItemWithin`; the newcomer calendar advances inside `claimDaily` only on a day after `last_day_key`, its fallback
  under `newcomer:<pid>:<day>`, outside the GM undo's reach. New routes: `GET /api/shop`, `POST /api/shop/buy`,
  `GET /api/welcome`, `POST /api/welcome/claim`, and seven under `/api/gm/` (22 → 29). The rules, the ranks and the
  welcome choices are seeded both by `0006` and in code at boot; `shop_prices` only in code.
- **Under it (Part B).** `ShopService.buy` is one transaction: a repeat is found by the item already granted under
  `shop:<pid>:<purchaseId>` (which survives the boot-time prune of `ledger_keys`), then the key, the checks on rows read
  through the transaction, `creditWithin` with the player's `shop_purchase` row and the `shop` sink row (debit before
  grant), then `inventory.grant`, whose `false` rolls the debit back as `ALREADY_OWNED`. `TxReason`, `SettlementMeta.kind`,
  `SINK_REASONS`, `REASONS` and the ledger strings gained `shop_purchase` / `shop` together. A lock is read from the live
  gift schedule at every read and purchase. `newPurchaseId()` falls back to `getRandomValues` on a plain-http LAN host.
- **Under it (Part D).** Core: `ECONOMY.blindTableFeeRate = 0`; `createBlindHand` deals any seat above 0 and marks a seat
  the ante emptied `decision = 'play'`; `callAmount = min(stack, wager)`; `returnDeadExcess` gives each folder back what
  no live seat matched (Ruling 12). Room: `requiredStack()` is 1 in both modes, the sit-down needs one wager,
  `standUpSpent` sends `STACK_SPENT { roomId, threshold }` in both modes, `TABLE_LIMIT_SPENT` and its strings are gone,
  and the carry-over claimant path is deleted (Ruling 14). The reducer marks a seat all in when the antes empty it; an
  auto-played seat does not reset or add to the timeout count; bots play a short stack all in and are topped up only at
  0. **Lite** gets all of Part D after `build:lite`: no Blind fee and no `table_fee` sink, a seat dealt with any stack
  above 0, one wager to sit in play-or-fold, a stand-up at 0 with `STACK_SPENT` (Hold'em included), no "Phí bàn" line on
  the Blind result card, a sit-down hint that quotes one wager. Lite's own `ECONOMY` reads do not change.
- **Under it (Part E).** `Chibi lazy` (`useInView`, 200 px margin, `true` where `IntersectionObserver` is missing) draws
  only its sized root until it is near; `tint-queue.ts` runs at most four tint renders, by priority, skipping a render no
  mounted card still wants; tinted layers load @2x only at `devicePixelRatio >= 1.5` (it was `> 1`), table seats
  included (P32); the wardrobe loads in two groups (stage and cards first, saved outfits and achievement names after) and
  retries only the group that failed.
- **Tests and docs.** Server: the migration (fresh, from 0005, the data steps, the constraints, no owner key), the
  reputation service (grants, replay, high-water mark, invariant, rules cache, a failing seat), the shop (seed, locks,
  once per purchase id, the prune, a race, `PURCHASE_UNDONE`, debit before grant, the 40-buy conservation run, the shelf
  rotation), the welcome service, the newcomer calendar inside `claimDaily` (day 3, day 7, empty pools in one transaction,
  the welcome day's own claim), the monthly count and `consecutive`, the backfill, the routes (route list, 29 GM routes,
  the shop's and the welcome's refusals). Core and kit: Blind with no fee and short stacks, auto-play, the folders'
  excess, the room's sit-down, stand-up and timeout rules, the soak (`fees === 0` for Blind), `RankLabel`, the seat's
  rank, rank contrast, `PlayerBar`, `Toasts`, `lazy`, `tint-queue`, `tinted`. Web: `ShopScreen`, `ShopCard`, `ShopTab`,
  `WelcomeDialog`, `NewcomerPanel`, `DailyScreen`, `ProfileScreen`, the wardrobe's lazy cards and request counts, the
  footprint (entry chunk about 136 KB of a 140 KB budget, under 4 KB of headroom). The ops pack is at 50 cases with section P (the welcome gift, a
  purchase and the rank lock, the rank on a seat and the profile, the wardrobe's request count, the 3G first paint) and
  F-10 rewritten as the Blind-to-zero case. Docs: the player guide (Quà chào mừng, Tuần đầu tiên, Danh vọng và bậc, Cửa
  hàng, Blind chơi tới điểm cuối cùng, Chơi trên hai thiết bị), `docs/known-limitations.md` (a Plan 27 section and
  entries under Gameplay, Operations and UI), the glossary (`docs/copy-review-2026-10-10.md` §3), `docs/normal-server.md`
  (a new section, the module map, 29 routes), `docs/server-kit.md` (playing to zero, the `shop` sink, the claimants
  gone), `docs/ui-kit.md` (`RankLabel`, `rankFor`, `STACK_SPENT`, `RANK_UP`), `docs/security.md`,
  `docs/deployment-normal.md` §7 (the backfill), the SRS (§8.8, §12.3, §14.1, §15 amended; §13.1 by G2), the bug log
  (§9 answered), `docs/lessons-learned.md`, the acceptance checklist (+5 rows, P27.1–P27.5) and the test matrix, with
  their pinned counts.
- **Khác với spec / Deviations from the spec.**
  - The welcome items are **rare** (R6 → Q11), and a past month's check-in gift **sells** (R20 → Q12): the user's answers
    to the spec review.
  - The backfill subtracts only the live events that mirror `player_stats` and `player_achievements` (`hand_played`,
    `hand_won`, `daily_login`, `achievement`), not every live event as R18 says: subtracting `welcome`, `newcomer_day` or
    `gm_grant` would take a player's welcome reputation back (P34, Ruling 9).
  - `shop_prices` is seeded by code at boot (`shop-prices-seed.ts`), not by `0006`, because the catalogue grows with
    `items.json`. As a result an item added to the catalogue later is **priced and on sale at the next boot** at its
    rarity's seed price, not held back as "chưa định giá" until a GM prices it (spec B1); the `unpriced` lock is reached
    only by a row deleted by hand (`docs/known-limitations.md`).
  - Seven GM routes, not six (spec B4): the reputation rules and ranks are two routes, and `GET /api/gm/shop` is the
    tab's one read (P19, Ruling 5). A config write from the CLI's actor is `FORBIDDEN`; a past week is 409
    `WEEK_IN_PAST`, a malformed one 400 `INVALID_WEEK` (Rulings 17–23).
  - No fifth Shell tab: the shop is a link beside "Phòng thay đồ" in the lobby's header slot (P20, Ruling 6).
  - The shop's slot filter reuses the wardrobe's labels ("Phụ kiện mặt", "Quần áo"), not the spec's "Mặt" / "Trang
    phục"; free hairstyles, skin tones and free colours are not shown in the shop at all (spec B1 said every unsold item
    shows with its source label). A hairstyle that does sell is shown.
  - The purchase is confirmed by an inline status line in the pinned stage, not a toast (normal-web has no HTTP toast;
    P22). The welcome claim is confirmed the same way, inside the dialog.
  - The welcome dialog opens by itself **once per account per browser** (`localStorage['bp.welcomeShown']`), and a session
    that started with the gift unclaimed does not jump to Điểm danh (P25, Ruling 7).
  - The top rank's profile line reads "Danh vọng 5.210 · Huyền thoại" (spec A4 wrote "Huyền thoại · 5 210").
  - On a compact plate the rank pill sits on the **stack line** after the figure, and on a wide plate the word moves
    there when it would cut a long name (spec A4 put it on the name's line; Ruling 11).
  - `DailyClaimOk.newcomer` is `{ day, item: string | null, fallbackPoints, reputation, finished }` (spec C2 wrote
    `{ day, item?, points?, reputation? }`).
  - The newcomer calendar needed `newcomer_progress.last_day_key` (P2), which the spec did not name, so a check-in on
    the welcome day does not count as day 2.
  - A busted **Hold'em** seat also gets `STACK_SPENT` (spec D1 named Blind), and `TABLE_LIMIT_SPENT` is deleted with its
    strings rather than kept for Hold'em (P30, Ruling 8).
  - The Cứu trợ nudge in `STACK_SPENT` is **text only**; the spec asked for a button, and `Toasts` has no actions.
  - "Tất tay N" reuses `actions.allIn` with the amount (en "All-in 3,000"); there is no separate `playAllIn` key.
  - Bots play a short stack all in and are topped back up only once spent (they were topped up whenever short).
  - A Blind folder's excess above the highest live commitment is returned to the folder (a rule the spec did not state,
    needed once short stacks are dealt; Ruling 12). Folders' bet chips show the whole ante until the settlement (a known
    limitation).
  - Normal's `daily_logins.streak` is the month's claim count (Ruling 2); the "Hôm nay" tile follows the count; the days
    left in the month are derived on the client from `nextResetAt`; `daily.dayLabel` ("NGÀY 12") is kept, shared with the
    GM editor and the e2e suites.
  - Tinted layers load @1x below DPR 1.5 everywhere, table seats included (P32), not only in the wardrobe.
  - F-10 became the Blind-to-zero case (P30), and the shop's ops cases take section P (Ruling 24, amending Ruling 15; `M` is the layout section).
  - The entry chunk's budget rose from 130 to 140 KB (Ruling 13).
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-22: `backup.sh` (`bp-2026-10-22-2142.dump`, the server's
  clock), `git pull` to `3c853d6`, waited for the one open room to close (health polled to `rooms: 0`), `docker compose up
  -d --build`; the migrate container applied `0006_plan27` (seven rows in `drizzle.__drizzle_migrations`; the seven new
  tables present; boot seeded 8 reputation rules, 5 ranks and 89 shop prices); `reputation-backfill-cli --dry-run` then the
  real run credited 3 572 reputation across the 6 accounts (ranks afterwards: 1 Tân binh, 2 Tay bài, 3 Cao thủ), `/health`
  `ok`/`db ok` with 0 rooms; the served bundle carries Cửa hàng, Kệ tuần này and Quà chào mừng, and `/api/shop` and
  `/api/welcome` answer 401 to an anonymous call. The Windows LAN host was **not** deployed: it still lacks `0004`–`0006` and
  needs `run.ps1` with migrate plus the backfill (`deploy/normal-windows/README.md` §9e; the user's Neon database, ask
  first). Lite was rebuilt locally up to the exe step, not shipped.
- **Still open.**
  - **Parked minors, declined:** range checks on `players.reputation`, `players.rank` and `newcomer_progress.day`
    (the services already keep them in range; a CHECK constraint is a migration for no behaviour); a visually hidden
    separator between name and rank word. From the whole-branch review: a GM's reputation grant out of range answers
    with the points-worded `INVALID_AMOUNT` (`gm-service.ts`; the editor's own check stops it first); `ReputationLine`
    reads "còn 0 tới …" for a moment after a GM lowers a threshold below a player's reputation (the rank catches up at
    that player's next grant).
  - **Deploy notes.** The server now seeds its config tables (reputation rules and ranks, welcome choices, shop prices)
    at boot and **fails to start against a database without `0006`**. The Windows LAN host lacks `0004`–`0006`, so
    `run.ps1 -NoMigrate` would leave it down: it must run once with migrate (writes the user's Neon database; ask first),
    then the backfill (`deploy/normal-windows/README.md` §9e). The first boot puts every catalogue item on sale at its
    seed price while nobody holds a rank above Tân binh until the backfill runs, so the two steps go back to back.
  - **English copy waiting for the user.** New in this plan's fix wave, written by the implementer:
    `gm.reputation.invalidRules` / `gm.reputation.invalidRanks` (split from `gm.reputation.invalid`),
    `gm.shop.prices.invalidItems`, `shop.failed`, `gm.notice.reputation`, and `welcome.lead` ("Pick an item to start
    with"). Existing en strings this plan **changed**: `daily.lead`, `daily.receipt.streak`, `daily.calendarLead`; and
    **removed**: `daily.streak`, `notify.TABLE_LIMIT_SPENT*`. Awkward ones to reword: `daily.summaryCount` ("Check-in 12
    of 10/2026"), `daily.daysLeft` (no plural: "1 days left"), `gm.dialog.checkinBody` ("the streak is kept", now
    wrong), `gm.gifts.lead` ("check-in streak tier", now wrong), `game:rank.2` ("Card hand"), the ledger's "Shop (sink)".
  - **Residuals** (`docs/known-limitations.md`): reputation is never taken back; a GM's check-in reset leaves the newcomer
    calendar; a welcome at 23:59 and a check-in at 00:01 are two newcomer days; the welcome dialog's flag is per browser;
    the epic shelf is thin until the gift months pass; a new catalogue item sells at the next boot; a retry across a GM
    revoke and a restart can charge again; two GMs saving at once, the last wins; the backfill's race window and "run
    once"; the 0006 data step's fixed zone; the folder's bet chip; the text-only relief nudge; locale namespaces in the
    entry chunk; one account on two devices with no "Tiếp quản" prompt (K1); the featured-week editor offering items by
    today's locks rather than each week's.
  - **Manual checks for the user:** the welcome gift on a real account, a purchase, the rank on a phone seat, a Blind
    table played to zero, the Điểm danh page after a missed day; the Windows LAN host still needs `0004`–`0006` and the
    backfill (the user's Neon database; ask first; see the deploy notes above).
  - **Next round:** K6, more poses for the figure (`docs/bug-log.md` §9), an art project to brainstorm on its own.

## Plan 26 — GM round 2, a landscape table and a sign-in picture — merged `837485c` (2026-10-21)

Three parts the user asked for on 2026-10-19/20. **A:** the second GM batch Plan 25 promised (unlock an achievement, undo
and reclaim a check-in, edit the monthly gifts on screen, per-day source/sink figures). **B:** a table layout of its own for
a phone held sideways (the Normal web had only squeezed the portrait ellipse), with a compact result card, plus two
portrait debts. **C:** a sign-in screen with a generated hero picture. Spec
`docs/superpowers/specs/2026-10-20-plan26-gm-round2-phone-landscape-login-design.md` (the Q-table is §1, Q1–Q11; the
session's rulings are R1–R11, §7), plan `docs/superpowers/plans/2026-10-20-plan26-gm-round2-phone-landscape-login.md`
(26 pre-flight amendments, P1–P26), branch `feature/BP-26-gm-round2-phone-landscape-login`. Gate on the branch's final
tree (`main` had not moved): typecheck, lint, 2974 unit tests passed and 14 skipped (196 files, 393 s), build:normal,
build:lite up to the exe step (skipped on Node 24, "rebuilt locally, not shipped"), avatar:check 1560/1560, e2e Normal
24/24, e2e Lite 4/4, ops pack 43/43 across desktop, mobile and landscape (11.6 min).

- **What a GM sees (Part A).** Four additions to Quản trị, which now has five tabs. On a player's page, "Mở thành tựu"
  picks an achievement from a list (ones already unlocked are disabled) and pays its **full reward** (points, item, title)
  through the same code path as earning it, with its own ledger reason, `gm_achievement` (Q1). "Đặt lại điểm danh" first
  shows what it will take back (the points and the item of today's claim), then **undoes the latest claim for today and lets
  the player claim again** (Q10, option b): the points are debited (a deduction that cannot overdraw is refused, not made
  negative), the item is taken back if it can still be traced, `streak` and `total_login_days` step back one day, and the
  reclaim redraws a random day's gift. The new *Quà tháng* tab edits a month's check-in gifts on the same calendar players
  see: per day "Như mặc định", a random draw, or a fixed list of items; a past month is refused and the current month only
  changes tiers after today (R7). The overview gained "Theo ngày": a 7- or 30-day table of what entered and what left per
  economy day (the check-in time zone, R8), each row with CSS bars and no chart library (Q4).
- **What a player sees (Part A).** A GM-unlocked achievement arrives as a toast and its points. A reset check-in arrives as
  a toast naming the points taken back and the GM's reason ("Lượt điểm danh hôm nay đã được mở lại: trừ lại 15.000 điểm —
  …"); a Điểm danh page left open reads its status again on that notice, so "Nhận thưởng" lights up without a reload
  (Ruling 11). The items taken back are not named in the toast.
- **What a player sees (Part B).** A phone held sideways (landscape, 700 px or wider, 500 px or less tall) no longer gets
  a squeezed portrait table. The room header is **one line**: Mã phòng, the blinds, and Rời phòng at the top right, with a
  **⋯ "Thêm" menu** holding Đứng dậy, Tạm nghỉ / Chơi tiếp, Quản lý bàn and, where the browser allows it, **Toàn màn hình**.
  The table is a full-width ellipse sized around its seats (the ring takes the measured box ratio, so seats are spaced by
  equal arc length, with a 56 px bottom row kept free for the dock), plates are compact, and the viewer's block stands on
  the rim between the docks. The betting **tray is split**: the pre-action toggles and the presets (Min · ½ · Pot · Max)
  on the left, the action buttons in a **dock at the bottom right**; the slider is gone. The first tap on Tố / Cược opens
  the presets, the second raises, and ✎ opens a small top-anchored "Nhập số điểm" dialog for a typed amount (the on-screen
  keyboard hides the corner of a page that does not scroll). The call, raise and play buttons keep their figure, on a
  second line under the verb when the corner is narrow. The pre-hand hint (Sẵn sàng, Bắt đầu, the countdown) sits on the
  felt, so the dock stays one row. The result card is one **compact block over the felt**: "Người thắng" and a 44 px Đóng,
  one-line winners in a scrolling middle, and a one-line foot (fee, refund, the countdown). Seat tap targets are 44 px.
  When the socket drops, the "Mất kết nối — đang kết nối lại…" banner lies over the felt just under the header and moves
  no seat (spec B2, Ruling 10).
- **What a player sees (portrait).** Two debts paid: the play-or-fold squeeze table at 375×812 no longer scrolls 11 px (the
  gold "Nặn bài" badge sits beside the room's name, and the "Lật" pill lies over the cards instead of taking a row), and the
  player guide's sentence about turning the phone is now true.
- **What a visitor sees (Part C).** The sign-in and sign-up screen seats the card **beside a hero picture**: from 1024 px,
  a left column holding the picture (a group of friends at a table, the "V2" render of 2026-10-20) with the title and a
  line over its foot, the card in the right column. Below 1024 px a 300 px band of the picture crowns the card: up to
  767 px it is zoomed 160 % on the three middle faces (spec C1, the mockup's crop), from 768 to 1023 px it shows the whole
  width (`cover`), and on a landscape phone it thins to a 72 px strip so the whole form fits. Two WebP
  sizes, 1536 px (178 KB) and 768 px (66 KB), chosen by `srcset`. Exactly one `h1` is visible at a time (R10). The lead's
  contrast against the picture is at least 4.5:1, measured (6.17 at 1920, 7.29 at 1366, 5.36 at 1024).
- **Under it (Part A).** Migration `0005_plan26` (additive): the `gift_months` table, `inventory.ref` (which claim or grant
  put the item there, so an undo can find it), and the ledger reasons `gm_achievement` and `gm_checkin_undo`. Both are
  **sources** (see the deviation on the undo): `Σ balances + Σ sink rows` stays conserved, pinned by a conservation test.
  `unlockWithin` was extracted from the achievement service so earning and the GM share one path. A claim is the **latest**
  rows under `ref_id = daily:<pid>:<day>` and `acquired_at`, so a second reset takes back X, not 2X. The monthly schedule
  is a `GiftScheduleStore` (`AppServices.gifts`): `gift_months` rows override the JSON file month by month, a month that
  fails validation at boot is logged at `warn` and skipped, and `claimDaily` takes the schedule once per claim. The per-day
  figures are one raw `group by 1, 2, 3` over `point_transactions` (Drizzle binds the time zone twice, which Postgres will
  not group) behind `LedgerReader.sumsByDay`. Routes under `/api/gm/` went from 15 to 22: the achievement unlock, the check-in
  preview and its reset, the gift months (GET, PUT, DELETE) and the per-day stats. `GET /api/gm/gifts` returns one row per month
  from this one to 12 on (db row, else file entry; `source` says which). The log gained `unlock_achievement`,
  `reset_checkin`, `set_gift_month` and `clear_gift_month`; Nhật ký names the month of the last two in its "Với ai"
  column. The `reset_checkin` notice carries `amount` (the points taken back, tier and fallback together) beside `reason`,
  and `App` counts those notices into `DailyScreen`'s `checkinResets`. `revoke` clears every optional slot, `title` and
  `badge`, and strips the item from the player's saved outfits.
- **Under it (Part B).** `useRoomFrame` reads `(orientation: landscape) and (max-height: 500px) and (min-width: 700px)` and
  stamps `data-frame="desktop" | "landscape"` on the room, the ring and the result card (CSS modules hash per
  file, so each component keys on its own element). `ringPositions` takes the measured box ratio (the angle cache is keyed
  `count:ratio`); the ring reads its box synchronously in a layout effect, so its first frame is not drawn on the 2:1
  fallback, and `ResizeObserver` is guarded for jsdom. The reconnect banner is absolutely placed in the landscape frame
  (z-index 6: over the felt and the docks, under the Thêm menu). New primitive: `MenuButton` (menu / menuitem /
  menuitemcheckbox roles, arrow keys, Escape) and the ✎ dialog (`Modal` with `anchor="top"`). The result card's root
  fixes (N3) apply to **every** layout: `.resultLive` clips, `.resultHead` and `.resultFoot` no longer shrink, so the
  head cannot paint over the foot.
  The playground gained `#worst/<state>/<seats>/<lang>/<frame>` with `blindS` and a forced `landscape` or `desktop`
  frame, so a nine-seat landscape screenshot is one hash away. A new `landscape` project in the ops pack (915×412, touch,
  device scale 2.6) runs five cases; `touchDrag` and `settled` moved to `ops-helpers.ts`.
- **Under it (Part C).** `pnpm --filter @bp/normal-web login:hero` exports the two WebP sizes from the source in
  `assets/login-hero-src/` (untracked, Q9) with a size budget that fails the script. `AuthScreen` is a grid at 1024 px
  (R5) with `object-fit: cover`; no animation (R4); the hero's title and lead are hidden below 1024 px and the card's own
  title is hidden above it.
- **Tests and docs.** 43 ops cases (seven new: Q-03, L-01 to L-05 and F-12b, the play-or-fold squeeze at 375×812).
  Q-03 walks the GM's second batch end to end (reset, reclaim, unlock, save a month, reload, then the "Theo ngày" table at
  three viewports). L-01 to L-05 run at 915×412 and 915×355 (menu and dock, seat targets and nine empty seats, the
  compact result card at two sizes, the preset raise and the ✎ dialog at 915×260, a squeeze peel with the Lật pill), and
  `expectRoomFits` now also reads 915×412 in `normal.spec.ts`. Server: the migration (fresh and from 0004), the unlock,
  undo/reclaim (twice, conservation), gift store and `claimDaily` tests, the by-day stats (time zones, zero days), the
  route guard over all 22 routes, and the undo of a claim that drew nothing (tier plus the 10,000 fallback, then a
  conserving reclaim). L-01 also cuts the page's socket and checks the banner moves no seat; Q-03 waits for "Nhận thưởng"
  to come back on the notice, with no reload. Web: GM screens, `DailyCalendar`, `OverviewTab`, `AuthScreen` (hero), `locales`. Kit:
  `frame`, `geometry`, `MenuButton`, the tray, the result card, `PokerTable`. SRS §27.1 (the landscape frame),
  `docs/ui-kit.md`, `docs/normal-web.md`, `docs/normal-server.md` (22 routes, gift months, migration), `docs/security.md`,
  `docs/known-limitations.md`, `docs/player-guide.md`, `docs/login-hero-art.md` (the export process), the operation test
  plan (Q-03, L-0x, F-12b), the acceptance checklist (+3 rows, P26.1–P26.3) and the test matrix (+16 rows: 5 for Part A, 8 for Part B, 3 for Part C)
  with their pinned counts in `tooling/arch/acceptance-links.test.ts`, the bug log (§8 the round answered, §9 the next requests K1–K5).
- **Khác với spec / Deviations from the spec.**
  - `gm_checkin_undo` is a **negative source** (like `gm_adjust`), not a sink as spec A2 said: `overview()` sums signed
    totals, so a sink would have shrunk the sinks figure by the undone amount (Ruling 1).
  - `dailyStats` counts only `SOURCE_REASONS` as sources and `SINK_REASONS` as sinks; buy-in, cash-out and pot transfers are
    neither, as in `overview()` (Ruling 5).
  - A gift month cannot say "no gift" where the default has one (the server's `parseRule` needs `draw` or `fixed`). The
    select reads "Như mặc định", and "none" shows only for days the default leaves empty (Ruling 7).
  - The Quà tháng preview hides the points of each day: the tier reward table is server-side (Ruling 6, `DailyCalendar`
    `showPoints`).
  - The landscape frame also needs `min-width: 700px` (spec R1 had only orientation and height): a 640-px-wide window keeps
    the stacked layout (Ruling 8). The trigger has no `pointer: coarse` test, as R1 intended.
  - The landscape presets keep their names **Min · ½ · Pot · Max**; the spec's "½ pot / Pot / Tất tay" maps onto them.
  - The presets sit **bottom-left** under the left thumb, not stacked above the action row, where they met the neighbouring
    seats (B4-1). The bet/raise button needs **two taps** (open the sizer, then "Tố N" raises); Enter still raises at once
    (B4-2). While the sizer is open **Tất tay leaves the row** and Max stands in for it, so the row never crosses the
    viewer's plate; Tất tay stays an action button whenever the sizer is shut (B4-3). The left pills are 34 px, 44 px on a
    coarse pointer, not the brief's 30 (B4-4).
  - On a phone the call, raise and play amounts go on a **second line** under their verb in a narrow corner (Ruling 9); the
    tray's screen insets are `max(var(--space-3), env(safe-area-inset-…))`, not the `calc()` sum the plan wrote.
  - There is **no mid-hand spectator hint** in landscape: the hint moved onto the felt and is shown only while waiting.
  - The compact result card is opaque and covers the side seats at 915×355; at 844×390 it also covers the top of the
    viewer's own plate (the stack line). Text never overlaps text, but this is a deviation from "the felt stays visible".
  - L-04 raises to **600**, not 300: the lowest Hold'em tier is 100/200, so the smallest legal preflop raise is to 400.
  - The `landscape` Playwright project exists only in `e2e/ops/ops.config.ts`, not in `playwright.config.ts` (no
    `@landscape` test lives there; P22).
  - `fetchPriority` on the hero `img` was dropped: React-DOM 18.3 warns about the camel-case prop at runtime.
  - The phone band follows spec C1 (zoomed 160 % on the three middle faces) only up to 767 px. From 768 to 1023 px it keeps
    `object-fit: cover`, the picture's whole width cropped top and bottom, because the zoom cut the crowned girl's face
    off the top at 768 × 1024 (Ruling C2-4).
  - On a landscape phone (`(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)`) the band is a **72 px
    strip**, not 300 px, and the card's mark and lead are hidden with a smaller title, so the whole form fits at 915 × 412
    and 844 × 390 (Ruling C2-5). The language switch sits **below the fold** there; the page scrolls to it.
  - `NOTHING_TO_UNDO` from the spec was not implemented: a day that counts as claimed always has its claim's rows, so the
    refusal cannot be reached; "not claimed today" is `NOT_CLAIMED_TODAY`.
  - The Lite edition's room renders the kit's `RoomScreen`, so it **also takes the landscape frame** on a phone held
    sideways (after `pnpm build:lite`). No Lite e2e covers it; the ops pack's `landscape` project runs on Normal only.
  - R10's "one `h1` at a time" is met by CSS, not by rendering one: the hero's title is an `h1` and so is the card's, and a
    media query hides the card's from 1024 px and the hero's below it (jsdom, which has no media queries, sees two).
  - Items from check-ins made before `0005` carry `ref = null`, so an undo on the deploy day takes back the points but not
    that day's item; achievements unlocked by the undone claim stay (both in `docs/known-limitations.md`).
  - A `revoke` also strips the item from saved outfits (Ruling 3), and a db gift month that no longer validates at boot is
    skipped with a warning (Ruling 2).
- **Deployed.** VPS (`play.14-225-254-250.sslip.io`) on 2026-10-21: `backup.sh` (`bp-2026-10-21-2230.dump`), `git pull`
  to `c6a9c4b`, `docker compose up -d --build`; the migrate container applied `0004_gm` and `0005_plan26` (six rows in
  `drizzle.__drizzle_migrations`, `gift_months` and `inventory.ref` present), `/health` `ok`/`db ok` with 0 rooms before and
  after, and `grant-gm-cli` made the user's account the first GM. The two hero files are served (178 KB, 66 KB). The
  Windows LAN host was not deployed (no kit `.env` on this machine); Lite was rebuilt locally, not shipped.
- **Still open.** Deferred minors, none
  blocking: the by-day table clips its Ròng column inside its scroll box on a 375 px phone; `GET /api/gm/gifts` should
  return the server's today instead of the client assuming `Asia/Ho_Chi_Minh`; a fixed gift list is lost on a fixed →
  common → fixed round trip in one edit; the landscape sizer
  cannot be closed without acting (a one-tap Tất tay is lost for that turn); a nine-human landscape Hold'em table (`maxPlayersHoldem`
  is 9) is verified only as nine empty seats and in the playground, never as nine occupied plates; Blind's nine-seat
  playground case is a stress case (the mode caps at 8); the squeeze peel, the dock and the sign-in picture have not been
  tried on a real phone. Next round: K1–K5 in `docs/bug-log.md` §9.

## Plan 25 — a game-master role: Quản trị searches players, moves points, grants items, locks accounts, lists and closes rooms, and keeps a log — merged `23d64a7` (2026-10-19)

The user's request of 2026-10-17/18: a game-master (GM) role on the Normal edition, in two batches (Q3). This is the first
batch; the second (Plan 26) is unlocking achievements, resetting a check-in, editing the monthly gifts on screen and
per-day source/sink charts. Spec `docs/superpowers/specs/2026-10-18-gm-role-design.md` (the Q-table is §1, the session's
rulings §13), plan `docs/superpowers/plans/2026-10-18-plan25-gm-role.md` (with its pre-flight amendments, A1–A17), branch
`feature/BP-25-gm-role`. Gate on the branch's final tree (`main` had not moved): typecheck, lint, 2861 unit tests (14
skipped) in 466 s, build:normal, Lite web + server (the exe step needs Node 22, the machine has 24), avatar:check
1560/1560, e2e Normal 24/24, e2e Lite 4/4, ops 36/36 in 10.6 min.

- **What a GM sees.** An account whose `role` is `gm` gets a "Quản trị" row in Settings and a screen at `#/gm` with four
  tabs. *Tổng quan*: accounts, locked, GMs, sockets, open rooms and the last 24 hours of points by reason, split into what
  entered and what left the economy. *Người chơi*: a search by email prefix or name (addresses masked, `t***@gmail.com`),
  and a player's page with the full address, balance, wardrobe count, room, lock, ledger and recent hands. Every action
  sits behind a dialog that will not confirm without a reason of 3–200 characters: "Cộng/trừ điểm" (a whole non-zero
  amount, at most ±10,000,000, and a deduction cannot overdraw), "Cấp món" (one item, or the whole wardrobe),
  "Khóa tài khoản" (with its consequences spelled out), "Mở khóa", and "Trao quyền quản trị" / "Thu quyền quản trị".
  *Phòng*: every live room, private ones included, with its members; "Mời ra" removes a person (now, or when their hand
  ends) and "Đóng phòng" closes the room with every stack and any carried pot home. *Nhật ký*: the append-only log, filtered
  by player or by room. Under 640 px the tables become cards.
- **What a player sees.** A points or item grant arrives as a toast, "Quản trị viên: +10.000 điểm — <reason>", the balance
  moves with no reload, and the ledger line reads "Quản trị viên cộng điểm" / "trừ điểm". A removal says "Bạn đã bị mời ra
  khỏi phòng"; a closed room sends everyone to the lobby with their stacks back. A locked account is signed out
  everywhere, leaves its table and, at the next sign-in, reads "Tài khoản đã bị khóa" with the reason. A promotion, a
  demotion or the whole wardrobe gets a sentence of its own ("Bạn đã được trao quyền quản trị — <reason>"), and a
  promotion or demotion made in the console updates the Settings row at once (the app re-reads `/api/auth/me`).
- **Under it.** Migration `0004_gm` (additive, guarded): `users.role` (`player` | `gm`, CHECK), `locked_at`,
  `locked_reason`, and the append-only `gm_actions` (actor `ON DELETE SET NULL`, NULL meaning the CLI). The ledger knows
  `gm_grant` and `gm_adjust` as **sources**, with `ref_id = gm:<action id>`; `Σ balances + Σ sinks` is unchanged and the
  conservation test credits both. `requireGm` reads the role from the database on every request (a demotion or a lock is
  immediate); `GmService` validates first, then writes the effect and its log row in one transaction, and only afterwards
  sends `BALANCE`, `GM_NOTICE`, revokes sessions, kicks and closes the socket (a lock: sessions, room kick, notice, socket,
  in that order). Fifteen routes under `/api/gm/`. `@bp/server-kit` gained `Room.adminKick`, `Room.adminSummary`,
  `Room.createdAt` and `Gateway.disconnect` (close code 4003 `LOCKED`); core and the protocol are untouched but for a new
  `NOTIFICATION` kind. A locked account is refused at the WebSocket upgrade too (`identityForToken`). The first GM is made
  on the server with `node dist/grant-gm-cli.js <email> [--revoke]` (logged as a CLI action with the reason `cli`); the
  last GM cannot be demoted, a GM cannot lock themselves or another GM or change their own role. The e2e server alone mounts
  a loopback `POST /e2e/promote` through the new `AppDeps.extraRoutes`; `test/build.test.ts` proves `dist/` has none.
  `LedgerPanel` was lifted out of `ProfileScreen`; `Toasts` interpolates `reason`.
- **Tests and docs.** 36 ops cases (two new, Q-01 and Q-02, in `06-gm.spec.ts`: a GM grants points a player sees land, and
  closes a Blind room mid-hand with every stack home), the GM service and routes suites, `adminKick` / `adminSummary` /
  `disconnect` in server-kit, the guard, the locked sign-in and socket upgrade, the migration (fresh and from 0003), the CLI,
  the promote route and its absence from the bundle, the screen suites and the notice mapping, the conservation test.
  SRS §10.2, §18.2, §19.2, §20.2, §23 and §27.2 amended; the acceptance checklist (+3 rows, P25.1–P25.3) and the test
  matrix (+7 rows) with their pinned counts; `docs/normal-server.md` ("The GM role", "Granting the first GM"),
  `docs/normal-web.md`, `docs/server-kit.md`, `docs/security.md` (six rows, operator item 9), `docs/known-limitations.md`
  (a new section, "Quản trị"), `docs/player-guide.md` §2, `docs/deployment-normal.md` §5 and §7,
  `deploy/normal-windows/README.md` §9d, the copy glossary, the operation test plan (section Q).
- **Khác với spec / Deviations from the spec.**
  - A missing or short reason answers `400 INVALID_REASON` (the spec said `BAD_REQUEST`), checked before any lookup so a
    refusal never depends on whether the target exists.
  - A GM acting on themselves or on another GM answers `403 SELF_TARGET` / `403 TARGET_IS_GM` instead of a bare
    `FORBIDDEN`, so the screen can tell "not allowed on this target" from "you are no longer a GM" (only a bare `FORBIDDEN`
    sends the console back to the lobby). `GmService` also adds `INVALID_ROLE`.
  - A locked account is treated as signed out: the guard answers `401 UNAUTHENTICATED` (spec §3 said `403 FORBIDDEN`),
    so a locked GM is not sent to the lobby by a 403 but ends the session like any expired one.
  - The two `gm_actions` indexes are named `gm_actions_created_idx` and `gm_actions_target_idx`.
  - `AppDeps.extraRoutes` is a test-only hook (the spec had no way for the ops pack to promote an account).
  - The kit's `Toasts` interpolates the notice's `reason`, and `ui-kit` gained `notify.GM_NOTICE` (the spec named the
    web only).
  - A closed room's broadcast reason is the fixed string `closed_by_gm`; the GM's reason stays in the log.
  - `GET /api/gm/rooms/:id` returns the `AdminRoomSummary` (members included), not `room.view()`.
  - `search('')` lists every account, capped at 100 (spec: a query was required).
  - The Players tab stays mounted (hidden) while a player's page is open, so Back keeps the search and its cursor; the
    redirect from `#/gm` uses `window.location.replace`.
  - The rooms table has five columns, with mode and code under the name and the carried pot in the status cell, and a card
    layout under 640 px (the screenshots changed both); `CopyId` falls back from the clipboard API to `execCommand` to a
    selectable id, because the LAN host is plain HTTP.
  - After-hand removal is written to the room log as `left`, not `kicked_by_gm` (it goes through the ordinary leave path).
    A rejoin cannot cancel it: the gateway refuses `JOIN_ROOM` while the player is still a member.
  - A kick is logged once, after the deed, with `details.effective`; a failing log write is warned, not surfaced (the
    spec logs before acting, §5).
  - Promoting a locked account is refused: `409 TARGET_IS_LOCKED` on the screen, `LockedAccountError` (exit 1) from the
    CLI. A demotion locks the GM set before the target row, so two GMs demoting each other cannot deadlock.
- **Still open.** Deployed to the VPS with Plan 26 on 2026-10-21 (`0004_gm` applied, the first GM made by `grant-gm-cli`);
  the Windows LAN host still needs `run.ps1` without `-NoMigrate` once (the user's Neon database; ask first). A GM shares the player's password with no
  2FA; no daily cap on grants; no account deletion; `gm_actions.action` is free text in SQL; a role changed by the CLI
  shows in Settings only on reload; an after-hand removal is logged by the room as `left`; the card layout drops table
  semantics for some screen readers; no `@mobile` ops case; `refunded` counts spectators — all in
  `docs/known-limitations.md`, "Quản trị". Plan 26 is the second batch.

## BP-24 — the Normal Docker image builds and boots; esbuild goes through its API — merged `7e7b53f` (2026-10-16)

The user installed Docker Desktop to prepare for hosting, and the image's first `docker build` ever — `docs/known-limitations.md`
had said "never been built" since Plan 5 — failed in five seconds at `pnpm --filter @bp/normal-server build`:
`scripts/build.mjs` ran `node …/esbuild/bin/esbuild`, and on Linux that file is esbuild's native binary (its install step
replaces the JS shim), so Node printed `SyntaxError: Invalid or unexpected token` on a line reading `ELF`. Windows keeps the
shim, which is why no gate had seen it. Branch `bugfix/BP-24-docker-build-esbuild`.

- **What an operator gets.** `docker build -f apps/normal-server/Dockerfile .` succeeds (x86, Docker Desktop 29.8.2, 331 MB).
  Run against a real PostgreSQL 16 the image applies the committed migrations, answers `GET /health` with `"db":"ok"`,
  serves `index.html` at `/` and at a deep link, and its HEALTHCHECK turns healthy — the `service_healthy` condition
  `caddy` waits on in Compose. The same day the `normal-server` suite ran once on that PostgreSQL: 37 files, 586 tests,
  0 skipped (the two overlapping-transaction cases included), 46 s.
- **Under it.** `apps/normal-server/scripts/build.mjs`, `apps/normal-server/scripts/e2e-server.mjs` and
  `apps/lite/scripts/build.mjs` call esbuild's `build()` with the options the CLI form took (`logLevel: 'info'` keeps the
  same summary); `tsc`, `vite` and `postject` are still spawned through `process.execPath`, since their entries are
  JavaScript. No dependency, protocol or schema change.
- **Docs.** Acceptance checklist 40.8 and 66.21 → ✓ with the dated runs (63 ✓ · 1 partial · 0 ✗); `docs/known-limitations.md`
  rewrites the two entries (what has run, what has not: the Compose stack as a whole, ACME, ARM) and adds one (the image
  carries `src/` and the tests beside `dist/`, since `pnpm deploy` has no `files` list to go by); README, SRS Appendix B,
  `docs/deployment-normal.md` §2 and §10, `deploy/oracle/README.md` §8, `docs/lessons-learned.md` (four rulings).
- **Khác với spec / Deviations from the spec.** None: spec §22.4 names esbuild and the outputs, not how it is invoked.
- **After the merge (same day).** The Compose stack ran on the development machine with `DOMAIN=localhost`: `db` →
  `migrate` (exit 0) → `app` (healthy) → `caddy`; through Caddy a 308 to https, `/health` ok, the UI with HSTS and the
  CSP, a sign-up with a `HttpOnly; Secure; SameSite=Lax` cookie, `wss://` answered `WELCOME`, a foreign `Origin` 403.
  Taken down with `down -v`; the throwaway `.env` deleted.
- **Still open.** Caddy's certificate flow against a public name has never run, and the ARM build the Oracle kit needs
  is still ahead. The image's `src/` payload is a residual. Not deployed: the LAN host was not running
  and its `.env` is not on this checkout.
- **Gate** on the branch tree (`main` had not moved): typecheck, lint, 2694 unit tests (10 skipped) in 491 s,
  build:normal, Lite web + server, avatar:check 1560/1560, e2e Normal 24/24, e2e Lite 4/4, ops 34/34 in 10.8 min. The
  Lite exe step was skipped by the user's decision (it needs Node 22; the machine has 24). Chromium was installed for
  the e2e suites with the user's approval. On this machine `pnpm` exists only through corepack, so the root scripts
  need a shim on PATH (`corepack enable --install-directory <dir> pnpm`).

## Plan 22 — the day-28 check-in gift becomes a month-by-month schedule; the six epics go out one a month from 11/2026 — merged `aa0709f` (2026-10-13)

The user's decision of 2026-10-12, after the player-guide review found six epic items with no way to be earned: hand
them out through the day-28 check-in gift, one per month, and "thiết kế điểm danh theo hướng có thể mở rộng quà tặng vật
phẩm trong tương lai (thay đổi theo tháng)". Spec `docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`,
plan `docs/superpowers/plans/2026-10-12-plan22-monthly-daily-gifts.md` (with its pre-flight amendments), branch
`feature/BP-22-monthly-daily-gifts`. Gate on the branch's final tree with `main` merged in: typecheck, lint, 2690 unit tests (14 skipped), both builds, e2e normal 24/24, Lite 4/4, ops 34/34.

- **What a player sees.** The Điểm danh calendar's day-28 cell keeps its gold gift icon, and a legend line under the
  calendar names the month's gifts by their item names — in October 2026 "Ngày 28 tháng 10/2026: Huy hiệu tháng +
  Chuyên cần", from November "… + Mũ chóp quý ông" and so on. In Phòng thay đồ a locked tile says when it comes:
  "Quà điểm danh ngày 28 tháng 11/2026" for a scheduled month, "Quà điểm danh ngày 28" for the pair every month gives;
  an achievement reward keeps its achievement hint; a common or rare in a draw slot keeps "Có thể nhận từ quà điểm
  danh"; anything nothing lists says "Chưa có cách nhận món này".
- **The schedule.** `apps/normal-server/data/daily-gifts.json`: a `default` (today's column — day 7 a common draw, days
  14 and 21 a rare draw, day 28 `badge_monthly` + `title_devoted`) and `months` keyed `YYYY-MM`, each overriding any
  day with `{ "draw": "common" | "rare" }` or `{ "fixed": [ids] }`; a month's `fixed` list is complete (it replaces the
  default's, so the shipped months repeat the pair). Shipped: 2026-11 `head_tophat01`, 2026-12 `face_eyepatch01`,
  2027-01 `aura_lightning01`, 2027-02 `frame_gold`, 2027-03 `haircolor_lavender01`, 2027-04 `eyecolor_gold01`.
  October 2026 is unchanged. The operator extends it by editing the file (`docs/normal-server.md`, "Changing the daily
  gifts"); no code, no migration.
- **Under it.** `loadDailyGifts(catalog)` runs at boot inside `buildApp`, right after the achievements, and refuses a bad
  file with a message naming the month, day and id (unknown id, a free or default item, a day outside 1–31 or one the
  month never reaches, an id twice in a day or on two days of a month, a draw of any rarity but common or rare, a
  malformed month key, a month key written twice). The claim grants the claim's month's rule (`monthKey(now,
  Asia/Ho_Chi_Minh)`); already-owned fixed gifts grant nothing extra; the 10.000 fallback stays with the random tiers;
  the random draw leaves alone every id any month names as fixed (pinned by a test that fails without it). `GET
  /api/rewards/daily` carries `month` and each day's `items`; `GET /api/catalog/items` carries `dailyGifts` (the gifts
  still to come, past months dropped) — both additive, an open tab on the old bundle keeps working. The client keeps no
  copy of the day-28 pair any more. `formatMonthKey` (`MM/YYYY`) in `apps/normal-web/src/screens/format.ts`.
- **Tests and docs.** 13 schedule tests (every refusal, the shipped six months, 10/2026 as the default), the claim in
  11/2026 over HTTP and in the service, the month boundary at 23:59/00:00 Asia/Ho_Chi_Minh, the calendar DTO, the
  Daily screen (oct/nov legends, a fixed day other than 28), the wardrobe hint (default, month, achievement precedence,
  draw fallback, past month), `formatMonthKey`, i18n parity. Tests pin the user's decisions, not the file's shape:
  adding a month or giving an item again later turns nothing red; the operator doc says which edits do. SRS §13
  amended; `docs/normal-server.md`, `docs/normal-web.md`, `docs/player-guide.md` §2, the test matrix (+4 rows) and the
  acceptance checklist (+2 rows, P22), `docs/known-limitations.md`, the operation test plan (J-10, N-06).
- **Khác với spec / Deviations from the spec.** A month key written twice in the JSON is refused (not in §4.1.3; the
  loader needs the raw text for it, so `parseDailyGifts` alone cannot). Repeated tier keys inside one month are not
  detected (the last wins) — documented, not fixed. A drawable common or rare that only a past month named would still
  show the draw hint although the draw leaves it alone (Ruling 4: docs only, since the shipped file names only epics
  and the pair). `formatMonthKey` lives in normal-web, not ui-kit (Ruling 7). The legend icons got `flex-shrink: 0` at
  375 px (found in the screenshots).
- **Still open.** The build must reach the LAN host before 01/11/2026 for November's gift to be given (it is deployed
  with this merge). Parked minors: a test for the `items ?? []` guard, the legend's day order asserted, the en legend
  rendered once, a few untested loader branches, `formatMonthKey` on malformed input.

## BP-23 — a Blind Poker player who lets three decisions time out in a row is asked to stand up — merged `bb02070` (2026-10-13)

Found by the player-guide review: SRS §8.7 asks for the three-timeout stand-up in both modes, but `blind.ts`
hard-coded `timedOut: false` on every `PLAYER_ACTED`, so the room's counter reset every hand and the rule only ever
fired in Hold'em (the test-matrix row covered Hold'em only). The user chose to follow the spec.

- **What changes:** on a "Chơi hoặc bỏ" table, a human whose decision runs out three hands in a row is stood up after
  the third hand through the ordinary `PLAYER_STOOD` path, stack returned. Any real decision resets the count — a chosen
  fold, a pre-action tick and "Tự động chơi" are all real `ACTION`s. Bots never count. Pure-luck tables have no
  decision. The squeeze round's forced turn neither counts nor resets (spec 2026-10-08 §4.2); a play-or-fold squeeze
  table's decision round does count.
- **Under it:** the engine keeps the flag on `HandPlayer.timedOut` (new, Blind-only state) and emits it at the resolve, so
  `DECISION_MADE` stays bare and a fold is not given away before the reveal. `room.ts` and the runner needed no change.
  Three new core tests, six room tests (one pins the squeeze exemption with the counter set by hand, since a pure-luck
  table can never reach 2 on its own). `docs/test-matrix.md` row cites both modes; `docs/player-guide.md` and
  `docs/server-kit.md` say so.
- **Worth knowing:** a disconnected human's decisions count until the 90 s reconnect window expires, so on a 10–15 s
  table the seat can be freed by this rule before the window ends — the same outcome either way (seat freed after that
  hand, stack home), as in Hold'em. An all-AFK Blind table used to carry its pot over for ever; it now opens after three
  hands and the carry-over goes through the existing claimant path.
- Gate on the branch tree: typecheck, lint, 2659 unit tests (one slow avatar-registry test timed out under load and
  passed alone, 73/73; a stale Oracle bootstrap test on `main` fixed in `c31ec08`), both builds, e2e normal 24/24, Lite
  4/4, ops 34/34.

## 2026-10-12 — CLAUDE.md, lessons-learned, the player guide, and three wardrobe/copy fixes — merged `278b9db`, `d876db4`, `840f22d`

The user asked whether the repo carried its own operating instructions, lessons and a user guide as `requirement.txt`
§64 expects. It did not; it does now.

- **`CLAUDE.md`** (`278b9db`) — what an AI session or a new developer reads first: the docs map, toolchain pitfalls,
  the gates with their durations, the LAN-host deploy routine, the security rules, conventions (commits, branches,
  CHANGELOG, i18n, the stable Vietnamese terms), how plans are run, pitfalls.
- **`docs/lessons-learned.md`** (`278b9db`) — every lesson by group, all 28 Plan 21 rulings word for word, one block per
  earlier plan; each merged plan appends its rulings there, since the SDD workspace is deleted.
- **`docs/player-guide.md`** (`d876db4`) — Hướng dẫn chơi for players, in Vietnamese: points and account, the lobby and
  the create dialog, Hold'em, Blind A/B, the squeeze mode (with the OS-animation tip), disconnects, the wardrobe,
  achievements, settings, FAQ, Normal vs Lite. 250 quoted UI strings verified against the locale files; 36 claims
  checked against the code by a second reviewer.
- **Fixes the guide's review found** (`840f22d`): the wardrobe's "how to get this" hint promised epic items from the
  daily draw, which only gives common and rare — the hint now promises what the draw gives and names the day-28 gift
  ("Quà điểm danh ngày 28"); the check-in achievements say "Điểm danh đủ N ngày" (the metric counts claims, not
  sign-ins); `docs/known-limitations.md` no longer says a room cannot be watched.
- **Still open, decided by the user on 2026-10-12:** the six epics with no way to be earned go out through the day-28
  gift one per month from 11/2026 (Plan 22, `feature/BP-22-monthly-daily-gifts`); Blind Poker's three-timeout stand-up
  (BP-23, above).

---

## 2026-10-11 — a second Vietnamese copy pass, and a random room name on the create dialog — merged `d5e9e45` (2026-10-11)

User request (2026-10-10): "check đa ngôn ngữ … có những điểm về ngôn ngữ tiếng việt không phù hợp, không tự nhiên
(ví dụ: Tay nóng?). cần sửa toàn bộ" and "khi tạo phòng thì random luôn tên phòng". Both landed on one branch
(`fix/vi-copy-room-names`, with `fix/vi-copy` merged into it); gate on the merged tree: typecheck, lint, 2637 unit
tests, both builds, e2e normal 24/24, Lite 4/4, ops 34/34.

- **Vietnamese copy, second pass** — `docs/copy-review-2026-10-10.md` holds the rules, the glossary of terms kept
  stable (the button and phase labels the e2e suites match on) and one table per file. 711 keys read, **31 changed**,
  English untouched, key sets identical. The ones a player meets most: the title `title_hot_hand` "Tay nóng" → **"Vận
  đỏ"**, `title_devoted` → "Chuyên cần", the party hats → "Mũ sinh nhật…", `haircolor_lavender01` → "Tóc tím pastel",
  `skin_lighttan01` → "Da bánh mật", the squeeze tray line → "Mời nặn bài — hết giờ sẽ tự lật", the pre-action group →
  "Chọn sẵn trước lượt", `status.offline` → "Mất kết nối" (same word as the seat and the reconnect line),
  `errors.NOT_IN_ROOM` → "Bạn không còn ở trong phòng" (the old "chưa vào phòng nào" contradicted the table the player
  was looking at), "Máy chủ sắp tắt" in both the error and the cancel reason, `outfits.menu` → "Tùy chọn cho {{name}}"
  (a screen reader used to say "Bộ đồ Bộ 1"), "Áo bào hoàng gia", "Chuỗi 7 ngày" beside "Chuỗi 28 ngày", "Số ván chơi
  trọn vẹn". Every test, e2e locator and doc that quoted a changed string was updated in the same commits (F-11/F-12,
  E-06, J-08, the wardrobe e2e, P21.3). Judged and kept, with reasons, in the doc's §5 — among them
  `items.frame_founder` "Khung sáng lập": it matches the English "Founder frame" but rewards the one-year login
  achievement; renaming it is the user's call.
- **Random room name** — `packages/ui-kit/src/lobby/room-names.ts` `randomRoomName(lang, rng?, avoid?)`: a head and
  a tail from per-language lists (vi: Bàn / Chiếu / Góc / Hội / Tiệc × 31 places and moods such as Hoa Mai, Trăng
  Rằm, Sương Đà Lạt, Cà Phê Sữa; en: 24 × Table / Room / Hall / Lounge), every pair ≤ 30 characters (the protocol's
  limit, enumerated by a test), never the same name twice in a row, no gambling words and no numbers (a test pins
  that no pair starts "Bàn Cầu"). The create dialog opens with a rolled name in the field — still freely edited — and a
  🎲 button (`create.rollName`: "Tên khác" / "Another name") rolls another, selecting the text so typing replaces it.
  The dialog's height is unchanged (807.5 px at 1920 × 940, 698.3 px at 375 × 812); the ops D-03 empty-name case now
  clears the field first. Shared form, so Normal and Lite both have it.
- **Still open.** No e2e exercises the 🎲 itself (unit tests do). The name lists are a first draft — add or drop
  entries freely in `room-names.ts`; the tests re-check the length and the word rules.

## Plan 21 — cards dealt from a deck and turned, the showdown's lift, and the Blind squeeze mode — merged `440997e` (2026-10-09)

The user looked at how the table turns a card — "chỉ hiển thị sấp ngửa, chứ không có hiệu ứng lật từ từ" (2026-10-06) —
and asked for a way to play with the cards in hand: "tôi muốn game trở nên vui hơn (khi không dùng auto) bằng cách bổ sung
chế độ nặn bài", which on 2026-10-08 became "mode riêng, chỉ dành cho blind poker", a round of 20 s at most or until
everyone has turned. Each choice was approved in turn in a brainstorming session (06–08/10) against prototypes that ran
in a browser; the record is `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md`, which amends §8 and §17
of the main spec. There is one additive protocol change (a `squeeze` flag on a Blind room, a `REVEAL` message) and no
schema change or migration: a room's config is not stored. No library was added.

- **Cards come out of a deck and are turned where they land (every table, both editions).**
  - A three-card deck is drawn on the felt, beside the pot. Every card slides out of it face down (0.36 s) and, if it is to
    be seen, turns where it lands (0.6 s).
  - Hole cards go round the table clockwise from the seat after the button, one card per seat at a time, 0.12 s apart — closer
    on a big table, so the last card leaves the deck within 1 s of the first while the hand's timer runs (eight seats of three
    cards: 43 ms). The flop's three cards come 0.3 s apart, each sliding in while the one before it turns; the turn and the
    river come alone.
    The server's 1.5 s pace between steps is as it was.
  - At the showdown an opponent's face-down cards lift off the felt, turn in the air and set down: 0.72 s a card, 0.2 s
    between one seat's cards. The engine settles in the same step that deals the river, so when the two arrive together the
    lift waits for the river to slide in and turn.
  - The result card waits for the lift: 1270 ms (it was 870), 2230 ms when the showdown came with the river.
  - A hand that was already on the table — a refresh, a reconnect, a switch between the ring and the stack mid-hand — is not
    dealt again. "Dealt" means arrived within 1.5 s by the client's clock; `ClientHand` gains `restored` and the arrival
    stamps `dealtAt`, `boardAt` and `showdownAt`.
  - `prefers-reduced-motion` turns all of it off.
- **The squeeze mode (Blind only).**
  - Creating a Blind room offers a "Nặn bài" box, off by default, for both ways of playing. Ticked, the round is a fixed 20 s
    (the server forces it, whatever the client sends) and the room list and the room header carry a gold "Nặn bài" badge.
  - On a squeeze table the viewer's cards are dealt face down and are theirs to turn. Pressing a card and dragging towards its
    centre peels it from the pressed point — past half, or flicked, it opens; let go early, or lose the pointer, and it drops
    back — or the "Lật" pill turns both. Turning is local: the server sent the cards at the deal and learns only that the seat
    has turned (`REVEAL`, sent once, after the last card is up).
  - Pure luck: a `SQUEEZE` phase of at most 20 s follows the deal, over early when every human has turned. Bots count as turned
    from the start; at the deadline the server turns the rest. Play or fold: no new phase — the 20 s decision round is the
    round, and choosing Play or Fold turns the seat too. The round is never an action timeout: nobody is charged one, folded
    or stood up for it.
  - Other seats show "Đã lật" once they have turned (a seat that has decided shows "Đã chọn"); the tray says what the seat is
    waiting for; auto-play turns the cards the moment they are dealt.
  - A `REVEAL` lost with a dropped socket is sent again, once, when the reconnect's snapshot still has the seat unturned. The
    "Lật" pill hands keyboard focus to the seat as it hides, and the create dialog's read-only "20 giây · nặn bài" is out of
    the Tab order and dims with the form while it is busy.
- **Under it.**
  - `@bp/core`: `BlindRules.squeeze`, the `SQUEEZE` phase, `HandPlayer.revealed` and `SeatView.revealed`, the `REVEALED { seat }`
    command, the events `SQUEEZE_PHASE`, `PLAYER_REVEALED` and `SQUEEZE_ENDED`. A Hold'em seat is revealed from the deal and
    ignores `REVEALED`; `simulateHand` turns every unturned seat. `BlindRoomConfig.squeeze` (validated, default `false`),
    `ECONOMY.squeezeTurnTimerSec` and the `REVEAL` client message are in the protocol.
  - `@bp/server-kit`: `HandRunner` arms one table-wide deadline per round, no bot timer, and turns the unturned seats at the
    deadline (guarded by the phase and `turnSeq`); an auto-fold seat is turned for. `Room.reveal`, the gateway's `REVEAL`
    case, and `SQUEEZE_PHASE` going out stamped with `deadlineAt` like `DECISION_PHASE`.
  - `@bp/ui-kit`: `Deck` and `DeckAnchorProvider`; `Card` learns `dealt`, `reveal="lift"` and its latched delays; `motion.ts`
    holds the numbers and the three rules the table times by; `PeelCard` with the geometry in `peel.ts`; `Seat`, `PokerTable` and
    `RoomScreen` carry the round; `GameClientApi.reveal()`; the lobby's box and badges; ten locale keys in both languages.
  - The playground gains "Blind A · nặn bài", "Blind B · nặn bài" and a `#peel` page.
- **Replaced.** The first design made squeeze a per-device switch in Settings; the user chose a mode of the table instead
  (2026-10-08), so there is no setting and no stored preference: everyone at a squeeze table plays it.
- **Tests and docs.**
  - New tests at every layer: the engine, config validation, the runner, the room, the gateway, the reducer and the client hook,
    `Card`, `PeelCard`, `peel`, `Seat`, `PokerTable`, the lobby form and list, the reveal hold.
  - Operation pack: F-11 (two browsers; one peels by mouse, one presses "Lật"; the round ends before 20 s) and F-12 (a 375 × 812
    touch phone: the layout whole, one card peeled by finger). The Lite smoke creates a squeeze room and plays it out.
  - Docs: main spec §8.1, §8.3 (step 2b), §8.5, §8.7, §17 and §20.1; `docs/server-kit.md`, `docs/ui-kit.md`;
    `docs/test-matrix.md` (ten rows) and `docs/acceptance-checklist.md` (P21.1–P21.3), whose row counts
    `tooling/arch/acceptance-links.test.ts` now pins at 53 and 67; `docs/known-limitations.md`; and
    `docs/operation-test-plan.md` (F-11 and F-12, and the two rows whose timing changed).
- **Khác với spec / Deviations from the spec.**
  - The deck sits **beside the pot, under the board, in both layouts**; the spec and the plan put it above the board. A layout
    probe showed that on a ring it runs into the top seat's lines on every short window (1366 × 768, 1536 × 730, 1280 × 720)
    and, on the phone, pushed the pot onto the viewer's cards. It is still mid-table, as the user chose.
  - The deck is measured by the **card** through a context (`DeckAnchorProvider` / `useDeckAnchor`, `Card`'s `dealt` and
    `useDealFrom`), not by `PokerTable` measuring every slot and passing each card a `dealFrom` (spec §5.3).
  - A `REVEAL` from a player with no seat is answered `NOT_SEATED`; the spec said `NOT_IN_HAND` for "not seated or not in the
    hand". `NOT_IN_HAND` is what a seat that was not dealt into the running hand gets. With no hand running a seated player's
    `REVEAL` is answered `ACK` and does nothing: one sent as the last card opened can land after its hand is over, and must
    not come back as "Bạn không tham gia ván này". Outside a squeeze round the room also answers `ACK` without sending the
    engine anything: a submit would re-arm the hand's timers for nothing.
  - `PEEL.snapMs` is 200 (spec: 0.2 s; the plan had 220). The flick is read from the pointer's real and coalesced positions
    over its last 100 ms, with a 40 ms pause rule, not from "the last six samples": a real flick did not open on six.
  - The squeeze timer is drawn **on the viewer's own plate** while their cards are not all turned. The spec says "như pha
    quyết định", but the decision phase shows no countdown to copy. On a play-or-fold squeeze table it stays until the viewer
    has chosen, since its 20 s covers the peel and the choice.
  - `REVEAL` goes out when the viewer's **last** card is up, once per hand — not when the first turns.
  - The "Nặn bài" checkbox sits **under "Số lượng bot"**, its hint read by screen readers only (`aria-describedby`); while it is
    ticked the timer's cell reads, read-only, "20 giây · nặn bài" instead of disappearing. This keeps the create dialog whole
    at 1920 × 940 and `.modeFields` at 14rem.
  - A seat that has decided shows "Đã chọn", which stands for "Đã lật": never both badges. The "Lật" pill is 28 px tall at
    least and keeps its place for the whole hand.
  - The auto-play toggle is also offered on a pure-luck squeeze table, where it means "turn my cards at once".
  - The lift waits for the river when the showdown comes with it, and the result card's hold grows by the same 960 ms. The
    spec took the river's 1.5 s pacing to leave it at rest first, but the engine settles in the `ADVANCE` that deals it.
  - The deal's whole span is capped at 1 s (`DEAL_SPAN_MS`): the step between cards is `min(120 ms, floor(1000 / (cards - 1)))`,
    so an 8-seat, 3-card deal steps about 43 ms. The spec's 0.12 s step was written for one card at a time, and the 10 s
    play-or-fold timer runs from the deal.
  - No `phases.squeeze` string (spec §5.3): nothing prints the round's name. `BlindRules.squeeze` and `ClientSeat.revealed` are
    optional, so existing fixtures stay valid; a validated `BlindRoomConfig` always carries `squeeze`.
- **Still open.**
  - The user's hand test on a real phone (spec §8 asks for one) is still to be done. What to try comes from the Plan 21
    ledger (the Task 6 and Task 9 reviews): peel by touch, a quick flick then a quick tap on "Lật", iOS Safari.
  - The peel is driven in Chromium only. Firefox's and WebKit's touch-capture semantics (a `lostpointercapture` from the child
    that held the touch implicitly) are guarded in `PeelCard` and unit-tested, never run in those browsers.
  - On a device that does not coalesce pointer events, a single quick move after a rest is not read as a flick: the card opens
    only past half.
  - On a 375 × 812 phone a play-or-fold squeeze table's stage scrolls 11 px in the round (six seats, one bot: the header's
    third line and the "Lật" pill's row); the viewer's seat stays on screen. A pure-luck one fits: it was 3 px over, until
    the phone's tray wait line gave back 8 px, and F-12 asserts the stage again, not just the page.
  - A switch between the ring and the stack in the middle of a round can send a second `REVEAL`, which is a no-op.
  - All five are written up in `docs/known-limitations.md` (the first two as one entry). `docs/ui-kit.md`'s Footprint table
    was not re-measured.

---

## Plan 20 — the open defects: keyed money writes, AA contrast, wardrobe, table and lobby, redrawn skin — merged `eb2fcc0` (2026-10-05)

The user asked for every bug still on record to be fixed ("có, hãy fix các bug còn tồn đọng đi. không cần hỏi lại",
2026-10-05). That is each note left open in `docs/bug-log.md` §7, the four real defects that sat in
`docs/known-limitations.md`, and what turned up on the way. Roadmap features, rule changes, trade-offs with a recorded
reason and infrastructure facts were left alone; the bug log's Plan 20 block lists them with one reason each. There is
no protocol change and there is one additive migration: `0003_ledger_keys`, a new table (Lite schema v3).

- **Money: a keyed ledger write is applied once.**
  - A cash-out that had committed but lost its reply was credited a second time when the room retried it.
    `apply(entries, meta, { key })` now claims the key in a `ledger_keys` table inside the write's own transaction; a
    repeat is a no-op that reports `applied: false`. A rejected batch gives its claim back.
  - The room keys every write it may retry: buy-in, cash-out, the refund of a buy-in that never got a seat, and a
    carry-over release.
  - A seat whose cash-out is pending is frozen: it keeps its stack, sits out, is never dealt in, and every end of hand
    retries it. A buy-in that failed is replayed on the next Sit, or refunded on a removal; a carry-over release that
    failed is held aside instead of being dealt again.
  - A kick whose cash-out fails is finished at the end of the next hand: the player, already told they were removed,
    is no longer left behind watching. A buy-in that fails pushes the balance at once, so the bar shows a debit that
    landed.
  - `ledger_keys` (about two rows per sitting) is emptied when a server starts: rooms live in memory, so no key can be
    retried across a restart. A `--smoke` run of Lite never empties it.
- **Contrast reaches AA.**
  - `--red` is split into ink and fill, the way teal already was: red ink on the dark page goes from 3.6:1 to 6.2:1
    (3.2 to 5.6 on a raised panel, 3.1 to 5.4 on the felt panel), and everything painted with `--red-fill` is
    pixel-identical.
  - A badge's text is measured as a composite, on every ground a badge is printed on, and clears 4.5:1 (it was 4.1 to
    4.4).
  - On the light theme the names on the hand-result card read the page's dark ink on a night card, about 1.1:1; they are
    light now.
  - Input placeholders reach AA in Lite, Normal and the kit's join-by-code fields.
  - Lite's parchment island has a contrast test, and the helpers are exported as `@bp/ui-kit/testing`.
- **Wardrobe.**
  - The "Đang dùng" pill no longer overlaps the skin swatch at desktop and tablet widths.
  - With "Hiện cả món chưa có" ticked, a card showing an owned colour variant keeps the unlock hint of its locked
    original, and a locked dot is named "name, Chưa có: hint".
- **Table and lobby.**
  - The hand-result card's backdrop fades out at all four edges instead of ending in a visible step.
  - A room name carries a tooltip only while it is hovered *and* cut, so screen readers no longer read it twice.
  - The lobby heading wraps at 320 px; the "create a room" button used to push the page 14 px sideways.
  - The narrowest room ticket is measured at three window widths.
- **Avatar: the skin a hair or outfit picture redrew takes the tone.**
  - Under brown and deep tones, cream specks and a light jagged line showed along the hairline, and a cream instep inside
    the royal robe's and the Tết áo dài's slippers: those pictures repaint some of the body's skin, which no skin colour
    reached.
  - Every real front hair and every v4 outfit gets a skin mask of its own (32 new masks, 16 hair masks re-cut; no picture
    changed by this step), painted by a fourth tint mode, `ratio`. The hairline specks drop by 99 % or more (the wavy
    style had none to drop); this step leaves the natural tone byte for byte what it was.
  - The royal robe's left instep kept a peach rim where its shadow was drawn over the body's outline; it takes the tone
    now too.
  - Three seams in the art itself, found in review, are mended, and these do change the natural tone:
    - the wavy hairstyle's back half has its front's lightness: the pipeline recolours both halves against the front's
      reference, so the two light rectangles that showed at the temples at every tone are gone;
    - the hime's, the ponytail's and the wavy's front layers no longer carry a copy of the body's line below the head,
      which drew thin orange-brown lines along an outfit's shoulders and sleeves (2 356, 102 and 103 px). The step that
      finds it keeps a lock's end that hangs across the head's last row.
  - A few light specks remain at deep tones, all drawn by the pictures themselves: the Tết insteps' white highlights,
    strand edges close to a light hair's colour, the ponytail's own light-orange highlights, and two faint leftovers on
    the royal robe (5 px and 3 px, seen only at 8×).
- **Logs and labels.**
  - A room that closes while an earlier carry-over release still fails now also logs the newer pot it cannot release
    (`carry-over not released at close`, with the room and the amount) instead of losing it from the books unsaid.
  - A buy-in refund that fails at shutdown is logged as `shutdown settlement failed`, with its key and the buy-in,
    rather than as a cash-out with `stack: 0`.
  - The locked original's hint line in the wardrobe is worded by a `wardrobe.familyHint` template in both languages.
- **Follow-up 2026-10-06: a hat that covers the crown keeps the hair under it** (user: "khi đổi item mũ, thì có item bị
  lộ tóc, trông không tự nhiên"; merge `7841e1b`).
  - Since Plan 19 no hat hides any hair. A hairstyle's front layer is the whole crown, so hair standing above the head
    rose through the hats that cover it: the ponytail's tie above the nón lá, the beanie and the beret, the spiky cut's
    spikes, the tousled cut's tuft, the bob's ahoge and the wavy cut's volume above the brim.
  - The beret, the beanie and the nón lá, in every colour, now carry a hair clip (`<hat>_hairclipmask`). The pipeline
    cuts it from the hat's own shape.
  - Hair shows only below the hat's lower edge. Beside the hat, it shows only below the edge of the hat's nearest side.
  - The kit draws both hair layers through the clip as a CSS mask. The sheets apply the same clip.
  - The top hat, the visor, the crown and the party cone sit on the hair rather than over it, and are unchanged.

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
