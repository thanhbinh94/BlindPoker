# Plan 27 — Cửa hàng trang phục, danh vọng, quà tân thủ, Blind Poker chơi tới 0, tủ đồ tải nhanh, điểm danh theo tháng

Spec thiết kế, 2026-10-21. Bổ sung cho SRS `2026-09-04-bind-poker-design.md` (§12 kinh tế điểm, §13 điểm danh, §14
kho đồ và avatar, §33 chỉ điểm ảo) và cho các spec GM (`2026-10-18-gm-role-design.md`,
`2026-10-20-plan26-gm-round2-phone-landscape-login-design.md`). Sáu việc đi chung một plan vì người dùng muốn một
lần gate, merge và deploy (VPS Vietnix), như Plan 26: A danh vọng, B cửa hàng, C quà chào mừng và lịch tân thủ,
D Blind chơi tới 0, E tủ đồ tải nhanh, G điểm danh theo tháng (F là tài liệu K1).

Nguồn: `docs/bug-log.md` mục 9 (K1–K5, ghi 2026-10-21), cuộc brainstorm 2026-10-21 (mockup ở
`.superpowers/brainstorm/729-1792598365/content/shop-rank-gift.html`), lời người dùng: *"họ vào và thấy có nhiều trang
phục, phụ kiện nhưng cách kiếm quá khó … họ muốn kiếm được hoặc mua được trang phục thì chơi mới có ý nghĩa"*. Mã đối
chiếu ở HEAD `57440ee` (một subagent dò, 2026-10-21); số dòng trong spec này là của bản đó.

**Bất biến giữ nguyên:** chỉ điểm ảo (requirement.txt §3, SRS §33). "Gold", "tiền", "mua" trong tài liệu này đều là
**điểm trong game**; không có nạp, rút, thanh toán hay quy đổi. Mọi đường điểm mới đi qua `creditWithin` /
`ledger.apply` hiện có, giữ `Σ balances + Σ sink rows` và được ghim bằng test bảo toàn.

## 1. Quyết định của người dùng (Q-table)

| # | Câu hỏi | Quyết định | Ngày |
|---|---|---|---|
| Q1 | Mốc thời gian để một người chơi đều mỗi tối mua được món đầu tiên | **Rare sau 1 tuần, epic sau 1 tháng** | 2026-10-21 |
| Q2 | Danh vọng là tiền tiêu đi khi mua, hay cấp bậc không giảm | **Cấp bậc không bao giờ giảm**, hiện cạnh tên; mua chỉ trừ điểm | 2026-10-21 |
| Q3 | Cửa hàng nằm ở đâu | **B**: màn "Cửa hàng" riêng vào từ sảnh, nhân vật to mặc thử, "Kệ tuần này", ba kệ theo độ hiếm | 2026-10-21 |
| Q4 | Cấp bậc hiện cạnh tên thế nào | **B**: tên bậc bằng chữ ("Cao thủ"); rút về số La Mã màu ở ghế hẹp | 2026-10-21 |
| Q5 | Quà tân thủ | **C**: chọn 1 trong 3 bộ đồ lúc bắt đầu + lịch tân thủ 7 ngày đăng nhập (ngày 3 một món ngẫu nhiên, ngày 7 một món rare ngẫu nhiên + danh vọng). *Mục 4 điều chỉnh "lúc tạo nhân vật" thành "lần vào sảnh đầu tiên" vì không có luồng tạo nhân vật, và nâng ba bộ được chọn lên rare vì áo thun common đã miễn phí (R6, hỏi lại ở mục 10).* | 2026-10-21 |
| Q6 | Tài khoản đang có | **Tính lại danh vọng từ lịch sử** ngay sau deploy; tài khoản cũ cũng nhận bước chọn bộ đồ và lịch tân thủ kể từ ngày deploy | 2026-10-21 |
| Q7 | Blind Poker chơi tới 0 (K2) | **(a)**: tất tay phần còn lại với pot phụ, **bỏ phí bàn ở Blind**; rời bàn khi đúng 0 | 2026-10-21 |
| Q8 | K5 tủ đồ tải chậm | Làm trong plan này; cách làm để người xây quyết trong khung ở mục 6 | 2026-10-21 |
| Q9 | K1 hai máy một tài khoản | **Không sửa**: hành vi hiện tại (máy sau tiếp quản ghế, máy trước thấy "Đã đăng nhập ở nơi khác" và không tự nối lại) được ghi vào hướng dẫn chơi và known-limitations như một luật | 2026-10-21 |
| Q10 | Dáng đứng cố định của nhân vật | **Hoãn**, ghi là K6 trong bug-log; là dự án nghệ thuật riêng | 2026-10-21 |
| Q11 | Ba món chào mừng là rare hay common (R6)? | **Rare** (Bộ chia bài, Áo dài đỏ, Nón lá) | 2026-10-21 |
| Q12 | Quà điểm danh của tháng đã qua có bán không (R20)? | **Có**: chỉ tháng hiện tại và các tháng tới là không bán; kệ epic đầy dần | 2026-10-21 |
| Q13 | Điểm danh: "đăng nhập theo chuỗi khiến người chơi ngày nào cũng phải đăng nhập khá mệt mỏi… không đăng nhập đều vẫn có thể đạt mốc, tất nhiên có thể không full mốc" | **(a)** đếm theo **số lần điểm danh trong tháng**, không cần liên tiếp; chuỗi liên tiếp chỉ còn cho hai thành tựu | 2026-10-21 |

## 2. Phần A — Danh vọng (reputation)

### A1. Khái niệm

Mỗi tài khoản có một số nguyên `players.reputation ≥ 0` (cột mới, default 0), **chỉ tăng**, và một cột
`players.rank` 1..5 (default 1) là **mốc cao nhất đã đạt**: mỗi lần `reputation` đổi, `rank = max(rank,
rankOf(reputation))` theo bảng ngưỡng trong cơ sở dữ liệu (GM sửa được). GM nâng ngưỡng không làm ai tụt bậc (R15).
Bậc dùng cho hai việc: **mở quyền mua** theo độ hiếm (mục 3) và **khoe** cạnh tên (A4). Danh vọng không phải điểm: không vào `point_transactions`, không nằm trong tổng bảo toàn
điểm, không mua được, không chuyển được, không trừ được, kể cả bởi GM (GM chỉ **cộng**; A5).

### A2. Nguồn danh vọng (mặc định; bảng `reputation_rules(key PK, amount int, updated_by, updated_at)` GM sửa được)

| `key` | Sự kiện | Mặc định | Ghi chú |
|---|---|---|---|
| `hand_played` | Một ván có kết quả mà người chơi được chia bài (Hold'em hoặc Blind, kể cả thua hay bỏ bài) | +1 | Nghe `HAND_SETTLED` như `stats-service.ts:78` (`patchForHand`): chỉ ghế người, bỏ ván hủy và ván kết toán lỗi. Bot không có danh vọng. |
| `hand_won` | Thắng ván (`won = true` trong `game_players`) | +3 | Cộng thêm +1 ở trên. |
| `daily_login` | Một ngày điểm danh | +10 | Trong giao dịch `claimDaily` (`economy-service.ts:245`), không theo tier. |
| `achievement_small` / `achievement_big` / `achievement_item` | Mở thành tựu | +50 / +150 / +500 | Theo phần thưởng của định nghĩa: điểm ≤ 5 000 → small; điểm > 5 000 → big; vật phẩm → item. Trong `unlockWithin` (`achievement-service.ts:73`), nên GM mở (Plan 26) cũng cộng. |
| `welcome` | Chọn bộ đồ chào mừng (mục 4) | +100 | |
| `newcomer_day7` | Ngày 7 của lịch tân thủ | +200 | |

Ước tính: một tối 30 ván, thắng 8 → ~65/tối; một tuần ~450; một tháng ~1 900 (chưa kể thành tựu). Khớp Q1 với
ngưỡng ở A3.

Ghi sổ: bảng `reputation_events(id bigserial, player_id FK, delta int > 0, reason text, ref_id text, created_at)`,
`reason` ∈ `hand_played | hand_won | daily_login | achievement | welcome | newcomer_day | gm_grant | backfill`, chỉ mục
`(player_id, created_at)` và khóa duy nhất `(player_id, reason, ref_id)` (ván: `ref_id = handId`; điểm danh:
`daily:<pid>:<day>` như sổ điểm; thành tựu: `ach:<pid>:<id>`; backfill: `plan27`) để một sự kiện phát lại không cộng
hai lần. `players.reputation` là tổng vật chất hóa, cập nhật trong **cùng giao dịch** với sự kiện gốc. Test bất biến:
`players.reputation = Σ reputation_events.delta` cho mọi người chơi, chạy cùng chỗ với test bảo toàn điểm của
`gm-service.test.ts` (`totals()`).

Hai ván trong một giao dịch kết toán? Không: `HAND_SETTLED` là sự kiện sau commit (stats cũng vậy), nên danh vọng của
ván ghi ở giao dịch riêng của trình nghe, với khóa duy nhất ở trên làm idempotent. Danh vọng ván vì thế có thể đến
muộn vài chục ms sau số dư (như thành tựu hôm nay; `lessons-learned` "Flaky money checks").

### A3. Bậc (bảng `reputation_ranks(rank 1..5 PK, threshold int, updated_by, updated_at)`, GM sửa được)

| Bậc | Tên vi | Tên en | Ngưỡng mặc định | Màu | Ý nghĩa mặc định |
|---|---|---|---|---|---|
| 1 | Tân binh | Rookie | 0 | xám | không hiện nhãn |
| 2 | Tay bài | Card hand | 100 | xám | quà chào mừng đưa thẳng tới đây |
| 3 | Cao thủ | Sharp | 400 | xanh | mở hàng **rare** |
| 4 | Bậc thầy | Master | 1 800 | tím | mở hàng **epic** |
| 5 | Huyền thoại | Legend | 5 000 | vàng | chỉ để khoe |

Độ hiếm nào cần bậc nào nằm trong **giá từng món** (mục 3, cột `min_rank`), không gắn cứng vào bảng bậc; bảng trên
chỉ là mặc định khi nạp giá lần đầu. Tên bậc là chuỗi i18n (`rank.1`…`rank.5` trong `game.json` của ui-kit, cả vi và
en, vì ghế ở ui-kit cần nó); GM đổi ngưỡng (server từ chối thứ tự không tăng), không đổi tên trong đợt này.

Lên bậc: khi `players.rank` tăng, server gửi `NOTIFICATION { kind: 'RANK_UP', payload: { rank } }` cho người
chơi (toast "Bạn lên bậc Cao thủ"); `notify.RANK_UP` vào `game.json` vi/en. Không có hiệu ứng ở bàn trong đợt này.
Backfill (A6) không gửi.

### A4. Hiện cạnh tên

Đường dữ liệu: **không đổi protocol**. `GET /api/players/:id/avatar` (`routes-me.ts:241`) và `GET /api/me` trả thêm
`rank: 1..5` và `reputation`; cache avatar của web (`avatar/useAvatars.ts`) đã nuôi `makeCaptionFor`
(`TableChrome.tsx:62`), nên ghế, hồ sơ và sảnh đọc bậc từ cùng chỗ với danh hiệu. Bậc đổi giữa ván hiện khi cache
làm tươi (vào phòng, F5), như trang phục hôm nay.

- **Ghế (desktop, màn dọc):** `Seat` nhận prop mới `rank?: 1..5`. Bậc ≥ 2 hiện ngay sau tên trên dòng `seatName`
  dưới dạng **nhãn chữ** ("Cao thủ") màu theo bậc, cỡ chữ của `seatCaption`; danh hiệu/huy hiệu giữ nguyên dòng
  `caption`. Khi bảng tên hẹp (đo bằng container query hoặc `ResizeObserver`: chiều rộng `plateText` < 120 px) và
  **luôn luôn** trong khung `landscape` của Plan 26, nhãn rút thành **pill số La Mã** ("III") cùng màu, có `title`
  là tên bậc.
- **Sảnh:** `PlayerBar` (`PlayerBar.tsx:29`) thêm nhãn sau tên mình; bảng thành viên phòng của GM (`RoomsTab.tsx:223`)
  và hộp "Mời ra" của chủ phòng (`RoomScreen.tsx:461`) thêm pill số La Mã. Danh sách phòng không hiện.
- **Hồ sơ:** `ProfileScreen.tsx:251-265` thêm một dòng "Danh vọng 455 · Cao thủ · còn 1 345 tới Bậc thầy" với thanh
  tiến độ CSS; ở bậc 5 chỉ "Huyền thoại · 5 210".
- Bậc 1 không hiện gì; bot không có bậc.
- Màu bậc là token mới trong `tokens.css` (`--rank-2`…`--rank-5`), độ tương phản ≥ 4.5 trên nền bảng tên (test như
  `Badge`).

### A5. GM

- Trang người chơi (tab Người chơi): dòng "Danh vọng: 455 (Cao thủ)" và nút **"Cộng danh vọng"** (số dương, lý do
  bắt buộc) → `POST /api/gm/players/:id/reputation`, ghi `gm_actions.action = 'grant_reputation'` (thêm vào
  `GM_ACTION_KINDS`, `gm.log.kind.grant_reputation` vi/en) và `reputation_events.reason = 'gm_grant'`. Không có nút trừ.
- Tab mới **"Cửa hàng"** (B4) chứa luôn hai bảng nhỏ **Danh vọng**: `reputation_rules` (7 hàng) và
  `reputation_ranks` (5 hàng). Lưu → `PUT /api/gm/reputation/rules`, `PUT /api/gm/reputation/ranks`, mỗi lần một dòng
  `gm_actions` (`set_reputation_rules`, `set_reputation_ranks`) với lý do. Số của `GmScreen.test.tsx:52` (5 tab) và
  `routes-gm.test.ts:78` (22 route) tăng theo.

### A6. Tính lại từ lịch sử (Q6)

Một CLI riêng `reputation-backfill-cli` (như `grant-gm-cli`), chạy **sau** `docker compose up` và sau `backup.sh`,
có `--dry-run` in phân bố theo bậc. Với mỗi người chơi chưa có sự kiện `backfill`:

```
delta = (hands_played_holdem + hands_played_blind) × rules.hand_played
      + (hands_won_holdem + hands_won_blind) × rules.hand_won
      + total_login_days × rules.daily_login
      + Σ_{player_achievements.unlocked_at IS NOT NULL} rules.achievement_<bậc của định nghĩa>
```

từ `player_stats` (`schema.ts:258`) và `player_achievements` (`:234`), **trừ đi** `Σ reputation_events.delta` đã có của
người đó (các sự kiện sống ghi trong khoảng từ khi `app` lên tới khi CLI chạy, vì `compose` khởi động `app` ngay sau
`migrate`; mỗi sự kiện sống ứng đúng một lần tăng của `player_stats`, nên hiệu là chính xác; kẹp ≥ 0; R18), ghi một
`reputation_events` với `reason = 'backfill'`, `ref_id = 'plan27'` (khóa duy nhất → chạy lại là no-op), cộng vào
`players.reputation` và nâng `players.rank` trong một giao dịch cho mỗi người. Migration schema `0006_plan27` chỉ là DDL + seed bảng cấu hình (A2, A3, B1), theo quy
tắc của `0005_plan26.sql` (idempotent, `when` mới hơn, test `migrate-plan27.test.ts`).

## 3. Phần B — Cửa hàng (Q3)

### B1. Bảng giá `shop_prices` (GM sửa được)

| Cột | Ý nghĩa |
|---|---|
| `item_id` text PK (khớp `items.json`; không FK vì bảng `items` được nạp lại mỗi lần boot, `items.ts:437`) | món |
| `price_points` int ≥ 0 | giá điểm |
| `min_rank` int 1..5 | bậc tối thiểu để mua |
| `enabled` bool | có bán không |
| `sale_price` int, nullable | **để trống trong đợt này** (chỗ cho vòng sau) |
| `updated_by`, `updated_at` | ai sửa |

Seed trong `0006` (idempotent: `ON CONFLICT DO NOTHING`) từ `items.json` theo độ hiếm: common → 10 000 điểm, bậc 1;
rare → 30 000, bậc 3; epic → 150 000, bậc 4. **`enabled = false`** cho: món `isDefault` và món `free` (bốn áo thun
màu và các màu tóc/mắt/da, kiểu tóc **common** — `free` chỉ gắn cho common trong `items.json`; chúng đã miễn phí và
vẫn miễn phí) và 8 món là phần thưởng thành tựu (`achievements.json`). Màu tóc và màu mắt **rare/epic** không `free`
nên **có bán** như món khác (R16).

**Món của lịch quà tháng** là một **lớp sống** đè lên `enabled`, không đóng băng trong seed: lúc đọc cửa hàng và lúc
mua, server hỏi lịch hiện hành (`GiftScheduleStore.current()`, gồm `gift_months` của GM — Plan 26 — và
`daily-gifts.json`), và một món nằm trong `fixed` của **tháng hiện tại hoặc một tháng tới** thì không bán, nhãn
"📅 Quà tháng 11/2026"; `badge_monthly` và `title_devoted` nằm trong `default` nên không bao giờ bán. Món của một tháng
**đã qua** bán bình thường theo hàng giá của nó (R20, chờ người dùng xác nhận ở mục 11). Đối chiếu dữ liệu hôm nay: 14
món epic thì 6 là quà tháng 11/2026–4/2027 và 6 là thưởng thành tựu, nên **lúc ra mắt chỉ 2 epic mua được**
(`outfit_tuxedo01`, `outfit_royal_robe01`), 27 rare và 12 common; kệ epic đầy dần khi các tháng quà trôi qua.

Mọi món không bán vẫn hiện trong cửa hàng với **nhãn nguồn** ("🏆 Thành tựu: 100 ngày đăng nhập", "📅 Quà tháng
11/2026", "Miễn phí — có sẵn trong Phòng thay đồ"), không có nút Mua. Một món mới thêm vào `items.json` sau này mà
không có hàng giá thì **không bán** cho tới khi GM thêm hàng (màn GM liệt kê "chưa định giá").

### B2. Mua

`POST /api/shop/buy { itemId, purchaseId }` (`purchaseId` là UUID client sinh cho mỗi lần bấm Mua) → một giao dịch:
cài khóa `ledger_keys` `shop:<pid>:<purchaseId>` **trong chính giao dịch này** (`creditWithin` không tự cài khóa, chỉ
`apply()` làm; trùng khóa → trả lại kết quả cũ, không mua hai lần; khóa theo `purchaseId` nên một món bị GM thu hồi
vẫn mua lại được); đọc `shop_prices` và lịch quà (không cache); kiểm `enabled`, lớp quà tháng (B1), `min_rank ≤ rank`,
chưa sở hữu (alias-aware); rồi `creditWithin` với hàng người chơi `−price`, `reason = 'shop_purchase'`,
`ref_id = itemId`, và `meta = { kind: 'shop', refId: itemId }` → hàng sink `player_id = null`, `reason = 'shop'`
(`creditWithin` ghi sink với `reason = meta.kind`, `balance-repo.ts:181-189`; mở rộng `SettlementMeta.kind` thành
`'table_fee' | 'carry_over' | 'shop'`, `repositories.ts:48`); `inventory.grant(..., 'shop', ref =
'shop:<pid>:<purchaseId>')`. `InsufficientBalanceError` → `409 INSUFFICIENT_POINTS`; còn lại `SHOP_DISABLED`,
`RANK_TOO_LOW`, `ALREADY_OWNED`. Trả `{ balance, itemId }` và phát `onBalanceChanged` như điểm danh. Không hoàn trả.

Phân loại lý do: `shop_purchase` là lý do **chuyển** của hàng người chơi (như `buy_in`), **không** vào `SINK_REASONS`
hay `SOURCE_REASONS`; `'shop'` (hàng sink) vào `SINK_REASONS` (`gm-service.ts:177`) cạnh `table_fee` và `carry_over`,
để Tổng quan và "Theo ngày" đếm đúng một lần. Các bản sao phải cập nhật cùng commit: `TxReason`
(`repositories.ts:16-32`, thêm `shop_purchase` và `shop`), `SettlementMeta.kind`, `SINK_REASONS`, `REASONS`
(`LedgerPanel.tsx:13`), `ledger.reason.shop_purchase` và `ledger.reason.shop` vi/en; danh sách thưởng ở
`app.test.ts:905` không đổi. Test bảo toàn mới: N lần mua ngẫu nhiên trên PGlite (kể cả lặp `purchaseId`) →
`Σ balances + Σ sink rows` không đổi và `Σ sink(reason='shop') = Σ price đã trả`.

### B3. Màn "Cửa hàng" (web Normal; Lite không có tủ đồ nên không có)

Route `/shop`, nút ở sảnh cạnh "Phòng thay đồ". Bố cục mockup B:

- **Trái:** nhân vật của mình cỡ `StagePanel` (cùng `Chibi`). Bấm một thẻ → **mặc thử** ngay (trạng thái client, không
  ghi gì), nút "Về đồ đang mặc". Dưới nhân vật: số dư, bậc + thanh tiến độ.
- **Phải, trên:** **"Kệ tuần này"**: tối đa 6 món, do GM xếp (B4); nếu tuần hiện tại chưa được xếp, server tự chọn
  6 món `enabled` xoay vòng theo số tuần ISO (ổn định trong tuần).
- **Phải, dưới:** ba kệ **Common / Rare / Epic** (segmented), trong mỗi kệ lọc theo ô (Mũ, Mặt, Trang phục, Hào quang,
  Khung, Danh hiệu, Huy hiệu, **Màu sắc** — màu tóc và màu mắt rare/epic, thẻ là ô màu như `ColourCard` của tủ đồ,
  mặc thử đổi màu trên nhân vật). Mỗi thẻ (dùng lại `ItemCard` của `wardrobe/cards.tsx`, thêm chân thẻ): ảnh icon, tên,
  giá; trạng thái: **Mua**; **Mua** mờ + "thiếu 12 000 điểm"; **🔒 cần Bậc thầy**; **✓ Đã có** → "Mặc" (mở Phòng thay
  đồ với món được chọn); hoặc nhãn nguồn (B1).
- **Xác nhận mua:** hộp thoại "Mua Bộ chia bài với 30 000 điểm? Còn lại 98 000." → Mua. Sau đó: toast, thẻ thành "Đã
  có", nhân vật bên trái giữ món đang mặc thử và có nút "Mặc luôn" (lưu vào `avatar_config` qua `PUT /api/me/avatar`).
- **375 px:** nhân vật thu thành băng ngang 96 px trên cùng, kệ dưới. **Điện thoại ngang:** không bố cục riêng, trang
  cuộn. Ảnh thật ở 1920×940, 1366×768, 375×812, 915×412; `expectNoTextOverlap`.
- Dữ liệu: `GET /api/shop` → `{ prices[], featured: itemId[], weekKey, me: { balance, reputation, rank, ranks[] } }`.
- Thuật ngữ ổn định mới (vào glossary `docs/copy-review-2026-10-10.md` §3): **Cửa hàng**, **Kệ tuần này**, **Mua**,
  **Mặc thử**, **Danh vọng**, và năm tên bậc.

### B4. GM — tab "Cửa hàng"

Ba khối: **Giá** (bảng lọc theo ô/độ hiếm, sửa `price_points`, `min_rank`, `enabled` từng hàng; "chưa định giá" ở
trên cùng; lưu một lần với một lý do → `PUT /api/gm/shop/prices` với mảng thay đổi, một `gm_actions`
`set_shop_prices` với `details = thay đổi`), **Kệ tuần này** (chọn tuần: hiện tại và 8 tuần tới; chọn tối đa 6 món;
để trống = tự xoay; bảng `shop_featured(week_key 'YYYY-Www' PK, item_ids jsonb, updated_by, updated_at)`;
`PUT /api/gm/shop/featured/:week`, `gm_actions` `set_shop_featured`), **Quà chào mừng** (ba món của C1, chọn trong các
món `enabled` không phải thành tựu; bảng `shop_config(key PK, value jsonb)` với `key = 'welcome_choices'`;
`PUT /api/gm/shop/welcome`, `gm_actions` `set_welcome_choices`), và **Danh vọng** (A5). Giá có hiệu lực cho lần mua
sau ngay lập tức. Tổng route GM mới: 6 (`reputation` grant, rules, ranks; shop prices, featured, welcome) → ghim
`routes-gm.test.ts:78` thành 28; `GM_ACTION_KINDS` thêm 6 kind với chuỗi `gm.log.kind.*` vi/en.

## 4. Phần C — Quà chào mừng và lịch tân thủ (Q5, Q6)

Không có luồng tạo nhân vật: đăng ký là một form (`AuthScreen.tsx`, `register` ở `auth-service.ts:162-210`) rồi vào
thẳng sảnh. Vì vậy **một luồng duy nhất cho tài khoản mới và cũ**:

### C1. Hộp thoại "Quà chào mừng" ở lần vào sảnh đầu tiên

Nếu `players.welcome_claimed_at` (cột mới) trống, sảnh mở hộp thoại (Modal của ui-kit) **"Chào mừng đến Blind Luck
Poker"**: "Chọn một bộ đồ để bắt đầu" với **3 món rare** mặc trên chính nhân vật của mình (`Chibi` đổi món theo thẻ
đang chọn), nút **"Nhận"** và **"Để sau"**. "Để sau" đóng hộp; sảnh giữ một nút "🎁 Quà chào mừng" cho tới khi nhận.
Ba món lấy từ `welcome_choices` (seed trong `0006`, GM sửa trong tab Cửa hàng, B4): mặc định
`outfit_dealer01`, `outfit_tet_red01`, `head_conical_hat01` (hai bộ rare có art cho cả hai giới và một mũ rare).
Món người chơi **đã có** (tài khoản cũ có thể đã rút trúng `head_conical_hat01` ở ngày 14/21, hoặc được GM tặng) hiện
mờ với "✓ Đã có" và không chọn được; nếu cả ba đã có, hộp thoại chỉ còn "Nhận 100 danh vọng" (R17).

`POST /api/welcome/claim { itemId }` → một giao dịch: kiểm `welcome_claimed_at IS NULL` và `itemId ∈ welcome_choices`;
`inventory.grant(..., 'welcome')`; mặc luôn (cập nhật `avatar_config` ở ô tương ứng); `+rules.welcome` danh vọng
(`reason = 'welcome'`, `ref_id = 'welcome'`); đặt `welcome_claimed_at`; khởi tạo `newcomer_progress` (C2). Điểm khởi
đầu 100 000 **giữ nguyên** (`starting_balance` khi đăng ký như hôm nay). Chỉ một lần cho mỗi tài khoản; `409
WELCOME_CLAIMED` nếu lặp.

### C2. Lịch tân thủ 7 ngày

Bảng `newcomer_progress(player_id PK, day int default 1, claimed_days jsonb default '[]', finished_at)`. Ngày 1 là
ngày nhận quà chào mừng (C1). Mỗi lượt `claimDaily` sau đó (ngày khác ngày C1, theo `dayKey` của múi giờ kinh tế)
tăng `day` lên một, **trong cùng giao dịch** với điểm danh thường: lịch đếm theo **ngày có nhận**, không theo ngày
lịch, nên bỏ một hôm không mất. Mốc: **ngày 3** một món common `enabled` chưa có, ngẫu nhiên (`unownedOfRarity`);
**ngày 7** một món rare chưa có + `rules.newcomer_day7` danh vọng, rồi `finished_at`. Hết món của độ hiếm →
`NO_ITEM_FALLBACK_POINTS` như lịch tháng (`reason = 'daily_item_fallback'`, `ref_id = 'newcomer:<pid>:<day>'`); món cấp
với `source = 'newcomer'`, `ref = 'newcomer:<pid>:<day>'`.

Màn Điểm danh (`DailyScreen.tsx:172`) thêm **một Panel "Tuần đầu tiên"** dưới thẻ tóm tắt khi lịch chưa xong: 7 ô
ngang (✓ đã nhận, ★ hôm nay, 🔒 còn lại), ô 3 và 7 ghi quà. Một nút "Nhận thưởng" nhận cả hai; biên lai kể cả hai
dòng. Kết quả `claimDaily` thêm `newcomer?: { day, item?, points?, reputation? }`. GM "Đặt lại điểm danh" (Plan 26)
**không** lùi lịch tân thủ (known-limitations).

## 5. Phần D — Blind Poker chơi tới 0 (Q7, K2)

Dò mã: `commit` (`common.ts:27`) đã cắt ở stack và đặt `allIn`; `settle` (`common.ts:81`) đã dùng `computePots` /
`distributePots` với pot phụ cho cả Blind; `BlindRules.tableFeeRate` đã là trường riêng (`types.ts:19`). Việc còn lại
nằm ở ba chốt chặn và luật phòng.

### D1. Luật

- **Phí bàn Blind = 0.** `ECONOMY.blindTableFeeRate = 0`; `roomConfigToRuleset` (`validate.ts:131`) dùng nó cho
  Blind (Hold'em giữ `tableFeeRate` 2 % / cap 1 BB). Phòng sống trong bộ nhớ nên mọi bàn sau deploy đều theo luật mới.
  Lite dùng cùng `@bp/core` nên cũng 0 phí sau `build:lite` (ghi CHANGELOG). SRS §12, hướng dẫn chơi, `blind.test.ts:73,
  118-119, 188` sửa theo.
- **Được chia bài khi `stack > 0`.** Bỏ kiểm tra `stack < required` ở `createBlindHand` (`blind.ts:45`);
  `requiredStack()` của phòng (`room.ts:935`) trả 1 cho cả Blind, nên `eligibleForHand` (`:977`), `startHand`
  (`:744`), `sitOut` (`:416`) và `onHandComplete` (`:867`) tự theo. Ai còn `0 < stack < mức` góp `min(stack, mức)` và
  tất tay; ở **Chơi hoặc bỏ**, lần góp thứ hai (`resolveDecisions`, `blind.ts:187`) cũng qua `commit` nên tự tất tay;
  `callAmount` của quyết định trả `min(stack, mức)` để nút ghi **"Tất tay N"** thay vì "Chơi" khi N < mức.
- **Ngồi xuống** (`room.ts:340-344`): cần `balance ≥ fixedWager` (đủ **một** ante; hôm nay dòng 342 đòi
  `blindRequiredStack`, tức gấp đôi ở Chơi hoặc bỏ — đổi) và mua vào `min(balance, hạn mức)`; `shortToSit` giữ nghĩa
  "không đủ một mức cược để vào bàn" (R11).
- **Ghế hết sạch sau ante ở Chơi hoặc bỏ** (R14): ghế có `stack = 0` sau lần góp đầu **không được hỏi** ở vòng quyết
  định; engine coi nó là **"Chơi" tự động, tất tay** (như Hold'em bỏ qua người đã tất tay: `blindLegalActions`,
  `blind.ts:96-100`, trả `none` cho ghế `allIn`; `resolveDecisions` điền `play` cho nó; không tính timeout, không
  đếm vào ba lần tự động để đứng dậy; bot cũng vậy). Nút của ghế khác không đổi. Bỏ bài khi đã không còn gì để góp
  chỉ làm mất ante, nên không có lý do để hỏi.
- **Pot carry-over** (R19): `settle` cộng `carryOverIn` vào pot chính (`common.ts:87`), nên người tất tay ít vẫn đủ
  điều kiện ăn cả phần carry-over nếu thắng pot chính. Giữ như vậy: carry-over là tiền chết của ván trước, ai vào ván
  cũng có quyền, giống ante của mọi người trong pot chính (SRS §8.4).
- **Lite** dùng cùng `Room` của server-kit nên cũng chơi tới 0 và đứng dậy ở 0 sau `build:lite` (CHANGELOG).
- **Rời bàn khi đúng 0:** `onHandComplete` → ghế người có `stack === 0` → `standUpSpent` gửi thông báo mới
  `STACK_SPENT { roomId }` ("Bạn đã hết điểm ở bàn này", kèm nút tới Cứu trợ nếu số dư ví < `reliefThreshold`);
  `TABLE_LIMIT_SPENT` không còn phát sinh từ Blind (giữ chuỗi cho Hold'em nếu có đường nào dùng; nếu không, xóa cả
  hai locale).
- `blindRequiredStack` còn dùng ở client (`RoomScreen.tsx:225`) cho gợi ý: đổi thành "mức cược" (ngồi) và bỏ ở chỗ
  khác; `blindTableLimit` không đổi.

### D2. Bảo toàn và kiểm thử

Core: ván 3 người, một người có 3 000 ở bàn 5 000 → tổng pot = tổng góp, pot phụ chia đúng, người tất tay ít chỉ ăn
pot chính phần mình, `fee = 0`; Chơi hoặc bỏ với người không đủ lần góp hai. Room: người còn 3 000 vẫn được chia, về
0 thì đứng dậy với `STACK_SPENT`, `books()` = 0 (`room-hands.test.ts:931`); ghế hết sạch sau ante được chơi tự động
và không bị đếm timeout. Soak (`soak.test.ts`) và mô phỏng Blind ở `engine.test.ts:147` chạy lại với Blind không phí: không còn sink `table_fee` từ Blind, tổng không đổi. `app.test.ts:877-909`
(e2e bàn Blind) sửa kỳ vọng phí về 0.

## 6. Phần E — Tủ đồ tải nhanh (K5)

Dò mã: `<img>` của `Chibi` và icon thẻ đã `loading="lazy"`; cái nặng là **lớp nhuộm màu** (`useTintedLayer`,
`tinted.ts:147`: `new Image()` + canvas, tải ngay, không lazy), mặt nạ mũ (`clip.ts:26`), 8 chân dung của
`HairStyleTab`, 5 chibi của `SavedOutfits`, và `Promise.all` năm API khi mở (`WardrobeScreen.tsx:126`). Khung yêu cầu,
người xây quyết cách làm:

- Mở Phòng thay đồ lần đầu trên mạng giả lập "3G nhanh" (Playwright CDP: 1.6 Mbps xuống, 150 ms RTT) **vẽ xong sân
  khấu và các thẻ trong khung nhìn ≤ 2 s** ở 1366×768 và 375×812.
- `Chibi` nhận `lazy?: boolean`: khi `lazy` và phần tử chưa vào khung nhìn (`IntersectionObserver`, biên 200 px) thì
  **không** gọi `useTintedLayer`/mặt nạ, chỉ giữ chỗ đúng kích thước (không nhảy layout). `SavedOutfits`,
  `HairStyleTab`, thẻ của Cửa hàng và tủ đồ dùng `lazy`; `StagePanel` và ghế ở bàn thì không.
- Việc nhuộm chạy qua một hàng đợi ≤ 4 việc đồng thời (ưu tiên phần tử đang thấy); ảnh `@2x` chỉ khi
  `devicePixelRatio ≥ 1.5`.
- Một test đo số request `/avatar/` khi mở màn (jsdom + mock `IntersectionObserver`, hoặc Playwright đếm request):
  trước ≈ mọi lớp của mọi thẻ; sau ≤ (thẻ trong khung nhìn + sân khấu) × số lớp. Không thêm thư viện.

## 6b. Phần G — Điểm danh đếm theo tháng, không cần liên tiếp (Q13)

Hôm nay `nextStreak` (`daily-rules.ts:129`) cộng 1 khi hôm qua có nhận, còn lại về 1; sang tháng mới về 1; mốc quà
(7, 14, 21, 28) và `DAILY_REWARD_POINTS` tính theo chuỗi đó. Đổi:

- **Ô thứ N của lịch sáng ở lần điểm danh thứ N trong tháng.** `day = claimed_days.length + 1` của tháng hiện tại
  (`daily_logins.claimed_days` đã có); sang tháng mới về 1 như cũ; bỏ một hôm **không** về 1. `DAILY_REWARD_POINTS`,
  `applyItemRule`, lịch quà tháng của GM (Plan 26), "Đặt lại điểm danh" (lùi `day` một đơn vị), và lịch tân thủ (C2)
  giữ nguyên hình dạng, chỉ đổi cách đếm. Tháng 30 ngày không có lần thứ 31, như `MAX_STREAK` hôm nay.
- **Cột `daily_logins.streak` giữ tên, đổi nghĩa** thành "số lần đã nhận trong tháng" (nó đã về 1 mỗi tháng).
  Migration dữ liệu trong `0006`: `streak = jsonb_array_length(claimed_days)` cho hàng có `month` = tháng hiện tại
  (tài khoản bị gãy chuỗi trong tháng được trả lại ô đúng), idempotent.
- **Chuỗi liên tiếp vẫn tồn tại cho thành tựu** `login_streak_7` và `login_streak_28` (danh hiệu Tận tụy):
  `claimDaily` tính `consecutive = lastClaimDate == hôm qua ? consecutive + 1 : 1` vào cột mới
  `daily_logins.consecutive` và phát nó trong `DAILY_CLAIMED`; `stats-service.ts:161-168` lấy `loginStreak` /
  `bestLoginStreak` từ trường đó thay vì từ `streak`. `total_login_days` không đổi (R21).
- **Màn Điểm danh:** câu tóm tắt đổi thành "Lần điểm danh thứ 12 của tháng 10 · không cần liên tiếp"; ô đã nhận hiện
  ngày thật đã nhận (tooltip), ô kế tiếp là "Hôm nay"; thanh phụ "Còn 19 ngày trong tháng cho 16 ô" để người chơi thấy
  mình còn kịp mốc nào. Copy vi/en, `docs/player-guide.md` §Điểm danh, SRS §13 sửa theo.
- **Kiểm thử:** `daily-rules.test.ts:82` (gãy chuỗi → hôm nay là 1) đổi thành "bỏ một hôm → lần kế tiếp"; thêm test
  "bỏ 3 hôm trong tháng 31 ngày vẫn tới ô 28, bỏ 4 hôm thì không"; test `consecutive` cho hai thành tựu; test hoàn tác
  của GM lùi `day` đúng một; test migration dữ liệu.

## 7. Phần F — Tài liệu K1 (Q9)

`docs/player-guide.md` thêm mục "Chơi trên hai thiết bị": thiết bị đăng nhập sau tiếp quản ghế và ván đang dở, thiết
bị trước thấy "Đã đăng nhập ở nơi khác" và không tự nối lại; không ai bị cấm. `docs/known-limitations.md` ghi: không
có xác nhận "Tiếp quản" và không có danh sách thiết bị. `docs/bug-log.md` §9 K1 đóng với kết luận này.

## 8. Không làm trong đợt này

- Giảm giá, món giới hạn thời gian, gói, quà tặng giữa người chơi, đổi/bán lại món, hoàn tiền.
- Đổi tên bậc trên màn GM; nhiều hơn 5 bậc; hiệu ứng lên bậc ở bàn; bảng xếp hạng danh vọng.
- Danh vọng và cửa hàng trong Lite (Lite không có tủ đồ, không tài khoản).
- K1: luật hai máy (chỉ tài liệu). K6: dáng đứng mới. Phí bàn Hold'em.

## 9. Rủi ro

- **Sink mới `shop_purchase`** chạm sổ điểm: chỉ qua `creditWithin` + `ledger_keys`, test bảo toàn (B2), không viết
  đường riêng. Bốn bản sao danh sách lý do (B2) trong cùng commit.
- **Bỏ ngưỡng Blind** chạm core và room: test pot phụ cho cả hai điểm tất tay của Chơi hoặc bỏ, test đứng dậy ở 0,
  soak; kiểm `callAmount` ở client cho nhãn "Tất tay N".
- **Backfill** trên dữ liệu thật: CLI riêng, `--dry-run`, sau `backup.sh`, khóa duy nhất.
- **Hai lịch trong một lần "Nhận thưởng"**: một giao dịch, một khóa; test hoàn tác của GM không đụng lịch tân thủ.
- **Tên bậc là thuật ngữ e2e** mới: vào glossary ngay trong plan; nhãn ở ghế không được làm tên bị cắt (test overlap
  và ảnh thật).
- **Màn Cửa hàng là màn lớn mới**: ảnh thật bốn cỡ; dùng lại thẻ và `Chibi` của tủ đồ, không nhân đôi CSS (một
  CSS-module là một namespace).
- **Số đếm bị ghim:** 5 tab GM, 22 route GM, danh sách route đầy đủ (`app.test.ts:359-410`), parity i18n ba nơi,
  `acceptance-links.test.ts` (checklist `64+3+2+3+3`, matrix `43+10+4+7+5+8+3`) — cộng đúng số hàng thêm.

## 10. Ruling của phiên (người viết spec quyết, người dùng duyệt khi đọc)

- **R1** Danh vọng không bao giờ bị trừ, kể cả bởi GM, kể cả khi GM hoàn tác điểm danh hay thu hồi món
  (known-limitations). *Nếu sai:* cần đường trừ có kiểm tra ≥ 0.
- **R2** Nguồn và số danh vọng như A2; GM sửa số, không thêm sự kiện mới. *Nếu sai:* một bảng rộng hơn.
- **R3** Ngưỡng độ hiếm nằm trong giá từng món (`min_rank`); bảng bậc chỉ là mặc định. *Nếu sai:* không có gì mất.
- **R4** "Kệ tuần này" khi GM không xếp thì xoay theo tuần ISO, không ngẫu nhiên.
- **R5** Không giảm giá trong đợt này; `sale_price` để trống.
- **R6** Ba món chào mừng là **rare** (hai bộ, một mũ), không phải common: áo thun common đã miễn phí từ trước nên
  một bộ common không phải quà. Món rare ngày 7 vẫn ngẫu nhiên. *Nếu sai (người dùng muốn giữ common):* đổi
  `welcome_choices` sang ba mũ/mặt common có trả phí, không đổi mã.
- **R7** Lịch tân thủ đếm theo ngày có nhận, không theo ngày lịch; bỏ một hôm không mất.
- **R8** Tài khoản cũ nhận cả hộp quà chào mừng lẫn lịch tân thủ từ ngày deploy, không nhận bù gì khác.
- **R9** Bậc đi theo payload avatar (`/api/players/:id/avatar`, `/api/me`), không thêm trường vào `PlayerIdentity`
  hay snapshot; bậc đổi hiện khi cache avatar làm tươi.
- **R10** Bậc 1 không hiện nhãn; bot không có bậc.
- **R11** Ngồi xuống bàn Blind vẫn cần đủ một mức cược; chỉ khi đã ngồi mới chơi tới 0.
- **R12** K5 đo bằng Playwright với mạng giả lập và một test đếm request; không thêm thư viện.
- **R13** Danh vọng của ván ghi ở trình nghe `HAND_SETTLED` (sau commit) với khóa duy nhất, không trong giao dịch kết
  toán, để không chạm đường tiền của phòng.
- **R14** Ở Chơi hoặc bỏ, ghế hết sạch sau ante được coi là "Chơi" tự động (tất tay), không hỏi, không tính timeout.
  *Nếu sai:* hỏi và cho bỏ, mất ante vô ích.
- **R15** Bậc là mốc cao nhất đã đạt (`players.rank`), không tính lại khi GM nâng ngưỡng. *Nếu sai:* bậc tính sống từ
  ngưỡng, có thể tụt.
- **R16** Màu tóc/mắt rare và epic có bán (bộ lọc "Màu sắc"); màu common vẫn miễn phí. *Nếu sai:* tắt `enabled`.
- **R17** Món chào mừng đã có thì không chọn được; cả ba đã có → chỉ nhận danh vọng.
- **R18** Backfill = công thức từ `player_stats` trừ sự kiện sống đã ghi, kẹp ≥ 0; không chặn danh vọng trong lúc chờ CLI.
- **R19** Người tất tay ít vẫn đủ điều kiện ăn carry-over trong pot chính.
- **R20** Món quà tháng chỉ không bán khi thuộc tháng hiện tại hoặc tháng tới theo lịch sống; tháng đã qua thì bán
  (người dùng xác nhận, Q12).
- **R21** Chuỗi liên tiếp vẫn được đếm riêng (`consecutive`) cho hai thành tựu đăng nhập liên tiếp; lịch và quà đi
  theo số lần trong tháng. *Nếu sai:* bỏ hai thành tựu đó hoặc đổi điều kiện của chúng.

## 11. Kiểm spec (2026-10-21)

Một kỹ sư độc lập (subagent opus) đọc spec và đối chiếu mã ở `57440ee`. Sai lệch đã sửa vào thân spec: hàng sink
của `creditWithin` lấy `reason = meta.kind` và `SettlementMeta.kind` phải mở rộng, `shop_purchase` là lý do chuyển
còn `shop` mới là sink (B2); `creditWithin` không cài `ledger_keys`, khóa phải cài trong giao dịch mua và theo
`purchaseId` để mua lại được sau khi GM thu hồi (B2); `free` chỉ gắn cho màu common (B1, R16); ngồi xuống bàn Blind
hôm nay đòi `blindRequiredStack` chứ không phải một mức cược (D1); `welcome_choices` thiếu route và kind GM (B4);
`RoomScreen.tsx:461` là hộp "Mời ra" (A4); mô phỏng Blind ở `engine.test.ts:147`. Câu hỏi của người xây đã thành
R14 (ghế hết sạch sau ante), R15 (bậc là mốc cao nhất), R16 (màu rare/epic), R17 (món chào mừng đã có), R18 (backfill
trừ sự kiện sống), R19 (carry-over), và ghi chú Lite ở D1. Hai câu còn lại người dùng đã trả lời cùng ngày: **R6** →
Q11 (rare) và **R20** → Q12 (tháng đã qua thì bán). Cùng lượt đó người dùng thêm Q13 (điểm danh đếm theo tháng), ghi
ở Phần G.
