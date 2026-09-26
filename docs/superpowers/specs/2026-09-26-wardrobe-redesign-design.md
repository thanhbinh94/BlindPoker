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
  2. **Biểu cảm**: một hàng segmented 6 nút nhỏ, không bao giờ gãy dòng.
  3. **Đang mặc**: danh sách mỗi slot một dòng — biểu tượng, tên slot, tên món (màu chữ theo độ hiếm; màu tóc/mắt có chấm màu). Thứ tự: Thân, Màu tóc, Màu mắt, Mũ, Phụ kiện mặt, Trang phục, Hào quang, Khung, Danh hiệu, Huy hiệu. Slot trống ghi "Không có" (màu tóc/mắt trống ghi "Tự nhiên"). Slot tuỳ chọn đang có món có nút "×" để bỏ; Thân và Trang phục không có "×". Bấm vào một dòng mở đúng nhóm/tab của slot đó.
  4. **Bộ đồ đã lưu**: 5 chân dung tròn 54 px (ô trống: vòng nét đứt có "+" và chữ "Trống"), tên bên dưới. Bấm ô có đồ mở menu nhỏ: Áp dụng · Lưu đè vào đây · Đổi tên · Xoá. Bấm ô trống mở hộp đặt tên để lưu bộ hiện tại vào ô đó. Các hộp thoại dùng lại luồng hiện có của `OutfitBar`.
- **Cột phải**:
  1. **3 nhóm** dạng segmented có biểu tượng: Ngoại hình (Thân, Màu tóc, Màu mắt) · Trang phục (Mũ, Phụ kiện mặt, Trang phục) · Trang trí (Hào quang, Khung, Danh hiệu & Huy hiệu).
  2. **Tab con** của nhóm đang chọn, gạch chân vàng khi chọn, mỗi tab kèm "đã có/tổng" (ví dụ "5/8"; tab Thân không có số vì thân không phải món).
  3. **Bộ lọc**: Tất cả · Đã có · Chưa có (không hiện ở tab Thân). Bên phải hiện "n/m đã có".
  4. **Lưới thẻ** `repeat(auto-fill, minmax(150px, 1fr))`, khoảng 14 px, lấp hết chiều ngang.

### 3.2 Điện thoại (< 768 px)

Một cột theo thứ tự: đầu trang gọn (tiêu đề + "Lưu"; "Hoàn tác" thành nút biểu tượng); sân khấu 250 px (không sticky); biểu cảm cuộn ngang; 3 nhóm chiếm đủ chiều ngang; tab con; bộ lọc; lưới 3 cột; rồi "Đang mặc" và "Bộ đồ đã lưu" dạng mục thu gọn (mặc định đóng, tiêu đề ghi số món, ví dụ "Đang mặc (6)").

### 3.3 Máy tính bảng (768–1023 px)

Như desktop nhưng cột trái 300 px, sân khấu 280 px, lưới `minmax(130px, 1fr)`.

## 4. Thẻ

### 4.1 Thẻ món (Mũ, Phụ kiện mặt, Trang phục, Hào quang, Khung)

- Ô ảnh cao 118 px (điện thoại 70 px), nền tối có quầng màu độ hiếm; ảnh là biểu tượng món hiện có (`<layer>_icon`), với món theo giới dùng bản cắt của thân đang chọn như hiện nay.
- Tên món (đậm), nhãn độ hiếm chữ hoa nhỏ màu theo độ hiếm; viền dưới 3 px màu độ hiếm.
- **Đang mặc**: viền vàng + nhãn "✓ Đang mặc" ở góc.
- **Chưa có**: ảnh xám tối, tên màu nhạt, dòng khoá "🔒 <cách nhận>" (chuỗi `hintFor` hiện có). Không bấm mặc được; bấm hiện tooltip/nhãn cách nhận như hiện nay.
- **Biến thể màu**: hàng chấm 16 px dưới thẻ món gốc (như Plan 13), chấm chưa có mờ 35 %.
- Bấm thẻ đã có: mặc món; bấm lại món đang mặc ở slot tuỳ chọn: bỏ món.

### 4.2 Thẻ thân (tab Thân)

Chân dung đầu 96 px của thân đó (mặc bộ đồ đang chọn), tên thân (§ lỗi 5: tên theo kiểu tóc), viền vàng khi chọn. Không có độ hiếm, không khoá.

### 4.3 Thẻ màu (Màu tóc, Màu mắt)

Chấm tròn 56 px tô `colour`, tên màu, nhãn độ hiếm; thẻ đầu "Tự nhiên" (chấm nửa màu gốc/nửa kẻ chéo) luôn có. Khoá và đang mặc như §4.1.

### 4.4 Thẻ chữ (Danh hiệu & Huy hiệu)

Hai nhóm nhỏ trong cùng tab ("Danh hiệu", "Huy hiệu"), thẻ không ảnh: tên danh hiệu/huy hiệu như sẽ hiện cạnh tên người chơi, nhãn độ hiếm, khoá/đang mặc như §4.1.

## 5. Hành vi

1. **Bản nháp**: mọi thao tác sửa bản nháp và xem trước ngay. "Lưu tủ đồ" gửi như hiện nay; "Hoàn tác" đưa bản nháp về bản đã lưu (không gọi server).
2. **Rời màn khi chưa lưu**: giữ hộp thoại hiện có.
3. **Tab nhớ**: nhóm và tab con đang chọn giữ nguyên khi đổi biểu cảm, lưu, áp dụng bộ đồ. Mặc định mở nhóm Ngoại hình, tab Thân.
4. **Thứ tự thẻ** cố định: độ hiếm (Thường → Hiếm → Sử thi), rồi thứ tự catalogue. Món đang mặc không bị đưa lên đầu.
5. **Bộ lọc** áp cho tab hiện tại, reset về "Tất cả" khi đổi tab.

## 6. Màu độ hiếm và chủ đề

Thêm token vào `packages/ui-kit/src/theme/tokens.css` cho cả chủ đề tối và sáng: `--rarity-common`, `--rarity-rare`, `--rarity-epic`. Tối: `#9aa4c0`, `#5b9be0`, `#b58af0`. Sáng: `#5c6076`, `#1f5fae`, `#6b3fb3`. Mỗi màu đạt tương phản ≥ 4.5:1 với `--bg-elev` của chủ đề đó (kiểm bằng test như `tokens.test.ts` đang làm với các màu khác). Vàng (`--gold`) chỉ dùng cho "đang chọn/đang mặc" và nút chính, không dùng cho độ hiếm.

## 7. Truy cập

- Nhóm và tab con dùng `role="tablist"`/`tab`/`tabpanel`, phím mũi tên chuyển tab; biểu cảm, bộ lọc dùng nút `aria-pressed`.
- Thẻ là `button` có `aria-pressed` (đang mặc) và `aria-disabled` + mô tả cách nhận (chưa có); nhãn đọc được: "<tên>, <độ hiếm>, đang mặc/chưa có".
- Focus ring `--focus` rõ trên mọi phần tử bấm được; vùng bấm tối thiểu 40 px trên điện thoại.

## 8. Kiểm thử

- Đơn vị (vitest + testing-library): nhóm/tab con/đếm số; bộ lọc; thẻ đã có/chưa có/đang mặc; "×" trong Đang mặc bỏ đúng slot, không có "×" cho Thân và Trang phục; bấm dòng Đang mặc mở đúng tab; Hoàn tác; menu bộ đồ đã lưu (áp dụng, lưu đè, đổi tên, xoá, lưu vào ô trống); tab Khung đổi sân khấu sang chân dung.
- Cập nhật `WardrobeScreen.test.tsx` và e2e (`avatar2d.spec.ts`, `avatar-tint.spec.ts`) theo nhãn và cấu trúc mới; e2e thêm một lần chụp màn tủ đồ desktop và điện thoại để so với mockup.
- `tokens.test.ts`: tương phản của ba màu độ hiếm ở hai chủ đề.
- Gate: `pnpm -r typecheck`, `pnpm lint`, `pnpm test`, `pnpm build:normal`, e2e Normal, `pnpm build:lite` (ui-kit đổi token).

## 9. Triển khai

Sau khi gộp: build lại web Normal và khởi động lại host LAN (`run.ps1 -NoMigrate`). Không migration.
