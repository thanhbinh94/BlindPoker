# Blind Luck Poker — Vai trò GM (quản trị trong game), đợt 1 — thiết kế

- Ngày: 2026-10-18. Trạng thái: duyệt qua brainstorming 17–18/10 (phần 1 duyệt tường minh, phần 2 là ruling của
  phiên, người dùng nói "ok triển khai đi"); Plan 25 thực thi.
- Phạm vi: **bản Normal**. Lite không có GM và không đổi gì.
- Sửa đổi SRS chính (`2026-09-04-bind-poker-design.md`): §10.2 (profile thêm `role`, `locked`), §18.2 (bảng
  `users` thêm cột, bảng mới `gm_actions`), §19.2 (nhóm route `/api/gm/*`), §20.2 (`NOTIFICATION` kind mới),
  §23 (dòng "quản trị"), §27.2 (màn 14: Quản trị), Phụ lục A (quyết định dưới đây).
- Bối cảnh: bản Normal lên Internet ngày 16/10 (VPS Vietnix, `play.14-225-254-250.sslip.io`). Người dùng muốn một
  tài khoản GM "full quyền". Game chưa có vai trò nào: `users` không có cột vai trò hay khóa, không có route quản trị,
  không có nhật ký thao tác. Hiện GM chỉ là một tài khoản thường được `grant-wardrobe-cli` cấp đủ tủ đồ.

## 1. Quyết định của người dùng (Q-table)

| # | Câu hỏi | Quyết định | Ghi chú |
|---|---|---|---|
| Q1 | GM làm được gì? | Cả bốn nhóm: người chơi, phòng đang chơi, thành tựu & điểm danh, thống kê & nhật ký | Nhóm 3 và phần biểu đồ của nhóm 4 dời sang đợt 2 (Q3) |
| Q2 | Trao và thu quyền GM | CLI trên máy chủ cho GM đầu tiên; sau đó GM trao/thu quyền người khác ngay trong màn quản trị, có nhật ký; GM không tự thu quyền mình | Không dùng biến môi trường; không có cấp "chủ" riêng |
| Q3 | Chia đợt | **Hai đợt.** Đợt 1 (Plan 25): vai trò, khóa tài khoản, nhật ký, quản người chơi (điểm, món, sổ điểm, lịch sử), quản phòng (xem, đuổi, đóng), tổng quan cơ bản. Đợt 2 (Plan 26): mở khóa thành tựu, đặt lại điểm danh, sửa lịch quà tháng trên màn hình, thống kê nguồn/bể theo ngày | |
| Q4 | Kiến trúc | Trong Normal, cùng server và web: cột trên `users`, `/api/gm/*` trong normal-server, màn `#/gm` trong normal-web tải lười, bảng `gm_actions` | Không app riêng; không "API trước màn hình sau" |
| Q5 | Giới hạn cấp điểm một lần | ±10.000.000 điểm | Duyệt cùng phần 1 |
| Q6 | Email người khác trên màn tìm kiếm | Che (`t***@gmail.com`); email đầy đủ chỉ ở trang chi tiết | Duyệt cùng phần 1 |

## 2. Dữ liệu — migration `0004_gm` (chỉ thêm, idempotent, `IF NOT EXISTS`)

```sql
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','gm'));
ALTER TABLE users ADD COLUMN locked_at timestamptz;
ALTER TABLE users ADD COLUMN locked_reason text;
CREATE TABLE gm_actions (
  id bigserial PRIMARY KEY,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,   -- NULL = CLI trên máy chủ
  action text NOT NULL,            -- grant_points | adjust_points | grant_item | grant_wardrobe | lock | unlock
                                   -- | kick | close_room | promote | demote
  target_player_id uuid REFERENCES players(id) ON DELETE SET NULL,
  target_room_id text,
  amount bigint,
  item_id text,
  reason text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gm_actions_created ON gm_actions (created_at);
CREATE INDEX gm_actions_target ON gm_actions (target_player_id, created_at);
```

- `role` và khóa nằm ở `users` (tài khoản đăng nhập), không ở `players`: khóa chặn đăng nhập, vai trò là của người
  cầm mật khẩu. `players` không đổi.
- `gm_actions` **chỉ ghi**: không có API sửa/xóa; `ON DELETE SET NULL` để một dòng nhật ký sống lâu hơn tài khoản
  nó nhắc tới (cùng lý do `game_players.player_id` nullable, SRS §18.2 (c)).
- Sổ điểm: `TxReason` (`packages/server-kit/src/repositories.ts`) thêm `gm_grant` (cộng) và `gm_adjust` (trừ). Dòng
  sổ mang `ref_id = gm:<gm_actions.id>`. Hai lý do này là **nguồn**, như `daily_reward`/`achievement`; bất biến
  `Σ số dư + Σ sink` (SRS §12.6, §18.4) không đổi. Test bảo toàn trong `app.test.ts` (~L850) cộng thêm hai lý do.
- Migration sinh bằng `drizzle-kit generate --name gm` rồi sửa tay thành `IF NOT EXISTS` như `0003_ledger_keys`.

## 3. Xác thực và trao quyền

- **Guard** `createRequireGm(deps)` (`src/http/auth-guard.ts`): chạy `requireUser` rồi đọc `users.role, locked_at`
  của `req.user.userId` **mỗi request**; không phải `gm` hoặc đã khóa → `HttpError(403, 'FORBIDDEN')`. Đọc mỗi
  request để thu quyền và khóa có hiệu lực tức thì, không chờ phiên hết hạn. Truy vấn này gộp vào truy vấn
  `players.findById` đã có trong guard (join `users`), không thêm round-trip ở route thường.
- `RequestUser` (`src/http/types.ts`) thêm `role: 'player' | 'gm'`. `GET /api/auth/me` và `GET /api/me`
  (`accountBody`) trả thêm `role`. Client chỉ dùng nó để **hiện lối vào**; server luôn là nơi quyết định.
- **Đăng nhập khi bị khóa**: `POST /api/auth/login` kiểm `locked_at` sau khi mật khẩu đúng → `403 ACCOUNT_LOCKED`,
  thân lỗi kèm `reason` (cạnh `error`, theo quy ước §19.3). Kiểm sau khi xác thực để không lộ "tài khoản có tồn tại"
  qua mã lỗi. Phiên đang có của người bị khóa đã bị thu hồi lúc khóa (§4).
- **CLI** `node dist/grant-gm-cli.js <email> [--revoke]` (mẫu `grant-wardrobe-cli`, chỉ cần `DATABASE_URL`): đặt
  `role`, ghi `gm_actions` với `actor_user_id = NULL`, `reason = 'cli'`. Trên VPS chạy qua
  `docker compose exec app node dist/grant-gm-cli.js <email>`.
- **Trong game**: `POST /api/gm/players/:id/role { role, reason }`. Từ chối: tự đổi vai trò của chính mình
  (`403 FORBIDDEN`), thu quyền GM cuối cùng (`409 LAST_GM`). Thu quyền một GM đang đăng nhập có hiệu lực ngay ở request
  kế tiếp của họ (guard đọc DB), màn `#/gm` của họ nhận 403 và quay về sảnh.

## 4. Khóa tài khoản

Khóa (`POST /api/gm/players/:id/lock { reason }`), trong một transaction rồi các bước ngoài transaction theo thứ tự:

1. `users.locked_at = now(), locked_reason = reason`; ghi `gm_actions`.
2. `sessions.revokeAll(userId)` (đã có, `auth/session-service.ts`).
3. Nếu đang trong phòng: `room.adminKick(playerId)` (§6) — ngồi bàn thì đứng dậy theo đường có sẵn, chồng về số dư;
   nếu đang giữa ván thì rời có hiệu lực khi ván kết thúc như rời phòng giữa ván (SRS §7.10/§8.8), chồng vẫn về số dư.
4. `game.notify(playerId, NOTIFICATION { kind: 'GM_NOTICE', payload: { action: 'lock', reason } })` rồi
   `gateway.disconnect(playerId)` (§6) — gửi thông báo trước, ngắt sau.

Mở khóa chỉ xóa hai cột và ghi nhật ký. GM không khóa được chính mình và không khóa được GM khác (phải thu quyền
trước, có nhật ký hai bước). **Không xóa tài khoản** trong đợt này: xóa phá bất biến sổ điểm (SRS §18.2, dòng
`ON DELETE restrict`).

## 5. API — tất cả dưới `/api/gm/`, `preHandler: requireGm`, CSRF và rate-limit của `/api/*` như cũ

| Method | Path | Thân / tham số | Trả về | Từ chối riêng |
|---|---|---|---|---|
| GET | `/api/gm/overview` | — | `{ online, rooms, accounts, locked, gms, points24h: { sources, sinks, byReason[] } }` | |
| POST | `/api/gm/players/search` | `{ q, limit?, before? }` — khớp email (lowercase, prefix hoặc đúng) hoặc tên hiển thị (`name_key` chứa) | `{ players: [{ playerId, displayName, emailMasked, role, locked, balance, createdAt, lastLoginAt }], nextBefore }` | |
| GET | `/api/gm/players/:id` | — | hồ sơ đầy đủ: `email` thật, `role`, `locked{at,reason}`, `balance`, `stats` (16 bộ đếm), `room` (`{roomId, code, name, seat}` hoặc null), `inventoryCount` | `404 NOT_FOUND` |
| GET | `/api/gm/players/:id/ledger?limit&before` | như `/api/me/ledger` | cùng shape | |
| GET | `/api/gm/players/:id/history?limit` | như `/api/me/history` | cùng shape | |
| POST | `/api/gm/players/:id/points` | `{ amount, reason }` — `amount` nguyên, ≠ 0, |amount| ≤ 10.000.000 | `{ balance, actionId }` | `400 INVALID_AMOUNT`; `409 INSUFFICIENT_BALANCE` khi trừ quá số dư (không trừ được phần trên bàn) |
| POST | `/api/gm/players/:id/items` | `{ itemId, reason }` hoặc `{ all: true, reason }` | `{ granted: string[], alreadyOwned: number }` | `400 INVALID_ITEM` (id lạ hoặc món miễn phí) |
| POST | `/api/gm/players/:id/lock` | `{ reason }` | `{ locked: true }` | `409 ALREADY_LOCKED`; `403 FORBIDDEN` khi đích là GM hoặc chính mình |
| POST | `/api/gm/players/:id/unlock` | `{ reason }` | `{ locked: false }` | `409 NOT_LOCKED` |
| POST | `/api/gm/players/:id/role` | `{ role: 'player'\|'gm', reason }` | `{ role }` | `403 FORBIDDEN` (chính mình); `409 LAST_GM` |
| GET | `/api/gm/rooms` | — | mọi phòng kể cả riêng tư: `{ roomId, code, name, mode, status, players, maxPlayers, hostDisplayName, isPrivate, carryOverPot, handInProgress, createdAt }` | |
| GET | `/api/gm/rooms/:id` | — | `room.view()` của host + danh sách người (có `playerId`, tên, ghế, chồng, kết nối) | `404 ROOM_NOT_FOUND` |
| POST | `/api/gm/rooms/:id/kick` | `{ playerId, reason }` | `{ effective: 'now' \| 'after_hand' }` | `404`; `400` nếu là bot |
| POST | `/api/gm/rooms/:id/close` | `{ reason }` | `{ closed: true, refunded: number }` | `404` |
| GET | `/api/gm/actions?limit&before&player&room` | — | `{ actions: [{ id, at, actor: {userId, displayName} \| null, action, target, amount, itemId, reason, details }], nextBefore }` | |

Quy ước chung:

- `reason` bắt buộc, 3–200 ký tự, với **mọi** POST. Thiếu → `400 BAD_REQUEST`. Nhật ký không có lý do là nhật ký vô dụng.
- Mọi POST ghi dòng `gm_actions` **trong cùng transaction** với tác động của nó (điểm, món, khóa, vai trò); với phòng
  (trong RAM) thì ghi nhật ký trước rồi tác động, lỗi tác động ghi thêm `details.error`.
- Tìm kiếm là `POST` để email không nằm trong query string và access log (cùng tinh thần với "không đưa dữ liệu cá nhân
  lên URL"). Nó đi qua rổ ghi 60/phút/phiên, đủ cho tay người gõ.
- Người bị tác động nhận `NOTIFICATION { kind: 'GM_NOTICE', payload: { action, amount?, itemId?, reason } }` nếu đang
  nối; cộng/trừ điểm còn phát `BALANCE` qua `game.balanceChanged` như daily và relief.
- `RouteDeps.game` mở rộng từ `Pick<GameServer,'connectionCount'|'renameIdentity'>` sang thêm `rooms`, `notify`,
  `gateway.disconnect`. Route quản trị **không** chạm `Room` trực tiếp mà qua một `GmRoomService` mỏng trong
  normal-server để test được với room giả.

## 6. Thay đổi `@bp/server-kit` (nhỏ, công khai, có test)

- `Gateway.disconnect(playerId, code = 4003, reason = 'LOCKED')`: đóng mọi socket của người đó; trả số socket đã đóng.
  Hiện `bound`/`all` là private và chỉ có `closeAll`.
- `Room.adminKick(targetId)`: như `kick(hostId, targetId)` nhưng không kiểm host, đuổi được cả host (host chuyển cho
  người vào sớm nhất như khi host rời, §11.4), và **giữa ván không từ chối**: ghế được đánh dấu rời-khi-hết-ván theo
  đúng đường một người rời phòng giữa ván (fold, chồng về số dư cuối ván, phát `PLAYER_LEFT` cho chính họ như T5).
  Trả `'now' | 'after_hand'`. Bot → ném `ILLEGAL_ACTION`.
- `RoomManager.all()` đã có; `Room.shutdown(reason)` đã có và là đường đóng phòng (hủy ván, hoàn cược, trả chồng,
  `ROOM_CLOSED`). Thêm `Room.adminSummary()` trả các trường bảng `/api/gm/rooms` (bao gồm `isPrivate`,
  `carryOverPot`, `handInProgress`, `hostPlayerId`) để route không đọc field nội bộ.
- `TxReason` thêm `gm_grant`, `gm_adjust` (§2). Core không đổi. Protocol: không thêm message, chỉ một `kind` mới của
  `NOTIFICATION` (kênh mở theo §20.4).

## 7. Màn hình web — `#/gm`

- Route mới `#/gm` trong `App.tsx`, chunk lười `GmScreen` như các màn tài khoản. Vào khi `role !== 'gm'` → về sảnh.
  Lối vào: một dòng **"Quản trị"** trong màn Cài đặt, chỉ hiện khi `role === 'gm'`. Không thêm tab vào rail
  (`Shell.NAV` đang kịch trần bốn tab ở 375 px). Lối vào thứ hai: gõ `#/gm`.
- Bốn tab trong màn: **Tổng quan** (số liệu `/overview`, nút làm mới), **Người chơi** (ô tìm, bảng kết quả với email
  che, bấm vào → trang chi tiết: hồ sơ, số dư, phòng đang ở, nút Cộng/trừ điểm, Cấp món, Cấp toàn bộ tủ đồ, Khóa/Mở
  khóa, Vai trò; dưới là sổ điểm và lịch sử ván), **Phòng** (bảng mọi phòng, bấm vào → người trong phòng, nút Đuổi
  từng người, Đóng phòng), **Nhật ký** (bảng `gm_actions`, lọc theo người/phòng, phân trang).
- Mọi thao tác ghi đi qua **hộp thoại xác nhận có ô Lý do bắt buộc**; nút xác nhận vô hiệu tới khi lý do ≥ 3 ký tự.
  Đóng phòng nói rõ "ván đang chơi sẽ bị hủy, cược hoàn lại, chồng về số dư". Kết quả hiện bằng toast có sẵn.
- Số qua `formatPoints`, thời điểm qua `formatMoment`. Bảng rộng cuộn ngang trong khung riêng, trang không cuộn ngang.
  Kiểm ba kích thước 1920×940, 1366×768, 375×812 bằng ảnh thật; `expectNoTextOverlap` trên tab Người chơi và Phòng.
- Chuỗi: `gm.*` trong `apps/normal-web/src/locales/{vi,en}/normal.json`; ui-kit thêm `notify.GM_NOTICE` (vi: "Quản
  trị viên: {{reason}}", en: "From the game master: {{reason}}") vì `Toasts` đọc `notify.<kind>` từ kit. Parity test giữ.
- Thuật ngữ ổn định mới (thêm vào glossary): **Quản trị**, **Khóa tài khoản**, **Mở khóa**, **Cộng điểm**, **Trừ
  điểm**, **Đóng phòng**, **Nhật ký**.

## 8. Bảo mật

- Quyền đọc từ DB mỗi request (§3): thu quyền, khóa có hiệu lực ngay. Một GM bị khóa mất quyền ngay dù còn cookie.
- GM dùng **cùng mật khẩu và cùng phiên** với người chơi; không có 2FA trong đợt này. Ghi vào `docs/known-limitations.md`
  kèm lời khuyên: tài khoản GM dùng mật khẩu riêng, dài, và không đăng nhập trên máy lạ. 2FA cho GM là roadmap.
- Nhật ký bất biến; mọi dòng có lý do; CLI để `actor = NULL` để phân biệt thao tác ngoài game.
- Giới hạn một lần ±10.000.000; không có giới hạn ngày (đợt 1), nhưng `/overview` hiện tổng `gm_grant` 24 h để số
  liệu không trốn được. Không trừ xuống âm; không đụng chồng trên bàn.
- Rate-limit: `/api/gm/*` đi qua rổ `/api/*` hiện có (ghi 60/phút/phiên + 120/phút/địa chỉ, đọc 240/phút). Không rổ
  riêng. Test `app.test.ts` L389/L407/L444 (XRW, rate-limit, prefix `/api/`) tự phủ các route mới; danh sách route
  ghim ở L357 cập nhật.
- Email đầy đủ chỉ ở trang chi tiết (Q6); tìm kiếm bằng POST (§5); không có email trong log server (log của route ghi
  `playerId`, không ghi `q`).
- `docs/security.md` thêm mục "Quản trị": mối đe dọa (lộ mật khẩu GM, GM lạm quyền) và biện pháp (nhật ký, giới hạn,
  không xóa, không 2FA — ghi rõ).

## 9. Kiểm thử

- **normal-server**: guard (player → 403, gm → 200, gm bị khóa → 403, thu quyền giữa chừng → 403 ở request kế);
  `gm-service` (cộng/trừ điểm với dòng sổ và nhật ký cùng transaction, trừ quá số dư bị từ chối toàn bộ, cấp món/tủ đồ,
  khóa gồm revoke + kick + disconnect theo thứ tự, LAST_GM, tự đổi vai trò bị từ chối); route (`inject` với harness,
  mọi POST thiếu lý do → 400); **bảo toàn điểm** mở rộng với `gm_grant`/`gm_adjust`; `login` khi khóa → 403
  `ACCOUNT_LOCKED`; CLI `--revoke`; `resetDb` xóa thêm `gm_actions`.
- **server-kit**: `Gateway.disconnect`; `Room.adminKick` giữa ván và giữa hai ván, đuổi host (host chuyển), bot bị từ
  chối, tiền bảo toàn; `adminSummary`.
- **normal-web**: `GmScreen` với `NormalApi` giả (tìm, chi tiết, từng hộp thoại yêu cầu lý do, 403 → về sảnh),
  Cài đặt hiện/ẩn dòng Quản trị theo `role`, `locales.test.ts` parity, `notifications`/Toasts cho `GM_NOTICE`.
- **Ops pack** (`apps/normal-web/e2e/ops/`), hai ca mới, tài khoản qua `newPlayer`: **Q-01** GM tìm người chơi, cộng
  10.000 điểm với lý do; màn của người đó đổi số dư không tải lại và hiện toast; nhật ký có dòng mới. **Q-02** GM đóng
  một phòng Blind đang giữa ván có hai người thật: cả hai về sảnh, số dư mỗi người = trước khi ngồi (chồng về, cược
  hoàn), nhật ký ghi `close_room`. GM đầu tiên của e2e được trao bằng CLI chạy trong `webServer` (biến
  `E2E_GM_EMAIL`) hoặc bằng một hàm của harness — plan quyết.
- Ảnh thật 1920×940, 1366×768, 375×812 cho bốn tab và hộp thoại.
- `docs/acceptance-checklist.md` thêm P25.1 (vai trò và khóa), P25.2 (điểm, món, nhật ký, bảo toàn), P25.3 (phòng);
  `docs/test-matrix.md` thêm các dòng tương ứng; bump `tooling/arch/acceptance-links.test.ts`.

## 10. Triển khai

- Migration `0004_gm` chạy bởi service `migrate` của compose khi `git pull && docker compose up -d --build` trên VPS
  (`docs/known-limitations.md`: migrate chạy trước app). Trên kit LAN (Neon) là `run.ps1` không `-NoMigrate` — **hỏi
  trước** như CLAUDE.md §4.
- Sau khi lên: `docker compose exec app node dist/grant-gm-cli.js tbinh9031@gmail.com`; kiểm `#/gm` hiện trong Cài đặt
  của tài khoản đó. Tài khoản test giữ vai trò người chơi.
- Tài liệu: `docs/normal-server.md` (module `gm/`, CLI, bảng), `docs/normal-web.md` (màn Quản trị), `docs/server-kit.md`
  (`adminKick`, `disconnect`), `docs/security.md`, `docs/player-guide.md` (một đoạn: tài khoản có thể bị khóa, thông báo
  từ quản trị), `docs/deployment-normal.md` §5 (trao GM), SRS các mục ở đầu tài liệu, CHANGELOG Plan 25.

## 11. Không làm trong đợt này

Mở khóa thành tựu, đặt lại chuỗi điểm danh, sửa lịch quà tháng trên màn hình, biểu đồ nguồn/bể theo ngày (Plan 26);
xóa tài khoản; GM cho Lite; chặn theo địa chỉ IP; 2FA; giới hạn cấp điểm theo ngày; sửa/xóa nhật ký; nhiều cấp quyền.

## 12. Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Đuổi giữa ván làm sai tiền | Đi đúng đường "rời phòng giữa ván" đã có test bảo toàn; test mới cho `adminKick` giữa ván |
| Mật khẩu GM lộ = toàn quyền | Nhật ký bất biến, giới hạn một lần, không xóa tài khoản, khuyến cáo mật khẩu riêng; 2FA roadmap |
| Route mới lọt rate-limit/XRW | Ba test chung trong `app.test.ts` phủ mọi route theo `mutatingRoutes` |
| Màn quản trị phá rail 375 px | Không thêm tab; lối vào trong Cài đặt |
| Migration trên Neon (LAN) | Chỉ khi người dùng đồng ý; VPS tự chạy qua `migrate` |

## 13. Ruling của phiên (phần 2, chưa hỏi người dùng)

- R1: lối vào `#/gm` nằm trong Cài đặt, không phải tab — rail đã bốn tab. *Nếu sai:* thêm tab có điều kiện sau.
- R2: tìm kiếm bằng `POST /api/gm/players/search` để email không vào URL/log. *Nếu sai:* đổi sang GET, một dòng.
- R3: đuổi giữa ván **không từ chối** mà có hiệu lực cuối ván (khác `kick` của host). *Nếu sai:* trả `GAME_IN_PROGRESS`.
- R4: GM không khóa được GM khác, phải thu quyền trước. *Nếu sai:* bỏ một kiểm tra.
- R5: không xóa tài khoản trong đợt này. *Nếu sai:* cần thiết kế riêng vì sổ điểm.
- R6: số plan là 25 (BP-25), đợt 2 là 26, để số plan trùng số nhánh sau khi BP-23/24 dùng cho sửa lỗi.
