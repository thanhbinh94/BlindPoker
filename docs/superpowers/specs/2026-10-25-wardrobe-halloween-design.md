# BP-35 — Đợt đồ thứ hai: Halloween, Đông & Noel, Hè biển (8 trang phục, 12 phụ kiện, có cực hiếm)

Spec thiết kế, 2026-10-25. Người dùng yêu cầu, sau BP-33: "thêm 8 bộ trang phục, 12 phụ kiện (thuộc ít nhất 3 chủ đề tự
chọn trong đó có halloween, có siêu hiếm), chạy luôn". Mọi lựa chọn dưới đây là **của phiên** (người dùng giao); người
dùng duyệt khi xem bảng ảnh. "Siêu hiếm" là bậc `epic`, giao diện gọi là "Cực hiếm".

## 1. Quy trình

Đúng quy trình của BP-33 (spec `2026-10-24-wardrobe-batch-design.md`, `docs/avatar-2d.md` §9, §10, §10.7): sổ
`registry.json`, vòng `next → ChatGPT (Chrome của người dùng) → collect → verify → ingest`, ảnh tham chiếu dựng lại từ lớp
đã commit (đã có sẵn, gitignored). Mọi bài học của BP-33 áp dụng ngay từ đầu:

- Mũ **tối màu** (đen, tím than) vẽ trên tóc sáng `f_wavy01` (`--hair f_wavy01`, tham chiếu `@item_hair_f_wavy01`); mũ
  **sáng màu** (rơm, đỏ, cam) vẽ trên tóc mặc định `f_bob01`.
- Màu vải tránh xa màu da: không be, không kem; màu trắng chỉ ở mảng lớn trên thân, không ở bàn chân.
- Món đội trên tóc mà để lộ đỉnh đầu (sừng, bờm, chụp tai, vòng hoa, con cua) có `prompt` riêng như băng đô của BP-33 và
  **không** vào `HAIR_CLIP`; mũ trùm đỉnh đầu (phù thủy, Noel, bí ngô, rơm) vào `HAIR_CLIP`.
- Bên trái/phải gọi theo nhân vật, kèm bên của ảnh ("the character's right side (the left side of the picture)").
- Xem hình ghép (có mặt nạ cắt tóc) trước khi coi một món là xong; `verify` qua chưa đủ.

## 2. Chủ đề

- **Đêm Halloween** (ra trước 31/10): phù thủy, ma cà rồng, bộ xương, bí ngô, dơi, sừng quỷ. Món cực hiếm của đợt nằm ở đây.
- **Đông & Noel**: áo len Giáng sinh, áo phao, Ông già Noel, mũ Noel, chụp tai, sừng tuần lộc, mũi đỏ.
- **Hè biển**: sơ mi Hawaii, đồ thủy thủ, mũ rơm, vòng hoa, kính trái tim, con cua nhỏ.

Hình khối đơn giản, ít nếp gấp, không hoạ tiết nhỏ, không chữ, không logo (luật của template).

## 3. Danh sách

Độ hiếm dùng cả ba bậc. Món **bán** lấy giá và bậc theo seed (thường 10.000 / bậc 1, hiếm 30.000 / bậc 3, cực hiếm
150.000 / bậc 4; GM sửa được). Món **thành tựu** không bán (`achievementItemIds`).

### 3.1 Trang phục (8)

| id | Chủ đề | Tên (vi) | Name (en) | Độ hiếm | Cách có | Mô tả cho ChatGPT |
|---|---|---|---|---|---|---|
| `outfit_skeleton01` | Halloween | Bộ đồ bộ xương | Skeleton suit | thường | bán | a black long-sleeved jumpsuit with a simple pale grey skeleton drawn on it (ribs, arm bones and leg bones), and black sneakers |
| `outfit_witch01` | Halloween | Váy phù thủy | Witch's dress | hiếm | bán | a long black witch dress reaching the ankles with a purple sash at the waist, a short black cape over the shoulders, and black pointed boots |
| `outfit_vampire01` | Halloween | Bá tước ma cà rồng | Vampire count | cực hiếm | bán | a black tailcoat suit with a dark red waistcoat and a red cravat, a long black cape lined in deep red falling to the calves, its collar standing up behind the neck below the ears, and black shoes |
| `outfit_sweater_xmas01` | Noel | Áo len Giáng sinh | Christmas jumper | thường | bán | a red knitted Christmas jumper with one broad white zigzag band across the chest, dark green trousers and brown boots |
| `outfit_puffer01` | Noel | Áo phao mùa đông | Winter puffer | thường | bán | a puffy sky-blue padded winter jacket zipped up to the chin, dark grey trousers and black snow boots |
| `outfit_santa01` | Noel | Áo Ông già Noel | Santa's coat | cực hiếm | thành tựu `login_days_200` | a red velvet coat with thick snow-white fluffy trim down the front, at the cuffs and at the hem, a wide black belt with a gold buckle, red trousers and black boots |
| `outfit_hawaii01` | Hè biển | Sơ mi Hawaii | Hawaiian shirt | thường | bán | a turquoise short-sleeved Hawaiian shirt with a few large orange hibiscus flowers, navy knee-length shorts and brown sandals |
| `outfit_sailor01` | Hè biển | Đồ thủy thủ | Sailor suit | hiếm | thành tựu `rooms_50` | a white sailor top with a wide navy collar edged with one white stripe, a red neckerchief tied at the chest, navy trousers and black shoes |

### 3.2 Phụ kiện (12)

| id | Chủ đề | Tên (vi) | Name (en) | Ô | Độ hiếm | Cách có | Tóc dưới | Cắt tóc | Mô tả cho ChatGPT |
|---|---|---|---|---|---|---|---|---|---|
| `head_witch_hat01` | Halloween | Mũ phù thủy | Witch hat | head | hiếm | bán | `f_wavy01` | có | a tall pointed black witch hat with a wide brim and a purple band, its tip bent slightly backwards; the hat fully covers the top of the head |
| `head_pumpkin01` | Halloween | Mũ bí ngô | Pumpkin hat | head | cực hiếm | thành tựu `blind_hands_500` | `f_bob01` | có | a small orange carved jack-o'-lantern pumpkin worn as a hat, its friendly carved face glowing a soft yellow, a short green stem on top; it fully covers the top of the head |
| `head_devil_horns01` | Halloween | Sừng quỷ nhỏ | Little devil horns | head | thường | bán | `f_bob01` | không | two small shiny red devil horns on a thin red headband, standing up from the top of the hair, the hair around them unchanged |
| `face_bat_mask01` | Halloween | Mặt nạ dơi | Bat mask | face | thường | bán | — | — | a black eye mask shaped like a bat with its wings spread across both eyes, the eyes visible through two openings |
| `head_santa_hat01` | Noel | Mũ Noel | Santa hat | head | hiếm | bán | `f_bob01` | có | a red Santa hat with a thick snow-white fluffy band and a white pompom at the tip, the tip flopping down to the character's left side (the right side of the picture); the hat fully covers the top of the head |
| `head_earmuffs01` | Noel | Chụp tai lông | Fluffy earmuffs | head | thường | bán | `f_bob01` | không | sky-blue fluffy earmuffs over both ears joined by a thin sky-blue band over the top of the hair, the hair around them unchanged |
| `head_reindeer01` | Noel | Bờm sừng tuần lộc | Reindeer antlers | head | hiếm | thành tựu `login_streak_14` | `f_bob01` | không | a thin brown headband with two small brown reindeer antlers and one tiny gold bell, standing up from the top of the hair, the hair around them unchanged |
| `face_red_nose01` | Noel | Mũi đỏ tuần lộc | Red reindeer nose | face | thường | bán | — | — | one small round shiny bright-red nose over the character's own nose, the eyes and mouth unchanged |
| `head_straw_hat01` | Hè biển | Mũ rơm | Straw sun hat | head | thường | bán | `f_bob01` | có | a wide-brimmed golden straw sun hat with a red ribbon band, sitting level and straight; the hat fully covers the top of the head |
| `head_flower_crown01` | Hè biển | Vòng hoa Hawaii | Flower crown | head | hiếm | bán | `f_bob01` | không | a ring of pink and yellow plumeria flowers resting around the top of the head like a crown, the hair around and between them unchanged |
| `face_heart_glasses01` | Hè biển | Kính trái tim | Heart sunglasses | face | hiếm | bán | — | — | pink heart-shaped sunglasses with dark pink lenses over both eyes, eyes faintly visible |
| `head_crab01` | Hè biển | Cua cưỡi đầu | Crab rider | head | hiếm | thành tựu `win_streak_7` | `f_bob01` | không | one small cute red crab sitting on top of the hair with its claws raised, the hair around it unchanged |

Đếm: trang phục 4 thường, 2 hiếm, 2 cực hiếm; phụ kiện 5 thường, 6 hiếm, 1 cực hiếm (tổng 3 món cực hiếm). Bán 15 món,
thành tựu 5 món.

### 3.3 Thành tựu mới (5)

Mỗi thành tựu thưởng đúng một món, dùng chỉ số đã có (không thêm chỉ số), ngưỡng nằm giữa hai mốc đang có:

| id | Nhóm | Chỉ số | Ngưỡng | Thưởng | Tên (vi) / (en) |
|---|---|---|---|---|---|
| `login_days_200` | login | `totalLoginDays` | 200 | `outfit_santa01` | Ông già Noel của sảnh / The lobby's Santa |
| `login_streak_14` | login | `bestLoginStreak` | 14 | `head_reindeer01` | Tuần lộc chăm chỉ / Steady reindeer |
| `blind_hands_500` | blind | `handsPlayedBlind` | 500 | `head_pumpkin01` | Bí ngô mù quáng / Blind as a pumpkin |
| `rooms_50` | social | `roomsJoined` | 50 | `outfit_sailor01` | Thủy thủ khắp bàn / Table hopper |
| `win_streak_7` | holdem | `bestWinStreak` | 7 | `head_crab01` | Đi ngang vẫn thắng / Sideways to victory |

Không cấp bù cho người đã vượt ngưỡng (như BP-33, Ruling 3): mở ở lần cập nhật kế tiếp của chỉ số.

## 4. Không làm

Không đổi engine, cửa hàng, giá seed, khung tủ đồ, lịch quà điểm danh. Không thêm ô mới (phụ kiện là `head` và `face`).
Không vẽ biến thể thân m trừ khi bảng ảnh cho thấy đồ lệch trên thân m. Không thêm hiệu ứng động (aura).

## 5. Rủi ro

- Áo choàng ma cà rồng và cổ áo dựng có thể chạm vùng tóc/tai: nếu `verify` trượt vì cổ áo, vẽ lại với cổ thấp hơn.
- Viền trắng (Noel, áo thủy thủ, mũ Noel) có thể bị phép cắt da ăn mất: nếu thủng, đổi viền sang trắng ánh xanh xám.
- Bí ngô và mũ phù thủy lớn hơn mọi mũ đang có: `scope` hoặc giới hạn khung có thể chặn; vẽ lại nhỏ hơn nếu cần.
- Giới hạn ảnh của ChatGPT, CAPTCHA: dừng và báo (§10.3); không giải CAPTCHA.

## 6. Kết quả

Ghi ngày 2026-10-25, sau đợt vẽ. Cả 20 món đã có ảnh thật, đã cắt và qua `avatar:check`; bảng §3 giữ nguyên như lúc viết
spec, các chỗ khác đi ghi ở đây (chi tiết tiếng Anh: `docs/avatar-2d.md` §10.7, CHANGELOG BP-35).

- **Mũ phù thủy** (`head_witch_hat01`): khác §3.2. Mũ đen cao vành rộng vẽ trên tóc `f_wavy01` trượt ba lần: lần 1 tóc mái
  bị vẽ lại và mắt xê dịch (rộng 0,95), phép cắt đưa tóc và mắt nữ vào lớp mũ (mắt xanh trên thân m); lần 2 cả người bị
  thu nhỏ cho vừa chiếc mũ cao (0,911) — `verify` vẫn qua vì độ rộng chỉ là ghi chú với món đội đầu; lần 3 mũ thấp vẫn
  0,966 và trượt C11 (mặt nạ cắt tóc giấu 127 px tóc mà mũ không che). Mục cũ thành `blocked`, mục mới
  `v4/item_head_witch_hat01_b` thay thế (như `_w` của BP-33): vẽ trên tóc mặc định `f_bob01`, màu xanh ngọc lục bảo đậm,
  băng đen (xanh lục tách hẳn khỏi màu tím sẫm của tóc bob, mũ đen hay tím thì không). Ảnh đầu của mục mới (mũ nhọn thấp)
  lại 0,966, mặt lọt vào lớp mũ, bị loại bằng mắt; ảnh thứ hai là mũ mềm, chóp rủ sang một bên như mũ Noel, "không cao
  hơn mũ len", rộng 1,008, sạch trên cả hai thân. Vậy mũ phù thủy là mũ mềm xanh lục, không phải mũ chóp đen cao như bảng.
- **Bá tước ma cà rồng** (`outfit_vampire01`): ảnh đầu áo choàng xòe rộng quá hai tay (`redrawn`, tỉ lệ 1,315, mép
  ±80 px) → mô tả đổi thành áo choàng "rủ thẳng xuống sát sau lưng … không bao giờ rộng hơn hai cánh tay"; ảnh thứ hai
  0,998.
- **Chụp tai lông** (`head_earmuffs01`): ảnh đầu nền đục (`background`); ảnh thứ hai qua khi thêm câu "The background
  must stay fully transparent".
- Mười bảy món còn lại qua ngay ảnh đầu. Rủi ro §5 về viền trắng không xảy ra: viền trắng áo Noel và áo thủy thủ còn
  nguyên sau phép cắt da. Váy phù thủy vẽ lại một mảnh da cổ nhỏ giữa cổ áo choàng, trên trâm cài (68 px @2x); phép cắt
  nhận ra là da nên màu da người chơi tô lên đúng chỗ đó.
- Bản nháp được đo bằng `comparePictures` của `verify` trước khi `collect`, nên một bản nháp lệch không tốn lượt nào
  trong ba lượt: hai bản xanh lục (một bị phóng 1,097, một lệch xuống 40 px) và hai bản mũ mềm không được thu.
- Không vẽ biến thể thân m nào: cả tám bộ dùng bản cắt trên thân f cho cả hai thân, váy phù thủy cũng là váy trên thân m.
  Thành tựu mới không cấp bù (§3.3): mở ở lần cập nhật kế tiếp của chỉ số. Bờm sừng tuần lộc màu nâu hơi chìm trên tóc
  màu nâu.
