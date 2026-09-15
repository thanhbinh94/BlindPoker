# Tài liệu quy cách tài sản hình ảnh: nhân vật và kho đồ

Phiên bản: 1.0
Ngày: 12 tháng 9 năm 2026
Phạm vi: tính năng kho đồ phụ trợ trong game bài poker, phần thưởng theo thành tích và đăng nhập liên tục

---

## 1. Mục đích của tài liệu

Tài liệu này quy định toàn bộ yêu cầu về hình ảnh nhân vật và các món trang bị, để ba nhóm người dùng chung một chuẩn:

- Người vẽ hoặc công cụ sinh ảnh: biết chính xác phải tạo ra hình có kích thước, tư thế, vị trí nào.
- Lập trình viên: biết cách xếp lớp, cắt ảnh đại diện, đặt tên tệp và đọc dữ liệu mô tả món.
- Người chọn mua gói tài sản có sẵn: có bảng tiêu chí để đối chiếu, tránh mua về rồi không dùng được.

Mọi con số trong tài liệu này là con số đã chốt. Thay đổi bất kỳ con số nào ở mục 3 sau khi đã có món trang bị đầu tiên sẽ khiến toàn bộ món đã vẽ phải làm lại.

---

## 2. Thuật ngữ dùng trong tài liệu

- **Thân nền**: hình cơ thể nhân vật khi chưa mặc trang bị nào, mặc sẵn đồ lót cơ bản màu trung tính. Đây là lớp luôn hiển thị.
- **Lớp**: một tệp ảnh riêng biệt chứa đúng một món hoặc một bộ phận, phần còn lại trong suốt. Nhân vật hoàn chỉnh là kết quả xếp chồng nhiều lớp.
- **Ô trang bị**: một vị trí trên cơ thể có thể gắn món, ví dụ ô mũ. Mỗi ô tại một thời điểm chỉ chứa tối đa một món.
- **Khung ảnh**: kích thước tệp ảnh cố định mà mọi lớp đều dùng chung.
- **Khung cơ thể**: vùng bên trong khung ảnh mà cơ thể nhân vật thật sự chiếm chỗ.
- **Vùng dự phòng**: phần khung ảnh nằm ngoài khung cơ thể, dành cho trang bị phình ra ngoài cơ thể như mũ rộng vành, áo choàng.
- **Mốc neo**: các đường tham chiếu cố định mà mọi lớp căn theo, gồm trục dọc và đường chân đế.
- **Luật che khuất**: quy tắc "khi mặc món A thì ẩn lớp B", ví dụ đội mũ trùm kín thì ẩn tóc.
- **Kênh trong suốt**: thông tin độ trong của từng điểm ảnh trong tệp PNG, cho phép nhìn xuyên qua phần không có hình.

---

## 3. Quy cách khung ảnh toàn thân

### 3.1 Kích thước

| Hạng mục | Giá trị | Ghi chú |
|---|---|---|
| Khung ảnh | 384 điểm ảnh ngang, 448 điểm ảnh dọc | Áp dụng cho mọi lớp, không ngoại lệ |
| Khung cơ thể | 224 điểm ảnh ngang, 336 điểm ảnh dọc | Nằm giữa theo chiều ngang |
| Tọa độ góc trên trái của khung cơ thể | ngang 80, dọc 72 | Tính từ góc trên trái khung ảnh |
| Trục dọc giữa thân | ngang 192 | Đường thẳng đứng chia đôi khung ảnh |
| Đường chân đế | dọc 408 | Gót giày của thân nền chạm đúng đường này |
| Khoảng trống dưới chân đế | 40 điểm ảnh | Dành cho bóng đổ dưới chân hoặc giày cao |
| Vùng dự phòng mỗi bên | 80 điểm ảnh | Dành cho mũ rộng, áo choàng, vật cầm tay |

### 3.2 Tỉ lệ cơ thể

- Chiều cao nhân vật tính từ đỉnh đầu đến gót chân: 336 điểm ảnh, tương đương 2,25 đơn vị đầu người.
- Một đơn vị đầu người: 149 điểm ảnh.
- Đầu rộng hơn cao. Bề rộng đầu không kể tóc: khoảng 160 điểm ảnh.
- Vai rộng khoảng 50 đến 55 phần trăm bề rộng đầu.
- Thân trên và chân có chiều cao xấp xỉ bằng nhau.
- Đường mắt nằm ở khoảng 60 đến 65 phần trăm chiều cao đầu tính từ đỉnh xuống.

### 3.3 Tư thế bắt buộc của thân nền

- Đứng thẳng, nhìn chính diện, trọng tâm ở giữa.
- Hai tay hạ xuống, hơi tách khỏi thân người để tay áo và găng tay không bị thân che.
- Hai chân hơi tách nhau, bàn chân hướng ra trước.
- Đầu được phép nghiêng tối đa 8 độ để tạo sự tự nhiên. Thân và chân không nghiêng.
- Biểu cảm mặc định: điềm tĩnh, hơi mỉm cười, mắt mở.
- Không cầm vật gì trên tay ở thân nền. Vật cầm tay là một món riêng thuộc ô vật cầm tay.

### 3.4 Quy tắc bất biến

Ba thứ sau đây không bao giờ được thay đổi sau khi đã có món trang bị đầu tiên: kích thước khung ảnh, vị trí trục dọc, vị trí đường chân đế. Đây là điều kiện để mọi lớp ghép khớp nhau chỉ bằng cách đặt chồng lên, không cần tính toán vị trí.

---

## 4. Quy cách các lớp và thứ tự xếp lớp

### 4.1 Danh sách ô trang bị

Kho đồ giai đoạn một có bốn ô. Danh sách này đã được rút gọn có chủ đích để phù hợp với tính năng phụ trợ.

| Mã ô | Tên ô | Vị trí trên cơ thể | Ghi chú |
|---|---|---|---|
| SLOT_HEAD | Mũ và đội đầu | Đỉnh đầu, có thể tràn sang hai bên | Ô có giá trị cao nhất, luôn thấy tại bàn chơi |
| SLOT_FACE | Phụ kiện mặt | Vùng mắt và mũi | Kính, mặt nạ, băng che mắt |
| SLOT_OUTFIT | Bộ trang phục trọn gói | Từ cổ đến bàn chân | Gộp áo, quần, giày, tay áo vào một món |
| SLOT_AURA | Hiệu ứng nền | Toàn bộ khung, nằm sau nhân vật | Vòng sáng, khung viền, hạt bay. Không dính vào cơ thể |

Ô vật cầm tay là ô mở rộng, chỉ thêm ở giai đoạn hai nếu cần.

### 4.2 Thứ tự xếp lớp

Đánh số từ dưới lên trên. Số nhỏ hơn bị đè bởi số lớn hơn.

| Thứ tự | Tên lớp | Thuộc về | Mô tả |
|---|---|---|---|
| 10 | Hiệu ứng nền | SLOT_AURA | Vòng sáng, hoa văn, hạt bay phía sau nhân vật |
| 20 | Tóc phía sau | Thân nền | Phần tóc nằm sau đầu và sau vai |
| 30 | Thân nền | Thân nền | Da, đồ lót cơ bản, chân, tay, bàn tay, bàn chân |
| 40 | Bộ trang phục | SLOT_OUTFIT | Toàn bộ quần áo, giày, tay áo |
| 50 | Đầu và khuôn mặt | Thân nền | Mặt, mắt, mũi, miệng, má hồng, tai |
| 60 | Tóc phía trước | Thân nền | Tóc mái và tóc mai, đè lên trán và má |
| 70 | Phụ kiện mặt | SLOT_FACE | Kính, mặt nạ |
| 80 | Mũ và đội đầu | SLOT_HEAD | Mũ, băng đô, ghim tóc |

Lý do tóc tách thành hai lớp: tóc phía sau phải nằm dưới bộ trang phục để đuôi tóc bị áo che, còn tóc mái phải nằm trên khuôn mặt. Nếu gộp một lớp thì không thể vừa che vừa bị che.

### 4.3 Luật che khuất

Mỗi món trang bị mang theo một danh sách các lớp cần ẩn khi mặc. Giai đoạn một chỉ có các luật sau:

| Khi mặc món thuộc ô | Có thuộc tính | Thì ẩn lớp |
|---|---|---|
| SLOT_HEAD | hides_hair_front = true | 60 Tóc phía trước |
| SLOT_HEAD | hides_hair_back = true | 20 Tóc phía sau |
| SLOT_FACE | hides_eyes = true | Không ẩn lớp, chỉ vẽ đè. Dùng cho mặt nạ che kín mắt |

Mũ đội hờ lên đỉnh đầu, như mũ nồi hay băng đô, không ẩn tóc. Mũ trùm kín, như mũ trùm hay mũ bảo hiểm kín, ẩn cả hai lớp tóc. Người thiết kế món phải quyết định thuộc tính này ngay khi tạo món.

---

## 5. Quy cách ảnh đại diện tại bàn chơi

Ảnh đại diện không vẽ riêng. Nó được cắt tự động từ nhân vật đã ghép lớp.

| Hạng mục | Giá trị |
|---|---|
| Vùng cắt trên khung toàn thân | Ô vuông 208 nhân 208 điểm ảnh, góc trên trái tại ngang 88, dọc 40 |
| Kích thước hiển thị | 250 nhân 250 điểm ảnh, tức phóng to khoảng 1,2 lần |
| Hình dạng hiển thị | Tròn, đường kính 250, bo bằng mặt nạ tròn ở phía ứng dụng |
| Lớp được ghép vào ảnh đại diện | Tất cả các lớp từ 10 đến 80 |
| Khung viền | Vẽ riêng thành lớp tròn 260 nhân 260 điểm ảnh, đặt đè lên ngoài cùng |

Vùng cắt được đặt để chứa trọn mũ, khuôn mặt, phụ kiện mặt và phần vai của bộ trang phục. Mọi món thuộc SLOT_HEAD và SLOT_FACE phải nằm trọn trong vùng cắt này. Món nào tràn ra ngoài vùng cắt sẽ bị cắt cụt tại bàn chơi, và đây là lỗi thiết kế món, không phải lỗi hệ thống.

**2026-09-15**: vùng cắt dời từ ô vuông 160 nhân 160, góc trên trái tại ngang 112, dọc 48, sang các con số ở bảng trên. Bức ảnh F01 thật đầu tiên cho thấy vùng cắt cũ cắt cụt khuôn mặt ngay tại mắt; trục dọc giữa thân (ngang 192) không đổi.

---

## 6. Quy cách ô biểu tượng trong túi đồ

Mỗi món có thêm một hình biểu tượng riêng để hiển thị trong lưới túi đồ. Hình này không liên quan đến cơ thể.

| Hạng mục | Giá trị |
|---|---|
| Kích thước | 128 nhân 128 điểm ảnh |
| Vùng an toàn | Hình nằm trong ô 104 nhân 104 ở giữa, chừa 12 điểm ảnh mỗi cạnh |
| Nền | Trong suốt. Nền ô do ứng dụng vẽ, để đổi màu theo độ hiếm |
| Góc nhìn | Món được vẽ nằm gọn, hướng ra trước, hơi nghiêng ba phần tư nếu cần để nhận ra |
| Bóng đổ | Không có bóng đổ trong tệp |

Với bộ trang phục trọn gói, biểu tượng là hình bộ đồ gấp gọn hoặc hình móc treo bộ đồ, không phải hình nhân vật đang mặc.

---

## 7. Quy cách lớp hiệu ứng nền và khung viền

| Hạng mục | Giá trị |
|---|---|
| Kích thước lớp hiệu ứng nền | 384 nhân 448, cùng khung toàn thân |
| Vùng được phép vẽ | Toàn bộ khung, nhưng phần nằm sau khung cơ thể sẽ bị nhân vật che |
| Kích thước khung viền ảnh đại diện | 260 nhân 260, tâm tại giữa, phần trong đường kính 250 để trống |
| Độ trong suốt | Được phép dùng độ trong một phần, ví dụ vòng sáng mờ 50 phần trăm |

Đây là loại phần thưởng rẻ nhất để sản xuất và luôn hiển thị tại bàn chơi, nên được ưu tiên trong lộ trình phần thưởng đăng nhập liên tục.

---

## 8. Định dạng tệp và yêu cầu kỹ thuật để nhúng vào ứng dụng

### 8.1 Định dạng

- Định dạng bắt buộc: PNG 32 bit, có kênh trong suốt 8 bit.
- Không dùng JPG cho bất kỳ lớp nào vì JPG không có kênh trong suốt.
- Không dùng GIF vì kênh trong suốt của GIF chỉ có bật hoặc tắt, không có độ mờ trung gian, sẽ tạo viền răng cưa.
- Không gian màu: sRGB. Không nhúng hồ sơ màu khác.
- Không dùng chế độ màu bảng tra 256 màu, vì nó phá chuyển màu mềm.

### 8.2 Mật độ màn hình

Mọi lớp được sản xuất ở ba mật độ để hiển thị sắc nét trên mọi điện thoại:

| Hậu tố | Hệ số | Kích thước khung toàn thân | Kích thước biểu tượng |
|---|---|---|---|
| @1x | 1 | 384 nhân 448 | 128 nhân 128 |
| @2x | 2 | 768 nhân 896 | 256 nhân 256 |
| @3x | 3 | 1152 nhân 1344 | 384 nhân 384 |

Quy trình sản xuất: vẽ hoặc sinh ở kích thước @3x hoặc lớn hơn, rồi thu nhỏ xuống @2x và @1x. Không bao giờ phóng to từ kích thước nhỏ lên.

### 8.3 Yêu cầu về nội dung điểm ảnh

- Phần không có hình phải trong suốt hoàn toàn, giá trị kênh trong suốt bằng 0, không phải màu trắng.
- Không có bóng đổ xuống mặt đất trong tệp thân nền hay trang phục. Bóng dưới chân do ứng dụng vẽ nếu cần.
- Không có chữ, chữ ký, hình mờ trong tệp.
- Viền của hình phải có ít nhất 1 điểm ảnh chuyển mềm từ đục sang trong, để không bị răng cưa khi thu nhỏ.
- Không có điểm ảnh rác bán trong suốt ở vùng đáng lẽ trống. Kiểm tra bằng cách đặt lên nền đen thuần và nền trắng thuần.
- Màu ở rìa hình phải là màu của hình, không phải màu trắng bị lẫn. Lỗi này gọi là viền trắng, xuất hiện khi xuất tệp sai cách từ phần mềm vẽ.

### 8.4 Đóng gói

- Trong Unity: đưa toàn bộ lớp vào một Sprite Atlas theo từng mật độ, bật tùy chọn cắt phần trong suốt, tắt nén có mất dữ liệu cho các lớp có chuyển màu mềm.
- Trong Flutter hoặc React Native: đặt tệp theo thư mục hoặc hậu tố mật độ đúng quy ước của nền tảng.
- Trong web: dùng ảnh @2x làm mặc định, @1x cho kết nối chậm.
- Nếu ứng dụng hỗ trợ SVG cho lớp hiệu ứng nền và khung viền, có thể dùng SVG cho hai loại này vì chúng không cần chất vẽ tay. Thân nền và trang phục vẫn dùng PNG.

---

## 9. Quy tắc đặt tên tệp và dữ liệu mô tả món

### 9.1 Tên tệp

Cấu trúc: `[loại]_[mã ô]_[mã món]_[lớp]@[mật độ].png`

Ví dụ:

- `base_body_default_L30@2x.png` thân nền, lớp 30, mật độ 2
- `base_body_default_L20@2x.png` tóc sau của thân nền
- `base_body_default_L50@2x.png` khuôn mặt
- `base_body_default_L60@2x.png` tóc trước
- `item_head_tophat01_L80@2x.png` mũ chóp số 01, lớp 80
- `item_outfit_dealer01_L40@2x.png` bộ trang phục người chia bài số 01
- `item_aura_goldring01_L10@2x.png` hiệu ứng nền vòng vàng
- `icon_head_tophat01@2x.png` biểu tượng của mũ chóp trong túi

Chỉ dùng chữ thường, số và dấu gạch dưới. Không dùng dấu cách, không dùng tiếng Việt có dấu trong tên tệp.

### 9.2 Dữ liệu mô tả món

Mỗi món có một bản ghi mô tả. Định dạng gợi ý là JSON, lập trình viên có thể chuyển sang định dạng của hệ thống.

```json
{
  "item_id": "head_tophat01",
  "slot": "SLOT_HEAD",
  "display_name_vi": "Mũ chóp quý ông",
  "layer_order": 80,
  "layer_file": "item_head_tophat01_L80",
  "icon_file": "icon_head_tophat01",
  "hides_hair_front": false,
  "hides_hair_back": false,
  "rarity": "rare",
  "unlock_type": "achievement",
  "unlock_condition": "win_100_hands",
  "fits_avatar_crop": true
}
```

Giải thích các trường:

- `item_id`: mã duy nhất, trùng với phần mã trong tên tệp.
- `slot`: ô trang bị mà món thuộc về. Mỗi món chỉ thuộc một ô.
- `layer_order`: số thứ tự xếp lớp theo mục 4.2. Với ô đã cố định thì trường này lặp lại giá trị của ô, giữ để tiện tra cứu.
- `hides_hair_front`, `hides_hair_back`: luật che khuất, mục 4.3.
- `rarity`: độ hiếm, quyết định màu nền ô trong túi.
- `unlock_type`: cách mở khóa, gồm `achievement` theo thành tích, `login_streak` theo chuỗi đăng nhập, `default` có sẵn.
- `unlock_condition`: điều kiện cụ thể, do hệ thống thành tích diễn giải.
- `fits_avatar_crop`: xác nhận món nằm trọn trong vùng cắt ảnh đại diện. Bắt buộc bằng true với SLOT_HEAD và SLOT_FACE.

---

## 10. Tiêu chí nghiệm thu từng tệp hình

Mỗi tệp trước khi đưa vào ứng dụng phải qua đủ các mục sau. Một mục không đạt là trả lại.

1. Kích thước tệp đúng với khung và mật độ khai báo, sai một điểm ảnh cũng không đạt.
2. Đặt chồng lên thân nền tại tọa độ 0,0 thì khớp vị trí, không cần dịch chuyển.
3. Không có phần nào của hình vượt ra ngoài mép khung ảnh.
4. Phần trống trong suốt hoàn toàn, kiểm tra trên nền đen và nền trắng.
5. Không có viền trắng ở rìa hình.
6. Với SLOT_HEAD và SLOT_FACE: nằm trọn trong vùng cắt ảnh đại diện.
7. Với SLOT_OUTFIT: che kín toàn bộ đồ lót cơ bản của thân nền, không để lộ.
8. Phong cách tô màu, độ dày nét viền, bảng màu khớp với thân nền khi nhìn ở kích thước @1x.
9. Nhìn rõ và nhận ra được ở ba kích thước: toàn thân @1x, ảnh đại diện 192, biểu tượng 128.
10. Tên tệp đúng quy tắc mục 9.1 và có bản ghi mô tả tương ứng.

---

## 11. Bảng tiêu chí chọn gói tài sản mua sẵn

Dùng bảng này khi đối chiếu một gói trên Unity Asset Store, itch.io, Craftpix hoặc nguồn tương tự. Cột "bắt buộc" không đạt thì loại ngay, không cần xét tiếp.

| Tiêu chí | Bắt buộc | Cách kiểm tra |
|---|---|---|
| Nhân vật được tách thành các lớp riêng, ít nhất tách được đầu, thân, trang phục, tóc | Có | Xem ảnh mô tả gói hoặc danh sách tệp, tìm chữ "layered", "separate parts", "modular", "customizable" |
| Có tư thế đứng yên chính diện | Có | Xem ảnh mẫu, tư thế phải là đứng thẳng nhìn ra trước |
| Xuất được PNG có kênh trong suốt | Có | Mô tả gói ghi "PNG with transparency" hoặc "alpha" |
| Giấy phép cho phép dùng trong sản phẩm thương mại | Có | Đọc mục license, tìm "commercial use". Nếu không rõ thì hỏi tác giả trước khi mua |
| Cho phép thêm bộ phận và trang bị tự vẽ vào hệ thống | Có | Tìm "add your own parts" hoặc có tệp nguồn dạng PSD, SVG, hoặc mô tả cách thêm |
| Độ phân giải gốc của nhân vật toàn thân từ 1000 điểm ảnh chiều cao trở lên | Có | Để thu nhỏ được xuống @3x, @2x, @1x |
| Phong cách là chibi có đầu rộng, mắt to đặt thấp, tô phẳng hoặc bán phẳng | Có | So với bảng thiết kế nhân vật kèm tài liệu số 02 |
| Có sẵn nhiều mũ, kính, phụ kiện đầu | Nên có | Đây là ô phần thưởng chủ lực |
| Trang phục dạng trọn bộ hoặc gộp được thành trọn bộ | Nên có | Nếu gói tách áo, quần, giày rời thì gộp ba lớp lại thành một khi xuất |
| Có bản chạy độc lập không cần Unity | Nên có | Để người thiết kế xuất tệp mà không cần lập trình viên |
| Có cộng đồng hoặc gói mở rộng đang cập nhật | Nên có | Xem ngày cập nhật gần nhất và số gói bổ sung |
| Gói không dùng nhân vật giống các thương hiệu nổi tiếng | Có | Tránh rủi ro bản quyền dây chuyền |

Sau khi mua, việc đầu tiên là xuất thân nền của gói ra và ép về khung 384 nhân 448 theo mục 3. Nếu tỉ lệ của gói không khớp khung, phải điều chỉnh các con số khung theo gói **trước** khi tạo món đầu tiên, và cập nhật tài liệu này.

---

## 12. Ước lượng khối lượng hình cho lộ trình phần thưởng

Giả sử lộ trình giai đoạn một gồm: 1 thân nền, 8 mũ, 4 phụ kiện mặt, 4 bộ trang phục, 8 hiệu ứng nền, 6 khung viền ảnh đại diện.

| Loại | Số món | Số lớp mỗi món | Số biểu tượng | Tổng tệp ở một mật độ |
|---|---|---|---|---|
| Thân nền | 1 | 4 | 0 | 4 |
| Mũ | 8 | 1 | 1 | 16 |
| Phụ kiện mặt | 4 | 1 | 1 | 8 |
| Bộ trang phục | 4 | 1 | 1 | 8 |
| Hiệu ứng nền | 8 | 1 | 1 | 16 |
| Khung viền | 6 | 1 | 1 | 12 |
| **Tổng** | **31** | | | **64** |

Nhân ba mật độ: 192 tệp. Trong đó chỉ khoảng 36 tệp thật sự cần chất vẽ tay, gồm thân nền, mũ, phụ kiện mặt, trang phục và biểu tượng của chúng; số còn lại là hiệu ứng nền và khung viền có thể làm bằng vector.

---

## 13. Ghi chú về hai hướng sản xuất và cách tài liệu này áp dụng cho từng hướng

- **Hướng mua gói tài sản**: dùng mục 11 để chọn, sau đó dùng mục 3 để căn lại khung, mục 9 để đặt tên, mục 10 để nghiệm thu.
- **Hướng sinh ảnh bằng công cụ**: dùng tài liệu số 02 để sinh, sau đó cắt lớp theo mục 4, nghiệm thu theo mục 10. Mục 8.3 đặc biệt quan trọng vì ảnh sinh ra thường có nền không trong suốt và viền không sạch.
- **Hướng thuê họa sĩ**: giao toàn bộ tài liệu này cùng tệp SVG khung mẫu để họa sĩ vẽ đúng trên khung.
