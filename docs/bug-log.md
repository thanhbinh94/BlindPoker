# Nhật ký lỗi và góp ý (giai đoạn test nội bộ)

Ghi nhận từ 2026-09-08. Chỉ sửa khi người dùng báo "fix". Trạng thái: `ghi nhận` → `sẽ sửa` → `đã sửa (commit)` / `không sửa (lý do)`.

## 1. Lỗi

| # | Ngày | Mô tả | Phân loại | Trạng thái | Ghi chú kỹ thuật |
|---|---|---|---|---|---|
| 1 | 2026-09-08 | Tạo phòng Blind với mức cược 5.000 nhưng các bot trong phòng hiển thị 1.000.000. | **Đúng thiết kế, nhưng gây hiểu nhầm (UX)** | đã sửa theo hướng (a) — `ee49ce6`, merge `55d4e32` | 1.000.000 là **số dư ảo của bot** (`botStartingBalance` trong `packages/server-kit/src/room/types.ts`, spec §8.5: bot bắt đầu 1.000.000, tự nạp lại khi < 2×cược, không tính vào kinh tế người chơi). "Wager 5,000" là mức cược cố định mỗi ván. Ba hướng đã nêu: (a) ẩn số dư của bot trên ghế, (b) số dư ảo = 50×cược, (c) hiện stack theo ván. Người dùng chọn (a). |
| 2 | 2026-09-08 | Tạo phòng rồi rời phòng, phòng vẫn còn trong sảnh (0/6, Waiting) chứ không bị xoá. (Người dùng gọi là "bug 1" trong lần báo thứ hai.) | **Đúng thiết kế: phòng trống được giữ 60 giây rồi mới đóng** | ghi nhận — chờ người dùng xác nhận có muốn đổi | Spec §11.1: `CLOSED` khi "trống 60 giây hoặc host đóng khi không có ván". Code: `Room.scheduleClose()` (`packages/server-kit/src/room/room.ts`) đặt hẹn giờ `emptyRoomCloseMs = 60_000` (`room/types.ts`) khi `humanCount === 0`; hết giờ mà vẫn trống thì `close('empty')`, `RoomManager.onClosed` xoá khỏi danh sách và `notify()` → gateway phát `ROOM_LIST` cho mọi người ở sảnh, thẻ phòng tự biến mất không cần tải lại. Lý do giữ 60 s: người rời nhầm hoặc rớt mạng có thể vào lại đúng phòng/mã. Nếu muốn đổi: (a) giữ nguyên, (b) đóng ngay khi người thật cuối cùng rời, (c) rút xuống 10–15 s, (d) giữ 60 s nhưng thẻ hiện "Đang đóng…" thay vì "Waiting". Nếu thẻ còn quá 60 s thì mới là lỗi thật — cần người dùng xác nhận. |
| 3 | 2026-09-08 | Nút Ready và Start cùng bật. Host chưa Ready mà bấm Start thì không có gì xảy ra (phòng 1 người + 5 bot, "5/6 ready"). | **Lỗi thật (server im lặng + client bật nút sai điều kiện)** | đã sửa — `347b971` | Client (`RoomScreen.tsx`) bật Start khi `readyCount ≥ 2`, nhưng đếm cả bot (bot luôn ready). Server (`room.ts` `startGame`) cũng chỉ kiểm `readySeats ≥ 2` rồi gọi `startHand`; `startHand` thấy mọi ghế đủ điều kiện đều là bot (`eligible.every(isBot)`) thì `toOpen()` và trả ACK — không lỗi, không ván. Cùng đường đi im lặng: host Ready nhưng không đủ tiền cược. Hướng sửa: server trả `NOT_ENOUGH_PLAYERS` rõ ràng khi không có người thật sẵn sàng/đủ điều kiện; client chỉ bật Start khi có ≥ 1 người thật sẵn sàng và tổng ≥ 2, kèm gợi ý "Bạn cần bấm Sẵn sàng trước". |
| 4 | 2026-09-08 (tôi phát hiện) | Sau khi deploy bản web mới, tab đang mở mà chuyển sang màn tải chậm (Inventory, Profile…) thì trắng màn hình, console: `Failed to fetch dynamically imported module …/assets/InventoryScreen-<hash>.js` (404). | **Lỗi thật (độ bền khi deploy)** | ghi nhận — chờ lệnh fix | Vite băm tên chunk; build mới xoá chunk cũ; tab cũ vẫn giữ `index.html` cũ và xin chunk theo hash cũ. Hướng sửa: (a) bắt lỗi tải chunk trong `lazy()` của `App.tsx` và tự tải lại trang một lần (đánh dấu trong sessionStorage để không lặp vô hạn); (b) thêm error boundary hiện "Có bản mới, tải lại" thay vì màn trắng; (c) server giữ chunk cũ thêm một thời gian (khó với static dir). Khuyên (a)+(b). Áp dụng cả Lite (cùng cơ chế lazy). |

### Nhật ký sửa

**Lỗi 1 — 2026-09-08 — hướng (a).**
- `packages/ui-kit/src/table/Seat.tsx`: ghế có `isBot` không vẽ dòng số dư (`seatStack`); tên, nhãn "Bot", tiền cược mỗi street, tiền thắng, huy hiệu trạng thái vẫn vẽ như cũ.
- `packages/ui-kit/src/screens/RoomScreen.tsx`: danh sách kick của host bỏ số dư với hàng bot.
- Áp dụng cả Hold'em lẫn Blind (số dư ảo của bot không có ý nghĩa ở mode nào). Số dư người chơi thật không đổi.
- Test: `PokerTable.test.tsx` (ghế bot không in "1,000,000", ghế người vẫn in "20,000"), `RoomScreen.test.tsx` (roster bot không in số dư). ui-kit 131 test xanh, lint và typecheck sạch.
- Đã build lại web Normal và khởi động lại host LAN (kit `deploy/normal-windows`, pid 15552). Kiểm trên host thật: phòng Blind cược 5.000 + 4 bot, ghế bot chỉ còn "Bot 1…4" và nhãn Bot.
- Bản Lite chưa nhận thay đổi (exe đóng gói web bên trong): cần `pnpm build:lite` khi phát hành Lite.

## 2. Góp ý / yêu cầu tính năng

| # | Ngày | Nội dung | Hiện trạng | Trạng thái | Hướng xử lý dự kiến (chưa làm) |
|---|---|---|---|---|---|
| F1 | 2026-09-08 | Thêm chế độ **auto-fold / auto-call** (check/fold, call any, fold to any bet…) như các game Hold'em thông thường. | **Chưa có.** Server chỉ tự fold khi hết giờ hoặc ghế được đánh dấu (`hand-runner.ts`); client chưa có nút "hành động trước" khi chưa tới lượt. Spec chưa đề cập. | đã sửa — `91ff741` | Client-side trước (đơn giản, không đổi protocol): thanh ActionBar hiện các ô tick "Check/Fold", "Call", "Fold" khi chưa tới lượt; tới lượt thì client tự gửi hành động tương ứng nếu vẫn hợp lệ (ví dụ "Check/Fold" gửi check nếu được, không thì fold; "Call" chỉ gửi nếu số cần call không đổi so với lúc tick, nếu tăng thì bỏ tick). Tick tự xoá sau mỗi street. Cần thêm i18n vi/en và test reducer. Với Blind Poker chỉ có Play/Fold nên có thể thêm "Tự động chơi" tương tự. Ước lượng: 1 task ui-kit. |
| F2 | 2026-09-08 | Chưa thấy phần **đăng nhập nhận quà hằng ngày**; đã có chưa? | **Đã có, nhưng không tự động khi đăng nhập.** Theo spec §13.1, người chơi phải bấm **Nhận** một lần/ngày (không tự phát). Normal: tab **Daily** trên thanh điều hướng (`#/daily`, `apps/normal-web/src/screens/DailyScreen.tsx`) hiện lịch 31 ngày, streak, nút Nhận; ngày 7/14/21/28 kèm item. Lite: cùng bảng điểm, không item (`apps/lite/server/src/economy/daily.ts`). | đã sửa theo (a) — `bdcfbdd` | Nếu muốn nổi bật hơn: (a) mở popup Daily ngay sau đăng nhập khi hôm nay chưa nhận, hoặc (b) chấm đỏ trên tab Daily khi còn quà. Chọn (a) hoặc (b) nếu cần. |
| F3 | 2026-09-08 | Khi vào bàn nên có **khung avatar** hiển thị cho mọi ghế, kể cả bot (avatar 2D, không phải 3D). | Hiện tại ghế có đĩa tròn 30 px: người thật hiện ảnh chân dung chụp từ avatar 3D (cache ảnh, không chạy 3D trên bàn), bot hiện một icon SVG chung, người chưa có avatar hiện chữ cái đầu. Không có "khung" rõ ràng và bot không có mặt riêng. | đã sửa theo hướng 1 — `9f46ea9` (tự đăng ảnh: roadmap, xem mục 3) | Đề xuất: (1) ui-kit vẽ khung avatar to hơn, cùng kích cỡ cho mọi ghế (ring ~44 px, stack ~36 px), viền vàng, nền tối; (2) thêm bộ avatar 2D cho bot (ví dụ 8 mặt robot/ký tự SVG, chọn theo tên bot để ổn định); (3) người thật giữ ảnh chân dung như hiện nay (đây là ảnh 2D đã render sẵn, không phải viewer 3D), người chưa có avatar dùng bộ avatar 2D mặc định thay vì chữ cái. Cần xác nhận: bạn muốn người thật cũng chuyển sang avatar 2D thuần (bỏ ảnh chân dung 3D trên bàn) hay chỉ thêm khung + mặt bot? |

### Nhật ký sửa (đợt 1, 2026-09-08)

**F3 — khung avatar + mặt bot 2D (`9f46ea9`).**
- `packages/ui-kit/src/table/BotFace.tsx`: 8 mặt robot SVG (hình đầu, kiểu mắt, màu, ăng-ten), chọn ổn định theo `playerId` của bot bằng FNV-1a. Xuất `BotFace`, `botFaceIndex`, `BOT_FACE_COUNT`.
- `Seat.tsx` + `table.module.css`: mọi ghế dùng chung một khung tròn viền vàng 2 px, cỡ 40 px (bàn 7–9 ghế: 32 px, dải đối thủ trên màn hẹp: 30 px); nội dung bên trong (ảnh app, mặt bot, chữ cái) được kéo đầy khung. Thuộc tính `data-face="bot|app|initial"` để test và debug.
- Normal: `TableChrome.makeAvatarFor` trả `null` cho bot (kit tự vẽ), người thật dùng `Portrait size="seat"` (kích thước 100% khung). Bỏ CSS mặt bot cũ trong `avatar.module.css`.
- Test: `BotFace.test.tsx` (ổn định theo seed, phủ đủ 8 mặt), `PokerTable.test.tsx` (ghế bot có `data-face="bot"` + svg, ghế người `initial`), `TableChrome.test.tsx` cập nhật.
- Đã kiểm trên host: phòng Blind 4 bot → 4 mặt khác nhau (index 1, 6, 3, 0), khung 40 px, ảnh chân dung của tôi đầy khung.

**F1 — hành động trước lượt (`91ff741`).**
- `packages/ui-kit/src/client/preaction.ts`: `PreActionKind = 'checkFold' | 'callAny' | 'fold'` và `resolvePreAction(kind, legal)` thuần: Check/Fold → check nếu được, không thì fold; Call any → call, hoặc check nếu không ai cược; Fold → fold, nhưng nếu check miễn phí thì check (không vứt bài khi không mất gì); `callAny` gặp thế chỉ còn all-in thì **không** gửi (tick tự huỷ, khay hiện lựa chọn thật). Không bao giờ gửi kind mà server không liệt kê.
- `types.ts`/`reducer.ts`: `state.preAction = { kind, handId } | null`, `state.autoPlay: boolean`. Reducer xoá tick khi: ván mới, street mới (chỉ khi còn ≥ 2 người có thể cược), chính mình vừa hành động, kết thúc/huỷ ván, snapshot, đứng dậy, rời phòng, phòng đóng. `autoPlay` tắt khi đứng dậy, ngồi ngoài, rời phòng, phòng đóng.
- `useGameClient.tsx`: khi khung `legal` của lượt mình tới, hook gửi đúng một `ACTION` theo tick (khoá theo identity của `legal` nên không gửi trùng); Blind play-or-fold: `autoPlay` gửi `play` cho mọi `DECISION_PHASE`. API mới: `setPreAction(kind|null)`, `setAutoPlay(on)`.
- `ActionBar.tsx`: khi chưa tới lượt, Hold'em hiện 3 nút bật/tắt (`aria-pressed`) "Check/Fold", "Call any", "Fold" (vi: "Xem/Bỏ", "Theo mọi mức", "Bỏ bài"); chỉ hiện cho ghế còn bài, chưa fold, chưa all-in. Blind play-or-fold hiện "Auto play" ("Tự động chơi") cả lúc chờ lẫn lúc đang quyết định. `RoomScreen` nối vào client. i18n `preActions.*` en/vi.
- Test: `preaction.test.ts` (bảng phân giải), `reducer.test.ts` (5 test xoá tick/autoPlay), `useGameClient.test.tsx` (4 test gửi tự động, không gửi trùng, tick huỷ, auto play qua nhiều ván), `ActionBar.test.tsx` (5 test hiển thị/ẩn/toggle).
- Đã kiểm trên host: bật "Auto play" trong phòng Blind → ghế tự "Decided" ngay và ở ván kế tiếp không cần bấm. Hold'em cần hai người thật nên chưa thử tay trên host; đã phủ bằng test hook.

**F2 — nhắc quà hằng ngày (`bdcfbdd`).**
- `apps/normal-web/src/daily-nudge.ts`: hook `useDailyNudge` gọi `GET /api/rewards/daily` khi đăng nhập (mỗi tài khoản một lần) và khi rời `/daily`. Nếu `claimable` và phiên bắt đầu ở route sảnh (`/`, `/lobby`, `/login`, `/register`) và localStorage `bp.dailyNudge` chưa ghi `nextResetAt` của ngày hôm nay → điều hướng sang `/daily` và ghi dấu. Deep link (`/room`, `/profile`, …) không bị chuyển hướng.
- `Shell.tsx` + `App.tsx`: chấm vàng trên tab Daily (thanh rail) và trên link Daily của thanh sảnh khi còn quà; văn bản ẩn cho screen reader `nav.dailyReady` ("Có quà chưa nhận"). Không tự nhận quà — vẫn phải bấm Nhận (spec §13.1).
- Test: `App.test.tsx` (+4: chuyển hướng một lần/ngày, không kéo lại khi đã nhắc, deep link giữ nguyên, không chấm khi đã nhận).
- Đã kiểm trên host: mở app với phiên còn hạn → vào thẳng `/daily`, chấm hiện trên tab, `bp.dailyNudge` ghi `1788886800000`; reload về `/lobby` không bị kéo lại.

**Chung:** đã build lại web Normal và khởi động lại host LAN (pid 18992). Bản Lite cần `pnpm build:lite` để nhận F1 và F3 (F2 chỉ Normal).

### Nhật ký sửa (đợt 2, 2026-09-08)

**Lỗi 3 — Start khi chưa Ready (`347b971`).**
- `packages/server-kit/src/room/room.ts`: `startGame` từ chối `NOT_ENOUGH_PLAYERS` khi không có ghế người thật nào sẵn sàng; `startHand` trả `boolean`, và `startGame` cũng từ chối khi ván không mở được (ví dụ host không đủ tiền cược) thay vì ACK im lặng. Auto-start không đổi.
- `packages/ui-kit/src/screens/RoomScreen.tsx`: Start chỉ bật khi ≥ 1 người thật sẵn sàng và tổng ≥ 2; gợi ý mới `room.startNeedsYou` ("Bạn cần bấm Sẵn sàng trước — ván cần ít nhất một người chơi không phải bot").
- Test: `room.test.ts` (+3: chỉ bot sẵn sàng → từ chối; host không đủ tiền → từ chối; host sẵn sàng → mở ván), `RoomScreen.test.tsx` (+1). Kiểm trên host: 3 bot + host chưa Ready → Start khoá kèm gợi ý; bấm Ready → 4/4, Start mở.

**Tủ đồ đầy đủ cho tài khoản test (`2ec4c84`).**
- `apps/normal-server/src/inventory/grant-wardrobe.ts` + `src/grant-wardrobe-cli.ts` → `dist/grant-wardrobe-cli.js` (entry esbuild thứ ba). Cấp mọi món catalogue cho một email, nguồn `dev-grant`, idempotent, `--dry-run`, chỉ cần `DATABASE_URL`. Test PGlite 3 ca; `test/build.test.ts` kiểm cả ba entry. Runbook `deploy/normal-windows/README.md` mục 9b.
- Đã chạy cho `neon.test@example.com` trên Neon: cấp 38, có sẵn 4, tổng 42/42; chạy lại cấp 0. `/api/me/inventory` trả 42 món. Sau khi catalogue chibi (CR1) thay thế, chạy lại lệnh này.

## 3. Roadmap (chưa làm)

| # | Nội dung | Ghi chú |
|---|---|---|
| R1 | Người chơi tự đăng ảnh đại diện (Normal) | Hệ con mới: giới hạn cỡ/loại, cắt và nén phía client (≈128×128 WebP < 40 KB), lưu Postgres, phục vụ qua API có cache, CSP, xoá khi xoá tài khoản, cơ chế báo cáo/ẩn ảnh. Cần spec riêng. |

## 4. Yêu cầu thay đổi (change requests)

| # | Ngày | Nội dung | Quyết định đã chốt | Trạng thái |
|---|---|---|---|---|
| CR1 | 2026-09-08 | Xây lại avatar theo hướng **chibi**. Khảo sát: không có bộ 3D chibi CC0 nào tách bộ phận (KayKit Adventurers, Kenney Mini là nhân vật nguyên khối; gói modular đều trả phí); 2D: DiceBear chỉ có mặt, Chibi-Character-Generator đã chết. Khuyến nghị và được chọn: **A+ — chibi 2D vẽ SVG lớp, tự xây**. | (1) 2D SVG lớp, một sprite dùng chung, tô màu bằng biến CSS, băm theo cấu hình; không WebGL, gỡ pipeline 3D. (2) Đặc điểm cơ thể miễn phí: thân, màu da, hình mặt, mắt, lông mày, mũi, miệng, má/tàn nhang; các kiểu mắt/miệng đặc biệt là **món sưu tầm** (cách thứ 2). (3) Đồ mặc qua inventory như hiện nay; vẽ lại 45 món + ~15 món mới. (4) **Outfit**: lưu tối đa 5 bộ có tên, bảng `avatar_outfits`. (5) Biểu cảm theo ván (6 mặt), chớp mắt, nhún; bot cũng chibi. (6) Tủ đồ xem trước trực tiếp, tab theo slot, độ hiếm. (7) Bước đầu: nhân vật mẫu + 5 món cho người dùng duyệt phong cách. (8) **Tài khoản admin/test phải có đầy đủ tủ đồ** để kiểm thử. | thiết kế 4 phần đã duyệt; spec `docs/superpowers/specs/2026-09-08-avatar-chibi-2d-design.md` chờ người dùng xem lần cuối → Plan 10 |

