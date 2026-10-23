# Rà soát câu chữ tiếng Việt, đợt 2 (2026-10-10)

Người dùng yêu cầu ngày 10/10: "check đa ngôn ngữ … có những điểm về ngôn ngữ tiếng việt không phù hợp, không tự nhiên (ví dụ: Tay nóng?). cần sửa toàn bộ."

Đợt này tiếp nối bản rà soát Plan 18 (`docs/copy-review-2026-10.md`). Các quyết định của đợt trước vẫn giữ, trừ khi chính chúng nghe gượng. Đợt trước đã dọn câu hướng dẫn thừa và giọng cứng. Đợt này tìm những chỗ còn **dịch sát từng chữ** từ tiếng Anh, những tên gọi người Việt không dùng ngoài đời và những chỗ viết hoa hoặc dùng từ chưa thống nhất. Mọi dòng trong bảng ở mục 4 đã được áp dụng.

## 1. Tóm tắt

- **Phạm vi đã đọc:** 711 khóa tiếng Việt trong 4 file:
  - `packages/ui-kit/src/i18n/locales/vi/common.json`: 31 khóa
  - `packages/ui-kit/src/i18n/locales/vi/game.json`: 225 khóa
  - `apps/normal-web/src/locales/vi/normal.json`: 410 khóa
  - `apps/lite/web/src/locales/vi/lite.json`: 45 khóa

  Tôi đọc kèm bản tiếng Anh tương ứng để nắm nghĩa. Với những khóa nghĩa chưa rõ, tôi xem thêm chỗ dùng trong code (nhãn hiển thị, aria-label, chuỗi ghép).
- **Số dòng đã sửa:** 31, gồm `common` 4, `game` 9, `normal` 15, `lite` 3. Không thêm và không bỏ khóa nào. Con số này gồm 22 dòng của lượt đầu và 9 dòng thêm sau buổi duyệt cùng ngày. Lượt duyệt cũng sửa lại `errors.NOT_IN_ROOM`.
- **Bản tiếng Anh:** giữ nguyên. Bộ khóa vi/en vẫn trùng nhau; ba test so khóa kiểm tra điều này: `packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts` và `apps/lite/web/src/App.test.tsx`.
- **Chuỗi tiếng Việt viết thẳng trong `.ts/.tsx` (không qua i18n, ngoài test):** không có. Grep dấu tiếng Việt trong `packages/*/src` và `apps/*/src` cho ra khoảng 90 dòng ở 30 file, và tất cả đều nằm trong comment.
- **Các nhãn ổn định** (Bỏ bài, Chơi, Theo, Tố, Lật, Nặn bài, Tạm nghỉ, Hoàn toàn may rủi, Chơi hoặc bỏ, tên lá bài…): không đổi nhãn nào.
- **Bổ sung 2026-10-12 (mục 7):** đợt bổ sung này có đổi cả bản tiếng Anh (bốn mô tả thành tựu `login_days_*`) và thêm đúng một khóa, `wardrobe.hint.dailyFixed`, ở cả hai ngôn ngữ, nên hai ý "giữ nguyên bản tiếng Anh" và "không thêm khóa nào" ở trên chỉ đúng cho các mục 1 đến 6. Mục 8 (cùng ngày, Plan 22) đổi thêm một khóa, thêm hai khóa và bỏ một khóa.

## 2. Quy tắc đã áp dụng

1. **Thành ngữ tiếng Anh đổi sang cách nói của người chơi Việt.** "Hot hand" không phải "Tay nóng". Người chơi bài Việt nói "vận đỏ", "đỏ bài".
2. **Danh hiệu là danh xưng gắn cạnh tên người chơi.** Vì vậy danh hiệu nên là một biệt danh hoặc tên một giải thưởng mà ai cũng nhận ra, như các danh hiệu sẵn có "Tân binh", "Khách quen", "Cú đêm". Không dùng một tính từ dịch từ tiếng Anh: "Bền bỉ" đổi thành "Chuyên cần".
3. **Tên món đồ theo cách gọi ngoài đời**, không ghép nghĩa từng chữ:
   - mũ chóp giấy dự tiệc thì gọi là "mũ sinh nhật";
   - màu da sáng ngả mật ong thì gọi là "da bánh mật";
   - màu tóc tím nhạt thì gọi là "tím pastel", như ở tiệm tóc.
4. **Nói rõ thời điểm.**
   - "Máy chủ khởi động lại" đọc như một câu ra lệnh, nên đổi thành "Máy chủ vừa khởi động lại".
   - Việc chưa xảy ra thì dùng "sắp": "Máy chủ sắp tắt".
   - Khi việc còn có thể thay đổi, dùng "chưa" thay "không": "Chưa đủ người chơi".
   - Khi người chơi vừa mất một thứ đang có, dùng "không còn": "Bạn không còn ở trong phòng".
5. **Bỏ "của bạn" dịch sát chữ "your"** khi câu tiếng Việt không cần đến nó: "Nặn bài của bạn" đổi thành "Mời nặn bài".
6. **Dùng từ thường, bỏ từ kỹ thuật hoặc hành chính:**
   - "trạng thái" đổi thành "thông tin";
   - "đủ điều kiện" đổi thành "thể";
   - "phiên chơi" đổi thành "phiên đăng nhập", cụm quen thuộc trong các app Việt;
   - "Hành động không hợp lệ" đổi thành "Thao tác không hợp lệ", cùng từ với "Bạn thao tác quá nhanh" và "Thao tác này đã được gửi rồi".
7. **Viết hoa kiểu câu:** trong một nhãn chỉ viết hoa chữ đầu, nên "Danh hiệu & Huy hiệu" đổi thành "Danh hiệu & huy hiệu".
8. **Câu nêu quy định dùng "được":** "chỉ được dùng" thay cho "chỉ gồm", vì "chỉ gồm" đọc như đang mô tả một sự thật.
9. **Giữ nguyên:**
   - mọi `{{placeholder}}`, hậu tố `_none` và dấu "—";
   - độ dài tương đương bản cũ:
     - chuỗi tăng nhiều nhất là biên nhận điểm danh `daily.receipt.fallback` (+8 ký tự, một đoạn văn trong hộp biên nhận) và aria-label `outfits.menu` (+7, không hiện trên màn);
     - lời báo lỗi tên hiển thị tăng 6 ký tự, nằm dưới ô nhập nên xuống dòng được;
     - "Mất kết nối" vẫn ngắn hơn "Đang kết nối lại", trạng thái đang dùng chung ô;
     - dòng chờ nặn bài trên bàn ngắn đi 4 ký tự;
     - danh hiệu dài nhất ("Chuyên cần", 10 ký tự) dài bằng "Khách quen" đang có;
   - kiểu đặt dấu thanh của Plan 18 ("Hủy", "Xóa", "Hòa").

## 3. Thuật ngữ giữ nguyên

- **Thao tác trong ván:** Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Lật, Đã lật, Đã chọn, Xem/Bỏ, Theo mọi mức, Tự động chơi.
- **Chế độ và tùy chọn phòng:** Texas Hold'em, Blind Poker, Hoàn toàn may rủi, Chơi hoặc bỏ, Nặn bài, Chờ lật bài, Số lá mỗi người, Cách chơi, Mức cược cố định, Hạn mức, Thời gian mỗi lượt, Số lượng bot, Phòng riêng tư, Tự động bắt đầu.
- **Trong phòng:** Đứng dậy, Tạm nghỉ / Chơi tiếp, Rời phòng, Tạo phòng, Vào phòng, Sẵn sàng / Hủy sẵn sàng, Bắt đầu, Mời ra, Người thắng, Ván bị hủy.
- **Từ poker giữ tiếng Anh:** Blind, Buy-in, Pot, Pot phụ, Stack, BB, Min / ½ pot / Pot (chip mốc của bảng tố, BP-31; chip thứ tư là "Tất tay", không còn "Max").
- **Tên bộ bài:** Mậu thầu, Một đôi, Hai đôi, Sám, Sảnh, Thùng, Cù lũ, Tứ quý, Thùng phá sảnh, Thùng phá sảnh hoàng gia.
- **Tên lá và chất:** Át, Già, Đầm, Bồi; cơ, rô, chuồn, bích.
- **Tính năng và kinh tế:** Số dư (đơn vị luôn là "điểm"), Điểm danh, chuỗi điểm danh, quà điểm danh, Cứu trợ, Cộng dồn, Phí bàn, Chủ phòng, Bot, Cái.
- **Thành tựu:** đạt / chưa đạt. Món đang trang bị: "Đang dùng".
- **Quản trị (Plan 25, 2026-10-18):** màn và hàng ở Cài đặt tên là **"Quản trị"**; người giữ vai trò là **"Quản trị viên"** (số nhiều không đổi). Các tab: Tổng quan, Người chơi, Phòng, Nhật ký (Plan 26 thêm Quà tháng, Plan 27 thêm Cửa hàng; Plan 27 thêm việc **Cộng danh vọng**). Việc làm được: **Khóa tài khoản**, **Mở khóa**, **Cộng/trừ điểm**, **Cấp món**, **Đóng phòng**, **Mời ra** (cùng chữ với nút "Mời ra" của chủ phòng), Trao quyền quản trị / Thu quyền quản trị. Mỗi hành động cần **Lý do** (3–200 ký tự). Dòng sổ điểm: "Quản trị viên cộng điểm", "Quản trị viên trừ điểm". Trạng thái: "Đã khóa". Test e2e `06-gm.spec.ts` và `GmScreen`/`PlayerDetail` bám vào các chữ này.
- **Bàn trên điện thoại xoay ngang (Plan 26, 2026-10-20):** nút ⋯ ở thanh trên có tên **"Thêm"** (menu chứa Đứng dậy, Tạm nghỉ / Chơi tiếp, Quản lý bàn); mục **"Toàn màn hình"** và **"Thoát toàn màn hình"** (chỉ hiện khi trình duyệt cho phép). Từ BP-31 (2026-10-23) điện thoại dọc dùng cùng menu "Thêm"; bảng tố có tên **"Chọn mức cược"**, nhóm chip **"Mức cược"**, thanh trượt **"Thanh trượt mức cược"**, nút đóng **"Hủy"** và nút xác nhận **"Tố N"** / **"Cược N"**; hộp thoại "Nhập số điểm" đã bỏ. Test e2e `07-landscape.spec.ts`, `09-phone.spec.ts` và `RoomScreen`/`ActionBar`/`BetPanel` bám vào các chữ này.
- **Độ hiếm trong chữ cho người chơi (Plan 27, 2026-10-22):** **Thường / Hiếm / Cực hiếm**, không viết "common", "rare" bằng tiếng Anh (ví dụ ô tuần đầu: "1 món thường", "1 món hiếm +200 danh vọng"; cửa hàng dùng cùng chữ). Mã `common`/`rare` chỉ nằm trong dữ liệu và tên khóa.
- **Điểm danh theo tháng (Plan 27, Phần G):** ở bản Normal, màn Điểm danh nói **"Lần điểm danh thứ N của tháng MM/YYYY · không cần liên tiếp"** và **"ô"** cho từng mốc của lịch; "chuỗi điểm danh" chỉ còn dùng cho bản Lite và cho hai thành tựu đếm ngày liên tiếp ("Chuỗi 7 ngày", "Chuỗi 28 ngày") cùng hai dòng thống kê.
- **Cửa hàng, danh vọng và quà tân thủ (Plan 27, 2026-10-22):** màn và nút ở sảnh tên là **"Cửa hàng"** (nút đứng cạnh "Phòng thay đồ", không thành tab thứ năm); kệ đầu trang là **"Kệ tuần này"**; nút mua là **"Mua"** (trên thẻ: "Mua · 30.000"; hộp xác nhận "Mua món này?" với hai nút "Mua" và "Thôi"); bấm thẻ để **"Mặc thử"**, rồi "Về đồ đang mặc" hoặc "Mặc luôn". Con số chỉ tăng là **"Danh vọng"** (không gọi là "điểm danh vọng", vì nó không phải điểm). Năm bậc: **Tân binh, Tay bài, Cao thủ, Bậc thầy, Huyền thoại** (bậc 1 không hiện ra; ở ghế hẹp chỉ hiện số La Mã II–V). Hộp ở lần vào sảnh đầu là **"Quà chào mừng"** (tiêu đề "Chào mừng đến Blind Luck Poker", nút "Nhận", "Để sau", "Vào chơi", "Nhận 100 danh vọng"; nút ở sảnh "🎁 Quà chào mừng"); khung bảy ngày trên màn Điểm danh là **"Tuần đầu tiên"**. Thông báo hết điểm ở bàn: "Bạn đã hết điểm ở bàn này…" (thay cho "Bạn đã dùng hết hạn mức ở bàn này", đã bỏ). Test e2e `08-shop.spec.ts`, `04-blind.spec.ts` (F-10) và `ShopScreen`/`WelcomeDialog`/`NewcomerPanel`/`RankLabel` bám vào các chữ này.
- **Mới chuẩn hóa đợt này:**
  - lỗi thao tác dùng **"Thao tác"** (nhóm nút trên bàn vẫn có aria-label "Hành động", xem mục 5);
  - danh hiệu thắng 10 ván liền là **"Vận đỏ"**;
  - danh hiệu điểm danh 28 ngày liền là **"Chuyên cần"**;
  - mọi trạng thái đứt kết nối dùng **"Mất kết nối"**, không dùng "Mất mạng";
  - thông báo trước khi máy chủ dừng dùng **"Máy chủ sắp tắt"**.

## 4. Các dòng đã sửa

### 4.1 `packages/ui-kit/src/i18n/locales/vi/common.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| errors.ILLEGAL_ACTION | Hành động không hợp lệ | Thao tác không hợp lệ | "Hành động" là dịch sát "action". Các lỗi cùng file đều nói "thao tác" ("Bạn thao tác quá nhanh", "Thao tác này đã được gửi rồi"). |
| errors.NOT_IN_ROOM | Bạn không ở trong phòng | Bạn không còn ở trong phòng | Người chơi chỉ thấy lỗi này khi đang ở màn phòng, ngay sau khi server đã đưa họ ra: `reducer.ts` ẩn nó ở mọi màn khác, và `mustPlayer` trong `room.ts` cũng rơi vào đúng tình huống này. "không còn" nói rõ chuyện vừa xảy ra. Câu cũ dịch sát "You're not in a room" lại mâu thuẫn với cái bàn họ đang nhìn. |
| errors.NOT_ENOUGH_PLAYERS | Không đủ người chơi | Chưa đủ người chơi | Lỗi này hiện khi chủ phòng bấm Bắt đầu sớm. Số người còn tăng lên được, nên dùng "chưa". |
| errors.SERVER_SHUTDOWN | Máy chủ đang tắt | Máy chủ sắp tắt | Thông báo này đến **trước** khi máy chủ dừng (`gateway.ts` từ chối thao tác mới, `server.ts` báo cho các kết nối rồi mới đóng). "đang tắt" dễ đọc thành "đã tắt rồi". Giữ trùng với `game:cancel.shutdown`. |

### 4.2 `packages/ui-kit/src/i18n/locales/vi/game.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| preActions.label | Trước lượt của bạn | Chọn sẵn trước lượt | Đây là aria-label của nhóm nút chọn trước (Xem/Bỏ, Theo mọi mức, Bỏ bài). Câu cũ dịch sát "Before your turn" và không nói nhóm nút dùng để làm gì. |
| labels.holeCards | Số lá riêng | Số lá mỗi người | Khóa này không còn được dùng. Sửa cho khớp với `create.holeCards`, vì Plan 18 đã bỏ "lá riêng" là dịch sát "hole cards". |
| labels.waitSqueeze | Nặn bài của bạn — hết giờ sẽ tự lật | Mời nặn bài — hết giờ sẽ tự lật | "…của bạn" là dịch sát "Squeeze your cards". "Mời" là cách người chia bài mời người chơi, và câu ngắn hơn trên bàn chơi ở khổ điện thoại. |
| status.offline | Mất mạng | Mất kết nối | Kết nối có thể đứt vì phía máy chủ chứ không chỉ vì mạng của người chơi. Cùng chữ với `labels.disconnected` và `room.reconnecting`. |
| create.squeezeHint | Mỗi vòng tối đa 20 giây, hết sớm khi mọi người đã lật. | Mỗi vòng tối đa 20 giây, kết thúc sớm khi mọi người đã lật. | "hết sớm" là khẩu ngữ, đặt cạnh "tối đa 20 giây" thì cụt. "kết thúc sớm" rõ hơn. Chuỗi này chỉ để trình đọc màn hình đọc nên không ảnh hưởng bố cục. |
| room.kicked | Bạn đã bị đuổi khỏi phòng | Bạn đã bị mời ra khỏi phòng | Khóa này không còn được dùng. Plan 18 đã ghi lại: nếu dùng lại thì phải khớp `notify.KICKED` và thuật ngữ "Mời ra". |
| room.hostLeft | Chủ phòng đã rời đi | Chủ phòng đã rời phòng | Khóa này không còn được dùng. "Rời đi" là dịch sát "left", điều mà Plan 18 đã sửa ở phòng thay đồ. |
| cancel.shutdown | Máy chủ đang tắt | Máy chủ sắp tắt | Cùng lý do với `common:errors.SERVER_SHUTDOWN`. Hai chuỗi giữ trùng nhau. |
| cancel.serverRestart | Máy chủ khởi động lại | Máy chủ vừa khởi động lại | Câu cũ không nói rõ thời điểm nên đọc như một mệnh lệnh. Đây là lý do một ván bị hủy, tức chuyện vừa xảy ra. |

### 4.3 `apps/normal-web/src/locales/vi/normal.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| auth.name.chars | Tên hiển thị chỉ gồm chữ, số, dấu cách và _ - . | Tên hiển thị chỉ được dùng chữ, số, dấu cách và _ - . | Đây là thông báo lỗi nêu quy định. "chỉ gồm" đọc như mô tả, "chỉ được dùng" mới là luật. |
| daily.receipt.fallback | Bạn đã có hết vật phẩm của mốc này nên nhận {{amount}} thay thế. | Bạn đã có hết vật phẩm của mốc này nên được nhận {{amount}} thay vào đó. | "nhận … thay thế" bị cụt, không rõ thay cho cái gì. "được nhận … thay vào đó" đọc trọn câu, và "được" cho thấy đây là quyền lợi. |
| daily.relief.error | Không tải được trạng thái cứu trợ | Không tải được thông tin cứu trợ | "trạng thái" là từ kỹ thuật (dịch "status"). Cùng cách nói với "Không tải được thông tin tài khoản". |
| profile.stats.gamesCompleted | Số ván chơi trọn | Số ván chơi trọn vẹn | "chơi trọn" bị cụt. Tên mới cũng khớp với thành tựu "… ván trọn vẹn". |
| wardrobe.tabs.words | Danh hiệu & Huy hiệu | Danh hiệu & huy hiệu | Tiếng Việt viết hoa kiểu câu, không viết hoa từng danh từ như tiếng Anh. Hai tiêu đề con "Danh hiệu", "Huy hiệu" trong tab vẫn viết hoa vì mỗi tiêu đề đứng riêng. |
| outfits.menu | Bộ đồ {{name}} | Tùy chọn cho {{name}} | Đây là aria-label của ảnh bộ đồ đã lưu, nút này mở menu. Tên mặc định là "Bộ {{n}}", nên trình đọc màn hình đọc "Bộ đồ Bộ 1". Nhãn mới nói nút này làm gì. |
| items.head_party_cone01 | Mũ chóp tiệc | Mũ sinh nhật | "party cone hat" ở Việt Nam gọi là mũ sinh nhật. "Mũ chóp tiệc" là ghép nghĩa từng chữ. |
| items.head_party_cone_blue01 | Mũ chóp tiệc xanh dương | Mũ sinh nhật xanh dương | Như trên, cùng độ dài. |
| items.head_party_cone_green01 | Mũ chóp tiệc xanh lá | Mũ sinh nhật xanh lá | Như trên. |
| items.outfit_royal_robe01 | Long bào hoàng gia | Áo bào hoàng gia | "Long bào" là áo rồng của vua, mà hình vẽ không có rồng. "Áo bào" là áo dài kiểu triều phục, còn "hoàng gia" vẫn giữ nghĩa "Royal". |
| items.title_devoted | Bền bỉ | Chuyên cần | Danh hiệu thưởng cho chuỗi điểm danh 28 ngày (và quà điểm danh cố định). "Chuyên cần" là tên quen thuộc của giải thưởng cho người không nghỉ buổi nào. "Bền bỉ" là tính từ dịch từ "Devoted", đứng cạnh tên người chơi thì không thành danh xưng. |
| items.title_hot_hand | Tay nóng | Vận đỏ | Đây là ví dụ người dùng nêu. "Hot hand" là thành ngữ tiếng Anh, người chơi bài Việt nói "đang vận đỏ". Danh hiệu này thưởng cho 10 ván thắng liên tiếp (`win_streak_10`), đúng nghĩa "vận đỏ". |
| items.haircolor_lavender01 | Tóc bạc tím | Tóc tím pastel | Màu này là tím nhạt (`#c7b8f0`), không có ánh bạc. Tiệm tóc Việt gọi là "tím pastel". Tên mới cũng tách rõ với "Tóc tím". |
| items.skin_lighttan01 | Da sáng ấm | Da bánh mật | "sáng ấm" là ghép nghĩa "light" + "tan". Người Việt gọi tông da này là "da bánh mật". Dãy tông da đọc tự nhiên: trắng sứ, sáng, bánh mật, ngăm, nâu, nâu đậm. |
| achievements.login_streak_7.name | Chuỗi bảy ngày | Chuỗi 7 ngày | Đứng ngay cạnh "Chuỗi 28 ngày" trong cùng danh sách, nên viết số cho đồng bộ. |
| auth.heroLead (khóa mới, Plan 26, 2026-10-20) | (mới) | Poker điểm thưởng, chơi với bạn bè. Một tài khoản, mọi thiết bị: điểm, tủ đồ và thành tựu đi theo bạn. (en: Points poker with friends. One account, every device: your points, wardrobe and achievements go with you.) | Câu dẫn đặt trên tranh ở trang đăng nhập, dưới tiêu đề "Blind Luck Poker" (`AuthScreen.tsx`, `p.heroLead`), chỉ hiện từ 1024 px trở lên. Câu đầu nói đây là poker điểm thưởng chơi với bạn, câu sau trả lời "đăng nhập để được gì": mọi thiết bị dùng chung điểm, tủ đồ và thành tựu. Giữ "tủ đồ" và "thành tựu" như tên màn hình trong ứng dụng. Bản en chỉ dịch lại, không đổi ý. |

### 4.4 `apps/lite/web/src/locales/vi/lite.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| daily.errors.NOT_ELIGIBLE | Chưa đủ điều kiện nhận cứu trợ lúc này | Chưa thể nhận cứu trợ lúc này | "đủ điều kiện" là giọng hành chính, và Plan 18 đã bỏ nó ở Normal. Câu mới trùng với `daily.relief.reason.other` của Normal. |
| settings.signOut | Đăng xuất khỏi thiết bị | Đăng xuất khỏi thiết bị này | Câu cũ thiếu "này" nên cụt: đăng xuất khỏi thiết bị nào? Khóa này vừa là nút vừa là tiêu đề hộp thoại. |
| session.expired | Phiên chơi đã hết hạn. Vui lòng nhập lại tên hiển thị. | Phiên đăng nhập đã hết hạn. Vui lòng nhập lại tên hiển thị. | Plan 18 đã bỏ "phiên chơi" ở `prompt.lead` và `settings.signOutConfirm` vì là từ kỹ thuật. "Phiên đăng nhập đã hết hạn" là câu quen thuộc, và cũng là câu Normal đang dùng. |

## 5. Giữ nguyên, đã cân nhắc

Những chuỗi sau thoạt nhìn giống dịch sát nhưng tôi giữ lại:

- **`labels.nextHandIn` "Ván tiếp theo sau" (hiện thành "Ván tiếp theo sau 5 giây"):** đây là cách viết tắt kiểu bảng đếm ngược, người đọc hiểu ngay. "Ván mới bắt đầu sau 5 giây" dài hơn, mà dòng này nằm ở chân thẻ kết quả, chỗ test đè chữ đo bề rộng (No2-1, `overlap.spec.ts`, M-05).
- **`labels.actions` "Hành động":** chỉ là aria-label của khay nút trên bàn, trình đọc màn hình đọc "Hành động, nhóm". Trong game, từ này vẫn tự nhiên ("lượt hành động"). Bảy e2e tìm khay nút bằng tên này.
- **`room.startNeedsYou` "Bấm Sẵn sàng để bắt đầu — ván cần ít nhất một người chơi thật.":** người chơi Việt quen nói "người thật" để phân biệt với bot. Câu đủ rõ.
- **`blind.decision.none` "Hoàn toàn may rủi" và `blind.decision.playOrFold` "Chơi hoặc bỏ":** cả hai đọc tự nhiên, là nhãn ổn định, và tài liệu cùng e2e đều dùng.
- **`preActions.callAny` "Theo mọi mức", `actions.kick` "Mời ra", `labels.dealer` "Cái":** đây là quyết định của Plan 18, vẫn ổn.
- **`errors.INTERNAL` "Đã xảy ra lỗi, vui lòng thử lại":** câu quen thuộc của app Việt.
- **`settings.about.edition` "Ấn bản":** nghe hơi sách vở, nhưng Plan 18 đã để người duyệt quyết, vì phương án sạch hơn (gộp với dòng "Phiên bản" hoặc bỏ dòng) là thay đổi bố cục.
- **`auth.submitSignIn` / Lite `prompt.submit` "Vào sảnh":** giữ theo Plan 18, cùng nghĩa với bản tiếng Anh "Enter the lobby".
- **`wardrobe.tabs.face` "Phụ kiện mặt":** game thời trang Việt vẫn gọi như vậy. Tab gồm kính, mặt nạ và bịt mắt, nên khó có tên ngắn hơn mà vẫn đủ nghĩa.
- **`items.frame_founder` "Khung sáng lập" → "Khung một năm"** (tiếng Anh "Founder frame" → "One-year frame", đổi cùng lúc theo quyết định của người dùng ngày 11/10): khung này là phần thưởng của thành tựu đăng nhập đủ một năm (`login_days_365`), không liên quan "người sáng lập".
  - **Cần người dùng quyết:** khung này là phần thưởng của thành tựu một năm ghé bàn (`login_days_365`), không dành cho người chơi từ ngày đầu.
  - Muốn tên khớp với cách nhận (ví dụ "Khung một năm") thì phải đổi cả bản tiếng Anh. Đó là quyết định sản phẩm, không phải sửa câu chữ.
- **`items.frame_monthly` "Khung tháng", `badge_monthly` "Huy hiệu tháng":** cùng kiểu với cách gọi "thẻ tháng" quen thuộc trong game Việt.
- **`room.hostLeft` "Chủ phòng đã rời phòng":** giữ như đã sửa ở mục 4.2. Khóa này không còn được dùng, nên chỉ cần thống nhất với thuật ngữ "rời phòng" của nút `actions.leave`.
- **`items.outfit_casual01` "Bộ thường ngày", `outfit_champion01` "Bộ nhà vô địch", `outfit_tuxedo01` "Bộ tuxedo":** ba tên này cùng một dãy "Bộ …" và đều tự nhiên.
- **`items.head_tophat01` "Mũ chóp quý ông":** đây là tên gọi kiểu sản phẩm, đọc tự nhiên.
- **`items.hair_m_tousled01` "Tóc rối", `hair_m_neat01` "Tóc gọn":** tên kiểu tóc ngắn, ai cũng hiểu. Plan 18 đã xét và giữ.
- **`achievements.ui.progress` "{{progress}} trên {{threshold}}":** giữ vì khóa này còn là `aria-valuetext` (Plan 18).
- **`achievements.big_win_*.desc` "Ăn 100.000 điểm trong một ván.":** "ăn" là cách người chơi bài nói khi thắng.
- **`profile.ledger.empty` "Chưa có biến động nào.":** "biến động số dư" là cách nói quen của app ngân hàng Việt.
- **`achievements.games_*` "… ván trọn vẹn":** tự nhiên và khớp với mô tả "Chơi hết … ván từ đầu đến cuối".
- **`labels.eligible` "Tham gia", `labels.uncalledReturned` "Hoàn cược dư cho", `labels.carryOver` "Cộng dồn":** Plan 18 đã sửa cho đọc liền mạch trong chuỗi ghép.

## 6. Test, e2e và tài liệu sửa theo

Tôi grep từng chuỗi cũ trong `packages`, `apps`, `docs` và `tooling`. Những chỗ trích nguyên văn chuỗi đang hiển thị được sửa trong cùng commit.

- **Unit test:**
  - `packages/ui-kit/src/table/ActionBar.test.tsx`: dòng nặn bài.
  - `packages/ui-kit/src/table/HandResult.test.tsx`: hai chỗ "Máy chủ vừa khởi động lại".
  - `packages/ui-kit/src/table/PokerTable.test.tsx`: chuỗi mẫu cho danh hiệu cạnh tên, đổi "Tay nóng" thành "Vận đỏ" cho khớp với tên danh hiệu đang có.
  - `packages/ui-kit/src/lobby/CreateRoomForm.test.tsx`: mô tả của ô "Nặn bài" ("…kết thúc sớm khi mọi người đã lật.").
  - Test đọc chuỗi từ bundle thì tự theo: `SavedOutfits.test.tsx`, `WardrobeScreen.test.tsx` (`outfits.menu`), `DailyScreen.test.tsx` (`daily.receipt.fallback`) và Lite `DailyScreen.test.tsx` (`NOT_ELIGIBLE`).
- **E2E (Normal):**
  - `apps/normal-web/e2e/ops/04-blind.spec.ts`: 5 chỗ `getByText('Nặn bài của bạn')` đổi thành `getByText('Mời nặn bài')` (F-11, F-12).
  - `apps/normal-web/e2e/ops/03-holdem.spec.ts`: nhóm `'Trước lượt của bạn'` đổi thành `'Chọn sẵn trước lượt'` (E-06).
  - `apps/normal-web/e2e/wardrobe-layout.spec.ts` và `apps/normal-web/e2e/support.ts`: chữ "Danh hiệu & huy hiệu" trong comment và nhãn báo lỗi. Bước chọn tab vẫn tìm theo `'Danh hiệu'`, nên không đổi.
  - `apps/normal-web/e2e/wardrobe-layout.spec.ts`: hai nút bộ đồ `'Bộ đồ Bộ 1'` và `'Bộ đồ Bộ 5'` đổi thành `'Tùy chọn cho Bộ 1'` và `'Tùy chọn cho Bộ 5'`.
  - `apps/normal-web/e2e/avatar2d.spec.ts`: nút `'Bộ đồ Đi làm'` đổi thành `'Tùy chọn cho Đi làm'`, và comment ngay trên nó.
  - "Mất mạng", "Máy chủ đang tắt", "Long bào", "Chuỗi bảy ngày", "thay thế." và "Số ván chơi trọn": không test hay e2e nào trích các chuỗi này.
- **Tài liệu:**
  - `docs/ui-kit.md`: dòng nặn bài.
  - `docs/operation-test-plan.md`: F-11 (dòng nặn bài); J-08 (tên tab, và thẻ danh hiệu nằm trên tiêu đề "Huy hiệu" đổi thành "Vận đỏ"); J-09 và đoạn đo bố cục (tên tab).
  - `docs/normal-web.md` và `docs/test-matrix.md`: tên tab.
  - `docs/deployment-lite.md`: bảng xử lý sự cố, đổi thành "Phiên đăng nhập đã hết hạn".
  - `docs/acceptance-checklist.md` P21.3: "hết sớm" đổi thành "kết thúc sớm" cho khớp với mô tả của ô "Nặn bài".
  - Comment `apps/normal-web/src/screens/wardrobe/natural-skin.ts`: đổi thành "Da bánh mật".
- **Ghi chú lỗi No11-1** ("Tay nóng" sát "HUY HIỆU") trong `wardrobe-layout.spec.ts`, `wardrobe.module.css` và `docs/ui-kit.md`: vẫn giữ tên cũ vì đó là lỗi đã xảy ra, chỉ ghi thêm tên mới "Vận đỏ" để người đọc tìm được thẻ trên màn.
- **Không sửa, vì đây là bản ghi lịch sử:**
  - `docs/copy-review-2026-10.md`, `docs/bug-log.md`, `CHANGELOG.md`;
  - các file trong `docs/superpowers/` và `docs/test-runs/` (spec, plan và biên bản chạy thử cũ).
- **`docs/acceptance-checklist.md` mục 66.12** ("Hành động không hợp lệ bị từ chối phía server"): đây là câu mô tả yêu cầu, không trích chữ trên giao diện, nên giữ nguyên.

## 7. Bổ sung 2026-10-12

> Cập nhật cùng ngày, Plan 22: `DAILY_FIXED_ITEM_IDS` và `itemRuleForDay` trong `daily-rules.ts`, được nhắc ở 7.1 và 7.2, không còn nữa (lịch quà nay là `apps/normal-server/data/daily-gifts.json`), và `wardrobe.hint.dailyFixed` nhận thêm tham số ngày. Mục 8 ghi lại thay đổi; mục này giữ nguyên như lúc viết.

Rà lại khi đọc hướng dẫn người chơi: bốn mô tả thành tựu nói "đăng nhập" nhưng đếm số lần điểm danh, và một dòng gợi ý trong tủ đồ hứa điều mà quà điểm danh không bao giờ cho. Không thêm hay bỏ khóa nào trong các dòng sửa chữ; riêng gợi ý có thêm một khóa mới, `wardrobe.hint.dailyFixed`, ở cả hai ngôn ngữ.

### 7.1 `apps/normal-web/src/locales/vi/normal.json` và `en/normal.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| achievements.login_days_7.desc | Đăng nhập đủ 7 ngày. (en: Sign in on 7 days.) | Điểm danh đủ 7 ngày. (en: Check in on 7 days.) | `totalLoginDays` chỉ tăng khi server nhận `DAILY_CLAIMED` (`apps/normal-server/src/stats/stats-service.ts`): đăng nhập hai lần trong ngày hay đăng nhập mà không bấm nhận quà đều không tính. Chữ "điểm danh" khớp với việc thật sự được đếm, và với hai thành tựu chuỗi cùng nhóm ("Điểm danh liên tục 7 ngày."). |
| achievements.login_days_30.desc | Đăng nhập đủ 30 ngày. (en: Sign in on 30 days.) | Điểm danh đủ 30 ngày. (en: Check in on 30 days.) | Như trên. |
| achievements.login_days_100.desc | Đăng nhập đủ 100 ngày. (en: Sign in on 100 days.) | Điểm danh đủ 100 ngày. (en: Check in on 100 days.) | Như trên. |
| achievements.login_days_365.desc | Đăng nhập đủ 365 ngày. (en: Sign in on 365 days.) | Điểm danh đủ 365 ngày. (en: Check in on 365 days.) | Như trên. |
| wardrobe.hint.dailyFixed (khóa mới) | không có | Quà điểm danh ngày 28 (en: The day-28 check-in gift) | Huy hiệu tháng (`badge_monthly`) được tặng thẳng ở ngày 28 (`DAILY_FIXED_ITEM_IDS` trong `daily-rules.ts`), nhưng thẻ khóa của nó ghi "Chưa có cách nhận món này". Danh hiệu "Chuyên cần" cũng thuộc cặp quà ngày 28, nhưng cũng là phần thưởng của thành tựu "Chuỗi 28 ngày", và thành tựu vẫn được ưu tiên nên thẻ của nó giữ tên thành tựu. |

Tên thành tựu (`name`) không đổi: "Bảy ngày ghé bàn", "Một năm ghé bàn"… vẫn đúng nghĩa "ghé bàn" (đợt trước, `docs/copy-review-2026-10.md`, đã giữ "Bảy ngày ghé bàn" vì câu tự nhiên), nên chỉ sửa phần mô tả.

### 7.2 Gợi ý "cách nhận" trong tủ đồ (`apps/normal-web/src/screens/catalog.ts`, `hintFor`)

Thay đổi về logic, không phải về chữ: trước đây mọi món ở ô có thể rút (`head`, `face`, `aura`, `frame`, `hairColor`, `eyeColor`) đều nhận `wardrobe.hint.daily.<độ hiếm>`. Quà điểm danh chỉ rút **thường** (ngày 7) và **hiếm** (ngày 14, 21), xem `itemRuleForDay` trong `apps/normal-server/src/economy/daily-rules.ts`; không có ngày nào rút món cực hiếm. Sáu món cực hiếm không thuộc thành tựu nào (`head_tophat01`, `face_eyepatch01`, `aura_lightning01`, `frame_gold`, `haircolor_lavender01`, `eyecolor_gold01`) vì thế đang mang một lời hứa sai.

- Món cực hiếm ở ô rút, không phải phần thưởng thành tựu: **"Chưa có cách nhận món này"** (`wardrobe.hint.unavailable`), thay cho "Có thể nhận từ quà điểm danh (cực hiếm)".
- `badge_monthly`: **"Quà điểm danh ngày 28"** (`wardrobe.hint.dailyFixed`), thay cho "Chưa có cách nhận món này".
- Món thường và hiếm ở ô rút: giữ "Có thể nhận từ quà điểm danh (thường)" và "(hiếm)". Món là phần thưởng thành tựu: vẫn là tên thành tựu.
- Khóa `wardrobe.hint.daily.epic` không còn được dùng nữa, giữ lại trong bundle để khỏi đổi bộ khóa; xóa khi có dịp dọn cả hai ngôn ngữ cùng lúc.
- Test: `apps/normal-web/src/screens/catalog.test.ts` (mới).

### 7.3 Test, e2e và tài liệu trích các chuỗi cũ

Tôi grep các chuỗi cũ ("Đăng nhập đủ", "Sign in on") trong `packages`, `apps`, `docs` và `tooling`. Ngoài hai file ngôn ngữ ở trên không có test, e2e hay tài liệu nào trích nguyên văn (`docs/operation-test-plan.md`, `docs/acceptance-checklist.md` và `docs/test-matrix.md` đều không). Câu "thành tựu đăng nhập đủ một năm" ở mục 5 là lời văn của bản rà soát, không phải chuỗi trên giao diện, nên giữ như một bản ghi lịch sử.

## 8. Bổ sung 2026-10-12, Plan 22 — quà điểm danh theo tháng

`DAILY_FIXED_ITEM_IDS` không còn nữa: cặp quà ngày 28 nay nằm trong lịch quà `apps/normal-server/data/daily-gifts.json`
(spec `docs/superpowers/specs/2026-10-12-monthly-daily-gifts-design.md`). Các khóa thay đổi:

| khóa | trước | sau |
|---|---|---|
| wardrobe.hint.dailyFixed | Quà điểm danh ngày 28 (en: The day-28 check-in gift) | Quà điểm danh ngày {{day}} (en: The day-{{day}} check-in gift). Với ngày 28, chữ hiện ra không đổi |
| wardrobe.hint.dailyMonth (khóa mới) | không có | Quà điểm danh ngày {{day}} tháng {{month}} (en: The day-{{day}} check-in gift of {{month}}); tháng viết `MM/YYYY` |
| daily.marker.fixedDay (khóa mới) | không có | Ngày {{day}} tháng {{month}}: {{items}} (en: Day {{day}} of {{month}}: {{items}}), là dòng chú thích dưới lịch |
| daily.marker.monthly (bỏ) | Huy hiệu + danh hiệu tháng (en: Monthly badge + title) | không còn: ô ngày có quà định sẵn ghi tên từng món, nối bằng " + " |

Sáu món cực hiếm ở mục 7.2 nay đã có cách nhận: quà ngày 28, mỗi tháng một món từ 11/2026. Thẻ khóa của chúng ghi "Quà
điểm danh ngày 28 tháng 11/2026"…, rồi trở lại "Chưa có cách nhận món này" khi tháng của món đã qua.
