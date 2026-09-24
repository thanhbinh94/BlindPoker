# Just a Normal Poker — Màu tóc, màu mắt và biến thể màu đồ

Ngày 2026-09-24. Bổ sung cho spec `2026-09-14-avatar-chibi-ai-design.md` (Plan 11) và `2026-09-24-avatar-asset-registry-design.md` (Plan 12). Người dùng duyệt thiết kế trong phiên 24/09 sau spike tô màu (`.superpowers/sdd/plan11-crop/tint-spike.mjs`, ảnh `tint-spike-all.png`): tóc tách sạch trên f02, f03, m01, m03; mắt đạt 3/4 thân, m03 cần mặt nạ vẽ tay.

## 1. Mục tiêu

Người chơi đổi được màu tóc và màu mắt trên thân đang chọn, và mặc được biến thể màu của một số món, mà không phải sinh thêm ảnh AI. Mọi màu đều là món trong kho: màu thường miễn phí, màu hiếm là đồ sưu tầm.

## 2. Phạm vi

- **Làm:** slot `hairColor` và `eyeColor`; món màu miễn phí (`free`); biến thể màu của món (`asset.tint`); pipeline ghi mặt nạ tô cho mọi lớp thân, lớp mặt và món khai `tintable`; phép kiểm C11; lệnh `masks` và `tint-sheet`; mặt nạ vẽ tay ghi đè; hàm tô dùng chung; client tô bằng canvas; tủ đồ thêm hai tab và hàng biến thể màu.
- **Không làm:** màu da, mắt hai màu, tóc chuyển sắc, bảng chọn mã màu tự do, biến thể màu cho hào quang và khung, màu cho bot, thay đổi gì ở bản Lite (Lite vẽ chibi mặc định, không có kho).
- **Sinh ảnh:** không dự kiến. Nếu một món hoặc một thân không cắt được mặt nạ sạch (C11 trượt) và mặt nạ vẽ tay không đủ, món đó được sinh lại qua vòng lặp ChatGPT của Plan 12 (mục đó trong `registry.json` chuyển `rework-n` với lý do `tint`), rồi nạp và cắt mặt nạ lại.

## 3. Dữ liệu

### 3.1 Slot và cấu hình

- `ItemSlot` thêm `hairColor` và `eyeColor`. Cả hai là slot tuỳ chọn, không vẽ lớp riêng (không thuộc `DRAWN_SLOTS`), không có món mặc định.
- `AvatarConfigV3` thêm hai khoá tuỳ chọn `hairColor?: string` và `eyeColor?: string`, giá trị là id món. Vắng khoá nghĩa là màu gốc của thân. Giữ `v: 3`; cấu hình cũ đọc thẳng, không migration.
- Cột `items.category` là `text`, nên hai slot mới không cần migration cơ sở dữ liệu.

### 3.2 Món màu

```jsonc
{ "id": "haircolor_red01", "slot": "hairColor", "rarity": "common", "nameKey": "items.haircolor_red01",
  "assetKey": "hairColor/haircolor_red01", "isDefault": false, "free": true, "colour": "#b3261e" }
```

- `colour` là mã hex bắt buộc với slot `hairColor`/`eyeColor`, cấm với slot khác. Không có `asset`.
- `free: true` nghĩa là mọi người chơi coi như sở hữu. `owns` và `missingOf` trả "có" cho món `free`; `/api/me/inventory` liệt kê chúng với `source: "free"`; không ghi hàng `inventory` nào. Món `free` không bao giờ vào bể quà hằng ngày. `free` chỉ hợp lệ với `rarity: "common"`.

Bảng màu đợt đầu (id kết thúc `01`; tên i18n vi/en):

| Slot | Thường, miễn phí | Hiếm (`rare`) | Sử thi (`epic`) |
|---|---|---|---|
| Tóc | đen `#1d1a1c`, nâu sẫm `#4a2c1d`, hạt dẻ `#7b3f22`, vàng `#d9b25f`, bạch kim `#e8e1cf`, đỏ `#b3261e`, cam `#d2691e`, xám `#8a8a8f` | hồng `#f08bb4`, xanh dương `#3f6fd8`, xanh lá `#3aa35b`, tím `#7a4fc4` | bạc tím `#c7b8f0` |
| Mắt | nâu `#6b3b1f`, xanh dương `#2f7fd6`, xanh lá `#2f9e55`, xám `#7d8a94`, hổ phách `#d08a1c`, đen `#26211f` | tím `#8b56d6`, đỏ `#c8283a` | vàng kim `#e0b23a` |

### 3.3 Biến thể màu của món

```jsonc
{ "id": "head_beret_blue01", "slot": "head", "rarity": "rare", "nameKey": "items.head_beret_blue01",
  "assetKey": "head/head_beret_blue01", "isDefault": false,
  "asset": { "layer": 80, "file": "item_head_beret_red01_L80", "fitsAvatarCrop": true, "tint": "#3f6fd8" } }
```

- `asset.tint` (hex) nghĩa là vẽ `asset.file` rồi tô vùng mặt nạ `<file>_tintmask` bằng màu này. Món gốc không có `tint`.
- Loader catalogue từ chối `tint` khi manifest không có `<file>_tintmask`.
- Biến thể đợt đầu (12 món):

| Món gốc | Biến thể | Độ hiếm |
|---|---|---|
| `outfit_casual01` (vùng tô: áo phông) | đỏ `#c0392b`, xanh navy `#2c3e70`, xanh lá `#2e8b57`, vàng `#e1b12c` | common, `free` |
| `head_beret_red01` | xanh dương `#3f6fd8`, xanh lá `#2e7d4f`, đen `#2b2b2e` | rare |
| `head_beanie01` | đỏ `#b83a32`, xám `#8d8f94`, vàng mù tạt `#c9a227` | rare |
| `head_party_cone01` | xanh dương `#4a8fe0`, xanh lá `#4fb86a` | common |

Biến thể mũ vào bể quà hằng ngày như mọi món `head` cùng độ hiếm. Biến thể casual01 là `free`.

### 3.4 Bể quà hằng ngày

`DAILY_DRAW_SLOTS` thêm `hairColor` và `eyeColor`. Món `free` bị loại khỏi bể (thêm vào `excludedIds`). Thành tựu giữ nguyên; không gắn thưởng mới vào thành tựu cũ (người đã đạt sẽ không nhận hồi tố).

## 4. Pipeline

### 4.1 Mặt nạ

- Tên tệp: `<layer>_hairmask`, `<layer>_eyemask`, `<layer>_tintmask`, mỗi cái ở `@1x` và `@2x`, cùng khung 384×448 với lớp. PNG trắng, độ phủ nằm trong kênh alpha (0 là không tô, 255 là tô hết, giữa là mép mềm).
- Lớp có mặt nạ tóc: `base_<id>_L30`, `base_<id>_L60` (khi không rỗng), và 6 lớp `base_<id>_face_<expr>_L50`. Lớp có mặt nạ mắt: 6 lớp mặt. Mặt `closed` và `sleep` ghi mặt nạ mắt rỗng; mặt khác có mắt nhắm (khối dưới 100 px @2x) cũng rỗng.
- `L20` (tóc sau) không có mặt nạ tóc và không được tô: mọi thân hiện có đều để `L20` rỗng. Một thân sau này có tóc sau thật sẽ cần cắt mặt nạ tóc cho `L20` và sửa `layersFor` để lớp đó cũng nhận `tints`.
- Món khai `tintable` (qua `ingest --tint-seed x,y` hoặc lệnh `masks`) có mặt nạ `tintmask`: vùng màu liền nhau chứa điểm hạt giống (toạ độ khung 1x), cùng cụm màu trong Lab. Hạt giống được lưu trong manifest (`tintSeed`) để cắt lại được.
- Manifest ghi cho mỗi lớp: `masks: { hair?: { bytes2x, meanL }, eyes?: {…}, tint?: {…} }`. `meanL` là độ sáng HSL trung bình của vùng mặt nạ trên lớp gốc, để client khỏi đo lại.
- Thuật toán tóc và mắt là thuật toán của spike, chuyển thành module có test: bảng màu tóc gom từ đỉnh đầu, bảng màu da từ `SKIN_WINDOW` (bỏ cụm có L ≤ 30), ứng viên tóc loại điểm có sắc độ cao hơn mọi sắc tóc, loại vùng không bao giờ lộ ra (giao của alpha > 200 của mọi trang phục thân đó mặc được, kể cả bản theo giới), trên L60 thì mặt nạ là toàn bộ alpha của lớp, loang từ đỉnh đầu, lấp lỗ sáng, nuốt viền tối không sát da. Mắt: khối không-da-không-tóc mỗi bên trục giữa trong dải mắt, lấp túi kín, gọt lông mày, lấp theo hàng; mặt nạ mắt được trừ khỏi mặt nạ tóc.
- **Mặt nạ vẽ tay:** tệp `assets/avatar-src/masks/<layer>_<kind>mask.png` (1x hoặc 2x, khung chuẩn) thay cho mặt nạ tự động. Thư mục này được commit (`!masks/` trong `.gitignore` của `assets/avatar-src`).

### 4.2 Lệnh

- `avatar-pipeline.mjs masks [<target>…]`: cắt lại mặt nạ cho lớp có sẵn trong `public/avatar` (không cần ảnh nguồn). Không đối số thì làm mọi thân và mọi món có `tintSeed`. `--tint-seed x,y --as item:<slot>:<code>` gắn hạt giống cho một món.
- `ingest` gọi cùng module sau khi ghi lớp, nên thân và món nạp sau này có mặt nạ ngay.
- `avatar-pipeline.mjs tint-sheet`: ghi `docs/avatar-2d-tint-sheet.png`, mỗi thân ba màu tóc × ba màu mắt thử và mỗi món `tintable` với mọi biến thể trong `items.json`, vẽ bằng hàm tô dùng chung (§5.1).

### 4.3 Phép kiểm C11

Với mỗi lớp có mặt nạ:
- Mặt nạ cùng kích thước với lớp, chỉ phủ lên điểm ảnh có alpha của lớp.
- Tóc: diện tích trong khoảng 3–20 % khung trên L30; trên lớp mặt, tỉ lệ so với mặt nạ tóc của `face_neutral` cùng thân trong 0,7–1,3.
- Mắt: mặt `neutral` có đúng hai khối, mỗi khối 100–8000 px @2x, một khối mỗi bên trục giữa. Các mặt khác có hai khối như vậy hoặc rỗng (mặt vui của f02, m03 nhắm mắt cười); `closed`, `sleep` luôn rỗng.
- Tint: diện tích ≥ 2 % diện tích alpha của món.
- Mặt nạ vẽ tay bỏ qua kiểm diện tích (vẫn kiểm kích thước và phủ).

`check` báo C11 như C1–C10; `test/avatar-pipeline.test.ts` và bảng kiểm trong `docs/avatar-2d.md` cập nhật.

## 5. Tô màu

### 5.1 Hàm dùng chung

`recolour(pixels, mask, colour, meanL)` là hàm thuần trên mảng RGBA, đặt ở `packages/ui-kit/src/avatar2d/recolour.mjs` kèm `recolour.d.mts`, để pipeline (Node thuần) và trình duyệt cùng import một mã. Với mỗi điểm có mặt nạ a > 0: lấy độ sáng HSL `l` của điểm gốc, tính `l' = clamp(l + (L_c − meanL))` với `L_c` là độ sáng của màu đích, dựng màu HSL(hue_c, sat_c, l'), rồi trộn với điểm gốc theo `a/255`. Alpha của điểm không đổi.

### 5.2 Client

- `BaseRef` thêm tên mặt nạ; `ChibiConfig` thêm `hairColor?` và `eyeColor?` (hex); `WearRef` thêm `tint?` (hex). `LayerRef` thêm `tints?: { mask: string; colour: string; meanL: number }[]` do `layersFor` điền (lớp thân, L60 và lớp mặt nhận tóc và mắt; món nhận `tint`).
- `Chibi` vẽ lớp có `tints` qua hook `useTintedLayer`: tải ảnh lớp và mặt nạ ở mật độ màn hình, tô trên canvas ngoài màn hình, trả URL blob. Bộ đệm LRU 96 mục theo khoá `file|density|mask:colour…`. Trong lúc chờ lần tô đầu tiên, khi lớp không còn màu nào, và khi không có canvas (jsdom, trình duyệt lỗi), vẽ lớp gốc. Khi chỉ đổi từ màu này sang màu khác trên cùng một lớp, giữ ảnh đã tô trước đó cho tới khi ảnh mới sẵn sàng, để tủ đồ không nhấp nháy về màu gốc giữa hai lần bấm.
- `hashChibi` tính cả `hairColor`, `eyeColor` và `tint` của từng món.
- `normal-web` `chibiFromApi` đọc `hairColor`/`eyeColor` qua catalogue (id → `colour`), đọc `asset.tint` của món; id lạ bị bỏ qua như slot tuỳ chọn khác.
- Server trả `ItemDto` có `colour?`, `free?`, `asset.tint?` và `asset.tintMeanL?` (từ manifest). `BaseDef`/`BaseDto` có `tint?: { hair?: { meanL, files }, eyes?: { meanL, files } }`: `files` là các lớp của thân có mặt nạ không rỗng, `meanL` tóc lấy từ mặt nạ tóc của L30, `meanL` mắt từ mặt nạ mắt của `face_neutral`. Mọi lớp của một thân tô theo cùng `meanL` để không lộ đường nối giữa lớp thân và lớp mặt.

## 6. Tủ đồ

- Hai tab mới "Màu tóc" / "Hair colour" và "Màu mắt" / "Eye colour": ô tròn theo `colour`, ô đầu tiên là "Tự nhiên" (bỏ khoá). Món chưa sở hữu hiện khoá như slot khác.
- Biến thể màu của món (các món cùng `asset.file`) hiện thành một hàng chấm màu dưới thẻ món gốc trong tab của slot đó; chấm chưa sở hữu có khoá. Bấm chấm là mặc biến thể.
- Xem trước trực tiếp như hiện nay.

## 7. Kiểm thử

- Pipeline: module mặt nạ trên ảnh tổng hợp (đầu tóc một màu, mắt hai đốm, áo phông trên quần) — tóc, mắt, tint đúng vùng; mặt nạ vẽ tay thắng; C11 bắt mặt nạ tràn và mắt một khối; `masks` không đụng lớp.
- `recolour`: điểm ngoài mặt nạ giữ nguyên, alpha giữ nguyên, trộn theo mép mềm, độ sáng trung bình vùng tô dời về `L_c`.
- Server: validate slot mới (sai slot `WRONG_CATEGORY`, id lạ `INVALID_ITEM`), món `free` hợp lệ khi chưa có hàng kho, `/api/me/inventory` có món `free`, bể quà loại `free` và có màu hiếm, loader catalogue từ chối `colour` sai slot, `free` không phải common, `tint` thiếu mặt nạ.
- ui-kit: `layersFor` gắn `tints` đúng lớp; `hashChibi` khác nhau khi chỉ khác màu; `Chibi` vẽ lớp gốc khi không có canvas.
- web: `chibiFromApi` với màu và biến thể; tủ đồ chọn màu gửi cấu hình có `hairColor`.
- e2e: chọn màu tóc đỏ trong tủ đồ → ghế có `data-chibi-hash` mới và một lớp `img[src^="blob:"]`.
- Footprint: mặt nạ tính vào ngân sách @2x (trần 32 MB giữ nguyên).

## 8. Triển khai

Sau khi gộp: `grant-wardrobe-cli neon.test@example.com` để tài khoản test có mọi màu hiếm và biến thể; build lại web Normal. Không cần migration. Lite build lại để nhận ui-kit mới (không đổi hành vi).
