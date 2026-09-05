# Bảng kiểm chấp nhận — requirement.txt mục 40 & 66

Đây là bản kiểm cuối cùng của dự án: từng dòng của **mục 40** (*Acceptance Test — Normal/Lite
Separation*) và **mục 66** (*Success Criteria*) trong `requirement.txt`, kèm bằng chứng chạy được.
Phụ lục B của bản thiết kế trỏ về tài liệu này.

Cột yêu cầu viết bằng tiếng Việt, kèm nguyên văn tiếng Anh của `requirement.txt` để đối chiếu. Cột
bằng chứng viết bằng tiếng Anh, như mọi tài liệu dành cho lập trình viên trong thư mục này — và vì
tên test, đường dẫn và lệnh vốn là tiếng Anh.

**Cách đọc cột bằng chứng.** Mỗi ô là một trong ba dạng:

- Một **test**: đường dẫn tệp test trong dấu nháy ngược, một mũi tên `→`, rồi tên `it()` đúng nguyên
  văn cũng trong dấu nháy ngược. Chạy bằng `pnpm test`.
- Một bước **e2e**: `apps/normal-web/e2e/normal.spec.ts` → `một tài khoản chơi trọn một ván Blind với bot`
  hoặc `apps/lite/e2e/lite.spec.ts` → `hai người chơi và một bot chơi trọn một ván Blind`.
  E2E nằm ngoài `pnpm test` — xem README.
- Một bước **thủ công**, luôn kèm kết quả mong đợi.

Mọi trích dẫn dạng thứ nhất và thứ hai đều được máy kiểm:
`tooling/arch/acceptance-links.test.ts` → `cites only test names that appear in the file they are cited from`
đọc chính tệp này, kiểm rằng mỗi tệp test được trích dẫn có thật và mỗi tên test được trích dẫn thật
sự nằm trong tệp đó. Đổi tên một test mà quên sửa bảng này thì `pnpm test` đỏ.

**Trạng thái:** `✓` đạt · `partial` đạt một phần, có nêu lý do · `✗` chưa đạt, có nêu lý do.

## Kết quả chạy thật

`pnpm test` tại gốc kho, Windows 11 / Node 22.13 / pnpm 9.15.9, ngày **2026-09-05**:

```
Test Files  116 passed (116)
Tests       1302 passed | 1 skipped (1303)
Duration    161 s
```

Theo package: `@bp/core` 168 · `@bp/server-kit` 92 · `@bp/ui-kit` 129 · `@bp/http-kit` 75 ·
`@bp/normal-server` 364 (+1 bỏ qua) · `@bp/normal-web` 219 · `@bp/lite` 224 · `tooling` 31.

Test duy nhất bị bỏ qua là `apps/normal-server/src/economy/economy-service.test.ts` →
`credits exactly once when two claims race (real Postgres only)`: PGlite chỉ có một kết nối, hai
giao dịch chồng nhau trên nó sẽ deadlock chứ không tuần tự hóa, nên trường hợp này chỉ có nghĩa khi
chạy với `TEST_DATABASE_URL` trỏ vào một PostgreSQL thật — cũng đúng là lý do khiến dòng 66.21 là
`partial`. Không test nào **được trích dẫn trong bảng này** bị bỏ qua. `pnpm typecheck` và
`pnpm lint` sạch cùng ngày.

E2E (`pnpm e2e:normal`, `pnpm --filter @bp/lite e2e`) không nằm trong `pnpm test`: chúng cần bản
build và một lần tải Chromium. Các dòng dẫn e2e nói rõ điều đó.

Tổng kết trạng thái: **61 ✓ · 3 partial · 0 ✗** trên 64 mục (21 của mục 40, 43 của mục 66).

---

# Mục 40 — Acceptance Test: tách biệt Normal/Lite

## Kiến trúc (Architecture)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 40.1 | Không có engine poker bị nhân bản.<br>_No duplicated poker engine._ | The Hold'em engine exists once, in `packages/core/src/hand/holdem.ts`; both editions reach it through `@bp/core`, and nothing may depend on anything else: `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages`. Manual: `grep -rl createHoldemHand apps packages --include=*.ts` names only paths under `packages/core/src/hand/`. | ✓ |
| 40.2 | Không có engine Blind Poker bị nhân bản.<br>_No duplicated Blind Poker engine._ | The Blind engine exists once, in `packages/core/src/hand/blind.ts`, exercised by `packages/core/src/hand/blind.test.ts` → `antes every seat, deals the configured hole cards, adds carry-over`; the package boundary is held by `tooling/arch/boundaries.test.ts` → `@bp/core source never mentions editions or imports other workspaces / node built-ins`. Manual: `grep -rl createBlindHand apps packages --include=*.ts` names only `packages/core/`. | ✓ |
| 40.3 | Không có logic bot bị nhân bản.<br>_No duplicated bot logic._ | The bot lives only in `packages/core/src/bot/` and runs for both editions through server-kit: `packages/core/src/bot/bot.test.ts` → `plays 2000 blind hands of every variant`; `packages/server-kit/src/room/hand-runner.test.ts` → `schedules bot decisions, times out the undecided human, reveals with pacing and completes`. | ✓ |
| 40.4 | Core không import Normal.<br>_Core does not import Normal._ | `tooling/arch/boundaries.test.ts` → `@bp/core has no runtime dependencies`; `tooling/arch/boundaries.test.ts` → `@bp/core source never mentions editions or imports other workspaces / node built-ins`. The allow-list in that file gives `@bp/core` the empty set. | ✓ |
| 40.5 | Core không import Lite.<br>_Core does not import Lite._ | The same two assertions: `tooling/arch/boundaries.test.ts` → `@bp/core has no runtime dependencies`. Adding a package without declaring it is caught by `tooling/arch/boundaries.test.ts` → `every workspace package is known`, so the allow-list cannot be bypassed by inventing a new name. | ✓ |
| 40.6 | Lite không phụ thuộc Normal.<br>_Lite does not depend on Normal._ | `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages` (`@bp/lite` may name only `@bp/core`, `@bp/server-kit`, `@bp/ui-kit`, `@bp/http-kit`); and at the level of the shipped file: `apps/lite/test/footprint.test.ts` → `carries none of the Normal edition dependencies`. | ✓ |
| 40.7 | Normal không phụ thuộc Lite.<br>_Normal does not depend on Lite._ | `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages`: neither `@bp/normal-server` nor `@bp/normal-web` has `@bp/lite` on its list, and `tooling/arch/boundaries.test.ts` → `every workspace package is known` blocks adding one without saying so. | ✓ |

## Build

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 40.8 | Normal build thành công.<br>_Normal builds successfully._ | The real production build (tsc, then esbuild) runs inside `pnpm test`: `apps/normal-server/test/build.test.ts` → `produces both entry points`; `apps/normal-server/test/build.test.ts` → `inlines the workspace packages instead of importing them`; `apps/normal-server/test/build.test.ts` → `ships the migrations and the catalogues beside dist/`. Web: `pnpm build:normal` writes `apps/normal-web/dist/`, measured by `apps/normal-web/test/footprint.test.ts` → `keeps the entry chunk inside the first-paint budget`. | partial — **the Docker image has never been built**: the development machine has no Docker daemon, so `docker compose up -d --build` has only been reached as far as `docker compose config`. Pre-flight in `docs/deployment-normal.md` §2; see `docs/known-limitations.md`. |
| 40.9 | Lite build thành công.<br>_Lite builds successfully._ | Manual: `pnpm build:lite` on Windows x64 + Node 22 produces `apps/lite/release/lite/bind-poker-lite.exe` (measured 2026-09-05: 81.4 MB). Automated, against that same artefact: `apps/lite/test/footprint.test.ts` → `fits the size cap`; `apps/lite/test/footprint.test.ts` → `ships the release paperwork beside it`. | ✓ |
| 40.10 | Lite không mang theo asset thừa của Normal.<br>_Lite excludes unnecessary Normal assets._ | `apps/lite/test/footprint.test.ts` → `carries none of the Normal edition dependencies`; `apps/lite/test/footprint.test.ts` → `fits the JavaScript download budget` (measured 93.6 KB gzip against a 250 KB budget); `apps/lite/test/footprint.test.ts` → `fits the CSS download budget` (10.6 KB against 40 KB). | ✓ |
| 40.11 | Lite không cần PostgreSQL.<br>_Lite does not require PostgreSQL._ | Lite runs entirely on `node:sqlite`: `apps/lite/server/src/db/sqlite.test.ts` → `creates the schema and stamps user_version to MIGRATIONS.length`; and the bundle loads nothing but built-ins: `apps/lite/test/footprint.test.ts` → `requires nothing but built-ins and the known-inert optional paths`. | ✓ |
| 40.12 | Lite chạy độc lập.<br>_Lite can run standalone._ | The executable itself is booted by the test: `apps/lite/test/smoke.test.ts` → `boots, answers /health and exits 0`; and a second process on the same data directory is refused rather than allowed to overwrite: `apps/lite/test/smoke.test.ts` → `refuses to start, and leaves the running instance able to stop itself`. | ✓ |

## Thời gian chạy (Runtime)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 40.13 | Multiplayer bản Normal hoạt động.<br>_Normal multiplayer works._ | A whole hand between two registered accounts over real WebSockets, settled through the ledger: `apps/normal-server/src/app.test.ts` → `settles through the ledger, records a table_fee sink and moves both players’ counters`; the session is bound at the upgrade: `apps/normal-server/src/app.test.ts` → `binds the player at the upgrade — no HELLO, no token in a query string`. E2E against the built app: `apps/normal-web/e2e/normal.spec.ts` → `một tài khoản chơi trọn một ván Blind với bot`. | ✓ |
| 40.14 | Multiplayer bản Lite hoạt động.<br>_Lite multiplayer works._ | `apps/lite/server/src/app.test.ts` → `authenticates a session token over /ws and answers LIST_ROOMS`. E2E with two browser contexts and a bot, including a mid-hand reload: `apps/lite/e2e/lite.spec.ts` → `hai người chơi và một bot chơi trọn một ván Blind`. | ✓ |
| 40.15 | Hai bản dùng chung luật core.<br>_Both use the same core rules._ | The rules live in `@bp/core` and run through `@bp/server-kit`, which both editions plug into: `packages/server-kit/src/room/room-hands.test.ts` → `plays a full hand with bots, settles balances, records history and schedules the next hand`; the boundary is held by `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages`. | ✓ |
| 40.16 | Hai bản dùng chung protocol core.<br>_Both use the same core protocol._ | The protocol lives in `packages/core/src/protocol/`: `packages/core/src/protocol/validate.test.ts` → `parses an ACTION with reqId and baseSeq`; the shared client mirrors core's own `playerView` frame by frame: `packages/ui-kit/src/client/reducer.test.ts` → `hold’em, 3 seats, 40 seeds`. | ✓ |
| 40.17 | Test dùng chung của phần game đều xanh.<br>_Shared game tests pass._ | `pnpm --filter @bp/core test` — 13 files, 168 tests, all green in the run quoted above. It includes the money-conservation invariant over random hands: `packages/core/src/hand/engine.test.ts` → `random hold’em hands never break money conservation or produce illegal states`; `packages/core/src/hand/engine.test.ts` → `random blind hands (2/3 cards, modes A/B) conserve money`. | ✓ |

## Khả năng bảo trì (Maintainability)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 40.18 | Luật poker mới chỉ cần sửa một chỗ trong Core.<br>_New poker rules require one Core change._ | No edition holds any rule: `tooling/arch/boundaries.test.ts` → `@bp/core source never mentions editions or imports other workspaces / node built-ins`, and an edition only ever sees a `HandView` handed to it by server-kit. Manual: `grep -rn "export function computePots" apps` and `grep -rn "export function legalActions" apps` are both empty — the editions call, they do not redefine. Worked example: Plan 7's `SIT_OUT` / `SIT_IN` changed `packages/core` and `packages/server-kit` once and took effect in both editions. | ✓ |
| 40.19 | Tính năng avatar mới chỉ ảnh hưởng Normal.<br>_New Avatar features affect Normal only._ | `@bp/ui-kit` knows nothing about cosmetics; it takes a slot: `packages/ui-kit/src/table/PokerTable.test.tsx` → `draws no caption line at all when the app supplies no slot`. The catalogue and every renderer live in Normal: `apps/normal-web/src/avatar/Avatar.test.tsx` → `draws every visual item in the catalogue, and nothing that is not one`. Lite passes `undefined` and changes not a line. | ✓ |
| 40.20 | Thay PostgreSQL không đụng tới Game Engine.<br>_PostgreSQL replacement does not affect Game Engine._ | Core has no runtime dependency at all: `tooling/arch/boundaries.test.ts` → `@bp/core has no runtime dependencies`. Live proof: the same engine already runs on SQLite in Lite, through the same server-kit repository interface — `apps/lite/server/src/repos/sqlite-repos.test.ts` → `applies a multi-player batch and reports balances through get()`, against `apps/normal-server/src/repos/balance-repo.test.ts` → `nets a player’s deltas before judging solvency`. | ✓ |
| 40.21 | Tối ưu Lite không làm hỏng Normal.<br>_Lite optimization does not break Normal._ | One `pnpm test` runs both suites in the same pass, so a change in Lite that breaks Normal is red immediately; and the dependency direction is one-way by construction: `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages`. Lite's footprint budgets read only Lite's own artefacts: `apps/lite/test/footprint.test.ts` → `fits the JavaScript download budget`. | ✓ |

---

# Mục 66 — Success Criteria

## Gameplay

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.1 | Normal Poker chạy từ lúc tạo phòng đến showdown.<br>_Normal Poker works from room creation through showdown._ | Creating and entering a room: `packages/server-kit/src/gateway/gateway.test.ts` → `lists public rooms live, joins by code, refuses wrong passwords and double rooms`. Every street through to showdown: `packages/core/src/hand/holdem.test.ts` → `check-around reaches showdown through all streets`. The whole hand through the room actor: `packages/server-kit/src/room/room-hands.test.ts` → `two humans check down to showdown; only table stacks move`. | ✓ |
| 66.2 | Blind Poker 2 lá chạy được.<br>_Blind Poker 2 Cards works._ | `packages/core/src/hand/blind.test.ts` → `reveals every decision at once when the last seat decides`; `packages/core/src/hand/blind.test.ts` → `two or more players → reveal and showdown among players only`. E2E on the built app: `apps/lite/e2e/lite.spec.ts` → `hai người chơi và một bot chơi trọn một ván Blind`. | ✓ |
| 66.3 | Blind Poker 3 lá chạy được.<br>_Blind Poker 3 Cards works._ | `packages/core/src/hand/engine.test.ts` → `random blind hands (2/3 cards, modes A/B) conserve money`; the client mirrors all three hole cards: `packages/ui-kit/src/client/reducer.test.ts` → `blind mode A (3 cards), 2 seats, 20 seeds`. The 3-card ruleset is settled in spec §8.1 — eight cards into the evaluator, best five win. | ✓ |
| 66.4 | Xếp hạng bài poker đúng.<br>_Poker hand ranking is correct._ | Checked against brute force over every 5-card subset: `packages/core/src/evaluator/evaluator.test.ts` → `matches brute-force maximum over all 5-card subsets for random 7 and 8 card hands`; category order and kickers: `packages/core/src/evaluator/evaluator.test.ts` → `orders categories`; `packages/core/src/evaluator/evaluator.test.ts` → `wheel is the lowest straight`. | ✓ |
| 66.5 | Chia pot đúng.<br>_Pot settlement is correct._ | `packages/core/src/betting/pots.test.ts` → `creates side pots for uneven all-ins`; `packages/core/src/betting/pots.test.ts` → `splits ties and hands odd chips clockwise from the button`; end to end in a real hand: `packages/core/src/hand/holdem.test.ts` → `side pots: short all-in, ties split with odd chip after the button`; the table fee: `packages/core/src/betting/pots.test.ts` → `rounds down and applies the cap`. | ✓ |
| 66.6 | Bot tham gia được Blind Poker.<br>_Bot can participate in Blind Poker._ | 2,000 hands of every variant with no action refused: `packages/core/src/bot/bot.test.ts` → `plays 2000 blind hands of every variant`; and a bot playing for real over the wire: `packages/server-kit/src/gateway/gateway.test.ts` → `deals private cards only to their owner, drives the decision phase, settles and pushes the balance`. | ✓ |

## Multiplayer

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.7 | Người chơi tạo được phòng.<br>_Players can create rooms._ | `packages/server-kit/src/room/room-manager.test.ts` → `creates rooms with unique codes, lists public ones newest first, finds by id/code/player`; the room password never leaves the server: `packages/server-kit/src/room/room-manager.test.ts` → `never puts the room password in the ROOM_CREATED domain event`. | ✓ |
| 66.8 | Người chơi vào được phòng.<br>_Players can join rooms._ | `packages/server-kit/src/room/room.test.ts` → `join: password, capacity net of seated bots, duplicates; leave: host transfer and empty-room close`; joining by room code over the wire: `packages/server-kit/src/gateway/gateway.test.ts` → `lists public rooms live, joins by code, refuses wrong passwords and double rooms`. | ✓ |
| 66.9 | Giao tiếp realtime hoạt động.<br>_Realtime communication works._ | Handshake and authentication: `packages/server-kit/src/gateway/gateway.test.ts` → `accepts a valid token, rejects an invalid one, and closes silent sockets after the HELLO timeout`; heartbeat: `packages/server-kit/src/gateway/gateway.test.ts` → `pings clients and drops those that never answer`; the client reconnects on its own: `packages/ui-kit/src/client/connection.test.ts` → `reconnects with exponential backoff, re-sends HELLO, stops on SESSION_REPLACED and on disconnect()`. | ✓ |
| 66.10 | Đồng bộ lượt hoạt động.<br>_Turn synchronization works._ | The §29.3 soak, 6 clients × 3 rooms × 20 hands: `packages/server-kit/src/soak.test.ts` → `hold'em: 6 clients over 3 rooms play 20 hands each with no seq gaps and no points created or lost`. Measured 2026-09-05 over four runs: 60–62 hands, **0** `seq` gaps, **0** resyncs, p95 action → broadcast **4–10 ms** against spec §24's 50 ms budget, worst single sample 57 ms. Server-side ordering: `packages/server-kit/src/gateway/connection.test.ts` → `runs tasks strictly in order, even when an earlier task is still pending`. | ✓ |
| 66.11 | Rớt mạng và nối lại hoạt động.<br>_Disconnect/reconnect works._ | `packages/server-kit/src/gateway/gateway.test.ts` → `a dropped client keeps its seat, gets a snapshot on return, and a second login replaces the first`; past the 90-second window the seat is given up: `packages/server-kit/src/room/room-hands.test.ts` → `disconnect: others are told, the player receives nothing, reconnect restores delivery; expiry stands up then removes`; the client rebuilds mid-hand: `packages/ui-kit/src/client/reducer.test.ts` → `rebuilds from a snapshot after the flop and keeps mirroring through the rest of the hand`. | ✓ |
| 66.12 | Hành động không hợp lệ bị từ chối phía server.<br>_Invalid actions are rejected server-side._ | `packages/server-kit/src/room/room-hands.test.ts` → `rejects stale, out-of-turn, illegal and non-seated actions with the right codes`; a bet outside the legal range: `packages/server-kit/src/edge-cases.test.ts` → `is refused as INVALID_AMOUNT and the message names the bounds that would have worked`; a retransmitted `reqId` is never applied twice: `packages/server-kit/src/edge-cases.test.ts` → `replays on the connection that remembers it, and is re-evaluated — never re-applied — on a new one`. | ✓ |

## Kinh tế (Economy)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.13 | Điểm hoạt động.<br>_Points work._ | The ledger moves all-or-nothing and never goes negative: `apps/normal-server/src/repos/balance-repo.test.ts` → `is all-or-nothing: one insolvent player rolls the whole batch back, ledger included`; conservation across many hands: `packages/server-kit/src/room/room-hands.test.ts` → `blind: Σ human balance changes + bot nets + fees = 0 across 12 hands with a mixed policy`. Soak, 2026-09-05: every run balances exactly — e.g. `1 199 576 + 424 = 1 200 000` — with not one point created or destroyed across ~490 hands. | ✓ |
| 66.14 | Điểm danh hằng ngày hoạt động.<br>_Daily rewards work._ | Normal: `apps/normal-server/src/economy/economy-service.test.ts` → `pays day 1 through the ledger, advances the streak and announces the claim`; `apps/normal-server/src/http/routes-rewards.test.ts` → `credits the claim once and answers the second with 409 ALREADY_CLAIMED`. Lite: `apps/lite/server/src/economy/economy-service.test.ts` → `adds the day-1 reward, persists the streak and claim day, and calls onBalanceChanged`. | ✓ |
| 66.15 | Reset theo tháng hoạt động.<br>_Monthly reset works._ | Normal: `apps/normal-server/src/economy/economy-service.test.ts` → `restarts the streak and the month counter when the month rolls over`; `apps/normal-server/src/economy/daily-rules.test.ts` → `restarts at 1 on the first of a month, even when the days are consecutive`. Lite: `apps/lite/server/src/economy/daily.test.ts` → `resets to 1 on the 1st of a new month even though the claim is on a consecutive day`. | ✓ |
| 66.16 | Kinh tế được tài liệu hóa.<br>_Economy is documented._ | Manual: read spec §12 (principles, parameters, the 2% table fee, relief, the balance estimate, point conservation) and §13 (the 31-day daily table); the operational half is in `docs/normal-server.md`. The documented parameters are pinned to the code: `packages/core/src/constants/economy.test.ts` → `matches the spec daily table`; `apps/normal-server/src/economy/daily-rules.test.ts` → `totals §13.2’s 376,000 points over a full month`. | ✓ |

## Bản Normal

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.17 | Hồ sơ người chơi đầy đủ hoạt động.<br>_Full player profile works._ | `apps/normal-server/src/http/routes-me.test.ts` → `answers the profile, the cosmetics and both reward statuses in one body`; statistics and hand history: `apps/normal-web/src/screens/ProfileScreen.test.tsx` → `groups all sixteen counters, prints points with their unit and names the best hand`; `apps/normal-server/src/history/history-service.test.ts` → `returns the reading player’s own result alongside every other seat, named`. | ✓ |
| 66.18 | Avatar hoạt động.<br>_Avatar works._ | Server: `apps/normal-server/src/inventory/avatar.test.ts` → `stores the config and mirrors the title and badge into their own columns`; `apps/normal-server/src/inventory/avatar.test.ts` → `refuses a configuration referencing an item the player does not own, naming it`. Web: `apps/normal-web/src/screens/AvatarScreen.test.tsx` → `sends the whole config on save, omitting an emptied optional slot rather than blanking it`. E2E saves one and reopens it in a different browser context: `apps/normal-web/e2e/normal.spec.ts` → `điểm danh và ảnh đại diện`. | ✓ |
| 66.19 | Kho đồ hoạt động.<br>_Inventory works._ | `apps/normal-server/src/inventory/avatar.test.ts` → `lists what a player owns, oldest first`; `apps/normal-server/src/inventory/items.test.ts` → `contains every id the daily reward and the achievements promise`; the screen: `apps/normal-web/src/screens/InventoryScreen.test.tsx` → `groups every category and counts what is owned`. | ✓ |
| 66.20 | Thành tựu hoạt động.<br>_Achievement works._ | `apps/normal-server/src/achievements/achievement-service.test.ts` → `unlocks holdem_hands_10 on the tenth settled hand and credits the reward once`; never paid twice: `apps/normal-server/src/achievements/achievement-service.test.ts` → `does not pay twice when the same STATS_UPDATED is delivered again`; the screen: `apps/normal-web/src/screens/AchievementsScreen.test.tsx` → `counts what is unlocked and groups the rest by category`. | ✓ |
| 66.21 | Cơ sở dữ liệu lâu dài hoạt động.<br>_Persistent database works._ | The committed migrations apply cleanly and idempotently: `apps/normal-server/src/db/schema.test.ts` → `applies the committed migrations, creating every table`; `apps/normal-server/src/db/schema.test.ts` → `is idempotent: running the migrations again applies nothing`. Row locking under a race: `apps/normal-server/src/repos/balance-repo.test.ts` → `serialises two applies racing for the same balance`. | partial — the whole suite runs on in-process **PGlite**. The real `pg` path and the `SELECT … FOR UPDATE` lock only genuinely execute with `TEST_DATABASE_URL` set, and **that run has not happened on the development machine** (no Docker daemon). It is also the repository's one skipped test, named at the top of this document. Exact commands: `docs/deployment-normal.md` §2. |

## Bản Lite

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.22 | Lite build thành công.<br>_Lite builds successfully._ | As 40.9: `pnpm build:lite` on Windows x64 + Node 22, then `apps/lite/test/footprint.test.ts` → `fits the size cap` and `apps/lite/test/footprint.test.ts` → `is accompanied by an asset manifest listing the entry document`. Measured 2026-09-05: 81.4 MB against a 120 MB cap. | ✓ |
| 66.23 | Lite chạy độc lập.<br>_Lite runs independently._ | The executable itself: `apps/lite/test/smoke.test.ts` → `boots, answers /health and exits 0`; `/health` reports all three parts: `apps/lite/server/src/app.test.ts` → `reports the process, the game server and the database`. No Node install, no database server, no Internet. | ✓ |
| 66.24 | Lite dùng lưu trữ nhẹ.<br>_Lite uses lightweight persistence._ | `node:sqlite` in WAL mode: `apps/lite/server/src/db/sqlite.test.ts` → `sets WAL journal mode, foreign_keys and busy_timeout on a file database`; data survives close and reopen: `apps/lite/server/src/repos/sqlite-repos.test.ts` → `keeps balances, counters, streaks and sinks on a file database`; migrations by `PRAGMA user_version`: `apps/lite/server/src/db/sqlite.test.ts` → `migrate is idempotent — a second run applies nothing and returns the same version`. | ✓ |
| 66.25 | Lite không cần hạ tầng của Normal.<br>_Lite does not require Normal infrastructure._ | `apps/lite/test/footprint.test.ts` → `carries none of the Normal edition dependencies`; `apps/lite/test/footprint.test.ts` → `requires nothing but built-ins and the known-inert optional paths`. The only configuration is environment variables, or a `.env` file beside the exe. | ✓ |
| 66.26 | Lite có footprint phụ thuộc/asset nhỏ hơn.<br>_Lite has reduced dependency/asset footprint._ | `apps/lite/test/footprint.test.ts` → `fits the JavaScript download budget` (93.6 KB gzip / 250 KB); `apps/lite/test/footprint.test.ts` → `fits the CSS download budget` (10.6 KB / 40 KB); `apps/lite/test/footprint.test.ts` → `fits the size cap` (81.4 MB / 120 MB). The web UI is embedded in the exe as a SEA asset: `apps/lite/test/footprint.test.ts` → `is accompanied by an asset manifest listing the entry document`. | ✓ |

## Kiến trúc dùng chung (Shared Architecture)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.27 | Engine poker dùng chung.<br>_Poker engine is shared._ | `tooling/arch/boundaries.test.ts` → `packages only depend on allowed @bp packages`: both editions reach the engine through `@bp/core` and there is no other route. One reducer serves both: `packages/server-kit/src/room/room-hands.test.ts` → `two humans check down to showdown; only table stacks move`. | ✓ |
| 66.28 | Engine Blind Poker dùng chung.<br>_Blind Poker engine is shared._ | `packages/server-kit/src/room/room-hands.test.ts` → `plays a full hand with bots, settles balances, records history and schedules the next hand` — server-kit is the only layer that runs a Blind hand, and both editions plug into that same layer: `apps/lite/server/src/app.test.ts` → `authenticates a session token over /ws and answers LIST_ROOMS`; `apps/normal-server/src/app.test.ts` → `settles through the ledger, records a table_fee sink and moves both players’ counters`. | ✓ |
| 66.29 | Logic bot dùng chung.<br>_Bot logic is shared._ | `packages/core/src/bot/bot.test.ts` → `plays more often when a pot has carried over`; `packages/core/src/bot/bot.test.ts` → `plays 1000 hold’em hands with 2–6 bots`; the scheduling that drives it lives once, in server-kit: `packages/server-kit/src/room/hand-runner.test.ts` → `lets a bot act after its think delay and finishes a hand against a passive human`. | ✓ |
| 66.30 | Protocol core dùng chung.<br>_Core protocol is shared._ | `packages/core/src/protocol/validate.test.ts` → `parses room messages`; `packages/core/src/protocol/messages.test.ts` → `carries the sit-out flag beside status, so a player still finishing a hand can already be sitting out`; the shared client reads that same protocol: `packages/ui-kit/src/client/reducer.test.ts` → `builds the hand from a snapshot and patches room membership`. | ✓ |
| 66.31 | Normal và Lite triển khai độc lập nhau.<br>_Normal and Lite are independently deployable._ | Two entirely separate artefacts: `apps/normal-server/test/build.test.ts` → `produces both entry points` (a Docker image and a Compose stack — `docs/deployment-normal.md`) and `apps/lite/test/smoke.test.ts` → `boots, answers /health and exits 0` (one `.exe` — `docs/deployment-lite.md`). Neither reads the other's configuration or data. | ✓ |
| 66.32 | Không tồn tại logic game core bị nhân bản.<br>_No duplicated core game logic exists._ | `tooling/arch/boundaries.test.ts` → `@bp/core source never mentions editions or imports other workspaces / node built-ins`; `tooling/arch/boundaries.test.ts` → `every workspace package is known`. Manual: `grep -rn "@bp/core" apps/*/package.json packages/*/package.json` shows that everywhere the rules are needed, the package declares a dependency instead of holding a copy. | ✓ |

## Trải nghiệm (UX)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.33 | Tiếng Anh hoạt động.<br>_English works._ | `packages/ui-kit/src/i18n/i18n.test.ts` → `en and vi have exactly the same keys in both namespaces`; `packages/ui-kit/src/i18n/i18n.test.ts` → `cover every hand category, error code and action kind`; Normal's bundle is checked against the server's own catalogues: `apps/normal-web/src/locales/locales.test.ts` → `declares every key in both languages`. | ✓ |
| 66.34 | Tiếng Việt hoạt động.<br>_Vietnamese works._ | Vietnamese is the default: `packages/ui-kit/src/i18n/i18n.test.ts` → `translates in vi by default and switches at runtime, persisting the choice`; Vietnamese display names fold case and composition correctly: `packages/core/src/protocol/display-name.test.ts` → `folds case for Vietnamese, diacritics included`; the font stack carries precomposed glyphs: `packages/ui-kit/src/theme/tokens.test.ts` → `reaches a Windows face with full Vietnamese coverage before the generic serif`. | ✓ |
| 66.35 | Giao diện responsive hoạt động.<br>_Responsive UI works._ | `apps/normal-web/src/App.test.tsx` → `carries exactly four tabs, which is what fits a 375 px rail`. E2E at 375×812 with no horizontal scroll: `apps/normal-web/e2e/normal.spec.ts` → `@mobile sảnh, bàn chơi và hồ sơ trên màn hình điện thoại`. | ✓ |
| 66.36 | Bàn chơi dùng được ở mọi độ phân giải mục tiêu.<br>_Poker table is usable across target resolutions._ | The stack layout for narrow screens: `packages/ui-kit/src/table/PokerTable.test.tsx` → `stack layout shows every opponent at a nine-handed table, in a strip that holds two rows open`; the seat ring from two to nine: `packages/ui-kit/src/table/geometry.test.ts` → `uses seat 0-first order for spectators and handles 2 and 9 seats`; `packages/ui-kit/src/table/geometry.test.ts` → `spaces a full table evenly around the rim, not evenly in angle`. E2E: `apps/lite/e2e/lite.spec.ts` → `@mobile bàn chơi trên màn hình điện thoại`. | ✓ |

## Kỹ thuật (Engineering)

| # | Yêu cầu | Bằng chứng (evidence) | Trạng thái |
|---|---|---|---|
| 66.37 | Test của core xanh.<br>_Core tests pass._ | `pnpm --filter @bp/core test` — 13 files, 168 tests, green in the run quoted at the top. It includes the money-conservation invariant over random hands: `packages/core/src/hand/engine.test.ts` → `random hold’em hands never break money conservation or produce illegal states`, and the evaluator against brute force: `packages/core/src/evaluator/evaluator.test.ts` → `matches brute-force maximum over all 5-card subsets for random 7 and 8 card hands`. | ✓ |
| 66.38 | Test tích hợp xanh.<br>_Integration tests pass._ | Server-kit over real WebSockets: `packages/server-kit/src/gateway/gateway.test.ts` → `enforces turn order, staleness, duplicates and legality`. Each edition's whole HTTP surface is enumerated and pinned: `apps/normal-server/src/app.test.ts` → `answers exactly the surface §19.2 describes, and nothing else`; `apps/lite/server/src/app.test.ts` → `answers exactly the surface §19.3 describes, and nothing else`. Full requirement-to-test mapping for spec §29.2 and §30: `docs/test-matrix.md`. | ✓ |
| 66.39 | Test multiplayer xanh.<br>_Multiplayer tests pass._ | `packages/server-kit/src/soak.test.ts` → `hold'em: 6 clients over 3 rooms play 20 hands each with no seq gaps and no points created or lost`; `packages/server-kit/src/soak.test.ts` → `blind: the same run against one bot per room conserves points across balances, fees and bot nets`; and the gap detector has a positive control of its own: `packages/server-kit/src/soak.test.ts` → `accepts the next frame, ignores one the snapshot already covered, and calls a hole a gap`. | ✓ |
| 66.40 | Kiểm tra bảo mật đạt.<br>_Security checks pass._ | Static scans: `tooling/arch/security-static.test.ts` → `passes no token, password, cookie, email or request body to a logging call`; `tooling/arch/security-static.test.ts` → `uses dangerouslySetInnerHTML nowhere`. Every mutating route in both editions is CSRF-guarded and metered, asserted over routes enumerated out of the assembled app: `apps/normal-server/src/app.test.ts` → `refuses each of them without X-Requested-With, before auth and before the limiter`; `apps/lite/server/src/app.test.ts` → `meters each of them, whether by the general bucket or by one of its own`. Manual: `pnpm audit --prod` → `No known vulnerabilities found` (634 production dependencies, 2026-09-05). Full threat table: `docs/security.md`. | partial — the full `pnpm audit` (toolchain included) still lists **7 advisories**, every one of them in a build- or test-only package (`vitest --ui`, the `vite` and `esbuild` dev servers), none installed on a server or shipped inside the exe. Disposition per advisory in `docs/security.md` §2; the upgrade that clears them was not taken here. |
| 66.41 | Tài liệu đầy đủ.<br>_Documentation is complete._ | Manual: open `README.md`, walk the *Documentation* section — every link must resolve (the spec, `docs/test-matrix.md`, `docs/security.md`, this checklist, `docs/known-limitations.md`, `CHANGELOG.md`, the four package docs and the two deployment guides). This checklist is itself kept from rotting: `tooling/arch/acceptance-links.test.ts` → `cites only test files that exist`; `tooling/arch/acceptance-links.test.ts` → `covers every numbered item of requirement.txt §40 and §66`. | ✓ |
| 66.42 | Triển khai bản Normal được tài liệu hóa.<br>_Normal deployment is documented._ | Manual: `docs/deployment-normal.md` (Vietnamese, written for the operator) — the four-service Compose stack, `.env`, the pre-flight before the first deploy, backup and restore (`deploy/normal/restore.md`), upgrades, TLS and `TRUST_PROXY`. The required configuration is enforced by the code: `apps/normal-server/src/config.test.ts` → `lists every missing required var in one error`. | ✓ |
| 66.43 | Triển khai bản Lite được tài liệu hóa.<br>_Lite deployment is documented._ | Manual: `docs/deployment-lite.md` (build, SEA packaging, running as a service, shutting down cleanly) and `apps/lite/release-src/README-lite.md`, which ships beside the exe. The clean-shutdown path and the consequence of a hard kill are pinned: `apps/lite/server/src/app.test.ts` → `accepts the run token from the loopback, drains the room and gives the buy-in back`; `apps/lite/server/src/run-file.test.ts` → `overwrites a run file left behind by a hard kill`. | ✓ |

---

## Những gì bảng này **không** khẳng định

Các hạn chế đã biết — gồm ba dòng `partial` ở trên, việc Blind Poker cho thấy số dư của đối thủ, độ
tương phản của `--red`, và những tính năng cố ý để lại cho roadmap — được liệt kê đầy đủ ở
[`known-limitations.md`](known-limitations.md). Lịch sử từng plan ở [`../CHANGELOG.md`](../CHANGELOG.md).
