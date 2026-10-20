# Tranh chủ đề màn đăng nhập — quy trình tạo prompt và sinh ảnh

Tài liệu vận hành (tiếng Việt). Ai cần một bức tranh mới cho màn đăng nhập/đăng ký của bản Normal thì đi theo
đây. Tranh được sinh bằng ChatGPT trên Chrome của người dùng, như bộ chibi (`docs/avatar-2d.md` §10.3). Lần đầu:
2026-10-20, cho bố cục A của spec Plan 26 (thẻ đăng nhập bên phải, tranh phủ nền bên trái).

## 1. Tranh này để làm gì

- Lấp phần trống của màn đăng nhập trên máy tính (hai bên thẻ hiện trống hoàn toàn) và cho người mới thấy ngay
  "đây là trò gì, chơi với ai, vui ra sao" trước khi họ bấm Đăng ký.
- Một bức duy nhất dùng cho cả máy tính và điện thoại: máy tính thấy toàn bức, điện thoại thấy dải giữa được cắt
  (xem §2). Không có chữ trong tranh, vì chữ do giao diện in và phải có hai thứ tiếng.
- Phong cách: anime hiện đại, tỉ lệ người thật (không chibi), nhưng **cùng bảng màu và cùng trang phục** với bộ
  chibi trong game (đồng phục chia bài, tuxedo, áo dài Tết, áo bào) để người chơi nhận ra "đây là những nhân vật
  mình sẽ mặc được".

## 2. Thông số kỹ thuật cố định

| Mục | Giá trị | Vì sao |
|---|---|---|
| Khung | ngang 3:2, ChatGPT trả 1536×1024 | khớp cột trái của bố cục A ở 1920 / 1366 px |
| Vùng nhân vật | 2/3 bên trái, trọng tâm khuôn mặt ở dải giữa theo chiều cao (35–65 %) | phần phải để thẻ đăng nhập đè lên; dải giữa là phần điện thoại cắt lấy |
| 1/3 bên phải | tối, yên, bokeh mờ, không chi tiết quan trọng | thẻ 416 px và nút ngôn ngữ nằm đó, chữ không được đè lên mặt người |
| Mép dưới 15 % | chỉ mặt bàn, phỉnh, bài; không có mặt người | mép bàn chạm cạnh dưới màn, điện thoại cắt mất |
| Màu | đêm `#0b1020`, vàng `#d9a441`, nỉ `#0f2a2e`, đỏ `#c8323c`, xanh ngọc `#3f938a`, da bài `#f6f1e4` | tokens.css của ui-kit; tranh phải hòa với thẻ và nút vàng |
| Không có | chữ, logo, watermark, thương hiệu thật, tiền thật, rượu, thuốc lá | spec §33 (chỉ điểm), i18n, bản quyền |
| Xuất | `assets/login-hero-src/<ngày>-<n>.png` (gốc, gitignored như `avatar-src`), rồi `apps/normal-web/public/login/hero.webp` 1536 px và `hero@768.webp` cho điện thoại, chất lượng 82 | gốc không vào git; bản dùng phải nhẹ (< 250 KB) |

## 3. Quy trình tạo prompt (8 ô)

Prompt ghép từ 8 ô theo đúng thứ tự. Mỗi ô một câu; ô nào đổi thì chỉ đổi câu đó, các câu khác giữ nguyên để so
sánh được giữa các lần sinh. Viết bằng tiếng Anh, vì bộ sinh ảnh bám tiếng Anh sát hơn.

| # | Ô | Câu hỏi phải trả lời | Lần 2026-10-20 |
|---|---|---|---|
| 1 | Hồn của tranh | Người xem phải cảm thấy gì trong một giây đầu? | "một nhóm bạn đang chơi vui, có một ghế trống đang chờ chính bạn" |
| 2 | Nhân vật | Mấy người, nam nữ, tuổi, nét Việt/Á Đông, ai là tâm điểm? | 5 người, 3 nữ 2 nam, 20–30 tuổi, nét Á Đông; tâm điểm là cô gái tuxedo đang lật đôi Át |
| 3 | Hành động với bài | Mỗi người đang làm gì với lá bài? Có khoảnh khắc "poker" nào không? | lật bài thắng; nặn bài he hé (Blind Poker); xòe bài che miệng cười; chống cằm nhìn đối thủ; người chia bài đẩy phỉnh |
| 4 | Trang phục, màu | Mặc gì, màu gì, có trùng với vật phẩm trong game không? | đồng phục chia bài có mũ lưỡi trai, tuxedo mũ chóp, áo dài đỏ, áo bào tím vàng, áo len thường ngày |
| 5 | Bối cảnh | Ở đâu, bàn gì, đèn gì, có gì ở nền? | bàn nỉ xanh đêm viền gỗ và chỉ vàng, đèn chụp thấp ấm, nền tối có bokeh vàng đỏ |
| 6 | Ánh sáng, phong cách | Phong cách vẽ, nét, tô, độ chi tiết? | anime key visual hiện đại, nét sạch, tô cel có chuyển mềm, mặt chi tiết, ánh viền vàng ấm |
| 7 | Khung và bố cục | Tỉ lệ, vùng nhân vật, vùng để trống, góc máy? | 3:2, nhóm ở 2/3 trái, 1/3 phải tối yên, góc máy ngang tầm mắt người ngồi, ghế trống ở tiền cảnh phải-giữa |
| 8 | Loại trừ | Tuyệt đối không có gì? | chữ, logo, watermark, tay thừa ngón, bài sai ký hiệu, tiền thật, rượu, thuốc |

Thêm hai dòng khóa cuối prompt, luôn giữ: "no text, no letters, no logo, no watermark" và "cards show real suits
(spades, hearts, diamonds, clubs) with correct pips".

## 4. Prompt chính (lần 2026-10-20)

```
A modern anime key visual, landscape 3:2, cinematic and warm. Five young East Asian friends in their twenties are
gathered around the near edge of a night-blue poker table with a dark wooden rail and a thin gold line, lit by a
low warm pendant lamp; the deep background is midnight navy with soft gold and red bokeh.
Composition: the whole group occupies the left two thirds of the frame; the right third is calm, dark and empty
with only soft bokeh, reserved for a UI panel. Eye-level camera as if the viewer is sitting at the table. In the
right-centre foreground stands one empty chair turned slightly toward the viewer, inviting them to sit.
The focal character, a confident young woman in a black tuxedo with a bow tie and a small top hat, is turning over
a pair of aces toward the viewer with a bright, knowing smile. To her left a young man in a dealer's uniform
(black vest, white shirt, green visor) slides a stack of gold, red and teal chips across the felt. Beside him a
laughing woman in a red Vietnamese ao dai hides her grin behind a fan of cards. On the far left a young man in a
casual knit sweater peeks at the very corner of his two face-down cards, squeezing them, tense and hopeful. Behind
them a regal woman in a purple-and-gold robe with a small gold crown rests her chin on her hand, studying the table.
Cards are standard playing cards with cream faces and a deep red back with a gold diamond; suits and pips are
correct. Palette: midnight navy #0b1020, warm gold #d9a441, teal felt #0f2a2e, accent red #c8323c. Clean linework,
cel shading with soft gradients, highly detailed expressive faces, hands drawn carefully with five fingers,
dynamic but readable. Mood: friendly rivalry, delight, "come sit with us".
No text, no letters, no logo, no watermark, no real money, no alcohol, no cigarettes.
```

Biến thể để chọn (đổi đúng một ô):

- **V2 (ô 3, khoảnh khắc Blind Poker):** tâm điểm đổi thành cô gái áo dài đang he hé một lá bài sát mặt, mắt mở to;
  cô tuxedo cười nhìn sang. Dùng khi muốn tranh "đúng Blind Poker" hơn là "đúng Hold'em".
- **V3 (ô 7, góc máy):** góc máy hơi cao nhìn xuống bàn, thấy cả vòng bài chung và pot ở giữa, nhóm vẫn ở 2/3
  trái. Dùng khi bản V1 bị chật ở mép dưới.

## 5. Tiêu chí duyệt một bức (đủ cả, nếu không thì sửa và sinh lại)

1. Không chữ, không logo, không watermark ở bất kỳ đâu (kể cả trên phỉnh và lưng bài).
2. Tay đủ năm ngón, bài đúng ký hiệu chất, không lá nào chữ số ngược hay lạ.
3. Năm khuôn mặt rõ, khác nhau, không ai nhìn lệch mắt; tâm điểm ở 2/3 trái và trong dải 35–65 % chiều cao.
4. 1/3 bên phải đủ tối để thẻ đăng nhập (nền `#141b33`, chữ kem) đọc được; thử đặt thẻ lên bằng bản phác.
5. Cắt dọc 9:16 lấy dải giữa vẫn thấy ít nhất ba khuôn mặt và ghế trống.
6. Màu hòa với giao diện: vàng của tranh không chói hơn nút "Vào sảnh".
7. Không có yếu tố tiền thật, rượu, thuốc, thương hiệu.

Sửa theo kiểu "dòng sửa" như §10.3 của `docs/avatar-2d.md`: giữ nguyên prompt, thêm một dòng cho mỗi lý do
trượt ("the dealer's left hand has six fingers; draw five"), tối đa ba lần một biến thể.

## 6. Chạy sinh ảnh (ChatGPT, Chrome của người dùng)

1. Mở `https://chatgpt.com/` ở tab mới, một cuộc trò chuyện mới cho mỗi biến thể.
2. Dán prompt, gửi, chờ ảnh (tới 4 phút). Ghi lại địa chỉ `https://chatgpt.com/c/<id>`.
3. Duyệt theo §5. Đạt thì tải về (người dùng cho phép từng lần) vào `assets/login-hero-src/`, đặt tên
   `YYYY-MM-DD-vN.png`; trượt thì thêm dòng sửa và gửi tiếp trong cùng cuộc trò chuyện.
4. Hết lượt sinh ảnh hoặc gặp CAPTCHA: dừng, báo người dùng. Không giải CAPTCHA.
5. Xuất bản dùng: chạy `pnpm --filter @bp/normal-web login:hero` (`apps/normal-web/scripts/login-hero.mjs`, `sharp`,
   WebP chất lượng 82). Lệnh ra hai tệp trong `apps/normal-web/public/login/`: `hero-1536.webp` (1536 × 1024, ngân
   sách 250 KB) và `hero-768.webp` (768 × 512, ngân sách 90 KB), và in cỡ từng tệp; quá ngân sách thì lệnh thoát với
   mã 1, khi đó hạ `QUALITY` trong tệp lệnh xuống 76 và ghi lại vào §7. Muốn dùng bản khác thì đổi `SRC` trong tệp lệnh.
   Rồi ghi tên tệp và địa chỉ cuộc trò chuyện vào §7.

## 7. Nhật ký các lần sinh

| Ngày | Biến thể | Cuộc trò chuyện | Kết quả | Tệp |
|---|---|---|---|---|
| 2026-10-20 | V1 | `https://chatgpt.com/c/6ad65e04-f7d0-83ec-816e-b3dbff11deb6` | đạt 5/7: năm lá bài chung có chấm không khớp số; mép dưới và 1/3 phải nhiều phỉnh | `assets/login-hero-src/2026-10-20-v1.png` (ChatGPT đặt tên "Midnight Poker_ Aces and Intrigue") |
| 2026-10-20 | V2 | `https://chatgpt.com/c/6ad65f6c-91e4-83ec-b0d8-4664da333c82` | đạt 7/7 (ghế trống hơi to, chấp nhận); **đề xuất dùng** | `assets/login-hero-src/2026-10-20-v2.png` ("Midnight Poker in Golden Light") |

Xuất bản dùng (2026-10-20, từ V2, `login:hero`, chất lượng 82): `apps/normal-web/public/login/hero-1536.webp`
(1536 × 1024, 178,0 KB) và `apps/normal-web/public/login/hero-768.webp` (768 × 512, 66,4 KB); cả hai nằm trong git và
được phục vụ ở `/login/hero-1536.webp`, `/login/hero-768.webp`. Không cần hạ xuống chất lượng 76.

Prompt V2 đã gửi khác prompt chính ở ô 3 (tâm điểm nặn bài, "few cards on the table, no community cards face up; a
modest pot of chips in the centre") và thêm "no numbers" vào dòng loại trừ. Việc bỏ bài chung ngửa là lý do V2 sạch
lỗi ký hiệu: bộ sinh ảnh vẽ chấm trên lá bài không đáng tin, nên **prompt chuẩn từ nay yêu cầu không có lá bài ngửa
ngoài tay của tâm điểm**.

## 8. Bản quyền và giới hạn

Như bộ chibi (`docs/known-limitations.md`, mục tranh AI): tranh do AI sinh, điều khoản thương mại của bộ sinh là
việc người vận hành tự kiểm; tệp gốc không vào git. Tranh không được vẽ theo nhân vật hay thương hiệu có thật.
