# Just a Normal Poker — Thiết kế lại màn Tủ đồ ("Phòng thay đồ")

Ngày 2026-09-26. Góp ý F4 trong `docs/bug-log.md`. Người dùng chọn Hướng 1 trong mockup `docs/wardrobe-redesign/mockup-desktop.png` (bản điện thoại: `mockup-mobile.png` cùng thư mục; dựng bằng ảnh thật của game). Mockup là chuẩn về hình; spec này chốt hành vi và những điểm mockup để ngỏ.

## 1. Mục tiêu

Màn tủ đồ nhìn như một phòng thay đồ của game: nhân vật lớn, luôn thấy mình đang mặc gì, chọn món nhanh, không có hàng tab gãy dòng hay khoảng trống vô nghĩa. Không đổi API, dữ liệu hay luật sở hữu — chỉ đổi giao diện và cách thao tác trên dữ liệu đã có.

## 2. Phạm vi

- **Làm:** bố cục mới cho `apps/normal-web/src/screens/wardrobe/*`; token màu độ hiếm trong ui-kit; chuỗi i18n mới (vi/en); test đơn vị và e2e cập nhật theo nhãn mới; ảnh chụp kiểm tra desktop và điện thoại, cả chủ đề tối và sáng.
- **Không làm:** đổi server, `/api/*`, cấu hình avatar, luật khoá món; hiệu ứng chuyển động ngoài hover/focus; kéo-thả; tìm kiếm theo tên; sắp xếp tuỳ chọn (thứ tự cố định, §5.4).

## 3. Bố cục

### 3.1 Desktop (≥ 1024 px)

- **Đầu trang** một hàng: tiêu đề "Tủ đồ"; nhãn "● Có thay đổi chưa lưu" (chỉ khi bản nháp khác bản đã lưu); bên phải nút "Hoàn tác" (ghost, tắt khi không có thay đổi) và "Lưu tủ đồ" (vàng). Thông báo lỗi và "Đã lưu tủ đồ." hiện ngay dưới hàng này.
- **Hai cột** `360px | 1fr`, khoảng cách 28 px.
- **Cột trái** (thẻ nền `--bg-elev`, bo 16 px, `position: sticky; top: 16px`):
  1. **Sân khấu** cao 330 px: nền gradient tối, vệt sáng vàng mờ sau nhân vật, bệ elip mờ dưới chân; chibi toàn thân cao 320 px. Khi đang ở tab Khung, sân khấu hiện chân dung tròn 240 px có khung (như hiện nay hiện thêm ảnh nhỏ), không hiện toàn thân.
  2. **Biểu cảm** (review 29/09 No10): một hàng bộ chuyển `‹  Vui  ›` dưới sân khấu — nút "Biểu cảm trước" và "Biểu cảm sau" hai bên, tên biểu cảm đang xem ở giữa (trong `<output aria-live="polite">`). Sáu biểu cảm đi theo thứ tự Bình thường, Vui, Buồn, Ngạc nhiên, Nhắm mắt, Ngủ; bấm "sau" ở Ngủ thì về Bình thường, bấm "trước" ở Bình thường thì sang Ngủ. Phím ← → trong nhóm cũng chuyển (trừ khi giữ Alt, Ctrl hoặc Meta). Hàng cao 30 px, đúng bằng hàng 6 nút cũ (hàng đó từng bị chữ 11 px, chật và xuống hai dòng ở cột 300 px), để cột trái vẫn vừa cửa sổ cao 900 px. Chỉ đổi hình xem trước, không lưu; chân dung có khung ở tab Khung đổi theo.
  3. **Đang dùng**: danh sách mỗi slot một dòng — biểu tượng, tên slot, tên món (màu chữ theo độ hiếm; màu tóc/da/mắt có chấm màu). Thứ tự (nhân vật v4, Kế hoạch 19): Giới tính, Kiểu tóc, Màu da, Màu tóc, Màu mắt, Mũ, Phụ kiện mặt, Quần áo, Hào quang, Khung, Danh hiệu, Huy hiệu (trước đây dòng đầu là Nhân vật). Slot trống ghi "Không có" (màu tóc/da/mắt trống ghi "Tự nhiên"). Slot tuỳ chọn đang có món có nút "×" để bỏ; Giới tính, Kiểu tóc và Quần áo không có "×". Bấm vào một dòng mở đúng nhóm/tab của slot đó; dòng Giới tính mở tab Kiểu tóc.
  4. **Bộ đồ đã lưu**: 5 chân dung tròn 54 px (ô trống: vòng nét đứt có "+" và chữ "Trống"), tên bên dưới. Bấm ô có đồ mở menu nhỏ: Mặc bộ này · Lưu đè · Đổi tên · Xóa. Bấm ô trống mở hộp đặt tên để lưu bộ hiện tại vào ô đó. Các hộp thoại dùng lại luồng hiện có của `OutfitBar`.
- **Cột phải**:
  1. **3 nhóm** dạng segmented có biểu tượng: Ngoại hình (Kiểu tóc, Màu tóc, Màu da, Màu mắt) · Trang phục (Mũ, Phụ kiện mặt, Quần áo) · Trang trí (Hào quang, Khung, Danh hiệu & Huy hiệu).
     - **Nhóm Ngoại hình** (nhân vật v4, Kế hoạch 19; spec `2026-10-03-avatar-v4-design.md` §6.1): tab Nhân vật (`base`) bị bỏ cùng các thân cũ. Đầu nhóm là nút chuyển **Nữ | Nam** (`Segmented` của kit, nhóm "Giới tính"), nằm dưới hàng nhóm và trên hàng tab con, hiện ở cả bốn tab con của nhóm và **không phải một tab**. Hàng của nó không cao hơn hàng tab con trên desktop; trên điện thoại mỗi nút cao ít nhất 44 px (`--tap`).
     - Đổi giới tính chỉ đổi bản nháp: kiểu tóc chuyển sang kiểu tương ứng (`counterpart`) nếu đã có, không thì kiểu đã có đầu tiên của giới tính đó; quần áo tự dùng bản cắt theo giới tính; màu tóc, màu da, màu mắt, mũ, kính, hào quang, khung, danh hiệu, huy hiệu giữ nguyên. "Lưu trang phục" mới lưu, "Hoàn tác" đưa giới tính về như mọi thay đổi khác.
     - Bốn tab con nằm trên một hàng như các nhóm khác: hàng không xuống dòng và tự cuộn ngang bên trong khi chật; trang không cuộn ngang.
  2. **Tab con** của nhóm đang chọn, gạch chân vàng khi chọn, mỗi tab kèm "đã có/tổng" (ví dụ "5/8"; Kiểu tóc chỉ đếm kiểu tóc của giới tính đang chọn).
  3. **Bộ lọc** (review 29/09 No11a): một ô đánh dấu **"Hiện cả món chưa có"** (thay ba nút Tất cả · Đã có · Chưa có cũ), hiện ở mọi tab. Mặc định bỏ tích: tab chỉ liệt kê món đã có. Bên phải vẫn hiện "n/m đã có" — số này đếm từng biến thể màu như một món, nên một thẻ họ (§4.1) có thể đứng cho nhiều món đã có. Ô là `<input type="checkbox">` gốc trong `<label>`, cao một vùng bấm (`--tap`), `accent-color: var(--gold)` — đúng kiểu ô đánh dấu của hộp tạo phòng.
  4. **Lưới thẻ** `repeat(auto-fill, minmax(150px, 1fr))`, khoảng 14 px, lấp hết chiều ngang.

### 3.2 Điện thoại (< 768 px)

Một cột theo thứ tự: đầu trang gọn (tiêu đề + "Lưu"; "Hoàn tác" thành nút biểu tượng); sân khấu 250 px (không sticky); bộ chuyển biểu cảm `‹  tên  ›` (No10), mỗi nút một ô 44 px (`--tap`) nên hàng cao 44 px; 3 nhóm chiếm đủ chiều ngang; tab con; bộ lọc; lưới 3 cột; rồi "Đang dùng" và "Bộ đồ đã lưu" dạng mục thu gọn (mặc định đóng, tiêu đề ghi số món, ví dụ "Đang dùng (6)").

Hàng bộ lọc trên điện thoại (No11a): ô "Hiện cả món chưa có" bên trái, "n/m đã có" bên phải, cùng một hàng ở 375 px; màn hẹp hơn thì "n/m đã có" xuống dòng dưới ô (hàng được phép xuống dòng), không cuộn ngang. Dòng "Bạn chưa có món nào ở mục này." thay lưới khi tab không có món nào đã có.

### 3.3 Máy tính bảng (768–1023 px)

Như desktop nhưng cột trái 300 px, sân khấu 280 px, lưới `minmax(130px, 1fr)`.

## 4. Thẻ

### 4.1 Thẻ món (Mũ, Phụ kiện mặt, Quần áo, Hào quang, Khung)

- Ô ảnh cao 118 px (điện thoại 70 px), nền tối có quầng màu độ hiếm; ảnh là biểu tượng món hiện có (`<layer>_icon`), với món theo giới dùng bản cắt của thân đang chọn như hiện nay.
- Tên món (đậm), nhãn độ hiếm chữ hoa nhỏ màu theo độ hiếm; viền dưới 3 px màu độ hiếm.
- **Đang dùng**: viền vàng + nhãn "✓ Đang dùng" ở góc.
- **Chưa có**: ảnh xám tối, tên màu nhạt, dòng khoá "🔒 <cách nhận>" (chuỗi `hintFor` hiện có). Không bấm mặc được; bấm hiện tooltip/nhãn cách nhận như hiện nay.
- **Biến thể màu** (review 29/09 No8a, Plan 18): một họ món — món gốc cùng các biến thể màu (cùng `asset.file`) — là **một thẻ**.
  - Thẻ là **món đang mặc** trong họ; không mặc món nào của họ thì là món gốc khi đã có; chưa có món gốc thì là biến thể đã có đầu tiên (theo thứ tự catalogue); không có gì của họ thì là món gốc. Luật này **không phụ thuộc ô "Hiện cả món chưa có"**: tích ô chỉ thêm thẻ và chấm, không bao giờ biến một thẻ đã có thành thẻ khoá (đợt sửa cuối Plan 18, B2). Thẻ không đổi chỗ khi đổi món: thứ tự vẫn theo độ hiếm của món gốc.
  - Mọi thứ trên thẻ là của món đó: ảnh (biến thể được tô đúng màu của nó, bằng mặt nạ màu của icon, như lớp đang mặc trên nhân vật), tên, độ hiếm, nhãn "✓ Đang dùng", trạng thái khoá và dòng cách nhận.
  - Hàng chấm 16 px dưới thẻ (như Plan 13) liệt kê cả họ, **món gốc đứng đầu** với chấm không tô màu (kiểu ô "Tự nhiên": viền `--ink-muted` và ô cờ sáng, đọc rõ trên thẻ tối); mỗi chấm có tên món (nhãn và tooltip), chấm của món đang mặc có viền vàng, chấm chưa có mờ 35 % kèm khoá. Chấm của món chưa có chỉ hiện khi tích ô; bỏ tích thì ẩn. Hàng chấm chỉ còn đúng món của thẻ thì bỏ cả hàng. Nhóm chấm mang tên món gốc. Sau khi mặc một biến thể Quần áo, chấm món gốc là đường duy nhất về lại món gốc (Quần áo không bỏ được), nên trên điện thoại hay màn cảm ứng mỗi chấm vẫn vẽ 16 px nhưng có vùng bấm 44 × 44 px trong suốt, các vùng không chồng nhau, hàng chấm được xuống dòng (B1).
- Bấm thẻ đã có: mặc món của thẻ; bấm lại món đang mặc ở slot tuỳ chọn: bỏ món (Quần áo thì không bỏ được). Bấm một chấm đã có: mặc món của chấm đó (bấm lại chấm đang mặc ở slot tuỳ chọn cũng bỏ món), và thẻ chuyển theo món vừa mặc.
- **Thẻ kiểu tóc** (tab Kiểu tóc, nhân vật v4, Kế hoạch 19): thẻ món như trên, nhưng ô ảnh là **chân dung đầu** của bản nháp mang đúng kiểu tóc đó — 96 px (điện thoại 72 px, ô ảnh nở ra cho vừa), cùng giới tính, màu tóc, màu da và màu mắt đang chọn, và **không** đội mũ, đeo kính, hào quang hay khung (mũ che tóc mái sẽ làm mọi thẻ trông như nhau). Chỉ hiện kiểu tóc của giới tính đang chọn, kể cả khi tích "Hiện cả món chưa có". Kiểu tóc luôn phải có, như Quần áo: bấm lại thẻ đang mặc thì vẫn mặc.

### 4.2 Thẻ thân (tab Thân)

_Bỏ từ nhân vật v4 (Kế hoạch 19): thân là giới tính, chọn bằng nút Nữ | Nam (§3.1); kiểu tóc là thẻ ở tab Kiểu tóc (§4.1)._ Trước đây: chân dung đầu 96 px của thân đó (mặc bộ đồ đang chọn), tên thân (§ lỗi 5: tên theo kiểu tóc), viền vàng khi chọn. Không có độ hiếm, không khoá.

### 4.3 Thẻ màu (Màu tóc, Màu da, Màu mắt)

Chấm tròn 56 px tô `colour`, tên màu, nhãn độ hiếm; thẻ đầu "Tự nhiên" luôn có — ở Màu tóc và Màu mắt là chấm nửa màu gốc/nửa kẻ chéo, ở Màu da là chấm tô màu da gốc của thân (tông kem). Khoá và đang mặc như §4.1.

### 4.4 Thẻ chữ (Danh hiệu & Huy hiệu)

Hai nhóm nhỏ trong cùng tab ("Danh hiệu", "Huy hiệu"), thẻ không ảnh: tên danh hiệu/huy hiệu như sẽ hiện cạnh tên người chơi, nhãn độ hiếm, khoá/đang mặc như §4.1.

## 5. Hành vi

1. **Bản nháp**: mọi thao tác sửa bản nháp và xem trước ngay. "Lưu tủ đồ" gửi như hiện nay; "Hoàn tác" đưa bản nháp về bản đã lưu (không gọi server).
2. **Rời màn khi chưa lưu**: giữ hộp thoại hiện có.
3. **Tab nhớ**: nhóm và tab con đang chọn giữ nguyên khi đổi biểu cảm, lưu, áp dụng bộ đồ. Mặc định mở nhóm Ngoại hình, tab Kiểu tóc (trước Kế hoạch 19: tab Thân).
4. **Thứ tự thẻ** cố định: độ hiếm (Thường → Hiếm → Sử thi), rồi thứ tự catalogue. Món đang mặc không bị đưa lên đầu.
5. **Bộ lọc** (review 29/09 No11a; trước đây: áp cho tab hiện tại, reset về "Tất cả" khi đổi tab).
   - Ô "Hiện cả món chưa có" bỏ tích mỗi lần mở tủ đồ, rồi **giữ nguyên khi đổi tab** trong lượt đó (không reset khi đổi tab, không lưu lại).
   - **Theo họ món.** Một họ là món gốc cùng các biến thể màu của nó (cùng `asset.file`). Bỏ tích: thẻ của họ hiện khi người chơi có món gốc **hoặc bất kỳ biến thể nào**; trong thẻ, chấm của biến thể chưa có bị ẩn. Chưa có món gốc mà có biến thể thì thẻ hiện **biến thể đã có đầu tiên** (theo thứ tự catalogue): tên của nó, trạng thái đã có, bấm là mặc nó.
   - Tích ô: thêm các họ chưa có gì (thẻ khoá, là món gốc) và các chấm chưa có (khoá). Thẻ của một họ đã có giữ nguyên món nó đang hiện (§4.1): tích ô chỉ thêm, không đổi thẻ nào (B2).
   - Tab màu (Màu tóc, Màu da, Màu mắt) theo cùng luật cho từng ô màu; "Tự nhiên" luôn hiện.
   - **Không có gì để hiện.** Bỏ tích mà tab không có món nào đã có: lưới được thay bằng một dòng **"Bạn chưa có món nào ở mục này."**, nằm trong chính `tabpanel` của tab (cùng `id`, cùng `aria-labelledby`). Ở tab Danh hiệu & Huy hiệu, nhóm nào trống thì ẩn cả tiêu đề; cả hai trống thì dòng chữ hiện một lần.

## 6. Màu độ hiếm và chủ đề

Thêm token vào `packages/ui-kit/src/theme/tokens.css` cho cả chủ đề tối và sáng: `--rarity-common`, `--rarity-rare`, `--rarity-epic`. Tối: `#9aa4c0`, `#5b9be0`, `#b58af0`. Sáng: `#5c6076`, `#1f5fae`, `#6b3fb3`. Mỗi màu đạt tương phản ≥ 4.5:1 với `--bg-elev` của chủ đề đó (kiểm bằng test như `tokens.test.ts` đang làm với các màu khác). Vàng (`--gold`) chỉ dùng cho "đang chọn/đang mặc" và nút chính, không dùng cho độ hiếm.

## 7. Truy cập

- Nhóm và tab con dùng `role="tablist"`/`tab`/`tabpanel`, phím mũi tên chuyển tab; biểu cảm là một `role="group"` (nhãn "Xem thử biểu cảm") gồm hai nút có tên "Biểu cảm trước"/"Biểu cảm sau" và tên biểu cảm đang xem trong `<output aria-live="polite">`, nên đổi biểu cảm được đọc lên mà không cần đưa focus tới tên (No10), và hai nút được mô tả bằng tên đó (`aria-describedby`), nên focus vào nút cũng đọc biểu cảm đang xem; phím ← → trong nhóm cũng chuyển; bộ lọc là ô đánh dấu gốc trong `<label>` (tên đọc được "Hiện cả món chưa có", No11a). Tab không có gì để hiện vẫn là `tabpanel` của nó, chứa dòng chữ thay cho lưới — không phải một `tabpanel` có lưới rỗng — và chính `tabpanel` nhận focus (`tabindex="0"`, theo mẫu tabs của ARIA) vì bên trong không còn gì để Tab tới.
- Thẻ là `button` có `aria-pressed` (đang mặc) và `aria-disabled` + mô tả cách nhận (chưa có); nhãn đọc được: "<tên>, <độ hiếm>, đang mặc/chưa có".
- Focus ring `--focus` rõ trên mọi phần tử bấm được; vùng bấm tối thiểu 40 px trên điện thoại.

## 8. Kiểm thử

- Đơn vị (vitest + testing-library): nhóm/tab con/đếm số; bộ lọc; thẻ đã có/chưa có/đang dùng; "×" trong Đang dùng bỏ đúng slot, không có "×" cho Nhân vật và Quần áo; bấm dòng Đang dùng mở đúng tab; Hoàn tác; menu bộ đồ đã lưu (mặc bộ này, lưu đè, đổi tên, xóa, lưu vào ô trống); tab Khung đổi sân khấu sang chân dung.
- Cập nhật `WardrobeScreen.test.tsx` và e2e (`avatar2d.spec.ts`, `avatar-tint.spec.ts`) theo nhãn và cấu trúc mới; e2e thêm một lần chụp màn tủ đồ desktop và điện thoại để so với mockup.
- `tokens.test.ts`: tương phản của ba màu độ hiếm ở hai chủ đề.
- Gate: `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, e2e Normal, `pnpm build:lite` (ui-kit đổi token).

## 9. Triển khai

Sau khi gộp: build lại web Normal và khởi động lại host LAN (`run.ps1 -NoMigrate`). Không migration.
