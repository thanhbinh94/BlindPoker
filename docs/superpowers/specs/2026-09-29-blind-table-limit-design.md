# Hạn mức bàn Blind Poker — thiết kế

Ngày: 2026-09-29. Trạng thái: người dùng duyệt thiết kế (luật + server/giao diện + kiểm thử) trong phiên brainstorming
cùng ngày và yêu cầu "viết spec đi sau đó lập plan và triển khai luôn" (bỏ bước duyệt lại bản spec viết). Sửa đổi spec gốc
`docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8, §12, §21 (ghi rõ trong mục 9 bên dưới).

## 1. Mục tiêu

Người dùng: *"bổ sung vào chế độ blind poker phần hạn mức dựa theo số tiền cược (ví dụ: phòng cược 5.000 thì hạn mức mỗi
người là 25.000, khi thua hết thì đứng khỏi bàn chơi và phải thao tác để vào lại bàn)"*.

Hiện nay (trước thay đổi) ghế Blind **là** số dư: `Room.sitDown` đặt `stack = balance`, mỗi ván ghi một dòng
`settlement` vào số dư, không có giới hạn nào cho một lần ngồi. Sau thay đổi, mỗi lần ngồi mang lên bàn một khoản có
giới hạn; thua hết khoản đó thì bị mời đứng dậy và phải tự chọn ghế để vào lại.

## 2. Quyết định của người dùng

| # | Câu hỏi | Chọn |
|---|---|---|
| Q1 | Hạn mức tính thế nào | **Cố định 5 × W** — không có lựa chọn khi tạo phòng |
| Q2 | Điểm thắng đi đâu | **Cộng vào chồng trên bàn** (chồng có thể vượt hạn mức); rời bàn thì cả chồng về số dư |
| Q3 | Số dư < hạn mức khi ngồi | **Ngồi với toàn bộ số còn lại**: `min(số dư, L)`, miễn ≥ mức tối thiểu R |
| Hướng | Cách hiện thực | **A — điểm lên bàn như buy-in Hold'em** (không phải "hạn mức ảo" trên số dư) |

## 3. Định nghĩa

- **W** — `fixedWager` của phòng (1.000 / 2.000 / 5.000 / 10.000 / 20.000 / 50.000).
- **L** (hạn mức) — `blindTableLimit(rules) = W × ECONOMY.blindTableLimitMultiplier`, hệ số = **5**.

  | W | 1.000 | 2.000 | 5.000 | 10.000 | 20.000 | 50.000 |
  |---|---|---|---|---|---|---|
  | L | 5.000 | 10.000 | 25.000 | 50.000 | 100.000 | 250.000 |

- **R** (mức tối thiểu để chơi một ván) — `blindRequiredStack(rules)`, không đổi: W ở kiểu A (`none`), 2W ở kiểu B
  (`playOrFold`).
- **Chồng** (`stack`) — số điểm của ghế đang nằm trên bàn, tách khỏi số dư, như Hold'em.

## 4. Luật

1. **Vào bàn.** Người trong phòng bấm một ghế trống (`SIT_DOWN` không kèm `buyIn` — với Blind, `buyIn` nếu có bị bỏ
   qua). Server:
   - đọc số dư; nếu `< R` → từ chối `INSUFFICIENT_BALANCE`;
   - `amount = min(số dư, L)`; ghi `{ delta: −amount, reason: 'buy_in', refId: roomId }`; nếu repo báo thiếu số dư (đua
     với một thay đổi khác) → `INSUFFICIENT_BALANCE`;
   - nếu ghế đã bị người khác lấy trong lúc chờ ghi sổ → hoàn `{ delta: +amount, reason: 'refund' }` và báo `SEAT_TAKEN`
     (y hệt Hold'em);
   - `stack = amount`. Không có hộp thoại chọn số.
2. **Trong lúc ngồi.** Ante và tiền Chơi trừ từ chồng; thắng cộng vào chồng (có thể > L). Số dư không đổi theo từng ván.
   Thưởng điểm danh / thành tựu / cứu trợ vào **số dư**, không vào chồng. Sổ điểm mỗi ván chỉ còn dòng sink phí bàn
   (`table_fee`) — **không còn dòng `settlement` cho Blind**.
3. **Hết hạn mức.** Khi một ván kết thúc (`onHandComplete`), mọi ghế người thật có `chồng < R` bị mời đứng dậy ngay
   (sau các xử lý rời/đứng đã có):
   - phần lẻ còn lại (`0 < chồng < R`) về số dư qua `cash_out`; chồng 0 thì không ghi dòng nào;
   - ghế thành trống (`PLAYER_STOOD`), người chơi **ở lại phòng** làm người xem;
   - server gửi riêng người đó `NOTIFICATION { kind: 'TABLE_LIMIT_SPENT', payload: { roomId, limit: L, amount } }`
     (`amount` = số vừa trả về số dư, có thể 0 — tên `amount` để khớp cách `Toasts` đọc số từ payload);
   - không tự ngồi lại, không thời gian chờ; bấm ghế lần nữa là một lần vào bàn mới theo mục 1.
   Với Hold'em điều kiện này trùng luật cũ "chồng = 0 thì đứng dậy" (R = 1); Hold'em không nhận thông báo mới.
4. **Mọi cách rời ghế trả toàn bộ chồng về số dư** (`cash_out`), cho cả hai chế độ: Đứng dậy, Rời phòng, bị đuổi, quá
   hạn kết nối lại, ngồi ngoài đủ `handsSatOutToStand` ván, đóng phòng, server tắt đúng cách. "Ngồi ngoài" (`SIT_OUT`)
   giữ ghế và chồng.
5. **Điều kiện vào ván** (§8.2 mới): ghế đủ điều kiện khi `chồng ≥ R` (không còn đọc số dư). Nhờ mục 3, một ghế người
   thật giữa các ván luôn có `chồng ≥ R`.
6. **Pot cộng dồn** (§8.4) khi giải phóng vẫn chia vào **số dư** (không vào chồng), như hiện nay.
7. **Bot.** Chồng ảo = L khi tạo phòng; trước mỗi ván, bot có `chồng < R` được nạp lại về L. Không đụng kinh tế người
   chơi. (Tùy chọn `botStartingBalance` của Room vẫn dùng cho bot Hold'em.)
8. **Hiển thị.** Ghế người thật hiện chồng trên bàn (không còn là số dư thật); bot vẫn ẩn số như hiện nay.

## 5. Thay đổi kỹ thuật

### 5.1 `@bp/core`
- `ECONOMY.blindTableLimitMultiplier = 5` (`constants/economy.ts`, kèm test).
- `blindTableLimit(rules: Pick<BlindRules, 'fixedWager'>): number` trong `hand/blind.ts`, export ở `index.ts`, kèm test.
- Protocol: không thêm loại tin. `NOTIFICATION.kind` là chuỗi tự do và không có bảng hằng nào cho các kind hiện có
  (`KICKED`, `DAILY_REWARD`…), nên `'TABLE_LIMIT_SPENT'` được dùng thẳng ở server và trong khoá i18n `notify.*`.

### 5.2 `@bp/server-kit` — `Room`
- `sitDown`: nhánh Blind như mục 4.1 (dùng chung khung ghi sổ/hoàn với Hold'em).
- `startHand`: bỏ vòng lặp đặt `stack = balance` cho người thật; bot nạp lại về L (mục 4.7).
- `onHandComplete`: bỏ các entry `settlement` của Blind (lời gọi `apply([], { fee, kind: 'table_fee' })` giữ nguyên khi
  `fee > 0`); điều kiện đứng dậy đổi thành `p.seat !== null && !isBot && p.stack < requiredStack()` cho cả hai chế độ;
  riêng Blind gửi `TABLE_LIMIT_SPENT` sau khi đứng dậy xong (`amount` lấy từ chồng trước khi trả).
- `standUpNow`: `cash_out` khi `!isBot && stack > 0` cho **cả hai** chế độ.
- `pushBalance` / `refreshBalance`: chỉ đẩy `BALANCE`; bỏ việc chép số dư vào chồng Blind.
- `shutdown` / đóng phòng: mọi chồng người thật về số dư (đi qua `standUpNow` hoặc tương đương — kiểm tra lại cả hai
  đường).
- `HandSummary.players[].net` không đổi (tính từ chồng trước/sau ván) → thống kê, thành tựu, lịch sử không đổi.

### 5.3 `@bp/ui-kit`
- `RoomHeader`: Blind hiện "Mức cược {W} · Hạn mức {L}" (en "Wager {W} · Limit {L}").
- `CreateRoomFields`: dưới ô mức cược, dòng gợi ý "Hạn mức mỗi người: {L} điểm (5× mức cược)" (en "Table limit per
  player: {L} points (5× the wager)"), đổi theo mức cược đang chọn.
- Thông báo `TABLE_LIMIT_SPENT` (toast theo cơ chế `Toasts` hiện có, khoá `notify.<kind>`):
  - `notify.TABLE_LIMIT_SPENT` — vi "Bạn đã dùng hết hạn mức ở bàn này — {{amount}} điểm còn lại đã về số dư. Chọn một
    ghế trống để vào lại." / en "You have used up your table limit here — the {{amount}} left went back to your balance.
    Pick an empty seat to play again."
  - `notify.TABLE_LIMIT_SPENT_none` (khi `amount = 0`) — vi "Bạn đã dùng hết hạn mức ở bàn này. Chọn một ghế trống để
    vào lại." / en "You have used up your table limit here. Pick an empty seat to play again."
  - `Toasts.describe` chọn khoá `_none` khi kind là `TABLE_LIMIT_SPENT` và `amount === 0`; mọi kind khác không đổi.
- Gợi ý T4 (`room.shortOfPoints`, `RoomScreen`): đổi điều kiện từ "đang ngồi và số dư < R" sang "**chưa ngồi** (đang
  xem) và số dư < R" với chữ "Số dư không đủ để vào bàn (cần {R} điểm)" (en "Not enough points to take a seat (need
  {R})"). Người đang ngồi không bao giờ thiếu (mục 3).
- Hồ sơ (Normal): các nhãn sổ `buy_in` "Vào bàn" / `cash_out` "Rời bàn" đã có — không đổi.

### 5.4 Editions
- Normal server, Lite server: không đổi code kinh tế (lý do `buy_in`/`cash_out`/`refund` đã hợp lệ ở cả hai repo).
  Kiểm test nào của hai edition đang đòi dòng `settlement` Blind và sửa theo mục 4.
- Không migration database.

## 6. Lỗi và trường hợp biên

| Trường hợp | Xử lý |
|---|---|
| Số dư đổi giữa lúc đọc và lúc ghi `buy_in` | Repo từ chối (không cho âm) → `INSUFFICIENT_BALANCE`; không có gì trên bàn |
| Hai người cùng bấm một ghế | Người thua đua được hoàn `refund`, nhận `SEAT_TAKEN` |
| Rời phòng giữa ván | Như hiện nay: tự bỏ bài, cuối ván đứng dậy, chồng về số dư |
| Rớt mạng > 90 giây | Đứng dậy sau ván, chồng về số dư, ở lại phòng 5 phút làm người xem |
| Hết hạn mức đúng ván đang rời/đứng | Chỉ một lần đứng dậy, một lần `cash_out`; không gửi `TABLE_LIMIT_SPENT` cho người đã chủ động rời |
| Ghi `cash_out` thất bại khi hết hạn mức | Ghi log lỗi như các đường `standUpNow` khác; ván sau thử lại (ghế vẫn còn, không đủ điều kiện vào ván) |
| Lite bị tắt cưỡng bức | Mất chồng đang trên bàn (như Hold'em) — ghi vào known-limitations |
| Cứu trợ khi điểm đang trên bàn | Cứu trợ chỉ xét số dư (như Hold'em) — ghi vào known-limitations |

## 7. Bảo toàn điểm

Bất biến §12.6 giữ nguyên: `Σ số dư + Σ chồng trên bàn + pot cộng dồn + Σ sink` không đổi qua mọi thao tác. Soak Blind
(đọc sau `shutdown()`, lúc mọi chồng đã về số dư) tiếp tục kiểm `Σ số dư đầu = Σ số dư cuối + Σ sink`.

## 8. Kiểm thử

- **core:** hệ số và `blindTableLimit` cho cả 6 mức.
- **server-kit (Room):** ngồi với `min(số dư, L)` (số dư > L và số dư giữa R và L); từ chối khi số dư < R; đua ghế → hoàn;
  thắng/thua chỉ đổi chồng, sổ mỗi ván chỉ có phí; hết hạn mức → đứng dậy + `cash_out` phần lẻ + `TABLE_LIMIT_SPENT` +
  vẫn là thành viên phòng; ngồi lại → `buy_in` mới; mọi đường rời ghế trả chồng; bot nạp lại về L; `refreshBalance` không
  đụng chồng; shutdown trả chồng; soak Blind vẫn bảo toàn.
- **ui-kit:** đầu phòng có hạn mức; form tạo phòng có gợi ý đổi theo mức cược; toast `TABLE_LIMIT_SPENT` (có và không có
  phần lẻ); gợi ý "không đủ để vào bàn" chỉ khi đang xem.
- **Test cần viết lại:** mọi test đang đòi dòng `settlement` cho Blind (server-kit, normal-server, e2e
  `normal.spec.ts`, ops `02-lobby-rooms`, `04-blind`) chuyển sang `buy_in`/`cash_out`.
- **Ops pack, ca mới F-10:** phòng W = 1.000 kiểu Chơi/Bỏ, 1 bot; người chơi luôn Bỏ → mỗi ván mất đúng 1.000; sau 4 ván
  chồng 1.000 < 2.000 → bị mời đứng dậy; kiểm toast, số dư = đầu − 4.000, sổ có `buy_in −5.000` và `cash_out +1.000`; bấm
  ghế lại → thêm một `buy_in`. Thêm ca vào `docs/operation-test-plan.md`.

## 9. Tài liệu phải sửa

- Spec gốc: §8.1 thêm dòng "Hạn mức L = 5 × W"; §8.2 điều kiện theo chồng; thêm **§8.8 Hạn mức bàn** (tóm tắt mục 4);
  §8.4 ghi rõ pot cộng dồn chia vào số dư; §12.2 thêm `blindTableLimitMultiplier = 5`; §12.3 bỏ ý Blind có entry người
  chơi mỗi ván; §21 nếu bảng tính năng nhắc Blind thanh toán từng ván.
- `docs/known-limitations.md`: gỡ "Blind Poker shows opponents' balances"; mục hard kill Lite nói rõ cả chồng Blind; thêm
  mục cứu trợ không tính điểm trên bàn.
- `docs/server-kit.md`: `balanceChanged` không còn "mirrored stack" cho Blind; mô tả vào/ra bàn Blind.
- `docs/operation-test-plan.md`: ca F-10; sửa các ca Blind đang nói số dư đổi mỗi ván.
- `CHANGELOG.md`: mục hạn mức Blind.

## 10. Ngoài phạm vi

Chủ phòng chọn hệ số; người chơi tự chọn số mang lên bàn; nạp thêm giữa chừng (top-up); tự ngồi lại; thời gian chờ
trước khi vào lại; tính điểm trên bàn vào điều kiện cứu trợ; thông báo hết chồng cho Hold'em.

## 11. Triển khai

Khởi động lại host đóng mọi phòng và trả mọi chồng/pot (§16.7), nên không có ghế Blind nào vắt qua lúc đổi luật. Sau
merge: `pnpm build:normal`, kiểm `/health` `rooms:0`, `stop.ps1`, `run.ps1 -NoMigrate`; `pnpm build:lite`.
