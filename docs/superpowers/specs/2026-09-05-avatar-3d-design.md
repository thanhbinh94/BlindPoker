# Bind Poker — Avatar 3D (bản Normal): thiết kế

Đã thay thế bởi `2026-09-14-avatar-chibi-ai-design.md`.

Ngày: 2026-09-05. Trạng thái: **đã triển khai** (Plan 8, nhánh `feat/plan8-avatar-3d`) — xem §2.3.
Liên quan: spec chính `2026-09-04-bind-poker-design.md` (§10.2, §13, §14, §15, §19.2, §24, §26, §27), Plan 6 (avatar SVG hiện tại — sẽ bị thay thế).

## 1. Mục tiêu

Thay hệ avatar SVG phẳng 6 lớp của bản Normal bằng **nhân vật 3D** dựng từ bộ tài sản mã nguồn mở, để hình ảnh nhân vật đổi thật khi đổi **giới tính (thân nam/nữ)**, **kiểu tóc**, **trang phục**, **màu da/tóc/mắt**, phụ kiện. 3D chỉ hiện ở hồ sơ và trình chỉnh; mọi nơi khác (bàn chơi, sảnh, rail, kho đồ) chỉ hiện **ảnh chân dung tĩnh** dựng ở máy người chơi.

## 2. Phạm vi

### 2.1 Trong phạm vi (Plan 8)
| # | Hạng mục | Ghi chú |
|---|---|---|
| S1 | Pipeline tài sản: tải thủ công bộ Quaternius CC0, script build chuẩn hoá `.glb` + `manifest.json` | Kết quả build được commit; nguồn không commit |
| S2 | Catalog item v2 (slot + biến thể theo thân) và cấu hình avatar v2, migration v1→v2 trên server | Giữ nguyên các id đang được thưởng |
| S3 | Bộ dựng chân dung dùng chung + cache (bộ nhớ + IndexedDB) + hook `usePortrait` | Không upload, không lưu ảnh trên server |
| S4 | `AvatarStage` (three.js) ở hồ sơ và trình chỉnh mới; thân nam/nữ; da/mắt/tóc; slot trang phục | Thay `AvatarScreen` hiện tại, giữ route `/avatar` |
| S5 | Thumbnail item dựng bằng bộ dựng chân dung; ảnh chân dung trên bàn/sảnh/rail qua slot `avatarFor` | Gỡ thư viện SVG parts của Plan 6 |
| S6 | Kiểm thử: đơn vị (jsdom), dựng thật trong Chromium, e2e bổ sung; ngân sách footprint | Xem §8 |
| S7 | Tài liệu: `docs/normal-web.md` (mục avatar 3D), `docs/avatar-assets.md` (cách thêm món/bộ mới), spec chính §15 cập nhật, known-limitations | |

### 2.2 Ngoài phạm vi
- Bản **Lite**: không đổi (chữ cái đầu tên, đúng spec chính §15.1).
- Animation nhân vật (idle, biểu cảm), tư thế ngoài "đứng" và "chân dung"; shop; chia sẻ ảnh ra ngoài; dựng phía server; nhập avatar từ dịch vụ ngoài (Ready Player Me…).
- Vẽ lại/cải thiện mesh gốc; món Việt hoá chỉ ở mức tint/ghép từ mesh có sẵn.

### 2.3 Cách xử lý và thứ tự
Plan 8 chạy **sau khi Plan 7 gộp**, theo quy trình SDD như các plan trước (một nhánh, 5 task, review từng task, review toàn nhánh, một đợt sửa, gộp). Thứ tự task: T1 pipeline tài sản (S1) → T2 server catalog v2 + migration (S2) → T3 chân dung + cache, gỡ SVG (S3, S5) → T4 `AvatarStage` + trình chỉnh (S4) → T5 kiểm thử/ngân sách/tài liệu (S6, S7). Mỗi task có thể gộp vào master độc lập vì: T1 chỉ thêm file; T2 tương thích ngược (đọc v1); T3 giữ `Avatar` cũ làm fallback cho đến khi T4 xong nếu cần.

**Trạng thái (2026-09-06):** cả năm task đã xong trên `feat/plan8-avatar-3d`. Những chỗ đã làm khác đặc tả, hoặc đặc tả không lường trước:
- **Không có texture nào** (§4 nói "texture ≤ 512 px WebP"). Không cài được resizer (`sharp` là native), và quan trọng hơn: base-colour map của thân **nướng cứng một tông da** trong khi người chơi chọn từ tám. Vật liệu PBR phẳng với `baseColorFactor` mới là thứ mà tint lúc chạy nói chuyện được. Xem `docs/avatar-assets.md`.
- **Chỉ một tư thế tĩnh**, không phải hai (§4 nói "giữ 2 tư thế: đứng, chân dung"). Tệp `.glb` giữ đúng bind pose (T-pose) của bộ nguồn, còn `manifest.pose.armsDown` công bố *công thức* xoay bốn khớp tay để đứng lên; "chân dung" chỉ là một khung hình khác của cùng tư thế đó, nên nó là việc của camera chứ không phải của geometry.
- **Quần áo phải được nắn và bọc lên thân lúc build** (§4 không lường trước). Hai bộ nguồn không được dựng cho nhau; xem §15.2 của spec chính và `docs/avatar-assets.md` → "Fitting a garment".
- **`AvatarStage` không có prop `onReady`** (§6 nêu nó): không có màn nào cần biết, và một prop không ai gọi là một prop sẽ trôi. `description` (bắt buộc) thay cho "`aria-label` mô tả cấu hình".
- **CSP phải mở thêm hai directive** (§19.2 của spec chính không lường trước): `script-src 'self' 'wasm-unsafe-eval'` cho bộ giải nén meshopt và `blob:` trong `img-src` cho object URL của ảnh chân dung.
- **Ngân sách §7 đạt hết**, đo trong e2e: chunk 150 KB gzip / 200, tài sản 0,9 MB / 6 MB, ~60–100 ms mỗi ảnh sau khi nạp, ~0,3 s từ lúc vào bàn tới khi đủ ảnh. Lần đầu trên máy lạnh ~3,4 s — xem `docs/known-limitations.md`.

## 3. Mô hình dữ liệu

### 3.1 Cấu hình avatar v2 (`players.avatar_config`, ~100–150 byte)
```ts
interface AvatarConfigV2 {
  v: 2
  body: 'male' | 'female'
  skin: string        // '#rrggbb', một trong 8 tông của bảng SKIN_TONES
  eyes: string        // '#rrggbb', bảng EYE_COLORS (6)
  hairColor: string   // '#rrggbb', preset hoặc tự chọn (như hiện nay)
  hair: string        // item id, bắt buộc (có item "trọc" mặc định)
  top: string         // bắt buộc
  bottom: string      // bắt buộc
  shoes: string       // bắt buộc
  hat?: string
  accessory?: string
  jewelry?: string
  title?: string
  badge?: string
}
```
Quy tắc: mọi item phải thuộc kho của người chơi và đúng `slot`; item phải có `variants[body]`; `PUT` là thay toàn bộ; thiếu slot bắt buộc → `MISSING_LAYER`; sai màu → `INVALID_COLOR`; sai slot → `WRONG_CATEGORY`; không sở hữu → `NOT_OWNED` (mã lỗi giữ nguyên với §19.2).

### 3.2 Item v2 (`data/items.json`)
```ts
interface ItemDefV2 {
  id: string
  slot: 'hair' | 'top' | 'bottom' | 'shoes' | 'hat' | 'accessory' | 'jewelry' | 'title' | 'badge'
  rarity: 'common' | 'rare' | 'epic'
  nameKey: string           // items.<id>
  isDefault: boolean
  variants?: { male?: AssetRef; female?: AssetRef }   // bắt buộc với slot hình học; không có với title/badge
}
interface AssetRef { file: string; node: string; tint?: string }   // file trong /avatar3d/, node theo quy ước "<slot>/<itemId>/<body>"; `tint` là màu cố định của vật liệu cloth_primary — màu da/mắt/tóc đến từ cấu hình người chơi, không phải từ item
```
- Cột `items.category` trong DB được **đổi tên/ý nghĩa thành `slot`** qua migration (giá trị cũ map: `hair→hair`, `clothing→top`, `accessory→accessory` hoặc `hat` theo bảng map trong migration, `jewelry→jewelry`, `title`, `badge`; `base`/`face` bị xoá khỏi catalog và khỏi `inventory`).
- Id giữ nguyên: `hat_crown` (slot `hat`), `jacket_champion` (`top`), `ring_royal` (`jewelry`), `badge_veteran`, `badge_monthly`, `title_devoted`, `title_hot_hand`, các `hair_*`, `clothing_*` (→ `top`), `accessory_*` (kính/mặt nạ → `accessory`; nón lá/headband → `hat`), `jewelry_*`. Thêm mới: `bottom_*` (≥ 4), `shoes_*` (≥ 3), `hair_none`, mỗi slot bắt buộc có đúng một `isDefault`.
- Ràng buộc catalog (test): mọi `variants.*` trỏ tới node có trong `manifest.json`; mỗi slot **bắt buộc** (`hair`/`top`/`bottom`/`shoes`) có đúng một item mặc định, đủ hai biến thể (`hair_none`, `top_tee`, `bottom_jeans`, `shoes_sneakers`); slot tùy chọn (kể cả các slot hình học `hat`/`accessory`/`jewelry`) không có item mặc định — loader từ chối cả catalog thiếu mặc định ở slot bắt buộc lẫn catalog có mặc định ở slot tùy chọn; các id được thưởng bởi `achievements.json` và điểm danh tồn tại.

### 3.3 Migration v1 → v2 (server)
- Đọc: cấu hình không có `v` hoặc `v: 1` → `body: 'male'`, `skin`/`eyes` mặc định, `hairColor` giữ, `hair` giữ nếu còn trong catalog (else mặc định), `top` = `clothing` cũ nếu còn, `bottom`/`shoes` mặc định, `hat`/`accessory` từ `accessory` cũ theo bảng map, `jewelry`/`title`/`badge` giữ. Kết quả luôn hợp lệ với kho hiện tại (item mặc định được cấp cho mọi tài khoản khi migration chạy).
- Ghi: `PUT` chỉ nhận v2; `GET /api/me`, `/api/me/inventory`, `/api/players/:id/avatar` trả v2 (đã migrate khi đọc).
- Migration SQL: cấp item mặc định mới cho mọi người chơi (`inventory`, `source = 'default'`), xoá dòng `inventory` của item bị loại, đổi `category` → `slot`. Idempotent.

## 4. Pipeline tài sản

- Nguồn: `assets/avatar-src/` (gitignore) + `assets/avatar-src/README.md` ghi URL, giấy phép (CC0), ngày tải, checksum. Bộ dùng: Quaternius *Universal Base Characters* (thân nam/nữ vóc thường, 20 kiểu tóc) và *Modular Character Outfits* (bộ Fantasy; thêm Casual nếu có).
- Script `apps/normal-web/scripts/avatar-assets.mjs` (`@gltf-transform/core` + `functions`, `meshoptimizer`): tách node theo quy ước `<slot>/<itemId>/<body>`, bỏ rig/animation, giữ 2 tư thế tĩnh (đứng, chân dung) dưới dạng 2 biến thể node hoặc morph; gộp thành `body-male.glb`, `body-female.glb`, `hair.glb`, `outfits-<set>.glb`, `accessories.glb`; nén meshopt; texture ≤ 512 px WebP; vật liệu chuẩn hoá tên `skin`, `hair`, `cloth_primary`, `cloth_secondary`, `metal` để tint được; xuất `apps/normal-web/public/avatar3d/` + `manifest.json` `{ files: { name: { bytes, hash } }, nodes: { "<slot>/<id>/<body>": { file, bytes } } }`.
- Ngân sách: mỗi file thân ≤ 400 KB, tổng ≤ 6 MB, mọi file tải theo nhu cầu; script fail khi vượt.
- Phối màu "Đêm Sài Gòn": bảng tint mặc định trong manifest; món Việt hoá (nón lá, áo dài) bằng tint/ghép mesh gần nhất; thiếu mesh → dùng mesh gần nhất + ghi known-limitations.

## 5. Chân dung và cache (client)

- `portraits.ts`: một `WebGLRenderer` ẩn (256×256, xuất 128×128 WebP, fallback PNG), hàng đợi tuần tự, cảnh tái sử dụng, khung nhìn đầu-vai, ánh sáng cố định. Khoá cache = `hashConfig(v2)` (JSON chuẩn hoá theo thứ tự khoá cố định).
- Cache: bộ nhớ (Map) + IndexedDB `bp.portraits` (≤ 200 mục, LRU theo `lastUsed`), lưu `Blob`; phát `object URL`, thu hồi khi bị evict.
- Hook `usePortrait(config | null): { url, status: 'idle'|'loading'|'ready'|'unsupported' }`; `useAvatars` giữ nguyên vai trò (cấu hình theo playerId, `invalidate`); thành phần `Avatar` mới = `<img>` + placeholder chữ cái đầu.
- Fallback: không tạo được WebGL context, tài sản lỗi, hoặc dựng lỗi → `unsupported` → chữ cái đầu; không bao giờ chặn giao diện; ghi `console.warn` một lần.
- Chi phí mục tiêu: ≤ 80 ms/chân dung sau khi tài sản đã nạp; vào bàn 9 người lần đầu ≤ 2 s tới khi đủ ảnh (đo trong e2e).

## 6. Giao diện

- `AvatarStage` (lazy chunk, three.js): nhân vật toàn thân, camera cố định 3/4, kéo để xoay ±60°, render theo sự kiện (không vòng lặp); props `{ config, mode: 'view'|'edit', onReady? }`; `aria-label` mô tả cấu hình bằng chữ.
- Trình chỉnh (`/avatar`): trái `AvatarStage`; phải các nhóm **Thân** (nam/nữ), **Da** (8 tông có tên), **Mắt** (6), **Tóc** (item + màu), **Áo / Quần-váy / Giày / Mũ / Phụ kiện / Trang sức** (chỉ món sở hữu, thumbnail dựng bằng bộ dựng chân dung, ô "không dùng" cho slot tuỳ chọn), **Danh hiệu / Huy hiệu**. Đổi thân giữ món đang mặc nếu có biến thể; món thiếu biến thể về mặc định kèm ghi chú. **Lưu** → `PUT` → làm mới chân dung; **Đặt lại**; cảnh báo chưa lưu khi rời. Mobile: stage ghim trên (40vh), nhóm cuộn dưới; mục tiêu chạm ≥ 44 px.
- Hồ sơ: `AvatarStage` chế độ xem + nút "Chỉnh trang phục". Kho đồ: thumbnail tĩnh. Bàn/sảnh/rail: ảnh chân dung qua `avatarFor`; caption danh hiệu/huy hiệu giữ nguyên.
- i18n: `normal` namespace thêm khoá slot, tông màu, ghi chú; parity test; không chuỗi cứng.

## 7. Ngân sách hiệu năng (§24)
| Mục | Ngưỡng |
|---|---|
| Chunk three.js + stage + portraits | ≤ 200 KB gzip, lazy |
| Chunk đầu | ≤ 500 KB gzip (không đổi) |
| Tài sản 3D | ≤ 6 MB tổng, tải theo nhu cầu, cache HTTP `immutable` theo hash tên file |
| Dựng chân dung | ≤ 80 ms/ảnh (sau nạp), 9 ảnh ≤ 2 s |
| Trình chỉnh | không render khi không đổi; ≤ 1 context WebGL cho stage + 1 cho chân dung |

## 8. Kiểm thử
- Đơn vị (jsdom): hash ổn định; migration v1→v2 (server + client đọc); validate v2; `usePortrait` với bộ dựng giả; cache/LRU/invalidate; catalog↔manifest; parity i18n.
- Dựng thật (Chromium, Playwright trong e2e hiện có): 3 cấu hình → ảnh không rỗng, khác nhau theo hash, thời gian dựng ghi log; đổi thân nữ + áo dài → lưu → tải lại → sảnh có `data-hash` mới; bàn chơi hiện ảnh; `@mobile` trình chỉnh không cuộn ngang.
- Footprint: ngưỡng §7 thêm vào `test/footprint.test.ts`.
- Server: test kinh tế/thành tựu không đổi; migration idempotent; `PUT` v2 các mã lỗi.

## 9. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Bộ trang phục thiên fantasy, ít món hiện đại/Việt | Tint + ghép; ghi known-limitations; roadmap bộ Casual |
| Máy yếu/không WebGL | Fallback chữ cái; render theo sự kiện; ảnh 128 px |
| Kích thước tài sản | Ngân sách + script fail sớm; lazy |
| Migration làm mất cấu hình cũ | Đọc tương thích; item mặc định cấp cho mọi người; test trên dữ liệu v1 thật |

## 10. Lộ trình sau Plan 8
Animation idle ở hồ sơ; biểu cảm; bộ trang phục theo mùa; dựng phía server nếu cần chia sẻ ảnh ra ngoài; shop cosmetic (spec chính §34).

## Phụ lục — Quyết định
- A1: tài sản CC0 Quaternius, không thuê vẽ (người dùng chọn).
- A2: 3D thời gian thực chỉ ở hồ sơ/trình chỉnh; nơi khác ảnh tĩnh dựng ở client (người dùng chọn phương án 1).
- A3: giới tính = thân đổi tự do, một item cho cả hai thân qua biến thể (người dùng chọn phương án 1).
- A4: three.js (không Babylon, không dựng server).
- A5: bỏ slot `base`/`face` của Plan 6; `clothing` tách `top/bottom/shoes`; thêm `hat`.
