# Just a Normal Poker — Avatar chibi 2D (thay thế avatar 3D)

Đã thay thế bởi `2026-09-14-avatar-chibi-ai-design.md`.

Ngày: 2026-09-08. Trạng thái: đã duyệt qua brainstorming (CR1 trong `docs/bug-log.md`); chờ người dùng xem lần cuối rồi lập Plan 10.
Thay thế: `docs/superpowers/specs/2026-09-05-avatar-3d-design.md` (đánh dấu "đã thay thế" khi Plan 10 gộp).
Liên quan: spec chính §15 (Avatar / Inventory), §13 (Daily), §14 (Achievement); `docs/avatar-assets.md` (sẽ thay bằng `docs/avatar-2d.md`).

## 1. Mục tiêu

Người chơi có một nhân vật **chibi 2D** nhìn rõ ở mọi cỡ, tuỳ chỉnh được cơ thể và khuôn mặt, mặc đồ từ kho đồ, lưu bộ trang phục, và **biểu cảm theo ván** trên bàn. Không WebGL, không tải mô hình, hiện tức thì ở cả Normal lẫn Lite. Hệ kinh tế đồ (catalogue, inventory, điểm danh, thành tựu) giữ nguyên.

Lý do đổi (tóm tắt khảo sát 2026-09-08): không có bộ 3D chibi giấy phép mở nào tách được bộ phận; 2D lớp vẽ được mọi thứ tủ đồ cần, cho biểu cảm, và thắng ở ghế 40 px, nơi avatar được nhìn nhiều nhất.

## 2. Phạm vi

| # | Hạng mục | Trong / ngoài |
|---|---|---|
| S1 | Bộ vẽ chibi trong `@bp/ui-kit` (`src/avatar2d/`): sprite, thành phần `Chibi`, biểu cảm, bot chibi, chibi mặc định theo tên | Trong |
| S2 | Server Normal: config v3 (mặt, màu vải), `data/faces.json`, slot mới `eyeStyle`/`mouth`, catalogue chuyển sang `sprite`, outfit (bảng + API), đọc v2 → v3 | Trong |
| S3 | Normal web: bàn chơi và sảnh dùng `Chibi`; `WardrobeScreen` và Profile viết lại; gỡ toàn bộ 3D; CSP | Trong |
| S4 | Lite web: bot chibi và chibi mặc định cho người (không tủ đồ) | Trong |
| S5 | Vẽ lại 42 món hiện có, thêm ~15 món mới, ~10 kiểu mắt/miệng sưu tầm, 8 bot | Trong |
| S6 | Kiểm thử, bảng tổng ảnh, e2e, docs, cấp lại tủ đồ cho tài khoản test | Trong |
| — | Tự đăng ảnh (R1) — bỏ, lệch phong cách; xoay 3D; cửa hàng đổi điểm lấy đồ; animation toàn thân | Ngoài |

## 3. Khung chibi

### 3.1 Tỉ lệ và hộp vẽ
- `viewBox="0 0 256 320"`. Đầu: ellipse tâm (128, 104), bán trục 84 × 78, chiếm ≈ 45 % chiều cao. Thân từ y = 176 tới 300; tay ngắn tròn hai bên; chân ngắn, giày ở y ≥ 272. Không cổ (đầu đặt lên vai).
- Góc nhìn chính diện, tóc và mũ vẽ hơi lệch 3/4 (bóng khối bên trái) để có chiều sâu.
- Hai `body`: `male` (vai rộng hơn 6 đơn vị, hông hẹp) và `female` (vai hẹp, eo và hông cong nhẹ). Cùng hộp đầu để mọi món trên đầu dùng chung một mảnh cho cả hai thân; món trên thân có hai biến thể khi cần (`variants.male`/`variants.female`), món nào một mảnh dùng được cả hai thì khai báo `any`.

### 3.2 Lớp vẽ (z-order, dưới lên)
| Lớp | Id | Nội dung |
|---|---|---|
| 1 | `hairBack` | phần tóc sau đầu (tóc dài, đuôi ngựa, búi) |
| 2 | `body` | thân, tay, chân theo `body`, tô `--skin` |
| 3 | `shoes` | giày |
| 4 | `bottom` | quần, váy |
| 5 | `top` | áo; áo dài / kimono / suit vẽ phủ xuống quần |
| 6 | `jewelry` | vòng cổ, mặt dây, nhẫn (trên tay), khuyên tai (cạnh đầu) |
| 7 | `faceBase` | hình mặt (`face.shape`): viền và bóng khối |
| 8 | `faceMarks` | má hồng, tàn nhang, nốt ruồi |
| 9 | `nose` | mũi |
| 10 | `mouth` | miệng (theo biểu cảm) |
| 11 | `eyes` | mắt (theo biểu cảm), tô `--eye` |
| 12 | `brows` | lông mày (theo biểu cảm) |
| 13 | `accessoryUnder` | băng đô, khăn trùm (dưới tóc trước) |
| 14 | `hairFront` | mái và tóc hai bên, tô `--hair` |
| 15 | `hat` | mũ, nón, vương miện; có thể mang `clipHair: true` để che phần tóc trên |
| 16 | `accessoryOver` | kính, khẩu trang, kính râm (trên tóc) |

Một item góp một hoặc nhiều mảnh, mỗi mảnh nằm đúng một lớp (tóc dài: `hairBack` + `hairFront`; băng đô: `accessoryUnder`).

### 3.3 Màu
- Biến CSS trên gốc avatar: `--skin`, `--hair`, `--eye`, `--c-top`, `--c-bottom`, `--c-shoes`, `--c-hat`. Sprite dùng `fill="var(--c-top, #xxxxxx)"` với màu mặc định của thiết kế.
- Bảng màu (`data/palettes.json`): `skin` (8, giữ nguyên), `eyes` (6, giữ nguyên), `hair` (8 gợi ý + tự nhập hex như hiện nay), `cloth` (12 màu vải chung). Item đổi được màu khai báo `colorable: true` và dùng bảng `cloth`; item thiết kế cố định (áo dài, kimono, jacket_champion) `colorable: false`.

### 3.4 Biểu cảm
| Id | Mắt | Miệng | Lông mày | Kích hoạt trên bàn |
|---|---|---|---|---|
| `neutral` | mở | mím nhẹ | thẳng | mặc định |
| `happy` | cong cười | cười rộng | nhướn | thắng ván (payout > 0), 4 s |
| `sad` | rũ | mếu | chụm | thua ở showdown (có bài lật, không thắng), 3 s |
| `surprised` | tròn to | há tròn | nhướn cao | all-in (mình hoặc người khác vừa all-in), 2 s; bài mạnh ở Blind reveal (≥ straight) 2 s |
| `closed` | nhắm | mím | thẳng | đã fold, tới hết ván |
| `sleep` | nhắm + "z" | hé | thẳng | ngồi ngoài, mất kết nối, hoặc bàn chưa có ván > 60 s |

Kiểu mắt sưu tầm chỉ thay **trạng thái mở** (`neutral`, `surprised`); các trạng thái nhắm dùng mảnh chung. Kiểu miệng sưu tầm thay `neutral` và `happy`.

Chuyển động: chớp mắt ngẫu nhiên mỗi 3–6 s (đổi sang mảnh nhắm 120 ms); nhún 0,5 s khi tới lượt mình; profile có lắc nhẹ 3 s một chu kỳ. Tất cả bằng CSS `@keyframes` và `prefers-reduced-motion: reduce` tắt hết.

### 3.5 Bot
8 bot chibi (`bot_0` … `bot_7`): cùng hộp và lớp, nhưng `faceBase` là mặt robot (vuông, tròn, lục giác, vòm), mắt đèn, ăng-ten, thân kim loại một màu theo hue. Chọn bằng `botFaceIndex(playerId)` (FNV-1a, đã có). Bot có cùng bảng biểu cảm. Thay thế `BotFace.tsx` hiện tại.

### 3.6 Chibi mặc định theo tên (Lite, và Normal khi chưa có config)
`defaultChibi(seed: string)`: thân, hình mặt, kiểu mắt cơ bản, kiểu tóc cơ bản, màu da, màu tóc chọn ổn định từ hash tên; mặc đồ mặc định. Lite dùng cho mọi người thật; Normal dùng khi avatar chưa tải xong hoặc tài khoản không có config (không xảy ra sau khi đăng ký, vì đăng ký tạo config mặc định).

## 4. Sprite

- `packages/ui-kit/src/avatar2d/sprite/` chứa nguồn: mỗi item một tệp `.svg` nhỏ với `<symbol id="…">` (viết tay, mã hoá bằng path/ellipse/rect, tô bằng biến CSS). Script `scripts/avatar-sprite.mjs` ghép thành `packages/ui-kit/src/avatar2d/sprite.generated.ts` (chuỗi SVG) và `sprite.manifest.json` (id symbol → lớp, hộp bao). Chạy trong `pnpm build` của ui-kit và có `--check` (fail nếu generated lệch nguồn).
- Id symbol: `<slot>/<itemId>[/<layer>][/<body>]`, ví dụ `hair/hair_long/back`, `top/top_tee/female`, `eyes/eyes_star/open`, `bot/bot_3/face`.
- Tiêm một lần: `<svg width="0" height="0" style="position:absolute">` ở gốc app (ui-kit cung cấp `AvatarSprite` component); mỗi avatar là `<svg viewBox …><use href="#…"/>…</svg>`.
- Kích thước mục tiêu: ≤ 160 KB thô, ≤ 45 KB gzip. Test `footprint` cập nhật ngưỡng.

## 5. Mô hình dữ liệu

### 5.1 Config v3 (`apps/normal-server/src/inventory/avatar.ts`)
```ts
interface AvatarConfigV3 {
  v: 3
  body: 'male' | 'female'
  skin: string            // palettes.skin
  eyeColor: string        // palettes.eyes (v2: `eyes`)
  hairColor: string       // #rrggbb
  face: {
    shape: string         // faces.json shapes
    eyeStyle: string      // faces.json basic, hoặc item slot eyeStyle đã sở hữu
    brows: string         // faces.json
    nose: string          // faces.json
    mouth: string         // faces.json basic, hoặc item slot mouth đã sở hữu
    blush?: string        // faces.json marks (blush_*), tuỳ chọn
    marks?: string        // faces.json marks (freckles, mole_*), tuỳ chọn
  }
  colors?: { top?: string; bottom?: string; shoes?: string; hat?: string }  // palettes.cloth, chỉ khi item colorable
  hair: string; top: string; bottom: string; shoes: string
  hat?: string; accessory?: string; jewelry?: string; title?: string; badge?: string
}
```
- Đọc: v1 → v2 (đã có) → v3: `eyeColor = eyes`, `face` = mặt mặc định (`shape_round`, `eyes_basic_1`, `brows_soft`, `nose_dot`, `mouth_smile_soft`). Ghi luôn v3. Không migration SQL cho cột jsonb.
- Kiểm tra (`validateAvatarConfig`): mọi trường mặt thuộc `faces.json` hoặc là item slot tương ứng **đã sở hữu**; màu vải chỉ được đặt cho item `colorable`; phần còn lại như v2.

### 5.2 `data/faces.json` (miễn phí)
```json
{ "shapes": ["shape_round","shape_oval","shape_square","shape_heart","shape_long"],
  "eyes":   ["eyes_basic_1","eyes_basic_2","eyes_basic_3","eyes_basic_4","eyes_basic_5"],
  "brows":  ["brows_soft","brows_straight","brows_arched","brows_thick","brows_thin"],
  "noses":  ["nose_dot","nose_small","nose_button","nose_line","nose_none"],
  "mouths": ["mouth_smile_soft","mouth_line","mouth_small","mouth_wide","mouth_pout"],
  "marks":  ["blush_soft","blush_strong","freckles","mole_left","mole_right"] }
```
Mỗi id có symbol trong sprite. Không đi qua inventory.

### 5.3 Catalogue (`data/items.json`)
- Slot: thêm `eyeStyle` và `mouth` vào `ItemSlot`; `OPTIONAL_SLOTS` thêm hai slot này; `GEOMETRIC_SLOTS` đổi tên thành `DRAWN_SLOTS` (mọi slot trừ `title`/`badge`).
- Trường `variants` (glb) thay bằng:
```json
"sprite": { "parts": [ { "layer": "hairBack", "symbol": "hair/hair_long/back" }, { "layer": "hairFront", "symbol": "hair/hair_long/front" } ],
            "bodies": "any" | ["male","female"], "colorable": false }
```
Khi `bodies` là danh sách, symbol có hậu tố `/<body>`. Catalogue loader kiểm tra mọi symbol tồn tại trong `sprite.manifest.json` (ui-kit xuất manifest; normal-server đọc qua `@bp/ui-kit/avatar2d/manifest`).
- 42 id hiện có giữ nguyên. Thêm mới (dự kiến): `top_hoodie_zip`, `top_dress_summer`, `top_tuxedo`, `bottom_pleated`, `shoes_heels`, `shoes_loafers`, `hat_beanie`, `hat_cap`, `hat_beret`, `hat_party`, `accessory_eyepatch`, `accessory_monocle`, `jewelry_hoops`, `title_dealer`, `badge_founder`; kiểu sưu tầm: `eyes_star`, `eyes_money`, `eyes_heart`, `eyes_sleepy_cool`, `eyes_wink`, `mouth_cat`, `mouth_fang`, `mouth_tongue`, `mouth_grin_gold`, `mouth_lollipop`. Độ hiếm và cách nhận ghi trong plan; ràng buộc §13.2 (bậc ngẫu nhiên không rút `title`/`badge` và các món thưởng thành tựu) giữ nguyên; kiểu mắt/miệng sưu tầm được phép rút ở ngày 7/14/21 theo độ hiếm.
- Thành tựu: 6 phần thưởng item hiện có giữ nguyên; thêm thành tựu mới chỉ khi plan thấy cần cho các kiểu mặt `epic` (tối đa 3, ghi trong plan).

### 5.4 Outfit
- Bảng `avatar_outfits(player_id uuid fk, slot smallint 1..5, name varchar(24), config jsonb, updated_at)`, khoá chính `(player_id, slot)`. Migration `drizzle/0002_outfits.sql`.
- API (cookie, `X-Requested-With`): `GET /api/me/outfits` → 5 ô (trống hoặc `{slot,name,config,updatedAt}`); `PUT /api/me/outfits/:slot` `{name, config}` (config phải qua `validateAvatarConfig` với inventory hiện tại); `DELETE /api/me/outfits/:slot`; `POST /api/me/outfits/:slot/apply` → kiểm sở hữu lại lúc áp (món đã mất quyền sở hữu không tồn tại trong thiết kế hiện nay, nhưng kiểm tra vẫn chạy) rồi ghi `players.avatar_config`, trả `AvatarView`.
- Xoá tài khoản: cascade.

## 6. Client

### 6.1 ui-kit `src/avatar2d/`
- `types.ts`: `ChibiConfig` (bản client của v3, kèm `sprite.parts` đã phân giải), `Expression`, `ChibiFrame = 'head' | 'full'`.
- `resolve.ts`: `resolveChibi(config, catalog, faces)` → danh sách `<use>` theo lớp + biến CSS; thuần, có test.
- `Chibi.tsx`: `<Chibi resolved expression frame size className />`; `frame='head'` dùng `viewBox="40 24 176 176"` (đầu và vai), `full` dùng cả hộp. Memo theo `hashChibi(resolved) + expression`.
- `AvatarSprite.tsx`: tiêm sprite một lần (idempotent, kiểm `#bp-avatar-sprite`).
- `expression.ts`: `expressionFor(seat, hand, room, now)` thuần → `Expression` theo §3.4; `useSeatExpression` giữ các trạng thái có thời hạn (happy 4 s…).
- `defaultChibi.ts` (§3.6), `bot.ts` (§3.5, giữ `botFaceIndex`).
- `Seat.tsx`: khung giữ nguyên (40 px), nội dung là `<Chibi frame="head">`; prop `avatar` của app vẫn tồn tại để app truyền `resolved` (Normal) hoặc để kit tự dựng mặc định (Lite). Bỏ `BotFace.tsx`.
- Playground ui-kit: trang `#/avatar2d` liệt kê mọi item trên hai thân, mọi biểu cảm, 8 bot.

### 6.2 Normal web
- `api.ts`: `AvatarConfigDto` v3, `FacesDto` (`GET /api/catalog/faces`), outfit DTO; catalogue trả `sprite`.
- `useAvatars` giữ nguyên (cache config theo playerId), `TableChrome.makeAvatarFor` trả `resolveChibi(...)`.
- `WardrobeScreen` viết lại theo §6.3. `ProfileScreen` dùng `<Chibi frame="full" size="stage">` với nền theo title (`data-title`), parallax.
- Gỡ: `src/avatar3d/` (tất cả), `public/avatar3d/`, `scripts/avatar-assets.mjs`, `avatar-shots.mjs`, `avatar-map.json`, `assets/avatar-src/`, phụ thuộc `three`, `meshoptimizer`, `@gltf-transform/*`; test và e2e liên quan (`avatar3d.spec.ts` thay bằng `avatar2d.spec.ts`). CSP về `script-src 'self'`, `img-src 'self' data:`.

### 6.3 Tủ đồ
- Bố cục: trái = xem trước `full` cỡ lớn + chọn biểu cảm để thử + nút "Lưu tủ đồ" + trạng thái lưu (như hiện nay); phải = tab: Thân (body, da, màu tóc, màu mắt), Mặt (hình mặt, mắt, lông mày, mũi, miệng, má), Tóc, Áo, Quần, Giày, Mũ, Phụ kiện, Trang sức, Danh hiệu & Huy hiệu.
- Ô món đồ: hình món vẽ trên ma-nơ-canh trung tính (`frame` riêng `part`, viewBox theo hộp bao trong manifest), tên, nhãn độ hiếm; khoá nếu chưa sở hữu, chú thích cách nhận (từ `source` gợi ý: tên thành tựu có `reward.itemId` = id, hoặc "Điểm danh ngày 7/14/21" theo độ hiếm, hoặc "Chưa mở"). Món `colorable` có dải 12 màu dưới ô khi đang chọn.
- Thanh Outfit: 5 ô ở dưới phần xem trước; mỗi ô có tên, hình thu nhỏ `head`, nút Áp dụng / Lưu vào ô này / Đổi tên / Xoá. Áp dụng ghi ngay lên server (POST apply) và làm mới config.
- Phím tắt và a11y: tab có `role="tablist"`, ô là `button aria-pressed`, thông báo `role="status"` khi lưu.

### 6.4 Lite
- `apps/lite/web`: `avatarFor` trả `resolveChibi(defaultChibi(displayName))`; bot như Normal. Không tủ đồ, không profile.

## 7. Kiểm thử
- ui-kit: `resolve.test` (mọi item catalogue mẫu phân giải đủ lớp, đúng thứ tự); `Chibi.test` (SVG ổn định theo hash; `frame`); `expression.test` (bảng §3.4 từ trạng thái ván); `sprite.test` (manifest khớp generated; mọi symbol trong faces/catalogue tồn tại); footprint sprite.
- server: `avatar.test` v2 → v3, kiểm mặt và màu vải; `items.test` schema `sprite`; `outfits.test` (PGlite) 5 ô, tên, apply kiểm sở hữu, cascade; route-guard enumeration cập nhật.
- normal-web: `WardrobeScreen.test` (tab, khoá, màu, outfit), `ProfileScreen.test`, `TableChrome.test`.
- Bảng tổng: `apps/normal-web/scripts/avatar-sheet.mjs` (Playwright) chụp playground → `docs/avatar-2d-sheet.png`; chạy tay khi đổi sprite, commit ảnh.
- e2e Normal (`avatar2d.spec.ts`): đăng ký → tủ đồ mặc mũ và đổi màu áo → lưu → ghế trên bàn có `data-chibi-hash` khớp và symbol mũ; lưu outfit ô 1 → đổi đồ → áp lại ô 1; món chưa có bị khoá. Lite e2e: ghế có chibi.
- Soak/money: không ảnh hưởng.

## 8. Lộ trình (Plan 10)
1. Khung, sprite nền, script ghép, 5 món (tóc ngắn, áo thun, quần jeans, giày sneakers, nón lá), 1 bot, playground, bảng tổng → **cổng duyệt phong cách**.
2. Vẽ đủ: 42 món cũ, ~15 mới, ~10 kiểu mặt sưu tầm, faces.json 30 mảnh, 8 bot, 6 biểu cảm.
3. Server: v3, faces, slot mới, catalogue `sprite`, outfit + migration + API, route guard.
4. ui-kit: `resolve`, `Chibi`, biểu cảm, Seat, Lite.
5. Normal web: bàn, sảnh, tủ đồ, profile.
6. Gỡ 3D, CSP, docs, e2e, footprint.
7. Cấp lại tủ đồ test, build, chạy host, ảnh chụp bàn để bạn duyệt.

## 9. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Chất lượng nét vẽ do tôi vẽ bằng mã | Cổng duyệt ở bước 1; style guide cố định (nét viền 3 đơn vị, bóng khối một tông, không gradient); bảng tổng để soát |
| Sprite phình to | Ngưỡng footprint; symbol dùng path gọn, không nhúng ảnh |
| Người dùng cũ có config v2 hợp lệ nhưng item bị đổi hình | Id giữ nguyên, hình mới; không cần hành động |
| Outfit chứa item đã đổi kiểu (không xảy ra hiện tại) | apply kiểm lại và trả `INVALID_AVATAR` nêu id |

## Phụ lục — Quyết định
- D1: Chibi 2D SVG tự vẽ, không thư viện ngoài (không có bộ phù hợp giấy phép mở; DiceBear chỉ có mặt).
- D2: Mặt cơ bản miễn phí; kiểu mắt/miệng đặc biệt là món sưu tầm (người dùng chọn "cách thứ 2").
- D3: Bộ vẽ ở ui-kit để Lite có chibi; Lite không tủ đồ.
- D4: Gỡ hẳn 3D khỏi Normal (giữ trong lịch sử git); không giữ song song.
- D5: 5 outfit, tên ≤ 24 ký tự, lưu server.
- D6: Tài khoản test phải được cấp đủ catalogue sau mỗi lần đổi catalogue (`grant-wardrobe-cli`).
- D7: R1 tự đăng ảnh bị loại khỏi roadmap vì lệch phong cách.
