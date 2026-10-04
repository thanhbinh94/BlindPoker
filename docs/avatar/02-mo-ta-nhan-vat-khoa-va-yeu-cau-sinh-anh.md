# Mô tả nhân vật khóa và yêu cầu sinh ảnh bằng công cụ trí tuệ nhân tạo

Phiên bản: 1.0
Ngày: 12 tháng 9 năm 2026
Dùng kèm với: Tài liệu số 01, Quy cách tài sản nhân vật và kho đồ
Sửa đổi 2026-10-04 (Plan 19, nhân vật v4; thiết kế `docs/superpowers/specs/2026-10-03-avatar-v4-design.md` mục 5.2 và 11): mục 2 (khối khóa mới), 4, đầu mục 5 và mục 8, tiêu chí 7.

---

## 1. Cách dùng tài liệu này

Tài liệu này giải quyết vấn đề lớn nhất khi dùng công cụ sinh ảnh cho một hệ thống nhân vật: công cụ rất giỏi tạo ra **một** bức ảnh đẹp, nhưng kém ở việc tạo ra **cùng một nhân vật** nhiều lần với các món trang bị khác nhau. Nếu không có quy trình, bạn sẽ nhận được mười bức ảnh đẹp của mười cô gái khác nhau.

Quy trình bắt buộc gồm năm bước, làm theo đúng thứ tự:

1. **Tạo ảnh chủ.** Dùng mục 2 và mục 4 để sinh nhiều ứng viên cho thân nền. Chọn đúng một ảnh làm ảnh chủ. Từ đây trở đi, mọi lần sinh đều phải neo vào ảnh chủ này.
2. **Duyệt ảnh chủ theo lưới tỉ lệ.** Tải ảnh chủ lên cho tôi, tôi đối chiếu với khung 384 nhân 448 và lưới 2,25 đơn vị đầu người. Ảnh chủ không đạt thì quay lại bước 1. Không được đi tiếp với ảnh chủ sai tỉ lệ, vì mọi món về sau sẽ kế thừa cái sai đó.
3. **Sinh các biến thể trang bị.** Với mỗi món, dùng câu lệnh ở mục 5, luôn kèm ảnh chủ làm tham chiếu nhân vật và khóa cùng một số seed nếu công cụ cho phép.
4. **Dọn và tách lớp.** Ảnh sinh ra là một bức ảnh liền. Người dọn dùng phần mềm vẽ để xóa nền, tách phần món ra thành lớp riêng, đặt lên khung theo tài liệu số 01. Bước này không bỏ qua được.
5. **Nghiệm thu.** Theo mục 8 của tài liệu này và mục 10 của tài liệu số 01.

---

## 2. Mô tả nhân vật khóa

Đây là bản mô tả cố định. Mọi lần sinh một thân nền đều phải chứa nguyên văn khối khóa ở mục 2.3; các ảnh khác (nét mặt, tóc, quần áo, mũ, kính) thừa hưởng nó qua ảnh tham chiếu. Không thêm, không bớt, không diễn đạt lại giữa các lần sinh, vì mỗi thay đổi nhỏ trong mô tả đều làm nhân vật trôi.

### 2.1 Mã nhân vật

- Mã nội bộ: `BODY_F` (thân nữ) và `BODY_M` (thân nam), từ nhân vật v4 (Plan 19, 2026-10-03). Hai thân cùng khung, cùng dáng, đầu đặt đúng chỗ đầu F01 (phép kiểm C12), khác nhau ở khuôn mặt (mục 2.3). Mã `BASE_F01` và `BASE_M01` của sáu thân phẳng cũ (f01…m03, tóc vẽ liền) đã bỏ cùng các thân đó.
- Tên gợi ý trong game: tùy đội quyết định, không ảnh hưởng đến hình.

### 2.2 Bản mô tả bằng tiếng Việt, để đội đọc và duyệt

Đây là bản tiếng Việt của khối khóa ở mục 2.3 (thân nền v4, Plan 19). Bản tiếng Anh là bản duy nhất đưa vào công cụ.

Thân nền dùng cho trò chơi thay trang phục: tóc, quần áo và phụ kiện được thêm sau thành các lớp riêng, nên **đầu phải hoàn toàn trọc**.

Giữ nguyên từ ảnh F01 làm tham chiếu: tỉ lệ chibi (khoảng 2,25 đơn vị đầu người), khuôn mặt (mắt, cỡ và vị trí mắt, mũi, miệng, má, cằm) đúng cỡ và đúng chỗ trong khung, nét viền, cách tô bán-painterly, nền trong suốt và kích thước ảnh. Mọi thứ còn lại được vẽ lại như dưới đây.

Nhân vật chibi anime, nữ hoặc nam, cao khoảng 2,25 đơn vị đầu người, đầu rất to và tròn, thân nhỏ, tay chân ngắn.

Đầu: trọc hoàn toàn, nhẵn và sạch, không tóc, không chân tóc, không râu lởm chởm, không bóng tóc. Hộp sọ là một vòm đều, cùng màu da mặt, nhỏ hơn đường viền tóc trong ảnh gốc một chút. Tai nhỏ, đơn giản. Lông mày mảnh, vẽ ngay trên da.

Mặt: mắt rất to, mỗi mắt gần nửa bề rộng mặt. Thân nữ có tròng xanh dương chuyển từ xanh navy đậm ở trên xuống xanh ngọc sáng ở dưới, ba đốm sáng trắng, mi trên dày hất ra ngoài, miệng nhỏ hơi mở, mỉm cười. Thân nam có tròng hổ phách ấm chuyển từ nâu đậm ở trên xuống hổ phách sáng ở dưới, ba đốm sáng trắng, mi trên ngắn và đơn giản, miệng nhỏ, cười điềm tĩnh. Mũi chỉ là một chấm nhỏ. **Không má hồng, không trang điểm** (xem ghi chú dưới mục 2.3).

Da: màu kem sáng ấm trên mặt, đầu, cổ, tay, bàn tay và chân; tô bóng bán-painterly mềm. Tông kem này là tông "Tự nhiên"; mọi tông da khác do ứng dụng tô lên qua mặt nạ da.

Dáng: đứng thả lỏng tự nhiên, nhìn chính diện ngang tầm mắt, đầu thẳng và ở giữa, không nghiêng. Trọng tâm hơi dồn về một chân; vai hạ thả lỏng; hai tay buông lỏng, hơi cong, tách rõ khỏi thân để cả hai bàn tay hiện trên nền trống; hai bàn chân cùng đứng trên một đường chân, hướng ra trước.

Bàn tay: bàn tay chibi nhỏ, mở, lòng bàn tay quay về phía đùi, mỗi tay có đúng năm ngón (bốn ngón và một ngón cái), hơi tách nhau để thấy từng ngón. Không phải găng, không nắm tay, không phải bàn tay hoạt hình bốn ngón. Không cầm gì.

Thân mặc: áo ba lỗ xám trung bình và quần đùi xám than, trơn, không hoa văn, chân trần. Áo không được xám nhạt: màu xám nhạt nằm gần màu kem của da đến mức mặt nạ da lẫn áo vào da.

Nét viền màu, không phải đen thuần: viền quanh da màu nâu ấm, viền quanh quần áo màu xanh đen, độ dày vừa phải, sạch.

Tô: da bán-painterly; quần áo cel hai tông; không chất liệu, không nhiễu, không chữ, không hình mờ. Không có tóc ở bất kỳ chỗ nào: không mái, không chân tóc, không râu lởm chởm, không bóng tóc.

Kích thước ra đúng kích thước ảnh vào, 1024 nhân 1536 điểm ảnh, với khuôn mặt đúng chỗ và đúng cỡ như trong ảnh vào.

### 2.3 Bản mô tả khóa bằng tiếng Anh, để đưa vào công cụ

Công cụ sinh ảnh hiểu tiếng Anh ổn định hơn nhiều. Khối dưới đây là **mẫu `body`** của sổ tài sản (`assets/avatar-src/registry.json`, `templates.body`), chép nguyên văn; mọi ảnh thân nền đều được sinh từ nó, và `avatar:registry next` in ra bản đã điền. Phần `CHARACTER LOCK BODY_…` là **khối khóa** và phải đi nguyên văn trong mọi lần sinh một thân. Ảnh tham chiếu đính kèm là bức F01 gốc (`f01_candidate_1.png`): cùng một khung, cùng tỉ lệ.

```
This is a base model for a 2D dress-up game: hair, clothes and accessories are added later as separate layers, so the head must be completely bald.
Keep from the input image: the chibi proportions (about 2.25 heads tall), the face (eyes, eye size and placement, nose, mouth, cheeks, chin) at exactly the same size and position in the frame, the line art, the semi-painterly anime rendering, the transparent background and the image size. Redraw everything else as follows.
CHARACTER LOCK BODY_{{look.code}}:
Chibi anime {{look.figure}}, about 2.25 heads tall, oversized round head, small body, short limbs.
Head: {{look.head}}. The skull is a smooth even dome the same colour as the face, a little smaller than the hair outline in the input. Simple small ears. Thin eyebrows drawn on the skin.
Face: {{look.eyes}}, a tiny dot nose, {{look.mouth}}. No blush, no makeup.
Skin: warm light cream on the face, scalp, neck, arms, hands and legs; soft semi-painterly shading.
Pose: relaxed natural standing pose, front view at eye level, head upright and centred, not tilted. Weight slightly more on one leg; shoulders relaxed and lowered; both arms hang loosely, slightly bent, held clearly away from the body so both hands are drawn against the empty background; both feet on the same ground line, pointing forward.
Hands: small open chibi hands, palms toward the thighs, each with exactly five fingers (four fingers and one thumb), slightly apart so every finger is visible. Not mittens, not fists, not cartoon four-finger hands. Nothing in the hands.
Clothing: a plain mid-gray tank top and plain charcoal shorts, no pattern, barefoot.
Line art: colored outlines, warm brown around the skin, navy black around the clothing, medium clean line weight.
Rendering: semi-painterly skin, two-tone cel shading on the clothing, no texture, no noise, no text, no watermark.
No hair anywhere: no fringe, no hairline, no stubble, no hair shadow.
Output the exact same image size as the input, 1024 by 1536 pixels, with the face in exactly the same place and at exactly the same size as in the input.
```

Các chỗ `{{look.…}}` do từng thân điền (`look` của mục trong sổ tài sản):

| `look` | Thân nữ (`body_f`) | Thân nam (`body_m`) |
|---|---|---|
| `code` | F | M |
| `figure` | girl | boy |
| `head` | completely bald, smooth and clean, no hair at all, no hairline, no stubble, no hair shadow | completely bald, smooth and clean, no hair at all, no hairline, no stubble, no hair shadow |
| `eyes` | very large eyes, each nearly half the face width, blue iris gradient from deep navy at the top to bright aqua at the bottom, three white highlights, thick upper lashes flicking outward | very large eyes, each nearly half the face width, warm amber iris gradient from deep brown at the top to bright amber at the bottom, three white highlights, short simple upper lashes |
| `mouth` | a small, slightly open smiling mouth | a small calm smile |

Mục `look` còn một khóa nữa, `head_fallback`, không nằm trong mẫu: "very short buzz-cut hair lying flat against the scalp, one even dark colour, no fringe and no loose strands" (cho cả hai thân). Đó là câu mô tả đầu dự phòng, đặt vào một lời nhắc viết tay thay cho dòng `Head:` khi công cụ không vẽ nổi một cái đầu trọc sạch; tóc sát da khi đó được tách khỏi đầu bằng mặt nạ.

**Những gì đã đổi so với khối cũ** (`BASE_F01`, `BASE_M01`, Plan 11):

- Bỏ cụm tiếng Anh mô tả **bàn tay dạng găng** của khối cũ (dòng đầu của nó). Thay bằng đúng năm ngón, rõ từng ngón; mẫu còn dặn thẳng là không phải găng, không nắm tay (nhân vật cần có ngón tay, No14).
- Đầu **trọc**: tóc là món riêng nên không còn mô tả tóc trong khối khóa; mỗi kiểu tóc được vẽ sau, trên thân trọc (mẫu `hair` của sổ tài sản).
- Dáng đứng **thả lỏng** thay cho đứng thẳng tay hạ xuống.
- **Không má hồng** (quyết định 13 của Plan 19). Mặt nạ da không mang được một mảng hồng sang tông da đậm: mảng hồng không được tô lại nên vẫn nhạt, và hiện ra như những vệt bợt trên da nâu. Khối cũ có "soft pink blush on both cheeks". Nếu người dùng không ưng khuôn mặt thiếu má hồng, phương án thay là vẽ má hồng và mở rộng cửa sổ màu của mặt nạ da về phía đỏ (`SKIN_MASK`, `docs/avatar-2d.md` mục 4.4.1); chưa làm.
- Áo ba lỗ **xám trung bình**, quần đùi **xám than**, thay cho "xám nhạt" và "xám đậm" (lý do ở mục 2.2).
- Khối kết thúc bằng **dòng kích thước** ("Output the exact same image size as the input, 1024 by 1536 pixels, …"): mô hình ảnh trả một ảnh sửa 1024 nhân 1536 thành 1086 nhân 1448 nếu không được dặn.

Các loại ảnh khác (nét mặt, kiểu tóc, bộ trang phục, mũ, kính, bot) cũng được sinh từ các mẫu của sổ tài sản (`templates.bodyExpression`, `hair`, `outfit`, `head`, `face`, `bot`), mỗi mẫu bắt đầu bằng "Keep this exact image…" và chỉ đổi một thứ. Chúng không chép lại khối khóa: khối khóa nằm trong ảnh tham chiếu. Chi tiết ở `docs/avatar-2d.md` mục 10.1.

---

## 3. Yêu cầu kỹ thuật bắt buộc cho mọi ảnh sinh ra

Các yêu cầu này tồn tại vì hai lý do: để tách lớp được sạch, và để nhúng được vào ứng dụng theo tài liệu số 01. Ảnh đẹp mà vi phạm mục này thì vẫn không dùng được.

### 3.1 Bố cục và khung hình

| Yêu cầu | Giá trị | Lý do |
|---|---|---|
| Góc nhìn | Chính diện, ngang tầm mắt, không nhìn từ trên xuống hay dưới lên | Để mọi lớp cùng phối cảnh |
| Toàn thân | Thấy từ đỉnh tóc đến hết bàn chân, không bị cắt | Để căn được đường chân đế |
| Vị trí trong khung | Nhân vật ở giữa, chừa khoảng trống ít nhất 20 phần trăm chiều rộng mỗi bên và 10 phần trăm phía trên | Mô phỏng vùng dự phòng của khung 384 nhân 448 |
| Tỉ lệ khung hình | 6 trên 7, tức gần vuông và hơi cao. Nếu công cụ không có tỉ lệ này thì chọn 3 trên 4 rồi cắt sau | Khớp khung 384 nhân 448 |
| Độ phân giải tối thiểu | 1152 điểm ảnh chiều cao trở lên, tốt nhất 1536 trở lên | Để thu về @3x mà không phải phóng to |

### 3.2 Nền và tách lớp

| Yêu cầu | Giá trị | Lý do |
|---|---|---|
| Nền | Một màu phẳng duy nhất, không chuyển màu, không hoa văn, không bóng đổ | Để xóa nền tự động sạch |
| Màu nền | Xanh lá tươi thuần, mã 00FF00, hoặc trắng thuần nếu công cụ không ra được xanh sạch. Không dùng màu trùng với màu tóc, da, trang phục | Tránh xóa nhầm phần nhân vật |
| Bóng dưới chân | Không có | Bóng do ứng dụng vẽ |
| Vật thể khác | Không có đồ vật, không có nhân vật thứ hai, không có hiệu ứng | Chỉ sinh đúng thứ cần tách |
| Chữ và hình mờ | Không có chữ, chữ ký, biểu tượng công cụ | Không dọn được |

### 3.3 Phong cách tô để tách lớp được

| Yêu cầu | Giá trị | Lý do |
|---|---|---|
| Kiểu tô | Cel shading, bóng cạnh rõ, tối đa hai bậc bóng | Bóng mềm kiểu tranh sơn làm mép món lẫn vào thân, không tách được |
| Nét viền | Có, liền mạch, khép kín quanh từng bộ phận | Nét viền là ranh giới để cắt lớp |
| Chất liệu | Không có vệt cọ, không có hạt, không có chất liệu giấy | Chất liệu không lặp lại được giữa các lần sinh |
| Độ chi tiết trang phục | Ít nếp gấp, ít hoa văn nhỏ hơn 4 phần trăm chiều cao nhân vật | Chi tiết nhỏ biến mất ở kích thước @1x |

Ghi chú quan trọng: bức tham khảo bạn thích có chất tranh sơn mềm. Yêu cầu ở mục này cố tình **không** đi theo hướng đó cho thân nền và trang phục, vì hai lý do đã bàn: tách lớp và nhất quán. Nếu muốn có chút chất mềm, hãy dồn nó vào lớp hiệu ứng nền ở mục 5.5, vì lớp đó không cần khớp với gì cả.

### 3.4 Nhất quán giữa các lần sinh

- Luôn đính kèm ảnh chủ làm tham chiếu nhân vật ở mọi lần sinh, kể cả khi chỉ đổi cái mũ.
- Nếu công cụ cho khóa seed, ghi lại seed của ảnh chủ và dùng lại.
- Chỉ đổi một thứ mỗi lần sinh. Muốn đổi mũ thì chỉ đổi phần mô tả mũ, giữ nguyên toàn bộ phần còn lại.
- Sinh ít nhất 4 ứng viên cho mỗi món, chọn ứng viên khớp thân nền nhất, không chọn ứng viên đẹp nhất.
- Dùng đúng một công cụ và một mô hình cho toàn bộ dự án. Đổi công cụ giữa chừng là nguyên nhân phổ biến nhất làm nhân vật trôi.

---

## 4. Câu lệnh sinh ảnh chủ, tức thân nền

Câu lệnh của một thân nền là **mẫu `body` ở mục 2.3, nguyên văn**, với các chỗ `{{look.…}}` điền theo bảng ở đó (thân nữ hoặc thân nam), và ảnh F01 gốc đính kèm làm tham chiếu. Bốn phần của câu lệnh Plan 11 (POSE AND FRAMING, OUTFIT, BACKGROUND, RENDERING) nay nằm bên trong mẫu, ở các dòng `Pose:`, `Hands:`, `Clothing:` và `Rendering:`. Nền là nền trong suốt của ảnh vào; nếu công cụ trả nền xanh `#00FF00` hay nền trắng thì pipeline tự xóa (mục 3.2; `--white` cho nền trắng).

Một thân chỉ được duyệt khi qua các tiêu chí ở mục 8 **và** hai phép kiểm của pipeline dành riêng cho nó: đầu nằm đúng chỗ đầu F01 (C12) và da cùng mặt nạ da hợp lý (C11). Một ảnh `verify` cho qua mà người duyệt thấy sai thì bị trả lại kèm lý do `fingers` (bàn tay không đủ năm ngón rời), `bald` (đầu còn tóc, chân tóc hay râu lởm chởm) hoặc `pose` (dáng không thả lỏng); mỗi lý do thêm một dòng sửa vào lần sinh sau (`docs/avatar-2d.md` mục 10.1).

**Câu lệnh phủ định**, dùng ở công cụ có ô nhập riêng cho những thứ không muốn. ChatGPT không có ô này, nên đợt v4 không dùng nó; bản dưới đây là của Plan 11 và chưa chỉnh cho phong cách bán-painterly, vì vậy bỏ `painterly, oil painting, watercolor, brush strokes` khỏi nó trước khi dùng cho một thân:

```
realistic, photo, 3d render, painterly, oil painting, watercolor, brush strokes, texture, noise, grain, multiple characters, side view, three-quarter view, back view, cropped, cut off, dynamic pose, running, jumping, holding object, weapon, props, background scenery, gradient background, shadow on ground, text, watermark, signature, logo, blurry, deformed hands, extra limbs, long legs, tall proportions, realistic proportions
```

---

## 5. Câu lệnh sinh các món trang bị

Nguyên tắc: mỗi món được sinh dưới dạng **nhân vật đang mặc món đó**, với ảnh chủ làm tham chiếu, sau đó người dọn cắt phần món ra thành lớp riêng. Không yêu cầu công cụ sinh "chỉ cái mũ lơ lửng", vì kết quả sẽ không khớp vị trí và phối cảnh với đầu.

**Từ nhân vật v4 (Plan 19)** ảnh chủ của một món là **thân trọc đúng giới tính** (bộ trang phục: thân nam cho bản cắt nam của `dealer01` và `tet_red01`), hoặc thân đó **đội kiểu tóc** mà món sẽ đội (mũ và kính; `--hair` của lệnh `ingest`). Câu lệnh thật nằm trong sổ tài sản (`templates.outfit`, `head`, `face`), mỗi mẫu bắt đầu bằng "Keep this exact image…" và chỉ đổi một thứ; chúng không dán lại khối khóa hay POSE AND FRAMING, vì cả hai nằm sẵn trong ảnh tham chiếu. Các khối `ACCESSORY` và `OUTFIT` dưới đây vì vậy chỉ còn là **hình dạng của phần mô tả món** (`{{look.description}}` của mục trong sổ), và danh sách ví dụ là kho mô tả để mượn; không dán chúng vào ChatGPT như một câu lệnh đầy đủ.

### 5.1 Mũ và đội đầu

```
ACCESSORY: wearing [mô tả mũ], sitting naturally on top of the head, hat must be fully inside the image with empty space above it. Hair and face unchanged from the reference.
```

Ví dụ thay thế cho `[mô tả mũ]`:

- `a classic black top hat with a thin gold band` mũ chóp đen viền vàng
- `a green dealer visor cap with a translucent brim` mũ lưỡi trai trong suốt của người chia bài
- `a red beret tilted to the right` mũ nồi đỏ nghiêng
- `a golden crown with small red gems` vương miện vàng đính đá đỏ
- `a black hooded cloak hood covering the top of the head, hair hidden inside the hood` mũ trùm che tóc, món này có thuộc tính ẩn tóc

### 5.2 Phụ kiện mặt

```
ACCESSORY: wearing [mô tả phụ kiện], accessory sits on the face over the eyes, eyes remain visible unless stated otherwise. Hair and face unchanged from the reference.
```

Ví dụ:

- `thin round gold-rimmed glasses` kính tròn gọng vàng
- `black sunglasses with slightly transparent lenses, eyes faintly visible through the lenses` kính râm
- `a small black masquerade mask covering only the area around the eyes, with cut-outs showing the eyes` mặt nạ dạ hội
- `a black eyepatch over the left eye` băng che mắt trái

### 5.3 Bộ trang phục trọn gói

```
OUTFIT: wearing [mô tả bộ trang phục], the outfit covers from the neck to the feet including shoes, simple shapes, few folds, no small patterns. Nothing in the hands.
```

Ví dụ:

- `a white dress shirt, a dark navy vest with two gold buttons, a red bow tie, a dark navy pleated skirt, white knee socks and black flat shoes` bộ người chia bài
- `a black tuxedo jacket with satin lapels, white shirt, black bow tie, black trousers, black shoes` bộ lễ phục
- `a royal purple long robe with gold trim at the collar and hem, gold sash, soft purple slippers` bộ hoàng gia
- `a red and gold traditional new year outfit with a high collar, long sleeves, matching trousers and red shoes` bộ Tết

### 5.4 Ảnh chủ phụ cho kiểm tra nhất quán

Sau khi có ảnh chủ và ít nhất ba món, sinh thêm một ảnh nhân vật mặc đồng thời một mũ, một kính, một bộ trang phục. Ảnh này không dùng để tách lớp, mà để so với kết quả ghép lớp thật của ứng dụng. Nếu ảnh ghép lớp và ảnh sinh liền một khối trông gần giống nhau thì hệ thống đang đúng.

### 5.5 Hiệu ứng nền, sinh riêng không có nhân vật

Lớp này sinh **không có nhân vật**, vì nó nằm sau nhân vật và không cần khớp cơ thể. Đây là chỗ được phép có chất mềm, loang màu, hạt bay.

```
A decorative circular aura effect for a character portrait, [mô tả hiệu ứng], centered in the image, the center area is empty and plain, effect concentrated in a ring around the center, soft glowing painterly style allowed, flat solid bright green background #00FF00 outside the effect, no character, no text.
```

Ví dụ:

- `swirling golden light ribbons with small floating playing card suit symbols, spade heart club diamond` dải sáng vàng và biểu tượng bài
- `blue flowing water ripples with white sparkles` vòng nước xanh
- `warm orange and red flame ring` vòng lửa
- `pink cherry blossom petals floating in a ring` vòng hoa anh đào

### 5.6 Biểu tượng cho ô túi đồ

Sinh riêng từng món, không có nhân vật, để làm hình biểu tượng 128 nhân 128.

```
Game inventory icon of [mô tả món], single object centered, front view slightly angled, clean cel-shaded anime style with colored outlines, flat solid bright green background #00FF00, no text, no character, generous empty margin around the object.
```

---

## 6. Gợi ý công cụ sinh ảnh

Bảng này dựa trên các bài đánh giá trong năm 2026 mà tôi tra được. Giá và tính năng thay đổi thường xuyên, bạn cần kiểm tra lại trên trang chính thức trước khi trả tiền. Tôi không chạy được các công cụ này trong môi trường làm việc hiện tại, nên phần đánh giá là từ nguồn bên ngoài chứ không phải tôi thử trực tiếp.

| Công cụ | Cách giữ nhân vật nhất quán | Phù hợp với | Lưu ý |
|---|---|---|---|
| Midjourney | Tham chiếu nhân vật, tên tính năng là Omni Reference, trước đây là cref | Chất lượng minh họa cao nhất, phong cách anime và cách điệu tốt | Trả phí, khoảng 10 đô la một tháng trở lên. Xuất ảnh liền, vẫn phải dọn nền |
| Leonardo AI | Tham chiếu nhân vật, có huấn luyện mô hình riêng cho nhân vật, gọi là LoRA | Tài sản game, có bậc miễn phí để thử | Giá trị trên chi phí được đánh giá tốt cho làm tài sản game |
| Ideogram | Tham chiếu nhân vật từ một ảnh, có bậc miễn phí | Thử nghiệm ban đầu không tốn tiền | Được đánh giá mạnh về nhất quán ở bậc miễn phí, mạnh về ảnh thật hơn anime |
| OpenArt | Nhiều mô hình trong một giao diện, có huấn luyện LoRA ở bậc trả phí | Muốn thử nhiều mô hình rồi chọn | Có mục sinh chibi sẵn |
| Stable Diffusion tự chạy, qua ComfyUI hoặc giao diện tương tự | LoRA, ControlNet, IP-Adapter, khóa seed. Kiểm soát sâu nhất | Có máy tính với card đồ họa và người biết kỹ thuật | Phức tạp nhất, nhưng là hướng duy nhất cho phép dùng bản vẽ khung SVG của tôi làm khuôn tư thế và nét qua ControlNet |
| Adobe Firefly | Tham chiếu phong cách và cấu trúc | Cần tính an toàn thương mại | Adobe tuyên bố huấn luyện trên dữ liệu có giấy phép và thuộc phạm vi công cộng, an toàn để dùng thương mại. Chất anime yếu hơn các công cụ trên |
| ChatGPT với mô hình ảnh, Gemini với Nano Banana | Tham chiếu nhiều ảnh trong cùng một cuộc trò chuyện | Người không muốn học tham số | Dễ dùng, nhưng khó khóa seed và khó lặp lại chính xác sau khi đóng phiên |

### 6.1 Khuyến nghị theo giai đoạn

- **Giai đoạn thử nghiệm, không tốn tiền**: Leonardo AI hoặc Ideogram ở bậc miễn phí. Mục tiêu là sinh được một ảnh chủ đạt tỉ lệ và thử ba món để xem quy trình có chạy không.
- **Giai đoạn sản xuất**: nếu ảnh thử ở trên đạt, chuyển sang Midjourney để lấy chất lượng cao hơn, hoặc ở lại Leonardo và huấn luyện LoRA cho nhân vật để tăng nhất quán.
- **Nếu có người kỹ thuật và máy có card đồ họa**: Stable Diffusion với ControlNet là hướng duy nhất tận dụng được các tệp SVG khung mà tôi đã dựng. Bạn xuất SVG thành ảnh nét đen trắng, đưa vào ControlNet chế độ nét, công cụ sẽ tô màu theo đúng vị trí và tỉ lệ của khung. Đây là cách ép nhân vật nằm đúng khung 384 nhân 448 ngay từ lúc sinh.

### 6.2 Cảnh báo về bản quyền và điều khoản

- Không đưa tên nhân vật, tên phim, tên họa sĩ có thật vào câu lệnh. Ví dụ không được viết tên các nhân vật trong bức tham khảo bạn gửi. Chỉ mô tả đặc điểm hình học và màu sắc như ở mục 2.3.
- Đọc điều khoản sử dụng thương mại của công cụ trước khi dùng ảnh trong sản phẩm thu tiền. Một số công cụ không cho dùng thương mại ở bậc miễn phí.
- Tình trạng pháp lý của ảnh do trí tuệ nhân tạo sinh ra khác nhau theo quốc gia và đang thay đổi. Nếu game phát hành ở nhiều thị trường, nên hỏi ý kiến pháp lý. Tôi không phải luật sư và không thể kết luận thay bạn ở điểm này.

---

## 7. Phần mềm để dọn và tách lớp sau khi sinh

Bước này bắt buộc và cần một người biết dùng phần mềm vẽ ở mức cơ bản.

| Việc cần làm | Phần mềm miễn phí | Phần mềm trả phí |
|---|---|---|
| Xóa nền xanh | Krita, GIMP, Photopea trên trình duyệt | Photoshop, Clip Studio Paint |
| Tách món ra khỏi thân | Krita, GIMP, Photopea | Photoshop, Clip Studio Paint |
| Căn lên khung 384 nhân 448 và xuất ba mật độ | Bất kỳ phần mềm trên, hoặc tôi làm bằng mã khi bạn tải ảnh lên | Như trên |
| Vẽ hiệu ứng nền, khung viền, biểu tượng dạng vector | Inkscape, hoặc tôi làm | Illustrator, Affinity Designer |

Quy trình dọn một món, ví dụ cái mũ:

1. Mở ảnh nhân vật đang đội mũ. Xóa nền xanh bằng công cụ chọn theo màu, dung sai thấp để không ăn vào tóc.
2. Đặt ảnh chủ, tức thân nền, lên một lớp bên dưới với độ mờ 50 phần trăm để đối chiếu vị trí. Dịch chuyển ảnh mũ cho đến khi đầu hai ảnh trùng khít.
3. Khoanh vùng cái mũ, sao chép sang tài liệu mới có đúng kích thước khung ở mật độ @3x.
4. Kiểm tra mép: phóng to mép mũ, xóa các điểm ảnh lẫn màu xanh, làm mềm mép 1 điểm ảnh.
5. Xuất PNG có kênh trong suốt, đặt tên theo mục 9.1 của tài liệu số 01.

---

## 8. Tiêu chí nghiệm thu một ảnh sinh ra

Kiểm tra trước khi tốn công dọn. Không đạt mục nào thì sinh lại, không dọn.

1. Toàn thân trong khung, không bị cắt ở đỉnh tóc, hai bên, hay bàn chân.
2. Chính diện. Kiểm tra bằng cách xem hai tai, hai vai, hai bàn chân có đối xứng qua trục giữa không.
3. Chiều cao đúng khoảng 2 đến 2,5 đơn vị đầu người. Đo bằng cách lấy chiều cao đầu từ đỉnh tóc mái đến cằm, xem toàn thân bằng bao nhiêu lần.
4. Mắt nằm ở nửa dưới của đầu.
5. Nền là một màu phẳng thật sự, không có chuyển sáng ở góc, không có bóng dưới chân.
6. Không có chữ, hình mờ, chữ ký.
7. Số ngón tay, số tay, số chân đúng: mỗi bàn tay thấy rõ đúng năm ngón (bốn ngón và một ngón cái), tách nhau, không phải găng và không nắm tay. Thân nền phải trọc hoàn toàn, không má hồng.
8. Tóc, mắt, màu da khớp ảnh chủ. Đặt cạnh ảnh chủ để so, không so bằng trí nhớ.
9. Với món mũ và phụ kiện mặt: món nằm gọn trong nửa trên của ảnh, không tràn xuống vai.
10. Với bộ trang phục: che kín phần đồ lót của thân nền, không lộ.

---

## 9. Việc tôi làm sau khi bạn tải ảnh lên

- Đo tỉ lệ từng ảnh theo lưới, đánh dấu ảnh đạt và không đạt, nói rõ lý do.
- Ép ảnh chủ về khung 384 nhân 448, tính lại vị trí trục dọc và đường chân đế thực tế, cập nhật tài liệu số 01 nếu lệch.
- Ghép thử các lớp bằng mã để xác nhận thứ tự xếp lớp và luật che khuất chạy đúng.
- Sinh các tệp vector cho hiệu ứng nền, khung viền, biểu tượng ô túi theo đúng khung.
- Viết bản ghi mô tả món theo mục 9.2 của tài liệu số 01 cho từng món đã duyệt.
