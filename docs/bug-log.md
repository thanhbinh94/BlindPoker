# Nhật ký lỗi (giai đoạn test nội bộ)

Ghi nhận từ 2026-09-08. Chỉ sửa khi người dùng báo "fix". Trạng thái: `ghi nhận` → `sẽ sửa` → `đã sửa (commit)` / `không sửa (lý do)`.

| # | Ngày | Mô tả | Phân loại | Trạng thái | Ghi chú kỹ thuật |
|---|---|---|---|---|---|
| 1 | 2026-09-08 | Tạo phòng Blind với mức cược 5.000 nhưng các bot trong phòng hiển thị 1.000.000. | **Đúng thiết kế, nhưng gây hiểu nhầm (UX)** | đã sửa theo hướng (a) | 1.000.000 là **số dư ảo của bot** (`botStartingBalance` trong `packages/server-kit/src/room/types.ts`, spec §8.5: bot bắt đầu 1.000.000, tự nạp lại khi < 2×cược, không tính vào kinh tế người chơi). "Wager 5,000" là mức cược cố định mỗi ván; ở Blind Poker ghế hiển thị số dư nên bot khoe cả 1.000.000. Hướng sửa nếu muốn: (a) ẩn số dư của bot trên ghế (chỉ hiện "Bot"), hoặc (b) đặt số dư ảo của bot = 50×cược của phòng để con số hợp ngữ cảnh, hoặc (c) hiển thị stack theo ván thay vì số dư. Người dùng chọn (a) ngày 2026-09-08: ghế bot và danh sách kick không hiện số dư nữa, chỉ còn nhãn "Bot"; tiền cược mỗi street và tiền thắng của bot vẫn hiện. Áp dụng cho cả Hold'em và Blind (số dư ảo của bot không có ý nghĩa ở mode nào). Bản Lite cần `pnpm build:lite` để nhận thay đổi. |
