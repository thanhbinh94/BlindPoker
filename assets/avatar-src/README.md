# Ảnh gốc của nhân vật chibi 2D

Thư mục này giữ **ảnh do công cụ AI sinh ra** trước khi được dọn và cắt lớp: ảnh chủ của hai thân nền,
sáu biểu cảm mỗi thân, từng món trang bị, hiệu ứng nền, khung viền và tám bot.

**Không có tệp ảnh nào trong thư mục này được đưa vào git.** Chỉ `README.md` và `.gitignore` được
commit — xem `.gitignore` ngay cạnh. Ảnh gốc nặng, nhiều bản nháp, và không phải trạng thái của dự án:
thứ được commit là các lớp PNG đã dọn ở `apps/normal-web/public/avatar/` cùng
`avatar-manifest.json`. Hãy tự sao lưu thư mục này ở nơi khác (ổ ngoài, kho ảnh riêng); nếu mất, phải
sinh lại ảnh và bản ghi dưới đây là thứ cho biết phải sinh lại bằng gì.

## Đặt ảnh vào đâu

Quy cách khung và tên lớp nằm ở `docs/avatar/01-quy-cach-tai-san-nhan-vat-kho-do.md`; câu lệnh sinh
ảnh nằm ở `docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md`.

```
assets/avatar-src/
  f01/  base.png  face-neutral.png  face-happy.png  face-sad.png …   ảnh chủ và sáu biểu cảm của thân nữ
  m01/  base.png  face-neutral.png …                                 thân nam
  item/ head-tophat01.png  face-sunglasses01.png  outfit-dealer01.png …
  aura/ water01.png  fire01.png …                                    sinh riêng, không có nhân vật
  frame/ bronze.png  silver01.png …                                  vòng 208 × 208, tâm rỗng
  bot/  0.png  0-happy.png  1.png …                                  tám bot robot
  nhat-ky.md                                                         bản ghi ở mục dưới
```

Mọi ảnh: nền `#00FF00` phẳng, cao ít nhất 1152 điểm ảnh, PNG hoặc WebP không mất dữ liệu. Ảnh nháp
(bản không chọn) để trong thư mục con `nhap/` của chính thư mục đó, hoặc xoá đi.

## Bản ghi công cụ và seed — `nhat-ky.md`

Mỗi ảnh **đã chọn** phải có một dòng. Không có dòng thì coi như ảnh không tái lập được, và theo
`docs/known-limitations.md` đó là rủi ro pháp lý lẫn rủi ro nhất quán.

```markdown
| Tệp | Công cụ | Mô hình / phiên bản | Seed | Ngày | Câu lệnh | Ghi chú |
|---|---|---|---|---|---|---|
| f01/base.png | <tên công cụ> | <tên mô hình> | 184203771 | 2026-09-15 | D02 §4 + KHOÁ F01 | ứng viên 3/4, chọn vì mắt đúng tầm |
| item/head-tophat01.png | <tên công cụ> | <tên mô hình> | 184203771 | 2026-09-15 | D02 §5.1, mã `tophat01` | sinh trên F01, dùng chung cho M01 |
```

Cột `Câu lệnh` ghi **tham chiếu** tới mục trong tài liệu 02 chứ không chép lại cả đoạn; chỉ ghi rõ
phần đã sửa khác tài liệu. Giữ nguyên seed giữa các lần sinh của cùng một nhân vật là cách rẻ nhất để
nhân vật không trôi (spec §10).

## Rồi làm gì với chúng

```bash
cd apps/normal-web
# 1. đo tỉ lệ trước khi tốn công dọn — D02 §8, không ghi tệp nào
node scripts/avatar-pipeline.mjs ingest ../../assets/avatar-src/f01/base.png --as base:f01 --dry-run
# 2. ảnh chủ: xoá nền, căn khung, xuất @1x/@2x, ghi lại phép căn để mọi món dùng chung
node scripts/avatar-pipeline.mjs ingest ../../assets/avatar-src/f01/base.png --as base:f01
# 3. biểu cảm và món, căn theo đúng phép căn của ảnh chủ
node scripts/avatar-pipeline.mjs ingest ../../assets/avatar-src/f01/face-happy.png --as expr:f01:happy
node scripts/avatar-pipeline.mjs ingest ../../assets/avatar-src/item/head-tophat01.png --as item:head:tophat01
node scripts/avatar-pipeline.mjs ingest ../../assets/avatar-src/item/head-hood_black01.png \
  --as item:head:hood_black01 --hides-hair-front --hides-hair-back
# 4. nghiệm thu mười tiêu chí của D01 §10, rồi dựng bảng duyệt bằng mắt
node scripts/avatar-pipeline.mjs check
node scripts/avatar-pipeline.mjs sheet
```

Lớp nào chưa có ảnh thật thì `placeholder` giữ một hình tạm có dán mã món, nên ứng dụng luôn dựng
được. `ingest` lật lớp đó sang `real: true` trong manifest và từ đó `placeholder` không đụng vào nữa.
