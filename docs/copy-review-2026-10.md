# No9: Rà soát câu chữ tiếng Việt

Review 2026-09-29, mục No9, thuộc Đợt 2 (Plan 18). Người dùng duyệt ngày 01/10: "Đợt 2 làm theo đề xuất của bạn luôn".

**Ghi chú 2026-10-04 (Plan 19, nhân vật v4):** tài liệu này ghi lại quyết định của Plan 18 và giữ nguyên như một bản ghi lịch sử. Tab "Nhân vật" (`wardrobe.tabs.base`) và các khóa `bases.*` mà nó nhắc tới đã bị bỏ cùng các thân phẳng; nhóm "Ngoại hình" có nút Nữ | Nam và các tab Kiểu tóc, Màu tóc, Màu da, Màu mắt thay vào đó (`docs/normal-web.md`). `avatar.errors.INVALID_BASE` còn lại, giữ chữ "Nhân vật không hợp lệ", nhưng nay chỉ báo lỗi khi một cấu hình v4 còn mang trường `base`.

Bảng dưới là bản đề xuất. Plan 18, Task 1 áp dụng nguyên văn, trừ các điểm sau:

- **Không áp dụng `inventory.*`:** màn Kho đồ bị gộp vào Phòng thay đồ (No5, Task 3), nên các khóa `inventory.lead`, `inventory.summary` và `inventory.source.*` bị xóa cùng màn.
  - `inventory.rarity.*` và `inventory.error` giữ nguyên, vì Phòng thay đồ vẫn dùng. `inventory.error` đổi chữ cho đúng màn đang hiện nó: vi "Không tải được phòng thay đồ", en "Could not load the wardrobe" (đợt sửa cuối Plan 18; ngoại lệ của mục "Bản tiếng Anh" bên dưới).
  - `auth.lead` (bảng 2.3) áp dụng với "trang phục" thay "kho đồ": "Một tài khoản, chơi trên mọi thiết bị — điểm, trang phục và thành tựu luôn đi theo bạn." Màn Kho đồ không còn, nên câu chào không nhắc tới nó (đợt sửa cuối Plan 18).
- **Giữ nguyên `achievements.ui.progress` ("{{progress}} trên {{threshold}}"):** khóa này còn là `aria-valuetext` của thanh tiến độ. Viết "3/7" thì trình đọc màn hình đọc thành "3 gạch chéo 7".
- **Chưa làm:**
  - các mục ở phần "Chỗ còn mơ hồ" (Ấn bản, nhãn ổ khóa, nút "Vào sảnh");
  - dọn các khóa không dùng ở phần cuối, để một đợt dọn dẹp riêng.
- **Ô tích No11a:** dùng phương án 1, "Hiện cả món chưa có" (Task 2).
- **Bản tiếng Anh:** chỉ đổi khi một khóa bị xóa, để giữ hai bộ khóa trùng nhau.

## 1. Tóm tắt

- **Phạm vi đã đọc:** 698 khóa tiếng Việt trong 4 file: `common.json` (31), `game.json` (215), `normal.json` (407), `lite.json` (45). Khoảng 647 khóa đang được giao diện dùng; 51 khóa không còn chỗ nào gọi tới (xem mục 4). Tôi đọc kèm bản tiếng Anh tương ứng và xem chỗ dùng của từng khóa khi nghĩa chưa rõ.
- **Chuỗi tiếng Việt viết thẳng trong TSX (không qua i18n):** không có. Mọi chỗ có dấu tiếng Việt trong `.ts/.tsx` (ngoài test) đều chỉ là comment.
- **Số đề xuất:** 102 dòng cần sửa, trong đó có 3 dòng đề xuất **bỏ**: `settings.theme.lead`, `settings.language.lead`, `inventory.lead`.
- **Các kiểu lỗi chính đã sửa:**
  1. **Hướng dẫn thừa:** câu giải thích điều người dùng tự thấy trên giao diện (ghi chú ở Cài đặt, ghi chú ở Kho đồ, "Lịch vừa được tải lại", "nên chưa cần đến nó").
  2. **Dịch sát từ tiếng Anh:** "Thân nền", "Số lá riêng", "Kiểu quyết định", "Ngồi ngoài", "Những người thắng", "Đó đã là…", "Trạng thái đã cũ", "{{x}} trên {{y}}", "Một món không…".
  3. **Thuật ngữ chưa thống nhất:**
     - Số dư: chỗ ghi "Số điểm", chỗ ghi "Số dư".
     - Mời khỏi phòng: chỗ ghi "Đuổi", chỗ ghi "mời khỏi".
     - Tạm nghỉ: nút ghi "Ngồi ngoài" trong khi nhãn trên ghế là "Tạm nghỉ".
     - Thùng phá sảnh: chỗ ghi "vua", chỗ ghi "hoàng gia".
     - Thành tựu: đang dùng "Mở", nên đổi sang "Đạt".
     - Cách viết dấu: "Xoá" lệch với "Hủy".
     - Nhãn trùng nhau: nhóm "Trang phục" chứa một tab cũng tên "Trang phục".
  4. **Giọng cứng hoặc nặng nề:** "Đuổi", "xin nạp lại", "Rời đi mà không lưu?", "Bỏ qua và rời đi". Đổi sang giọng nhẹ nhàng và tự nhiên hơn, kiểu một game bài trên điện thoại.
- **Không đổi:** khóa, placeholder `{{…}}`, hậu tố `_none`, con số và luật chơi. Các thuật ngữ game đã quen thuộc được giữ nguyên (xem mục 4).

---

## 2. Đề xuất theo file

### 2.1 `packages/ui-kit/src/i18n/locales/vi/common.json` (dùng chung cho Normal và Lite)

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| errors.INVALID_ROOM_CONFIG | Cấu hình phòng không hợp lệ | Thiết lập phòng không hợp lệ | "Cấu hình" là từ kỹ thuật. Người chơi vừa "thiết lập" phòng ở form Tạo phòng. |
| errors.STALE_STATE | Trạng thái đã cũ, vui lòng thử lại | Bàn vừa thay đổi, vui lòng thử lại | "Trạng thái đã cũ" là ngôn ngữ của lập trình viên. Câu mới vẫn nêu đúng nguyên nhân. |
| errors.DUPLICATE_REQUEST | Yêu cầu bị trùng | Thao tác này đã được gửi rồi | Nói rõ chuyện gì xảy ra với người chơi. |
| errors.ALREADY_IN_ROOM | Bạn đã ở trong một phòng khác | Bạn đang ở trong một phòng khác | "đã ở" là dịch sát "already". Ở đây "đang ở" mới đúng nghĩa. |
| errors.DISPLAY_NAME_TAKEN | Tên hiển thị đã được dùng | Tên hiển thị đã có người dùng | Thống nhất với `auth.errors.*` (Normal) và `prompt.errors.*` (Lite). |

### 2.2 `packages/ui-kit/src/i18n/locales/vi/game.json` (bàn chơi, sảnh, tạo phòng; dùng chung)

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| actions.notReady | Chưa sẵn sàng | Hủy sẵn sàng | Đây là nhãn của **nút** hiện ra khi đã sẵn sàng. Nhãn nút nên là hành động, không phải trạng thái. |
| actions.kick | Đuổi | Mời ra | "Đuổi" nặng nề. Khớp với `notify.KICKED`. Chuỗi aria "Mời ra — {tên}" vẫn đủ rõ. |
| labels.eligible | Được chia | Tham gia | Hiển thị "Được chia: A, B" dễ bị hiểu là đã được chia điểm. Thực ra đây là danh sách những người tranh pot đó. |
| labels.uncalledReturned | Hoàn lại phần cược dư | Hoàn cược dư cho | Code ghép thành "{nhãn} {tên} {số}". Với nhãn mới, câu đọc liền mạch: "Hoàn cược dư cho Minh 2.000". |
| labels.winners | Những người thắng | Người thắng | Tiếng Việt không cần "những" để chỉ số nhiều. Tiêu đề thẻ kết quả gọn hơn. |
| labels.waitDecided | Đã chọn — chờ các ghế khác | Đã chọn — chờ người chơi khác | "các ghế khác" là dịch sát. |
| hand.royalFlush | Thùng phá sảnh vua | Thùng phá sảnh hoàng gia | Thống nhất với thành tựu `hand_royal`; đây cũng là tên quen dùng. Cần kiểm tra độ dài trên thẻ kết quả (xem mục 4). |
| lobby.empty | Chưa có phòng nào — hãy tạo một phòng. | Chưa có phòng nào. Tạo phòng mới để bắt đầu nhé! | Màn trống nên thân thiện và mời gọi. |
| create.holeCards | Số lá riêng | Số lá mỗi người | "lá riêng" dịch sát "hole cards". Blind Poker chia mỗi người 2 hoặc 3 lá. |
| create.decisionMode | Kiểu quyết định | Cách chơi | Hai lựa chọn bên dưới là "Chơi hoặc bỏ" và "Hoàn toàn may rủi", nên "Cách chơi" tự nhiên hơn. |
| blind.decision.none | Thuần may rủi | Hoàn toàn may rủi | "Thuần may rủi" nghe gượng. |
| create.hint.buyIn | Buy-in tối thiểu phải nhỏ hơn hoặc bằng buy-in tối đa. | Buy-in tối thiểu không được lớn hơn buy-in tối đa. | Gọn hơn, bớt giọng toán học. |
| room.sitOut | Ngồi ngoài | Tạm nghỉ | Dịch sát "Sit out". Khớp với nhãn ghế `labels.sittingOut` = "Tạm nghỉ". |
| room.sitIn | Vào lại | Chơi tiếp | Cặp với "Tạm nghỉ". "Vào lại" dễ nhầm với vào lại phòng. |
| room.buyInTitle | Chọn mức mang vào | Chọn số điểm mang vào bàn | "mức mang vào" thiếu đối tượng. |
| room.sitFirst | Hãy ngồi vào bàn để chơi. | Chọn một ghế trống để vào chơi. | Chỉ rõ cần làm gì, giống cách `notify.TABLE_LIMIT_SPENT` đang nói (khóa đó đã bỏ ở Plan 27, xem hai dòng dưới). |
| notify.KICKED | Bạn đã bị mời khỏi phòng | Bạn đã bị mời ra khỏi phòng | Thiếu chữ "ra". Thống nhất với `actions.kick`. |
| notify.ACHIEVEMENT_UNLOCKED | Mở khóa thành tựu: {{id}} | Đạt thành tựu mới: {{id}} | Thống nhất động từ "đạt" cho thành tựu (xem mục 2.3). |
| notify.TABLE_LIMIT_SPENT | Bạn đã dùng hết hạn mức ở bàn này — {{amount}} điểm còn lại đã về số dư. Chọn một ghế trống để vào lại. | Bạn đã dùng hết hạn mức ở bàn này, {{amount}} điểm còn lại đã được trả về số dư. Chọn ghế trống để chơi tiếp. | "đã về số dư" là văn nói và cụt. "vào lại" đổi thành "chơi tiếp" cho khớp với `room.sitIn`. Plan 27 (2026-10-22) bỏ khóa này cùng luật hết hạn mức: ghế chơi tới 0 rồi nhận `notify.STACK_SPENT` "Bạn đã hết điểm ở bàn này. Nhận Cứu trợ nếu số dư dưới {{threshold}} điểm, hoặc chọn ghế trống khi có điểm." |
| notify.TABLE_LIMIT_SPENT_none | Bạn đã dùng hết hạn mức ở bàn này. Chọn một ghế trống để vào lại. | Bạn đã dùng hết hạn mức ở bàn này. Chọn ghế trống để chơi tiếp. | Giống dòng trên (cũng đã bỏ ở Plan 27). |

### 2.3 `apps/normal-web/src/locales/vi/normal.json` (bản Normal)

**Đăng nhập / đăng ký**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| auth.lead | Một tài khoản, mọi thiết bị. Điểm, kho đồ và thành tựu của bạn theo tài khoản chứ không theo máy. | Một tài khoản, chơi trên mọi thiết bị — điểm, kho đồ và thành tựu luôn đi theo bạn. | Vế "theo tài khoản chứ không theo máy" dịch sát và vụng. |
| auth.passwordHint | 8–128 ký tự, khác với email của bạn. | 8–128 ký tự, không trùng với email. | Tự nhiên và gọn hơn. Đúng luật: không trùng địa chỉ email, cũng không trùng phần trước `@`. |
| auth.errors.INVALID_PASSWORD | Mật khẩu cần 8–128 ký tự và khác với email của bạn | Mật khẩu cần 8–128 ký tự và không trùng với email | Khớp với gợi ý ở dòng trên. |
| auth.errors.EMAIL_TAKEN | Email này đã có tài khoản | Email này đã được đăng ký | Cách nói quen thuộc của các app Việt. |

**Điểm danh / cứu trợ**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| daily.lead | Mỗi ngày một lần. Chuỗi càng dài thì phần thưởng càng lớn, và sang tháng mới chuỗi bắt đầu lại từ ngày 1. | Điểm danh mỗi ngày để nhận thưởng. Chuỗi càng dài, thưởng càng lớn; sang tháng mới, chuỗi tính lại từ ngày 1. | Giữ lại vì luật này người chơi không tự suy ra được, chỉ viết gọn hơn. Câu mở đầu "Mỗi ngày một lần." bị cụt. |
| daily.resetsAt | Ngày mới bắt đầu lúc {{at}} | Lần điểm danh tiếp theo: {{at}} | Người chơi cần biết **khi nào điểm danh được tiếp**, không cần biết "ngày mới bắt đầu". |
| daily.calendarTitle | Lịch 31 ngày | Lịch điểm danh | "31 ngày" là chi tiết cài đặt và lệch với tháng 28–30 ngày. Khóa này đồng thời là aria-label của danh sách. |
| daily.calendarLead | Số điểm nhận ở mỗi ngày của chuỗi; ô có hộp quà còn kèm vật phẩm. | Số điểm thưởng cho từng ngày trong chuỗi. | Vẫn cần giữ, vì các ô lịch chỉ in con số mà không có chữ "điểm". Bỏ vế hộp quà vì chú thích (legend) ngay bên dưới đã giải thích. |
| daily.receipt.fallback | Bậc này đã hết vật phẩm mới cho bạn — nhận {{amount}} thay cho vật phẩm. | Bạn đã có hết vật phẩm của mốc này nên nhận {{amount}} thay thế. | "Bậc này đã hết vật phẩm mới cho bạn" vừa khó hiểu vừa dịch sát. |
| daily.receipt.streak | Chuỗi sau khi nhận: {{streak}} ngày | Chuỗi điểm danh: {{streak}} ngày | "sau khi nhận" thừa, vì đây là biên nhận hiện ra ngay sau khi nhận. |
| daily.errors.ALREADY_CLAIMED | Phần thưởng hôm nay đã được nhận rồi, có thể từ một thiết bị khác. Lịch vừa được tải lại. | Hôm nay bạn đã nhận thưởng rồi (có thể trên thiết bị khác). | Bỏ "Lịch vừa được tải lại" vì đó là chi tiết hệ thống; code vẫn tự tải lại lịch. Chuyển sang câu chủ động. |
| daily.relief.lead | Khi số dư xuống dưới {{threshold}}, bạn có thể xin nạp lại lên {{target}}. | Khi số dư dưới {{threshold}}, bạn có thể nhận cứu trợ để số dư trở lại {{target}}. | "xin nạp lại" gợi cảm giác phải nạp tiền. |
| daily.relief.eligible | Bạn đủ điều kiện nhận cứu trợ ngay bây giờ. | Bạn có thể nhận cứu trợ ngay bây giờ. | Bớt giọng hành chính. |
| daily.relief.reason.balance | Số dư của bạn vẫn trên mức cứu trợ, nên chưa cần đến nó. | Số dư của bạn chưa xuống dưới mức cứu trợ. | Vế "nên chưa cần đến nó" dịch sát và thừa. |
| daily.relief.reason.cooldown | Bạn vừa nhận cứu trợ. Thử lại lúc {{at}}. | Bạn vừa nhận cứu trợ, có thể nhận lại lúc {{at}}. | "Thử lại" nghe như vừa gặp lỗi. |

**Cài đặt**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| settings.theme.lead | Nền tối là mặc định của bàn chơi; nền sáng dành cho nơi nhiều ánh sáng. | **(bỏ)** | Theo yêu cầu No9: người dùng tự hiểu "Tối / Sáng". Đang dùng ở `SettingsScreen.tsx:46`: xóa dòng `<p className={s.footnote}>…</p>` và xóa khóa ở cả vi lẫn en. Nút chọn vẫn có nhãn riêng là `settings.theme.title`. |
| settings.language.lead | Ngôn ngữ được nhớ trên thiết bị này. | **(bỏ)** | Theo yêu cầu No9. Đang dùng ở `SettingsScreen.tsx:62`: xóa dòng `<p>` và khóa ở vi + en. `LanguageSwitch` vẫn có nhãn riêng là `game:nav.language`. |
| settings.signOut.body | Bạn sẽ rời khỏi bàn đang chơi và cần đăng nhập lại trên thiết bị này. | Bạn sẽ rời bàn đang ngồi (nếu có) và cần đăng nhập lại để chơi tiếp. | Câu hiện tại mặc định là người chơi đang ngồi ở bàn, nhưng hộp thoại này cũng hiện khi họ không ngồi bàn nào. |
| settings.signOut.cancel | Ở lại | Hủy | Cặp nút quen thuộc là [Hủy] [Đăng xuất]. "Ở lại" chỉ hợp khi đang rời một trang. |

**Hồ sơ / lịch sử điểm**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| profile.memberSince | Thành viên từ {{date}} | Tham gia từ {{date}} | Cách nói quen thuộc. "Thành viên từ" dịch sát "Member since". |
| profile.balance | Số điểm | Số dư | Thống nhất với `game:labels.balance`, "Số dư mới", "Số dư không đủ". Cách cũ còn tạo ra "Số điểm 123.000 điểm", lặp chữ "điểm". |
| profile.rename.saved | Đã lưu. Bàn chơi vẫn giữ tên cũ cho tới lần bạn vào phòng kế tiếp. | Đã đổi tên! Tên mới sẽ hiện ở bàn từ lần vào phòng tiếp theo. | Nói điều sẽ xảy ra theo hướng tích cực, câu tự nhiên hơn. |
| profile.rename.same | Đó đã là tên hiển thị của bạn | Bạn đang dùng tên này rồi | "Đó đã là…" dịch sát "That is already…". |
| profile.stats.groups.streaks | Chuỗi | Chuỗi thắng/thua | "Chuỗi" đứng một mình làm tiêu đề nhóm thì tối nghĩa. Nhóm này gồm chuỗi thắng và chuỗi thua. |
| profile.stats.groups.social | Tại bàn | Hoạt động | "Tại bàn" dịch sát "At the table" và cụt khi làm tiêu đề. Nhóm này gồm số ván có bot, số phòng đã vào và số ván chơi trọn. |
| ledger.reason.settlement | Chia điểm cuối ván | Kết quả ván | Dòng sổ điểm đã có dấu +/−. "Kết quả ván" vừa gọn vừa tự nhiên. |
| ledger.reason.daily_item_fallback | Thưởng hằng ngày, hết món để tặng | Điểm danh (điểm thay vật phẩm) | "hết món để tặng" nghe như hệ thống hết hàng. Thực tế là người chơi đã có hết vật phẩm nên nhận điểm thay. |

**Kho đồ**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| inventory.lead | Tất cả những gì tài khoản này sở hữu. Món đang mặc được đánh dấu. | **(bỏ)** | Tiêu đề "Kho đồ" và nhãn trên thẻ đã nói đủ. Đang dùng ở `InventoryScreen.tsx:132`: xóa `<p>` và khóa ở vi + en. Dòng `inventory.summary` ngay bên dưới vẫn giữ. |
| inventory.summary | Đang sở hữu {{owned}} món | Bạn có {{owned}} món | Thân thiện, đỡ cứng hơn. |
| inventory.source.default | Khởi đầu | Có sẵn | Dịch "Starter". "Khởi đầu" đứng một mình đọc như danh từ "sự khởi đầu". |
| inventory.source.daily | Điểm danh hằng ngày | Điểm danh | Hiện trên thẻ nhỏ. Chữ "hằng ngày" thừa. |

**Phòng thay đồ / nhân vật**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| avatar.errors.NOT_OWNED | Bạn chưa sở hữu một trong các món đó | Có món bạn chưa sở hữu | "một trong các món đó" dịch sát "one of those pieces". |
| avatar.errors.WRONG_CATEGORY | Một món không thuộc ô bạn chọn | Có món không đúng vị trí | Câu mở đầu bằng "Một món" là dịch sát. Lỗi vẫn nêu cụ thể. |
| avatar.errors.MISSING_LAYER | Trang phục cần một món | Nhân vật cần mặc một bộ quần áo | Câu cũ không ai hiểu. Lỗi này xảy ra khi ô quần áo bị bỏ trống. |
| avatar.errors.INVALID_ITEM | Một món không có trong danh mục | Có món không tồn tại trong danh mục | Cùng lý do với WRONG_CATEGORY. |
| avatar.errors.INVALID_BASE | Thân nền không hợp lệ | Nhân vật không hợp lệ | Theo thuật ngữ mới của `wardrobe.tabs.base`. |
| wardrobe.tabs.base | Thân nền | Nhân vật | "Thân nền" dịch sát "Base". Game Việt hay dùng "Nhân vật". Đây cũng là nhãn hàng đầu trong danh sách "Đang dùng". Lưu ý No13 có thể tách lại tab này (xem mục 4). |
| wardrobe.tabs.outfit | Trang phục | Quần áo | Tránh nhãn trùng: nhóm "Trang phục" đang chứa một tab cũng tên "Trang phục". Các món trong tab này là áo phông, áo dài, tuxedo, long bào…, gọi "Quần áo" là đúng. |
| wardrobe.wearingBadge | Đang mặc | Đang dùng | Nhãn này gắn cả lên hào quang, khung, danh hiệu, huy hiệu, màu mắt; "mặc" một danh hiệu là sai nghĩa. Dòng aria của thẻ cũng dùng khóa này. |
| wardrobe.equipped.title | Đang mặc | Đang dùng | Danh sách này gồm Nhân vật, Màu tóc, Màu mắt, Khung, Danh hiệu… Cùng lý do với dòng trên. |
| wardrobe.equipped.count | Đang mặc ({{n}}) | Đang dùng ({{n}}) | Như trên (phần tóm tắt trên điện thoại). |
| wardrobe.expression.legend | Biểu cảm xem trước | Xem thử biểu cảm | Đây là aria-label của nhóm nút. "Biểu cảm xem trước" là dịch sát. |
| wardrobe.hint.daily.common | Có thể rút từ điểm danh hằng ngày (thường) | Có thể nhận từ quà điểm danh (thường) | "rút" nghe như rút thăm hoặc rút tiền. Câu mới ngắn hơn, đỡ tràn dòng trên thẻ khóa. Khớp với hộp quà trên lịch điểm danh. |
| wardrobe.hint.daily.rare | Có thể rút từ điểm danh hằng ngày (hiếm) | Có thể nhận từ quà điểm danh (hiếm) | Như trên. |
| wardrobe.hint.daily.epic | Có thể rút từ điểm danh hằng ngày (cực hiếm) | Có thể nhận từ quà điểm danh (cực hiếm) | Như trên. |
| wardrobe.leaveTitle | Rời đi mà không lưu? | Thoát mà không lưu? | "Rời đi" dịch sát "Leave". |
| wardrobe.leaveBody | Bạn có thay đổi trang phục chưa được lưu. | Những thay đổi chưa lưu sẽ bị mất. | Nói rõ hậu quả. Tiêu đề đã hỏi rồi nên câu này không cần nhắc lại. |
| wardrobe.leaveDiscard | Bỏ qua và rời đi | Thoát không lưu | Ngắn hơn, khớp với tiêu đề. "Bỏ qua" mơ hồ, không rõ bỏ qua cái gì. |
| outfits.apply | Áp dụng | Mặc bộ này | "Áp dụng" mang giọng phần mềm. Đây là nút mặc một bộ đồ đã lưu. |
| outfits.overwrite | Lưu đè vào đây | Lưu đè | Đủ nghĩa (khóa này vừa là mục menu vừa là tiêu đề hộp thoại). Thẻ đang chọn đã là "đây" rồi. |
| outfits.delete | Xoá | Xóa | Thống nhất cách đặt dấu với "Hủy", "bị xóa" (Lite), "Hòa"… |

**Tên vật phẩm** (nội dung hiện trên thẻ)

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| items.head_dealer_visor01 | Chắn nắng người chia bài | Mũ chia bài | Tên cũ thiếu chữ "mũ" và dài. |
| items.outfit_dealer01 | Bộ người chia bài | Đồng phục chia bài | Tự nhiên hơn và cặp với dòng trên. |
| items.aura_water01 | Vòng nguyên tố nước | Hào quang nước | "Vòng nguyên tố" dài và dịch sát. Tên mới khớp với tab "Hào quang". |
| items.aura_wind01 | Vòng nguyên tố gió | Hào quang gió | Như trên. |
| items.aura_fire01 | Vòng nguyên tố lửa | Hào quang lửa | Như trên. |
| items.aura_earth01 | Vòng nguyên tố đất | Hào quang đất | Như trên. |
| items.aura_sakura01 | Vòng hoa anh đào | Hào quang hoa anh đào | Đổi cho thống nhất với cả nhóm hào quang. |
| items.aura_ice01 | Vòng băng giá | Hào quang băng giá | Như trên. |
| items.aura_lightning01 | Vòng sét | Hào quang sấm sét | Như trên. |
| items.aura_gold_cards01 | Vòng bài vàng | Hào quang bài vàng | Như trên. |

**Thành tựu**

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| achievements.ui.summary | Đã mở {{unlocked}} / {{total}} | Đã đạt {{unlocked}}/{{total}} | "Đã mở" một mình thì mơ hồ. Người Việt nói "đạt thành tựu". |
| achievements.ui.progress | {{progress}} trên {{threshold}} | {{progress}}/{{threshold}} | Cách hiển thị tiến độ quen thuộc. Khóa này cũng là `aria-valuetext` (xem mục 4). |
| achievements.ui.unlockedAt | Mở ngày {{date}} | Đạt ngày {{date}} | Thống nhất động từ "đạt". |
| achievements.ui.locked | Chưa mở | Chưa đạt | Chỉ dành cho trình đọc màn hình. Thống nhất "đạt". |
| achievements.ui.unlocked | Đã mở | Đã đạt | Như trên. |
| achievements.ui.empty | Chưa có gì ở đây. | Chưa có thành tựu nào. | Cụ thể hơn. |
| achievements.ui.category.social | Tại bàn | Hoạt động | Cùng lý do và cùng giá trị với `profile.stats.groups.social`. |
| achievements.login_streak_28.name | Chuỗi hai tám ngày | Chuỗi 28 ngày | "hai tám" là cách đọc tắt của văn nói, viết ra thì trông như lỗi. |
| achievements.blind_wins_10.name | Mười ván Blind Poker thắng | Mười ván thắng Blind Poker | Sai trật tự từ. Bản Hold'em đã đúng là "Mười ván thắng". |
| achievements.blind_wins_100.name | Trăm ván Blind Poker thắng | Trăm ván thắng Blind Poker | Như trên. |
| achievements.bot_hands_50.name | Bạn của máy | Bạn thân của bot | "máy" mơ hồ. Cả game đều gọi là "bot". |

### 2.4 `apps/lite/web/src/locales/vi/lite.json` (bản Lite)

| key | hiện tại | đề xuất | lý do |
|---|---|---|---|
| prompt.lead | Chọn một tên hiển thị. Không có mật khẩu — tên này chính là phiên chơi của bạn trên thiết bị này. | Đặt một tên để vào chơi, không cần mật khẩu. Tên này gắn với thiết bị bạn đang dùng. | Bỏ "phiên chơi" vì là từ kỹ thuật, nhưng vẫn giữ ý quan trọng: danh tính gắn với thiết bị. |
| daily.streak | Chuỗi ngày | Chuỗi điểm danh | "Chuỗi ngày" một mình đọc như "những ngày tháng". Thống nhất với Normal. |
| daily.monthlyReset | Chuỗi ngày bắt đầu lại vào ngày 1 mỗi tháng. | Chuỗi điểm danh được tính lại từ ngày 1 mỗi tháng. | Thống nhất thuật ngữ và cách nói với Normal `daily.lead`. |
| daily.relief.lead | Số dư dưới {{threshold}} điểm được nạp lên {{target}} điểm, mỗi {{hours}} giờ một lần. | Khi số dư dưới {{threshold}} điểm, bạn có thể nhận cứu trợ để số dư trở lại {{target}} điểm (mỗi {{hours}} giờ một lần). | Câu bị động nghe cứng, và "nạp" gợi chuyện nạp tiền. Khớp với Normal. |
| settings.signOutConfirm | Phiên chơi trên thiết bị này sẽ bị xóa. Không có mật khẩu để vào lại, và tên hiển thị cũ không thể đăng ký lần nữa. | Bạn sẽ không thể quay lại tài khoản này vì không có mật khẩu, và tên hiển thị hiện tại cũng không dùng lại được nữa. | Giữ nguyên lời cảnh báo vì đây là thao tác không hoàn tác được, nhưng nói bằng hậu quả mà người chơi hiểu ngay, thay cho "phiên chơi bị xóa". |

---

## 3. Ô tích No11a (phòng thay đồ: mặc định chỉ hiện món đã có)

| # | Nhãn | Ghi chú |
|---|---|---|
| **1 (chọn)** | **Hiện cả món chưa có** | Ngắn (5 chữ). Đúng bộ từ phòng thay đồ đang dùng: "món", "đã có / chưa có" (`wardrobe.ownedCount` = "{{owned}}/{{total}} đã có"). Chữ "cả" nói rõ ý "hiện **thêm**" so với mặc định chỉ hiện món đã có. Cùng kiểu cụm danh-động ngắn như các ô tích sẵn có ("Phòng riêng tư", "Tự động bắt đầu"). |
| 2 | Xem cả đồ chưa sở hữu | Đúng nghĩa nhưng "sở hữu" trang trọng hơn phần còn lại của màn. |
| 3 | Hiện món chưa mở khóa | Giọng game, khớp biểu tượng ổ khóa. Nhưng "mở khóa" hứa hẹn là có cách mở, trong khi một số món đang ghi "Chưa có cách nhận món này". |

So với đề xuất gốc "[Hiển thị bao gồm chưa sở hữu]": câu đó dịch sát kiểu "show including unowned" và thiếu danh từ, nên không dùng.

Ghi chú cho người làm:
- Mặc định **không tích**. Gợi ý khóa mới `wardrobe.showLocked`: vi "Hiện cả món chưa có", en "Show items you don't own yet".
- Sau No11a, `wardrobe.filter.all` và `wardrobe.filter.owned` không còn chỗ dùng và đã được xóa ở vi + en.
- **Giữ** `wardrobe.filter.locked` ("Chưa có"), vì `cards.tsx:26` vẫn ghép nó vào aria-label của thẻ bị khóa ("{tên}, {độ hiếm}, Chưa có: {gợi ý}"). Có thể đổi tên khóa thành `wardrobe.locked` cho đúng vai trò.
- `wardrobe.ownedCount` vẫn hữu ích khi đặt cạnh ô tích.

---

## 4. Cần lưu ý

**Thuật ngữ được giữ nguyên có chủ đích**
- **Thao tác trong ván:** Bỏ bài, Xem, Theo, Cược, Tố, Tất tay, Chơi, Chơi hoặc bỏ, Xem/Bỏ, Theo mọi mức, Tự động chơi.
- **Từ poker giữ tiếng Anh:** Blind, Buy-in, Pot, Pot phụ, Stack, Min / ½ / Pot / Max, BB, Preflop/Flop/Turn/River. Người chơi Việt quen các từ này, dịch ra sẽ lạ hơn.
- **Tên bộ bài và tên lá:** Mậu thầu, Một đôi, Hai đôi, Sám, Sảnh, Thùng, Cù lũ, Tứ quý, Thùng phá sảnh; tên lá Bồi/Đầm/Già/Át và chất chuồn/rô/cơ/bích.
- **Tên màn và tính năng:** Sảnh chờ, Phòng thay đồ, Kho đồ, Điểm danh, Cứu trợ, Hạn mức, Cộng dồn, Phí bàn, Chủ phòng, Bot.
- **Câu đã tốt, giữ nguyên:** "Hôm nay bạn đã điểm danh rồi. Hẹn gặp lại ngày mai.", "Lì đòn", "Ba ván liền tay", "Bảy ngày ghé bàn". Phần lớn thông báo lỗi trong `common.errors` đã ngắn và cụ thể.
- `labels.dealer` = "Cái": đây là aria-label của nút D. Người chơi bài Việt hiểu "cái", nên giữ. Nếu muốn mô tả rõ hơn có thể đổi thành "Người chia bài".

**Thuật ngữ đã chuẩn hóa trong bản đề xuất**
- Số dư: dùng **"Số dư"**, không dùng "Số điểm". Đơn vị luôn là "điểm".
- Mời người chơi ra khỏi phòng: dùng **"Mời ra"**, không dùng "Đuổi".
- Nghỉ một lúc rồi quay lại: **"Tạm nghỉ" / "Chơi tiếp"**, không dùng "Ngồi ngoài" / "Vào lại".
- Thành tựu: dùng **"đạt" / "chưa đạt"**, không dùng "mở" / "chưa mở".
- Món đang trang bị: **"Đang dùng"**, không dùng "Đang mặc".
- Tab phòng thay đồ: **"Nhân vật"** thay "Thân nền"; **"Quần áo"** thay cho tab "Trang phục". Tên nhóm "Trang phục" giữ nguyên.
- Điểm danh: **"chuỗi điểm danh"**, **"quà điểm danh"**.
- Dấu thanh theo kiểu mới cho cả bộ: **"Xóa", "Hủy", "Hòa", "khóa"**.
- Tên bộ bài cao nhất: **"Thùng phá sảnh hoàng gia"** cho cả bàn chơi lẫn thành tựu.

**Việc người làm cần kiểm tra**
- **Bỏ 3 dòng:**
  - Xóa phần render ở `apps/normal-web/src/screens/SettingsScreen.tsx:46` và `:62`, và `apps/normal-web/src/screens/InventoryScreen.tsx:132`.
  - Xóa khóa ở **cả vi lẫn en**, vì `i18n.test.ts` / test so khớp khóa có thể yêu cầu hai ngôn ngữ trùng bộ khóa.
  - Không có test nào đang kiểm tra 3 chuỗi này.
- **Test đang kiểm tra chữ tiếng Việt cần sửa theo**, gồm cả unit test và e2e:
  - "Đang mặc": 5 file.
  - "Ngồi ngoài", "Những người thắng": mỗi chuỗi 4 file.
  - "Kiểu quyết định", "Số lá riêng", "Xoá", "Lưu đè vào đây": mỗi chuỗi 3 file.
  - "Thân nền", "Chưa sẵn sàng", "Thuần may rủi", "Tại bàn", "Chọn mức mang vào": mỗi chuỗi 2 file.
  - "Đuổi", "Vào lại", "Hãy ngồi vào bàn", "Thành viên từ": mỗi chuỗi 1 file.
  - Cách tìm: grep từng chuỗi cũ trong `apps/` và `packages/`.
- **Kiểm tra độ dài, tránh đè chữ** (liên quan quy tắc test layout của No11):
  - "Thùng phá sảnh hoàng gia" trên thẻ kết quả và trong Hồ sơ.
  - "Hào quang hoa anh đào", "Đồng phục chia bài" trên thẻ phòng thay đồ.
  - "Hủy sẵn sàng" và "Chơi tiếp" trong thanh điều khiển bàn ở khổ 375 px.
- `achievements.ui.progress` dùng chung cho chữ hiển thị và `aria-valuetext`. "3/7" có thể bị trình đọc màn hình đọc thành "3 gạch chéo 7". Nếu cần, tách thành hai khóa: một khóa hiển thị "3/7", một khóa aria "3 trên 7".
- **No13** (tách giới tính, kiểu tóc, màu da khỏi "thân nền") có thể đổi cấu trúc tab `base`, nên nhãn "Nhân vật" chỉ là tạm thời. Tên các `bases.*` hiện đặt theo kiểu tóc ("Tóc bob", "Tóc rối"…), vẫn hợp lý.
- Chỉ đổi câu chữ tiếng Việt. Bản tiếng Anh không bắt buộc phải sửa theo, trừ các khóa bị xóa.

**Chỗ còn mơ hồ, để người duyệt quyết**
- `settings.about.edition` = "Ấn bản" (giá trị "Bản Normal"): "Ấn bản" mang giọng sách vở. Có ba hướng:
  - giữ nguyên;
  - gộp với dòng "Phiên bản" thành một dòng;
  - bỏ hẳn dòng này, vì người chơi bản Normal không cần biết tên bản.
  
  Chưa đưa vào bảng vì đây là thay đổi bố cục.
- `game:labels.password` = "Mật khẩu" được dùng làm aria-label cho biểu tượng ổ khóa trong danh sách phòng. Ở chỗ đó "Có mật khẩu" mới đúng nghĩa, nhưng muốn sửa phải thêm khóa mới, vì khóa này còn là nhãn ô nhập ở `JoinByCode`.
- `create.hint.buyIn` cũng hiện ra khi buy-in nằm ngoài khoảng cho phép (`CreateRoomForm.tsx:50`), không chỉ khi tối thiểu lớn hơn tối đa. Lời nhắc chỉ nêu một trường hợp. Nếu form có thể rơi vào trường hợp còn lại thì nên tách lời nhắc.
- `auth.submitSignIn` = "Vào sảnh" (nút đăng nhập): giữ nguyên vì khớp với Lite và mang không khí game. Nếu muốn theo lối quen thuộc thì đổi thành "Đăng nhập".

**Khóa không còn được dùng** (chỉ đọc qua, không đề xuất sửa; nên xóa ở một đợt dọn dẹp riêng)
- `game.json`:
  - `app.title`, `nav.logout`
  - `actions.resync/create/back/retry`
  - `labels.autoStart/handResult/holeCards/name/payout/private/public/ready/seat/split/stack/tie/timer/turn/variant`
  - `phase.*`, `street.*`, `status.replaced`, `lobby.title`
  - `create.smallBlind/bigBlind/buyIn`
  - `room.title/leaveConfirm/closed/kicked/hostLeft`
  - Riêng `room.kicked` vẫn ghi "đuổi". Nếu sau này dùng lại khóa này thì đổi thành "Bạn đã bị mời ra khỏi phòng".
- `common.json`: `units.points`, `units.seconds`, `time.minutes`.
- `normal.json`: `avatar.slot.*` (7 khóa).
