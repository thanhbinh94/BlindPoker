# Quà điểm danh theo tháng — thiết kế

Ngày 2026-10-12. Đợt rà chữ ngày 10/10 (`docs/copy-review-2026-10-10.md` §7.2) tìm ra sáu món cực hiếm không có cách
nhận nào: điểm danh chỉ rút món thường và món hiếm, và không thành tựu nào thưởng chúng. Bản sửa ngày 12/10 (merge
`840f22d`) cho thẻ khóa của chúng thôi hứa sai ("Chưa có cách nhận món này"). Cùng ngày, người dùng chọn trao sáu món ấy
qua quà ngày 28, mỗi tháng một món từ 11/2026, và yêu cầu *"thiết kế điểm danh theo hướng có thể mở rộng quà tặng vật
phẩm trong tương lai, thay đổi theo tháng"*. Hướng thiết kế (một file lịch quà gồm phần mặc định và từng tháng) đã được
duyệt. Spec này viết đầy đủ hướng đó; mọi chỗ hướng thiết kế còn để ngỏ được ghi thành **đề xuất** trong bảng quyết định
(mục 2).

Spec này sửa `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §13.2 và §19.2 (mục 9 dưới đây).

## 1. Mục tiêu

**Trước thay đổi:**
- cột vật phẩm của điểm danh nằm trong code: `itemRuleForDay` trong `apps/normal-server/src/economy/daily-rules.ts`
  (ngày 7 rút một món thường, ngày 14 và 21 rút một món hiếm, ngày 28 tặng `badge_monthly` + `title_devoted`), còn cặp
  quà ngày 28 là hằng số `DAILY_FIXED_ITEM_IDS`. Muốn đổi quà của một tháng thì phải sửa code rồi deploy;
- tháng nào cũng giống tháng nào: lịch 31 ngày server gửi cho client không bao giờ đổi;
- sáu món cực hiếm `head_tophat01`, `face_eyepatch01`, `aura_lightning01`, `frame_gold`, `haircolor_lavender01`,
  `eyecolor_gold01` không có cách nhận;
- client giữ một bản chép của cặp quà ngày 28 (`DAILY_FIXED_ITEM_IDS` trong `apps/normal-web/src/screens/catalog.ts`)
  và nhận ra ô ngày 28 qua id `badge_monthly` (`markerOf` trong `apps/normal-web/src/screens/DailyScreen.tsx`).

**Sau thay đổi:**
- cột vật phẩm là dữ liệu: `apps/normal-server/data/daily-gifts.json`, gồm một lịch mặc định và các tháng `YYYY-MM`
  ghi đè từng ngày. Người vận hành thêm hay đổi quà của một tháng bằng cách sửa file rồi khởi động lại server, không
  sửa code, không đụng database;
- tháng 10/2026 giữ nguyên. Từ 11/2026, quà ngày 28 mỗi tháng có thêm một trong sáu món cực hiếm, theo thứ tự người
  dùng chọn;
- file sai thì server không khởi động và nói rõ sai ở đâu;
- lịch trên trang "Điểm danh" là lịch của tháng hiện tại và gọi tên từng món của mọi ngày có quà định sẵn ("Huy hiệu
  tháng + Chuyên cần + Mũ chóp quý ông");
- thẻ khóa trong tủ đồ ghi rõ tháng tặng món đó ("Quà điểm danh ngày 28 tháng 11/2026"), và client không còn giữ bản
  chép danh sách quà nào.

## 2. Quyết định

Cột "Ai quyết": **Người dùng** là quyết định bắt buộc (12/10); **Đề xuất** là lựa chọn của spec này cho chỗ hướng thiết
kế đã duyệt còn để ngỏ, chờ người dùng xem lại.

| # | Câu hỏi | Chọn | Ai quyết |
|---|---|---|---|
| Q1 | Sáu món cực hiếm chưa có cách nhận sẽ trao bằng cách nào | Quà điểm danh ngày 28, mỗi tháng một món, từ 11/2026: 11/2026 `head_tophat01` → 12/2026 `face_eyepatch01` → 01/2027 `aura_lightning01` → 02/2027 `frame_gold` → 03/2027 `haircolor_lavender01` → 04/2027 `eyecolor_gold01` | Người dùng |
| Q2 | Tháng 10/2026 (đang diễn ra) | Giữ lịch hiện tại | Người dùng |
| Q3 | Mở rộng về sau | Lịch quà theo tháng là dữ liệu người vận hành tự sửa, không cần sửa code hay database | Người dùng |
| Q4 | Cấu trúc | `daily-gifts.json` gồm `default` (đúng như `itemRuleForDay` hôm nay) và `months` theo khóa `YYYY-MM`; mỗi ngày là `{ "draw": "common" \| "rare" }` hoặc `{ "fixed": [itemId, …] }`; kiểm tra lúc khởi động; lần nhận, lịch và tủ đồ đọc theo tháng | Người dùng (duyệt hướng thiết kế) |
| Q5 | Luật của một tháng *thay* hay *cộng thêm* vào luật mặc định của cùng ngày | **Thay**. Luật của tháng cho một ngày thay hẳn luật mặc định của ngày đó. Danh sách `fixed` của tháng là danh sách đầy đủ, phải ghi lại cả `badge_monthly` và `title_devoted`. Nhờ vậy, chỉ cần đọc một chỗ là biết ngày đó tặng gì; một tháng muốn bỏ cặp quà ấy cũng làm được | Đề xuất |
| Q6 | Những kiểu luật được phép | Chỉ `draw` (mức `common` hoặc `rare`) và `fixed`. Không cho rút mức `epic`: mọi món cực hiếm đều đã được hứa ở một thành tựu hoặc trong lịch quà, nên một lượt rút cực hiếm sẽ không còn món nào để rút và lần nào cũng trả 10.000 điểm thay. Chưa có kiểu "bỏ quà của ngày mặc định" vì chưa ai cần; khi cần thì thêm một kiểu mới | Đề xuất |
| Q7 | Kiểm tra những gì lúc khởi động | Id có trong catalogue; không phải món mọi người chơi đều có sẵn (`isDefault`, `free`); ngày là số nguyên 1–31 viết không có số 0 ở đầu, và không vượt số ngày của tháng đó; không trùng id trong một ngày, cũng không trùng giữa hai ngày của cùng một tháng (tính cả các ngày lấy từ mặc định); mức rút hợp lệ; khóa tháng đúng dạng `YYYY-MM`; không có khóa lạ ở cấp ngoài cùng của file; có `default` | Đề xuất (mở rộng danh sách người dùng đưa ra) |
| Q8 | Món có tên trong lịch có bị loại khỏi lượt rút ngẫu nhiên không | Có: mọi id nằm trong bất kỳ danh sách `fixed` nào, kể cả của tháng đã qua hay tháng chưa tới, giống cặp quà ngày 28 hôm nay | Đề xuất |
| Q9 | Lịch người chơi thấy vào lúc chuyển tháng | Lịch là lịch của tháng hiện tại (theo `ECONOMY_TIMEZONE`) tại lúc mở trang; lần nhận dùng tháng của chính lần nhận đó. `DailyStatus` có thêm trường `month` | Đề xuất |
| Q10 | Nhãn của ô ngày có quà định sẵn | Tên từng món, nối bằng " + ", theo thứ tự trong file: "Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông". Khác với ví dụ đã duyệt ("Huy hiệu + danh hiệu tháng + Mũ chóp quý ông"): cụm "Huy hiệu + danh hiệu tháng" chỉ đúng khi có đủ cặp quà đó, nên client phải nhận ra cặp quà qua id, mà đó chính là kiểu chép dữ liệu spec này muốn bỏ | Đề xuất |
| Q11 | Người chơi dùng điện thoại (không có tooltip) đọc tên quà ở đâu | Ở phần chú thích dưới lịch: mỗi ngày có quà định sẵn có một dòng "Ngày 28 tháng 11/2026: Huy hiệu tháng + Chuyên cần + Mũ chóp quý ông", thay cho dòng cố định "Huy hiệu + danh hiệu tháng". Dòng "Vật phẩm thường" và dòng "Vật phẩm hiếm" chỉ hiện khi tháng đó có ngày rút ở mức tương ứng | Đề xuất |
| Q12 | Tủ đồ lấy lịch quà từ đâu | Thêm `dailyGifts` vào `GET /api/catalog/items`. Tủ đồ vốn đã gọi đúng endpoint này, và dữ liệu giống nhau cho mọi người, nên không phải thêm route hay request nào. Server tính sẵn lần tặng đầu tiên từ tháng hiện tại trở đi cho từng món, vì client không biết múi giờ kinh tế | Đề xuất |
| Q13 | Chữ trên thẻ khóa | Món của lịch mặc định: "Quà điểm danh ngày 28" (khóa cũ `wardrobe.hint.dailyFixed`, nay thành mẫu có `{{day}}`). Món của một tháng cụ thể (tháng này hoặc sau này): "Quà điểm danh ngày 28 tháng 11/2026" (khóa mới `wardrobe.hint.dailyMonth`, tháng viết `MM/YYYY`). Món chỉ có ở tháng đã qua: giữ "Chưa có cách nhận món này". Không viết "… (đã qua)", vì câu đó gợi ý món sẽ được tặng lại, trong khi người vận hành chưa quyết định việc ấy | Đề xuất |
| Q14 | Món vừa có trong lịch mặc định vừa có trong một tháng | Thẻ ghi theo lịch mặc định (không kèm tháng), vì tháng nào món đó cũng có | Đề xuất |
| Q15 | Bản Lite | Ngoài phạm vi: Lite chỉ trả cột điểm và không có kho đồ (`apps/lite/server/src/economy/` không có vật phẩm; §13.3 spec gốc) | Đề xuất (đã kiểm code) |
| Q16 | Kiểm tra file trước khi khởi động lại | Người vận hành chạy `daily-gifts.test.ts`: test nạp chính file đang có và đối chiếu với catalogue thật. Không thêm lệnh CLI mới | Đề xuất |
| Q17 | e2e | Bộ e2e không chỉnh được đồng hồ của server, nên lần nhận quà ngày 28/11/2026 được kiểm ở mức service và HTTP (PGlite, `setNow` của harness). Test e2e Normal có sẵn "điểm danh hằng ngày" được thêm một bước kiểm tra dòng chú thích ngày 28 trên bản build thật, không đăng ký thêm tài khoản nào | Đề xuất |

## 3. Định nghĩa

- **Lịch quà**: file `apps/normal-server/data/daily-gifts.json`. Cột điểm không nằm trong file này: điểm của từng bậc
  vẫn là `DAILY_REWARD_POINTS` trong `@bp/core` (§13.2 spec gốc), dùng chung với Lite.
- **Bậc**: số ngày trong chuỗi điểm danh tại lần nhận (1–31; §13.1). Khóa ngày trong lịch quà là bậc, không phải ngày
  dương lịch. Chuỗi luôn bắt đầu lại vào đầu tháng, nên bậc 28 rơi vào một ngày từ 28 đến 31 của tháng, tuỳ chuỗi bắt
  đầu ngày nào.
- **Mặc định** (`default`): luật cho từng bậc, áp cho mọi tháng không ghi đè bậc đó. Giống hệt cột vật phẩm hôm nay:
  bậc 7 rút một món thường; bậc 14 và 21 rút một món hiếm; bậc 28 tặng `badge_monthly` + `title_devoted`.
- **Mục tháng** (`months["YYYY-MM"]`): các bậc mà tháng đó ghi đè. Bậc nào tháng không ghi thì theo mặc định.
- **Luật của một bậc**: `{ "draw": "common" | "rare" }` rút ngẫu nhiên một món người chơi chưa có ở mức đó (như hiện
  nay, kèm 10.000 điểm thay khi không còn món nào); `{ "fixed": [id, …] }` tặng đúng những món này, bỏ qua món người
  chơi đã có và không trả điểm thay.
- **Tháng của lần nhận**: `monthKey(now, ECONOMY_TIMEZONE)` tại lúc nhận (`daily-rules.ts`).
- **Quà có tên**: món nằm trong một danh sách `fixed`.
- **Lần tặng đầu tiên từ tháng M**: với mỗi quà có tên, đó là bậc và tháng sớm nhất (từ M trở đi) có ghi món ấy. Nếu
  món nằm trong lịch mặc định thì tháng là "mọi tháng" (`null`).

## 4. Luật

### 4.1 Lịch quà

1. File là một object JSON có đúng hai khóa: `default` (bắt buộc) và `months` (không bắt buộc, mặc định là `{}`).
   File giao kèm bản này:

   ```json
   {
     "default": {
       "7": { "draw": "common" },
       "14": { "draw": "rare" },
       "21": { "draw": "rare" },
       "28": { "fixed": ["badge_monthly", "title_devoted"] }
     },
     "months": {
       "2026-11": { "28": { "fixed": ["badge_monthly", "title_devoted", "head_tophat01"] } },
       "2026-12": { "28": { "fixed": ["badge_monthly", "title_devoted", "face_eyepatch01"] } },
       "2027-01": { "28": { "fixed": ["badge_monthly", "title_devoted", "aura_lightning01"] } },
       "2027-02": { "28": { "fixed": ["badge_monthly", "title_devoted", "frame_gold"] } },
       "2027-03": { "28": { "fixed": ["badge_monthly", "title_devoted", "haircolor_lavender01"] } },
       "2027-04": { "28": { "fixed": ["badge_monthly", "title_devoted", "eyecolor_gold01"] } }
     }
   }
   ```

2. Luật của bậc `d` trong tháng `M` là `months[M][d]` nếu có; nếu không thì là `default[d]` nếu có; nếu cả hai đều
   không có thì bậc đó không có vật phẩm (Q5).
3. File được kiểm tra lúc khởi động theo danh sách ở Q7. Nếu file sai, `buildApp` ném lỗi và server dừng với thông báo
   `invalid daily gift schedule <đường dẫn>: <vấn đề>`, ví dụ `… month 2026-11 day 28 grants head_tophat02, which is
   not in the item catalogue`. Nếu file không đọc được hoặc không phải JSON, thông báo là `could not read daily gift
   schedule <đường dẫn>: …`.
4. Các tháng đã qua được để nguyên trong file như một bản ghi lịch sử. Lần nhận không bao giờ đọc lại chúng, vì tháng
   của lần nhận luôn là tháng hiện tại.

### 4.2 Lần nhận

1. Bậc được tính như hiện nay (§13.1). Luật của bậc lấy theo tháng của lần nhận (4.1.2).
2. `draw`: như hiện nay. Lượt rút chọn một món chưa có trong `DAILY_DRAW_SLOTS`, đúng mức yêu cầu; nếu không còn món
   nào thì cộng 10.000 điểm, ghi dòng `daily_item_fallback` cùng `refId` với lần nhận.
3. `fixed`: như hiện nay. Món người chơi đã có thì bỏ qua và không trả điểm thay. Ví dụ: người đã nhận cặp quà ngày 28
   của tháng 10 thì đến ngày 28/11 chỉ nhận thêm "Mũ chóp quý ông", còn người lần đầu đủ bậc 28 vào tháng 11 nhận cả
   ba món.
4. Lượt rút ngẫu nhiên không bao giờ ra: mọi id nằm trong bất kỳ danh sách `fixed` nào (Q8), và mọi `reward.itemId` của
   thành tựu (như hiện nay).
5. Biên nhận (`items`) liệt kê đúng những món vừa được trao.

### 4.3 Lịch trên trang "Điểm danh"

1. `GET /api/rewards/daily` (và khối `daily` của `GET /api/me`) trả về lịch của tháng hiện tại, kèm trường mới `month`
   (`YYYY-MM`). Mỗi ô có `day`, `points`, `item` (như hiện nay: mức rút với bậc rút, id đầu tiên với bậc có quà định
   sẵn, `null` với bậc chỉ có điểm), và trường mới `items`: mọi món của bậc có quà định sẵn, theo thứ tự trong file;
   ở các bậc khác đây là mảng rỗng.
2. Ô của bậc rút có biểu tượng quà màu theo mức, nhãn "Vật phẩm thường" hoặc "Vật phẩm hiếm" (như hiện nay). Ô của bậc
   có quà định sẵn có biểu tượng màu vàng, nhãn (tooltip, và chữ dành cho trình đọc màn hình) là tên các món nối bằng
   " + " (Q10). Mọi bậc có quà định sẵn đều ghi tên quà, không riêng bậc 28.
3. Chú thích dưới lịch (Q11) gồm: "Vật phẩm thường" và "Vật phẩm hiếm", mỗi dòng chỉ hiện nếu tháng có bậc rút ở mức đó;
   rồi mỗi bậc có quà định sẵn một dòng "Ngày {bậc} tháng {MM/YYYY}: {tên các món}" (tiếng Anh: "Day {day} of
   {MM/YYYY}: …").
4. Lúc chuyển tháng (Q9): trang mở lúc 23:59 ngày 31/10 hiện lịch tháng 10; từ 00:00 ngày 01/11 (giờ
   `ECONOMY_TIMEZONE`), lần tải tiếp theo hiện lịch tháng 11. Nếu bấm nhận trên trang cũ sau nửa đêm, lần nhận là bậc 1
   của tháng 11 và được trả theo lịch tháng 11; ngay sau khi nhận, trang tải lại lịch (như hiện nay). Chuỗi không bao
   giờ kéo dài qua hai tháng (§13.1), nên mỗi bậc luôn thuộc đúng tháng của lần nhận.
5. Tab mở từ trước khi deploy vẫn chạy bundle cũ: bundle cũ bỏ qua `items` và `month`, nên ô ngày 28 vẫn hiện "Huy hiệu +
   danh hiệu tháng" theo `item` = `badge_monthly` cho tới khi trang được tải lại (`stale-chunk.ts` lo phần đó).

### 4.4 Gợi ý trên thẻ khóa trong tủ đồ

1. `GET /api/catalog/items` trả thêm `dailyGifts`: `[{ itemId, day, month }]`, là lần tặng đầu tiên của mỗi quà có tên,
   tính từ tháng hiện tại trở đi (Q12, Q14). `month` là `null` với món của lịch mặc định. Món chỉ có ở tháng đã qua
   không có trong danh sách.
2. Thứ tự chọn gợi ý (`hintFor`):
   (a) nếu có thành tựu thưởng món đó: tên thành tựu (như hiện nay);
   (b) nếu món có trong `dailyGifts`: "Quà điểm danh ngày {day}" khi `month = null`, hoặc "Quà điểm danh ngày {day}
   tháng {MM/YYYY}" khi có tháng;
   (c) nếu là món thường hoặc hiếm ở một ô có thể rút: "Có thể nhận từ quà điểm danh (thường)" hoặc "(hiếm)" (như hiện
   nay);
   (d) các trường hợp còn lại: "Chưa có cách nhận món này".
3. Ví dụ, ngày 12/10/2026: "Mũ chóp quý ông" ghi "Quà điểm danh ngày 28 tháng 11/2026"; "Khung vàng" ghi "… tháng
   02/2027"; "Huy hiệu tháng" ghi "Quà điểm danh ngày 28"; "Chuyên cần" ghi tên thành tựu "Chuỗi 28 ngày", vì thành tựu
   được ưu tiên. Từ 01/12/2026, "Mũ chóp quý ông" ghi "Chưa có cách nhận món này", trừ khi người vận hành xếp món đó vào
   một tháng sau.
4. Bản chép `DAILY_FIXED_ITEM_IDS` trong `catalog.ts` bị bỏ. `DAILY_DRAW_SLOTS` và `DAILY_DRAW_RARITIES` phía client giữ
   nguyên, vì Q6 vẫn chỉ cho rút ở mức thường và hiếm.

### 4.5 Người vận hành thêm hay đổi quà của một tháng

1. Sửa `apps/normal-server/data/daily-gifts.json` ở bản checkout chính (làm trên một nhánh rồi gộp như mọi thay đổi
   khác). Ví dụ, tặng lại "Khung vàng" vào ngày 28 tháng 05/2027:
   `"2027-05": { "28": { "fixed": ["badge_monthly", "title_devoted", "frame_gold"] } }`. Nếu tặng một món mới, phải thêm
   món đó vào `items.json` và đặt tên ở cả hai file ngôn ngữ trước (`docs/normal-server.md`, mục "Adding a cosmetic
   item").
2. Chạy `pnpm --filter @bp/normal-server exec vitest run src/economy/daily-gifts.test.ts`. Test này nạp chính file vừa
   sửa cùng catalogue thật; nếu file sai, test báo đúng chỗ sai (Q16).
3. Khởi động lại server. Trên host LAN: đợi `/health` báo `"rooms":0`, rồi chạy `stop.ps1` và `run.ps1 -NoMigrate`. Nếu
   chỉ sửa file này thì không cần build lại, vì server đọc thư mục `data/` từ đĩa lúc khởi động. Với Docker, `data/`
   nằm trong image, nên phải chạy `up -d --build`.
4. Không cần migration: lịch quà không nằm trong database, và bảng `items` đã có mọi món của catalogue (`seed` chạy lúc
   khởi động).

## 5. Thay đổi kỹ thuật

### 5.1 `@bp/normal-server`

- `data/daily-gifts.json` (mới): như 4.1.1.
- `src/economy/daily-gifts.ts` (mới): `parseDailyGifts(raw, catalog, source)` và `loadDailyGifts(catalog, path?)` trả
  về `DailyGiftSchedule { itemRuleForDay(day, month), fixedItemIds(), noticesFrom(month) }`;
  `DailyGiftNotice { itemId, day, month: string | null }`.
- `src/economy/daily-rules.ts`: bỏ `DAILY_FIXED_ITEM_IDS`; bỏ `itemRuleForDay(day)` (nay là method của lịch quà và
  nhận thêm tháng); `itemMarkerForDay(day)` đổi thành `itemMarker(rule)`; `CalendarEntry` có thêm `items: string[]`;
  `dailyCalendar(gifts, month)`.
- `src/economy/economy-service.ts`: deps có thêm `gifts: DailyGiftSchedule` (bắt buộc); `applyItemRule` nhận tháng của
  lần nhận; danh sách loại khỏi lượt rút gồm `gifts.fixedItemIds()` và phần thưởng của thành tựu; `dailyStatus` trả
  về `month` và lịch của tháng đó; thêm method `dailyGiftNotices(now?)`.
- `src/inventory/items.ts`: bỏ bước kiểm "catalogue có cặp quà ngày 28". `loadDailyGifts` kiểm mọi id trong lịch quà,
  chặt hơn bước cũ.
- `src/app.ts`: gọi `loadDailyGifts(catalog)` ngay sau `loadAchievements` và trước `seed`; truyền kết quả vào economy;
  thêm `AppServices.gifts`.
- `src/http/routes-catalog.ts`, `src/http/routes.ts`: `GET /api/catalog/items` trả về `{ items, dailyGifts }`.
- `scripts/build.mjs`, `test/build.test.ts`: thêm `data/daily-gifts.json` vào danh sách file đi kèm bản build.
- Không có migration.

### 5.2 `@bp/normal-web`

- `api.ts`: thêm `CalendarEntryDto.items`, `DailyStatusDto.month`, `DailyGiftNoticeDto` và
  `CatalogItemsDto { items, dailyGifts? }`.
- `screens/DailyScreen.tsx`: `markerOf(entry, t)` trả về `{ kind: 'common' | 'rare' | 'fixed', label }`; thêm
  `giftNames`; phần chú thích đổi theo tháng. `screens/normal.module.css`: `.calGift[data-kind='monthly']` đổi thành
  `'fixed'`.
- `screens/format.ts`: `formatMonthKey('2026-11')` trả về `11/2026`.
- `screens/catalog.ts`: `hintFor(item, { achievements, gifts }, t)`; bỏ `DAILY_FIXED_ITEM_IDS`.
  `wardrobe/{ItemTab,ColourTab,HairStyleTab}.tsx`: prop `achievements` đổi thành `hints`; `WardrobeScreen.tsx` dựng
  `hints` từ hai danh sách nó đã tải.
- `locales/{vi,en}/normal.json`:

  | Khóa | vi | en |
  |---|---|---|
  | `daily.marker.fixedDay` (mới) | Ngày {{day}} tháng {{month}}: {{items}} | Day {{day}} of {{month}}: {{items}} |
  | `wardrobe.hint.dailyFixed` (sửa) | Quà điểm danh ngày {{day}} | The day-{{day}} check-in gift |
  | `wardrobe.hint.dailyMonth` (mới) | Quà điểm danh ngày {{day}} tháng {{month}} | The day-{{day}} check-in gift of {{month}} |
  | `daily.marker.monthly` (bỏ) | Huy hiệu + danh hiệu tháng | Monthly badge + title |

  Với ngày 28, `wardrobe.hint.dailyFixed` hiện ra y như cũ. `{{month}}` luôn ở dạng `MM/YYYY`, giống nhau ở hai ngôn ngữ.

### 5.3 Không đổi

`@bp/core` (điểm của từng bậc vẫn là `DAILY_REWARD_POINTS`), `@bp/server-kit`, `@bp/ui-kit`, `@bp/http-kit`, bản Lite
(Q15). Database không đổi.

## 6. Lỗi và trường hợp biên

- File sai, thiếu file, hoặc JSON hỏng: server không khởi động (`buildApp` ném lỗi, `main.ts` in lỗi ra stderr và
  thoát với mã 1). Trên host LAN, dòng lỗi nằm trong `normal.err.log`. Không có chế độ "chạy tiếp bằng lịch mặc định",
  vì một lịch sai mà không ai biết nghĩa là quà đã hứa nhưng không được trao.
- Một món bị bỏ khỏi `items.json` trong khi lịch quà vẫn nhắc tới: server không khởi động cho tới khi sửa lịch. Đây là
  điều mong muốn, vì lỗi hiện ra ngay lúc deploy thay vì đến ngày 28 mới lộ.
- Đổi id của một món (`item-aliases.json`): lịch quà phải ghi id mới, vì loader không đọc alias.
- Món trong lịch mà người chơi đã có: không trao lại, không trả điểm thay (như hiện nay).
- Bậc 28 vào tháng Hai của năm không nhuận: phải điểm danh từ ngày 1, không bỏ ngày nào (hướng dẫn người chơi đã ghi).
  Vì vậy "Khung vàng" (02/2027) là món khó nhận nhất.
- Đổi `ECONOMY_TIMEZONE`: ranh giới tháng dời theo múi giờ mới, giống chuỗi điểm danh.
- Những ngày 29–31 của một tháng có quà định sẵn ở bậc 28: thẻ trong tủ đồ vẫn ghi tháng đó cho tới hết tháng. Điều này
  đúng, vì người bắt đầu chuỗi muộn vẫn có thể đạt bậc 28 vào ngày 29–31 (mục 3).
- Hai tab cùng mở: một tab nhận quà, tab kia vẫn hiện lịch cũ. Như hiện nay, tab kia nhận `ALREADY_CLAIMED` rồi tải lại.
- Bundle cũ chạy với server mới: xem 4.3.5; tủ đồ của bundle cũ vẫn dùng bản chép cũ (cặp quà ngày 28) cho tới khi tải
  lại. Bundle mới chạy với server cũ không xảy ra trên host LAN, vì cả hai đến từ cùng một bản build; nếu có xảy ra thì
  `dailyGifts` vắng mặt được hiểu là danh sách rỗng.
- Một tháng trong file ghi bậc 29–31 mà tháng đó ít ngày hơn: file bị từ chối (Q7), vì bậc đó không bao giờ đạt tới.

## 7. Bảo toàn điểm

Không đường tiền nào thay đổi. Cột điểm vẫn nằm trong core; lịch quà chỉ quyết định vật phẩm. Khoản 10.000 điểm thay
vẫn chỉ dành cho bậc rút và vẫn ghi `daily_item_fallback` qua `creditWithin` như hiện nay; quà định sẵn không bao giờ
trả điểm. Không cần test bảo toàn mới; các test hiện có (`economy-service.test.ts`, test bảo toàn của server-kit) giữ
nguyên.

## 8. Kiểm thử

- normal-server, `daily-gifts.test.ts` (mới):
  - file giao kèm: tháng 10/2026 như cũ; sáu tháng 11/2026–04/2027 đúng món, đúng thứ tự;
  - đọc luật theo tháng và theo mặc định; luật của tháng thay hẳn luật mặc định của ngày đó;
  - danh sách mọi id có tên; lần tặng đầu tiên tính từ một tháng;
  - từ chối: id lạ; món ai cũng có; ngày ngoài 1–31 hoặc vượt số ngày của tháng; trùng id trong một ngày hoặc trong một
    tháng; mức rút lạ, hoặc luật không phải `draw` cũng không phải `fixed`; khóa tháng sai dạng; khóa lạ; thiếu
    `default`; file không đọc được.
- `daily-rules.test.ts`: lịch 31 ngày của một tháng có trường `items`.
- `economy-service.test.ts`:
  - ngày 28 của 11/2026 trao ba món, của 10/2026 trao hai món; người đã có cặp quà chỉ nhận món thứ ba, và không được
    trả điểm thay;
  - nhận lại vào tháng 12 (theo mặc định) không trao gì, không trả gì;
  - `dailyStatus` theo tháng, kiểm cả phút cuối tháng 10 và phút đầu tháng 11;
  - `dailyGiftNotices`.
- `routes-rewards.test.ts`: lịch qua HTTP có `month` và `items`; một lần nhận ngày 28/11/2026 qua HTTP với file giao kèm
  trao đủ ba món. `app.test.ts`: `/api/catalog/items` có `dailyGifts` theo tháng.
- `items.test.ts`: bỏ test "catalogue thiếu cặp quà ngày 28" (việc kiểm này đã chuyển sang `daily-gifts.test.ts`).
- normal-web:
  - `DailyScreen.test.tsx`: ô lịch và chú thích ghi tên quà kèm tháng; bậc có quà định sẵn không phải ngày 28; chú thích
    chỉ có các mức rút mà tháng đó có;
  - `catalog.test.ts`: thẻ ghi tháng, tháng đã qua, món của lịch mặc định, thành tựu được ưu tiên;
  - `WardrobeScreen.test.tsx`: thẻ khóa ghi tháng;
  - `format.test.ts`;
  - `locales.test.ts`: test có sẵn, đảm bảo hai ngôn ngữ đủ khóa.
- e2e Normal "điểm danh hằng ngày": kiểm dòng chú thích ngày 28 trên bản build thật (không đăng ký thêm tài khoản). Không
  có e2e cho lần nhận ngày 28, vì bộ e2e không chỉnh được đồng hồ của server (Q17).
- Ảnh chụp trang "Điểm danh" (giả lập tháng 11 bằng `page.route`) và thẻ "Mũ chóp quý ông" trong tủ đồ, ở 1920×940,
  1366×768 và 375×812.

## 9. Tài liệu phải sửa

- SRS `docs/superpowers/specs/2026-09-04-bind-poker-design.md`: §13.2 (cột Item đọc từ lịch quà; dòng 28; đoạn về những
  món lượt rút không bao giờ ra; thêm đoạn "Lịch quà theo tháng") và §19.2 (`/api/catalog/items`,
  `/api/rewards/daily`). Mỗi chỗ sửa ghi "(2026-10-12, spec monthly-daily-gifts)".
- `docs/normal-server.md`: mục mới "Changing the daily gifts"; sơ đồ module; thứ tự nối trong `buildApp`; danh sách lỗi
  khiến catalogue bị từ chối.
- `docs/normal-web.md`: trang Điểm danh, gợi ý trong tủ đồ, mục "How it is won".
- `docs/player-guide.md`: §2 và đoạn "Cách nhận đồ".
- `docs/operation-test-plan.md`: các dòng I-05, J-10, N-06.
- `deploy/normal-windows/README.md` (mục mới 9c) và `docs/deployment-normal.md` (§5).
- `docs/known-limitations.md`: đổi lịch quà cần khởi động lại.
- `docs/copy-review-2026-10-10.md`: ghi chú các khóa đã đổi.
- `docs/test-matrix.md` (4 dòng) và `docs/acceptance-checklist.md` (P22.1, P22.2), cùng hai con số chốt trong
  `tooling/arch/acceptance-links.test.ts` và câu nhắc hai con số ấy trong `CLAUDE.md`.
- `CHANGELOG.md`: viết lúc gộp nhánh.

## 10. Ngoài phạm vi

- Bản Lite (không có vật phẩm).
- Đổi cột điểm theo tháng: điểm vẫn là hằng số của core, Lite dùng chung.
- Quà riêng cho từng người; sự kiện theo ngày dương lịch thay vì theo bậc; thông báo đẩy khi có quà tháng mới.
- Trang quản trị để sửa lịch quà; nạp lại lịch mà không khởi động lại server.
- Rút món cực hiếm; kiểu luật "bỏ quà của ngày mặc định".
- Trao bù cho người đã đạt bậc 28 ở các tháng trước.

## 11. Triển khai

Một plan (Plan 22, superpowers:subagent-driven-development), làm theo thứ tự:
1. lịch quà và loader (server);
2. lần nhận, lịch và API (server);
3. trang Điểm danh và tủ đồ (web);
4. tài liệu.

Gộp vào `main` bằng `--no-ff`, chạy `pnpm build:normal`, rồi khởi động lại host LAN với `-NoMigrate` (không có migration).
**Bản mới phải chạy trên host trước ngày 01/11/2026**, để lịch tháng 11 và thẻ "Mũ chóp quý ông" hiện đúng ngay từ đầu
tháng; chậm nhất là trước ngày 28/11/2026, để lần nhận bậc 28 trao được món. Lite không đổi (vẫn build lại trong full
gate, nhưng không giao bản mới).
