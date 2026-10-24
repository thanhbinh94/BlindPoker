# BP-33 — Đợt đồ mới: 8 bộ trang phục và 10 phụ kiện (thường → hiếm)

Spec thiết kế, 2026-10-24. Người dùng yêu cầu: "chạy quy trình liên kết với ChatGPT (trên Chrome) để sinh thêm ít nhất
8 bộ trang phục và 10 phụ kiện mới (từ cấp độ thường đến hiếm, tự phân loại có mua được không hay mở theo thành tựu)",
rồi "tự chọn chủ đề đi, chạy luôn". Mọi lựa chọn dưới đây là **của phiên** (người dùng giao), người dùng duyệt khi xem
bảng ảnh.

## 1. Quy trình

Quy trình sẵn có, không thêm công cụ: `docs/avatar-2d.md` §9 (thêm một món), §10 (sổ tài sản `registry.json`, vòng
`next → ChatGPT → collect → verify → ingest`, §10.3 trên Chrome của người dùng qua Claude in Chrome). Ảnh sinh trên
**thân f** (cùng dáng với thân m, lớp đồ không mang da: một ảnh dùng cho cả hai thân, §9); mũ và kính vẽ trên thân f đội
kiểu tóc mặc định (`--hair`). Thêm biến thể thân m chỉ khi bảng ảnh cho thấy cần (như `dealer01`, `tet_red01`).

## 2. Chủ đề

"Đêm Sài Gòn" của giao diện đi ra phố: đồ thường ngày của người chơi về khuya (hoodie, đồ thể thao, áo bà ba, áo khoác
jean), một chút đêm neon và áo dài cho bậc hiếm, và "dân chơi bàn bài cổ điển" (măng tô thám tử, mũ phớt, kính một tròng)
làm phần thưởng thành tựu. Hình khối đơn giản, ít nếp gấp, không hoạ tiết nhỏ, không chữ, không logo (luật của template).

## 3. Danh sách

Độ hiếm chỉ dùng **thường (common)** và **hiếm (rare)**, đúng yêu cầu. Món **bán** lấy giá và bậc danh vọng theo seed của
cửa hàng (Plan 27: thường 10.000 điểm / bậc 1, hiếm 30.000 / bậc 3; GM sửa được). Món **thành tựu** không bán: seed tắt
mọi món là phần thưởng của một thành tựu (`achievementItemIds`).

### 3.1 Trang phục (8)

| id | Tên (vi) | Name (en) | Độ hiếm | Cách có | Mô tả cho ChatGPT |
|---|---|---|---|---|---|
| `outfit_hoodie_navy01` | Áo hoodie xanh than | Navy hoodie | thường | bán | a plain navy zip-up hoodie with the hood down behind the neck, grey jogger trousers and white sneakers |
| `outfit_tracksuit_red01` | Bộ thể thao đỏ | Red tracksuit | thường | bán | a red zip-up track jacket with one white stripe down each sleeve, matching red track trousers with one white stripe down each leg, and white sneakers |
| `outfit_ao_ba_ba01` | Áo bà ba nâu | Brown áo bà ba | thường | bán | a loose brown Vietnamese áo bà ba shirt with long sleeves and small round buttons, loose black wide trousers, and simple brown sandals |
| `outfit_denim01` | Áo khoác jean | Denim jacket | thường | thành tựu `bot_hands_200` | a light-blue denim jacket over a plain white T-shirt, dark blue jeans and brown boots |
| `outfit_bomber_neon01` | Áo bomber đêm neon | Neon-night bomber | hiếm | bán | a black bomber jacket with thin glowing pink-and-cyan neon trim at the collar, cuffs and hem, black trousers and black sneakers with white soles |
| `outfit_ao_dai_jade01` | Áo dài xanh ngọc | Jade áo dài | hiếm | bán | a jade-green Vietnamese áo dài with long sleeves, a high collar and side slits, over loose white silk trousers, and white flat shoes |
| `outfit_trench01` | Áo măng tô thám tử | Detective trench coat | hiếm | thành tựu `holdem_hands_500` | a beige knee-length trench coat with a belt tied at the waist and wide lapels, dark brown trousers and brown shoes |
| `outfit_brocade_red01` | Áo gấm đỏ | Red brocade jacket | hiếm | thành tựu `blind_wins_250` | a deep-red silk mandarin-collar jacket with gold trim along the edges and gold knot buttons, black trousers and black cloth shoes |

### 3.2 Phụ kiện (10)

| id | Tên (vi) | Name (en) | Ô | Độ hiếm | Cách có | Mô tả cho ChatGPT |
|---|---|---|---|---|---|---|
| `head_cap_navy01` | Mũ lưỡi trai xanh than | Navy cap | head | thường | bán | a plain navy baseball cap with a curved brim facing forward |
| `head_bucket_khaki01` | Mũ tai bèo kaki | Khaki bucket hat | head | thường | bán | a soft khaki bucket hat with a short downward brim all around |
| `head_headband_red01` | Băng đô đỏ | Red headband | head | thường | bán | a red fabric sports headband across the forehead above the eyebrows, the hair above and behind it unchanged |
| `head_cat_ears01` | Bờm tai mèo | Cat-ear headband | head | hiếm | bán | a thin black headband with two small black cat ears with pink insides |
| `head_lotus_pin01` | Hoa sen cài tóc | Lotus hairpin | head | hiếm | bán | one small pink lotus flower hairpin on the right side of the hair, above the ear |
| `head_fedora01` | Mũ phớt đen | Black fedora | head | hiếm | thành tựu `big_win_250k` | a black felt fedora hat with a dark grey band, tilted slightly |
| `face_glasses_square01` | Kính gọng vuông đen | Black square glasses | face | thường | bán | black square-framed glasses with clear lenses, the eyes fully visible through them |
| `face_bandaid01` | Băng cá nhân | Plaster | face | thường | bán | one small beige adhesive plaster stuck diagonally on the left cheek, the eyes and mouth unchanged |
| `face_aviators01` | Kính phi công | Aviator sunglasses | face | hiếm | bán | gold-framed aviator sunglasses with dark green lenses over the eyes, eyes faintly visible |
| `face_monocle_gold01` | Kính một tròng vàng | Gold monocle | face | hiếm | thành tựu `login_days_60` | a single round gold-rimmed monocle over the right eye with a thin gold chain hanging down to the cheek, the other eye unchanged |

### 3.3 Thành tựu mới (5)

Năm thành tựu mới, mỗi cái thưởng đúng một món, dùng các chỉ số đã có (không thêm chỉ số):

| id | Nhóm | Chỉ số | Ngưỡng | Thưởng | Tên (vi) / (en) |
|---|---|---|---|---|---|
| `bot_hands_200` | social | `botHands` | 200 | `outfit_denim01` | Tri kỷ của bot / One of the machines |
| `holdem_hands_500` | holdem | `handsPlayedHoldem` | 500 | `outfit_trench01` | Thám tử bàn bài / Table detective |
| `blind_wins_250` | blind | `handsWonBlind` | 250 | `outfit_brocade_red01` | Phúc lộc đầy nhà / Fortune's favourite |
| `big_win_250k` | holdem | `biggestWin` | 250 000 | `head_fedora01` | Tay chơi lớn / High roller |
| `login_days_60` | login | `totalLoginDays` | 60 | `face_monocle_gold01` | Khách quen / Regular |

Không cấp bù cho người đã vượt ngưỡng trước khi deploy trừ khi cơ chế thành tựu tự xét lại khi đọc; kiểm khi làm và ghi
vào CHANGELOG.

## 4. Không làm

Không đổi engine, cửa hàng, giá seed, khung tủ đồ. Không thêm ô mới (phụ kiện là `head` và `face`). Không vẽ biến thể
thân m trừ khi bảng ảnh cho thấy đồ lệch trên thân m. Không thêm món sử thi.

## 5. Rủi ro

- Ảnh gốc (`assets/avatar-src/*.png`, gồm thân f và thân m) không có trên máy này: ảnh tham chiếu phải dựng lại từ lớp đã
  commit (xem kế hoạch khi làm). Nếu dựng lại không đủ tốt cho `verify`/`ingest`, đợt này dừng ở bước ChatGPT và báo.
- Mũ v4 chưa từng sinh qua sổ (mũ đang dùng là của Plan 12): món mũ đầu tiên là phép thử.
- Giới hạn ảnh của ChatGPT, CAPTCHA: dừng và báo (§10.3); không giải CAPTCHA.
