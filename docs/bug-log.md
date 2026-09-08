# Nhật ký lỗi và góp ý (giai đoạn test nội bộ)

Ghi nhận từ 2026-09-08. Chỉ sửa khi người dùng báo "fix". Trạng thái: `ghi nhận` → `sẽ sửa` → `đã sửa (commit)` / `không sửa (lý do)`.

## 1. Lỗi

| # | Ngày | Mô tả | Phân loại | Trạng thái | Ghi chú kỹ thuật |
|---|---|---|---|---|---|
| 1 | 2026-09-08 | Tạo phòng Blind với mức cược 5.000 nhưng các bot trong phòng hiển thị 1.000.000. | **Đúng thiết kế, nhưng gây hiểu nhầm (UX)** | đã sửa theo hướng (a) — `ee49ce6`, merge `55d4e32` | 1.000.000 là **số dư ảo của bot** (`botStartingBalance` trong `packages/server-kit/src/room/types.ts`, spec §8.5: bot bắt đầu 1.000.000, tự nạp lại khi < 2×cược, không tính vào kinh tế người chơi). "Wager 5,000" là mức cược cố định mỗi ván. Ba hướng đã nêu: (a) ẩn số dư của bot trên ghế, (b) số dư ảo = 50×cược, (c) hiện stack theo ván. Người dùng chọn (a). |

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
| F1 | 2026-09-08 | Thêm chế độ **auto-fold / auto-call** (check/fold, call any, fold to any bet…) như các game Hold'em thông thường. | **Chưa có.** Server chỉ tự fold khi hết giờ hoặc ghế được đánh dấu (`hand-runner.ts`); client chưa có nút "hành động trước" khi chưa tới lượt. Spec chưa đề cập. | ghi nhận | Client-side trước (đơn giản, không đổi protocol): thanh ActionBar hiện các ô tick "Check/Fold", "Call", "Fold" khi chưa tới lượt; tới lượt thì client tự gửi hành động tương ứng nếu vẫn hợp lệ (ví dụ "Check/Fold" gửi check nếu được, không thì fold; "Call" chỉ gửi nếu số cần call không đổi so với lúc tick, nếu tăng thì bỏ tick). Tick tự xoá sau mỗi street. Cần thêm i18n vi/en và test reducer. Với Blind Poker chỉ có Play/Fold nên có thể thêm "Tự động chơi" tương tự. Ước lượng: 1 task ui-kit. |
| F2 | 2026-09-08 | Chưa thấy phần **đăng nhập nhận quà hằng ngày**; đã có chưa? | **Đã có, nhưng không tự động khi đăng nhập.** Theo spec §13.1, người chơi phải bấm **Nhận** một lần/ngày (không tự phát). Normal: tab **Daily** trên thanh điều hướng (`#/daily`, `apps/normal-web/src/screens/DailyScreen.tsx`) hiện lịch 31 ngày, streak, nút Nhận; ngày 7/14/21/28 kèm item. Lite: cùng bảng điểm, không item (`apps/lite/server/src/economy/daily.ts`). | đã trả lời | Nếu muốn nổi bật hơn: (a) mở popup Daily ngay sau đăng nhập khi hôm nay chưa nhận, hoặc (b) chấm đỏ trên tab Daily khi còn quà. Chọn (a) hoặc (b) nếu cần. |
| F3 | 2026-09-08 | Khi vào bàn nên có **khung avatar** hiển thị cho mọi ghế, kể cả bot (avatar 2D, không phải 3D). | Hiện tại ghế có đĩa tròn 30 px: người thật hiện ảnh chân dung chụp từ avatar 3D (cache ảnh, không chạy 3D trên bàn), bot hiện một icon SVG chung, người chưa có avatar hiện chữ cái đầu. Không có "khung" rõ ràng và bot không có mặt riêng. | ghi nhận | Đề xuất: (1) ui-kit vẽ khung avatar to hơn, cùng kích cỡ cho mọi ghế (ring ~44 px, stack ~36 px), viền vàng, nền tối; (2) thêm bộ avatar 2D cho bot (ví dụ 8 mặt robot/ký tự SVG, chọn theo tên bot để ổn định); (3) người thật giữ ảnh chân dung như hiện nay (đây là ảnh 2D đã render sẵn, không phải viewer 3D), người chưa có avatar dùng bộ avatar 2D mặc định thay vì chữ cái. Cần xác nhận: bạn muốn người thật cũng chuyển sang avatar 2D thuần (bỏ ảnh chân dung 3D trên bàn) hay chỉ thêm khung + mặt bot? |
