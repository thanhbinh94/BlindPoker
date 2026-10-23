# Nhật ký lỗi và góp ý (giai đoạn test nội bộ)

Ghi nhận từ 2026-09-08. Chỉ sửa khi người dùng báo "fix". Trạng thái: `ghi nhận` → `sẽ sửa` → `đã sửa (commit)` / `không sửa (lý do)`.

## 1. Lỗi

| # | Ngày | Mô tả | Phân loại | Trạng thái | Ghi chú kỹ thuật |
|---|---|---|---|---|---|
| 1 | 2026-09-08 | Tạo phòng Blind với mức cược 5.000 nhưng các bot trong phòng hiển thị 1.000.000. | **Đúng thiết kế, nhưng gây hiểu nhầm (UX)** | đã sửa theo hướng (a) — `ee49ce6`, merge `55d4e32` | 1.000.000 là **số dư ảo của bot** (`botStartingBalance` trong `packages/server-kit/src/room/types.ts`, spec §8.5: bot bắt đầu 1.000.000, tự nạp lại khi < 2×cược, không tính vào kinh tế người chơi). "Wager 5,000" là mức cược cố định mỗi ván. Ba hướng đã nêu: (a) ẩn số dư của bot trên ghế, (b) số dư ảo = 50×cược, (c) hiện stack theo ván. Người dùng chọn (a). |
| 2 | 2026-09-08 | Tạo phòng rồi rời phòng, phòng vẫn còn trong sảnh (0/6, Waiting) chứ không bị xoá. (Người dùng gọi là "bug 1" trong lần báo thứ hai.) | **Đúng thiết kế: phòng trống được giữ 60 giây rồi mới đóng** | đã sửa theo (d) — `c85eb8a`, merge `4e11cc1` | Spec §11.1: `CLOSED` khi "trống 60 giây hoặc host đóng khi không có ván". Code: `Room.scheduleClose()` (`packages/server-kit/src/room/room.ts`) đặt hẹn giờ `emptyRoomCloseMs = 60_000` (`room/types.ts`) khi `humanCount === 0`; hết giờ mà vẫn trống thì `close('empty')`, `RoomManager.onClosed` xoá khỏi danh sách và `notify()` → gateway phát `ROOM_LIST` cho mọi người ở sảnh, thẻ phòng tự biến mất không cần tải lại. Lý do giữ 60 s: người rời nhầm hoặc rớt mạng có thể vào lại đúng phòng/mã. Nếu muốn đổi: (a) giữ nguyên, (b) đóng ngay khi người thật cuối cùng rời, (c) rút xuống 10–15 s, (d) giữ 60 s nhưng thẻ hiện "Đang đóng…" thay vì "Waiting". Nếu thẻ còn quá 60 s thì mới là lỗi thật — cần người dùng xác nhận. **27/09 đã sửa:** `RoomSummary` có cờ `closing` (bật khi phòng trống đang đếm 60 s, tắt khi có người vào lại); thẻ phòng ghi "Đang đóng…"/"Closing…" (nhãn xám) thay vì "Đang chờ". Áp dụng cả Normal và Lite (sảnh dùng chung). Host LAN đã khởi động lại (pid 9684); Lite cần phát hành bản build mới. |
| 3 | 2026-09-08 | Nút Ready và Start cùng bật. Host chưa Ready mà bấm Start thì không có gì xảy ra (phòng 1 người + 5 bot, "5/6 ready"). | **Lỗi thật (server im lặng + client bật nút sai điều kiện)** | đã sửa — `347b971` | Client (`RoomScreen.tsx`) bật Start khi `readyCount ≥ 2`, nhưng đếm cả bot (bot luôn ready). Server (`room.ts` `startGame`) cũng chỉ kiểm `readySeats ≥ 2` rồi gọi `startHand`; `startHand` thấy mọi ghế đủ điều kiện đều là bot (`eligible.every(isBot)`) thì `toOpen()` và trả ACK — không lỗi, không ván. Cùng đường đi im lặng: host Ready nhưng không đủ tiền cược. Hướng sửa: server trả `NOT_ENOUGH_PLAYERS` rõ ràng khi không có người thật sẵn sàng/đủ điều kiện; client chỉ bật Start khi có ≥ 1 người thật sẵn sàng và tổng ≥ 2, kèm gợi ý "Bạn cần bấm Sẵn sàng trước". |
| 4 | 2026-09-08 (tôi phát hiện) | Sau khi deploy bản web mới, tab đang mở mà chuyển sang màn tải chậm (Inventory, Profile…) thì trắng màn hình, console: `Failed to fetch dynamically imported module …/assets/InventoryScreen-<hash>.js` (404). | **Lỗi thật (độ bền khi deploy)** | đã sửa theo (a)+(b) — `a5b7f11`, `e24a4f8`, merge `6d07222`, `e0ec40f` | Vite băm tên chunk; build mới xoá chunk cũ; tab cũ vẫn giữ `index.html` cũ và xin chunk theo hash cũ. Hướng sửa: (a) bắt lỗi tải chunk trong `lazy()` của `App.tsx` và tự tải lại trang một lần (đánh dấu trong sessionStorage để không lặp vô hạn); (b) thêm error boundary hiện "Có bản mới, tải lại" thay vì màn trắng; (c) server giữ chunk cũ thêm một thời gian (khó với static dir). Khuyên (a)+(b). Áp dụng cả Lite (cùng cơ chế lazy). **27/09 đã sửa:** `lazyScreen` (`apps/normal-web/src/stale-chunk.ts`) tự tải lại trang một lần khi không tải được tệp mã (đánh dấu trong sessionStorage, tối đa 1 lần/30 s, không có storage thì không tự tải lại); sự kiện `vite:preloadError` cũng vậy; khi tải lại không giúp được, `UpdateBoundary` hiện "Đã có phiên bản mới của trò chơi." + nút "Tải lại" thay màn trắng. e2e giả lập tệp Hồ sơ trả 404: đúng một lần tự tải lại rồi hiện thông báo. Lite không có tệp mã tải chậm nên không bị. |
| 5 | 2026-09-25 | Tên thân trong tủ đồ lộ mã nội bộ: "Thân nữ F01", "Thân nam M03" (en: "Female base F01"). | **Lỗi hiển thị (đặt tên)** | đã sửa theo (a) — `9fd0eef`, merge `12b6062` | Chuỗi `bases.<id>` trong `apps/normal-web/src/locales/{vi,en}/normal.json` dùng mã pipeline làm tên. Hướng: (a) tên mô tả theo ngoại hình ("Tóc tím ngắn", "Tóc xoăn đen"…), (b) tên nhân vật riêng, (c) bỏ nhãn, chỉ còn chú thích khi rê chuột. Khuyên (a). **25/09 đã sửa:** đặt tên theo kiểu tóc vì màu tóc giờ đổi được — vi: Tóc bob (f01), Tóc rối (m01), Tóc dài mái bằng (f02), Tóc gợn sóng (f03), Tóc gọn (m02), Tóc xoăn (m03); en: Bob cut, Tousled, Long with bangs, Wavy bob, Neat crop, Curly. "Thanh outfit" → "Bộ đồ đã lưu", ô trống chỉ ghi "Ô n", "Aura" → "Hào quang" (vi). e2e 6/6, host LAN khởi động lại (pid 28732). Kèm (trước đó): "Thanh outfit" trộn tiếng Anh; ô trống lặp chữ ("Trống" + "Ô 1 còn trống"). |
| 6 | 2026-09-26 (tôi phát hiện khi dựng mockup tủ đồ) | Món "Mũ trùm đen" (`head_hood_black01`, sử thi) vẫn trong catalogue nhưng ảnh là ô giữ chỗ có chữ `hood_black01`; món này có thể rơi từ quà hằng ngày. | **Lỗi thật (nội dung)** | đã sửa theo (a) — `abf4885`, merge `efcf53e` | **26/09 đã sửa:** gỡ `head_hood_black01` khỏi `items.json` và locale (người đã có vẫn giữ hàng kho; cấu hình đang đội nó tự bỏ khi đọc); quà hằng ngày chỉ rút món còn trong catalogue vì bảng `items` giữ mọi hàng cũ (test mới trong `economy-service.test.ts`). Catalogue còn 75 món. e2e 6/6; host LAN khởi động lại (pid 12032). Ghi chú gốc: Plan 12 đã rút món này (mũ trùm không xoá được tóc vẽ liền) nhưng `apps/normal-server/data/items.json` vẫn giữ nó. Hướng: (a) gỡ khỏi catalogue — người đã có vẫn giữ hàng kho, alias sang một mũ sử thi khác hoặc để trống; (b) sinh lại thành mũ không che tóc (ví dụ mũ lưỡi trai đen) giữ id cũ. Khuyên (a) ngay, (b) sau nếu muốn thêm mũ. |
| 7 | 2026-09-26 (tôi phát hiện khi sửa lỗi 6) | Sợi tóc vểnh trên đỉnh đầu (lớp L60) có thể thò qua mũ, trừ mũ chóp cao. | **Lỗi thật (dữ liệu lệch)** | đã sửa — `b465a15`, merge `3cb65dc` | **27/09 đã sửa và lên host (pid 18076):** 14 món mũ che sợi tóc (6 mũ + 8 biến thể), chắn nắng giữ sợi tóc; loader kiểm cờ khớp manifest; e2e 6/6. **Chốt 26/09 (xem ảnh từng mũ trên f01, m01, f03, m02):** 6 mũ che sợi tóc — chóp cao, mũ nồi, vương miện, nón lá, mũ len, mũ tiệc (kèm mọi biến thể màu của chúng); chắn nắng KHÔNG che vì hở đỉnh đầu, sợi tóc vểnh lên trên là tự nhiên. Manifest được chỉnh theo (bỏ cờ của chắn nắng). Loader catalogue từ chối khởi động khi cờ `hidesHairFront`/`hidesHairBack` của món khác cờ trên tệp ảnh trong manifest. Ghi chú gốc: Manifest ảnh đánh dấu cả 7 mũ `hidesHairFront` (nạp bằng `--hides-hair-front`), nhưng server đọc cờ này từ `apps/normal-server/data/items.json`, nơi chỉ `head_tophat01` có. Hướng: thêm `hidesHairFront: true` cho 6 mũ còn lại trong `items.json` và thêm test "cờ ẩn tóc của catalogue khớp manifest" để hai nơi không lệch nữa. Cần xem lại vương miện và mũ tiệc (nhỏ, đặt trên đỉnh) có nên che sợi tóc không — xem ảnh trước khi chốt. |
| 8 | 2026-09-27 (tôi phát hiện khi chụp ảnh tủ đồ bản điện thoại, Kế hoạch 14) | Trên điện thoại, thanh điều hướng chính của app cắt chữ các mục thay vì cuộn hay thu gọn — ví dụ "Cài đặt" chỉ còn thấy "Cài đ", sát ngay vào số điểm bên cạnh. | **Lỗi hiển thị (điện thoại)** | đã sửa — `8b914da`, merge `ddbf4a1` | `Shell.tsx`'s `.nav` (`normal.module.css`) chỉ là một dải `flex` cuộn ngang (`overflow-x:auto`, `scrollbar-width:none`) chung hàng với logo, nhãn "BẢN NORMAL" và khối điểm/ngôn ngữ — không có bố cục riêng cho điện thoại, và vì thanh cuộn bị ẩn nên không có dấu hiệu nào báo còn mục ngoài khung; mục cuối vì vậy bị khung `overflow` cắt ngay tại mép thay vì cuộn tới được. Hướng: (a) cuộn ngang có dải mờ báo hiệu hai đầu, hoặc (b) gộp 4 mục vào một nút menu (☰) dưới 640px. **27/09 đã sửa và lên host (pid 21072):** thanh bỏ bớt mục theo bề rộng — nhãn phiên bản ẩn dưới 1200 px, chữ tên app ẩn dưới 1024 px, nút ngôn ngữ ẩn và số dư viết gọn từ 900 px (đổi ngôn ngữ trong Cài đặt); dưới 640 px mỗi tab là biểu tượng kèm chữ nhỏ, bốn tab vừa 375 px không cuộn. e2e kiểm thanh một hàng không cuộn ở 375/700/900/1100/1440 px (gộp vào `wardrobe-layout.spec.ts` vì server giới hạn 10 lần đăng ký/phút). |

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
| F4 | 2026-09-25 | Giao diện tủ đồ xấu (ảnh chụp sau khi lên Plan 13). | Hàng tab 10 mục bị gãy xuống dòng thứ hai ("Danh hiệu & Huy hiệu" nằm một mình); khung xem trước nhỏ, các nút biểu cảm gãy 3 hàng lệch; lưới thân nền chỉ chiếm một dải, nửa dưới trống; thẻ món nhỏ, không thấy tên/độ hiếm/đang mặc gì; thanh outfit 5 ô trống chiếm nhiều chỗ, nút "Áp dụng" mờ khó đọc. | đã sửa theo (B) | Hướng: (A) chỉnh bố cục hiện có (tab một hàng cuộn ngang có biểu tượng, cột xem trước lớn và dính, lưới thẻ lấp đầy, bảng "đang mặc", thanh outfit gọn); (B) thiết kế lại toàn màn qua mockup duyệt trước rồi mới làm. Khuyên (B) vì đây là màn người chơi dùng nhiều nhất cho avatar. **27/09 đã sửa (Kế hoạch 14, hướng B):** thiết kế lại thành "Phòng thay đồ" theo mockup đã duyệt. Cột trái: sân khấu nhân vật + hàng biểu cảm, danh sách "Đang mặc" từng dòng (bấm vào dòng nhảy đúng tab, nút "×" bỏ món ở slot tuỳ chọn), 5 chân dung tròn "Bộ đồ đã lưu" (ô có đồ mở menu Áp dụng/Lưu đè/Đổi tên/Xoá, ô trống mở hộp đặt tên). Cột phải: 3 nhóm Ngoại hình/Trang phục/Trang trí dạng segmented, tab con gạch chân vàng kèm đếm "đã có/tổng", bộ lọc Tất cả/Đã có/Chưa có, lưới thẻ lấp đầy chiều ngang. Thẻ món tô viền/nhãn theo độ hiếm bằng token màu mới `--rarity-common/rare/epic` (tối và sáng, mỗi màu tương phản ≥ 4.5:1 với nền thẻ — kiểm bằng `tokens.test.ts`); vàng chỉ còn dùng cho "đang chọn/đang mặc". Bản điện thoại gập một cột, "Đang mặc"/"Bộ đồ đã lưu" thu gọn dạng `<details>` đóng mặc định. Ảnh chụp so mockup (`docs/wardrobe-redesign/mockup-*.png`), cả hai chủ đề: `apps/normal-web/e2e/screenshots/wardrobe-{desktop,tablet,mobile}-{dark,light}.png`. e2e mới `wardrobe-layout.spec.ts` (hàng nhóm và hàng tab con không gãy dòng ở mọi cỡ màn, không cuộn ngang trên điện thoại) cùng `avatar2d.spec.ts`/`avatar-tint.spec.ts` cập nhật theo markup nhóm/tab con và menu bộ đồ đã lưu mới — Normal e2e 9/9 qua; `pnpm -r typecheck`, `pnpm lint`, `pnpm test` (1848 test) sạch; `avatar-pipeline.mjs check` 144 tệp/1584 phép kiểm/0 lỗi; `build:normal` và `build:lite` qua. Nhân tiện phát hiện lỗi mới khi chụp bản điện thoại — xem mục 8 trong bảng Lỗi (thanh điều hướng chính bị cắt chữ, không liên quan tủ đồ). **27/09: đã gộp master (`8ace844`) và lên host LAN (pid 16856).** **27/09 dọn thêm (`e66b4d5`, merge `da11d6e`, host pid 12796):** thẻ thân đang chọn giữ nguyên kích thước (viền vàng bằng màu + bóng trong, e2e kiểm vùng nội dung các thẻ bằng nhau); xoá CSS thừa `.swatches/.swatch/.picker` của tủ đồ cũ. |

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
| CR1 | 2026-09-08 | Xây lại avatar theo hướng **chibi**. Khảo sát: không có bộ 3D chibi CC0 nào tách bộ phận (KayKit Adventurers, Kenney Mini là nhân vật nguyên khối; gói modular đều trả phí); 2D: DiceBear chỉ có mặt, Chibi-Character-Generator đã chết. Khuyến nghị và được chọn: **A+ — chibi 2D vẽ SVG lớp, tự xây**. | (1) 2D SVG lớp, một sprite dùng chung, tô màu bằng biến CSS, băm theo cấu hình; không WebGL, gỡ pipeline 3D. (2) Đặc điểm cơ thể miễn phí: thân, màu da, hình mặt, mắt, lông mày, mũi, miệng, má/tàn nhang; các kiểu mắt/miệng đặc biệt là **món sưu tầm** (cách thứ 2). (3) Đồ mặc qua inventory như hiện nay; vẽ lại 45 món + ~15 món mới. (4) **Outfit**: lưu tối đa 5 bộ có tên, bảng `avatar_outfits`. (5) Biểu cảm theo ván (6 mặt), chớp mắt, nhún; bot cũng chibi. (6) Tủ đồ xem trước trực tiếp, tab theo slot, độ hiếm. (7) Bước đầu: nhân vật mẫu + 5 món cho người dùng duyệt phong cách. (8) **Tài khoản admin/test phải có đầy đủ tủ đồ** để kiểm thử. | Plan 10 (SVG tự vẽ) dừng ở cổng phong cách 09/09: người dùng thấy xấu. Đổi hướng 14/09: **sinh ảnh AI theo khối khoá nhân vật, xếp lớp PNG** (kế thừa hai tài liệu của người dùng trong `docs/avatar/`), spec `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` duyệt 14/09; **Plan 11 phần mã (Task 1–5) đã gộp master** — app chạy trọn vẹn trên placeholder; Task 6–7 (nạp ảnh AI thật, cổng phong cách, cấp lại tủ đồ test, deploy) đang làm. **15/09: ảnh chủ F01 thật (ChatGPT) đã nạp và gộp master**; ô chân dung đổi 160@(112,48) → 208@(88,40), vòng khung 208 → 260; pipeline coi ảnh AI là khối liền (lớp tóc L20/L60 rỗng, mặt L50 = vùng đầu, đo tỉ lệ nhận tóc bob); Lite build lại. **17/09: đủ 6 biểu cảm F01 + 3 món đầu (tophat01, glasses_round_gold01, dealer01) đã nạp và gộp master**; `check` chỉ còn C6 trên các bộ đồ giả và thân M01 giả. **17/09 (chiều): lớp món chỉ còn món** (căn khớp trước khi so, so có dung sai lân cận, giới hạn theo slot, trang phục phủ dáng tay chân của thân gốc), **mỗi món có biểu tượng 96/192** hiện trong tủ đồ và kho; dây áo lộ ở vai và ahoge thò sau mũ đã sửa (cột thân, ahoge sang L60, mũ `hidesHairFront`). e2e Normal 5/5 sau khi build lại web. **17/09 (tối): lớp trang phục chỉ còn quần áo, da lấy từ thân** (so màu da theo từng thân, hợp nhất chỉ trong dải đồ lót, phủ tay chân chỉ cạnh quần áo; C6 đo lại bỏ vùng đầu và da, dealer01 100 %); **id thân mở** (xác thực theo `avatar-bases.json`, tên i18n f02/f03 sẵn), tủ đồ hiện mọi thân trong danh sách. Quyết định (rút lại ruling da chung): mỗi thân tự có màu da; thân mới = 7 ảnh (thân + 6 biểu cảm) sinh từ F01, tóc dài thả sau lưng. Lộ trình: M01 → F02, F03 (A: đổi tóc/màu tóc/da/mắt trên thân chung). **19–21/09: thân M01 thật + 4 biểu cảm đã nạp** (ngạc nhiên phải sinh lại: ChatGPT vẽ lại toàn bộ); đồ cắt trên F01 mặc lên M01 khớp, da đúng. **Biến thể theo giới** đã gộp master: thân khai `wear` f/m, một món kho có thể có lớp riêng cho m (`item_outfit_<code>_m_L40`, `asset.variants`), nạp bằng `ingest … --as item:outfit:<code> --base m01 --variant m`. Người dùng chốt: dealer01 và tet_red01 có bản nam; casual01, tuxedo01, royal_robe01, champion01 dùng chung; casual01 sinh trước. Đã gửi 8 câu lệnh (m01_surprised, 6 bộ + 2 bản nam). **21/09: cả 8 ảnh đạt và đã gộp master** — M01 đủ 6 biểu cảm; 6 bộ trang phục thật + bản nam dealer01/tet_red01 (khai `variants.m` trong items.json). Cắt trang phục sửa thêm: da tính theo vùng thông ra mép (khe kín là vải, khe mảnh < 3 px @1x là vải), đồ lót của thân luôn bị phủ (C6 100 % mọi bộ trên cả hai thân, ngưỡng 0,995), chân tay thò ra cạnh vải được phủ. Còn lại: casual01 có mảng dây áo ba lỗ do chính ảnh sinh vẽ ở vai phải → đề nghị sinh lại ảnh casual01. Đã gửi câu lệnh 7 mũ + 3 phụ kiện mặt và khối ngoại hình F02/F03/M02/M03 (người dùng sinh thân trước, tôi đo rồi mới sinh biểu cảm). **24/09: Plan 12 (sổ tài sản + vòng lặp sinh qua ChatGPT trong Chrome của người dùng, đường B) đã gộp master** — `assets/avatar-src/registry.json` (65 mục), CLI `avatar-registry.mjs next|collect|verify|ingest|approve|reject|status`, quy trình Chrome ghi ở `docs/avatar-2d.md` §10. Đợt 1 chạy thật: casual01 sinh lại (lần 1 bị vẽ rộng 7 % → luật `redrawn`), dealer_visor01, beret_red01, crown_gold01 → ok, nạp, commit `afd5453`. Bài học: xoá nháp ChatGPT trước mỗi chat; nhập prompt bằng execCommand rồi chờ 2 s mới bấm gửi; thêm dòng giữ cỡ ảnh vào cuối prompt. **Tiến độ 24/09 03:35:** 27 mục ok/nạp (7 mũ trừ hood_black01 bị rút vì tóc vẽ liền, 3 phụ kiện mặt, casual01, thân F02/F03/M02 + 6 mặt F02, 6 mặt F03, 4 mặt M02); M03 lần 1 bị vẽ lại phong cách → chờ lần 2. Luật chấm điều chỉnh qua thực tế: thân mới và món đội đầu so theo phần thân/chân (mũ rộng hơn tóc, tóc dài, không ahoge), scope/heads chỉ cảnh báo với món đội đầu và biểu cảm; thân mới lấy nguyên transform của thân gốc (`--transform-from`); ngưỡng footprint 16 MB. Chrome extension thỉnh thoảng rớt kết nối, chờ 30 s là lại. Chờ người dùng duyệt phong cách rồi sinh phần còn lại (M01, 7 mũ, 3 phụ kiện mặt, 5 bộ đồ ưu tiên casual01 mặc định, 8 hào quang, 6 khung, 8 bot). Giới hạn: mũ trùm ẩn tóc không xoá được tóc đã vẽ liền. Quyết định: 2 thân nền F01/M01 cùng thân khác đầu; slot head/face/outfit/aura/frame; aura và khung sinh AI, tĩnh. **24/09 07:30 — VÒNG LẶP SINH ẢNH HOÀN TẤT:** sổ tài sản 64/65 ok, 1 rút (`hood_black01`); `check` 144 tệp / 1440 phép kiểm / 0 lỗi; typecheck + lint sạch. Đã có: 6 thân (f01, f02, f03, m01, m02, m03) đủ 6 mặt; 6 mũ; 3 phụ kiện mặt; 6 bộ đồ + bản nam dealer01/tet_red01; 8 hào quang (PNG lượng tử hoá bảng màu để lọt C10, C2/C3 không áp cho lớp 10 vì hạt rời); 6 khung; 8 bot (mặt thường + vui, các mặt khác dùng lại mặt thường). Pipeline thêm target `item:aura`, `item:frame`, `bot:<n>[:<expr>]`, `--transform-from`; luật chấm bot chỉ đo chân + tâm. Ngân sách footprint nâng lên 32 MB (đo 24,2 MB @2x; 4 mặt bot sao chép ≈ 4,7 MB — việc tiếp theo: ui-kit gộp biểu cảm bot về mặt thường rồi bỏ bản sao; sửa spec §kiểm thử + docs/avatar-2d.md C10). Test `avatar-registry-verify` được 60 s/ca vì chạy pipeline thật (5 s mặc định trượt khi máy bận). Chưa làm (chờ lệnh deploy): `grant-wardrobe-cli neon.test@example.com`, `run.ps1` không `-NoMigrate`, `pnpm build:lite`, khởi động lại host LAN. **24/09: Plan 13 (màu tóc, màu mắt, biến thể màu đồ) xong trên nhánh plan13/avatar-tint** — 2 slot màu mới (`hairColor`, `eyeColor`); 13 màu tóc (8 `free`/thường, 4 hiếm, 1 cực hiếm) + 9 màu mắt (6 `free`/thường, 2 hiếm, 1 cực hiếm), món `free` không vào bể quà; 12 biến thể màu món qua `asset.tint` (`outfit_casual01` 4 màu `free`, `head_beret_red01` 3 màu, `head_beanie01` 3 màu, `head_party_cone01` 2 màu). Pipeline thêm mặt nạ tô (`hairmask`/`eyemask`/`tintmask`) cho mọi lớp thân, mặt và món khai `tintable`, phép kiểm C11, lệnh `masks` và `tint-sheet`; mặt nạ vẽ tay ghi đè ba chỗ máy cắt không sạch: `item_head_party_cone01_L80_tintmask`, `base_f02_face_neutral_L50_hairmask`, và cả 6 mặt `base_m02_face_*_L50_hairmask`. Hàm `recolour` dùng chung tô trên `<canvas>` ở ui-kit rồi xuất `blob:` cho `<img>` (giữ tint cũ trong lúc tint mới còn render); tủ đồ có hai tab mới "Màu tóc"/"Màu mắt" với hàng vòng tròn màu, swatch "Tự nhiên" đầu tiên; trang Kho đồ hiện cả món màu đang sở hữu. e2e mới `avatar-tint.spec.ts` (chọn tóc đỏ → băm chibi đổi, lớp tô hiện `img[src^="blob:"]`, lưu rồi vào bàn vẫn đúng băm) cùng 5 e2e cũ đều qua; typecheck/lint/test sạch; `avatar-pipeline.mjs check` 144 tệp/1584 phép kiểm/0 lỗi; `build:lite` qua. Triển khai: chạy `grant-wardrobe-cli neon.test@example.com` để tài khoản test có mọi màu hiếm/biến thể, rồi build lại web Normal; không cần migration; Lite build lại để nhận ui-kit mới. **25/09: đã cập nhật host LAN** (`run.ps1` áp migration `0002_outfits` lên Neon, server pid 30708 ở :8080; `grant-wardrobe-cli neon.test@example.com` cấp đủ món mới gồm 12 biến thể và màu hiếm); catalogue 76 món, 22 màu, 18 món miễn phí. |

## 5. Rà soát layout (2026-09-28)

Tôi tự rà: chụp 37 ảnh bản build thật — mọi màn Normal ở 1440 / 900 / 375 px, nền tối, cộng nền sáng trên desktop. Người dùng chọn **đợt 1** = mọi mục L, cộng U1–U6. Các mục còn lại ở cuối mục này, chờ quyết định.

| # | Mô tả | Phân loại | Trạng thái |
|---|---|---|---|
| L1 | Điện thoại, trong bàn: ô ghế của chính mình bị cắt nửa dưới, không đọc được stack. | Lỗi hiển thị | đã sửa — `f6601bd`, merge `d9a5e89` |
| L2 | Hai màn khác nhau cùng tiêu đề "Tủ đồ" (thay đồ `#/avatar` và kho `#/inventory`); nút ở Hồ sơ ghi "Chỉnh trang phục" và "Tủ đồ". | Đặt tên | đã sửa — `f6601bd`, merge `d9a5e89` |
| L3 | Trang đăng nhập: tab "Đăng nhập" xuống 2 dòng. | Lỗi hiển thị | đã sửa — `f6601bd`, merge `d9a5e89` |
| L4 | Tủ đồ ở khoảng 900 px: hàng biểu cảm bị cắt mất "Ngủ". | Lỗi hiển thị | đã sửa — `f6601bd`, merge `d9a5e89` |
| L5 | Tủ đồ ở 1440×900: "Bộ đồ đã lưu" khuất trong cột trái cuộn riêng. | Bố cục | đã sửa — `f6601bd`, merge `d9a5e89` |
| L6 | Hộp thoại Tạo phòng trên điện thoại: nút "Tạo phòng" nổi đè ô "Buy-in tối đa". | Lỗi hiển thị | đã sửa — `f6601bd`, merge `d9a5e89` |
| L7 | Thành tựu: "0 trên 100000" không có dấu phân cách nghìn. | Định dạng số | đã sửa — `f6601bd`, merge `d9a5e89` |
| L8 | Cài đặt → Thông tin: nhãn "Phiên bản" hiện "Bản Normal", "Bản dựng" hiện "0.1.0" (đảo nghĩa). | Đặt tên | đã sửa — `f6601bd`, merge `d9a5e89` |
| U1 | Nút chính hai màu: "Tạo phòng" vàng ở sảnh, xanh trong hộp thoại; nút khoá hai kiểu. Quy ước: vàng = hành động chính ngoài bàn, xanh = hành động trên bàn. | Thống nhất | đã sửa — `f6601bd`, merge `d9a5e89` |
| U2 | Thẻ người chơi ở sảnh (Normal) lặp "Điểm danh", "Hồ sơ" và nút ngôn ngữ của thanh trên, và có hai avatar (chữ "A" + chibi). Chỉ giữ chibi, tên, số dư, trạng thái. | Thống nhất | đã sửa — `f6601bd`, merge `d9a5e89` |
| U3 | Tiêu đề trang 4 cỡ (Hồ sơ không có), nội dung 3 bề rộng. Một kiểu tiêu đề, hai bề rộng. | Thống nhất | đã sửa — `f6601bd`, merge `d9a5e89` |
| U4 | Chế độ chơi gọi ba kiểu: "Blind Poker", "Blind", "Bài Mù". | Thống nhất | đã sửa — `f6601bd`, merge `d9a5e89` |
| U5 | Nhãn "BẢN NORMAL" ở trang đăng nhập và thanh trên (chỉ để trong Cài đặt). | Thống nhất | đã sửa — `f6601bd`, merge `d9a5e89` |
| U6 | Sảnh: nút "Tạo phòng" nằm dưới ô nhập mã; ≤ 900 px rơi xuống cuối danh sách phòng. Đưa lên cạnh tiêu đề. | Tối ưu | đã sửa — `f6601bd`, merge `d9a5e89` |

**28/09 đã sửa và lên host (pid 3396).** Ghi chú kỹ thuật:
- L1: ghế của mình dính đáy vùng bàn (sticky trong `.roomMain`). Khối `@media` cho điện thoại của `RoomHeader` từng nằm trước các quy tắc gốc nên chưa bao giờ có hiệu lực; giờ nằm sau và xếp đầu trang thành hai hàng. Đối thủ ở dạng xếp dọc chuyển sang dạng gọn từ 4 người (trước là 7), bỏ hai lá úp của đối thủ; danh hiệu chỉ ẩn từ 7 người (`othersDense`), vẫn đúng spec §27.3. Danh sách "Đuổi" bot trên điện thoại là một dải cuộn ngang. e2e: bàn 5 bot ở 375 px, ghế của mình nằm trọn trên khay nút.
- L3: nguyên nhân là trùng tên lớp `.card` trong `normal.module.css` (thẻ đăng nhập và thẻ vật phẩm của Kho đồ); đổi thành `.authCard`. e2e kiểm mỗi tab nằm trên một dòng.
- L5: sân khấu desktop 300 px (hình 290 px, giữ tỉ lệ cắt 11,5 % đã chỉnh).
- U1: trên bàn giữ quy ước cũ — vàng cho tiền vào pot (Cược, Tố, Chơi, Bắt đầu, Mang vào), xanh cho Xem, Theo, Sẵn sàng.
- U2: `LobbyScreen`/`PlayerBar` bỏ `onLanguage`, `extraNav`, `right`, thêm `avatar`; Lite truyền chibi mặc định theo tên.
- U3: token `--measure-wide` (1180 px) và `--measure-narrow` (44rem) trong ui-kit.
- U5: bỏ luôn nhãn phiên bản trên thanh điều hướng của Lite; trang nhập tên của Lite vẫn giữ.

**Đợt 2** (người dùng chọn 28/09: C1–C9 hướng (a), C10 theo đề xuất):

| # | Mô tả | Hướng đã chọn | Trạng thái |
|---|---|---|---|
| C1 | Cài đặt: chọn Tối/Sáng dùng hai nút rời, còn chọn ngôn ngữ dùng công tắc bo tròn. | Cả hai dùng công tắc bo tròn. | đã sửa — `556a169`, merge `1aa040c` |
| C2 | Hai định dạng ngày: "29/9/26" (Điểm danh, Lịch sử điểm) và "28 thg 9, 2026" (Hồ sơ, Kho đồ). | Ngày đứng riêng: "28 thg 9, 2026"; kèm giờ: "08:46, 28 thg 9". | đã sửa — `556a169`, merge `1aa040c` |
| C3 | Kho đồ khác Phòng thay đồ: thứ tự và tên danh mục ("Khung viền"/"Khung"), hai kiểu thẻ, in cả hộp trống. | Theo 3 nhóm và thứ tự của Phòng thay đồ, chung kiểu thẻ, ẩn hộp trống. | đã sửa — `556a169`, merge `1aa040c` |
| C4 | "Chủ phòng" và "Đăng xuất" màu đỏ (đỏ = rủi ro). | "Chủ phòng" nhãn vàng; "Đăng xuất" nút viền, nút xác nhận trong hộp thoại vẫn đỏ. | đã sửa — `556a169`, merge `1aa040c` |
| C5 | Bàn trước ván: hàng nút "Đuổi" bot; gợi ý Sẵn sàng hiện cả khi chưa ngồi; "3/3 sẵn sàng" mà Bắt đầu khoá. | Nút "Quản lý bàn" mở danh sách; gợi ý theo đúng tình huống. | đã sửa — `556a169`, merge `1aa040c` |
| C6 | Điểm danh: lưới 5 cột, hàng cao thấp; điện thoại 2 cột (16 hàng). | 7 cột máy tính / 4 cột điện thoại, phần thưởng vật phẩm thành biểu tượng, thẻ tóm tắt có nút Nhận. | đã sửa — `556a169`, merge `1aa040c` |
| C7 | Hồ sơ: hai hình avatar thừa khoảng trống; số cột thống kê lệch; mã UUID trong Lịch sử điểm. | Một hình toàn thân + thông tin bên cạnh; thống kê 4 cột / 2 cột; ẩn mã. | đã sửa — `556a169`, merge `1aa040c` |
| C8 | Thành tựu: thanh tiến độ lệch cột; "Chưa mở" lặp 34 lần. | Cột cố định; mục chưa mở hiện mờ, mục đã mở có ✓ và ngày. | đã sửa — `556a169`, merge `1aa040c` |
| C9 | Tạo phòng: "Buy-in tối thiểu 50" không ghi đơn vị. | Ghi "BB" và quy đổi ra điểm. | đã sửa — `556a169`, merge `1aa040c` |
| C10 | Điện thoại, trang Hồ sơ: thanh điều hướng còn một chấm xanh lẻ (số dư đã ẩn vì trang tự in). | Ẩn luôn chấm ở trang đó. | đã sửa — `556a169`, merge `1aa040c` |

**28/09 đợt 2 đã sửa và lên host (pid 22496).** Ghi chú kỹ thuật:
- C1: ui-kit có `Segmented` dùng chung cho nút ngôn ngữ, bộ lọc sảnh, chọn chế độ khi tạo phòng và chọn Tối/Sáng ở cả hai bản.
- C2: `formatDay`/`formatMoment` chuyển vào ui-kit; cả hai bản in ngày cùng một kiểu.
- C3: Kho đồ dùng thẻ `OwnedCard` (cùng khung thẻ với Phòng thay đồ); bỏ `RARITY_TONE`, `SLOT_ORDER` và các chuỗi `inventory.slot`/`inventory.equipped`.
- C5: hộp thoại "Quản lý bàn" gắn với ván hiện tại, nên nếu một ván bắt đầu lúc nó đang mở thì nó đóng hẳn, không tự bật lại.
- C7: mã tham chiếu của Lịch sử điểm còn trong chú thích khi rê chuột, để báo lỗi khi cần.
- C10: áp dụng cả Lite (/daily, /settings).
- Trong lúc kiểm bằng ảnh tôi bắt thêm hai lỗi và đã sửa trước khi merge: lịch Điểm danh vỡ dòng trên điện thoại, và dòng Lịch sử điểm mất bố cục một hàng.


## 6. Đợt test vận hành 1 (2026-09-28/29)

Biên bản đầy đủ: `docs/test-runs/2026-09-29-dot-1.md`. Bộ test tự động: `apps/normal-web/e2e/ops/` (hai ca T2, T3
từng là "lỗi đã biết", nay là ca thường). Người dùng chọn hướng (a) cho cả chín mục; cả chín đã sửa theo (a) trên
nhánh `fix/ops-t1-t9` (29/09), merge `2111c55`, đã cập nhật host LAN.

| # | Ca | Mức | Mô tả | Hướng sửa (khuyên in đậm) | Trạng thái |
|---|---|---|---|---|---|
| T1 | S-03 | P3 | Nhận thưởng hằng ngày xong, chấm "Có quà chưa nhận" trên tab Điểm danh vẫn còn cho tới khi rời trang (`daily-nudge.ts` chỉ đọc lại khi rời `/daily`). | **(a) trang Điểm danh báo cho thanh điều hướng ngay khi nhận thành công, chấm tắt tức thì**; (b) giữ nguyên. | đã sửa — `165585d` |
| T2 | A-02 | P2 | Mật khẩu trùng **cả** địa chỉ email vẫn đăng ký được: `validatePassword` chỉ chặn phần trước @, trong khi form ghi "khác với email của bạn". | **(a) chặn cả địa chỉ đầy đủ lẫn phần trước @ (không phân biệt hoa thường), cả client và server, thêm test**; (b) sửa chữ trên form thành "khác với phần trước @". | đã sửa — `f5e77df` |
| T3 | F-08 | P2 | "Quản lý bàn" có nút "Đuổi" cạnh bot, nhưng server từ chối đuổi bot (`Room.kick`: ILLEGAL_ACTION) — bấm không đổi gì. | **(a) cho chủ phòng đuổi bot giữa các ván (ghế bot thành ghế trống, có chỗ cho người thật)**; (b) ẩn nút với bot. | đã sửa — `dc1c84d` |
| T4 | F-07 | P3 | Đang ngồi mà số dư tụt dưới mức cần (Blind: 1× hoặc 2× mức cược), ghế tự ngồi ngoài nhưng gợi ý vẫn nói "Bấm Sẵn sàng để bắt đầu…". | **(a) gợi ý "Số dư không đủ cho mức cược này (cần X điểm)"**. | đã sửa — `b34f798` |
| T5 | G-03 | P2 | Rớt mạng > 90 giây: bị mời đứng dậy nhưng vẫn ở trong phòng 5 phút (spec §16.6). Quay lại qua sảnh thì tạo/vào phòng khác bị từ chối "Bạn đã ở trong một phòng khác" mà không biết phòng nào; lối thoát duy nhất là mở `#/room` rồi "Rời phòng". | **(a) khi kết nối lại mà vẫn còn ở trong phòng, app đưa về màn phòng**; (b) sảnh hiện dải "Bạn vẫn ở phòng X — Quay lại / Rời phòng". | đã sửa — `f43742e` |
| T6 | K-03 | P3 | "Mười phòng"/"Trăm phòng" chỉ tính khi vào phòng người khác; phòng tự tạo không được tính, trái với mô tả "Vào 10 phòng chơi". | **(a) tính cả phòng tự tạo**; (b) sửa mô tả thành "Vào 10 phòng do người khác mở". | đã sửa — `f83551e` |
| T7 | K-05 | P3 | Đổi tên xong, thẻ người chơi ở sảnh vẫn hiện tên cũ tới khi tải lại trang (danh tính của kết nối chưa cập nhật); thông báo chỉ nhắc bàn chơi. | **(a) cập nhật tên trong app ngay khi đổi thành công**. | đã sửa — `f13fe25` |
| T8 | N-04 | P3 | Host: `normal.err.log` có cảnh báo của `pg` — `sslmode=require` sẽ mang nghĩa yếu hơn ở pg v9. | **(a) dùng `sslmode=verify-full` trong `DATABASE_URL` (`.env` của host, `.env.example`, tài liệu triển khai)**. | đã sửa — `0041a7e` |
| T9 | O-01/O-04 | P3 | Lite: exe in cảnh báo thử nghiệm SEA của Node mỗi lần chạy, kể cả `--status`/`--stop` — người vận hành dễ tưởng là lỗi. | **(a) lọc riêng cảnh báo đó khi exe khởi động**. | đã sửa — `eb2afc7` |

**29/09 đã sửa, merge `2111c55`, đã lên host LAN.** Ghi chú kỹ thuật:
- T2: luật mật khẩu chuyển vào `@bp/core` (`validatePassword`, như luật tên hiển thị), form đăng ký và server chạy cùng một hàm; đăng nhập vẫn chỉ kiểm độ dài.
- T3: bot bị đuổi đi qua đúng đường của người (`removePlayer`): ghế trống, bớt một chỗ bot giữ, không có dòng sổ điểm, không gửi thông báo. `config.blind.botCount` giữ nguyên là số bot lúc tạo phòng (không nơi nào hiển thị nó; số người ở sảnh đếm ghế thật).
- T4: client tự suy ra từ cấu hình phòng và số dư (không đổi giao thức); chỉ Blind — Hold'em hết chip thì bị mời đứng dậy ngay cuối ván, nên không có trường hợp này.
- T5: làm một lần trong ui-kit (`roomReturns` + `useRoomReturn`), Normal và Lite cùng dùng; chỉ tính câu trả lời cho lần (tái) kết nối, không tính tạo/vào/vừa rời phòng.
- T6: phát `ROOM_JOINED` cho chủ phòng ngay sau `ROOM_CREATED`, mỗi phòng một lần.
- T8: `.env` thật trên host đã đổi sang `sslmode=verify-full` khi cập nhật host ngày 29/09 (chỉ đổi tham số, không in chuỗi kết nối); `/health` báo `db: ok`, log lỗi trống.
- T9: cảnh báo in ra thật là `Warning: Currently the require()…` của bộ nạp exe (do `ws` dò add-on tuỳ chọn); cảnh báo "SEA is experimental" đã tắt sẵn trong cấu hình SEA. Bộ lọc được nạp trước mọi module khác (`quiet-start.ts`), mọi cảnh báo khác vẫn in.

Vòng sửa sau review (29/09), cùng nhánh:
- T7 (`5c36038`): đổi tên còn báo cho kết nối đang mở (`renameIdentity`), nên phòng kế tiếp tạo/vào đã mang tên mới, không cần kết nối lại; phòng đang ngồi vẫn giữ tên cũ.
- T5 (`0c377f9`): người bị đưa ra khỏi phòng (rời giữa ván có hiệu lực cuối ván, bị đuổi) nhận chính `PLAYER_LEFT` của mình; app trở về sảnh thay vì kẹt ở một bàn đứng hình.
- T3 (`5e172ec`): nút "Quản lý bàn" hiện cả trong lúc đếm ngược giữa hai ván (bàn Blind có bot vẫn ở trạng thái IN_GAME).
- T6 (`7d7c9d1`): mỗi người chỉ được tính "vào phòng" một lần cho mỗi phòng — rời rồi vào lại không cộng thêm.

## 7. Góp ý review 2026-09-29 (`other/review/20260929/Note.txt`)

Người dùng gửi 17 mục kèm ảnh (hai mục cùng số 11, ghi là 11a/11b). Phân loại và nguyên nhân do Claude dò trong code
ngày 30/09; người dùng duyệt chia ba đợt: **Đợt 1** sửa lỗi ngay (Plan 16), **Đợt 2** cải tiến cần chốt lựa chọn,
**Đợt 3** nhân vật thế hệ mới (spec riêng). Độ khó: D = dễ, TB = trung bình, K = khó.

**Đợt 1 đã sửa xong (30/09) — merge `a836daa`, đã lên host LAN** (mười mục; No7 là
roadmap). Kế hoạch: `docs/superpowers/plans/2026-09-30-plan16-review-round-1.md`. Ghi chú kỹ thuật sau bảng.

| # | Loại | Khó | Mô tả | Nguyên nhân / hướng | Đợt | Trạng thái |
|---|---|---|---|---|---|---|
| No15 | Bug P1 | D | Đổi màu mắt: nhân vật vẫn mắt xanh gốc | CSP `img-src 'self' data:` chặn ảnh `blob:` mà lớp tô màu dùng (`tinted.ts`); lớp mặt bị chặn nên lộ lớp thân còn mắt gốc. Cho phép `blob:` ở Normal, thêm dự phòng ảnh gốc khi lỗi, test kiểm ảnh tải được thật | 1 | đã sửa — `eed0f87`, `6b80d9e` |
| No16 | Bug P1 | D | Đổi màu tóc: mất cả đầu/tóc | Cùng nguyên nhân No15: ba lớp được tô (L30/L50/L60) đều bị chặn, chỉ còn áo | 1 | đã sửa — `eed0f87`, `6b80d9e` |
| No6 | Bug | D | "Chưa có tài khoản? Đăng ký" / "Đã có tài khoản? Đăng nhập" không chuyển tab | Link đổi `href` trong lúc bấm nên trình duyệt quay về địa chỉ cũ; hai link trùng việc với hai tab → bỏ hai link, giữ tab | 1 | đã sửa — `ece66c2`, `91c3d9f` |
| No4 | Bug | D | Hồ sơ → Ván gần đây hiện `bot:<mã phòng>:4` | Lịch sử ghi mã bot làm nhãn; hiện "Bot n" và thêm tên phòng ("Tại bàn …") | 1 | đã sửa — `a13ad89` |
| No3 | Đổi hành vi | D | Phòng chỉ còn bot vẫn "Đang đóng…" 60 giây sau khi người cuối rời | Người thật cuối cùng rời phòng có bot → đóng ngay; phòng trống không bot giữ 60 giây như quyết định bug 2 | 1 | đã sửa — `9191cbe`, `1ee3d21` |
| No8b | Bug | D | Ô trang phục cao thấp khác nhau (kho đồ, phòng thay đồ) | Thẻ không giãn theo hàng lưới — không phải chủ đích | 1 | đã sửa — `484235f`, `108ec89` |
| No12 | Bug | D | Modal tạo phòng đổi chiều cao khi đổi chế độ | Hai bộ ô khác số dòng gợi ý; giữ chiều cao cố định | 1 | đã sửa — `a267b73`, `606a6d4` |
| No17 | Bug giao diện | D–TB | Nút cuối modal sát phần chữ, căn trái | Mỗi modal tự làm phần nút; thêm vùng nút chung (căn giữa, có khoảng cách) cho mọi modal | 1 | đã sửa — `c203aa2` |
| No11b | Bug + test | TB | Chữ/khung đè nhau (thẻ "Tay nóng" sát "HUY HIỆU"; "Ván tiếp theo sau…" đè ghế mình) | Sửa hai chỗ + thêm bước kiểm tự động phát hiện chữ đè nhau trên các màn chính | 1 | đã sửa — `484235f`, `4b7813e`; bộ đo `27e3138`, `3aff93c`, `4a4ce0c`, `badb6ee` |
| No2 | Bug layout | TB | Vào bàn chơi có thanh cuộn dọc trên PC tiêu chuẩn | Ghế của mình nhô dưới bàn tới 6 dòng; thu gọn ghế, tính lại kích thước bàn; sảnh/kho đồ chỉ cuộn khi nội dung thật sự dài | 1 | đã sửa — `4b7813e`, `b214056` |
| No11a | Tính năng | D | Mặc định chỉ hiện món đã có + ô "hiện cả món chưa có" | Thay bộ lọc Tất cả/Đã có/Chưa có | 2 | đã sửa — `2708a22`, `f319e85` (Plan 18) |
| No10 | Tính năng | D–TB | Chọn biểu cảm dạng trượt | ‹ tên biểu cảm › thay 6 nút | 2 | đã sửa — `762da23`, `f319e85` (Plan 18) |
| No1 | Tính năng | TB | Lật bài từ từ | Hiện chỉ có hiệu ứng lúc chia; thêm lật hai mặt ~0,6 giây | 2 | đã sửa — `790022d`, `13b929c` (Plan 18) |
| No8a | Bug/thiếu | TB (hoặc D) | Các bản màu áo phông cùng một icon | Icon chưa có mặt nạ tô màu; làm mặt nạ icon (TB) hoặc chấm màu (D) | 2 | đã sửa (mặt nạ icon) — `694882d`, `f319e85` (Plan 18) |
| No5 | Câu hỏi | TB | Kho đồ và Phòng thay đồ có cần tách? | Đề xuất gộp vào Phòng thay đồ | 2 | đã sửa (gộp) — `92e833d`, `a2d821b` (Plan 18) |
| No9 | Rà câu chữ | TB | Câu chữ chưa tự nhiên, hướng dẫn thừa | Lập danh sách cũ → mới / bỏ để duyệt | 2 | đã sửa — `313b0db` (Plan 18; danh sách ở `docs/copy-review-2026-10.md`) |
| No13 | Tính năng lớn | K | Tách giới tính, kiểu tóc, màu da, màu tóc; kiểu riêng nam/nữ | Thân nền là ảnh AI vẽ liền; cần vẽ lại tóc thành lớp riêng + biến thể da + đổi dữ liệu/pipeline | 3 | đã sửa — `56b4ca9`, `38b93f2`, `f3eed7a`, `bf42de7`, tranh `15492ba` … `d8f9a80`, `de7e502` (Plan 19) |
| No14 | Tính năng lớn | K+ | Chỉnh dáng tự nhiên, có ngón tay | Ảnh 2D phẳng không có khung xương; khả thi nhất: vài tư thế vẽ sẵn + vẽ lại có ngón tay, cùng đợt No13 | 3 | đã sửa (một dáng mới có ngón tay cho mọi nhân vật) — thân `15492ba`, tranh `611b3e5`, `d8f9a80` (Plan 19) |
| No7 | Tương lai | D | Thông báo qua email | Ghi vào roadmap (spec §34), chưa làm | — | roadmap — đã ghi ở spec §34, mục 14 |

**30/09 đã sửa, merge `a836daa`, đã lên host LAN.** Ghi chú kỹ thuật:
- No15/No16: nguyên nhân là CSP chứ không phải lớp tô màu. `normalCsp` cho `img-src 'self' data: blob:` (chỉ Normal; `script-src` và `connect-src` giữ nguyên, Lite giữ chính sách riêng), cả header được ghim trong `app.test.ts`. `ChibiLayer` rơi về lớp ảnh gốc khi ảnh đã tô lỗi nên không bao giờ còn đầu trống. Mười hai món có biến thể màu (như "Áo phông đỏ") bị chặn cùng lý do và nay hiện đúng màu. e2e `avatar-tint` chờ mọi `<img>` của phòng thay đồ giải mã được thật (`complete && naturalWidth > 0` — `toBeVisible` chấp nhận cả ảnh hỏng nên trước đây không thấy lỗi), cần ít nhất bốn lớp `blob:` trong đó có mặt (L50) và áo (L40), không chỉ tóc. Lý do nới CSP ở `docs/security.md` và spec §19.3.
- No6: bỏ hai link "Chưa có tài khoản?/Đã có tài khoản?" (`href` đổi giữa lúc bấm nên trình duyệt quay về địa chỉ cũ); hai tab đã làm đúng việc đó. Test kiểm cả chế độ đăng nhập lẫn đăng ký.
- No4: `botLabel()` đọc lại mã `bot:<mã phòng>:<i>` thành "Bot n" (n = i + 1), chỉ cho ghế bot; mã không đúng dạng và ghế người giữ nguyên như đã ghi. Mỗi ván mang thêm `roomName` lấy từ cấu hình phòng lưu kèm (không có thì không in dòng nào); Hồ sơ in "Tại bàn `<tên phòng>`" và nhãn "Đối thủ". Lịch sử vẫn bất biến: dòng cũ không bị ghi lại, chỉ được đọc khác đi.
- No3: người thật cuối cùng rời phòng còn bot thì phòng đóng ngay (`close('empty')`) — khi rời, khi hết 5 phút làm người xem, hoặc lúc ván kết thúc nếu rời giữa ván; "người thật" đếm thành viên nên người mất kết nối vẫn giữ phòng. Pot cộng dồn được thả lúc đóng (không còn người thật thì vào sink `carry_over`); phòng không còn ai kể cả bot vẫn 60 giây "Đang đóng…". Cờ `closing` đặt đầu `close()`/`shutdown()` để việc gỡ người khi huỷ ván không đóng lần hai (`onClosed` đúng một lần). Hai điểm đi kèm: (1) `inCurrentHand` giữ cho tới khi ván được quyết toán xong (không chỉ tới nước đi cuối), nên Rời/Đứng dậy đến giữa nước đi cuối và lúc quyết toán phải chờ quyết toán, không mang stack trước ván về rồi đóng phòng — hệ quả: **Đuổi một ghế đang chơi bị từ chối cho tới khi ván quyết toán**; (2) sau review, `close()`/`shutdown()` cùng dùng `wrapUp()`, quyết toán cả ván vừa xong mà quyết toán còn xếp hàng (trước đây bị bỏ qua: người chơi nhận stack trước ván, pot cộng dồn nằm lại trên phòng đã đóng) và bọc từng bước đóng để dù một bước lỗi phòng vẫn kết thúc ở `CLOSED` với một `onClosed`; (3) final review Plan 16: nếu `runner.cancel()` ném lỗi engine lúc đóng thì `onHandComplete` không chạy, mà `startHand` đã chuyển pot mang vào ván ra khỏi `carryOverPot` — pot đó biến khỏi sổ. Nay `wrapUp()` bỏ ván chưa quyết toán (`voidUnsettledHand`): trả pot mang vào lại `carryOverPot` để bước thả pot trả về (người đang ngồi hoặc sink `carry_over`), dừng timer của runner, ghi log lỗi kèm số tiền; stack các ghế không cần khôi phục vì chỉ `onHandComplete` mới ghi stack phòng (mỗi ghế vẫn đúng số đã mang vào ván, tức đúng số một lần huỷ sẽ hoàn), ván bỏ không ghi lịch sử. Còn lại: quyền nhận (`carryOverClaimants`) đã bị xoá từ lúc pot vào ván nên không khôi phục — sổ vẫn cân, chỉ người đã đứng dậy vì hết hạn mức mất phần. Ops: C-06 chuyển sang phòng Hold'em (không bot), thêm C-07.
- No17: `Modal` nhận prop `footer` — một hàng nút căn giữa, xuống dòng khi hẹp, cách phần thân một bậc `--space-5`; các hộp thoại rời khi chưa lưu, bộ đồ đã lưu, đăng xuất (Normal và Lite) và chọn mức mang vào đưa nút vào đó. Không sửa `.choices` (Cài đặt còn dùng chung); `.stageActions` (Normal) và `.modalActions` (Lite) nay không còn nơi nào dùng (đã grep toàn repo: TS, TSX, CSS, tài liệu) nên đã xoá khỏi `normal.module.css` và `lite.module.css` ở đợt sửa sau final review; form tạo phòng giữ nút trong form và vùng `.formFoot` dính đáy, nay cũng căn giữa.
- No12: các ô phụ thuộc chế độ nằm trong một lưới riêng giữ chỗ cho chế độ cao hơn (14rem khi hai cột; một cột trên điện thoại không giữ chỗ vì `max-height` 86dvh đã chặn hộp thoại). Đo trên bản build thật, cả tiếng Việt lẫn English, rộng 280–1920 px; e2e (trong hai test đăng nhập sẵn có, không thêm tài khoản) mở hộp thoại ở cả hai chế độ và đòi chiều cao chênh ≤ 1 px ở 1920×940, 1366×768 và 375×812.
- No8b: thẻ lấp đầy ô lưới nên các thẻ cùng hàng cao bằng nhau. Review chỉnh lại: chỉ phần chân thẻ (gợi ý/ngày và chấm màu) ghim đáy, còn độ hiếm nằm ngay dưới tên. Tiêu đề "Huy hiệu" cách thẻ phía trên ≥ 16 px — đó cũng là chỗ thứ nhất của No11b (thẻ "Tay nóng" sát "HUY HIỆU").
- No2: ghế của mình chỉ còn tối đa hai dòng dưới bảng tên (huy hiệu + tiền cược; tên bài + tiền thắng); chế độ gọn cho sân bàn thấp bắt đầu ở 400 px (trước 330), khoảng cách của nó nay đặt trên ghế (đặt trên vòng ghế thì không có tác dụng); `min-height` của sảnh là `--bp-stage` thay cho `100vh`. e2e đòi sảnh không cuộn dọc ở 1920×940, và bàn sáu ghế không cuộn dọc (trang lẫn sân bàn) ở 1920×940, 1536×730, 1366×768, 1280×720, trong ba trạng thái (chờ, trong ván, kết quả); điện thoại 375×812 giữ bố cục xếp dọc và được đo chữ đè ở cùng ba trạng thái. Chỗ thứ hai của No11b ("Ván tiếp theo sau…" đè ghế mình): đếm ngược chuyển vào chân thẻ kết quả, trong một `<p aria-live="off">` riêng (thẻ là `role="status"`, đọc mỗi giây sẽ ồn); thẻ cao tối đa bằng sân bàn, phần thân cuộn bên trong và **mờ dần ở chân khi còn cuộn được** (`b214056`) để biết dưới còn bảng pot.
- No11b (bộ đo): `expectNoTextOverlap(page, nhãn, opts?)` trong `apps/normal-web/e2e/overlap.ts` đo mọi đoạn chữ thấy được trong một lần `page.evaluate`, cắt theo `overflow` và khung nhìn, bỏ svg/`role=img`/`aria-hidden`, so trong cùng lớp (trang, từng hộp thoại, chồng toast); phần tử đục vẽ đè lên dòng dưới thì tính là che; `data-overlap-ok="<lý do>"` cho ca cố ý (chưa dùng lần nào). **Phép đo là hộp dòng, không phải 20 % cỡ chữ:** mỗi cạnh khung chữ thu vào `max(0, (cao − line-height)/2)`, không thu khi `line-height: normal`. Mức 20 % đầu tiên bỏ sót đúng ca đếm ngược của người dùng (4,6 px còn 1,9 px); nay các dòng `line-height: 1` liền nhau chỉ chạm nhau chứ không bị báo đè. Bộ đo tự kiểm bằng trang mẫu tĩnh, mỗi ca đạt có một ca hỏng đi kèm. Chạy trong các test sẵn có ở 1920×940 (màn hình của người dùng), 1366×768 và 375×812 trên các màn chính; bộ ops đo thêm bàn Hold'em ở 1440×900, 1920×940, 1366×768 và 375×812, bàn Blind chỉ ở 1440×900. Ngoài hai chỗ người dùng nêu, bộ đo tìm thêm đúng một chỗ, trên điện thoại: khối ghế của mình dính đáy để lộ chữ "Pot" của bàn dưới tên bài (`.mine`, đã sửa ở `4b7813e` — khối đặc, vệt mờ vẽ phía trên nó); không màn nào khác có chữ đè.
- Test Blind (review Task 8): "một tài khoản chơi trọn một ván Blind với bot" từng đỏ ngẫu nhiên khi ván có thành tựu từ Thùng trở lên (+3.000 trở lên, ghi ngay sau quyết toán) làm số dư lệch khỏi thẻ kết quả. Nay đọc số dư và sổ điểm cùng nhau cho tới khi sổ cộng đúng số dư, rồi trừ các dòng `achievement` trước khi so với thẻ (như ops 04-blind); chạy 24/24 với `--repeat-each=24` (`490f82c`).

**Đợt 2 đã sửa (01–02/10) — Plan 18, merge `a2bd8cc`, đã lên host LAN.** Người dùng duyệt "Đợt 2 làm theo đề xuất của bạn luôn" (01/10).

Plan: `docs/superpowers/plans/2026-10-01-plan18-review-round-2.md`. Danh sách câu chữ No9: `docs/copy-review-2026-10.md`.

Ghi chú kỹ thuật:

- **No9.**
  - Áp dụng 95 dòng đổi chữ và bỏ 2 dòng hướng dẫn ở Cài đặt; dòng bỏ thứ ba (ghi chú Kho đồ) đi cùng màn Kho đồ ở No5.
  - Thuật ngữ thống nhất:
    - "Tạm nghỉ / Chơi tiếp" (thay "Ngồi ngoài / Vào lại"), "Hủy sẵn sàng", "Mời ra" (thay "Đuổi");
    - "Người thắng" cho cả một lẫn nhiều người, "Hoàn cược dư cho …", "Đạt thành tựu mới";
    - Phòng thay đồ: "Nhân vật" và "Quần áo", "Đang dùng", "Mặc bộ này".
  - Giữ "{{x}} trên {{y}}" ở thanh tiến độ thành tựu, vì đó cũng là chữ cho trình đọc màn hình.
- **No11a.**
  - Phòng thay đồ mặc định chỉ hiện món đã có. Ô tích **"Hiện cả món chưa có"** hiện thêm phần còn lại; ô giữ trạng thái khi đổi tab trong lượt vào.
  - Tab chưa có món nào: "Bạn chưa có món nào ở mục này."
  - Một "họ" gồm món gốc và các bản màu của nó. Họ hiện khi có món gốc **hoặc** bất kỳ bản màu nào.
  - Thẻ hiện thành viên đang mặc; nếu không mặc, hiện món gốc nếu có, không thì bản màu đầu tiên đã có. Vì vậy tích ô chỉ thêm thẻ, không biến thẻ đã có thành thẻ khoá.
- **No5.**
  - Bỏ màn Kho đồ; Hồ sơ chỉ còn hai nút Phòng thay đồ và Thành tựu.
  - Link cũ `#/inventory` tự chuyển sang `#/avatar` mà không thêm bước lùi (`location.replace`).
  - Mất ngày nhận, nguồn và tổng số món (chấp nhận); số "n/m đã có" ở từng tab vẫn còn.
- **No8a.**
  - Pipeline cắt thêm mặt nạ màu cho icon (8 ảnh mới) từ mặt nạ của lớp, cùng khung cắt với icon.
  - Thẻ trong Phòng thay đồ tô icon theo bản màu đang mặc ("Áo phông đỏ" hiện áo đỏ).
  - Hàng chấm màu gồm cả món gốc, là chấm đầu tiên; chấm có `title`. Trên điện thoại mỗi chấm có vùng bấm 44 × 44 px, nhìn vẫn 16 px.
- **No10.** Biểu cảm chọn bằng `‹ tên ›`: hai nút trước/sau quay vòng, tên đọc bằng `aria-live="polite"`, có phím mũi tên; nút 44 px trên điện thoại.
- **No1.**
  - Lá úp chuyển sang ngửa ngay tại chỗ thì lật hai mặt trong 0,6 giây: bài đối thủ lúc so bài, cả Hold'em lẫn Blind.
  - Lá chia ra đã ngửa (bài mình, bài chung) giữ hiệu ứng chia như cũ. Khi bật giảm chuyển động thì không lật.
  - Phiếu kết quả chờ khoảng 0,87 giây cho bài lật xong rồi mới hiện; không chờ khi giảm chuyển động hoặc khi không có bài lật.
- **Bổ sung 02/10 (người dùng: "cho dòng kết quả dưới ghế chờ cùng phiếu kết quả luôn") — `c8486ad`, merge `044b46a`.**
  Trong lúc phiếu kết quả chờ bài lật, bàn chơi cũng chưa lộ kết quả: không có dòng tên bài và tiền thắng dưới ghế,
  không có viền sáng người thắng, lá bài chung chưa tô vàng. Tất cả hiện cùng lúc với phiếu
  (`PokerTable` prop `resultPending`). Từ 03/10 (người dùng: "cho số tiền chờ luôn", `88c79be`, `ecd117e`, merge `11ea2e1`) số tiền trên tấm tên cũng giữ số trước khi chia pot cho tới khi phiếu hiện (`ClientSeat.stackBeforeResult`); phần cược dư được hoàn lại thì hiện ngay vì không phải kết quả. Nét mặt vui/buồn cũng chờ, bắt đầu khi phiếu kết quả hiện (từ 03/10, sau khi sửa E1 bên dưới).
- **Ghi nhận, chưa làm:**
  - Khi đã tích ô, thẻ một bản màu đang có không còn hiện gợi ý mở khoá của món gốc. **Đã sửa 05/10 (Plan 20, T3) —
    `d673828`.** Thẻ có thêm một dòng "🔒 `<tên món gốc>`: `<gợi ý>`" giữa nút chọn và hàng chấm màu, nằm ngoài nút chọn
    nên tên của thẻ không đổi; chỉ hiện khi đã tích ô, món gốc chưa có và thẻ đang hiện một bản màu khác. Chấm màu chưa có
    đọc là "`<tên>`, Chưa có: `<gợi ý>`" (cả `aria-label` lẫn `title`). Không thêm khoá i18n: câu ghép từ các khoá sẵn có,
    như `cardLabel` vẫn làm. Tích ô vẫn chỉ thêm thẻ.

| # | Mức | Mô tả | Nguyên nhân / hướng | Trạng thái |
|---|---|---|---|---|
| E1 | P3 | Nét mặt vui (thắng, 4 giây) và buồn (thua, 3 giây) của nhân vật **không bao giờ hiện trong ván đang xem trực tiếp**. Chỉ hiện khi vào phòng lúc ván đã xong. Lỗi có từ lúc làm avatar (`242b91a`), review của bản sửa ngày 02/10 phát hiện. | `advanceExpressionMemory` (`packages/ui-kit/src/avatar2d/expression.ts` ~58-68) ghi lại mã ván ở mọi lần vẽ, nên tới lúc ván COMPLETE thì mã đã trùng và bỏ qua phản ứng. Hướng sửa: chỉ ghi mã ván khi thật sự phản ứng (hoặc tách `reactedHandId`), thêm test "xem trực tiếp rồi kết thúc". Sửa xong thì nét mặt vui/buồn bắt đầu xuất hiện ở mọi ván, tức một thay đổi nhìn thấy được. | đã sửa 03/10 — `cc9cf44`, `45ab5c0`, merge `a96e598` (người dùng: "có"). Nay chỉ ghi mã ván khi phản ứng; đồng hồ ngủ 60 giây cũng đặt lại sau mỗi ván xem trực tiếp. Kiểm trên playground: người thắng `happy`, người thua lúc so bài `sad`, ghế bỏ bài `closed`, ván bị huỷ không có nét vui/buồn |

**Đợt 3 đã sửa (03–05/10) — Plan 19, merge `76555ef`, đã lên host LAN.** Người dùng duyệt thiết kế và plan
("lập plan và làm luôn"), rồi duyệt điểm phong cách ("ok", 04/10).

Spec: `docs/superpowers/specs/2026-10-03-avatar-v4-design.md`. Plan: `docs/superpowers/plans/2026-10-03-plan19-avatar-v4.md`.

Ghi chú kỹ thuật:

- **Dữ liệu (No13).**
  - Cấu hình nhân vật v4: `gender` (`f`/`m`), ô vật phẩm `hairStyle` và ô màu `skinColor`, cạnh `hairColor`, `eyeColor` và các món đồ như cũ.
  - Server từ chối cấu hình v3, mã base cũ và kiểu tóc lệch giới tính (`WRONG_GENDER`).
  - `avatar-bodies.json` thay `avatar-bases.json`; `/api/catalog/avatar` trả `bodies` thay `bases`.
  - Catalogue thêm 8 kiểu tóc (nữ: bob, dài mái bằng, gợn sóng, đuôi ngựa; nam: rối, gọn, xoăn, vuốt dựng) và 6 màu da, tất cả miễn phí.
- **Chuyển đổi lúc đọc, không migration SQL.**
  - Cấu hình v1–v3 (đang dùng và bộ đồ đã lưu) được đọc thành v4 theo bảng spec §4.5. DB chỉ được ghi lại khi người chơi bấm Lưu.
  - `hairColor` và `eyeColor` cũ nay được giữ; trước đây bước chuyển đổi cũ đánh rơi chúng.
  - Màu mắt: chỉ gán món màu mắt khi nó gần mắt cũ hơn mắt tự nhiên của thân mới. Kết quả: f02, m02 → xám; f03 → xanh lá; f01, m01, m03 giữ mắt của thân.
- **Tranh (No13, No14).**
  - Mỗi giới tính một thân trọc, đứng thả lỏng, tay năm ngón, da tông kem. Kèm 6 nét mặt, 8 kiểu tóc tách hai lớp (sau L20, trước L60), 6 bộ quần áo (dealer và áo dài Tết có bản cắt nam) và 8 bot. Tất cả vẽ bằng ChatGPT qua registry.
  - Màu da tô bằng mặt nạ da. Bảy tông: trắng sứ #fcf0e9, sáng #f9e6da, tự nhiên #fbe0ca, sáng ấm #e5bd9e, ngăm #c7916b, nâu #9c6140, nâu đậm #643e2b.
  - Đã xoá 274 ảnh base cũ, tức 26,2 → 17,6 MB tranh. Lite chỉ đóng gói ảnh nó vẽ (exe 95,3 MB).
- **Phòng thay đồ (No13).** Nút Nữ | Nam ở đầu nhóm Nhân vật, cùng tab Kiểu tóc (ảnh chân dung theo màu tóc và tông da đang chọn) và Màu da. Tab "Nhân vật" chọn base cũ đã bỏ.
  - Đổi giới tính chỉ đổi kiểu tóc sang kiểu tương ứng và bản cắt quần áo. Màu và các món đồ khác giữ nguyên.
- **Pipeline.** Thêm các bước:
  - mặt nạ da theo sắc độ ấm;
  - kiểm C11 (da và vùng mắt của nét mặt), C12 (đầu đứng yên; cằm cho lệch 12 đơn vị vì ChatGPT vẽ mặt trọc ngắn hơn) và C13 (tóc tách sạch; mái được chạm mi trên tới 5 % mặt nạ mắt);
  - căn ảnh trước khi cắt cho tóc, quần áo và mặt vui của bot;
  - giữ vùng da mà tranh tóc hay quần áo vẽ lại ra khỏi lớp của chúng, để tông da hiện qua.
- **Quyết định trong lúc vẽ.**
  - Không mũ nào che tóc mái nữa, vì lớp L60 nay là cả mái lẫn đỉnh đầu, che đi thì đầu trọc. Tóc nằm dưới mũ.
  - Kiểu gợn sóng vẽ màu bạc rồi tô lại màu bạch kim, vì bạch kim trên da kem không cắt được.
  - Kiểu dài mái bằng (hime) được duyệt tay: mép thân đè lên tóc dài phía sau, không phải vẽ lại thân.
  - Bot 0 nay mặt là màn hình tối kiểu kính che.
- **Ghi nhận, chưa làm:**
  - Viền tay ở tông nâu đậm (và phần nào tông nâu) còn nét vẽ màu nâu cam của thân gốc, thành một quầng sáng quanh tay:
    **đã sửa 05/10** (người dùng: "sửa luôn viền tay ở tông nâu đậm") — merge `d04276e`, đã lên host LAN. Ghi chú kỹ
    thuật:
    - Nguyên nhân 1: đường viền của da (nâu đỏ đậm `#832e13`, vẽ cho da kem) nằm ngoài mặt nạ da nên giữ nguyên màu.
      Trên da nâu đậm, nó sáng ngang da và đậm màu hơn nhiều, thành quầng cam quanh tay, tai và cằm.
    - Nguyên nhân 2: tranh quần áo vẽ lại cả viền cánh tay và bàn tay, nằm đè lên thân. Vì vậy dù viền của thân đã sửa,
      viền cam vẫn hiện.
    - Cách sửa: thêm loại mặt nạ thứ năm, `skinLine` (`<layer>_skinlinemask`), cho 2 thân, 12 nét mặt và 8 bộ quần áo.
      Màu da **làm tối** vùng này theo tỉ lệ độ sáng màu da / độ sáng da kem (`shade`): giữ sắc độ của nét, không bao giờ
      làm sáng hơn.
      - Tông trắng sứ, sáng và tự nhiên giữ nguyên nét vẽ.
      - Tông sáng ấm tối hơn khoảng 14 %.
      - Tông nâu đậm còn khoảng 1/3 độ sáng.
    - Trên quần áo chỉ lấy bản vẽ lại của viền thân: cách viền thân ≤ 3 px, cùng màu (ΔE ≤ 20, hoặc tối hơn mà cùng sắc),
      sát chỗ da lộ ra. Mẩu da lộ dưới 24 px chỉ tính khi cách bàn tay ≤ 8 px. Vải không bị tô: đã kiểm Tết đỏ, quần bộ
      nhà vô địch, tuxedo.
    - Kiểm:
      - ảnh bản build thật ở 1920×940, cả nam lẫn nữ, bốn tông;
      - C11 bắt buộc có mặt nạ này trên thân, mặt và quần áo v4, và không được chồng lên da, mắt hay mặt nạ màu;
      - review độc lập hai vòng.
  - **Mới thấy, chưa sửa (05/10):** ở tông nâu đậm, đôi hài của long bào và áo dài Tết để lộ mu bàn chân màu kem. Tranh
    quần áo vẽ lại phần chân trong hài bằng da kem, và lớp đó không được tô màu da. Lỗi có từ Plan 19, khác với lỗi viền
    tay. **Đã sửa 05/10 (Plan 20, T5) — `651e47b`, `bcac539`, `e16852a`**, cùng với đốm kem ở chân tóc (cùng nguyên nhân,
    xem khối Plan 20 bên dưới).
  - Viên thuốc "Đang dùng" trên desktop còn che vài px góc ô màu da. **Đã sửa 05/10 (Plan 20, T3) — `d673828`:** ô màu da
    bắt đầu dưới viên thuốc ở mọi độ rộng; trước đó chỉ điện thoại đúng, desktop và máy tính bảng chồng 16,5 px.
  - Cắt lại một ảnh đã căn sẽ lệch 1–2 px so với bản đã commit; vẫn qua mọi kiểm tra. **Không sửa (ngoài phạm vi Plan 20):**
    đó là chuyện tái lập của pipeline, không phải lỗi người chơi nhìn thấy.
  - Chưa có e2e đo pixel rằng viên thuốc "Đang dùng" nằm trên ảnh chân dung kiểu tóc ở điện thoại; đã kiểm bằng ảnh chụp.
    **Đã thêm 05/10 (Plan 20, T3) — `d673828`:** `expectPillOnTop` (`wardrobe-layout.spec.ts`) lấy `elementFromPoint` ở giữa
    và hai đầu viên thuốc, cả ba phải thuộc viên thuốc; thêm `expectSwatchClearsPill` cho ô màu da. Giới hạn: `expectPillOnTop`
    chỉ phân biệt được ở độ rộng điện thoại (ở desktop ảnh 96 px bắt đầu dưới đường giữa viên thuốc, nên phép đo vẫn qua
    nếu bỏ hai dòng CSS của `5ab72be`, chính là hai dòng đặt viên thuốc lên trên ảnh).

Ghi nhận từ final review Plan 16. R2-5 sửa ngày 30/09; R2-1 … R2-4 sửa ngày 01/10 trong **Plan 17** (`docs/superpowers/plans/2026-10-01-plan17-review-round-2-notes.md`, merge `f6fe2f3`, đã lên host LAN):

| # | Mức | Mô tả | Hướng |
|---|---|---|---|
| R2-1 | P3 | Kiểm "sảnh không cuộn" trong e2e chạy với 0–1 phòng (từ No3, phòng toàn bot đóng ngay), nên lỗi chỉ lộ khi sảnh đông sẽ lọt | thêm ca sảnh 6 phòng trong ops hoặc playground. **Đã sửa — `28425fd`, `ac29dc0`, `604855e`, `112041a`**: e2e thay danh sách phòng qua WebSocket bằng sáu phòng đủ loại; ca mới bắt được lỗi thật và đã sửa (xem ghi chú dưới) |
| R2-2 | P3 | "Tại bàn Bàn 123" lặp chữ khi tên phòng bắt đầu bằng "Bàn"; "Bot 5" cạnh huy hiệu "bot" | bỏ chữ trùng khi tên đã có "Bàn"; cân nhắc bỏ huy hiệu "bot" ở lịch sử. **Đã sửa — `6f600b3`** (+ `e78cd8a`, `f234f43`) |
| R2-3 | P3 | Khay dưới bàn ghi "Đang chờ đến lượt bạn" khi phòng đang mở và thẻ kết quả đang giữ; tên mình bị cắt "Tam…" ở 1280×720; thẻ kết quả che hẳn ghế mình ở ≤ 1366 px | chỉnh câu khay theo trạng thái; cân nhắc đệm đáy lớp phủ. **Đã sửa — `6c46965`, `f93bb11`, `68a2707`, `db34d7c`** |
| R2-4 | P3 | Đếm ngược im lặng nhờ `aria-live="off"` lồng trong `role="status"` — đúng với Chromium, chưa thử NVDA/JAWS | thử trên trình đọc màn hình thật; nếu cần, dời vùng live vào trong. **Đã sửa theo cấu trúc — `39bac22`** (không có trình đọc màn hình ở đây để thử; cách sửa không phụ thuộc trình đọc) |

**01/10 đã sửa, merge `f6fe2f3`, đã lên host LAN.** Ghi chú kỹ thuật:
- **R2-2, dòng bàn chơi.** Khi từ đầu tiên của tên phòng đã là chữ "bàn" của ngôn ngữ đang xem (so theo NFC, không phân biệt hoa thường), dòng ghi "Tại `<tên>`" (en "At `<name>`"), ví dụ "Tại Bàn 123", "Tại BÀN VIP". Các trường hợp khác vẫn ghi "Tại bàn `<tên>`".
- **R2-2, ô đối thủ.** Ô của bot không còn huy hiệu "bot" nhìn thấy. Tên bot in nghiêng, màu nhạt, và có chữ "bot" ẩn cho trình đọc màn hình. Tên người chơi không bị cấm, nên một người tên "Bot 5" vẫn phân biệt được với bot, và không chỉ bằng màu.
- **R2-3, câu ở khay** (một hàm `trayWaitKey` quyết định):
  - ván xong → "Ván đã kết thúc";
  - đã bỏ bài → "Bạn đã bỏ bài — chờ ván sau";
  - tất tay → "Bạn đã tất tay — chờ kết quả";
  - Blind đã chọn → "Đã chọn — chờ các ghế khác";
  - Blind lúc lật bài, và Hold'em khi mọi ghế khác đã tất tay (chỉ còn chia nốt bài) → "Chờ lật bài";
  - các trường hợp còn lại giữ "Đang chờ đến lượt bạn".
- **R2-3, tên ghế mình.** Tấm tên của chính mình trên bàn tròn giãn theo tên, có giới hạn tính từ vị trí ghế bên cạnh: 30 % bề rộng bàn tới 6 ghế, 26 % ở 7–8 ghế, 22 % ở 9 ghế. Tên quá dài vẫn cắt bằng "…". Trước đây ở 1280×720 và 1536×730 tên chỉ có 44 px.
- **R2-3, thẻ kết quả.**
  - Thẻ kết quả dừng phía trên ghế mình: `useSeatClearance` đo ghế và đệm đáy lớp phủ (`--seat-clearance`). Có ba tầng: (1) tránh cả khối ghế, (2) tránh từ tấm tên trở xuống, (3) không đủ chỗ (≥ 216 px cho thẻ) thì phủ như cũ.
  - Cả bốn màn desktop (1920×940, 1536×730, 1366×768, 1280×720) đều ở tầng 1.
  - Điện thoại 375×812 ở tầng 3, chỉ thiếu 1 px: thẻ vẫn che ghế mình và bấm Đóng được như cũ. Điện thoại cao hơn (390×844, 412×915) rơi vào tầng 2 hoặc 1.
  - Lớp tối phía sau thẻ nay chỉ phủ vùng của thẻ, không làm tối ghế mình.
  - Hệ quả trên màn thấp (1280×720, 1366×768): thẻ nằm cao hơn nên che ghế đối thủ ở đỉnh bàn, và thẻ ngắn lại (khoảng 1,5 hàng; thân thẻ cuộn, có vệt mờ).
- **R2-4.**
  - Thẻ kết quả là một nhóm (`role="group"`) mang tên theo tiêu đề. Vùng đọc tự động (`role="status"`) nay chỉ bọc tiêu đề, ghi chú huỷ và các hàng. Chân thẻ nằm ngoài mọi vùng đọc tự động: phí bàn, pot cộng dồn, hoàn cược dư và đếm ngược.
  - Cái giá: khi thẻ hiện, trình đọc màn hình không tự đọc các dòng ở chân thẻ nữa; người dùng vẫn đọc được khi duyệt thẻ.
  - Ba bộ e2e (Normal, Lite, ops) tìm thẻ theo nhóm có tên.
- **R2-1, ca kiểm.** Ca sảnh sáu phòng thay mọi khung `ROOM_LIST` bằng sáu phòng cố định: Hold'em/Blind, đang chờ/đang chơi/đang đóng, có khoá, 3/9 và 6/6, và hai tên dài xuống dòng, một tên 30 ký tự. Ca này kiểm sảnh vừa 1920×940 và không có chữ đè ở 1920×940, 1366×768 và 375×812.
- **R2-1, lỗi ca kiểm bắt được.** Khi tên phòng xuống dòng, nhãn trạng thái rơi xuống một dòng riêng; hai tên như vậy làm trang cuộn 3 px ở 1920×940. Nay tên phòng xuống dòng cạnh nhãn và tối đa hai dòng (tên đầy đủ ở `title`). Sảnh sáu phòng còn trống khoảng 30 px ở 1920×940.
  Từ 05/10 (Plan 20, T4) `title` đó chỉ xuất hiện khi rê chuột vào một tên đang bị cắt, không còn gắn sẵn trên mọi tên phòng.
- **Ghi nhận, chưa làm:**
  - Mép trái/phải của lớp tối sau thẻ vẫn có một bậc mờ. Bậc này đã có từ trước, nay nằm lùi vào 16 px; ở giao diện sáng có thể rõ hơn.
    **Đã sửa 05/10 (Plan 20, T4) — `e97cf34`:** lớp tối là `radial-gradient(70% 50% …)`, elip rộng hơn hộp một khoảng nên bị
    cắt ở hai cạnh bên; nay là `50% 50%` (closest-side), trong suốt ở cả bốn mép. Đo trên bản build thật, bậc tại mép trái
    và phải là 6,7–8,9 mức xám ở giao diện tối và 61–67 mức ở giao diện sáng (1920×940 và 1366×768); sau khi sửa ≤ 0,8.
    e2e `expectScrimLeavesNoEdge` đọc điểm ảnh 3 px hai bên mép, cả hai giao diện, cho phép bậc ≤ 3. Đổi lại, vùng gần
    mép tối nhạt hơn một chút (alpha 0,42 thay vì 0,51 ở giữa cạnh bên). Ở điện thoại thẻ phủ hết sân bàn nên chỉ có ảnh chụp.
  - `title` trên tên phòng có thể khiến một số trình đọc màn hình đọc tên hai lần. **Đã sửa 05/10 (Plan 20, T4) — `e97cf34`:**
    tên phòng không còn `title` mặc định; `title` chỉ được gắn khi rê chuột vào **và** tên đang bị cắt
    (`scrollHeight > clientHeight + 1`), bỏ khi chuột rời. Màn cảm ứng không có tooltip, như trước (`title` chưa bao giờ hiện
    ở đó). Lite dùng chung `RoomList`.
  - Thẻ phòng ở bề rộng lưới nhỏ nhất chưa được chụp. **Đã sửa 05/10 (Plan 20, T4) — `e97cf34`:** ở bước sảnh đông của test
    e2e đầu tiên, ba cỡ cửa sổ 656, 976 và 320 px đo thẻ hẹp nhất (≤ 305 px), cuộn ngang, chữ đè, và chụp `lobby-busy-<rộng>`.
    Thẻ hẹp nhất là 304 px, chính là sàn của lưới, không phải lỗi. Việc đo lộ ra lỗi cuộn ngang ở 320 px (xem bảng bên dưới).
| R2-5 | P2 | **Host LAN tắt im lặng** hai lần (29/09 và đêm 30/09): `run.ps1` chạy node bằng `Start-Process -NoNewWindow`, gắn vào cửa sổ console đã gọi nó; cửa sổ/phiên đó đóng thì node chết theo, không để lại dòng lỗi | (a) chạy `run.ps1` từ cửa sổ PowerShell của người vận hành và để mở; (b) thêm tuỳ chọn chạy tách hẳn (cửa sổ riêng ẩn, hoặc Task Scheduler/NSSM như Lite). **Đã sửa (b) — `5931218`, review `6f776f6` + `fecbf57`, merge `5228244`, host LAN chạy qua task từ 30/09** (không bao giờ dừng/gỡ/ghi đè task hay node không phải của bộ kit; `-TaskName` không nhận wildcard): mặc định `run.ps1` đăng ký và chạy scheduled task theo người dùng `BlindLuckPoker-Normal` (không cần admin, không giới hạn thời gian; action là `run.ps1 -Serve` ẩn, chỉ chứa đường dẫn, không bí mật); `-Foreground` giữ cách cũ, `-AutoStart` thêm trigger đăng nhập, `stop.ps1` dừng node rồi dừng task, `stop.ps1 -Remove` gỡ task. Thử tay trên :8099: `taskkill /T /F` cửa sổ đã gọi `run.ps1`, `/health` vẫn trả lời |

**Bug tồn đọng đã sửa (05/10) — Plan 20, merge `eb2fcc0`.** Người dùng: "có, hãy fix các bug còn tồn đọng đi. không cần hỏi lại.
lúc nào xác nhận đã hoàn thành toàn bộ rồi thì báo".

Plan: `docs/superpowers/plans/2026-10-05-plan20-open-bugs.md`. Phạm vi: mọi ghi chú "chưa làm" của §7 ở trên, bốn lỗi thật còn
nằm trong `docs/known-limitations.md` (cộng tiền hai lần khi thử lại, `--red` dưới AA, huy hiệu, vùng giấy của Lite chưa có
test tương phản) và các lỗi thấy thêm trong lúc làm. Không đổi giao thức; một migration cộng thêm (`0003_ledger_keys`, Lite
schema v3).

Ghi chú kỹ thuật:

- **Tiền (T1) — `9187aa6`, `d1337d6`.** Khi `cash_out` ném lỗi, phòng giữ ghế và tự thử lại (cuối ván sau, lúc gỡ khán giả, lúc
  tắt máy), mỗi lần một dòng sổ mới; nếu lần đầu thực ra đã commit và chỉ mất phản hồi (rớt kết nối đúng lúc `COMMIT`), stack bị
  cộng hai lần. Người bấm Đứng dậy lần nữa sau một lỗi cũng gặp như vậy.
  - `apply(entries, meta, { key })` nhận một khoá và giữ nó trong bảng `ledger_keys`, ngay trong giao dịch của lần ghi. Khoá đã
    có thì lần gọi không làm gì và trả `{ applied: false }` (không kiểm số dư, không ghi). Lô bị từ chối lùi cả khoá; không khoá
    thì chạy như cũ. Normal: migration `0003_ledger_keys`, chỉ thêm một bảng (`IF NOT EXISTS`), `run.ps1` áp dụng khi không có
    `-NoMigrate`. Lite: schema v3. Bản in-memory có `keys`. Test chạy migration thật trên PGlite mới và trên bản đã ở 0002, và
    Lite từ v2 lên v3.
  - Phòng khoá mọi lần ghi tiền có thể thử lại (`cash_out:<phòng>:<sitId>`, `buy_in:…`, `buy_in_refund:…`,
    `carry_over:<phòng>:<id>`) và coi `applied: false` là đã xong.
  - Ghế có cash-out đang chờ bị đóng băng (`cashOutPending`): giữ stack, tạm nghỉ, không được chia bài; vào lại hay Chơi tiếp
    không gỡ được; cuối mỗi ván phòng thử lại mọi cash-out đang chờ. Buy-in lỗi được giữ lại (`pendingBuyIn`): lần Ngồi sau dùng
    đúng khoá và số tiền đó; gỡ người hoặc tắt máy thì phát lại rồi hoàn. Pot cộng dồn thả không xong nằm riêng
    (`Room.pendingRelease`, cả lô), không bị chia vào ván sau; `view().carryOverPot` và sổ cân đều tính nó. Mọi dòng log lỗi tiền
    đều ghi khoá.
  - Phí bàn (`table_fee`) không khoá vì không bao giờ được thử lại. Bảng `ledger_keys` (khoảng hai dòng mỗi lượt ngồi) được dọn
    sạch mỗi khi server khởi động (đợt sửa sau rà soát toàn nhánh, bên dưới). Tài liệu: `docs/server-kit.md` (Repositories → Keys).
  - Đợt sửa cuối — `834870c`. Phòng đang đóng mà lần thả pot cũ vẫn lỗi thì pot mới hơn nằm sau nó cũng được ghi log
    (`carry-over not released at close`: phòng, số tiền, khoá của lần thả đang chờ); trước đó nó rời sổ không một dòng. Hoàn
    buy-in lỗi lúc tắt máy từng ghi là `shutdown cash-out failed` với `stack: 0`; nay dòng đó tên `shutdown settlement failed`
    (cash-out hoặc hoàn buy-in), vẫn có khoá, thêm số buy-in khi là hoàn. Test tiền thêm `books() === 0` ở hai ca buy-in chờ,
    và ca "Chơi tiếp sau khi quét tạm nghỉ" nay chia một ván khi ghế vẫn đang chờ, kiểm `SITTING_OUT` trước khi kiểm không được
    chia bài.
  - Sau rà soát toàn nhánh — `417ef2e`.
    - Đuổi một người mà cash-out lỗi: người đó đã nhận thông báo bị mời ra, nhưng lần thử lại cuối ván chỉ trả tiền về rồi để
      họ ở lại làm khán giả. Nay lần đuổi lỗi đặt `leaveAfterHand`, nên cuối ván sau phòng gỡ hẳn người đó (vẫn đúng các khoá
      cũ). Người bị mời ra không thể vào lại phòng trước lúc đó (vẫn là thành viên, máy chủ từ chối `ALREADY_IN_ROOM`),
      nên lệnh mời ra luôn được thực hiện.
    - Buy-in lỗi (có thể đã ghi xong) nay đẩy `BALANCE` ngay, nên thanh số dư không còn hiện số điểm sổ đã trừ. Lần Ngồi phát
      lại buy-in đó vẫn đẩy thêm một lần khi đã có ghế, như mọi lần Ngồi; test nay giữ cả hai.
    - `ledger_keys` được dọn sạch khi server khởi động (`pruneLedgerKeys`): phòng sống trong bộ nhớ, nên không khoá nào còn
      được thử lại sau khi khởi động lại. Normal dọn trong `buildApp`, trước khi có game server. Lite dọn trong `listen()` của
      bản giữ thư mục dữ liệu (có run file), không bao giờ ở lần chạy `--smoke`. Cách này dựa trên việc mỗi database chỉ có
      một server (`docs/known-limitations.md`).
    - Khay hành động ở giao diện sáng: luật `[data-surface='night'] { color: var(--ink) }` không đổi màu chữ nào trong khay.
      Đã so bản dựng thật của `8873fd6` với nhánh này, cùng playground, ở 1920×940 và 375×812; chữ nào trong khay cũng tự đặt
      màu riêng.
- **Tương phản (T2) — `fc306c3`, `fa88116`.**
  - `--red` tách thành mực và tô như `--teal`. `--red` là mực: ở giao diện tối, đêm và nền felt là `#e0737b`, 6,23 / 5,60 / 5,43:1
    (trước đó 3,59 / 3,22 / 3,13). `--red-fill` giữ `#c8323c` cũ cho mọi thứ được tô, nên nút, chấm kết nối và vòng đếm không
    đổi một điểm ảnh (18 ảnh cắt, 0 px khác). Mỗi vùng giấy hay đêm khai báo `--red-fill` cạnh `--red` của nó. 22 chỗ dùng
    `var(--red)` đều được phân loại, và một test chặn dùng sai ở cả ba gói. `BELOW_AA` rỗng, vẫn là chốt hai chiều.
  - Huy hiệu: mực kéo về `--ink` (vàng và xanh ngọc 20 %, xám 12 %); test đo trên mọi nền huy hiệu đứng thật, gồm nền mesh dưới
    header phòng (review bắt được 4,46:1 trên nền thật khi test chỉ đo nền phẳng) và vệt sáng của `.panel.ink`.
    `BADGES_BELOW_AA` rỗng.
  - Vùng giấy của Lite có test riêng (`lite.contrast.test.ts`). Hàm đo tương phản xuất ra `@bp/ui-kit/testing`; cấu hình vitest của
    Lite và Normal thêm `test.css.include` vì vitest làm trống mọi CSS `?raw`. Chi tiết: `docs/ui-kit.md` (Theming).
- **Phòng thay đồ (T3) — `d673828`:** viên thuốc "Đang dùng" cách ô màu da ở mọi độ rộng; thẻ hiện thêm dòng gợi ý của món gốc
  chưa có (hai ghi chú ở Đợt 2 và Đợt 3 ở trên). Đợt sửa cuối — `c0dcdb2`: dòng gợi ý lấy chữ từ khoá `wardrobe.familyHint`
  (`{{name}}: {{hint}}`, vi và en) thay cho dấu `: ` ghép trong mã; một test giữ rằng họ món chưa có món nào (mũ chóp) chỉ hiện
  món gốc với dòng khoá của chính nó, không thêm dòng thứ hai.
- **Bàn và sảnh (T4) — `e97cf34`:** lớp tối sau thẻ kết quả không còn bậc ở mép, tên phòng chỉ có `title` khi bị cắt và đang
  rê chuột, thẻ phòng hẹp nhất được đo ở ba cỡ cửa sổ (ba ghi chú ở Plan 17 ở trên), và lỗi cuộn ngang ở 320 px (bảng bên dưới).
- **Nhân vật (T5) — `651e47b`, `bcac539`, `e16852a`; vòng sửa 1 `888831f`; đợt sửa cuối `3df003d`.** Bước đầu chỉ thêm mặt nạ,
  tranh không đổi; hai vòng sửa sau đổi bốn ảnh lớp có chủ đích (xem mục cuối).
  - Mỗi lớp tóc trước (L60) thật và mỗi bộ quần áo v4 có thêm một **mặt nạ da** của riêng nó, `<lớp>_skinmask@1x/@2x.png`
    (`masks.skin`), cắt bằng `layerSkinMask`: 32 mặt nạ mới (8 tóc, 8 áo) và 16 mặt nạ tóc cắt lại (nay là mực trừ phần da).
    Ở bước này không ảnh lớp nào đổi: `git diff` chỉ có mặt nạ và manifest.
  - Chế độ tô thứ tư của kit, `ratio`: giữ sắc độ và độ bão hoà của tông, độ sáng HSL từng điểm nhân với (độ sáng tông ÷ `meanL`
    của da). `recolour` cộng dịch nên bị kẹp về đen ở tông sâu và để lại chấm tối. `layersFor` tô nó sau màu của lớp và trước nét
    viền; server liệt kê `tint.layerSkin` của mỗi thân.
  - Áo: mặt nạ chỉ chứa mu bàn chân (long bào 577 px, một chiếc, gồm cả lưỡi liềm 26 px vẽ đè lên nét viền của thân từ vòng
    sửa 1; áo dài Tết nữ 219 + 218, nam 142 + 154); các bộ khác để rỗng. Viền vàng không bị lấy nhầm, nhờ hai luật: khoảng cách
    tới bảng màu của áo giữ mép vàng sẫm (C* 43–48, cách mu bàn chân 2–4 px) ở ngoài, còn trần C* 48 giữ thân viền vàng
    (C* 50–65) ở ngoài. Phần mọc thêm tối đa 4 px là bóng của gấu áo và hài trên mu bàn chân; thiếu nó còn lại một viền hồng
    nhạt quanh đó.
  - Đo ở `@2x` dưới nâu `#643e2b` và `#9c6140`, số điểm sáng ở chân tóc trước → sau: spiky 164 → 0 và 177 → 0, bob 180 → 0 và
    199 → 1, hime 94 → 0 và 96 → 0, neat 64 → 0 và 70 → 0, curly 53 → 0 và 59 → 0, tousled 69 → 0 và 71 → 0, ponytail 35 → 0 và
    36 → 0 (mỗi kiểu giảm ≥ 99 %). Kiểu gợn sóng đo 0 → 0; mặt nạ của nó chỉ có đầu sợi mềm (245 px, 255 trước đợt sửa cuối),
    phần rõ để rỗng.
  - Ở bước mặt nạ, tông tự nhiên giữ nguyên từng byte: 65 thẻ tự nhiên của bảng duyệt không đổi, ảnh đầu trước và sau giống hệt.
    Khi chỉ đổi màu tóc, mọi điểm ảnh đổi đều nằm trong mặt nạ da. `avatar:check` 1560 kiểm, 0 lỗi (C11 thêm hai cặp: da với tóc,
    da với màu tô). Chi tiết: `docs/avatar-2d.md` §4.4.1.
  - Vòng sửa 1 và đợt sửa cuối: ba đường nối trong tranh, thấy khi review, được người điều phối cho vào phạm vi (ở tông tự nhiên
    chúng cũng đổi, có chủ đích).
    - Nửa sau của tóc gợn sóng (L20) nay sáng như nửa trước. Pipeline từng tô lại mỗi nửa theo `meanL` riêng của nó, nên nửa sau
      sáng hơn 0,089 và lộ qua một khấc của đường chia thành hai hình chữ nhật sáng ở thái dương, ở mọi tông. Nay cả hai nửa tô
      theo độ sáng tham chiếu của nửa trước; bước nhảy độ sáng chỗ hai nửa gặp nhau 0,097 → 0,008.
    - Lớp tóc trước của hime, đuôi ngựa và gợn sóng không còn bản sao nét viền của thân bên dưới đầu (`bodyLineCopy`): hime
      2 356 px (vòng sửa 1), đuôi ngựa 102 px và gợn sóng 103 px (đợt sửa cuối). Đó là những đường mảnh nâu cam và xanh than dọc
      vai và tay áo tuxedo, đồng phục chia bài và long bào. Đợt sửa cuối giữ lại đầu lọn tóc vắt qua hàng cuối của đầu: với
      luật cũ, kiểu gợn sóng mất 49 px đầu lọn ở cổ (152 px thay vì 103).
    - Viền mu bàn chân trái của long bào: lưỡi liềm hồng đào 26 px vẽ đè lên nét viền của thân nay theo tông da.

| # | Mức | Mô tả | Nguyên nhân / hướng | Trạng thái |
|---|---|---|---|---|
| P20-1 | P2 | Giao diện sáng: tên người chơi trên thẻ kết quả gần như không đọc được — mực tối `#1b1f2e` trên thẻ đêm, khoảng 1,1:1. Thấy 05/10 khi rà tương phản | `[data-surface='night']` khai báo lại `--ink` mà không đặt `color`, nên chữ chỉ kế thừa (tên) giữ mực tối của trang | đã sửa — `fc306c3`: khối đặt `color: var(--ink)`; đo trên bản build thật `rgb(27,31,46)` → `rgb(237,231,216)` |
| P20-2 | P3 | Sảnh ở 320 px cuộn ngang 14 px, nút "Tạo phòng" nhô ra ngoài cửa sổ (đầu phải ở x = 334). Thấy 05/10 khi đo thẻ phòng hẹp nhất | tiêu đề 154 + nút 124 + sàn của đường kẻ 24 + hai khoảng cách = 326 px, trong khi sảnh chỉ để lại 304 px | đã sửa — `e97cf34`: `.sectionHead` cho xuống dòng, dưới khoảng 342 px nút nằm dưới tiêu đề, từ 342 px vẫn một dòng; Lite dùng chung, đo 320/320 |
| P20-3 | P3 | Chữ gợi ý (placeholder) của ô nhập dưới AA: Lite 3,43:1, Normal giao diện sáng 3,29:1 | `::placeholder` chỉ ở 76 % `--ink-muted` | đã sửa — `fc306c3`, `fa88116`: 94 % `--ink-muted` và `opacity: 1` (Firefox vẽ `::placeholder` ở 0,54); nay Lite 5,03, Normal 4,69 sáng và 6,82 tối |
| P20-4 | P3 | Hai ô ở form vào phòng của kit (mã phòng, mật khẩu) hiện chữ gợi ý mặc định của trình duyệt, `#757575`: 3,98:1 sáng, 4,11:1 tối | không có luật `::placeholder` nào | đã sửa — `fa88116`: cùng luật 94 % và `opacity: 1`; test `placeholderColour` mô hình trình duyệt khó nhất |
| P20-5 | P3 | Tông nâu và nâu đậm: đốm kem và một đường sáng răng cưa dọc chân tóc (rõ nhất ở spiky, neat, curly); mu bàn chân kem trong hài long bào và áo dài Tết (mục "mới thấy" ở Đợt 3) | tranh tóc và quần áo vẽ lại một phần da của thân; bước tách "da của thân" lúc nhập chỉ bỏ phần vẽ lại chạm vào da mà lớp để trống, nên phần còn lại ở trong lớp tóc hay áo, nơi màu da không với tới | đã sửa — `651e47b`, `bcac539`, `e16852a`, cộng `888831f` (lưỡi liềm ở mu bàn chân long bào) (ghi chú T5 ở trên) |

**Ngoài phạm vi Plan 20**, mỗi mục một lý do:
- Tính năng roadmap, không phải lỗi: người chơi tự đăng ảnh đại diện (R1), thông báo qua email (No7, spec §34 mục 14), web font
  tiếng Việt đóng gói, thêm dáng đứng.
- Đổi luật, thuộc quyền người dùng quyết: pot cộng dồn thả cho cả ghế đã tạm nghỉ (spec §8.4); Relief chỉ nhìn số dư (§12.4).
- Đánh đổi thiết kế đã ghi lý do ở `docs/known-limitations.md`: `SIT_OUT` không tự đứng dậy được ở bàn hai ghế; sân bàn đổi cỡ
  ở điểm gãy; đổi tên hay trang phục chỉ tới bàn ở lần vào sau; một dáng đứng.
- Sự thật về hạ tầng, không sửa được bằng mã: ảnh Docker chưa từng được build, bộ test chưa chạy trên PostgreSQL thật, Postgres
  miễn phí ngủ và Oracle thu hồi VM rảnh, dừng server Normal ở kit Windows là kill cứng, sao lưu do người vận hành chạy.
- Bảy advisory npm chỉ có ở công cụ dev: dọn cần nâng Vitest 3 và Vite 6 trên cả tám package.
- Ghi chú pipeline "cắt lại một ảnh lệch 1–2 px": chuyện tái lập, không phải lỗi người chơi nhìn thấy.

**Còn lại sau Plan 20**, đã ghi ở `docs/known-limitations.md` và `docs/ui-kit.md`: vài chấm
sáng nhỏ ở tông sâu (điểm nhấn trắng vẽ sẵn trên mu bàn chân áo Tết, vài điểm mép sợi gần màu của một kiểu tóc sáng, điểm nhấn
cam nhạt vẽ sẵn của chính tóc đuôi ngựa, và hai chấm mờ của long bào: 5 px dưới mép trái gấu áo, không qua kiểm bảng màu, và
3 px nằm ngoài cả da lẫn nét viền của thân, chỉ thấy khi phóng 8× ở tông sâu); huy hiệu xanh ngọc
ở dòng đầu của một bảng tối `.panel.ink` rất cao sẽ rơi xuống 4,3–4,4:1, và hiện không chỗ nào đặt như vậy.

**Mũ lộ tóc (06/10) — merge `7841e1b`.** Người dùng (06/10, kèm ảnh nón lá + tóc đuôi ngựa đỏ): "khi đổi item mũ, thì
có item bị lộ tóc, trông không tự nhiên".

| # | Mức | Mô tả | Nguyên nhân / hướng | Trạng thái |
|---|---|---|---|---|
| H1 | P2 | Đội mũ che đỉnh đầu mà tóc vẫn thò lên trên mũ: chỏm buộc của tóc đuôi ngựa nhô trên nón lá, mũ len và mũ nồi; gai tóc spiky, chỏm tóc tousled, sợi ahoge của bob, phần tóc phồng của wavy nhô qua vành nón lá | từ Plan 19, lớp tóc trước (L60) là cả đỉnh đầu nên không mũ nào được ẩn tóc (ẩn thì đầu trọc dưới mũ); phần tóc cao hơn đầu vì thế lộ ra ngoài mũ | đã sửa: mũ nồi, mũ len, nón lá (mọi màu) có thêm mặt nạ cắt tóc `<mũ>_hairclipmask`, pipeline tự cắt từ hình mũ. Tóc chỉ hiện dưới mép dưới của mũ, bên cạnh mũ thì dưới mép của cạnh gần nhất. Kit vẽ hai lớp tóc qua mặt nạ đó bằng CSS mask; C11 kiểm mặt nạ; tờ thử mũ vẽ đúng như kit. Mũ chóp, lưỡi trai, vương miện, mũ sinh nhật ngồi trên tóc nên giữ nguyên: tóc đuôi ngựa vươn sau mũ chóp nhỏ vẫn tự nhiên, cắt thì đuôi tóc bị bằng phẳng |

## 8. Review 2026-10-19 — điện thoại nằm ngang (`others/review/20261019`)

Người dùng gửi 4 ảnh chụp bàn chơi trên điện thoại Android nằm ngang (2340×1080 vật lý, khoảng 891×411 CSS px, Chrome;
có lúc còn thanh địa chỉ nên vùng nhìn chỉ còn khoảng 355 px cao), kèm nhận xét: "quan trọng nhất ở bàn chơi, lẽ ra phải
thiết kế để tối ưu khung bàn, thì lại đang quá nhỏ khiến cho user không thao tác được", và yêu cầu tham khảo các app poker
trên mạng. Nguyên nhân do Claude dò trong code ngày 19/10. Chưa có quy tắc nào cho điện thoại nằm ngang: ở cỡ này bàn
rơi vào bố cục xếp dọc (`STACKED` bật vì cao dưới 620 px) nhưng mọi quy tắc "điện thoại" khác lại theo bề rộng
(`max-width: 767px`) nên không bật; `.room` giữ `min-height: 30rem` (480 px) nên cả trang cuộn. Spec §27.1 ghi
"< 768 ngang (điện thoại xoay): dùng bố cục elip thu nhỏ, ẩn header" nhưng chưa bao giờ được làm; `docs/player-guide.md`
đang hứa đúng điều đó với người chơi.

| # | Ảnh | Mức | Mô tả | Nguyên nhân | Trạng thái |
|---|---|---|---|---|---|
| N1 | 4, 2, 3 | P1 | Bàn chỉ còn một dải cao khoảng 250 px và bị cắt: ở ảnh 4 chỉ thấy đáy năm ô ghế bot và nhãn "Bot", năm ô bài chung khuất sau ghế mình; ở ảnh 2–3 bài đối thủ cắt ngang, không thấy ghế nào khác. Người chơi không nhìn được bàn, không bấm được ghế. | `.room { min-height: 30rem }` cao hơn màn hình (412/390 px) nên trang cuộn; `STACKED` (`(max-width: 767px), (max-height: 620px)`) chọn bố cục cột dọc vốn cần chiều cao; không có `orientation`/`max-height` nào trong CSS; không có `safe-area-inset-left/right` cho tai thỏ khi nằm ngang | chờ quyết định |
| N2 | 3 | P1 | Thanh thao tác (Bỏ bài / Chơi 1.000 / Tự động chơi) và hàng nút phòng (Đứng dậy / Tạm nghỉ / Quản lý bàn) chiếm hơn nửa màn, bàn còn lại quá nhỏ. | Từ 768 px rộng `.tray` có `min-height: 8.25rem` (132 px) và dùng cách xếp của máy tính; "Tự động chơi" đứng một hàng riêng 44 px; hàng nút phòng 44 px luôn hiện; header hai hàng kiểu máy tính | chờ quyết định |
| N3 | 1 | P1 | Thẻ kết quả: tiêu đề "Người thắng" đè lên dòng "Phí bàn 120 · Hoàn cược dư cho Binh La 1.000 · Ván tiếp theo sau 5 giây", nút "Đóng" đè "5 giây". Chữ đè chữ, vi phạm quy tắc của dự án. | Thẻ bị chặn `max-height: 100%` theo sân khấu chỉ còn khoảng 120–150 px; `.resultFoot` không co (`min-height: auto`) nên toàn bộ phần co dồn vào `.resultLive`, mà khối này không đặt `overflow`, nên phần đầu (45–53 px) tràn khỏi khối và vẽ đè lên chân thẻ; `seat-clearance.ts` bỏ cuộc (`null`) khi sân khấu thấp hơn `MIN_CARD` 216 px | chờ quyết định |
| N4 | 2 | P2 | Hàng nhãn dưới ghế mình (Bạn · ♛ Chủ phòng · Đã chọn · ● 2.000) bị cắt ngang ở mép dưới vùng bàn. | Ghế mình `position: sticky; bottom: 0` trong `.roomMain`, nhưng hàng `.tags` nằm dưới `.plate` nên rơi ra ngoài phần nhìn thấy khi vùng bàn quá thấp (liên quan L1 ở mục 5) | chờ quyết định |
| N5 | — | P3 | Hướng dẫn chơi (`docs/player-guide.md` dòng 27) viết "xoay ngang thì bàn trở lại hình bầu dục thu nhỏ", không đúng với phần mềm hiện tại. | Spec §27.1 chưa được làm | sửa cùng N1 |
| N6 | — | P2 | Không bộ test nào chạy ở cỡ nằm ngang: ops pack chỉ có `desktop` 1440×900 và `mobile` 375×812; `expectNoTextOverlap` và `expectRoomFits` chưa từng đo 915×412 hay 844×390. Lỗi N1–N4 vì thế không bị bắt. | Thiếu project/viewport | sửa cùng N1 |

**Tham khảo app poker (Claude tìm 19/10, nguồn ghi trong spec):** các app xã hội (Zynga Poker, WSOP, Texas Poker Việt Nam
của Boyaa) chỉ chơi nằm ngang; các nhà cái lớn (GGPoker, partypoker, 888, PPPoker, PokerBros) chuyển sang bàn dọc chơi một
tay từ 2019–2020, GGPoker và 888 hỗ trợ cả hai chiều. Không app nào dùng trang cuộn dọc cho bàn chơi. Mẫu chung: ghế
mình cố định giữa đáy, bài tẩy ở đáy; một hàng ba nút lớn (Bỏ / Theo / Tố) sát mép dưới, cỡ cược bằng nút đặt sẵn (½ pot,
pot, tất tay), thanh trượt chỉ để chỉnh chính xác; nút "tạm nghỉ / rời bàn" nằm trong menu góc, không thành hàng nút; bàn
phủ kín màn hình, tỉ lệ bị chặn, ghế co thành huy hiệu nhỏ (avatar + tên + stack) khi màn thấp; không dựng "tường xoay
máy" (WCAG F100). Kỹ thuật web: khoá trang theo `100dvh` + `overflow: hidden` + `overscroll-behavior: none`;
`@media (orientation: landscape) and (max-height: 500px)` ghép với `(pointer: coarse)`; `env(safe-area-inset-*)` cả
bốn cạnh; `screen.orientation.lock()` không dùng được trên iOS Safari và chỉ hoạt động khi toàn màn hình trên Chrome.

**Lựa chọn:**
- (a) **Bố cục nằm ngang riêng** cho điện thoại (`orientation: landscape` và cao ≤ 500 px): bàn elip thu nhỏ phủ kín
  vùng nhìn, không cuộn trang; header gộp thành một dải mỏng (chấm kết nối, tên phòng, nút rời); Đứng dậy / Tạm nghỉ /
  Quản lý bàn vào một menu góc; thanh thao tác một hàng 48 px ở góc phải dưới, "Tự động chơi" và các nút trước lượt là
  công tắc nhỏ bên trái; cỡ cược bằng nút đặt sẵn, ô nhập mở ra khi cần; thẻ kết quả dạng nằm ngang gọn; thêm project
  `landscape` (≈ 915×412 chạm) vào ops pack với `expectRoomFits` và `expectNoTextOverlap`; sửa luôn N3/N4 ở gốc
  (`.resultLive` co được, hàng nhãn thuộc phần dính). Làm đúng spec §27.1 và lời hứa trong hướng dẫn chơi.
- (b) **Vá tối thiểu**: bỏ `min-height: 30rem`, cho các quy tắc < 768 bật thêm theo chiều cao, sửa N3/N4. Rẻ, nhưng bàn
  vẫn là một cột dọc nhỏ trên màn ngang: không giải quyết lời phàn nàn "khung bàn quá nhỏ".
- (c) **Chặn xoay ngang** (màn "xoay dọc để chơi"). Không khuyến nghị: WCAG F100 coi là lỗi, và người dùng muốn chơi ngang.

**Đề xuất:** (a), gộp vào Plan 26 cùng đợt 2 của vai GM (mở thành tựu, cho nhận lại điểm danh, sửa lịch quà, biểu đồ).

## 9. Yêu cầu kế tiếp (2026-10-21) — đã brainstorm, thành Plan 27

Người dùng gửi trong lúc Plan 26 đang chạy; ghi lại nguyên văn ý. Brainstorm xong 2026-10-21 (cùng ngày Plan 26
deploy): K2–K5 vào spec `docs/superpowers/specs/2026-10-21-plan27-shop-reputation-welcome-blind-zero-design.md`
(Q-table §1); K1 có câu trả lời từ mã và **không sửa** (spec §7, Q9); K6 mới ghi ở cuối bảng, hoãn.

**K1, trả lời (2026-10-21):** mỗi tài khoản chỉ có một socket sống (`Gateway.bound`, `packages/server-kit/src/gateway/gateway.ts:200-217`).
Máy đăng nhập sau nhận `WELCOME`, máy trước nhận `SESSION_REPLACED` ("Đã đăng nhập ở nơi khác"), bị đóng và không tự nối
lại (`connection.ts:127`). Máy sau vào lại đúng phòng và ghế đang dở với snapshot (`gateway.ts:218-226`). Không ai bị cấm,
không có hai ván song song, không mất stack. Phiên (`bp_session`) theo thiết bị, đăng nhập ở máy khác không thu hồi
phiên cũ. Đề xuất: giữ nguyên, viết vào hướng dẫn chơi và known-limitations (không có nút "Tiếp quản", không có danh
sách thiết bị). Người dùng đồng ý (spec Plan 27, Q9).

**K2, nguyên nhân thật:** không phải phí bàn (2 % pot) mà là ngưỡng "stack tối thiểu để được chia" (`blindRequiredStack`
= mức cược, gấp đôi ở Chơi hoặc bỏ): sau ván, ai dưới ngưỡng bị đứng dậy (`standUpSpent`, thông báo
`TABLE_LIMIT_SPENT`), tiền lẻ về ví. Engine đã có pot phụ và `commit` đã cắt ở stack, nên chỉ cần bỏ chốt chặn. Người
dùng chọn (a): tất tay phần còn lại + bỏ phí Blind (spec §5).

**Kết quả (Plan 27, 2026-10-22, nhánh `feature/BP-27-shop-reputation-welcome-blind-zero`, xem CHANGELOG):**

- **K1 — đã ghi thành luật, không sửa mã.** Hướng dẫn chơi mục 7 "Chơi trên hai thiết bị"; `docs/known-limitations.md`
  ("One account on two devices…": không có xác nhận "Tiếp quản", không có danh sách thiết bị).
- **K2 — đã làm.** Blind không thu phí bàn; ghế còn điểm là được chia, thiếu mức cược thì tất tay phần còn lại (ở Chơi
  hoặc bỏ, ghế hết sạch sau mức cược đầu được chơi tự động); ngồi xuống chỉ cần một mức cược; về đúng 0 thì đứng dậy
  với thông báo `STACK_SPENT` "Bạn đã hết điểm ở bàn này…" (Hold'em cũng vậy). `TABLE_LIMIT_SPENT` đã bỏ.
- **K3 — đã làm.** Màn "Cửa hàng" (mua bằng điểm trong game, mặc thử, "Kệ tuần này", ba kệ theo độ hiếm), **danh vọng**
  là cấp bậc chỉ tăng chứ không phải tiền thứ hai (Q2): mua chỉ trừ điểm, bậc mở quyền mua món hiếm (Cao thủ) và cực
  hiếm (Bậc thầy). Giá, bậc tối thiểu, kệ tuần, nguồn và ngưỡng danh vọng đều sửa được trong tab "Cửa hàng" của GM.
- **K4 — đã làm**, khác ý ban đầu: không có bước tạo nhân vật, nên là hộp **"Quà chào mừng"** ở lần vào sảnh đầu (một
  trong ba món hiếm, +100 danh vọng; tài khoản cũ cũng nhận) cộng lịch **"Tuần đầu tiên"** bảy lần điểm danh; điểm khởi
  đầu giữ 100.000.
- **K5 — đã làm.** Tủ đồ và cửa hàng chỉ tải hình trong tầm nhìn, hàng đợi nhuộm màu tối đa 4 việc, @2x chỉ khi DPR ≥ 1,5.
  Còn lại: trên điện thoại qua mạng chậm hàng thẻ đầu tới sau khoảng 3,2 s (mục tiêu 2 s; `docs/known-limitations.md`).
- **Thêm trong cùng plan (Q13):** điểm danh bản Normal đếm **số lần trong tháng**, bỏ một hôm không về ô 1.
- **K6 — đã ship trên BP-30, merge `30d7661` (23/10)** (brainstorm 2026-10-22, spec `2026-10-22-k6-chibi-idle-life-design.md`): chưa vẽ dáng
  mới; nhân vật ở Phòng thay đồ, Cửa hàng và Hồ sơ "sống" bằng chuyển động CSS trên các lớp sẵn có — thở, chớp mắt, cười
  và nhún khi mặc thử hay mua đồ, chào khi chạm vào, nút "Xoay" lật gương; thẻ chọn quà chào mừng reo khi được chọn; bàn
  chơi giữ nguyên. **Spike dáng thật** (xoay nghiêng, dáng ngồi) **vẫn mở**, chờ xem sau đợt này kho đồ còn "chán" không.

| # | Yêu cầu | Ghi chú ban đầu của Claude |
|---|---|---|
| K1 | **Hai máy cùng một tài khoản.** "Đã giải quyết vấn đề multithread chưa? Giả sử đăng nhập trên 2 máy và 1 máy đang chơi dở thì máy còn lại sẽ như nào, có bị cấm chơi không hay là gì?" | Cần dò mã: phiên theo thiết bị (`sessions`), một socket mỗi phiên hay mỗi tài khoản, ghế trong phòng gắn với `playerId`; trả lời bằng hành vi thật hiện nay (máy thứ hai thấy gì, có vào được bàn khác không, có bị đuổi không) rồi mới đề xuất luật (một bàn một lúc, máy sau "tiếp quản" ghế, hay chỉ xem). |
| K2 | **Blind Poker không thu phí bàn**, để chơi được tới khi tài khoản về 0: "hiện tại nhiều case account còn 5–6k lẻ vẫn bị văng khỏi phòng, phải cho cược về 0". | Liên quan `table_fee` (sink), luật "số dư tối thiểu để ngồi" (`shortToSit`, hạn mức), và cách bàn Blind xử lý người không đủ mức cược cố định (tất tay phần còn lại?). Đổi luật tiền → bảo toàn `Σ balances + Σ sink rows` vẫn phải giữ; spec §8/§12. |
| K3 | **Cửa hàng bán đồ:** mua trang phục/phụ kiện bằng **điểm (gold)** + **điểm danh vọng** kiếm trong game, giá theo độ hiếm; giá và danh vọng từng món **quản lý trong database, sửa được** (GM); lý do: "hiện tại không ai dùng kho đồ do chi phí kiếm trang phục hơi khó". | "Gold"/"tiền" = điểm trong game, không bao giờ là tiền thật (requirement.txt §3, spec §33). Cần: loại tiền tệ thứ hai `danh vọng` (nguồn: thắng ván? điểm danh? thành tựu?), bảng `item_prices(item_id, points, reputation, enabled, updated_by)`, màn Cửa hàng dùng chung khung thẻ với Phòng thay đồ, ledger cho danh vọng và sink cho tiền mua đồ, tab GM để sửa giá. |
| K4 | **Quà lập tài khoản lần đầu:** tiền + danh vọng + một bộ trang phục. | Gắn với `starting_balance` hiện có; thêm nguồn ledger `welcome` cho danh vọng và một món quà; cân nhắc với người đã có tài khoản (có tặng bù không). |
| K5 | **Kho đồ tải chậm lần đầu** (ảnh nhân vật, tóc, phụ kiện): cần lazy-load. (Gửi 2026-10-20.) | Hơn 490 tệp PNG `@1x/@2x` 384×448; tủ đồ vẽ nhiều chibi cùng lúc. Hướng: `loading="lazy"` + `IntersectionObserver` cho thẻ ngoài màn, ảnh đại diện nhỏ cho thẻ (icon 96 px đã có), tải trước theo ô đang mở, giới hạn số ảnh cùng lúc, WebP/sprite cho lớp. |
| K6 | **Dáng đứng của nhân vật quá cố định** (2026-10-21, trong brainstorm K3): "dáng đứng của nhân vật quá cố định nên cũng làm giảm hứng thú của người chơi". | **Hoãn.** Mỗi dáng mới là vẽ lại toàn bộ lớp thân, tay và mọi trang phục cho cả hai giới qua pipeline avatar (`docs/avatar-2d.md`, cổng kiểm phong cách), tức một dự án nghệ thuật riêng, không phụ thuộc cửa hàng. Brainstorm sau Plan 27; hướng khả dĩ: 2–3 dáng ngồi/tư thế cho ghế ở bàn, giữ một dáng chuẩn cho tủ đồ. **2026-10-22:** chọn gói "sự sống" trước (Q1), đang làm trên BP-30; dáng thật vẫn là spike mở. |

## 10. Phản hồi 2026-10-22 (ảnh others/review/20261022)

Người dùng gửi 5 ảnh chụp trên điện thoại Android (2340×1080 vật lý, Chrome, cùng máy với mục 8), không kèm chữ. Claude
đọc ảnh và dò mã ngày 22/10; ý của người dùng ở từng ảnh là Claude đoán, cần xác nhận (nhất là E3).

**Bối cảnh thời điểm.** Ảnh 1–4 chụp lúc 21:42–21:43, cùng phút với bản sao lưu trước khi deploy Plan 27 lên VPS
(`bp-2026-10-22-2142.dump`, CHANGELOG Plan 27 mục "Deployed"); lần deploy đó **chờ phòng đang mở duy nhất đóng lại**, tức
chính bàn "Góc Bến Nhà Rồng" trong ảnh. Vậy ảnh 1–4 là bản **Plan 26**. Ảnh 5 chụp lúc 23:01, đã là bản Plan 27 (có nút
"Cửa hàng"). Phần bố cục nằm ngang của bàn (E1, E2) không đổi trong Plan 27 (`git diff 837485c da8ca8a` không đụng các
quy tắc `.ring[data-frame='landscape']`), nên lỗi vẫn còn trên bản đang chạy.

**Cỡ màn trong ảnh 1–4.** Ảnh vật lý 2340×1080, DPR khoảng 2,625: trừ dải tai thỏ bên trái (khoảng 37 px CSS) và thanh
trạng thái cộng thanh địa chỉ của Chrome (khoảng 93 px CSS), vùng nhìn còn **khoảng 855 × 319 px CSS**. Khung nằm ngang
của Plan 26 thiết kế cho sân khấu từ 290 px trở lên (915 × 355 là cỡ thấp nhất được tính và được test, L-02); ở 319 px
cao, đo trên ảnh, hình elip của bàn chỉ còn khoảng **430 × 130 px** thay vì 667 × 200 px. Thanh địa chỉ không tự ẩn vì
trang phòng chơi khoá cuộn (Chrome chỉ thu thanh công cụ khi trang cuộn), nên trên máy này khung luôn ở cỡ thấp đó, trừ
khi bật "Toàn màn hình" trong menu "⋯" (đã có từ Plan 26).

| # | Ảnh | Mức | Mô tả | Nguyên nhân | Trạng thái |
|---|---|---|---|---|---|
| E1 | 1 | P2 | Bàn Blind đang chờ, nằm ngang: dòng gợi ý "Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một người chơi thật." xuống ba dòng, dòng thứ ba đè lên tên "Binh La" và số 5.000 trên ghế mình. Chữ đè chữ. | `.ring .note` (`packages/ui-kit/src/table/table.module.css`, khoảng dòng 1014) đặt ở `top: 60%` của vòng bàn, rộng tối đa `46cqw`. Bàn cao 130 px, rộng 430 px nên dòng chỉ rộng khoảng 200 px, chữ xuống ba dòng (khoảng 49 px) và chạm khối ghế mình (`.seat.seatMe`, đứng ở `-100% + 85px - 4.8cqh`). Nhãn "Bạn" và "♛ Chủ phòng" cũng xuống hai dòng nên khối ghế mình cao thêm. Chú thích trong CSS ghi "plate starts well below this", chỉ đúng từ 200 px trở lên. Có từ Plan 26. | đã sửa, merge `7ecea0c` (23/10): bậc "nằm ngang thấp", dòng gợi ý vào khung góc dưới phải; lên VPS 23/10 |
| E2 | 2, 4 | P1 | Bàn Blind 6 ghế (5 bot), đang chơi, nằm ngang: các khối ghế chồng lên nhau. Hàng nhãn "Bot · Đã chọn" và chip cược của Bot 4 nằm đè lên ghế Bot 5 (che mất tên Bot 5); ghế Bot 1 che hàng nhãn của Bot 2; ba lá úp và hàng nhãn "Bot · Đã chọn · 2.000" của Bot 3 nằm ngay trên ba lá bài của mình (che lá K♥ ở giữa); ba lá bài của mình (lớn, 50 px) lại che **năm lá bài chung**, chỉ thấy một góc lá 6♦ (ảnh 4, lúc "Chờ lật bài"). Người chơi không đọc được bài của mình và bài chung. | Cùng gốc với E1: bàn cao 130 px. (1) Hàng nhãn được phép rộng `--seat-line: 24cqw` (khoảng 103 px ở đây; chú thích CSS tính 160 px ở 915 × 355) nên "Bot · Đã chọn · 2.000" xuống hai dòng, khối ghế cao hơn 86 px đã tính (`--seat-half: 43px`), và khối ghế trên của sườn trái/phải chạm khối ghế dưới. (2) `.seatMe .cardMd { --card-w: clamp(50px, 24cqh, 56px) }` có mức sàn 50 px (lá cao khoảng 70 px, hơn nửa chiều cao bàn), nên bài của mình nhô lên tới hàng bài chung (`.centre { top: 45% }`). (3) Ghế trên cùng treo xuống từ điểm của nó, khối 86 px trên bàn 130 px nên chạm giữa bàn. Có từ Plan 26. | đã sửa, merge `7ecea0c` (23/10): bàn hình sân vận động rộng hết màn hình, ca ops L-06 ở 855 × 319; lên VPS 23/10 |
| E3 | 3 | — | Thẻ kết quả bàn Blind: "Người thắng · Binh La · Hai đôi · +11.760" và dòng **"Phí bàn 240"** (2 % của pot 12.000). Plan 27 hứa Blind không thu phí bàn. | Ảnh chụp trên bản Plan 26 (xem "Bối cảnh"), khi luật cũ còn thu 2 %. Bản Plan 27 đặt phí Blind bằng 0 ngay lúc tạo phòng (`packages/core/src/protocol/validate.ts:131`, `ECONOMY.blindTableFeeRate = 0`), phòng không được lưu qua lần khởi động lại nên không còn phòng cũ mang phí 2 %, và `HandResult.tsx:176` ẩn dòng "Phí bàn" khi phí bằng 0. Unit test có (`soak.test.ts` `fees === 0`, `HandResult.test.tsx`); ops pack chưa có case nào kiểm thẻ kết quả Blind **không** có dòng "Phí bàn" (`feeOn` chỉ dùng ở `03-holdem.spec.ts`). Phần mép: nút **D** nhô trên mép thẻ và nhãn "Chủ phòng" nhô dưới mép, đã ghi ở known-limitations (thẻ kết quả nằm ngang che ghế), không phải lỗi mới. | nhiều khả năng đã sửa (ảnh chụp trước lần deploy Plan 27), chờ người dùng thử lại; khẳng định ops F-01 (không in "Phí bàn") gộp ở merge `4cd43dd` |
| E4 | 5 | P2 | Sảnh chờ, điện thoại dọc, cuộn xuống một chút: hình đại diện của mình (mũ chóp, vòng nguyệt quế) **vẽ đè lên thanh điều hướng** dính ở đầu trang, che chữ "Sảnh chờ" và lấn sang ô ♠. Dòng "Số dư … điểm" trượt dưới thanh như bình thường, chỉ hình đại diện nổi lên trên. | Thanh điều hướng `.bar` (`apps/normal-web/src/screens/normal.module.css:20-23`) là `position: sticky; z-index: 20`. `Chibi` (`packages/ui-kit/src/avatar2d/Chibi.tsx:58`) đặt `z-index` cho từng lớp theo `ORDER` (`layers.ts:5`: tóc sau 20, thân 30 … mũ 80, khung 90), mà gốc `.chibi` (`avatar2d.module.css`) không mở stacking context riêng. Hình đại diện ở sảnh (`App.tsx:533`, `.lobbyAvatar` trong `avatar/avatar.module.css`) cũng không có, nên mọi lớp từ 20 trở lên cạnh tranh trực tiếp với thanh (z 20) và thắng. Có từ 2026-09-28 (hình chibi lên thanh người chơi ở sảnh); dễ thấy hơn sau Plan 27 vì thanh người chơi cao hơn (thêm nút "Cửa hàng", bậc danh vọng) nên sảnh cuộn, và quà chào mừng/thành tựu cho thêm khung (lớp 90). Trang Hồ sơ (`ProfileScreen.tsx:253, 257`) nhiều khả năng bị y hệt khi cuộn (chưa kiểm). Ghế ở bàn đã gặp đúng lỗi này và được sửa bằng `isolation: isolate` (`table.module.css` khoảng dòng 535, "faces were painted over the result card"), Phòng thay đồ cũng vậy (`.cardPortrait`). Người dùng xác nhận ngày 22/10: "khi scroll top, icon avatar đè lên khung". | đã sửa, merge `4cd43dd`, lên VPS 23/10 |
| E5 | lời nhắn | P2 | Người dùng (22/10, không kèm ảnh): "khi người chơi vào bàn mà không đủ tiền thì hiển thị message, nhưng lỗi này bị ẩn sau modal vào bàn (có lẽ do thiết lập z-index thấp hơn)". Bàn Hold'em: bấm "Ngồi vào bàn" mở hộp "Chọn số điểm mang vào bàn"; nếu số dư không đủ số mang vào thì máy chủ từ chối `INSUFFICIENT_BALANCE`, hộp vẫn mở (chỉ đóng khi ngồi được), và lời từ chối "Số dư không đủ" hiện **dưới** lớp nền tối, mờ của hộp thoại: người chơi bấm lại mà không đọc được vì sao. | Đúng như người dùng đoán, nhưng không phải "thấp hơn" mà là **bằng nhau**: khay thông báo `.toasts` (`packages/ui-kit/src/screens/screens.module.css`, khoảng dòng 304) và lớp nền `.backdrop` của `Modal` (`packages/ui-kit/src/primitives/primitives.module.css`, khoảng dòng 313) cùng `z-index: var(--z-modal)` (100). Khi bằng nhau, phần tử đứng sau trong DOM vẽ trên: `Modal` dùng `createPortal` gắn lớp nền vào cuối `<body>`, sau `#root` (nơi `RoomScreen` vẽ `Toasts`), nên lớp nền (đen 62 %, `backdrop-filter: blur(3px)`) phủ lên thông báo. Không riêng bàn Hold'em: mọi lời từ chối hay thông báo đến lúc một hộp thoại đang mở đều bị che, ví dụ hộp "Tạo phòng" ở sảnh (lỗi cấu hình phòng cũng đi qua `Toasts`), hộp "Quản lý bàn" (lỗi "Mời ra"), hộp quà chào mừng khi một thành tựu vừa mở. Bàn Blind ngồi thẳng, không mở hộp, nên F-07 vẫn thấy lời từ chối. Có từ khi `Toasts` ra đời. | đã sửa, merge `4cd43dd`, lên VPS 23/10 |

**Vì sao bộ test không bắt được.**
- E1, E2: project `landscape` của ops pack chạy 915 × 412; chỉ L-02 hạ xuống 915 × 355, và ở đó vòng bàn còn 200 px nên
  vừa. Không case nào chạy dưới 355 px cao, trong khi điện thoại thật có thanh địa chỉ chỉ còn khoảng 319 px. L-02 lại đo
  `expectNoTextOverlapAt` ngay khi nút "Chơi" hiện, có thể trước khi bot chọn xong, nên hàng nhãn "Bot · Đã chọn · 1.000" (dòng
  dài nhất) chưa có; và `expectLaidOut` chỉ so khung tên với khung tên, không so lá bài của mình với bài chung hay hàng
  nhãn của ghế này với khung tên ghế kia. Ghi chú known-limitations "740 × 360 fits with thin margins" cũng dựa trên giả
  định thanh trình duyệt chỉ ăn khoảng 55 px.
- E3: chưa có case ops kiểm bàn Blind không in "Phí bàn".
- E4: `expectNoTextOverlap` chỉ so chữ với chữ, ở vị trí cuộn 0; không case nào cuộn sảnh hay hồ sơ dưới thanh điều hướng
  trên điện thoại rồi kiểm phần tử nằm trên cùng ở ô "Sảnh chờ".
- E5: unit test của `RoomScreen` chỉ kiểm hộp mua vào khi máy chủ nhận (ACK); jsdom không xếp lớp theo `z-index`, nên
  `getByRole('alert')` vẫn thấy thông báo dù trên màn thật nó nằm dưới lớp nền. Ops pack chưa có case nào bị từ chối lúc
  hộp mua vào đang mở (F-07 là bàn Blind, không có hộp).

### E1 + E2 — bàn nằm ngang dưới cỡ thiết kế (cùng gốc)

**Lựa chọn:**
- (a) **Bậc "nằm ngang thấp"** cho sân khấu dưới 290 px (một truy vấn `max-height` thêm vào khung `landscape`, hoặc một
  biến tính từ `cqh` của vòng bàn): bài úp của ghế khác nhỏ lại (khoảng 14–16 px, hoặc chỉ hiện số lá), hàng nhãn gộp
  thành một dòng ngắn (chip cược dời lên dòng stack của khung tên, chữ "Bot" thành biểu tượng), bài của mình bỏ mức sàn
  50 px (khoảng 40 px) và đứng **cạnh** khung tên của mình thay vì nhô lên giữa bàn, ghế trên cùng chỉ treo khung tên;
  dòng gợi ý chờ (E1) dời vào dock góc phải dưới cạnh "5/6 sẵn sàng" (hoặc thành `title` của nút "Sẵn sàng"). Thêm case
  ops L-06 ở **855 × 319** (bàn Blind 6 ghế, "Chơi hoặc bỏ", đo **sau khi** mọi bot đã "Đã chọn"): hộp mỗi ghế (cả bài và
  nhãn) không giao hộp ghế khác, bài của mình không giao hàng bài chung, `expectNoTextOverlapAt`, và một lần ở 915 × 412
  để chắc bố cục cũ không đổi. Chi phí: vừa (CSS khung nằm ngang, có thể sửa `Seat.tsx` cho chip cược, ảnh chụp ba cỡ,
  một case ops, sửa known-limitations và `docs/ui-kit.md`), khoảng một nhánh 1–2 ngày. Rủi ro: đụng các khoá đo trong
  L-01…L-05 và P-03b (số La Mã bậc danh vọng trên dòng stack), cần chạy lại cả project `landscape`.
- (b) **Gợi ý "Toàn màn hình"** khi sân khấu thấp hơn 290 px: một dòng nhắc hoặc nút trong dock lúc chờ, gọi lại mục
  "Toàn màn hình" có sẵn trong menu "⋯". Trên máy này lấy lại khoảng 90 px (về khoảng 855 × 411, vùng đã test). Chi phí
  thấp (một chuỗi vi/en, một điều kiện, một unit test). Rủi ro: không có trên iPhone (Safari không cho trang web toàn
  màn hình), người chơi phải bấm mỗi lần vào bàn, nên một mình (b) không đủ.
- (c) **Vá tối thiểu**: nới `--seat-line` lên khoảng 30cqw, hạ mức sàn bài của mình xuống 40 px, giấu dòng gợi ý khi vòng
  bàn thấp hơn 160 px. Rẻ, nhưng 6–8 ghế vẫn chật ở 130 px và không có case nào giữ cỡ này.

**Đề xuất:** (a) cộng (b): (a) mới làm bàn đọc được ở cỡ thật của điện thoại có thanh địa chỉ, (b) rẻ và cho người chơi
Android lấy lại cả màn hình.

**Phân loại:** Bounded fix (UI, không đổi luật), nhánh `bugfix/BP-28-short-landscape-table`. Cần người dùng chốt hai
điểm của (a): bài úp của bot thu nhỏ hay chỉ hiện số lá, và dòng gợi ý chờ nằm trong dock hay bỏ hẳn.

**Đang sửa trên BP-28 (23/10).** Làm theo (a) cộng (b), với quyết định của phiên: bài úp của bot **thu nhỏ** (16 px, giữ
tỉ lệ), dòng gợi ý chờ nằm **trong dock** dưới "N/M sẵn sàng". Bậc "nằm ngang thấp" bật khi sân khấu dưới **300 px** (đo
sân khấu, không đo màn hình): 855 × 319 (255 px) và cả 915 × 355 (291 px), vì đo trên bàn Blind 6 ghế ở 915 × 355 thì dòng
"Bot · Đã chọn · 2.000" của ghế sườn trên vẫn nằm đè lên số pot. Bàn thành hình sân vận động rộng hết sân khấu: ghế mình
ở giữa đáy, bài mình **nằm cạnh** khung tên; hai ghế cạnh mình ở hai đầu bàn; các ghế còn lại một hàng phía trên, không
bao giờ nằm trên đầu ghế khác. Dưới ghế đối thủ chỉ còn chip cược; "Bot", "Chủ phòng" ẩn, trạng thái thành một chấm màu.
Nhắc "Dùng Toàn màn hình để bàn rộng hơn" hiện một lần ở góc dưới trái (chỉ khi trình duyệt cho toàn màn hình). Ca ops
mới L-06 ở 855 × 319. Chi tiết: CHANGELOG mục BP-28, `docs/ui-kit.md` ("The short tier"), `docs/known-limitations.md`.

### E3 — "Phí bàn 240" trên thẻ kết quả Blind

**Lựa chọn:**
- (a) **Không sửa mã**: người dùng chơi lại một ván Blind trên bản hiện tại và xác nhận thẻ kết quả không còn dòng "Phí
  bàn", số thắng bằng đúng tổng pot (6 × 2.000 = +12.000 thay vì +11.760).
- (b) (a) cộng **một khẳng định trong ops pack**: ở F-10 (hoặc case Blind đầu tiên của `04-blind.spec.ts`) thêm
  `expect(await feeOn(resultCard(page))).toBe(0)`. Chi phí: vài dòng, không thêm lượt đăng ký. Rủi ro: gần như không.
- (c) Nếu người dùng thấy "Phí bàn" trên bàn Blind **tạo sau 21:46 ngày 22/10**: điều tra như lỗi thật (VPS chạy bản cũ,
  hoặc bundle web cũ trong tab chưa F5; `stale-chunk.ts` chỉ tải lại khi thiếu chunk).

**Đề xuất:** (b): ảnh nhiều khả năng là bản trước deploy, và một khẳng định rẻ giữ cho luật "Blind không thu phí" không
bị lùi.

**Phân loại:** nhiều khả năng **không phải lỗi** (đã sửa trong Plan 27); cần người dùng xác nhận. Khẳng định ở (b) đi
chung nhánh với E4.

### E4 — hình đại diện vẽ đè thanh điều hướng khi cuộn

**Lựa chọn:**
- (a) **`isolation: isolate` trên gốc `.chibi`** (`packages/ui-kit/src/avatar2d/avatar2d.module.css`): mọi nơi dùng
  `Chibi` (sảnh, hồ sơ, cửa hàng, hộp quà chào mừng, tủ đồ, ghế ở bàn) tự giữ lớp của mình bên trong. Khung (lớp 90) vẽ
  ngoài vòng cắt nhưng vẫn trong gốc nên không bị cắt. Chi phí: một dòng CSS, một unit test cho class, một case ops ở
  project `mobile` (cuộn sảnh 200 px, `document.elementFromPoint` tại ô "Sảnh chờ" phải thuộc thanh điều hướng), ảnh ở ba
  cỡ cho sảnh, hồ sơ, tủ đồ. Rủi ro: thấp; các chỗ đã tự cô lập (`.cardPortrait`, khung tên ở bàn) không đổi; cần nhìn
  lại thẻ thử đồ của cửa hàng và "Đang dùng" trong tủ đồ.
- (b) Chỉ thêm `isolation: isolate` cho `.lobbyAvatar` và hai chibi của trang Hồ sơ. Hẹp hơn, nhưng chỗ dùng `Chibi`
  mới sau này sẽ gặp lại (đây đã là lần thứ ba).
- (c) Nâng `z-index` của thanh điều hướng lên trên 90. Không khuyến nghị: phải xếp lại với `--z-modal`, hộp thoại và
  thông báo, và vẫn hở với bất cứ lớp nào cao hơn.

**Đề xuất:** (a): sửa ở gốc, một lần cho mọi chỗ, đúng bài học của ghế ở bàn và Phòng thay đồ.

**Phân loại:** Bounded fix, nhánh `bugfix/BP-29-chibi-over-rail-and-hidden-notice` (gộp cả khẳng định E3-(b) và E5).
Nhỏ, có thể deploy trước nhánh BP-28.

### E5 — lời từ chối "Số dư không đủ" nằm dưới hộp mua vào

**Lựa chọn:**
- (a) **Thông báo luôn trên hộp thoại**: thêm token `--z-toast` (110, trên `--z-modal` 100) trong
  `packages/ui-kit/src/theme/tokens.css` và cho `.toasts` dùng nó. Một chỗ sửa cho mọi màn (phòng, sảnh, các trang của
  Normal, Lite), kể cả thông báo đến lúc hộp quà chào mừng hay hộp mua ở Cửa hàng đang mở. Khay thông báo có
  `pointer-events: none` (chỉ từng thông báo nhận bấm), nằm ngoài lớp nền nên bấm vào nó không đóng hộp thoại. Chi phí:
  hai dòng CSS, một unit test (token trên `--z-modal`, `.toasts` dùng token), một case ops (bàn Hold'em mức 2.500/5.000,
  mang tối thiểu 250.000 với số dư 100.000: hộp vẫn mở, "Số dư không đủ" là phần tử trên cùng tại tâm thông báo theo
  `document.elementFromPoint`). Rủi ro: trên điện thoại, thông báo (rộng gần hết màn, ở đáy) có thể che chân một hộp thoại
  cao (hộp "Tạo phòng") tới 6 giây hoặc tới khi bấm ×; với hộp mua vào (ngắn, ở giữa) thì không.
- (b) **Hiện lời từ chối ngay trong hộp mua vào** (một dòng đỏ dưới ô "Buy-in", `role="alert"`), giấu thông báo khi hộp
  mở. Đọc rõ nhất cho đúng ca này, nhưng chỉ sửa một hộp: hộp "Tạo phòng", "Quản lý bàn" và các thông báo đến lúc hộp quà
  chào mừng mở vẫn bị che.
- (c) (a) cộng (b). Kỹ nhất, nhưng (b) thêm chuỗi và logic cho một ca mà (a) đã làm đọc được.

**Đề xuất:** (a): nhỏ nhất, sửa ở gốc cho mọi hộp thoại, đúng tinh thần của E4 (một quy tắc chung thay vì vá từng chỗ).

**Phân loại:** Bounded fix, cùng nhánh với E4.
