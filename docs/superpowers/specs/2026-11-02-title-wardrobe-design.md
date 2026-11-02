# BP-43 — Bộ trang phục danh hiệu Thần (phần B của BP-42)

Spec thiết kế, 2026-11-02. Đây là **phần B** của spec `2026-10-31-title-entrance-design.md` (mục 6 và 7.2). Phần A (màn ra
mắt, âm thanh, nút tắt tiếng) đã merge ở `8fbcd60` và chạy trên VPS từ 2026-11-02. Spec này không viết lại mục 6. Nó chỉ ghi
những gì người dùng quyết định thêm hôm nay, và những chỗ phiên phải tự chốt vì người dùng giao trọn ("tự lập spec, plan, phát
triển và deploy").

Chỗ ghi **(phiên chọn)** là quyết định của phiên. Người dùng duyệt sau, như các đợt tủ đồ trước.

## 1. Quyết định của người dùng

| # | Câu hỏi | Quyết định |
|---|---|---|
| H6 | Dưới tên ở ghế ghi "Hóa Thần", còn băng ra mắt ghi "Thần Bài". Giữ tên nào? | **"Giữ Thần Bài, đổi caption ghế thành Thần Bài luôn."** Món danh hiệu `title_god` tên tiếng Việt thành "Thần Bài". |
| H7 | Phần B có cần người dùng có mặt (spec BP-42 §7.2)? | **Không.** "Tiếp tục phase vẽ trang phục theo mong muốn trước đó của tôi. Tự lập spec, plan, phát triển và deploy." Phiên tự vẽ qua ChatGPT trong Chrome của người dùng, tự duyệt tranh theo `verify` và mắt mình, rồi deploy. Người dùng vẫn có thể chê từng món sau đó. |

## 2. Đổi tên danh hiệu (H6)

- `items.title_god` (vi): "Hóa Thần" → **"Thần Bài"**. Tên này hiện dưới tên ở ghế, trong tủ đồ và trong phần thưởng của thành
  tựu.
- **Thành tựu** `chaos_god` vẫn tên "Hóa Thần". Thành tựu là việc đã làm (hóa Thần lần đầu), còn danh hiệu là người đó (Thần
  Bài). Phần thưởng của nó hiện "300.000 điểm · Thần Bài".
- Tiếng Anh không đổi (quy tắc "English copy changes only when the user asks").
- `docs/player-guide.md` sửa theo.

## 3. Bộ trang phục

Bảng món và mô tả: spec BP-42 §6. Mã và tên **(phiên chọn)**:

| Danh hiệu | Áo (`outfit`, cắt riêng cho nam) | Đầu (`head`) | Hào quang (`aura`) | Khung (`frame`) |
|---|---|---|---|---|
| Thần Bài (`title_god`) | `outfit_card_god01` Long bào Thần Bài | `head_ace_crown01` Vương miện Át | `aura_card_god01` Hào quang Thần Bài | `frame_card_god` Khung Thần Bài |
| Bán Thần (`title_demigod`) | `outfit_demigod01` Áo choàng Bán Thần | `head_laurel_silver01` Vòng nguyệt quế bạc | `aura_demigod01` Hào quang Bán Thần | `frame_demigod` Khung Bán Thần |
| Kẻ Sát Thần (`title_godslayer`) | `outfit_godslayer01` Giáp Sát Thần | `head_godslayer_helm01` Mũ sừng Sát Thần | `aura_godslayer01` Hào quang Sát Thần | `frame_godslayer` Khung Sát Thần |

- 12 món, 15 tranh (3 áo × 2 dáng). Tất cả `epic`. Không bán trong cửa hàng, không có trong lịch điểm danh.
- **Tên tiếng Anh (phiên viết, chờ người dùng duyệt; viết hoa chữ đầu như các món khác):** Card God's robe, Ace crown,
  Card God's aura, Card God's frame; Demigod's mantle, Silver laurel, Demigod's aura, Demigod's frame; Godslayer's armour,
  Godslayer's horned helm, Godslayer's aura, Godslayer's frame.
- **Chỉnh mô tả tranh cho đường cắt (phiên chọn, theo bài học BP-33/35):**
  - Long bào màu **đỏ thẫm** là chính, vàng chỉ ở viền: vàng nhạt dễ bị nhận là da.
  - Áo Bán Thần **trắng lạnh, xám bạc**, giày bốt bạc kín chân: áo trắng và giày trắng từng mất mảng vào đường cắt da.
  - Áo choàng của cả ba bộ **rủ thẳng sát sau lưng, không rộng hơn tay**: áo choàng xòe từng làm hình to ra (BP-35).
  - Mũ Sát Thần màu **thép xám sáng** viền đỏ thẫm, sừng ngắn cong ra hai bên, một viên đá đỏ phía trước thay cho "mắt đỏ".
    Mũ đen trên tóc bob tím sẫm bị đường cắt khoét lỗ (BP-33), còn mũ cao làm ChatGPT thu nhỏ nhân vật (BP-35).
  - Mọi món đầu vẽ trên tóc bob (`f_bob01`). Vương miện Át và vòng nguyệt quế giữ nguyên toàn bộ tóc, như vòng hoa BP-35.

## 4. Trao bộ cùng danh hiệu

- Thành tựu `chaos_god`, `chaos_demigod`, `chaos_godslayer` trao **cả bộ**: món danh hiệu như hôm nay, cộng 4 món của bộ.
  Cùng một giao dịch với điểm và danh vọng, nên mở khóa vẫn chỉ trả **một lần**.
- Dữ liệu (phiên chọn): `reward.setItems: string[]` trong `achievements.json`, cạnh `reward.itemId`. Lúc khởi động, máy chủ từ
  chối một định nghĩa có `setItems` mà thiếu `itemId`, trùng món, nhắc món không có trong danh mục, hoặc món đang bán trong cửa
  hàng.
- Màn Thành tựu ghi phần thưởng thành "300.000 điểm · Thần Bài · cả bộ trang phục". Thông báo mở khóa hôm nay chỉ nêu tên
  thành tựu, và vẫn giữ như vậy.
- Không có đường tiền mới. Bảo toàn `Σ số dư + Σ sink` không đổi, vì không có dòng sổ nào mới.

## 5. Trao bù (spec BP-42 §6)

- Lệnh `node dist/title-set-backfill-cli.js [--dry-run]` (phiên chọn, giống `reputation-backfill-cli`): ai đang **sở hữu** một
  món danh hiệu (kể cả do GM tặng) thì nhận các món còn thiếu của bộ đó, nguồn `achievement`. Không điểm, không danh vọng,
  không dòng sổ. Chạy lại không trao trùng.
- **VPS:** chạy sau `docker compose up`, `--dry-run` trước, là một bước của deploy này.
- **Máy LAN (Neon):** hỏi người dùng trước.

## 6. Hào quang động (phiên chọn)

- Ba hào quang danh hiệu có chuyển động CSS nhẹ trên lớp aura của chibi:
  - Thần Bài: thở sáng vàng, chu kỳ 3 giây.
  - Bán Thần: lấp lánh, độ sáng nhịp nhanh và nhẹ.
  - Sát Thần: lửa chập chờn, độ sáng không đều.
- Chỉ ba món này. Hào quang cũ không đổi.
- Chỉ chạy trên chibi lớn (ghế, sân khấu, tủ đồ), không trên thẻ lười trong lưới.
- Giảm chuyển động thì đứng yên, kèm test.
- Không thêm dependency, không dùng canvas.

## 7. Ràng buộc

- Các ràng buộc của spec BP-42 §8.
- `avatar:check` xanh.
- Các món vào `items.json` chỉ khi đã có tranh.
- Các từ ổn định của e2e không đổi.
- Chữ không đè chữ.

## 8. Phase sau

- Bài nhạc nền lặp suốt bàn (spec BP-42 §9).
- Tên tiếng Anh của danh hiệu `title_god` đi cùng "Thần Bài", nếu người dùng muốn.
