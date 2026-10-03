# Nhân vật thế hệ mới (v4): giới tính, kiểu tóc, màu da tách riêng; dáng mới có ngón tay — thiết kế

Ngày 2026-10-03. Đợt 3 của review 2026-09-29 (No13, No14 — `docs/bug-log.md` §7; ghi chú gốc
`other/review/20260929/Note.txt`). Người dùng: "làm Đợt 3 luôn", rồi duyệt từng câu hỏi và cả năm phần thiết kế trong
phiên brainstorming cùng ngày.

Spec này sửa các tài liệu sau (ghi rõ ở mục 11):
- `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` (Plan 11, gọi tắt spec14);
- `docs/superpowers/specs/2026-09-24-avatar-tint-design.md` (spec tô màu);
- `docs/avatar/01-quy-cach-tai-san-nhan-vat-kho-do.md` (D01) và `docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md` (D02);
- `docs/avatar-2d.md`.

## 1. Mục tiêu

Người dùng (No13): *"Khi đổi thân nền thì đồng thời thay đổi cả model nam nữ, màu da — không tốt về mặt UI. Mong muốn:
vị trí thay đổi giới tính; vị trí đổi màu tóc, màu da, kiểu dáng… riêng; kiểu tóc, màu da… thiết kế đặc trưng cho từng
loại model male/female."* (No14): *"Chỉnh sửa dáng model nhân vật sao cho tự nhiên hơn. Nhân vật cần có ngón tay."*

**Trước thay đổi**, mỗi "nhân vật" (base `f01`…`m03`) là một bức vẽ AI liền khối:
- giới tính (`wear`), kiểu tóc, màu da và màu mắt gốc đều nằm cố định trong một ảnh;
- lớp tóc sau (L20) và tóc trước (L60) có trong code nhưng gần như trống;
- màu da không đổi được;
- tay vẽ dạng "bao tay", theo đúng khóa D02.

**Sau thay đổi**:
- người chơi chọn riêng **giới tính**, **kiểu tóc** (theo giới tính), **màu da**, màu tóc và màu mắt;
- mọi nhân vật dùng **một dáng đứng mới, tự nhiên hơn, có ngón tay**.

## 2. Quyết định của người dùng

| # | Câu hỏi | Chọn |
|---|---|---|
| Q1 | Dáng (No14) | **(c)**: một dáng đứng mới có ngón tay cho mọi nhân vật trong đợt này; nhiều dáng để chọn để đợt sau |
| Q2 | Màu da | **(a)**: mỗi giới tính vẽ một thân màu da trung bình, đổi tông bằng mặt nạ tô màu; **màu da miễn phí** |
| Q3 | Kiểu tóc | **(a)**: mỗi giới tính 4 kiểu, đều miễn phí: 3 kiểu đang có + nữ đuôi ngựa, nam vuốt dựng; hệ thống sẵn sàng cho kiểu tóc là vật phẩm hiếm sau này |
| Q4 | Bot | **(a)**: vẽ lại 8 bot trên thân mới trong đợt này |
| Q5 | Làm tranh | ChatGPT trên Chrome của người dùng (như Plan 12), **một điểm duyệt phong cách ở đầu** trước khi vẽ hàng loạt |
| Hướng | Lưu ngoại hình | **Hướng 1**: trường `gender` + ô vật phẩm `hairStyle` + ô màu `skinColor`, dùng lại cơ chế vật phẩm, màu và tô màu sẵn có |

## 3. Phạm vi

- **Làm:**
  - Cấu hình nhân vật v4, ô `hairStyle` và `skinColor`, tệp thân theo giới tính thay cho danh sách base.
  - Chuyển đổi v3→v4 lúc đọc, cho cả cấu hình đang dùng lẫn bộ đồ đã lưu.
  - Mặt nạ da.
  - Pipeline cho thân, mặt và tóc tách hai lớp.
  - Vẽ lại 2 thân, 10 nét mặt, 8 kiểu tóc, 6 bộ quần áo (kèm bản cắt nam khi cần) và 8 bot; thử khớp mũ và kính với cả 8 kiểu tóc.
  - Phòng thay đồ có nút Nữ | Nam, tab Kiểu tóc và Màu da.
  - Bản Lite tự sinh ngoại hình theo mô hình mới.
  - Bỏ tranh base cũ và bot cũ khi chuyển hẳn.
- **Không làm:**
  - nhiều dáng để chọn;
  - kiểu tóc dùng chung cho cả hai giới;
  - vẽ tay riêng từng tông da;
  - chọn hình dáng mắt hay khuôn mặt;
  - nội dung kiểu tóc hiếm (hệ thống cho phép, nhưng không thêm món nào);
  - đổi hào quang hoặc khung;
  - đổi gì ở cơ chế tô màu ngoài thêm mặt nạ da.

## 4. Dữ liệu

### 4.1 Cấu hình v4

```ts
interface AvatarConfigV4 {
  v: 4
  gender: 'f' | 'm'
  hairStyle: ItemId        // bắt buộc; món ô `hairStyle`, đúng giới tính
  outfit: ItemId           // bắt buộc như trước
  skinColor?: ItemId       // ô màu; vắng = tông tự nhiên của thân vẽ
  hairColor?: ItemId       // như trước; vắng = màu tự nhiên của kiểu tóc
  eyeColor?: ItemId        // như trước; vắng = màu mắt tự nhiên của giới tính
  head?: ItemId; face?: ItemId; aura?: ItemId; frame?: ItemId; title?: ItemId; badge?: ItemId
}
```

- Trường `base` bị bỏ. Server chỉ nhận `v === 4`.
- Kiểm tra cấu hình:
  - `gender` phải là `'f'` hoặc `'m'`;
  - `hairStyle` phải là món ô `hairStyle` khai báo `gender` trùng với `gender` của cấu hình, nếu lệch thì báo lỗi mới `WRONG_GENDER`;
  - các ô khác kiểm như v3.
- Món miễn phí (`free`) luôn được coi là đã sở hữu.
- Tài khoản mới: `{ v:4, gender:'f', hairStyle:'hair_f_bob01', outfit:<mặc định> }`.

### 4.2 Ô mới

| Ô | Loại | Vẽ lớp | Món khởi đầu |
|---|---|---|---|
| `hairStyle` | món vẽ (như `head`) | L20 (tóc sau, có thể trống) + L60 (tóc trước) | 8 món `free`, mỗi món có `gender` |
| `skinColor` | món màu (như `hairColor`) | không vẽ lớp; tô lên thân và mặt qua mặt nạ da | 6 món `free` (cộng "Tự nhiên" = không chọn) |

**8 kiểu tóc.** Mỗi kiểu có màu tự nhiên bằng đúng màu tóc của base cũ tương ứng, để người chơi cũ giữ được ngoại hình.

| Mã | Giới | vi | en | Màu tự nhiên (lấy từ) | Tương ứng khi đổi giới |
|---|---|---|---|---|---|
| `hair_f_bob01` | f | Tóc bob | Bob cut | f01 | `hair_m_tousled01` |
| `hair_f_hime01` | f | Tóc dài mái bằng | Long with bangs | f02 | `hair_m_neat01` |
| `hair_f_wavy01` | f | Tóc gợn sóng | Wavy bob | f03 | `hair_m_curly01` |
| `hair_f_ponytail01` | f | Tóc đuôi ngựa | Ponytail | mới (chốt ở bước duyệt) | `hair_m_spiky01` |
| `hair_m_tousled01` | m | Tóc rối | Tousled | m01 | `hair_f_bob01` |
| `hair_m_neat01` | m | Tóc gọn | Neat crop | m02 | `hair_f_hime01` |
| `hair_m_curly01` | m | Tóc xoăn | Curly | m03 | `hair_f_wavy01` |
| `hair_m_spiky01` | m | Tóc vuốt dựng | Spiked | mới (chốt ở bước duyệt) | `hair_f_ponytail01` |

**7 lựa chọn tông da.** Giá trị hex của 6 món chốt trên ảnh mẫu thật ở bước duyệt phong cách:

| Thứ tự | Tông | Món |
|---|---|---|
| 1 | trắng sứ (porcelain) | `skin_porcelain01` |
| 2 | sáng (fair) | `skin_fair01` |
| 3 | kem (cream) — tông vẽ thân, tức "Tự nhiên" | không có món (`skinColor` vắng) |
| 4 | sáng ấm (light tan) | `skin_lighttan01` |
| 5 | ngăm (tan) | `skin_tan01` |
| 6 | nâu (brown) | `skin_brown01` |
| 7 | nâu đậm (deep brown) | `skin_deep01` |

- Món màu da theo cùng quy ước với màu tóc và màu mắt hiện có.
- Không vào phần quà điểm danh: `DAILY_DRAW_SLOTS` không gồm `hairStyle` và `skinColor`.

### 4.3 Thân theo giới tính

- Tệp mới `apps/normal-server/data/avatar-bodies.json` thay `avatar-bases.json`. Mỗi giới tính `f` và `m` có:
  - thân `body_<g>_L30`: đầu trọc, có ngón tay, mặc đồ lót trung tính, da tông "kem";
  - 6 nét mặt `body_<g>_face_<expr>_L50`: chỉ mặt, không tóc;
  - màu mắt tự nhiên;
  - tham số tô màu, gồm `skin: { meanL, files }` và `eyes: { meanL, files }`.
- Server kiểm mọi tệp với manifest lúc khởi động, như `loadBases` hiện nay (đổi thành `loadBodies`).
- `/api/catalog/avatar` trả `bodies` thay cho `bases`.

### 4.4 Quần áo và mũ

- **Quần áo** giữ cơ chế `asset.file` (bản dùng chung, vẽ trên thân nữ) và `asset.variants.m` (bản cắt nam khi vai và dáng khác nhiều).
- **Chọn bản cắt** theo `gender`, thay cho `base.wear` (`layerFileFor`).
- **Mũ che tóc:** cờ `hidesHairFront` và `hidesHairBack` áp lên hai lớp của món tóc đang đội. Từ nay cả hai cờ đều có tác dụng thật.

### 4.5 Chuyển đổi v3 → v4 (lúc đọc, không ghi đè DB)

| base cũ | gender | hairStyle | skinColor |
|---|---|---|---|
| f01 | f | `hair_f_bob01` | vắng (tự nhiên, tông kem) |
| f02 | f | `hair_f_hime01` | `skin_porcelain01` |
| f03 | f | `hair_f_wavy01` | `skin_tan01` |
| m01 | m | `hair_m_tousled01` | `skin_lighttan01` |
| m02 | m | `hair_m_neat01` | `skin_fair01` |
| m03 | m | `hair_m_curly01` | `skin_deep01` |
| khác hoặc không rõ | f | `hair_f_bob01` | vắng |

- `hairColor` và `eyeColor` của cấu hình cũ được giữ nguyên. Cách chuyển đổi hiện tại đánh rơi hai trường này; spec này sửa luôn lỗi đó.
- **Màu mắt tự nhiên:** nếu màu mắt tự nhiên của base cũ khác màu mắt tự nhiên của giới tính mới, và cấu hình không có `eyeColor`, thì gán món màu mắt miễn phí gần nhất (khoảng cách trong không gian Lab).
- **Phạm vi áp dụng:** áp cho `players.avatar_config` khi đọc, và cho `avatar_outfits.config` khi liệt kê và khi áp bộ đồ. Bộ đồ đã lưu hiện được trả nguyên trạng và áp mà không kiểm base; từ nay luôn qua chuyển đổi rồi mới kiểm.
- **Cấu hình v1/v2:** đi tiếp v1→v3→v4.
- **Khi nào ghi lại DB:** chỉ khi người chơi bấm Lưu.

## 5. Tranh và pipeline

### 5.1 Khung bất biến

Khung giữ nguyên:
- kích thước 384×448 @1x, 768×896 @2x;
- trục x = 192;
- đường chân y = 408;
- ô chân dung đầu 208×208 tại (88, 40) và vòng khung 260;
- các số lớp L10…L90.

**Đầu mới** phải nằm đúng chỗ và đúng cỡ đầu F01/M01 hiện nay, sai lệch tâm và chiều rộng đầu không quá 2%. Nhờ vậy mũ, kính, hào quang, khung và ảnh chân dung dùng lại được. Pipeline có phép kiểm mới C12, "đầu không xê dịch".

### 5.2 Khóa nhân vật mới (thay D02 §2.3 và spec14 §4.2)

Giữ:
- phong cách chibi khoảng 2,25 đầu;
- nét vẽ và cách tô (da và tóc bán-painterly, quần áo cel hai tông);
- nền xanh lá hoặc trong suốt;
- ảnh nguồn 1024×1536.

Thay:
- **Dáng đứng thả lỏng:** trọng tâm hơi dồn một chân, vai hạ tự nhiên, tay buông hơi cong ra khỏi thân.
- **Bàn tay thấy rõ 5 ngón**, đơn giản, cỡ chibi.
- **Đầu trọc nhẵn**, để ghép tóc.
- **Đồ lót trung tính** như hiện nay.
- **Da tông kem.**
- **Dự phòng:** nếu ChatGPT không vẽ được đầu trọc sạch, dùng "tóc sát da" rồi tách bằng mặt nạ.

Câu khóa chính xác được viết và thử ở bước duyệt phong cách (mục 8, bước 2), ghi vào `registry.json` (mẫu `body`) và D02.

### 5.3 Loại tranh mới trong registry và pipeline

| Loại | Mã registry | Lớp ra | Ghi chú |
|---|---|---|---|
| Thân | `body:<g>` | `body_<g>_L30`, `body_<g>_face_neutral_L50` | như cách tách base phẳng: mặt tách theo vùng đầu |
| Nét mặt | `face:<g>:<expr>` | `body_<g>_face_<expr>_L50` | "Keep this exact image… change only the eyes and mouth" |
| Kiểu tóc | `hair:<code>` | `item_hair_<code>_L20`, `item_hair_<code>_L60` | vẽ trên ảnh thân trọc của giới tính đó; tách hai lớp (5.4) |
| Quần áo | `outfit:<code>[:m]` | như hiện nay, đăng ký trên thân mới | |
| Bot | `bot:<n>[:happy]` | như hiện nay (tranh liền khối), vẽ từ thân mới | |
| Mũ, kính (vẽ lại khi lệch) | `item:head:<code>` / `item:face:<code>` | như hiện nay | chỉ món nào trượt bước thử khớp |

### 5.4 Tách tóc trước / sau

Pipeline lấy hiệu giữa ảnh có tóc và ảnh thân trọc (đã đăng ký) ra vùng tóc, rồi chia:
- **Tóc trước (L60):** phần tóc chồng lên dáng đầu và mặt của thân, gồm mái, tóc mai trước tai, và đỉnh đầu.
- **Tóc sau (L20):** phần tóc nằm ngoài dáng người, tức sau vai và sau lưng (tóc dài, đuôi ngựa), cùng phần tóc phía sau đầu nhô ra ngoài dáng đầu.
- **Ranh giới:** vẽ theo dáng đầu của thân và đường vai.
- **Sửa tay khi máy chia sai:** có thể dùng mặt nạ vẽ tay ghi đè, như đã làm với tóc f02 và m02 (`assets/avatar-src/masks/`).
- **Phép kiểm C13:**
  - hai lớp không chồng nhau;
  - hai lớp gộp lại phủ ≥ 99% vùng tóc;
  - tóc trước không lấn vào vùng mắt.

### 5.5 Mặt nạ da

- Mỗi `body_<g>_L30` và mỗi nét mặt có `_skinmask` (alpha = phần da).
- **Cách tính:** cụm màu da trong không gian Lab, giống mặt nạ tóc. Không ăn vào mắt, miệng, đường viền nâu ấm hay đồ lót. Đường viền giữ nguyên màu để nét vẽ không nhòe.
- **Tham số `meanL`** lấy theo từng giới tính, từ thân.
- **Phép kiểm C11 mở rộng:**
  - da chiếm một tỉ lệ hợp lý của khung, khoảng giữa đặt ở bước duyệt;
  - mặt nạ da của các nét mặt bằng 0,8–1,2 lần mặt nạ của nét "bình thường";
  - không trùng mặt nạ mắt.

### 5.6 Kiểm tra và ảnh tổng hợp

- **Kiểm tra hiện có:** C1–C11 áp cho tranh mới.
- **C6 (quần áo phủ kín đồ lót)** đo trên hai thân mới, mỗi bộ trên giới tính dùng được nó.
- **Ảnh tổng hợp mới:** lệnh `sheet` có thêm lưới giới tính × kiểu tóc × 3 tông da × 2 bộ đồ, và lưới thử khớp mũ và kính × 8 kiểu tóc.

### 5.7 Dung lượng

- Bỏ base cũ (khoảng 8,8 MB @2x) và bot cũ (khoảng 11,1 MB).
- Bộ mới gồm 2 thân, 12 mặt, 8 tóc × 2 lớp, quần áo, 8 bot (bot vẫn chỉ 2 mặt thật, 4 mặt chép) và các mặt nạ.
- Giới hạn 32 MB của `footprint.test.ts` giữ nguyên.

## 6. Phòng thay đồ và nơi hiển thị

### 6.1 Nhóm "Ngoại hình"

- **Đầu nhóm:** nút chuyển `Segmented` **Nữ | Nam** (`wardrobe.gender.f/m`, en "Female/Male"). Đây không phải tab và luôn thấy trong nhóm.
- **Bốn tab con:**
  - **Kiểu tóc:** ô vật phẩm. Mỗi ô là ảnh chân dung đầu với đúng kiểu tóc đó, theo màu tóc, tông da và giới tính hiện tại. Chỉ hiện kiểu của giới tính đang chọn.
  - **Màu tóc:** như hiện nay.
  - **Màu da:** ô màu như màu tóc: "Tự nhiên" (tông kem) và 6 tông khác.
  - **Màu mắt:** như hiện nay.
- Tab "Nhân vật" (`base`) bị bỏ, kèm `BaseTab.tsx` và các khóa `bases.*`.
- Ô tích "Hiện cả món chưa có" và các quy tắc họ món áp như mọi ô khác.

### 6.2 Khi đổi giới tính (trong bản nháp)

- `hairStyle` chuyển sang kiểu tương ứng ở bảng 4.2.
- Quần áo tự dùng bản cắt theo giới tính mới.
- Màu tóc, màu da, màu mắt, mũ, kính, hào quang, khung, danh hiệu và huy hiệu giữ nguyên.
- "Lưu trang phục" mới lưu; "Hoàn tác" quay lại như mọi thay đổi khác.

### 6.3 Nơi khác

- **"Đang dùng":** các dòng đầu thành Giới tính, Kiểu tóc, Màu da, Màu tóc, Màu mắt, rồi tới các món đồ như cũ.
- **Bộ đồ đã lưu:** lưu cấu hình v4 đầy đủ.
- **Thanh sảnh, ghế ở bàn chơi, hồ sơ, phiếu kết quả:** không đổi giao diện; vẽ qua `chibiFor` theo cấu hình v4.
- **Kit (`packages/ui-kit/src/avatar2d`):**
  - `ChibiConfig` mang `body` (theo giới tính), `hair` (món tóc có hai lớp) và các tông màu;
  - `layersFor` sắp lớp L20 tóc sau → L30 thân → L40 quần áo → L50 mặt → L60 tóc trước → L70 kính → L80 mũ, và áp cờ che tóc;
  - `hashChibi` gồm giới tính, kiểu tóc và tông da.

### 6.4 Lite

- `defaultChibi(seed)`:
  - giới tính theo chẵn/lẻ của băm tên, như cách chọn f01/m01 hiện nay;
  - kiểu tóc mặc định của giới tính đó (`hair_f_bob01` / `hair_m_tousled01`);
  - da tự nhiên, áo phông thường ngày.
- Bản exe chỉ đóng gói tệp thân, mặt, hai kiểu tóc mặc định, quần áo mặc định và bot. Bỏ được các ảnh base thừa đang bị đóng gói.

## 7. An toàn dữ liệu

- **Không có migration SQL:** cấu hình vẫn nằm trong cột jsonb như cũ, và dữ liệu cũ được sửa khi đọc. Muốn quay về bản trước thì dữ liệu vẫn còn nguyên, trừ những người đã bấm Lưu theo v4.
- **Server từ chối có lỗi rõ ràng:**
  - cấu hình v3 gửi lên;
  - mã base cũ;
  - kiểu tóc lệch giới tính.
- **Tài khoản test:** `neon.test@example.com` được cấp lại đồ (`grant-wardrobe-cli`) nếu cần.
- **Bot:** giữ mã và phong cách khuôn mặt hiện tại (8 khuôn mặt bot khác nhau), chỉ vẽ lại trên thân mới.

## 8. Thứ tự triển khai

1. **Code trên tranh tạm.**
   - Pipeline có các loại thân, mặt, tóc, mặt nạ da, C12 và C13; lệnh `placeholder` sinh tranh tạm có nhãn cho thân, mặt và tóc.
   - Dữ liệu v4, chuyển đổi, hai ô mới, `avatar-bodies.json`, kit và client.
   - Phòng thay đồ mới.
   - Kiểm thử đầy đủ trên tranh tạm.

   Nhân vật cũ vẫn là thứ chạy trên host cho đến bước 5.
2. **Duyệt phong cách — điểm dừng duy nhất.**
   - Vẽ thân nữ và thân nam mới, kèm 1 kiểu tóc (bob và rối), 1 bộ quần áo (`casual01`) và 3 tông da (trắng sứ, kem, nâu đậm).
   - Gửi người dùng ảnh tổng hợp.
   - Chờ "ok" trước khi làm tiếp. Nếu người dùng muốn sửa, thì vẽ lại, tối đa 3 vòng, rồi hỏi lại.
3. **Vẽ hàng loạt theo registry,** mỗi lô chạy `verify`, `ingest`, `check` và xuất ảnh tổng hợp:
   1. 10 nét mặt;
   2. 6 kiểu tóc còn lại;
   3. 6 bộ quần áo và bản cắt nam;
   4. 8 bot × 2 (thân và mặt vui);
   5. thử khớp mũ và kính, vẽ lại món lệch.
4. **Chốt màu.** Đặt giá trị hex của 6 món màu da và màu tự nhiên của 2 kiểu tóc mới trên tranh thật.
5. **Chuyển hẳn.**
   - Bỏ tranh base cũ, bot cũ, `avatar-bases.json` và `BaseTab`.
   - Chạy đủ bộ kiểm: unit, e2e Normal, Lite e2e, ops pack.
   - Merge, cập nhật host LAN, build lại Lite.

## 9. Kiểm thử

- **Unit, server:**
  - cấu hình v4 hợp lệ được nhận, `WRONG_GENDER` khi lệch, ô bắt buộc;
  - chuyển đổi mọi base cũ đúng bảng 4.5, giữ màu tóc và màu mắt, quy màu mắt gần nhất;
  - v1 và v2 đi tiếp lên v4;
  - bộ đồ đã lưu kiểu cũ được sửa khi liệt kê và khi áp;
  - `loadBodies` kiểm tệp;
  - phần quà điểm danh không ra `hairStyle` hay `skinColor`.
- **Unit, kit:**
  - `layersFor`: thứ tự lớp, mũ che tóc, tô da lên thân và mặt, tô tóc lên L20 và L60, tô mắt;
  - `hashChibi` đổi khi đổi giới tính, kiểu tóc hoặc tông da;
  - `defaultChibi` ổn định theo tên.
- **Unit, phòng thay đồ:**
  - nút Nữ | Nam đổi kiểu tóc tương ứng và bản cắt quần áo;
  - tab Kiểu tóc chỉ hiện kiểu đúng giới tính;
  - tab Màu da;
  - "Đang dùng" và bộ đồ đã lưu đủ trường;
  - Hoàn tác trả lại giới tính.
- **Pipeline:**
  - C1–C13 trên tranh tạm và tranh thật;
  - danh sách tệp chính xác (`avatar-pipeline.test.ts`);
  - ba bản manifest giống hệt nhau;
  - dung lượng.
- **E2e (không thêm tài khoản):**
  - đổi giới tính, kiểu tóc và màu da trong phòng thay đồ, lưu, rồi ghế ở bàn chơi vẽ đúng cấu hình (hash);
  - ảnh tô da, tóc, mắt giải mã được ở dạng `blob:`;
  - không có chữ đè chữ ở các màn đã đổi, tại 1920×940, 1366×768 và 375×812.
- **Ops pack và Lite e2e** chạy đầy đủ.
- **Bằng chứng nhìn bằng mắt:**
  - ảnh chụp bản build thật trước/sau cho mọi task giao diện;
  - ảnh tổng hợp nhân vật ở bước duyệt và khi hoàn thành;
  - soát plan độc lập trước khi code, review từng task, review toàn nhánh.

## 10. Rủi ro

| # | Rủi ro | Giảm thiểu |
|---|---|---|
| R1 | ChatGPT không vẽ được đầu trọc sạch hay 5 ngón rõ | Lộ ra ở bước duyệt (8.2); dự phòng "tóc sát da" rồi tách bằng mặt nạ; tối đa 3 vòng rồi hỏi người dùng |
| R2 | Đầu mới lệch vị trí hoặc cỡ làm mũ cũ không khớp | Phép kiểm C12 ngay khi ingest thân; thử khớp mũ × 8 kiểu tóc ở bước 3.5 |
| R3 | Tách tóc trước/sau sai | C13 + ảnh tổng hợp + mặt nạ vẽ tay ghi đè |
| R4 | Tông da cực sáng hoặc cực tối trông phẳng | Chọn các tông trên tranh thật, người dùng duyệt ở bước 2 |
| R5 | Chuyển đổi làm người chơi cũ mất ngoại hình | Bảng 4.5 + màu tự nhiên của kiểu tóc lấy từ base cũ + giữ màu tóc và màu mắt; unit test mọi base |
| R6 | Bộ đồ đã lưu kiểu cũ ghi lại base cũ | Sửa khi liệt kê và khi áp; server từ chối v3 |
| R7 | Dung lượng vượt 32 MB | Bỏ tranh cũ trước khi thêm; theo dõi `footprint.test.ts` từng lô |
| R8 | Quần áo cũ còn dính dáng cũ | Mọi bộ đều vẽ lại; C6 trên thân mới |
| R9 | Thời gian ChatGPT dài, gián đoạn giữa chừng | Registry giữ trạng thái từng ảnh (`next` / `collect`), làm tiếp được giữa các phiên; quy trình Chrome như Plan 12 |
| R10 | Đổi giao diện phòng thay đồ phá e2e và ops | Cập nhật cùng commit; e2e không thêm tài khoản; chạy ops pack |

## 11. Sửa các tài liệu trước

- **spec14:**
  - §4.2: khóa F01/M01 được thay bằng khóa thân mới (5.2);
  - mục "không làm: đổi màu da/tóc trong app": màu da nay được làm;
  - base là ảnh liền khối: nay thân, mặt và tóc là các lớp riêng.
- **Spec tô màu:** dòng "Không làm: màu da" được thay bằng mặt nạ da (5.5). `BaseDef.tint` chuyển thành tham số tô màu theo giới tính (4.3).
- **D01:**
  - §3.3 dáng: dáng đứng thả lỏng, có ngón tay;
  - §3.4 khung bất biến: giữ nguyên;
  - lớp L20/L60: nay chứa tóc thật.
- **D02:** §2.3 khóa nhân vật (5.2), bỏ "mitten-like hands".
- **`docs/avatar-2d.md`:** mô hình dữ liệu, các loại tranh mới, mặt nạ da, C12 và C13, quy trình registry.
