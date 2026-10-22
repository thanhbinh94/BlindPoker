# K6 — "Sự sống" cho nhân vật chibi: thở, chớp mắt, phản ứng, xoay (không vẽ dáng mới)

Spec thiết kế, 2026-10-22. Bổ sung cho SRS `2026-09-04-bind-poker-design.md` §15 (avatar) và `docs/avatar-2d.md`.
Trả lời K6 trong `docs/bug-log.md` §9 ("dáng đứng của nhân vật quá cố định nên cũng làm giảm hứng thú").

Nguồn: brainstorm 2026-10-22. Người dùng không chắc game cần dáng đứng mới; khuyến nghị được chấp nhận là **làm nhân vật
"sống" bằng chuyển động CSS trên các lớp PNG sẵn có**, không sinh thêm lớp nào, chưa vẽ dáng mới. Dáng thật (xoay
nghiêng, ngồi) vẫn là một spike riêng nếu sau đợt này kho đồ vẫn "chán".

## 1. Quyết định của người dùng (Q-table)

| # | Câu hỏi | Quyết định | Ngày |
|---|---|---|---|
| Q1 | Dáng đứng mới hay làm nhân vật "sống" bằng chuyển động? | **Gói "sự sống"** trước; dáng thật để sau (spike nếu cần) | 2026-10-22 |
| Q2 | Màn nào là chính? | **Kho đồ (Phòng thay đồ) và Cửa hàng** là chính; hồ sơ và hộp Quà chào mừng hưởng theo; **bàn chơi giữ nguyên** | 2026-10-22 |
| Q3 | Mức độ | Tinh tế, không nhảy múa liên tục; tắt hẳn khi hệ thống bật giảm chuyển động | 2026-10-22 (playback được xác nhận "đúng rồi") |

## 2. Hiện trạng trong mã (đối chiếu 2026-10-22)

- `packages/ui-kit/src/avatar2d/Chibi.tsx`: props `subject, expression, frame ('full' | 'head'), size, label, className,
  bounce, lazy`. Biểu cảm có sẵn: `neutral | happy | sad | surprised | closed | sleep` (`types.ts:8`). `bounce` là lớp
  CSS `chibiBounce` (`avatar2d.module.css:84-102`) dùng khi đến lượt ở bàn, đã có nhánh reduced-motion.
- **Đổi mặt không rẻ:** mỗi lớp mặt được key theo tên tệp (`Chibi.tsx:131`), nên đổi `expression` là mount một
  `ChibiLayer` mới; `useTintedLayer` luôn bắt đầu ở `null` và trả kết quả bất đồng bộ kể cả khi đã cache
  (`tinted.ts:202-227`), nên khung đầu vẽ mặt chưa nhuộm (sai màu da/mắt); mặt `closed` là ảnh `loading="lazy"`
  (`Chibi.tsx:59`) chưa tải. Vì thế chớp mắt và reo **không** được làm bằng cách đổi `expression` lúc chạy (xem 3.1).
- `useInView` (E1, `lazy.ts:9-32`) báo `true` một lần rồi ngắt observer: không dùng được để tạm dừng khi nhân vật rời
  khung nhìn; cần một observer riêng theo dõi liên tục.
- `.full { overflow: hidden }` (`avatar2d.module.css:29-32`) cắt mọi thứ vẽ sát mép hình.
- `transform`/`animation` trên gốc `.chibi` không ảnh hưởng `.headCrop` (phần trăm, không transform) hay mặt nạ tóc
  (mask trên từng ảnh), nhưng một animation đang chạy tạo stacking context và mất đi khi dừng; BP-29 đang đặt
  `isolation: isolate` cố định trên gốc `.chibi` (lỗi E4), nên thứ tự vẽ không còn phụ thuộc hoạt ảnh. K6 đi sau BP-29.
- Giảm chuyển động là toàn cục: `packages/ui-kit/src/theme/global.css:137` tắt mọi `animation` khi
  `prefers-reduced-motion: reduce`. Mọi hiệu ứng mới phải là `animation`/`transition` CSS để được quy tắc đó tắt, và
  có test.
- Bốn chỗ vẽ nhân vật ngoài bàn: `apps/normal-web/src/screens/wardrobe/StagePanel.tsx:67-69` (đã nhận `expression`),
  `screens/shop/ShopStage.tsx:51-53`, `screens/WelcomeDialog.tsx:161`, `screens/ProfileScreen.tsx:253,257`.
- Lớp PNG không tách tay/chân, nên không có "vẫy tay" thật; "xoay" không có góc nhìn sau lưng.

## 3. Thiết kế

### 3.1 Thành phần dùng chung: `<Chibi … live />` và `useChibiLife`

`Chibi` nhận prop mới `live?: 'idle' | 'off'` (mặc định `'off'`, nên bàn chơi và mọi chỗ cũ không đổi) và một prop
`react?: ChibiReaction | null` với `ChibiReaction = { kind: 'cheer' | 'wave' | 'spin'; key: number }` (đổi `key` để
chạy lại). Một hook `useChibiLife({ live, react, baseExpression })` trong ui-kit trả về `{ expression, className,
style }` mà `Chibi` áp lên gốc `.chibi` và lớp mặt:

| Hiệu ứng | Khi nào | Cách làm (CSS, không lớp mới) | Thông số mặc định |
|---|---|---|---|
| **Thở** | `live='idle'`, liên tục | `animation: chibiBreathe` trên gốc: `scale(1) → scale(1.015)` quanh `transform-origin: 50% 100%` | chu kỳ 4 s, ease-in-out, vô hạn |
| **Chớp mắt** | `live='idle'` | khi `live ≠ off`, `Chibi` mount **sẵn** ba lớp mặt (gốc, `closed`, `happy`) cùng lúc — cùng tệp, cùng nhuộm, không tải thêm lúc chạy — và chỉ đổi lớp nào hiện bằng `data-face` + CSS `opacity`; hook bật `data-face="closed"` 120 ms, cách nhau ngẫu nhiên 3–6 s; 10 % số lần chớp hai cái liền | không chớp khi biểu cảm gốc là `closed` hoặc `sleep`; chỉ bắt đầu khi cả ba lớp đã tải (`onLoad`/tint xong) |
| **Reo** (`cheer`) | mặc thử hoặc mua xong một món (Cửa hàng), mặc một món hoặc đổi màu trong tủ đồ, **chọn** một thẻ trong hộp Quà chào mừng | `data-face="happy"` 1,2 s + `animation: chibiHop` (nhún `translateY(-6%)` một lần, 420 ms) + 6 tia lấp lánh trong một lớp phủ **ngoài** `Chibi` (`.sparkleRing` do sân khấu vẽ quanh khung hình, không nằm trong `.full` để khỏi bị `overflow: hidden` cắt), 700 ms, không phụ thuộc ô món | một lần mỗi `key` |
| **Chào** (`wave`) | chạm/bấm vào nhân vật | `data-face="happy"` 800 ms + `animation: chibiTilt` (nghiêng gốc `rotate(-4deg)` rồi về, 600 ms) | không lặp nếu đang `cheer`/`spin` |
| **Xoay** (`spin`) | nút "Xoay" dưới sân khấu (tủ đồ, cửa hàng) | `animation: chibiSpin`: `scaleX(1) → scaleX(0.06) → scaleX(-1)` 500 ms rồi giữ trạng thái lật gương (`data-facing="left"`); bấm lần nữa xoay về | lật gương làm chữ trên trang phục (nếu có) ngược, chấp nhận (R2) |

Mọi keyframe nằm trong `avatar2d.module.css`; `prefers-reduced-motion` tắt tất cả nhờ quy tắc toàn cục, và hook cũng
**không đổi biểu cảm** (không chớp, không `happy` tự động) khi `matchMedia('(prefers-reduced-motion: reduce)')` khớp —
để người dùng tắt chuyển động không thấy mặt nhấp nháy. "Xoay" khi giảm chuyển động chỉ lật tức thì, không hoạt ảnh.

Hiệu năng: thở và chớp mắt chỉ chạy khi nhân vật **đang trong khung nhìn** (một hook mới `useOnScreen(ref)` giữ
`IntersectionObserver` theo dõi liên tục, khác `useInView` của E1 vốn ngắt sau lần thấy đầu) và tab đang hiện
(`document.visibilityState`), tối đa **một** nhân vật `live` mỗi màn (sân khấu); các thẻ, chân dung và lưới không `live`.

### 3.2 Nơi dùng

| Màn | `live` | `react` | Nút "Xoay" |
|---|---|---|---|
| Phòng thay đồ — `StagePanel` (frame `full` và `head`) | `idle` | `cheer` khi mặc/đổi một món hoặc màu (không khi chỉ đổi tab), `wave` khi bấm vào nhân vật | có, dưới sân khấu, cạnh nút có sẵn |
| Cửa hàng — `ShopStage` | `idle` | `cheer` khi mặc thử một thẻ và khi mua xong; `wave` khi bấm | có |
| Hộp Quà chào mừng — ba thẻ | `off` (ba hình cùng lúc) | thẻ đang chọn: `cheer` một lần **khi chọn** (không khi nhận: lúc đó thẻ đã khóa và hộp sắp đóng) | không |
| Hồ sơ — hình lớn | `idle` | `wave` khi bấm | không |
| Bàn chơi, sảnh (PlayerBar), ghế, thẻ, chân dung, GM | `off` | — | — |

Nhãn truy cập (R6): hình nhân vật **giữ nguyên** `role="img"` và tên hiện có ("Phòng thay đồ", `shop.figure`, tên người
chơi) — ba e2e và hai unit test tìm nó theo tên đó, và "Phòng thay đồ" là thuật ngữ ổn định. Khi bấm được, sân khấu
**bọc** hình trong một `button` kiểu trong suốt có `aria-label` = `avatar.greet` (vi "Nhân vật của bạn, bấm để chào" /
en "Your figure, tap to say hi"); không có chú thích nào hiện trên màn. Nút Xoay là `button` `avatar.turn` ("Xoay" /
"Turn"), đặt cạnh các nút sẵn có dưới sân khấu. Không có chữ nào khác.

### 3.3 Không làm

- Không dáng đứng mới, không lớp PNG mới, không tách chi, không góc nhìn sau lưng, không hoạt ảnh ở bàn chơi ngoài nhịp
  nảy sẵn có, không âm thanh, không hoạt ảnh trên thẻ lưới hay chân dung nhỏ, không lưu "hướng xoay" vào server.

## 4. Kiểm thử

- `useChibiLife` (jsdom, fake timers): thở bật/tắt theo `live` và khung nhìn; chớp mắt về đúng biểu cảm gốc, không chớp
  khi gốc là `closed`/`sleep`; `cheer` chạy một lần mỗi `key` và không chồng lên `wave`; khi `prefers-reduced-motion`
  khớp thì không đổi biểu cảm và không có lớp hoạt ảnh.
- `Chibi`: `live='off'` cho ra DOM **y hệt** hôm nay (snapshot/so sánh markup) — bàn chơi không đổi; `data-facing` sau
  "Xoay".
- CSS: test đọc `avatar2d.module.css` xác nhận mọi keyframe mới nằm dưới quy tắc reduced-motion toàn cục (hoặc test
  render với `matchMedia` giả lập `reduce` thấy `animation: none`).
- Web: StagePanel/ShopStage phát `cheer` đúng lúc (mặc, mặc thử, mua xong), `wave` khi bấm, nút Xoay đổi `data-facing`;
  WelcomeDialog chỉ `cheer` thẻ đang chọn; ProfileScreen `idle`.
- Ops: một case `@mobile` ở Cửa hàng: nhân vật có `data-live="idle"`, bấm Xoay đổi `data-facing`, mặc thử một thẻ thấy
  lớp `cheer` xuất hiện rồi biến mất; và một case với `reducedMotion: 'reduce'` (Playwright context) thấy không có lớp
  hoạt ảnh. Ảnh thật (Playwright) ở 1920×940, 1366×768, 375×812 cho tủ đồ và cửa hàng, cộng một ảnh giữa nhịp `cheer`.

## 5. Rủi ro

- Chuyển động liên tục làm mỏi mắt: biên độ nhỏ (1,5 % thở, chớp 120 ms), một nhân vật mỗi màn, tắt khi khuất.
- Hoạt ảnh trên gốc `.chibi` tạo stacking context khi chạy và mất khi dừng; thứ tự vẽ chỉ ổn định khi gốc có
  `isolation: isolate` cố định (BP-29). K6 hợp nhất sau BP-29 và test rằng `.chibi` vẫn `isolation: isolate`.
- Ba lớp mặt mount sẵn là ba ảnh thay vì một cho mỗi nhân vật `live`: chỉ một nhân vật mỗi màn nên chi phí là hai ảnh
  nhỏ; các thẻ và chân dung (`live='off'`) không đổi.
- `scaleX(-1)` lật cả khung (frame) và chữ: chấp nhận (R2), ghi known-limitations.
- Ảnh chụp e2e có thể bắt đúng khung giữa nhịp thở: `expectNoTextOverlap` không bị ảnh hưởng (không có chữ), nhưng test
  so màu/vị trí nên tắt `live` hoặc dùng context `reducedMotion: 'reduce'`.

## 6. Ruling của phiên (người dùng duyệt khi đọc)

- **R1** Mặc định `live='off'`; chỉ sân khấu của bốn màn bật. *Nếu sai:* thêm chỗ bật, không đổi mã lõi.
- **R2** "Xoay" là lật gương kèm ép hình; chữ/biểu tượng bất đối xứng trên trang phục bị lật — chấp nhận, ghi
  known-limitations. *Nếu sai:* cần dáng sau lưng thật (spike).
- **R3** Chớp mắt dùng biểu cảm `closed` sẵn có, 120 ms, bằng cách mount sẵn ba lớp mặt và đổi `opacity`; không sinh
  ảnh mắt nửa khép, không đổi `expression` lúc chạy.
- **R4** Giảm chuyển động tắt cả đổi mặt tự động, không chỉ animation.
- **R5** Hướng xoay không lưu; mở lại màn là quay mặt về trước.
- **R6** Hình nhân vật giữ `role="img"` và tên cũ; nút chào là một `button` bọc ngoài do sân khấu vẽ.
- **R7** Tia lấp lánh của `cheer` là lớp phủ quanh khung hình do sân khấu vẽ, không gắn với ô món; đổi màu cũng reo.
- **R8** Hộp Quà chào mừng chỉ reo khi chọn thẻ, không khi nhận.

## 7. Kiểm spec (2026-10-22)

Một kỹ sư độc lập (subagent opus) đọc spec và đối chiếu mã. Sai lệch đã sửa vào thân spec: đổi `expression` lúc chạy
mount lớp mới và nhuộm bất đồng bộ (khung đầu sai màu, mặt `closed` chưa tải) → chớp mắt/reo đổi `opacity` giữa ba lớp
mặt mount sẵn (R3); `useInView` ngắt sau lần thấy đầu → hook `useOnScreen` theo dõi liên tục; `avatar2d.module.css`
dòng 84–102; không có `isolation` trong CSS avatar hôm nay, BP-29 thêm nó và K6 đi sau. Ba câu hỏi của người xây
thành R6 (nút chào bọc ngoài, giữ `role="img"` và tên), R7 (lấp lánh quanh khung, không theo ô món) và R8 (chỉ reo khi
chọn thẻ chào mừng). Không còn câu hỏi cho người dùng ngoài việc duyệt R1–R8.
