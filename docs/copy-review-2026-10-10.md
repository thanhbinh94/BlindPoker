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
- **Số dòng đã sửa:** 22, gồm `common` 3, `game` 6, `normal` 10, `lite` 3. Không thêm và không bỏ khóa nào.
- **Bản tiếng Anh:** giữ nguyên. Bộ khóa vi/en vẫn trùng nhau; ba test so khóa kiểm tra điều này: `packages/ui-kit/src/i18n/i18n.test.ts`, `apps/normal-web/src/locales/locales.test.ts` và `apps/lite/web/src/App.test.tsx`.
- **Chuỗi tiếng Việt viết thẳng trong `.ts/.tsx` (không qua i18n, ngoài test):** không có. Grep dấu tiếng Việt trong `packages/*/src` và `apps/*/src` cho ra khoảng 90 dòng ở 30 file, và tất cả đều nằm trong comment.
- **Các nhãn ổn định** (Bỏ bài, Chơi, Theo, Tố, Lật, Nặn bài, Tạm nghỉ, Hoàn toàn may rủi, Chơi hoặc bỏ, tên lá bài…): không đổi nhãn nào.

## 2. Quy tắc đã áp dụng

1. **Thành ngữ tiếng Anh đổi sang cách nói của người chơi Việt.** "Hot hand" không phải "Tay nóng". Người chơi bài Việt nói "vận đỏ", "đỏ bài".
2. **Danh hiệu là danh xưng gắn cạnh tên người chơi.** Vì vậy danh hiệu nên là một biệt danh hoặc tên một giải thưởng mà ai cũng nhận ra, như các danh hiệu sẵn có "Tân binh", "Khách quen", "Cú đêm". Không dùng một tính từ dịch từ tiếng Anh: "Bền bỉ" đổi thành "Chuyên cần".
3. **Tên món đồ theo cách gọi ngoài đời**, không ghép nghĩa từng chữ:
   - mũ chóp giấy dự tiệc thì gọi là "mũ sinh nhật";
   - màu da sáng ngả mật ong thì gọi là "da bánh mật";
   - màu tóc tím nhạt thì gọi là "tím pastel", như ở tiệm tóc.
4. **Nói rõ thời điểm.** "Máy chủ khởi động lại" đọc như một câu ra lệnh, nên đổi thành "Máy chủ vừa khởi động lại". Khi việc còn có thể thay đổi, dùng "chưa" thay "không": "Chưa đủ người chơi", "Bạn chưa vào phòng nào".
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
   - độ dài tương đương bản cũ: chuỗi tăng nhiều nhất là lời báo lỗi tên hiển thị (+6 ký tự, nằm dưới ô nhập nên xuống dòng được); dòng chờ nặn bài trên bàn ngắn đi 4 ký tự; danh hiệu dài nhất ("Chuyên cần", 10 ký tự) dài bằng "Khách quen" đang có;
   - kiểu đặt dấu thanh của Plan 18 ("Hủy", "Xóa", "Hòa").

## 3. Thuật ngữ giữ nguyên

- **Thao tác trong ván:** Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Lật, Đã lật, Đã chọn, Xem/Bỏ, Theo mọi mức, Tự động chơi.
- **Chế độ và tùy chọn phòng:** Texas Hold'em, Blind Poker, Hoàn toàn may rủi, Chơi hoặc bỏ, Nặn bài, Chờ lật bài, Số lá mỗi người, Cách chơi, Mức cược cố định, Hạn mức, Thời gian mỗi lượt, Số lượng bot, Phòng riêng tư, Tự động bắt đầu.
- **Trong phòng:** Đứng dậy, Tạm nghỉ / Chơi tiếp, Rời phòng, Tạo phòng, Vào phòng, Sẵn sàng / Hủy sẵn sàng, Bắt đầu, Mời ra, Người thắng, Ván bị hủy.
- **Từ poker giữ tiếng Anh:** Blind, Buy-in, Pot, Pot phụ, Stack, BB, Min / ½ / Pot / Max.
- **Tên bộ bài:** Mậu thầu, Một đôi, Hai đôi, Sám, Sảnh, Thùng, Cù lũ, Tứ quý, Thùng phá sảnh, Thùng phá sảnh hoàng gia.
- **Tên lá và chất:** Át, Già, Đầm, Bồi; cơ, rô, chuồn, bích.
- **Tính năng và kinh tế:** Số dư (đơn vị luôn là "điểm"), Điểm danh, chuỗi điểm danh, quà điểm danh, Cứu trợ, Cộng dồn, Phí bàn, Chủ phòng, Bot, Cái.
- **Thành tựu:** đạt / chưa đạt. Món đang trang bị: "Đang dùng".
- **Mới chuẩn hóa đợt này:**
  - lỗi thao tác dùng **"Thao tác"** (nhóm nút trên bàn vẫn có aria-label "Hành động", xem mục 5);
  - danh hiệu thắng 10 ván liền là **"Vận đỏ"**;
  - danh hiệu điểm danh 28 ngày liền là **"Chuyên cần"**.

## 4. Các dòng đã sửa

### 4.1 `packages/ui-kit/src/i18n/locales/vi/common.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| errors.ILLEGAL_ACTION | Hành động không hợp lệ | Thao tác không hợp lệ | "Hành động" là dịch sát "action". Các lỗi cùng file đều nói "thao tác" ("Bạn thao tác quá nhanh", "Thao tác này đã được gửi rồi"). |
| errors.NOT_IN_ROOM | Bạn không ở trong phòng | Bạn chưa vào phòng nào | Dịch sát "You're not in a room". "chưa vào phòng nào" nói đúng tình huống và gợi luôn việc cần làm. |
| errors.NOT_ENOUGH_PLAYERS | Không đủ người chơi | Chưa đủ người chơi | Lỗi này hiện khi chủ phòng bấm Bắt đầu sớm. Số người còn tăng lên được, nên dùng "chưa". |

### 4.2 `packages/ui-kit/src/i18n/locales/vi/game.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| preActions.label | Trước lượt của bạn | Chọn sẵn trước lượt | Đây là aria-label của nhóm nút chọn trước (Xem/Bỏ, Theo mọi mức, Bỏ bài). Câu cũ dịch sát "Before your turn" và không nói nhóm nút dùng để làm gì. |
| labels.holeCards | Số lá riêng | Số lá mỗi người | Khóa này không còn được dùng. Sửa cho khớp với `create.holeCards`, vì Plan 18 đã bỏ "lá riêng" là dịch sát "hole cards". |
| labels.waitSqueeze | Nặn bài của bạn — hết giờ sẽ tự lật | Mời nặn bài — hết giờ sẽ tự lật | "…của bạn" là dịch sát "Squeeze your cards". "Mời" là cách người chia bài mời người chơi, và câu ngắn hơn trên bàn chơi ở khổ điện thoại. |
| room.kicked | Bạn đã bị đuổi khỏi phòng | Bạn đã bị mời ra khỏi phòng | Khóa này không còn được dùng. Plan 18 đã ghi lại: nếu dùng lại thì phải khớp `notify.KICKED` và thuật ngữ "Mời ra". |
| room.hostLeft | Chủ phòng đã rời đi | Chủ phòng đã rời phòng | Khóa này không còn được dùng. "Rời đi" là dịch sát "left", điều mà Plan 18 đã sửa ở phòng thay đồ. |
| cancel.serverRestart | Máy chủ khởi động lại | Máy chủ vừa khởi động lại | Câu cũ không có thì nên đọc như một mệnh lệnh. Đây là lý do một ván bị hủy, tức chuyện vừa xảy ra. |

### 4.3 `apps/normal-web/src/locales/vi/normal.json`

| khóa | hiện tại | sửa thành | lý do |
|---|---|---|---|
| auth.name.chars | Tên hiển thị chỉ gồm chữ, số, dấu cách và _ - . | Tên hiển thị chỉ được dùng chữ, số, dấu cách và _ - . | Đây là thông báo lỗi nêu quy định. "chỉ gồm" đọc như mô tả, "chỉ được dùng" mới là luật. |
| daily.relief.error | Không tải được trạng thái cứu trợ | Không tải được thông tin cứu trợ | "trạng thái" là từ kỹ thuật (dịch "status"). Cùng cách nói với "Không tải được thông tin tài khoản". |
| wardrobe.tabs.words | Danh hiệu & Huy hiệu | Danh hiệu & huy hiệu | Tiếng Việt viết hoa kiểu câu, không viết hoa từng danh từ như tiếng Anh. Hai tiêu đề con "Danh hiệu", "Huy hiệu" trong tab vẫn viết hoa vì mỗi tiêu đề đứng riêng. |
| items.head_party_cone01 | Mũ chóp tiệc | Mũ sinh nhật | "party cone hat" ở Việt Nam gọi là mũ sinh nhật. "Mũ chóp tiệc" là ghép nghĩa từng chữ. |
| items.head_party_cone_blue01 | Mũ chóp tiệc xanh dương | Mũ sinh nhật xanh dương | Như trên, cùng độ dài. |
| items.head_party_cone_green01 | Mũ chóp tiệc xanh lá | Mũ sinh nhật xanh lá | Như trên. |
| items.title_devoted | Bền bỉ | Chuyên cần | Danh hiệu thưởng cho chuỗi điểm danh 28 ngày (và quà điểm danh cố định). "Chuyên cần" là tên quen thuộc của giải thưởng cho người không nghỉ buổi nào. "Bền bỉ" là tính từ dịch từ "Devoted", đứng cạnh tên người chơi thì không thành danh xưng. |
| items.title_hot_hand | Tay nóng | Vận đỏ | Đây là ví dụ người dùng nêu. "Hot hand" là thành ngữ tiếng Anh, người chơi bài Việt nói "đang vận đỏ". Danh hiệu này thưởng cho 10 ván thắng liên tiếp (`win_streak_10`), đúng nghĩa "vận đỏ". |
| items.haircolor_lavender01 | Tóc bạc tím | Tóc tím pastel | Màu này là tím nhạt (`#c7b8f0`), không có ánh bạc. Tiệm tóc Việt gọi là "tím pastel". Tên mới cũng tách rõ với "Tóc tím". |
| items.skin_lighttan01 | Da sáng ấm | Da bánh mật | "sáng ấm" là ghép nghĩa "light" + "tan". Người Việt gọi tông da này là "da bánh mật". Dãy tông da đọc tự nhiên: trắng sứ, sáng, bánh mật, ngăm, nâu, nâu đậm. |

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
- **`create.squeezeHint` "…hết sớm khi mọi người đã lật.":** "hết sớm" là khẩu ngữ tự nhiên (giống "tan học sớm"). Chuỗi này chỉ để trình đọc màn hình đọc, không hiện trên màn.
- **`blind.decision.none` "Hoàn toàn may rủi" và `blind.decision.playOrFold` "Chơi hoặc bỏ":** cả hai đọc tự nhiên, là nhãn ổn định, và tài liệu cùng e2e đều dùng.
- **`preActions.callAny` "Theo mọi mức", `actions.kick` "Mời ra", `labels.dealer` "Cái":** đây là quyết định của Plan 18, vẫn ổn.
- **`errors.SERVER_SHUTDOWN` và `cancel.shutdown` "Máy chủ đang tắt":** câu này đọc theo nghĩa "đang tắt" hay "đã tắt" thì hậu quả với người chơi vẫn như nhau.
- **`errors.INTERNAL` "Đã xảy ra lỗi, vui lòng thử lại":** câu quen thuộc của app Việt.
- **`settings.about.edition` "Ấn bản":** nghe hơi sách vở, nhưng Plan 18 đã để người duyệt quyết, vì phương án sạch hơn (gộp với dòng "Phiên bản" hoặc bỏ dòng) là thay đổi bố cục.
- **`auth.submitSignIn` / Lite `prompt.submit` "Vào sảnh":** giữ theo Plan 18, cùng nghĩa với bản tiếng Anh "Enter the lobby".
- **`wardrobe.tabs.face` "Phụ kiện mặt":** game thời trang Việt vẫn gọi như vậy. Tab gồm kính, mặt nạ và bịt mắt, nên khó có tên ngắn hơn mà vẫn đủ nghĩa.
- **`items.frame_founder` "Khung sáng lập", `frame_monthly` "Khung tháng", `badge_monthly` "Huy hiệu tháng":** cùng kiểu với cách gọi "thẻ tháng" quen thuộc trong game Việt. "Sáng lập" giữ đúng nghĩa "Founder" của bản tiếng Anh.
- **`items.outfit_casual01` "Bộ thường ngày", `outfit_champion01` "Bộ nhà vô địch", `outfit_tuxedo01` "Bộ tuxedo":** ba tên này cùng một dãy "Bộ …" và đều tự nhiên.
- **`items.head_tophat01` "Mũ chóp quý ông", `outfit_royal_robe01` "Long bào hoàng gia":** đây là tên gọi kiểu sản phẩm, đọc tự nhiên.
- **`items.hair_m_tousled01` "Tóc rối", `hair_m_neat01` "Tóc gọn":** tên kiểu tóc ngắn, ai cũng hiểu. Plan 18 đã xét và giữ.
- **`achievements.ui.progress` "{{progress}} trên {{threshold}}":** giữ vì khóa này còn là `aria-valuetext` (Plan 18).
- **`achievements.big_win_*.desc` "Ăn 100.000 điểm trong một ván.":** "ăn" là cách người chơi bài nói khi thắng.
- **`profile.ledger.empty` "Chưa có biến động nào.":** "biến động số dư" là cách nói quen của app ngân hàng Việt.
- **`profile.stats.gamesCompleted` "Số ván chơi trọn", `achievements.games_*` "… ván trọn vẹn":** tự nhiên và khớp với mô tả "Chơi hết … ván từ đầu đến cuối".
- **`labels.eligible` "Tham gia", `labels.uncalledReturned` "Hoàn cược dư cho", `labels.carryOver` "Cộng dồn":** Plan 18 đã sửa cho đọc liền mạch trong chuỗi ghép.

## 6. Test, e2e và tài liệu sửa theo

Tôi grep từng chuỗi cũ trong `packages`, `apps`, `docs` và `tooling`. Những chỗ trích nguyên văn chuỗi đang hiển thị được sửa trong cùng commit.

- **Unit test:**
  - `packages/ui-kit/src/table/ActionBar.test.tsx`: dòng nặn bài.
  - `packages/ui-kit/src/table/HandResult.test.tsx`: hai chỗ "Máy chủ vừa khởi động lại".
  - `packages/ui-kit/src/table/PokerTable.test.tsx`: chuỗi mẫu cho danh hiệu cạnh tên, đổi "Tay nóng" thành "Vận đỏ" cho khớp với tên danh hiệu đang có.
- **E2E (Normal):**
  - `apps/normal-web/e2e/ops/04-blind.spec.ts`: 5 chỗ `getByText('Nặn bài của bạn')` đổi thành `getByText('Mời nặn bài')` (F-11, F-12).
  - `apps/normal-web/e2e/ops/03-holdem.spec.ts`: nhóm `'Trước lượt của bạn'` đổi thành `'Chọn sẵn trước lượt'` (E-06).
  - `apps/normal-web/e2e/wardrobe-layout.spec.ts` và `apps/normal-web/e2e/support.ts`: chữ "Danh hiệu & huy hiệu" trong comment và nhãn báo lỗi. Bước chọn tab vẫn tìm theo `'Danh hiệu'`, nên không đổi.
- **Tài liệu:**
  - `docs/ui-kit.md`: dòng nặn bài.
  - `docs/operation-test-plan.md`: F-11 (dòng nặn bài); J-08 (tên tab, và thẻ danh hiệu nằm trên tiêu đề "Huy hiệu" đổi thành "Vận đỏ"); J-09 và đoạn đo bố cục (tên tab).
  - `docs/normal-web.md` và `docs/test-matrix.md`: tên tab.
  - `docs/deployment-lite.md`: bảng xử lý sự cố, đổi thành "Phiên đăng nhập đã hết hạn".
  - Comment `apps/normal-web/src/screens/wardrobe/natural-skin.ts`: đổi thành "Da bánh mật".
- **Ghi chú lỗi No11-1** ("Tay nóng" sát "HUY HIỆU") trong `wardrobe-layout.spec.ts`, `wardrobe.module.css` và `docs/ui-kit.md`: vẫn giữ tên cũ vì đó là lỗi đã xảy ra, chỉ ghi thêm tên mới "Vận đỏ" để người đọc tìm được thẻ trên màn.
- **Không sửa, vì đây là bản ghi lịch sử:**
  - `docs/copy-review-2026-10.md`, `docs/bug-log.md`, `CHANGELOG.md`;
  - các file trong `docs/superpowers/` và `docs/test-runs/` (spec, plan và biên bản chạy thử cũ).
- **`docs/acceptance-checklist.md` mục 66.12** ("Hành động không hợp lệ bị từ chối phía server"): đây là câu mô tả yêu cầu, không trích chữ trên giao diện, nên giữ nguyên.
