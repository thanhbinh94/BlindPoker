# BP-31 — Bàn trên điện thoại: bài to, khay một hàng, thanh kéo mức cược; hạn mức Blind 10×

Spec thiết kế, 2026-10-23. Sửa đổi SRS `2026-09-04-bind-poker-design.md` §27.1 (bố cục bàn dưới 768 px và khay
ở khung nằm ngang; chữ mới ở §8 dưới đây), §8.8 và bảng hằng số (hạn mức Blind), và trả lời bốn mục của
`docs/ui-review-2026-10-22.md` nằm cùng vùng bàn chơi: P1 (chữ 10 px), P7 (tên bị cắt), P10 (khay 1.880 px ở 1920),
P13 (thẻ kết quả ở 768).

Nguồn: brainstorm 2026-10-23 với ảnh phác trong tab (`.superpowers/brainstorm/152-*/content/phone-table-layout*.html`).
Người dùng mô tả: "khi xoay ngang màn hình hoặc xoay dọc ở lúc vào bàn, thiết kế các nút quá to, khá khó nhìn bài",
"trên điện thoại ở cả 2 mode".

## 1. Quyết định của người dùng (Q-table)

| # | Câu hỏi | Quyết định | Ngày |
|---|---|---|---|
| Q1 | Bố cục bàn trên điện thoại dọc | **Phương án B** (bài to, khay gọn, mức tiền thành chip) với **tay bài xòe quạt đè mép nỉ kiểu C**; bản phác v2 là hình chốt | 2026-10-23 |
| Q2 | Cách chọn số tiền cược | **Thanh kéo**, không nhập số bằng tay | 2026-10-23 |
| Q3 | Thanh kéo trên máy tính | **Thay hẳn ô nhập số trên cả desktop** | 2026-10-23 |
| Q4 | Hạn mức vào bàn Blind | **Gấp 10 mức cược** (cược 5.000 → hạn mức 50.000), thay cho 5× | 2026-10-23 |
| Q5 | Phạm vi vòng này | Bàn chơi (Q1–Q4) + P1, P7, P10, P13 của bản rà soát; sảnh chờ (P3), Quản trị (P5), nhãn hoa (P8), emoji (P9) và phần còn lại **để vòng sau** | 2026-10-23 |
| Q6 | Cách chạy | Viết spec → plan → triển khai trong ngày; sau merge **deploy VPS ngay**, người dùng push sau | 2026-10-23 |

## 2. Hiện trạng trong mã (đối chiếu 2026-10-23, `main` 701cd13)

- **Khay hành động** là `ActionBar` (`packages/ui-kit/src/table/ActionBar.tsx`), nằm cuối `<footer className={s.roomFoot}>` của
  `screens/RoomScreen.tsx` và chỉ được mount khi `hand !== null && hand.mySeat !== null`. Trên desktop và điện thoại dọc, hàng
  `.controls` (group "Điều khiển bàn", `RoomScreen.tsx:414-438`) **phía trên** khay chứa Đứng dậy, Tạm nghỉ / Chơi tiếp, Sẵn sàng /
  Hủy sẵn sàng, Bắt đầu, số người sẵn sàng, đồng hồ giữa ván, Quản lý bàn và dòng gợi ý; ở khung nằm ngang Đứng dậy, Tạm nghỉ,
  Quản lý bàn, Toàn màn hình đã nằm trong menu ⋯ ("Thêm", `primitives/MenuButton.tsx`) của header, và Sẵn sàng / Bắt đầu / đồng
  hồ nằm trong một dock góc dưới phải.
- **Chọn tiền** (Hold'em): chip Min · ½ · Pot · Max (`presets.*`, group "Mức cược"), ô `<input type="number">` (`labels.amount`) và một
  slider `labels.amountSlider` chỉ hiện từ 768 px (`SLIDER_STEPS = 50`); dưới 768 px slider ẩn, ô số rộng 100 %. Nằm ngang: không
  có ô số, chạm "Tố" lần đầu mở chip + nút ✎ → `AmountDialog` ("Nhập số điểm"). Số tiền gửi lên là **tổng của vòng**
  (`minRaiseTo…maxRaiseTo`, `minBet…maxBet`, server tính, client chỉ kẹp). Tất tay Hold'em không mang số (`actions.allIn`);
  Blind mang số ("Tất tay 3.000"). Không có thông báo lỗi phía client.
- **Bố cục dọc** ("stack", `(max-width: 767px), (max-height: 620px)` ở `PokerTable.tsx:76`; `ActionBar` chưa biết bố cục này): lưới
  đối thủ `.others` / `.othersChip` (từ 4 đối thủ, `--plate-min: 96px`, chữ `0.6875rem`, chip và cược **`0.625rem` = 10 px** ở
  `table.module.css:1393, 1399`; nhãn pot nằm ngang ở `:1065`), nỉ `.stackFelt`, ghế mình `.mine` dính đáy (khối `Seat` 2 hàng với
  đĩa avatar, vòng đồng hồ, D, cược, chip trạng thái, danh hiệu, tên bài và `+payout` lúc lật). Cỡ bài ở 375 px: bài mình `.cardMd`
  32 px, bài chung `.cardLg` 40 px, bài đối thủ 26 px (ẩn từ 4 đối thủ). Khay: 4 hàng (Đứng dậy/Tạm nghỉ, Min·½·Pot·Max, ô số,
  4 nút `size="lg"` 52 px) ≈ 230 px. Dòng chờ (`trayWaitKey`, `role="status"`) là một hàng riêng. Không có kiểu "xòe quạt".
- **Desktop 1920:** `.tray` không có `max-width` nên trải 1.880 px dưới nỉ ≈ 921 px (`.ring` tối đa 980 px).
- **Tên bị cắt (P7):** ghế trên vòng rộng `15 %` tối thiểu 104 px (7+ ghế: 13 % / 94 px); `.seatNameText`, `.seatCaption` cắt bằng
  `text-overflow: ellipsis`; `placeRank` (`Seat.tsx:41-53`) đo `scrollWidth` của tên **một dòng**.
- **Thẻ kết quả (P13):** `HandResult.tsx` đã có lớp mờ "còn nữa" (`.resultBody[data-more='true']`, Plan 26).
- **Hạn mức Blind:** `ECONOMY.blindTableLimitMultiplier: 5` (`packages/core/src/constants/economy.ts:11`) qua `blindTableLimit()`
  (`hand/blind.ts:24`); server dùng khi ngồi (`room.ts:337-339`) và cho bot (`:99`, `:728`); UI in ở `RoomHeader` ("Mức cược X · Hạn mức
  Y") và gợi ý Tạo phòng `create.tableLimitHint` "(5× mức cược)". Danh sách đầy đủ những chỗ ghim 5× ở §3.6.
- **Khung:** `RoomFrame = 'desktop' | 'landscape'`; điện thoại dọc là `desktop` + bố cục stack. Tầng `short` (BP-28) chỉ chạm dock và
  vòng ghế, không chạm khay. Nút `Button size="md"` cao 44 px (`--tap`), `lg` 52 px.

## 3. Thiết kế

Thuật ngữ: **stack** = bố cục dọc theo query ở trên (điện thoại dọc, và cả cửa sổ thấp ≤ 620 px); **ring** = vòng ghế (≥ 768 px
và cao hơn 620 px); **landscape** = khung điện thoại ngang (`LANDSCAPE_PHONE`). `RoomScreen` đo stack bằng `useMediaQuery` cùng
query với `PokerTable` và truyền `layout: 'stack' | 'ring'` xuống `ActionBar` (ruling R9).

### 3.1 Điện thoại dọc (stack)

Thứ tự từ trên xuống: header (gọn, **có ⋯** như landscape) → dòng thông tin phòng → lưới đối thủ → nỉ (bài chung + pot) →
**tay bài của mình xòe quạt đè mép dưới nỉ** → **dải tên của mình** → **khay một hàng** (hoặc dock giữa ván).

- **Tay bài của mình (R1).** Hold'em (2 lá) và Blind không nặn (2–3 lá): mỗi lá rộng `clamp(52px, 15vw, 60px)` (≈ 56×78 ở 375 px,
  60×84 từ 400 px), xoay `−7°` / `+7°` (3 lá: −9°, 0°, +9°), lá sau chồng lên lá trước 14 px, tâm quạt ở tim màn hình, mép dưới
  quạt vượt mép dưới nỉ 30 px (nỉ thêm `padding-bottom` để pot không bị che). Lá Blind nặn (`PeelCard`) **không xoay** (cử chỉ
  kéo-lật đo tọa độ trên lá) nhưng rộng bằng lá mới; dải Lật giữ nguyên. Bài chung lên `clamp(40px, 11vw, 48px)`. Bài đối thủ
  giữ như nay. Gốc quạt mang `data-fan="2|3"`; peel mang `data-fan="none"`.
- **Dải tên của mình (R10)**, một hàng 44 px (56 px lúc lật bài), thay khối `.mine .seat` 2 hàng: đĩa avatar 36 px **có vòng đồng
  hồ lượt và chữ D** như nay (BP-30 vừa làm chibi sống, giữ mặt) · tên một dòng (ellipsis) · stack · **cược vòng này** (`.bet`,
  giữ) · chip "Chủ phòng" khi là chủ (bỏ chip "Bạn": dải này luôn là mình; bỏ danh hiệu ở stack) · huy hiệu hạng (`RankLabel`) ·
  trạng thái (Đã lật / Tất tay / Bỏ bài) khi có. Lúc lật bài, dòng hai: tên bài + `+payout` như nay. `data-me="true"`,
  `role`/tên không đổi (`Seat` vẫn là một `group` tên người chơi) để locator giữ nguyên.
- **Khay một hàng (R2), nút `size="md"` 44 px, khay nghỉ ≤ 64 px kể cả đệm 8/12:**
  - Hold'em, đến lượt: **Bỏ bài** · **Xem** hoặc **Theo N** · **Cược ▴** hoặc **Tố ▴** (vàng, `flex: 1.2`). Khi luật không cho chọn
    mức (chỉ còn tất tay để theo), nút thứ ba là **Tất tay** (không số, như nay).
  - Hold'em, chưa đến lượt: các công tắc chọn sẵn (Xem/Bỏ, Theo mọi mức, Bỏ bài) trong một hàng như nay; **dòng chờ** chỉ hiện
    khi không có công tắc nào (đã bỏ bài, tất tay, người xem), thay chỗ hàng nút, `role="status"` như nay.
  - Blind: **Tự động chơi** (ghost, `aria-pressed`, chỉ bàn chơi-hoặc-bỏ / nặn) · **Bỏ bài** · **Chơi N** (hoặc **Tất tay N**).
  - **Giữa các ván** (khi không có `hand` hoặc đang chờ ván): một **dock** một hàng 44 px thay khay: Sẵn sàng / Hủy sẵn sàng ·
    Bắt đầu (chủ phòng) · "N/M sẵn sàng · 0:12" (`role="status"`); dòng gợi ý đặt trên nỉ như landscape tầng thường. Người xem
    không có footer. Hàng `.controls` ("Điều khiển bàn") **bỏ** ở stack; tên group "Điều khiển bàn" chuyển sang dock (locator
    `group 'Điều khiển bàn'` của e2e vẫn tìm thấy Sẵn sàng / Bắt đầu).
  - **⋯ ở header** (không ở khay): Đứng dậy · Tạm nghỉ / Chơi tiếp (checkbox) · Quản lý bàn (chủ) · Toàn màn hình. Cùng
    `MenuButton` và cùng mục như landscape; `openRoomMenu` của e2e dùng được ở 375.
- **Mục tiêu đo được ở 375×812** (kịch bản e2e: 5 đối thủ, và kiểm thêm 8 đối thủ bằng playground): khay nghỉ ≤ 64 px; từ header
  tới mép dưới khay không cuộn; bài mình ≥ 52 px; `expectNoTextOverlap` xanh ở năm trạng thái (chờ, lượt tôi, bảng tố mở, kết
  quả, Blind nặn). Với 8 đối thủ (3 hàng chip) nỉ nhường chiều cao, bài vẫn ≥ 52 px và không cuộn.

### 3.2 Bảng tố: chip mốc + thanh kéo (R3, mọi khung)

Thay cho ô số, slider ẩn/hiện theo khung và hộp "Nhập số điểm":

- **Thanh kéo** là `<input type="range">` (một phần tử, không thư viện), `min` = `minRaiseTo` / `minBet`, `max` = `maxRaiseTo` /
  `maxBet`, **bước = blind nhỏ** (`rules.smallBlind`; nếu (max − min) / bước > 200 thì bước = `ceil((max−min)/200)` làm tròn lên
  bội của blind nhỏ); `max` luôn chọn được (giá trị cuối kẹp về `max`). Số tiền hiện trong nhãn bám nút kéo (`formatPoints`),
  `aria-valuetext` cùng chuỗi, `aria-label` = `labels.amountSlider`; nút kéo 28 px với vùng chạm 44 px. Bàn phím: ←/→ một bước,
  PageUp/PageDown 10 bước, Home/End = min/max; `R` mở bảng tố (đã có), Enter xác nhận, Esc đóng.
- **Chip mốc** (group "Mức cược", mỗi chip luôn có `aria-pressed` true/false): **Min** · **½ pot** · **Pot** · **Tất tay** (= `max`).
  Chuỗi `presets.half` vi "½ pot" / en "½ pot"; `presets.max` → `presets.allIn` dùng `actions.allIn`. Chip cao 36 px kể cả cảm ứng
  (ngoại lệ có chủ ý của luật ≥ 44 px, ghi vào SRS §27.1: chip là mốc nhảy, nút kéo và nút xác nhận mới là đích chạm). Bỏ
  `labels.amount`, `labels.amountDialog`, `AmountDialog.tsx`, nút ✎ và `SLIDER_STEPS`.
- **Tên truy cập:** tam giác ▴/▾ là glyph `aria-hidden`; tên nút là "Tố", "Cược", "Hủy"; nút xác nhận mang số: "Tố 48.000" /
  "Cược 2.000" (regex `/^Tố( |$)/` của L-04 vẫn đúng). **Chỉ có một nút "Tố…" trên màn ở mọi lúc.**
- **Hai bước hay một bước:**
  - stack và landscape: **hai bước**. Chạm "Tố ▴" → bảng tố: hàng chip 36 px, thanh kéo 44 px, hàng **Hủy ▾** (72 px rộng) +
    **Tố N** (≈ 150 px cả đệm); Bỏ bài và Xem/Theo **ẩn** khi bảng mở (bản phác v2). "Hủy ▾" hoặc Esc thu về một hàng. Ở landscape
    bảng tố thay chỗ **góc trái** (chip + thanh kéo + Hủy ▾), góc phải giữ Bỏ bài · Xem/Theo và nút "Tố ▴" **đổi thành** "Tố N" (vẫn
    một nút).
  - ring + desktop: **một bước**: chip + thanh kéo luôn hiện trên hàng nút khi được chọn mức (hàng `.sizer` hôm nay, không ô số).
- **Giá trị gửi** không đổi: `{ kind: 'raise' | 'bet', amount }` là tổng của vòng, kẹp trong `[min, max]`; "Tất tay" chip đặt thanh
  kéo về `max` rồi nút xác nhận gửi `raise`/`bet` với `max` (engine chấp nhận như tất tay). Không đổi engine hay giao thức.

### 3.3 Desktop và landscape

- **Desktop ring (P10, R4):** `.tray` và hàng `.controls` nhận `max-width: min(980px, 100%)`, căn giữa (bằng trần `.ring`), nên ở 1920
  khay rộng ≈ 980 px dưới nỉ ≈ 921 px. Hàng nút desktop giữ **Tất tay** ngoài, giữ hàng "Điều khiển bàn" phía trên; không thêm ⋯.
- **Landscape:** góc phải một hàng 48 px (Bỏ bài · Xem/Theo · Tố ▴ → Tố N), góc trái như nay (chọn sẵn / Tự động chơi) và thành bảng
  tố khi mở (3.2). Tất tay chỉ qua chip (không thêm mục ⋯). Tầng `short` (BP-28): chip 32 px, thanh kéo 36 px; kiểm ở 855×319 rằng
  bảng tố không chạm bài mình (L-06 mở rộng).

### 3.4 Chữ và tên (P1, P7)

- **P1:** sàn chữ trên bàn ở điện thoại là **11 px** (`0.6875rem`): `.othersChip .tags > *` và nhãn pot landscape (`:1065`) lên
  11 px; **`.othersChip .bet` lên 12 px** (`0.75rem`). `--plate-h` 54 → 58 px nếu cần; kiểm 375 / 390 / 915×412.
- **P7 (R8):** trên vòng ghế ở khung `desktop` rộng ≥ 1024 px, ghế rộng `max(15%, 132px)` (7+ ghế: `max(13%, 118px)`); tên vẫn
  **một dòng** (giữ `placeRank`), dòng danh hiệu của **người khác ẩn từ 7 ghế**; ghế của mình như nay. Kiểm: test đọc CSS raw cho
  hai giá trị; ảnh 1366×768 và 1920×940 với 9 ghế (`#worst/turn/9/vi/long`) + `expectNoTextOverlap`; nếu 9 ghế chạm nhau ở 1366,
  9 ghế giữ `13% / 94px` (ghi vào plan).

### 3.5 Thẻ kết quả ở 768 (P13, R7)

Kiểm ở 768×1024 (ring) và 390×844 với 6 người lật bài: lớp mờ `data-more` hiện khi còn hàng, thẻ ≤ 70 % màn, nút Đóng luôn thấy.
Chỉ sửa khi đo thấy sai; ghi kết quả vào plan. Không gói "và N người nữa".

### 3.6 Hạn mức Blind 10× (R5)

- `blindTableLimitMultiplier` 5 → **10**. Bot cũng nhận stack bằng hạn mức mới. Luật chơi tới 0, ngồi `min(số dư, L)`,
  `returnDeadExcess`, phí 0 **không đổi**. Không di trú. (Deploy là dừng cứng, phòng đang mở không tồn tại qua deploy.)
- Chuỗi: `create.tableLimitHint` vi "Hạn mức mỗi người: {{points}} (10× mức cược)", en "… (10× the wager)". `RoomHeader` tự in.
- Mã và test ghim 5× (đổi hết, cả tên test và chú thích "five wagers"): `core/src/constants/economy.test.ts:22`; `core/src/hand/blind.ts:20`
  (chú thích) và `blind.test.ts:43-47`; `server-kit/src/room/room.test.ts:108-122`, `room-hands.test.ts:84, 688-700, 792`,
  `gateway/gateway.test.ts:340`; `ui-kit/src/lobby/CreateRoomForm.test.tsx:62-68`; `ui-kit/src/screens/RoomScreen.test.tsx:415, 433,
  476-478, 947, 1180, 1242`; `ui-kit/src/table/Seat.tsx:392` (chú thích); `apps/normal-web/e2e/normal.spec.ts:62-65, 393, 438`;
  `apps/lite/e2e/lite.spec.ts:26-29, 297-298`; `apps/normal-web/e2e/ops/02-lobby-rooms.spec.ts:51-52, 67`; `04-blind.spec.ts:94,
  225, 247`.
- Tài liệu: `docs/player-guide.md` (33, 182, 194, 241–245 "bằng 10 lần mức cược (mức cược 1.000 thì hạn mức 10.000)", 254; và các
  dòng mô tả khay/slider/✎/Tự động chơi ở 27, 223, 333, 451 theo §3.1–3.2); SRS (216, §8.8, bảng hằng số 381, §27.1 theo §8 dưới);
  spec `2026-09-29-blind-table-limit-design.md` (ghi chú sửa đổi ở đầu); `docs/operation-test-plan.md` S-05, F-10, H-02 ("hạn mức
  250.000" → 500.000); `docs/known-limitations.md` (59, 78, 123, 272: chỉ sửa nếu có nêu bội số); `docs/ui-kit.md:242`,
  `docs/server-kit.md:251`.
- Bảo toàn điểm (`Σ balances + Σ sink`) đã có test; công thức không đổi.

### 3.7 Không làm

Sảnh chờ P3, Quản trị P5, nhãn hoa P8, emoji P9, "Lưu tên" P15, cửa hàng P16, theme sáng P22 (vòng sau). Không đổi engine, giao
thức, luật min-raise. Không thêm thư viện. Lite nhận cùng khay qua kit; vỏ Lite không đổi.

## 4. Kiểm thử

- **Unit (ui-kit):** `ActionBar.test.tsx` viết lại phần chọn tiền: không còn `spinbutton`; `slider` có `min/max/step/aria-valuetext`;
  chip Min/½ pot/Pot/Tất tay đặt đúng giá trị và `aria-pressed`; bàn phím ←/→/Home/End/PageUp; Enter gửi `{kind, amount}` đã
  kẹp; hai bước ở `layout='stack'` và `frame='landscape'` (Tố ▴ → bảng → Hủy ▾; đúng một nút /^Tố/), một bước ở ring desktop;
  Blind row với Tự động chơi; dòng chờ chỉ khi không có công tắc. `RoomScreen.test.tsx`: stack không có hàng "Điều khiển bàn"
  nhưng có dock cùng tên giữa ván, ⋯ ở header với đúng mục; desktop như nay. `Seat.test.tsx`/`PokerTable.test.tsx`: `data-fan`,
  góc xoay và `clamp` mới đọc raw CSS, peel `data-fan="none"`, dải tên 44 px với cược và D, 11/12 px, ghế `max(15%,132px)`.
  `geometry.test.ts` giữ. `core`: `economy.test.ts` 10, `blind.test.ts` ×10; `server-kit`: số mới; `CreateRoomForm.test.tsx`
  "(10× the wager)".
- **e2e Normal** (`normal.spec.ts`): `LIMIT = 10 * WAGER`; khối 375×812 đo khay ≤ 64 px lúc nghỉ, bài mình ≥ 52 px, năm trạng thái
  `expectNoTextOverlap`; Sẵn sàng / Bắt đầu qua dock; `sitOutAndPlay` qua `openRoomMenu` ở 375. Lite e2e `LIMIT` và @mobile qua dock.
- **Ops:** `autopilot` giữ (`button:not([aria-pressed])`; chip có `aria-pressed` nên không bị nhầm); `keepPlaying` giữ (Tự động chơi
  vẫn là button `aria-pressed`); L-04 viết lại (slider thay dialog: `fill` giá trị → "Tố 600"); L-06 thêm bảng tố mở ở 855×319;
  ca mới **M-01 @mobile** "khay một hàng và bảng tố: bài mình ≥ 52 px, khay ≤ 64 px, Tố ▴ mở thanh kéo, Hủy ▾ đóng, ⋯ ở header có
  Đứng dậy/Tạm nghỉ"; 02/04 số hạn mức mới. Ops 55 → 56; test-matrix +4 hàng (bố cục, thanh kéo, hạn mức 10×, M-01).
- **Ảnh chụp** (Playwright từ `apps/normal-web`): 375×812 (chờ, lượt tôi, bảng tố, kết quả, Blind nặn), 390×844, 915×412 và
  855×319 (bảng tố mở), 768×1024 (kết quả), 1366×768 và 1920×940 (khay 980 px, 9 ghế).

## 5. Rủi ro

- Thanh kéo trên cảm ứng: kéo mượt phụ thuộc trình duyệt; test CDP dùng bàn phím/`fill`; kéo tay thật là kiểm tay (iOS Safari,
  Firefox Android → known-limitations).
- Quạt bài đè mép nỉ đổi cách đo "bài mình trên khay" (`normal.spec.ts:676`): đo theo hộp bao của lá đã xoay.
- `ActionBar` nhận thêm `layout`; mọi chỗ render nó (RoomScreen, playground, test) phải truyền.
- Hạn mức 10× nhân đôi stack bot và tiền mang vào mỗi lần ngồi Blind: số dư người mới (100.000) vẫn đủ ở mức 5.000 (50.000); ở mức
  cao hơn server lấy `min(số dư, L)` như cũ.
- Ảnh chụp bàn thật cần tài khoản tạm (10 đăng ký/phút): một tài khoản cho cả loạt.

## 6. Ruling của phiên (người dùng duyệt khi đọc)

- **R1 Quạt bài:** Hold'em và Blind thường xòe quạt; bài nặn (`PeelCard`) không xoay. *Nếu sai:* thêm xoay cho peel ở vòng sau.
- **R2 Tất tay trên điện thoại là chip của bảng tố** (đặt thanh kéo về max rồi xác nhận); đứng ngoài hàng chỉ khi luật không cho
  chọn mức. Không có mục Tất tay trong ⋯. *Nếu sai:* trả về hàng chính.
- **R3 Bước thanh kéo = blind nhỏ, tối đa 200 bước.** *Nếu sai:* đổi hằng.
- **R4 Desktop ring giữ hàng "Điều khiển bàn" và Tất tay ngoài, không thêm ⋯.** *Nếu sai:* dùng cùng ⋯ như stack.
- **R5 Bot nhận hạn mức mới** (cùng công thức). *Nếu sai:* tách hằng cho bot.
- **R6 Hai bước ở stack và landscape, một bước ở ring desktop.** *Nếu sai:* một cờ.
- **R7 P13 là ca kiểm, không phải ca sửa** trừ khi đo thấy sai.
- **R8 Ghế desktop rộng hơn, tên một dòng, danh hiệu người khác ẩn từ 7 ghế;** 9 ghế giữ bề rộng cũ nếu không đủ chỗ.
- **R9 "Điện thoại" của khay = bố cục stack** (cùng query với `PokerTable`), đo ở `RoomScreen` và truyền `layout` xuống `ActionBar`;
  một cửa sổ 1366×600 vì thế là stack (hai bước). *Nếu sai:* thêm điều kiện `pointer: coarse`.
- **R10 Dải tên của mình giữ đĩa avatar + đồng hồ + D + cược, bỏ chip "Bạn" và danh hiệu ở stack.** *Nếu sai:* thêm lại chip.
- **R11 ⋯ ở header của stack (như landscape), dock giữa ván một hàng;** Tự động chơi ở lại khay Blind. *Nếu sai:* dời ⋯ xuống khay.
- **R12 Chip mốc 36 px kể cả cảm ứng** (ngoại lệ ghi vào SRS §27.1). *Nếu sai:* 44 px và bảng tố cao thêm 8 px.

## 7. Kiểm spec (2026-10-23)

Builder check (opus, đọc spec v1 đối chiếu mã) nêu 12 điểm; không điểm nào cần người dùng quyết. Đã trả lời trong spec v2:
(1) điều khiển bàn giữa ván → dock + ⋯ ở header (R11); (2) định nghĩa "điện thoại" → R9; (3) dải tên → R10; (4) landscape Tất tay
và một nút Tố → §3.2–3.3; (5) tên truy cập, `aria-pressed` cho chip, "½ pot" → §3.2; (6) chip 36 px, nút `md` 44 px (sửa số 48)
→ R12; (7) mục tiêu đo với 5 và 8 đối thủ → §3.1; (8) dòng chờ → §3.1; (9) bỏ xác nhận trong menu (không còn mục Tất tay);
(10) danh sách 10× đầy đủ, player-guide cả phần khay → §3.6; (11) P7 không còn tên hai dòng, kiểm bằng ảnh 9 ghế → R8;
(12) 12 px cho `.bet`, nhánh tạo từ `main` sau khi BP-30 merge (ops 55 → 56); sửa 56×78, Tất tay Hold'em không số, Q1, câu
"phòng đang mở".

## 8. Chữ mới cho SRS §27.1 (thay hai gạch đầu dòng "< 768 dọc" và "Điện thoại xoay ngang", và dòng "Lá bài")

- `< 768` dọc hoặc cửa sổ cao ≤ 620 (bố cục "stack", BP-31): lưới đối thủ trên cùng (chip từ 4 đối thủ, chữ ≥ 11 px); nỉ với bài
  chung `clamp(40px, 11vw, 48px)` và pot; **tay bài của mình xòe quạt** `clamp(52px, 15vw, 60px)` đè mép dưới nỉ 30 px (bài nặn
  không xoay); dải tên của mình 44 px (avatar với đồng hồ, tên, stack, cược, Chủ phòng, hạng); **khay một hàng 44 px**: Bỏ bài ·
  Xem/Theo · Cược ▴/Tố ▴ (Hold'em), Tự động chơi · Bỏ bài · Chơi N (Blind); chạm Tố/Cược mở **bảng tố** (chip Min · ½ pot · Pot ·
  Tất tay 36 px, **thanh kéo** bước blind nhỏ, Hủy ▾ + Tố N); không có ô nhập số ở bất kỳ khung nào. Giữa ván, một dock một hàng
  (Sẵn sàng / Hủy sẵn sàng, Bắt đầu, "N/M sẵn sàng", đồng hồ). Header gọn có ⋯ (Đứng dậy, Tạm nghỉ / Chơi tiếp, Quản lý bàn, Toàn
  màn hình). Nút ≥ 44 px trừ chip mốc 36 px.
- Điện thoại xoay ngang (Plan 26, BP-28): như trước, trừ khay: góc phải Bỏ bài · Xem/Theo · Tố ▴ (→ Tố N khi bảng mở), góc trái các
  công tắc chọn sẵn / Tự động chơi và, sau khi chạm Tố/Cược, **bảng tố** (chip + thanh kéo + Hủy ▾) thay cho Min · ½ · Pot · Max · ✎;
  không còn hộp "Nhập số điểm". Tất tay là chip của bảng tố.
- Desktop ≥ 1024 và tablet: khay và hàng điều khiển rộng tối đa 980 px, căn giữa; chip + thanh kéo luôn hiện khi được chọn mức
  (một bước); Tất tay ngoài hàng.
- Lá bài: đối thủ `clamp(26px, 6.4vw, 34px)`, mình ở ring `clamp(32px, 8vw, 46px)`, ở stack `clamp(52px, 15vw, 60px)`, bài chung
  `clamp(40px, 10.4vw, 62px)` (stack `clamp(40px, 11vw, 48px)`), landscape 60 px, tầng short 48 px.
