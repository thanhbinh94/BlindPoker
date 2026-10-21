# Plan 26 — GM đợt 2, bàn chơi trên điện thoại nằm ngang, màn đăng nhập có tranh

Spec thiết kế, 2026-10-20. Bổ sung cho SRS `2026-09-04-bind-poker-design.md` (§13 điểm danh, §27 giao diện) và cho spec
GM đợt 1 `2026-10-18-gm-role-design.md`. Ba phần độc lập về mã nhưng đi chung một plan vì người dùng muốn "hoàn
thành đợt 2 trước rồi tính deploy sau" và sửa luôn các điểm layout đang sai trước lần deploy đó.

Nguồn: cuộc brainstorm 2026-10-19/20, bốn ảnh lỗi ở `others/review/20261019` (ghi ở `docs/bug-log.md` mục 8,
N1–N6), khảo sát app poker (tóm tắt ở bug-log mục 8), bản phác ở `.superpowers/brainstorm/1219-1792430589/content/`
(`landscape-layout-v3.html`, `auth-hero-compare.html`), tranh ở `assets/login-hero-src/2026-10-20-v2.png`, quy trình
tranh ở `docs/login-hero-art.md`.

## 1. Quyết định của người dùng (Q-table)

| # | Câu hỏi | Quyết định | Ngày |
|---|---|---|---|
| Q1 | GM mở thành tựu cho người chơi: có trả thưởng không? | **Trả đủ phần thưởng** như tự đạt (điểm, vật phẩm, danh hiệu), ghi sổ điểm với lý do riêng | 2026-10-19 |
| Q2 | "Đặt lại điểm danh" nghĩa là gì? | **Cho người chơi nhận lại lượt hôm nay**: lượt hôm nay mở lại, chuỗi ngày không đổi, **không cấp quà hai lần** | 2026-10-19 |
| Q3 | Lịch quà tháng sửa ở đâu? | **Lưu trong cơ sở dữ liệu**, tệp JSON hiện có là mặc định; GM sửa trên màn hình, không cần khởi động lại | 2026-10-19 |
| Q4 | Thống kê nguồn/bể theo ngày hiển thị thế nào? | **Bảng + thanh CSS** cho 7 và 30 ngày; không thêm thư viện biểu đồ | 2026-10-19 |
| Q5 | Bàn chơi trên điện thoại nằm ngang | Phương án **(a)**: một bố cục nằm ngang riêng; không vá tối thiểu, không chặn xoay | 2026-10-20 |
| Q6 | Bố cục nằm ngang cụ thể | **A** (ba nút ở góc phải dưới, ghế mình giữa đáy, menu ⋯ góc phải trên) + **C** (thẻ kết quả gọn ba hàng) | 2026-10-20 |
| Q7 | Sáu khuyến nghị kèm theo | **Làm hết sáu**: thiết kế cho 355 px cao + mục Toàn màn hình; nút trước ván ở góc phải dưới; bỏ thanh trượt cược trên điện thoại ngang; vùng bấm ghế 44 px; project `landscape` trong ops pack; sửa cuộn 11 px ở màn dọc và câu sai trong hướng dẫn chơi | 2026-10-20 |
| Q8 | Màn đăng nhập/đăng ký | Bố cục **A** (cột tranh trái, thẻ phải; điện thoại: băng tranh trên thẻ) với **tranh anime vẽ mới** thay cho ghép chibi; chọn bản **V2** ("Nặn bài") | 2026-10-20 |
| Q9 | Tải ảnh sinh từ ChatGPT | Cho phép tải cả vòng; tệp gốc ở `assets/login-hero-src/`, không vào git | 2026-10-20 |
| Q10 | "Đặt lại điểm danh" nghĩa là gì (sau kiểm spec, mục 8)? | **(b) Hoàn tác lượt hôm nay rồi cho nhận lại thật**: trừ lại điểm của lượt, thu lại món nếu còn, lùi chuỗi; người chơi nhận lại bình thường, ngày ngẫu nhiên rút lại | 2026-10-20 |
| Q11 | Sau spec | Viết plan chi tiết, thực thi (SDD), gate, merge, và **deploy lên VPS Vietnix** ngay trong đợt này | 2026-10-20 |

## 2. Phần A — GM đợt 2

Mọi hành động mới đi qua `requireGm`, ghi `gm_actions` trong cùng giao dịch với tác động của nó, có lý do bắt buộc
(hộp `ReasonDialog` hiện có), và hiện trong tab Nhật ký. `GM_ACTION_KINDS` thêm `unlock_achievement`, `reset_checkin`,
`set_gift_month`, `clear_gift_month`.

### A1. Mở thành tựu

- `POST /api/gm/players/:id/achievements/:achievementId/unlock` `{ reason }`.
- Dùng đúng đường mở của `AchievementService` qua một hàm `unlockWithin(tx, playerId, def, at)` được xuất ra từ
  service hiện có, để GM và tự đạt **chung một đoạn mã trả thưởng**: điểm qua `creditWithin` với `TxReason` mới
  `gm_achievement` (hoặc tái dùng `achievement` kèm `refId` `gm:<actionId>` — builder chọn, miễn sổ điểm phân biệt
  được GM mở với tự đạt), vật phẩm và danh hiệu như thường. Lưu ý từ kiểm spec: `UPDATE … WHERE unlocked_at IS NULL`
  hiện tại khớp 0 hàng khi người chơi **chưa có hàng** `player_achievements` (sẽ đọc nhầm thành `ALREADY_UNLOCKED`),
  nên đường GM phải **upsert** hàng trước (`onConflictDoUpdate` với `setWhere: isNull(unlockedAt)`), và phân biệt
  "0 hàng vì đã mở" với "0 hàng vì chưa có".
- Không ghi `progress` giả: `evaluate` ghi đè `progress` từ thống kê sống ở mỗi `STATS_UPDATED`
  (`achievement-service.ts:79-85`) nên giá trị GM đặt sẽ bị mất sau ván kế. Thay vào đó `AchievementsScreen` vẽ thanh
  đầy khi `unlockedAt !== null`, bất kể `progress`.
- Lỗi: `INVALID_ACHIEVEMENT` (id không có trong `data/achievements.json`), `ALREADY_UNLOCKED`, `TARGET_IS_LOCKED`
  như các hành động khác. Mở cho người đang bị khóa: từ chối (nhất quán với Plan 25 Ruling).
- Màn hình: trong `PlayerDetail` thêm hành động "Mở thành tựu" → hộp chọn thành tựu (danh sách định nghĩa, mục đã
  mở hiện mờ và không chọn được) + lý do. Thông báo tới người chơi qua `GM_NOTICE` hiện có với bản vi/en.
- Bảo toàn: `Σ balances + Σ sink rows` không đổi (điểm thưởng là nguồn, ghi như mọi nguồn); test bảo toàn mở rộng.

### A2. Đặt lại điểm danh (Q2)

- `POST /api/gm/players/:id/checkin/reset` `{ reason }`. Chỉ hợp lệ khi `last_claim_date` = hôm nay (múi giờ kinh tế,
  `dayKey(now, tz)`); nếu không: `NOT_CLAIMED_TODAY`.
- Tác động trong một giao dịch: `last_claim_date` ← hôm qua, `streak` ← `streak − 1`, `claimed_days` ←
  `claimed_days − 1` (không âm). Lần nhận lại sẽ tính `nextStreak` ra đúng chuỗi cũ, nên **chuỗi ngày không đổi**.
- **Sự thật từ kiểm spec:** `claimDaily` ghi sổ điểm, cấp món và cập nhật `daily_logins` trong **một giao dịch**
  (`economy-service.ts:246-279`), nên mọi hàng có `last_claim_date = hôm nay` đều đã có quà. `creditWithin` không
  dùng `ledger_keys` (chỉ `apply(…, key)` mới dùng, và bảng đó bị dọn mỗi lần khởi động), `ref_id` chỉ có chỉ mục,
  không unique. Vì vậy "không cấp quà hai lần" phải là **một truy vấn tường minh** `point_transactions` theo
  `ref_id = daily:<playerId>:<today>` trong giao dịch của lần nhận lại, không phải khóa idempotency.
- **Hệ quả:** một "đặt lại" chỉ mở lại ô hôm nay sẽ không bao giờ trả gì. Người dùng chọn **(Q10, b): đặt lại =
  hoàn tác lượt hôm nay rồi cho nhận lại thật.** Trong một giao dịch:
  1. Tìm các hàng `point_transactions` của lượt hôm nay: `ref_id = daily:<playerId>:<today>` (điểm của tier, và
     điểm dự phòng `NO_ITEM_FALLBACK_POINTS` nếu có). Không có hàng nào → `NOTHING_TO_UNDO`.
  2. Trừ lại đúng tổng đó bằng một hàng sổ điểm lý do `gm_checkin_undo`, `refId = gm:<actionId>`; nếu số dư hiện
     tại nhỏ hơn → từ chối `INSUFFICIENT_BALANCE` (GM có thể "Cộng điểm" trước rồi đặt lại, hoặc thôi). Bảo toàn: hàng
     hoàn tác tính như một bể trong `Σ balances + Σ sink rows`; test bảo toàn mở rộng.
  3. Thu lại món của lượt đó: tìm `inventory` theo `ref`/nguồn `daily:<playerId>:<today>` (builder kiểm cột ghi
     nguồn cấp món; nếu chưa có thì `0005` thêm cột `source text` cho món mới cấp và lượt cũ không thu lại được,
     ghi known-limitations). Món đang mặc thì gỡ khỏi bộ đồ đang mặc trước khi xóa.
  4. `last_claim_date` ← hôm qua, `streak` ← `streak − 1`, `claimed_days` ← `claimed_days − 1`, và
     `stats.totalLoginDays` ← `− 1` (để lần nhận lại không đếm ngày hai lần; thành tựu `login_days_*` đã mở thì
     không thu lại — ghi known-limitations).
  5. Ghi `gm_actions` `reset_checkin` với `details: { previousStreak, previousLastClaimDate, undone: { points,
     itemId } }`, `amount` = số điểm trừ.
- Lần nhận lại chạy `claimDaily` bình thường: cùng tier, điểm như cũ, ngày ngẫu nhiên **rút lại** (loại trừ món đã
  có như thường), `DAILY_CLAIMED` phát như một lượt mới. Không còn khái niệm `alreadyPaid`.
- Phía web của người chơi **không cần đổi gì để nút Nhận quay lại**: nút theo `status.claimable` của server
  (`GET /api/rewards/daily`, `DailyScreen.tsx:303`); `markClaimedToday()` chỉ tắt chấm nhắc trong bộ nhớ, và khóa
  `localStorage` duy nhất là `bp.dailyNudge` cho lần chuyển hướng mỗi ngày. Thông báo `GM_NOTICE` cho người chơi:
  "Lượt điểm danh hôm nay đã được mở lại" (vi/en).
- Màn GM: trong `PlayerDetail`, hành động "Đặt lại điểm danh" chỉ bật khi hồ sơ cho thấy đã nhận hôm nay; hộp lý do
  nêu rõ số điểm sẽ trừ và món sẽ thu (đọc trước từ `GET /api/gm/players/:id/checkin`), để GM biết trước khi bấm.

### A3. Lịch quà tháng trong cơ sở dữ liệu (Q3)

- Migration `0005_gift_months`: bảng `gift_months(month text primary key /* YYYY-MM */, days jsonb not null,
  updated_at timestamptz not null, updated_by uuid null references users(id) on delete set null)`. `days` là đúng
  hình dạng một mục `months[YYYY-MM]` của `data/daily-gifts.json`.
- `GiftScheduleStore` (`economy/gift-schedule-store.ts`): `current()` trả `DailyGiftSchedule` dựng từ **tệp JSON
  làm mặc định** (`default` và `months` của tệp) **phủ bởi** các hàng trong bảng (hàng bảng thắng tệp cho cùng tháng);
  `listMonths()`, `setMonth(month, days, actor)`, `clearMonth(month, actor)`. Mọi ghi đều dựng ứng viên đầy đủ và
  chạy qua đúng bộ kiểm của `loadDailyGifts`/`parseDailyGifts` (id phải có trong catalogue, tier trong `MAX_STREAK`
  và trong số ngày của tháng); hỏng thì từ chối với thông báo của bộ kiểm, không ghi.
- `app.ts` không giữ lịch cố định từ lúc khởi động nữa: `EconomyService` nhận `schedule: () => DailyGiftSchedule`
  và đọc mỗi lần cần; store hoán đổi bản đã cache **sau commit**. `fixedItemIds()` (danh sách món không được rút
  ngẫu nhiên) tính trên bản hợp nhất.
- Quy tắc sửa: từ chối tháng đã qua (`MONTH_IN_PAST`); tháng hiện tại chỉ cho đổi các tier có số **lớn hơn** ngày
  hôm nay trong tháng (tier k không thể được nhận trước ngày k, nhưng tier bằng hôm nay có thể đã được một người
  chuỗi hoàn hảo nhận rồi — Ruling R7). Kiểm bằng dữ liệu claim thật là quá tốn, không làm.
- API: `GET /api/gm/gifts` (mặc định từ tệp + các tháng đã ghi đè, có cờ `source: 'file' | 'db'` từng tháng),
  `PUT /api/gm/gifts/:month` `{ days, reason }`, `DELETE /api/gm/gifts/:month` `{ reason }` (quay về mặc định).
- Màn hình: tab mới **Quà tháng** trong `#/gm`: chọn tháng (hiện tại + 12 tháng tới), lưới 31 ô tái dùng lịch của
  `DailyScreen` để xem trước (ô theo tier, món hiện icon như Điểm danh), bấm ô để đổi quy tắc (cố định: chọn món từ
  catalogue; ngẫu nhiên: giữ), nút Lưu (có lý do) và "Về mặc định". Ô của ngày đã qua trong tháng hiện tại bị khóa.
- Thông báo quà mới (`noticesFrom`) và màn Điểm danh của người chơi đọc lịch hợp nhất nên tự đúng.
- Tài liệu: `docs/normal-server.md` "Changing the daily gifts" đổi: tệp JSON là mặc định, GM sửa trên màn hình; cách
  cũ (sửa tệp + khởi động lại) vẫn hoạt động cho mặc định.

### A4. Thống kê nguồn/bể theo ngày (Q4)

- `GET /api/gm/stats/daily?days=7|30` → `[{ day: 'YYYY-MM-DD', sources: {reason: amount…}, sinks: {reason: amount…},
  net }]`, tính bằng một truy vấn gộp trên `point_transactions` với `(created_at at time zone $tz)::date`, `tz` là
  múi giờ kinh tế (cùng múi của ngày điểm danh). Thêm chỉ mục `point_transactions(created_at)` trong `0005` (hiện
  chỉ có `(player_id, created_at)` và `(reason, created_at)`, `schema.ts:108-109`). Server chưa dùng `AT TIME ZONE`
  ở đâu và unit test chạy trên PGlite: **kiểm sớm** PGlite hiểu tên múi giờ IANA của kinh tế; nếu không thì gộp
  theo ngày trong JS từ các hàng đã lọc theo khoảng.
- Màn hình: trong tab Tổng quan, khối "Theo ngày" với công tắc 7/30, bảng mỗi ngày một hàng (ngày, nguồn, bể, ròng)
  và một thanh CSS hai màu (nguồn vàng, bể đỏ) tỉ lệ theo giá trị lớn nhất của khoảng; số qua `formatPoints`, ngày
  qua `formatDay`. Không thư viện mới.

### A5. Kiểm thử phần A

- Unit: unlock qua GM trả đủ thưởng và chỉ một lần (kể cả khi chưa có hàng tiến độ); reset từ chối khi chưa nhận
  hôm nay và khi số dư không đủ; reset trừ đúng điểm, thu đúng món, lùi chuỗi và `totalLoginDays`; nhận lại sau
  reset cho đúng chuỗi cũ, điểm cũ, rút lại ngày ngẫu nhiên; bảo toàn `Σ balances + Σ sink rows` qua reset + nhận
  lại; store hợp nhất tệp + bảng, từ chối tháng quá khứ và ứng viên hỏng; `claimDaily` thấy lịch mới ngay sau
  `setMonth`; `sumsByDay` cắt đúng ranh giới ngày theo múi giờ.
- Guard: bộ test 15 tuyến của Plan 25 mở rộng cho mọi tuyến mới (401/403 không phải GM).
- Ops: thêm một ca `Q-03` (GM mở thành tựu, đặt lại điểm danh, đổi quà của một tháng tới, người chơi thấy ở Điểm
  danh); tạo tài khoản chỉ qua `newPlayer`/`registerPatiently`.

## 3. Phần B — Bàn chơi trên điện thoại nằm ngang (Q5–Q7)

### B1. Khi nào bật

- CSS: `@media (orientation: landscape) and (max-height: 500px)`; JS: cùng chuỗi qua `useMediaQuery`, tên
  `LANDSCAPE_PHONE`, được ưu tiên trước `STACKED`. Không ràng buộc `pointer: coarse` để kiểm được bằng cửa sổ
  máy tính thu nhỏ (Ruling R1). Bàn phím ảo mở ở màn dọc có thể làm viewport "ngang" ngắn: ở màn bàn chơi không có
  ô nhập nào ngoài ô cỡ cược, chấp nhận.
- Mục tiêu đo: **915×355** (Chrome Android còn thanh địa chỉ), 915×412, 844×390 (iPhone). Máy tính và điện thoại dọc
  giữ bố cục hiện có.

### B2. Khung trang

- `.room` trong chế độ này: `height: 100dvh` (dự phòng `100vh`), **bỏ `min-height: 30rem`**, `overflow: hidden`,
  `overscroll-behavior: none`, đệm `env(safe-area-inset-left/right)`; `index.html` đã có `viewport-fit=cover`.
  Không có cuộn trang, không có cuộn trong `.roomMain`.
- Header hiện có ẩn (`RoomHeader` không render ở chế độ này) và **hàng nút phòng ở chân trang** (`.controls` trong
  `RoomScreen.tsx:269-319`, nơi thật sự chứa Đứng dậy, Tạm nghỉ, Quản lý bàn, Sẵn sàng, Bắt đầu và dòng gợi ý) không
  render ở dạng hàng. Thay bằng:
  - **Dải mỏng góc trái trên** (cao ≤ 28 px): chấm kết nối + "Trực tuyến"/"Đang kết nối lại", tên phòng, chế độ và
    mức cược rút gọn.
  - **Góc phải trên:** nút "Rời phòng" (giữ nguyên tên, hành vi xác nhận như cũ) và nút menu ⋯ (`aria-label`
    "Thêm") mở một bảng nhỏ gồm, đúng tên cũ: Đứng dậy, Tạm nghỉ / Chơi tiếp, Quản lý bàn, Mời ra (chủ phòng), và
    **Toàn màn hình** / Thoát toàn màn hình chỉ khi `document.fullscreenEnabled` (iPhone không có → ẩn, Ruling R3).
    Các nút trong menu là `button` thật với đúng nhãn để e2e và người đọc màn hình dùng được.
- Banner "Đang kết nối lại" nằm đè dưới dải trên, không đẩy bố cục.

### B3. Bàn và ghế

- Dùng bố cục **elip** (`.ring`) với kích thước theo chiều cao còn lại: sân khấu = viewport − dải trên − vùng nút
  (xem B4); `aspect-ratio` giữ 2:1 nhưng **chiều cao thắng**: khi rộng thiếu thì giảm cả hai và cập nhật
  `geometry.ts` để vị trí ghế tính theo hộp thật (sửa luôn caveat "hộp không còn 2:1" của bố cục hiện tại).
- Ghế đối thủ: huy hiệu gọn (avatar 30 px, tên 0,75rem, stack, hai lá úp 20×28 px, chip cược nhỏ), `--seat-min`
  94 px, **vùng bấm ≥ 44 px** (đệm trong suốt quanh plate; tap mở đúng việc như hiện tại). 7–9 ghế: như quy tắc dày
  hiện có (ẩn danh hiệu từ 7).
- Ghế mình: giữa đáy, plate đè mép dưới của nỉ, bài mình cỡ `md` (≥ 50×70 px), hàng nhãn (Bạn, Chủ phòng, Đã chọn,
  chip cược) ngay dưới plate và **luôn trong vùng nhìn** (sửa N4). Bàn nặn bài: lá nặn và pill "Lật" giữ nguyên cơ
  chế, kích thước lá ≥ 60 px rộng để kéo được.
- Bài chung và pot ở tâm elip; đồng hồ lượt giữ vòng quanh ghế đang đi.

### B4. Vùng nút (bố cục A)

- **Góc phải dưới** (`position: absolute`, không `sticky`): một hàng nút 48 px cao: Bỏ bài (đỏ) · Xem/Theo (xanh
  ngọc) · Cược/Tố (vàng); Blind Poker: Bỏ bài · Chơi N. Trên hàng đó, hàng cỡ cược 30 px: `½ pot`, `Pot`, `Tất tay`,
  và nút ✎ mở **ô nhập số trong một hộp thoại nhỏ** (`Modal` hiện có, `position: fixed`, neo trên cùng) thay vì ô
  nội tuyến: bàn phím ảo trên Chrome Android thu viewport 412 px còn ~200 px và trang không cuộn, nên ô nội tuyến ở
  góc dưới sẽ nằm dưới bàn phím (Ruling R11). Không thanh trượt (Q7); các nút đặt sẵn tái dùng `.preset` và logic
  hiện có.
- **Góc trái dưới:** các công tắc trước lượt (Xem/Bỏ, Theo mọi mức) và **Tự động chơi** dạng pill 34 px, đúng tên và
  `aria-pressed` như cũ.
- **Trước ván** (chưa chia bài): góc phải dưới giữ Sẵn sàng / Hủy sẵn sàng / Bắt đầu / Mang vào và dòng gợi ý ngắn
  (Q7 mục 2); Đứng dậy, Tạm nghỉ, Quản lý bàn chỉ còn trong menu ⋯.
- Giữa hai lượt vùng nút giữ chỗ (không nhảy bố cục) như hành vi "giữ chỗ" hiện tại của khay.

### B5. Thẻ kết quả gọn (C) và sửa gốc N3

- Sửa gốc cho **mọi bố cục**: `.resultLive` đã có `min-height: 0` (`table.module.css:1292`) nhưng thiếu
  `overflow: hidden`, và `.resultHead` thiếu `flex-shrink: 0`; thêm hai thứ đó, giữ `.result` là cột flex, và cho
  `.resultFoot` `flex-shrink: 0` để phần trên không bao giờ vẽ đè lên nó (phần co duy nhất là `.resultBody`, đã cuộn).
  `seat-clearance.ts` khi sân khấu thấp hơn `MIN_CARD` thì không trả `null` nữa mà trả 0 (thẻ được cả sân khấu).
- Ở chế độ ngang: thẻ rộng tối đa 560 px, ba hàng: tiêu đề "Người thắng" + Đóng; danh sách người thắng cuộn trong
  hàng giữa; chân thẻ một dòng: Phí bàn · Hoàn cược dư · **Ván tiếp theo sau N giây** đẩy phải. Chữ không bao giờ đè
  chữ (`expectNoTextOverlap`).

### B6. Màn dọc: hai khoản nợ (Q7 mục 6)

- Bàn nặn bài "chơi hoặc bỏ" ở 375×812 cuộn 11 px (known-limitations): header ba dòng và hàng pill "Lật". Sửa: huy
  hiệu "Nặn bài" đứng cùng dòng với mã phòng ở < 480 px (rút gọn mức cược), pill "Lật" đè lên bài (`position:
  absolute`) thay vì giữ hàng riêng. F-12 mở rộng cho bàn "chơi hoặc bỏ" và ca này rời khỏi known-limitations.
- `docs/player-guide.md` dòng "xoay ngang thì bàn trở lại hình bầu dục thu nhỏ" trở thành đúng; viết lại câu theo
  bố cục mới (nút ở góc phải dưới, menu ⋯).

### B7. Kiểm thử phần B

- Ops pack thêm project **`landscape`**: 915×412, `hasTouch`, `isMobile`, `deviceScaleFactor: 2.6`, tiêu đề gắn
  `@landscape`; các ca: Hold'em chờ ván, đến lượt với cỡ cược, thẻ kết quả, bàn nặn bài (kéo lá bằng `touchDrag`),
  menu ⋯ và Rời phòng. Mỗi ca `expectRoomFits` (không cuộn trang và `main`) và `expectNoTextOverlap`.
- Một lần đo thêm ở 844×390 và 915×355 (đặt viewport trong ca) cho ca "đến lượt".
- `normal.spec.ts` thêm `expectRoomFits` ở 915×412 cho các trạng thái đã có ở 375×812.
- Playground: `#worst` nhận thêm trạng thái `blindS` (nặn bài) để chụp nhanh; ảnh 1920×940, 1366×768, 375×812,
  915×412 kèm mỗi task UI.

### B8. Tài liệu phần B

SRS §27.1 sửa dòng "< 768 ngang" thành mô tả B1–B5; `docs/ui-kit.md` "Responsive rules"; `docs/known-limitations.md`
bỏ mục cuộn 11 px, thêm: khóa xoay màn hình không làm (iOS), bàn phím ảo ở màn dọc; `docs/test-matrix.md` thêm hàng
cho project `landscape`; `CLAUDE.md` §3 cập nhật số ca ops; glossary giữ nguyên các từ ổn định.

## 4. Phần C — Màn đăng nhập/đăng ký (Q8–Q9)

### C1. Bố cục A

- **≥ 1024 px rộng:** hai cột. Cột trái (khoảng 62 % rộng, tràn tới mép trái và đáy) là tranh `hero` phủ `cover`,
  neo `background-position` ở 42 % 50 %, phủ dốc tối sang nền ở 30 % mép phải và 18 % mép dưới; góc trái dưới có
  tiêu đề "Blind Luck Poker" (Fraunces) và một câu dẫn ngắn (chuỗi mới `auth.heroLead`, vi/en, en chỉ dịch). Cột
  phải là thẻ `authCard` hiện có; nút ngôn ngữ dưới thẻ như cũ. **Một `<h1>` duy nhất tại một thời điểm** (Ruling
  R10): ở ≥ 1024 px tiêu đề và câu dẫn trong thẻ ẩn (`display: none`), cột tranh mang `<h1>` và câu dẫn; dưới 1024
  px ngược lại. Playwright bỏ qua phần tử ẩn nên `getByRole('heading', { name: 'Blind Luck Poker' })` ở
  `e2e/support.ts:150` và `ops/01-accounts.spec.ts:22` vẫn khớp đúng một. Kiểm 1920×940 và 1366×768.
- **< 1024 px:** một cột: băng tranh cao 300 px trên cùng (`background-size` 160 %, neo 34 % 28 % để lấy cụm ba
  khuôn mặt), thẻ đè lên 50 px cuối băng, nút ngôn ngữ dưới cùng. Kiểm 375×812 và 320 px (không cuộn ngang).
- Giao diện sáng: cột/băng tranh giữ tông đêm (`data-surface="night"`), thẻ theo giao diện. Giảm chuyển động: không
  có chuyển động nào (không Ken Burns, Ruling R4). Người đã đăng nhập không thấy màn này (giữ nguyên).
- Lite không đổi (`NamePrompt` riêng).

### C2. Tài sản

- Nguồn: `assets/login-hero-src/2026-10-20-v2.png` (1536×1024, gitignored, nhật ký ở `docs/login-hero-art.md` §7).
- Xuất: `apps/normal-web/public/login/hero-1536.webp` (q82, mục tiêu ≤ 250 KB) và `hero-768.webp` (≤ 90 KB) bằng
  `sharp` đã có trong devDependencies của pipeline avatar (builder kiểm; nếu không có thì script một lần bằng
  `squoosh-cli`, không thêm dependency runtime). `<img srcset>` hoặc `image-set()`, `fetchpriority="high"`,
  `decoding="async"`, `alt=""` (trang trí; nội dung đã có trong chữ).
- CSP `img-src 'self' data: blob:` hiện có đủ. Không chữ trong tranh; mọi chữ do giao diện in.

### C3. Kiểm thử phần C

- e2e: tab "Đăng nhập"/"Đăng ký" vẫn một dòng (test hiện có); thêm `expectNoTextOverlap` cho màn đăng nhập ở
  1920×940, 1366×768, 375×812; tranh tải được thật (`naturalWidth > 0`) ở hai cỡ; 320 px không cuộn ngang.
- Ảnh chụp ba cỡ kèm task.

### C4. Tài liệu phần C

`docs/normal-web.md` mục màn đăng nhập (mới); `docs/known-limitations.md` mục tranh AI: thêm tranh đăng nhập cùng
điều khoản; `docs/login-hero-art.md` là quy trình; `docs/copy-review-2026-10-10.md` thêm chuỗi `auth.heroLead`.

## 5. Không làm trong đợt này

- Khóa xoay màn hình (`screen.orientation.lock`: iOS không có; Chrome chỉ khi toàn màn hình).
- Đổi bản dọc sang kiểu một tay như GGPoker (chưa có báo cáo lỗi; bản dọc đã có test).
- Thanh trượt cược trên điện thoại ngang (dùng đặt sẵn + ô nhập).
- Nhiều tranh đăng nhập xoay vòng, tranh cho Lite, hoạt ảnh chớp mắt.
- GM đặt lại điểm danh cho ngày khác hôm nay; GM sửa `default` của lịch quà trên màn hình (vẫn qua tệp).

## 6. Rủi ro

- Bố cục ngang mới chạm `PokerTable`, `Seat`, `ActionBar`, `RoomHeader`, `HandResult`, `RoomScreen`: nguy cơ hồi
  quy ở máy tính và màn dọc. Giảm bằng: mọi quy tắc mới trong một khối `@media` riêng đặt **sau** quy tắc gốc, JS rẽ
  nhánh theo `LANDSCAPE_PHONE`, và bộ ops hiện có (desktop + mobile) chạy đủ.
- Chuyển lịch quà sang đọc mỗi lần: nguy cơ cache cũ hoặc đọc giữa chừng. Giảm bằng hoán đổi tham chiếu sau commit
  và test "claim thấy lịch mới".
- Đặt lại điểm danh sai múi giờ ngày. Giảm bằng dùng cùng `dayKey(now, tz)` với `claimDaily` và test ranh giới.
- Tranh 1536 px nặng trên 3G: hai cỡ WebP và `srcset`; nếu vẫn > 250 KB thì hạ q xuống 76 trước khi cắt cỡ.
- Thuật ngữ ổn định: "Rời phòng", "Tạm nghỉ", "Quản lý bàn", "Tự động chơi", "Người thắng"… giữ nguyên chữ, chỉ đổi
  chỗ đứng.

## 7. Ruling của phiên (người viết spec quyết, người dùng duyệt khi đọc)

- **R1** Điều kiện bật chế độ ngang là `orientation: landscape` và cao ≤ 500 px, không cần `pointer: coarse`, để
  kiểm được trên máy tính. *Nếu sai:* cửa sổ máy tính rất thấp cũng vào bố cục điện thoại; chấp nhận.
- **R2** "Rời phòng" vẫn là nút thấy được ở góc phải trên (không giấu vào menu) vì là hành động có xác nhận và là
  từ ổn định của e2e. *Nếu sai:* thừa một nút 34 px ở góc.
- **R3** "Toàn màn hình" chỉ hiện khi `document.fullscreenEnabled`; không nhắc người dùng xoay máy.
- **R4** Không hoạt ảnh trên màn đăng nhập (kể cả Ken Burns); tranh tĩnh.
- **R5** Điểm gãy hai cột của màn đăng nhập là 1024 px (khớp bố cục elip đầy đủ của SRS §27.1).
- **R6** Tên hành động nhật ký: `unlock_achievement`, `reset_checkin`, `set_gift_month`, `clear_gift_month`; lý do
  sổ điểm cho thưởng GM mở phân biệt được với tự đạt.
- **R7** Sửa lịch quà: từ chối tháng đã qua; tháng hiện tại chỉ đổi được các tier có số lớn hơn ngày hôm nay.
- **R8** Múi giờ của thống kê theo ngày là múi giờ kinh tế của điểm danh.
- **R9** (thay bằng Q10 b) Hoàn tác trừ đúng số điểm của lượt, từ chối khi số dư không đủ thay vì cho âm; món của
  lượt cũ không truy được nguồn thì không thu lại và ghi known-limitations.
- **R10** Màn đăng nhập chỉ có một `<h1>` tại một thời điểm: cột tranh ở ≥ 1024 px, thẻ ở dưới đó.
- **R11** Ô nhập cỡ cược trên điện thoại ngang mở trong hộp thoại nhỏ neo trên cùng, vì bàn phím ảo che góc dưới
  của một trang không cuộn. Trường hợp bàn phím ảo làm màn dọc thành "ngang thấp" ghi vào known-limitations.

## 8. Kiểm spec (2026-10-20)

Một kỹ sư độc lập (subagent) đọc spec và đối chiếu mã. Các sai lệch đã sửa vào thân spec: `claimDaily` ghi quà trong
cùng giao dịch và không dùng `ledger_keys` (A2); `DAILY_CLAIMED` chỉ có `stats-service` nghe (A2); nút Nhận theo
server, không theo `localStorage` (A2); đường dẫn `GET /api/rewards/daily` (A2); `progress` bị `evaluate` ghi đè và
UPDATE khớp 0 hàng khi chưa có hàng (A1); các nút phòng nằm ở chân trang, không ở header (B2); `.resultLive` đã có
`min-height: 0` (B5); chỉ mục `created_at` chưa có (A4). Câu hỏi còn lại cho người dùng: Q10 (ý nghĩa "đặt lại điểm
danh"). Các câu hỏi khác đã thành R10, R11 và quy tắc "lớn hơn hôm nay" của R7.
