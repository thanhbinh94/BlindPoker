# Just a Normal Poker — Avatar chibi 2D từ ảnh sinh bằng AI, xếp lớp PNG (thay thế thiết kế 2026-09-08)

Ngày: 2026-09-14. Trạng thái: đã duyệt qua brainstorming (mục 1–3 trình bày ngày 14/09, người dùng chốt hai thân nền và aura sinh bằng AI); chờ xem lần cuối rồi lập plan.
Thay thế: `2026-09-08-avatar-chibi-2d-design.md` (SVG tự vẽ — thất bại ở cổng phong cách) và `2026-09-05-avatar-3d-design.md`.
Kế thừa: hai tài liệu của người dùng `01-quy-cach-tai-san-nhan-vat-kho-do.md` (khung 384 × 448, lớp, luật ẩn, tên tệp, nghiệm thu) và `02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md` (quy trình khoá nhân vật, câu lệnh) — bản sao được đưa vào `docs/avatar/` khi thực thi. Ảnh tham khảo phong cách: bộ chibi bán hoạ (đầu 2,25 đơn vị, mắt to đặt thấp, nét viền màu, aura nguyên tố phía sau) — **chỉ lấy phong cách, không lấy nhân vật hay tên hoạ sĩ**.

## 1. Mục tiêu
Nhân vật chibi đẹp ở mức minh hoạ chuyên nghiệp, sinh bằng công cụ AI theo một **khối khoá nhân vật**, cắt thành lớp PNG trên khung cố định, hiển thị ở ghế, sảnh, tủ đồ, profile; kho đồ gồm mũ, phụ kiện mặt, bộ trang phục trọn gói, aura, khung viền; biểu cảm theo ván; 5 outfit lưu sẵn. Không WebGL. Hệ kinh tế (inventory, điểm danh, thành tựu) giữ nguyên cơ chế, catalogue được map lại.

## 2. Phạm vi
| # | Hạng mục | Trong / ngoài |
|---|---|---|
| S1 | Quy cách khung, lớp, tên tệp, nghiệm thu (lấy từ tài liệu 01, có sửa ở §3) | Trong |
| S2 | Khối khoá nhân vật `F01`, `M01` và bộ câu lệnh sinh ảnh theo phong cách tham khảo (§4) — **người dùng sinh ảnh** | Trong (phần câu lệnh); việc sinh ảnh do người dùng làm |
| S3 | Script dọn ảnh tự động: xoá nền xanh, cắt món bằng so khác biệt với ảnh chủ, căn khung, xuất @1x/@2x, kiểm nghiệm thu (§6) | Trong |
| S4 | ui-kit `avatar2d` chuyển từ symbol SVG sang lớp PNG; bot chibi (§7) | Trong |
| S5 | Server: config v3 (`base`, `head`, `face`, `outfit`, `aura`, `frame`, `title`, `badge`), catalogue map lại, outfit 5 ô, API | Trong |
| S6 | Normal web: bàn, sảnh, tủ đồ, profile; gỡ 3D; CSP; Lite: bot + thân nền mặc định | Trong |
| S7 | Giai đoạn 2: thêm 4 thân nền (3 nữ 3 nam), ô vật cầm tay, biểu tượng túi đồ riêng | Ngoài (ghi roadmap) |
| — | Chuyển động aura; đổi màu da/tóc trong app; kiểu mắt sưu tầm; tự đăng ảnh | Ngoài |

## 3. Quy cách tài sản (kế thừa tài liệu 01, các điểm sửa in đậm)
- Khung ảnh 384 × 448; khung cơ thể 224 × 336 tại (80, 72); trục dọc x = 192; đường chân đế y = 408; đầu ≈ 149 px, thân 2,25 đầu; mắt ở 60–65 % chiều cao đầu. Bất biến sau món đầu tiên.
- Lớp (dưới lên): 10 aura · 20 tóc sau · 30 thân nền · 40 outfit · 50 mặt (**6 biến thể biểu cảm**) · 60 tóc trước · 70 phụ kiện mặt · 80 mũ. **Thêm lớp 5 nền tròn của khung viền (phía sau aura) và lớp 90 khung viền (chỉ ở ảnh đại diện).**
- Luật ẩn: `hides_hair_front`, `hides_hair_back` trên món `head`; `hides_eyes` chỉ vẽ đè.
- Ảnh đại diện: cắt ô 208 × 208 tại (88, 40) từ ảnh đã ghép; hiển thị tròn; **ghế 40 px, thanh sảnh 32 px, profile 192 px** đều cắt từ ô này; khung viền 260 × 260 đè ngoài cùng.
- Định dạng: PNG 32 bit sRGB; **hai mật độ @1x (384 × 448) và @2x (768 × 896)** (bỏ @3x: web không cần, giảm 1/3 dung lượng); sinh ở ≥ 1152 px cao rồi thu nhỏ. Mép có ≥ 1 px chuyển mềm, không viền trắng, không rác bán trong suốt.
- Tên tệp: `[loại]_[slot]_[mã]_L[lớp]@[mật độ].png`; **thân nền có tiền tố mã thân**: `base_f01_L30@2x.png`, `base_f01_face_happy_L50@2x.png`; món dùng chung mọi thân: `item_head_tophat01_L80@2x.png`.
- Nghiệm thu: 10 tiêu chí của tài liệu 01 §10, kiểm tự động bởi script §6 (kích thước, khung, trong suốt, viền trắng, vùng cắt) và bằng mắt (phong cách, nhận ra ở 3 cỡ).

**2026-09-15: crop moved to 208×208 at (88,40), ring 260, after the first real F01 picture.** Ảnh F01 thật đầu tiên cho thấy ô cắt cũ (160 × 160 tại (112, 48)) cắt cụt khuôn mặt ngay tại mắt; trục dọc x = 192 và tâm dọc y = 144 giữ nguyên.

**2026-09-15 amendment: AI bases are flat; L20/L60 are empty; the face layer is the whole head region; hood-style items that hide hair can only cover what their own picture covers.** Ảnh thân sinh bằng AI là một ảnh phẳng (tóc, mặt, thân dính liền), nên `ingest --as base` ghi L30 là cả hình, mặt `neutral` L50 là vùng đầu (ô cắt ∩ y < 250), L20/L60 là khung trong suốt đánh dấu `empty: true`; `hides_hair_front/back` không thể gỡ phần tóc đã nằm trong L30/L50.

## 4. Phong cách và khối khoá nhân vật
### 4.1 Phong cách (rút từ ảnh tham khảo, áp cho mọi ảnh sinh)
Chibi 2,25 đầu; đầu rộng hơn cao; mắt cực to đặt thấp, tròng hai tông chuyển màu, 2–3 đốm sáng, mi trên dày; má ửng hồng; mũi chấm; nét viền **màu** (nâu cam quanh da, đậm hơn màu tóc quanh tóc, xanh đen quanh trang phục); tô **bán hoạ**: da và tóc được phép gradient mềm và một bậc bóng mềm; trang phục và mũ **cel hai bậc, cạnh rõ** (để cắt lớp). Nền sinh: xanh `#00FF00` phẳng.

### 4.2 Khối khoá (tiếng Anh, dán nguyên văn vào mọi câu lệnh)
```
CHARACTER LOCK F01:
chibi anime girl, 2.25 heads tall, oversized round head wider than tall, tiny body, short stubby limbs with no visible joints, mitten-like hands, small feet.
Hair: dark violet bob to the shoulders, thick bangs split into soft rounded clumps just above the eyes, long side locks to the chin, one curved ahoge strand on top, one soft highlight band across the top of the hair.
Eyes: very large, each nearly half the face width, placed at two-thirds of the head height from the top, iris gradient from deep navy at the top to bright aqua at the bottom, three white highlights of different sizes, light from the upper left, thick upper lashes flicking outward, thin eyebrows drawn over the bangs, nose is a tiny dot, small slightly open smiling mouth, soft pink blush on both cheeks.
Skin: warm light cream with a soft gradient on the cheeks and under the chin.
Line art: colored outlines — warm brown around skin, deep violet around hair, navy black around clothes — medium clean line weight, no brush texture.
```
```
CHARACTER LOCK M01:
chibi anime boy, 2.25 heads tall, oversized round head wider than tall, tiny body, short stubby limbs with no visible joints, mitten-like hands, small feet. Same body proportions, pose and head placement as F01.
Hair: short messy chestnut brown hair with soft spiky clumps, a short fringe swept slightly to the right showing the forehead, one small tuft on top, one soft highlight band across the top of the hair.
Eyes: very large, each nearly half the face width, placed at two-thirds of the head height from the top, iris gradient from deep amber at the top to warm gold at the bottom, three white highlights of different sizes, light from the upper left, medium upper lashes, straight slightly thick eyebrows drawn over the fringe, nose is a tiny dot, small closed confident smile, faint blush on both cheeks.
Skin: warm light tan with a soft gradient on the cheeks and under the chin.
Line art: colored outlines — warm brown around skin, dark brown around hair, navy black around clothes — medium clean line weight, no brush texture.
```
Khối chung (dán sau khối khoá): POSE AND FRAMING, OUTFIT (thân nền: áo ba lỗ xám nhạt + quần đùi xám đậm, chân trần), BACKGROUND `#00FF00`, RENDERING và câu lệnh phủ định — lấy nguyên từ tài liệu 02 §4, thêm vào RENDERING: `semi-painterly anime illustration, soft gradient shading allowed on skin and hair, hard-edged two-tone cel shading on clothing and hats`.

### 4.3 Biểu cảm (6 ảnh mỗi thân, chỉ đổi phần EXPRESSION)
`neutral` (khối khoá) · `happy` (eyes curved into happy arcs, wide open smile) · `sad` (drooping eyes with a small tear highlight, downturned mouth) · `surprised` (eyes fully round and wider, small round open mouth) · `closed` (eyes gently closed, calm small smile) · `sleep` (eyes closed, mouth slightly open, small "z" glyph near the temple). Cắt lớp 50 từ mỗi ảnh.

### 4.4 Món: câu lệnh theo tài liệu 02 §5 (mũ 5.1, phụ kiện mặt 5.2, bộ trang phục 5.3), luôn sinh **trên F01** và dùng chung cho M01 (thân giống hệt). Danh sách giai đoạn 1:
- `head` (8): tophat01, dealer_visor01, beret_red01, crown_gold01 (thay `hat_crown`), conical_hat01 (thay `accessory_conical_hat`), beanie01, party_cone01, hood_black01 (`hides_hair_front/back = true`).
- `face` (4): glasses_round_gold01 (thay `accessory_glasses`), sunglasses01 (thay `accessory_sunglasses`), masquerade01 (thay `accessory_mask`), eyepatch01.
- `outfit` (6): casual01 (mặc định: áo thun + jeans + sneakers), dealer01, tuxedo01, royal_robe01, tet_red01, champion01 (thay `jacket_champion`).
- `aura` (8, sinh riêng không nhân vật, được phép bán hoạ, tài liệu 02 §5.5): water01, fire01, wind01, earth01, lightning01, sakura01, gold_cards01 (thay `ring_royal`), ice01.
- `frame` (6, sinh riêng, vòng 260 × 260 tâm rỗng 250): theo độ hiếm bronze, silver, gold, monthly, veteran, founder.
- `title` (5) và `badge` (5): giữ nguyên id, không hình.

## 5. Mô hình dữ liệu
### 5.1 Config v3
```ts
interface AvatarConfigV3 {
  v: 3
  base: 'f01' | 'm01'          // chọn, không sở hữu; giai đoạn 2 thêm f02…m03
  outfit: string               // bắt buộc, mặc định outfit_casual01
  head?: string; face?: string; aura?: string; frame?: string; title?: string; badge?: string
}
```
Đọc v1/v2: mọi cấu hình cũ → `{ base: body === 'female' ? 'f01' : 'm01', outfit: 'outfit_casual01', head: hat_crown→head_crown_gold01, accessory→face/head theo bảng map, title, badge }`. Không migration SQL (jsonb).
### 5.2 Catalogue `items.json`
Trường mới `asset: { layer: number; file: string; hidesHairFront?: boolean; hidesHairBack?: boolean; fitsAvatarCrop: boolean }`; `slot ∈ head|face|outfit|aura|frame|title|badge`. Id cũ được **giữ làm alias** trong `data/item-aliases.json` (`hat_crown → head_crown_gold01`, …) để inventory, thành tựu và lịch sử điểm danh không đổi; loader chuyển alias khi đọc, `grant-wardrobe` cấp id mới. Thành tựu: `login_days_100 → head_crown_gold01`, `holdem_wins_500 → outfit_champion01`, `hand_royal → aura_gold_cards01`, còn lại không đổi. Điểm danh: bậc ngẫu nhiên rút trong `head|face|aura|frame` theo độ hiếm (không rút `outfit`, `title`, `badge`).
### 5.3 Outfit lưu sẵn: như spec 08 §5.4 (bảng `avatar_outfits`, 5 ô, tên ≤ 24, API GET/PUT/DELETE/apply).

## 6. Pipeline tài sản (`apps/normal-web/scripts/avatar-pipeline.mjs`, dùng `sharp`)

**2026-09-17 amendment: an item layer contains only the item, and every item has a standalone icon.** Ảnh món là ảnh chủ được vẽ lại nên mọi điểm ảnh lệch nhẹ và hình trôi vài px; trước khi so khác biệt, ảnh món được **căn khớp** với thân nền (dịch nguyên px trong ±12 @2x và tỉ lệ 0,99–1,01 quanh trục/chân đế, cực tiểu sai khác màu trên vùng món không đụng tới: thân với `head`/`face`, đầu với `outfit`). Một điểm ảnh chỉ là món khi khác màu với *mọi* điểm ảnh đặc của thân nền trong cửa sổ 5 × 5 @2x (hoặc cả cửa sổ trong suốt) và không phải bóng đổ của món lên thân. Giới hạn theo ô: `head` y < 260; `face` trong ô cắt và y < 250; `outfit` bỏ mọi thứ trên y = 236 (đường cằm), rồi hợp với thân nền phía dưới (ngoài vùng đầu). Dọn: bỏ vùng nhỏ (và vùng < 5 % vùng lớn nhất với `head`/`face`), lấp khe/lỗ nhỏ, giãn 1 px + làm mềm, mép lấy màu của chính món. Mỗi món (thật hoặc tạm) có thêm `item_<slot>_<code>_icon@1x/@2x.png` (96/192 px vuông, món cắt theo hộp bao, chiếm 84 %, căn giữa, nền trong suốt), ghi trong khoá `icons` của manifest; ô tủ đồ và kho đồ hiển thị icon này thay vì chibi thu nhỏ (chi tiết: `docs/avatar-2d.md` §4.1–4.2). Vòng sửa 1: lớp mặt L50 bỏ cột thân x ∈ [150, 234] từ y 236 trở xuống (dây áo lót không lộ trên cổ áo); trang phục căn theo bóng thân (IoU dưới đường cằm, ưu tiên mép) thay vì theo đầu; sợi tóc ahoge phía trên đỉnh đầu chuyển sang L60 (không còn `empty`) để mũ có `hidesHairFront` che được. Vòng sửa 2: dưới y 236, trang phục phủ thêm những điểm ảnh thân nền có mực mà trang phục chưa phủ đặc, trong vòng 5 px quanh trang phục (alpha của thân nền, màu loang từ mép trang phục) để viền tay chân của thân nền không lộ.

- `ingest <ảnh> --as base:f01|expr:f01:happy|item:head:tophat01`: xoá nền `#00FF00` (dung sai cấu hình, khử viền xanh), tìm hộp bao, **căn theo ảnh chủ**: với món, so khác biệt điểm ảnh với thân nền đã căn (ngưỡng màu + khoảng cách), giữ vùng khác biệt liên thông lớn nhất, làm mềm mép 1 px; căn khung 384 × 448 theo trục và chân đế; xuất `@2x` và `@1x` vào `apps/normal-web/public/avatar/`.
- `check`: 10 tiêu chí tự động (kích thước, không tràn khung, alpha vùng trống = 0, không viền trắng, `head/face` nằm trong ô cắt, `outfit` che kín đồ lót của thân nền bằng so alpha), in bảng đạt/không đạt.
- `sheet`: ghép thử mọi món trên cả hai thân, 6 biểu cảm, cắt ảnh đại diện 3 cỡ → `docs/avatar-2d-sheet.png` (cổng duyệt bằng mắt).
- Ảnh gốc AI lưu ở `assets/avatar-src/` (gitignore, kèm README ghi công cụ, seed, ngày).

## 7. Client
- ui-kit `avatar2d`: `ChibiConfig` → danh sách lớp `{ order, url }`; `Chibi` vẽ chồng `<img>` trong một hộp tỉ lệ 6:7 (hoặc một `<canvas>` ghép sẵn cho ghế để giảm số phần tử: 9 ghế × 8 lớp = 72 ảnh là chấp nhận được, canvas để giai đoạn 2); `frame='head'` dùng `object-position` theo ô cắt 208 × 208; `expression` chọn lớp 50; ảnh tải lười, `srcset` @1x/@2x; băm theo cấu hình. Biểu cảm theo ván giữ nguyên luật spec 08 §3.4. Tài sản do app cung cấp qua `assetBase` (Normal: `/avatar/`), Lite: gói sẵn thân nền `f01`/`m01` + bot.
- Bot: 8 bot **sinh AI theo cùng khối khoá tỉ lệ nhưng là robot** (2 ảnh mỗi bot: thường, vui; các biểu cảm khác dùng thường) — người dùng sinh; tạm thời dùng bot SVG hiện có tới khi có ảnh.
- Tủ đồ: tab Thân nền (2 ô), Mũ, Mặt, Trang phục, Aura, Khung, Danh hiệu & Huy hiệu; xem trước 192 px + chọn biểu cảm; ô món = ảnh món cắt theo hộp bao trên nền độ hiếm; khoá kèm cách nhận; thanh Outfit 5 ô. Profile: ảnh đại diện 192 px trong khung viền + aura, nền tối. Gỡ 3D và CSP như spec 08 §6.2.

## 8. Kiểm thử
Script: test đơn vị cho xoá nền, cắt khác biệt, căn khung, `check` trên bộ ảnh mẫu tổng hợp (tạo bằng mã: hình tròn + hình chữ nhật trên nền xanh). Server: v3, alias, outfits, route guard. ui-kit: xếp lớp đúng thứ tự, luật ẩn, cắt đầu, biểu cảm. Web: tủ đồ, profile. e2e: đổi mũ → ghế có `data-chibi-hash` khớp và `img[src*="tophat01"]`; outfit lưu/áp; món khoá. Footprint: tổng PNG @2x giai đoạn 1 ≤ 6 MB, tải lười; entry chunk không tăng.

## 9. Lộ trình (Plan 11)
0. **Người dùng**: sinh ảnh chủ F01 (≥ 4 ứng viên) → tôi đo tỉ lệ bằng script → chốt ảnh chủ. Đây là cổng đầu tiên; không sinh món trước khi qua cổng.
1. Pipeline script + test trên ảnh tổng hợp; ingest ảnh chủ F01; sheet 1.
2. Người dùng sinh M01, 6 biểu cảm × 2, 3 món thử (1 mũ, 1 kính, 1 outfit) → ingest, sheet 2 → **cổng phong cách**.
3. Server v3 + alias + catalogue mới + outfits + API.
4. ui-kit PNG layers + biểu cảm + Seat + Lite.
5. Normal web tủ đồ, profile, bàn, sảnh; gỡ 3D.
6. Người dùng sinh nốt món (8 head, 4 face, 6 outfit, 8 aura, 6 frame, 8 bot) theo đợt; ingest; nghiệm thu.
7. Docs, e2e, cấp lại tủ đồ test, build, host.

## 10. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Nhân vật trôi giữa các lần sinh | Khối khoá nguyên văn, ảnh chủ tham chiếu, một công cụ, chỉ đổi một thứ mỗi lần; script so khác biệt với ảnh chủ sẽ báo lệch |
| Cắt món bằng so khác biệt không sạch ở mép tóc | Dung sai cấu hình; Krita sửa tay các ca khó; tiêu chí nghiệm thu chặn ảnh xấu |
| Mũ sinh trên F01 không khớp tóc M01 | Luật ẩn tóc; mũ đội hờ chấp nhận lệch nhỏ; mũ trùm ẩn tóc |
| Pháp lý ảnh AI | Không dùng tên nhân vật/hoạ sĩ; đọc điều khoản thương mại của công cụ; ghi trong `docs/known-limitations.md` |

## Phụ lục — Quyết định
- D1: Nghệ thuật sinh bằng AI theo khối khoá; phong cách bán hoạ theo ảnh tham khảo, chỉ lấy phong cách.
- D2: Hai thân nền F01/M01 cùng thân khác đầu; món sinh một lần dùng chung. Giai đoạn 2: sáu thân.
- D3: Slot: base, head, face, outfit (trọn bộ), aura, frame, title, badge. Bỏ tóc rời, trang sức, quần, giày, bảng màu, kiểu mắt sưu tầm.
- D4: Aura và khung viền sinh AI, tĩnh, không chuyển động (người dùng chốt 14/09).
- D5: PNG @1x/@2x, bỏ @3x. Id cũ giữ bằng alias.
- D6: Bước dọn ảnh tự động hoá bằng script; Krita chỉ cho ca khó.
- D7: Bot tạm giữ SVG cho tới khi có ảnh AI.
