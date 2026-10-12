# Hướng dẫn chơi Blind Luck Poker

Tài liệu này dành cho người chơi, viết chung cho hai bản của trò chơi: **bản Normal** (có tài khoản) và **bản Lite** (chạy trong mạng nội bộ). Chữ trong ngoặc kép là đúng chữ bạn thấy trên màn hình khi chọn tiếng Việt. Phần nào chỉ có ở một bản, tài liệu ghi rõ.

## 1. Giới thiệu

Blind Luck Poker là trò poker nhiều người chơi cùng lúc, mở bằng trình duyệt, không cần cài đặt. Bạn chơi bằng **điểm**. Điểm không phải tiền và sẽ không bao giờ là tiền: không nạp, không rút, không mua bán, không đổi ra thứ gì. Trò chơi không có cửa hàng; mọi thứ đều đến từ việc chơi, điểm danh và thành tựu.

Có hai chế độ: **Texas Hold'em** (poker No-Limit quen thuộc, mỗi người 2 lá, có các vòng cược) và **Blind Poker** (mọi người đặt cùng một mức cược trước khi xem bài, mỗi người 2 hoặc 3 lá, có bot và có thể nặn bài).

**Bản Normal** chạy trên máy chủ và cần một tài khoản:

1. Mở địa chỉ trang game mà người quản lý máy chủ gửi cho bạn.
2. Lần đầu: chọn tab "Đăng ký", nhập "Email", "Mật khẩu" (8–128 ký tự, không trùng với email) và "Tên hiển thị" (2–20 ký tự: chữ, số, dấu cách và _ - .), rồi bấm "Tạo tài khoản".
3. Những lần sau: chọn tab "Đăng nhập", nhập email và mật khẩu, bấm "Vào sảnh".

Một tài khoản dùng được trên mọi thiết bị. Không có email xác nhận và chưa có chức năng lấy lại mật khẩu, nên bạn hãy giữ mật khẩu cẩn thận.

**Bản Lite** là một chương trình chạy trên một máy Windows trong mạng nội bộ (văn phòng, quán, nhà), không cần mật khẩu:

1. Mở địa chỉ mà người chạy máy chủ cho bạn, dạng `http://192.168.1.10:8080` (ngồi ngay máy chủ thì mở `http://localhost:8080`).
2. Ở màn "Vào bàn", gõ "Tên hiển thị" (2–20 ký tự) rồi bấm "Vào sảnh".
3. Tên này gắn với trình duyệt trên thiết bị bạn đang dùng; lần sau mở lại cùng trình duyệt là vào thẳng sảnh.

**Ngôn ngữ và giao diện.** Chọn "Tiếng Việt" hoặc "English" ở thanh điều hướng hay trong "Cài đặt", lúc nào cũng được, kể cả khi đang ngồi bàn. Lần đầu, game theo ngôn ngữ của trình duyệt. Nền "Tối" là mặc định, đổi sang "Sáng" trong "Cài đặt".

**Máy tính hay điện thoại.** Trên máy tính, bàn hình bầu dục và ghế của bạn ở giữa phía dưới. Trên điện thoại dọc, đối thủ xếp thành hàng ở trên, bài chung và pot ở giữa, bài và khay nút của bạn ghim ở đáy màn hình; xoay ngang thì bàn trở lại hình bầu dục thu nhỏ.

## 2. Điểm và tài khoản

Tài khoản mới có **100.000 điểm**. "Số dư" hiện ở thanh trên cùng của "Sảnh chờ".

**Số dư và stack.** Khi bạn ngồi vào bàn, một phần số dư chuyển lên bàn thành **stack** của bạn: ở Hold'em là số buy-in bạn chọn, ở Blind Poker là hạn mức của bàn (mục 5). Trong lúc ngồi, thắng thua chỉ làm stack thay đổi. Khi bạn "Đứng dậy" hoặc "Rời phòng", toàn bộ stack quay về số dư. Vì vậy số dư giảm ngay lúc bạn ngồi xuống là chuyện bình thường.

**Phí bàn.** Mỗi ván có người thắng, bàn thu **2% pot** (làm tròn xuống) trước khi chia. Ở Hold'em phí tối đa là 1 big blind mỗi ván; ở Blind Poker không có mức tối đa. Không thu phí khi pot được cộng dồn sang ván sau hoặc khi ván bị hủy. Thẻ kết quả ghi khoản này ở dòng "Phí bàn". Ngoài phần bot thắng, đây là chỗ duy nhất điểm rời khỏi bàn mà không vào tay người chơi nào.

### Điểm danh hằng ngày

Mỗi ngày, mở tab "Điểm danh" và bấm "Nhận thưởng" một lần. Ngày mới bắt đầu lúc 00:00 giờ Việt Nam (người quản lý máy chủ có thể đổi múi giờ). Ở bản Normal, lần đăng nhập đầu tiên trong ngày tự mở trang "Điểm danh", và tab này có chấm vàng khi còn quà chưa nhận.

**Chuỗi điểm danh** tăng thêm 1 khi bạn điểm danh hai ngày liền nhau. Bỏ một ngày thì chuỗi về ngày 1. Sang tháng mới, chuỗi cũng về ngày 1, dù tháng trước bạn không bỏ ngày nào. Chuỗi càng dài, thưởng càng lớn:

| Ngày trong chuỗi | Điểm | Thêm vật phẩm (bản Normal) |
|---|---|---|
| 1 → 6 | 5.000 · 6.000 · 7.000 · 8.000 · 10.000 · 12.000 | |
| 7 | 15.000 | một món thường ngẫu nhiên |
| 8 → 13 | 10.000 mỗi ngày | |
| 14 | 20.000 | một món hiếm ngẫu nhiên |
| 15 → 20 | 10.000 mỗi ngày | |
| 21 | 25.000 | một món hiếm ngẫu nhiên |
| 22 → 27 | 12.000 mỗi ngày | |
| 28 | 40.000 | "Huy hiệu tháng" và danh hiệu "Chuyên cần" |
| 29 → 31 | 12.000 mỗi ngày | |

Đủ một tháng 31 ngày là 376.000 điểm. Vì chuỗi tính lại từ ngày 1 mỗi tháng, muốn chạm mốc ngày 28 bạn phải bắt đầu từ những ngày đầu tháng. Ở bản Normal, "Lịch điểm danh" đánh dấu trước các ngày có quà: "Vật phẩm thường", "Vật phẩm hiếm", "Huy hiệu + danh hiệu tháng".

Món ngẫu nhiên ngày 7, 14 và 21 luôn là món bạn chưa có, lấy từ các mục "Mũ", "Phụ kiện mặt", "Hào quang", "Khung", "Màu tóc" và "Màu mắt". Nếu bạn đã có hết món ở mức đó, bạn được 10.000 điểm thay vào. Quà ngày 28 là quà cố định: bạn đã có rồi thì không được đổi thành điểm.

**Đầu tháng** chỉ có chuỗi điểm danh quay về ngày 1. Số dư, vật phẩm, trang phục, thành tựu, thống kê và tổng số ngày điểm danh giữ nguyên; điểm không bị xóa theo tháng.

### Cứu trợ

Khi số dư **dưới 5.000 điểm**, mở "Điểm danh" và bấm "Nhận cứu trợ" ở khung "Cứu trợ": số dư được nâng lên lại 5.000. Hai lần nhận phải cách nhau ít nhất 24 giờ. Game chỉ xét số dư, điểm đang nằm trên bàn không được tính.

### Lịch sử và những gì được lưu

Bản Normal: mở "Hồ sơ".

- "Lịch sử điểm": mỗi lần số dư thay đổi là một dòng, ví dụ "Điểm khởi đầu", "Vào bàn", "Rời bàn", "Điểm danh hằng ngày", "Điểm danh (điểm thay vật phẩm)", "Điểm cứu trợ", "Thưởng thành tựu", "Hoàn điểm". Bấm "Tải thêm" để xem dòng cũ hơn. Kết quả từng ván không thành dòng riêng: hai dòng "Vào bàn" và "Rời bàn" cho biết bạn được hay mất bao nhiêu trong **cả lần ngồi**. Phí bàn cũng không có dòng riêng, vì nó được trừ thẳng từ pot.
- "Ván gần đây": các ván vừa chơi, ở bàn nào, gặp ai, có thắng không.
- "Thống kê": số ván chơi và thắng của từng chế độ, chuỗi thắng/thua, bài mạnh nhất, ván thắng lớn nhất, số ngày điểm danh.

Bản Lite: máy chủ giữ tên hiển thị, số dư và chuỗi điểm danh của bạn, nhưng không có hồ sơ, lịch sử hay thống kê để xem. Máy chủ nhận ra bạn nhờ một mã lưu trong trình duyệt. Nếu bạn xóa dữ liệu trang, đổi trình duyệt hay đổi thiết bị, bạn sẽ thành người chơi mới với 100.000 điểm, còn tên cũ vẫn bị giữ nên không dùng lại được.

## 3. Sảnh và phòng

"Sảnh chờ" hiện các phòng công khai dưới mục "Phòng chơi", tự cập nhật, lọc được bằng "Tất cả", "Texas Hold'em" hoặc "Blind Poker". Mỗi phòng là một tấm vé ghi:

- ký hiệu chế độ (♠ là Hold'em, ⚄ là Blind Poker), mã phòng 6 ký tự và tên phòng;
- trạng thái: "Đang chờ", "Đang chơi", hoặc "Đang đóng…" (phòng vừa trống, được giữ thêm 60 giây cho ai muốn quay lại);
- "Chế độ" và mức cược: "Blind" (ví dụ 100/200) với Hold'em, "Mức cược" với Blind Poker;
- với Blind Poker: "2 lá" hoặc "3 lá", "Hoàn toàn may rủi" hoặc "Chơi hoặc bỏ", và nhãn vàng "Nặn bài" nếu là bàn nặn bài;
- số chỗ đã dùng, ví dụ 4/6, tính cả bot và cả người đang đứng xem. Phòng đầy thì nút "Vào phòng" bị khóa.

Phòng riêng tư không có trong danh sách. Để vào, gõ "Mã phòng" (và "Mật khẩu" nếu có) ở khung "Vào bằng mã phòng", rồi bấm "Vào phòng". Mỗi lúc bạn chỉ ở trong một phòng.

### Tạo phòng

Bấm "Tạo phòng" ở "Sảnh chờ". Hộp thoại "Tạo phòng mới" gồm:

| Ô | Cách dùng |
|---|---|
| "Tên phòng" | Có sẵn một tên ngẫu nhiên, ví dụ *Góc Phố Cổ*. Bấm 🎲 ("Tên khác") để lấy tên khác, hoặc gõ tên của bạn (1–30 ký tự). |
| "Chế độ chơi" | "Texas Hold'em" hoặc "Blind Poker". |
| "Số người tối đa" | Số ghế: Hold'em 2–9, Blind Poker 2–8, mặc định 6. Ghế bot cũng tính. |
| "Thời gian mỗi lượt" | Hold'em: 15, 30 (mặc định), 45 hoặc 60 giây. Blind Poker: 10, 15 (mặc định) hoặc 30 giây, chỉ dùng lúc chọn Chơi hay Bỏ. Khi bật "Nặn bài", ô này thành "20 giây · nặn bài" và không đổi được. |
| "Mức cược" (Hold'em) | Blind nhỏ/blind lớn: 100/200, 250/500, 500/1.000, 1.000/2.000 hoặc 2.500/5.000. |
| "Buy-in tối thiểu", "Buy-in tối đa" (Hold'em) | Số điểm mỗi người được mang vào bàn, tính bằng big blind (BB): 20 đến 500 BB, mặc định 50 và 200 BB. Dòng nhỏ dưới ô đổi ra điểm. |
| "Số lá mỗi người" (Blind) | "2 lá" hoặc "3 lá". |
| "Cách chơi" (Blind) | "Chơi hoặc bỏ" (mặc định) hoặc "Hoàn toàn may rủi" (mục 5). |
| "Mức cược cố định" (Blind) | 1.000, 2.000, 5.000, 10.000, 20.000 hoặc 50.000. Dòng dưới ô cho biết hạn mức mỗi người (5× mức cược). |
| "Số lượng bot" (Blind) | Từ 0 đến số ghế trừ 1. Bot ngồi sẵn từ lúc tạo phòng. |
| "Nặn bài" (Blind) | Bài của bạn được chia úp để bạn tự nặn (mục 6). |
| "Phòng riêng tư" | Không hiện trong danh sách, chỉ vào bằng mã. Có thể đặt thêm "Mật khẩu phòng" (4–20 ký tự) hoặc để trống. |
| "Tự động bắt đầu" | Ván tự bắt đầu khi mọi người đang ngồi đã sẵn sàng (cần ít nhất 2 ghế, tính cả bot). |

Bấm "Tạo phòng" để vào phòng với vai "Chủ phòng". Cấu hình không đổi được sau khi tạo; muốn khác thì tạo phòng mới. Bàn Hold'em không có bot, nên cần ít nhất 2 người thật.

### Trong phòng

Đầu trang ghi tên phòng, chế độ, mã phòng (đọc cho bạn bè để họ vào), mức cược, số người, trạng thái kết nối và nút "Rời phòng". Mới vào phòng, bạn **đứng xem**: thấy cả bàn nhưng không thấy bài của ai. Để chơi:

1. Bấm "Ngồi vào bàn" ở một ghế trống. Ở Hold'em, hộp thoại "Chọn số điểm mang vào bàn" hiện ra: gõ số "Buy-in" trong khoảng cho phép rồi bấm "Ngồi vào bàn". Ở Blind Poker, bạn ngồi ngay và bàn tự lấy hạn mức từ số dư.
2. Bấm "Sẵn sàng" (bấm lại thì thành "Hủy sẵn sàng"). Bên cạnh có đếm số người sẵn sàng.
3. Chủ phòng bấm "Bắt đầu". Nút này mở khi có ít nhất 2 ghế sẵn sàng, trong đó có ít nhất một người thật. Người khác thấy "Đang chờ chủ phòng bắt đầu".

Sau ván đầu, ván kế tiếp tự bắt đầu sau 5 giây, miễn là còn ít nhất 2 người chơi được. Khi không đủ người, phòng quay về chờ và mọi người bấm "Sẵn sàng" lại. Dưới bàn còn có "Đứng dậy" (rời ghế nhưng ở lại phòng) và "Tạm nghỉ" / "Chơi tiếp" (giữ ghế, bỏ qua các ván sau), xem mục 7.

**Chủ phòng** (ghế có nhãn "Chủ phòng" kèm hình vương miện) bấm "Bắt đầu", và giữa hai ván có nút "Quản lý bàn": danh sách "Người trong phòng" cho phép "Mời ra" bất kỳ ai, kể cả bot hay người đang đứng xem. Đây cũng là cách bớt bot khỏi bàn. Người bị mời ra thấy "Bạn đã bị mời ra khỏi phòng" và stack của họ về lại số dư. Khi chủ phòng rời đi, người vào phòng sớm nhất còn lại thành chủ phòng; bot không bao giờ là chủ phòng.

Phòng đóng khi người thật cuối cùng rời đi: ngay lập tức nếu còn bot, hoặc sau 60 giây "Đang đóng…" nếu không có bot (ai vào lại trong lúc đó thì phòng tiếp tục).

## 4. Texas Hold'em

Đây là **No-Limit Texas Hold'em**: mỗi người 2 lá riêng, 5 lá chung lật làm ba đợt (3 lá, rồi 1, rồi 1), ai có 5 lá đẹp nhất trong 7 lá thì thắng. Bạn được cược tới hết stack.

Chữ **D** trên một ghế là nút cái. Ván đầu, nút cái đặt ngẫu nhiên, sau đó chuyển dần theo chiều kim đồng hồ. Hai ghế kế tiếp đặt blind nhỏ và blind lớn theo mức của bàn; bàn chỉ còn 2 người thì ghế cái đặt blind nhỏ. Ai không đủ điểm cho blind thì đặt hết số mình có.

### Đến lượt bạn

Ghế đến lượt có viền sáng và đồng hồ vòng đếm ngược. Khay nút chỉ hiện những gì bạn được làm lúc đó:

| Nút | Ý nghĩa |
|---|---|
| "Bỏ bài" | Bỏ ván, mất phần đã cược. |
| "Xem" | Không ai cược thêm trong vòng: đi tiếp mà không mất điểm. |
| "Theo" | Theo mức cược hiện tại (nút ghi kèm số điểm). |
| "Cược" | Chưa ai cược trong vòng: đặt cược đầu tiên, tối thiểu 1 big blind. |
| "Tố" | Đã có cược: nâng lên. Mức nâng tối thiểu bằng lần nâng lớn nhất trước đó trong vòng. |
| "Tất tay" | Đặt toàn bộ stack. |

Chọn mức cho "Cược" hoặc "Tố" bằng ô số, thanh trượt, hoặc các nút nhanh "Min", "½" (nửa pot), "Pot" (bằng pot), "Max". Mức luôn được giữ trong khoảng hợp lệ, nên bạn không thể cược sai. Trên máy tính có phím tắt: **F** bỏ bài, **C** xem hoặc theo, **R** nhảy vào ô mức cược, **Enter** để cược hoặc tố.

**Chọn sẵn trước lượt.** Khi chưa đến lượt, khay có ba nút bật sẵn: "Xem/Bỏ" (đến lượt thì xem nếu được, không thì bỏ bài), "Theo mọi mức" (theo dù mức nào; không ai cược thì xem) và "Bỏ bài" (bỏ bài, nhưng nếu được xem miễn phí thì game xem cho bạn). Lựa chọn chỉ dùng một lần trong ván đó. Nếu đến lượt mà nó không làm được nữa (ví dụ phải tất tay mới theo được), game bỏ chọn và để bạn tự quyết.

**Hết giờ.** Hết "Thời gian mỗi lượt" mà bạn chưa bấm, game tự "Xem" nếu được, không thì "Bỏ bài". Hết giờ **3 lượt liên tiếp** thì khi ván kết thúc bạn bị mời đứng dậy, stack về số dư.

### Tất tay, pot phụ và so bài

Khi tất tay, bạn chỉ thắng được từ mỗi đối thủ tối đa bằng số bạn đã đặt; phần đó nằm trong "Pot chính". Nếu những người còn lại cược thêm với nhau, phần thêm vào một pot phụ ("Pot phụ 1", "Pot phụ 2"…) mà chỉ họ tranh nhau. Mỗi pot chia riêng cho người có bài tốt nhất trong số người "Tham gia" pot đó. Khi không còn ai hành động được, các lá chung còn lại tự lật hết. Phần cược không ai theo được trả lại người đặt; thẻ kết quả ghi "Hoàn cược dư cho" kèm tên và số điểm.

Nếu mọi người khác bỏ bài, người còn lại ăn pot mà không phải lật bài. Nếu không, những ai còn trong ván cùng lật bài. Lá bài trượt ra từ bộ bài giữa bàn rồi lật; bài đối thủ được nhấc lên rồi lật. Khi lá cuối đã lật xong, **thẻ kết quả** mới hiện: "Người thắng", tên bộ bài, 5 lá thắng, số điểm nhận được, "Phí bàn", và bảng từng pot khi có pot phụ. Hòa thì chia đều; điểm lẻ thuộc về người thắng gần nút cái nhất theo chiều kim đồng hồ. Bấm "Đóng" để cất thẻ. Dòng "Ván tiếp theo sau" đếm ngược 5 giây.

**Buy-in.** Khi ngồi, bạn chọn số mang vào trong khoảng "Buy-in tối thiểu" đến "Buy-in tối đa" của bàn (làm tròn theo big blind). Không nạp thêm được khi đang ngồi: muốn mang thêm điểm, bấm "Đứng dậy" (toàn bộ stack về số dư) rồi ngồi lại với buy-in mới. Stack về 0 thì hết ván bạn tự đứng dậy.

## 5. Blind Poker

Blind Poker lấy cảm hứng từ *ba cây*: mọi người đặt **cùng một mức cược** ("Mức cược cố định") trước khi xem bài. Mỗi người nhận 2 hoặc 3 lá riêng, có 5 lá chung, và bộ bài được tính bằng 5 lá tốt nhất trong 7 (hoặc 8) lá. Bạn không bắt buộc phải dùng lá riêng của mình.

### Hạn mức

Khi bạn ngồi vào bàn Blind, bàn lấy từ số dư một khoản gọi là **hạn mức**, bằng 5 lần mức cược (mức cược 1.000 thì hạn mức 5.000); đầu bàn ghi cả "Mức cược" và "Hạn mức". Nếu số dư ít hơn hạn mức, bàn lấy hết số dư, miễn là đủ cho một ván: 1 mức cược với "Hoàn toàn may rủi", 2 mức cược với "Chơi hoặc bỏ" (tiền cược đầu và tiền Chơi). Không đủ thì bạn thấy "Số dư không đủ để vào bàn" kèm số điểm cần có.

Mọi khoản cược và tiền thắng đều nằm trong stack trên bàn; thắng nhiều thì stack có thể vượt hạn mức. Khi hết ván mà stack không còn đủ cho ván sau, bạn **hết hạn mức**: bạn được mời đứng dậy, phần còn lại (nếu có) về số dư, và thấy thông báo "Bạn đã dùng hết hạn mức ở bàn này"… Bạn vẫn ở trong phòng; bấm "Ngồi vào bàn" ở một ghế trống để vào lại với hạn mức mới.

### Hai cách chơi

**"Hoàn toàn may rủi"**: bạn không phải bấm gì. Mỗi người trong ván bỏ mức cược vào pot, bài được chia, lá chung lật 3–1–1, rồi mọi người lật bài và bộ mạnh nhất ăn pot (trừ 2% phí bàn).

**"Chơi hoặc bỏ"**:

1. Mỗi người bỏ mức cược vào pot, rồi bài được chia.
2. **Mọi người chọn cùng lúc** trong "Thời gian mỗi lượt": "Chơi" (bỏ thêm một mức cược, nút ghi kèm số điểm) hoặc "Bỏ bài". Bạn không biết ai chọn gì, chỉ thấy nhãn "Đã chọn" ở ghế đã quyết định; khay của bạn báo "Đã chọn — chờ người chơi khác". Hết giờ mà chưa chọn thì tính là "Bỏ bài".
3. Khi mọi người đã chọn hoặc hết giờ:
   - không ai chơi: pot **cộng dồn** sang ván sau, không thu phí, không ai phải lật bài; dưới pot hiện "Cộng dồn" kèm số điểm;
   - chỉ một người chơi: người đó ăn cả pot ngay, không lật lá chung, bài của họ không bị lộ;
   - từ hai người trở lên: lật lá chung 3–1–1 rồi so bài giữa những người đã chọn "Chơi".

Pot cộng dồn được cộng vào pot của ván sau. Nếu phòng không bắt đầu được ván mới trong 60 giây, hoặc phòng đóng, pot cộng dồn được chia đều vào số dư của những người thật đang ngồi (cùng những ai vừa hết hạn mức trong lúc pot đang cộng dồn mà vẫn ở trong phòng); bản Normal ghi khoản này là "Hoàn điểm". Phần lẻ không chia đều được thì mất.

### Bot và nút cái

Bot ngồi sẵn theo "Số lượng bot", luôn sẵn sàng và có nhãn "Bot". Bot chiếm ghế thật: phòng 4 ghế có 3 bot chỉ còn chỗ cho một người. Bot không hiện stack vì điểm của bot là điểm ảo, tự nạp lại; nhưng khi bot thắng, pot đó vẫn rời khỏi bàn như khi người khác thắng. Bot nghĩ 1–3 giây, và ở kiểu "Chơi hoặc bỏ" thì chọn theo độ mạnh của bài. Ván chỉ bắt đầu khi có ít nhất một người thật sẵn sàng. Chủ phòng bớt bot bằng "Quản lý bàn" rồi "Mời ra", giữa hai ván.

Chữ **D** (nút cái) chuyển sang ghế kế tiếp mỗi ván; ở Blind Poker nó chỉ quyết định thứ tự chia bài và ai nhận điểm lẻ khi hòa. Thẻ kết quả giống Hold'em, có thêm "Cộng dồn" khi pot chuyển sang ván sau.

### Thứ tự bộ bài (cả hai chế độ)

| Bộ bài, từ mạnh xuống yếu | Nghĩa |
|---|---|
| "Thùng phá sảnh hoàng gia" | 10-J-Q-K-A cùng chất |
| "Thùng phá sảnh" | 5 lá liên tiếp cùng chất |
| "Tứ quý" | 4 lá cùng số |
| "Cù lũ" | Bộ ba và một đôi |
| "Thùng" | 5 lá cùng chất |
| "Sảnh" | 5 lá liên tiếp (A-2-3-4-5 là sảnh nhỏ nhất, không vòng qua A) |
| "Sám" | 3 lá cùng số |
| "Hai đôi" | Hai đôi |
| "Một đôi" | Một đôi |
| "Mậu thầu" | Không có bộ nào, so lá cao nhất |

Hai bộ cùng loại thì so lá phụ; vẫn bằng nhau thì chia đều.

## 6. Chế độ nặn bài

Chế độ này chỉ có ở bàn Blind Poker được tạo với ô "Nặn bài"; danh sách phòng và đầu bàn có nhãn vàng "Nặn bài". Bài của bạn được chia **úp**, và bạn tự mở từng lá:

1. Đặt ngón tay (hoặc chuột) lên lá bài, ở góc hay mép nào cũng được.
2. Kéo về phía giữa lá. Lá bài gập mở ra từ đúng chỗ bạn chạm.
3. Kéo quá nửa lá rồi thả, hoặc hất nhanh, thì lá mở hẳn và nằm ngửa. Thả sớm thì lá úp lại, bạn nặn tiếp được.

Không muốn nặn thì bấm nút nhỏ "Lật" dưới bài để mở hết các lá còn úp. Khi **mọi** lá của bạn đã ngửa, bạn được tính là đã lật, và người khác thấy nhãn "Đã lật" ở ghế bạn (họ không thấy bài, chỉ biết bạn đã xem). Mới bóc một lá thì chưa tính.

**Vòng nặn tối đa 20 giây.** Đồng hồ vòng nằm trên tấm tên của bạn, khay báo "Mời nặn bài — hết giờ sẽ tự lật"; lật xong thì khay báo "Đã lật — chờ người chơi khác".

- Kiểu "Hoàn toàn may rủi": vòng **kết thúc sớm** ngay khi mọi người thật trong ván đã lật (bot được coi là đã lật từ đầu). Hết 20 giây, game lật hộ những lá còn úp, rồi lá chung được lật và so bài như thường.
- Kiểu "Chơi hoặc bỏ": 20 giây này cũng là lúc chọn. Bạn nặn rồi chọn "Chơi" hoặc "Bỏ bài"; chọn khi chưa nặn thì bài tự mở. Vòng kết thúc sớm khi mọi người đã chọn; hết giờ mà chưa chọn vẫn là "Bỏ bài". Ở kiểu này, ghế đã chọn hiện "Đã chọn" (chọn rồi cũng là đã lật).
- Bạn vẫn được chọn mà không cần nặn, tức là *chơi mù*. Không nặn kịp cũng không bị phạt: ở kiểu "Hoàn toàn may rủi", vòng nặn hết giờ không tính là một lượt hết giờ (ở kiểu "Chơi hoặc bỏ", hết giờ mà chưa chọn vẫn tính như mọi lượt hết giờ, mục 7).
- Bật "Tự động chơi" thì bài của bạn mở ngay khi chia.
- Vào lại giữa vòng (tải lại trang, mất kết nối): lá đã mở vẫn ngửa, lá chưa mở vẫn úp và nặn được.

**Không thấy hiệu ứng lật bài?** Game làm theo cài đặt giảm chuyển động của máy. Khi cài đặt này bật, lá bài chỉ hiện ra ở trạng thái cuối, không trượt, không lật, và lá nặn mở hay úp ngay lập tức. Muốn thấy hiệu ứng, trên Windows 11 bật **Settings → Accessibility → Visual effects → Animation effects**; trên iPhone, iPad tắt **Settings → Accessibility → Motion → Reduce Motion**; máy khác thì tìm mục giảm chuyển động trong phần trợ năng (tên mục có thể khác theo ngôn ngữ và phiên bản máy).

## 7. Mất kết nối, rời bàn, tự động chơi

| Tình huống | Điều gì xảy ra |
|---|---|
| Mất kết nối giữa ván | Trang hiện "Mất kết nối — đang kết nối lại…" và tự nối lại; người khác thấy "Mất kết nối" ở ghế bạn. Ván vẫn chạy: đến lượt bạn mà hết giờ thì game làm như khi hết giờ (Hold'em: xem hoặc bỏ bài; "Chơi hoặc bỏ": bỏ bài; vòng nặn: lật hộ). |
| Quay lại trong 90 giây | Bạn về đúng ghế, đúng bài, đúng lượt. Tải lại trang (F5) giữa ván cũng vậy. |
| Mất kết nối quá 90 giây | Bạn bị bỏ bài ở các lượt còn lại của ván; hết ván thì bị mời đứng dậy, stack về số dư. Nếu vẫn chưa quay lại, bạn còn ở trong phòng (đứng xem) thêm 5 phút rồi mới bị đưa ra. |
| Bấm "Đứng dậy" | Giữa hai ván: rời ghế ngay, stack về số dư. Giữa ván: bạn bỏ bài khi đến lượt, hết ván thì rời ghế. Bạn vẫn ở trong phòng. |
| Bấm "Rời phòng" | Giữa hai ván: ra sảnh ngay, stack về số dư. Giữa ván: như "Đứng dậy", rồi ra khỏi phòng khi ván kết thúc. |
| Bấm "Tạm nghỉ" | Giữ ghế nhưng không được chia các ván sau; ván đang chơi vẫn đánh hết. Bấm "Chơi tiếp" để quay lại. Tạm nghỉ suốt 5 ván liền thì bạn tự đứng dậy. |
| Hết giờ 3 lượt liên tiếp | Hết ván bạn bị mời đứng dậy, stack về số dư. |
| Máy chủ khởi động lại hoặc tắt đúng cách | Ván đang chơi bị hủy ("Ván bị hủy"), mọi điểm đã cược được trả lại, stack về số dư. |

Ở kiểu "Hoàn toàn may rủi" không có lượt nào để bỏ, nên khi bạn đứng dậy hay rời phòng giữa ván, bài của bạn vẫn được tính tới cuối ván. Nếu máy chủ bị tắt đột ngột (ví dụ đóng cửa sổ máy chủ Lite hay tắt máy), số dư vẫn còn nguyên nhưng điểm đang nằm trên bàn và pot cộng dồn có thể mất.

**"Tự động chơi"** có ở bàn Blind Poker kiểu "Chơi hoặc bỏ" và ở bàn nặn bài, ngay trên khay nút (Hold'em không có). Bật lên thì mỗi ván game chọn "Chơi" cho bạn, và ở bàn nặn thì mở bài ngay khi chia. Nút giữ nguyên tới khi bạn tắt, đứng dậy, tạm nghỉ hoặc rời phòng. Nút chạy trên máy của bạn: khi bạn mất kết nối, nó không chơi thay, và hết giờ vẫn tính là "Bỏ bài".

## 8. Nhân vật và Phòng thay đồ (bản Normal)

Mỗi người chơi có một nhân vật chibi. Ở bàn, người khác thấy nhân vật của bạn ở ghế, kèm danh hiệu và huy hiệu đang đeo ngay dưới tên; bot có nhân vật riêng. Bản Lite cũng vẽ nhân vật, nhưng đó là nhân vật mặc định chọn theo tên và không đổi được.

Mở "Hồ sơ" rồi bấm "Phòng thay đồ", hoặc bấm vào nhân vật của bạn ở "Sảnh chờ". Đồ được chia thành ba nhóm:

| Nhóm | Các mục |
|---|---|
| "Ngoại hình" | Chọn "Nữ" hoặc "Nam" ở đầu nhóm, rồi "Kiểu tóc", "Màu tóc", "Màu da", "Màu mắt" |
| "Trang phục" | "Mũ", "Phụ kiện mặt" (kính, mặt nạ, bịt mắt), "Quần áo" |
| "Trang trí" | "Hào quang", "Khung", "Danh hiệu & huy hiệu" |

Đổi giới tính thì kiểu tóc chuyển sang kiểu tương ứng (mỗi giới tính có 4 kiểu), quần áo đổi dáng, còn màu sắc và mũ giữ nguyên.

1. Bấm vào một thẻ để mặc thử, hình nhân vật đổi ngay. Món có nhiều màu hiện các chấm màu dưới thẻ, ví dụ "Áo phông đỏ" là một chấm của "Bộ thường ngày".
2. Dòng "● Có thay đổi chưa lưu" nhắc bạn còn thay đổi chưa lưu. Bấm "Lưu trang phục", hoặc "Hoàn tác" để quay về lần lưu trước.
3. Nếu rời trang khi chưa lưu, game hỏi "Thoát mà không lưu?": chọn "Ở lại" hoặc "Thoát không lưu".

Khung "Đang dùng" liệt kê các món đang mặc. Mặc định mỗi mục chỉ hiện món bạn có; tích "Hiện cả món chưa có" để xem cả món còn khóa và cách nhận chúng. Nhân vật, danh hiệu và huy hiệu mới hiện ở bàn từ lần vào phòng tiếp theo.

**"Bộ đồ đã lưu"** có 5 ô. Bấm vào một ô trống, đặt "Tên bộ đồ" (mặc định là "Bộ 1", "Bộ 2"…) rồi bấm "Lưu vào đây". Bấm vào một bộ đã lưu để mở menu: "Mặc bộ này", "Lưu đè" (ghi bộ đang thử vào ô này), "Đổi tên", "Xóa".

**Cách nhận đồ.** Mỗi món có độ hiếm "Thường", "Hiếm" hoặc "Cực hiếm". Không có cửa hàng; đồ đến từ:

- **Có sẵn**: mọi kiểu tóc, màu da, các màu tóc và màu mắt thường, "Bộ thường ngày" và các màu áo phông.
- **Quà điểm danh**: ngày 7 (một món thường), ngày 14 và 21 (một món hiếm), ngày 28 ("Huy hiệu tháng" và "Chuyên cần"), xem mục 2.
- **Thành tựu**: ví dụ danh hiệu "Vận đỏ" khi thắng 10 ván liên tiếp, "Khung một năm" khi điểm danh đủ 365 ngày; danh sách ở mục 9.

Thẻ của món còn khóa ghi cách nhận: tên thành tựu, hoặc "Có thể nhận từ quà điểm danh" kèm độ hiếm. Một số món hiện chưa có cách nhận, thẻ ghi "Chưa có cách nhận món này".

**Biểu cảm.** Khu "Xem thử biểu cảm" dưới hình nhân vật có hai nút ‹ › để xem các biểu cảm "Bình thường", "Vui", "Buồn", "Ngạc nhiên", "Nhắm mắt", "Ngủ". Bạn không cần chọn gì: ở bàn (cả ở bản Lite), nhân vật tự "Vui" khi thắng ván, "Buồn" khi thua lúc so bài, "Ngạc nhiên" khi có người tất tay, "Nhắm mắt" khi đã bỏ bài, và "Ngủ" khi đang tạm nghỉ, mất kết nối hoặc bàn hơn một phút không có ván.

## 9. Thành tựu (bản Normal)

Mở "Hồ sơ" rồi bấm "Thành tựu". Trang này cho biết bạn "Đã đạt" bao nhiêu trên tổng số, tiến độ từng thành tựu và ngày đạt. Khi đạt, bạn thấy thông báo "Đạt thành tựu mới" và nhận thưởng ngay, không phải bấm nhận. Ván bị hủy (ví dụ khi máy chủ khởi động lại) không được tính. Có 34 thành tựu trong bốn mục.

**"Điểm danh"**: *ngày ghé bàn* là số ngày bạn bấm "Nhận thưởng" ở "Điểm danh", không phải số lần đăng nhập.

| Thành tựu | Điều kiện | Thưởng |
|---|---|---|
| "Bảy ngày ghé bàn", "Ba mươi ngày ghé bàn" | điểm danh đủ 7, 30 ngày | 5.000, 20.000 điểm |
| "Trăm ngày ghé bàn" | điểm danh đủ 100 ngày | "Vương miện vàng" |
| "Một năm ghé bàn" | điểm danh đủ 365 ngày | "Khung một năm" |
| "Chuỗi 7 ngày" | chuỗi điểm danh 7 ngày | 5.000 điểm |
| "Chuỗi 28 ngày" | chuỗi điểm danh 28 ngày (trong cùng một tháng) | danh hiệu "Chuyên cần" |

**"Texas Hold'em"**: chuỗi thắng/thua, bộ bài thắng và ván thắng lớn tính cả ván Blind Poker. Ván bạn bỏ bài là ván không thắng.

| Thành tựu | Điều kiện | Thưởng |
|---|---|---|
| "Mười ván Hold'em", "Trăm ván Hold'em", "Nghìn ván Hold'em" | chơi 10, 100, 1.000 ván Hold'em | 2.000, 10.000, 50.000 điểm |
| "Mười ván thắng", "Trăm ván thắng", "Năm trăm ván thắng" | thắng 10, 100, 500 ván Hold'em | 5.000, 20.000 điểm, "Bộ nhà vô địch" |
| "Ba ván liền tay", "Năm ván liền tay", "Mười ván liền tay" | thắng 3, 5, 10 ván liên tiếp | 5.000, 15.000 điểm, danh hiệu "Vận đỏ" |
| "Lì đòn" | thua 10 ván liên tiếp | 10.000 điểm |
| "Thùng", "Cù lũ", "Tứ quý", "Thùng phá sảnh" | thắng một ván bằng bộ đó hoặc bộ mạnh hơn | 3.000, 5.000, 20.000, 50.000 điểm |
| "Thùng phá sảnh hoàng gia" | thắng một ván bằng thùng phá sảnh hoàng gia | "Hào quang bài vàng" |
| "Trăm nghìn một ván", "Nửa triệu một ván" | ăn 100.000, 500.000 điểm trong một ván | 10.000, 30.000 điểm |

**"Blind Poker"** và **"Hoạt động"**:

| Thành tựu | Điều kiện | Thưởng |
|---|---|---|
| "Mười ván Blind Poker", "Trăm ván Blind Poker", "Nghìn ván Blind Poker" | chơi 10, 100, 1.000 ván Blind Poker | 2.000, 10.000, 50.000 điểm |
| "Mười ván thắng Blind Poker", "Trăm ván thắng Blind Poker" | thắng 10, 100 ván Blind Poker | 5.000, 20.000 điểm |
| "Bạn thân của bot" | chơi 50 ván có bot cùng bàn | 5.000 điểm |
| "Mười phòng", "Trăm phòng" | vào 10, 100 phòng chơi | 2.000, 10.000 điểm |
| "Năm mươi ván trọn vẹn", "Năm trăm ván trọn vẹn", "Nghìn ván trọn vẹn" | chơi hết 50, 500, 1.000 ván từ đầu đến cuối | 5.000 điểm, "Huy hiệu kỳ cựu", "Khung kỳ cựu" |

## 10. Cài đặt

Trang "Cài đặt" của **bản Normal** có:

- "Giao diện": "Tối" hoặc "Sáng", được nhớ trên trình duyệt này.
- "Ngôn ngữ": "Tiếng Việt" hoặc "English" (ô này cũng có ở thanh điều hướng trên mọi trang).
- "Tài khoản": "Email", "Tên hiển thị" và nút "Đăng xuất". Bấm nút thì hộp "Đăng xuất?" hiện ra; bấm "Đăng xuất ngay" để xác nhận. Nếu đang ngồi bàn, bạn sẽ rời bàn.
- "Thông tin": "Ấn bản" ("Bản Normal") và "Phiên bản".

Đổi tên hiển thị ở "Hồ sơ": gõ vào ô "Tên hiển thị mới" rồi bấm "Lưu tên". Tên không được trùng với người khác.

Trang "Cài đặt" của **bản Lite** có "Giao diện", "Ngôn ngữ", "Phiên bản" và mục "Tài khoản" với "Mã người chơi" cùng nút "Đăng xuất khỏi thiết bị này". Hãy cẩn thận: bản Lite không có mật khẩu, nên đăng xuất là mất đường quay lại tài khoản này, và tên đang dùng cũng không lấy lại được. Bản Lite không đổi được tên hiển thị.

## 11. Câu hỏi thường gặp

| Bạn gặp | Lý do và cách xử lý |
|---|---|
| Bài hiện ra ngay, không trượt hay lật | Máy đang bật giảm chuyển động. Xem cách bật lại hiệu ứng ở cuối mục 6. |
| "Bạn không còn ở trong phòng" | Máy chủ đã đưa bạn ra khỏi phòng: bạn bị mời ra, mất kết nối quá lâu, hoặc phòng đã đóng. Quay về "Sảnh chờ" và vào lại nếu phòng vẫn còn. |
| "Chưa đủ người chơi" khi bấm "Bắt đầu" | Cần ít nhất 2 ghế đã "Sẵn sàng" và không "Tạm nghỉ", trong đó có ít nhất một người thật. Bàn Hold'em không có bot nên cần 2 người thật. |
| "Phòng đã đầy" | Hết chỗ. Bot và người đang đứng xem cũng chiếm chỗ. |
| "Sai mật khẩu" hoặc "Không tìm thấy phòng" | Hỏi lại chủ phòng mật khẩu và mã; phòng cũng có thể đã đóng. |
| "Bạn đang ở trong một phòng khác" | Rời phòng kia trước. |
| "Số dư không đủ" hoặc "Số dư không đủ để vào bàn" | Nhận điểm danh hoặc cứu trợ, hay chọn bàn có mức cược thấp hơn. Bàn Hold'em cần số dư ít nhất bằng buy-in tối thiểu. |
| Thời gian mỗi lượt quá ngắn | Chủ phòng chọn lúc tạo phòng, sau đó không đổi được; hãy tạo phòng mới. Ở Hold'em, dùng các nút chọn sẵn; ở Blind Poker, bật "Tự động chơi". |
| Trên điện thoại, phần bàn cuộn nhẹ | Trên điện thoại khoảng 375 px chiều ngang, ở bàn "Chơi hoặc bỏ" có "Nặn bài", phần bàn có thể cuộn chừng 11 px trong vòng nặn. Trang không cuộn, ghế của bạn (bài, nút "Lật", đồng hồ) vẫn ghim ở đáy. Đây là chuyện bình thường. |
| Số dư giảm, không biết điểm đi đâu | Lúc ngồi, điểm chuyển lên bàn thành stack và chỉ về khi bạn rời ghế. Mỗi pot có người thắng bị thu 2% phí bàn. Bản Normal: đối chiếu trong "Lịch sử điểm". Máy chủ tắt đột ngột thì điểm trên bàn có thể mất (mục 7). |
| Đầu tháng chuỗi điểm danh về ngày 1 | Đúng như thiết kế. Chỉ chuỗi điểm danh tính lại; số dư, đồ và thành tựu giữ nguyên. |
| Mở game ở tab hay máy khác thì nơi cũ báo "Mất kết nối" | Mỗi người chỉ có một kết nối; nơi cũ bị ngắt và không tự nối lại. Tải lại trang ở nơi bạn muốn chơi. |
| "Đã có phiên bản mới của trò chơi." | Bấm "Tải lại". |
| Đổi tên hay trang phục mà người cùng bàn chưa thấy | Thay đổi hiện ở bàn từ lần vào phòng tiếp theo. |
| Bản Lite báo "Phiên đăng nhập đã hết hạn. Vui lòng nhập lại tên hiển thị." | Máy chủ không còn nhận ra trình duyệt của bạn, ví dụ dữ liệu máy chủ vừa được làm mới. Nhập một tên để chơi tiếp; nếu thấy "Tên hiển thị đã có người dùng" thì chọn tên khác. |

## 12. Hai bản khác nhau ở đâu

| | Bản Normal | Bản Lite |
|---|---|---|
| Chạy ở đâu | Máy chủ trên Internet hoặc trong mạng nội bộ | Một chương trình trên máy Windows trong mạng nội bộ |
| Vào game | Email và mật khẩu | Tên hiển thị, không mật khẩu |
| Nhiều thiết bị | Một tài khoản, mọi thiết bị | Gắn với trình duyệt trên một thiết bị |
| Texas Hold'em, Blind Poker, bot, nặn bài | Có | Có |
| Phí bàn, cứu trợ | Có | Có |
| Điểm danh | Điểm và vật phẩm | Chỉ có điểm |
| Hồ sơ, thống kê, "Lịch sử điểm", "Ván gần đây" | Có | Không |
| Đổi tên hiển thị | Có, trong "Hồ sơ" | Không |
| Nhân vật | Tùy chỉnh trong "Phòng thay đồ" | Nhân vật mặc định theo tên |
| Danh hiệu, huy hiệu, thành tựu | Có | Không |
| Ngôn ngữ, giao diện "Tối" / "Sáng" | Có | Có |
