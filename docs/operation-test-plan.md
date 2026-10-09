# Kế hoạch test vận hành — Blind Luck Poker

Tài liệu này dành cho người **chơi thử bằng tay** trên bản đang chạy thật: bản Normal trên máy chủ LAN
(`deploy/normal-windows/run.ps1`), và bản Lite (`bind-poker-lite.exe`). Phần test tự động (engine, server, e2e)
đã có trong `docs/test-matrix.md` và `docs/acceptance-checklist.md`; ở đây chỉ kiểm những gì máy không tự thấy
được: nhiều người thật cùng bàn, mạng chập chờn, điện thoại thật, cảm giác dùng, và vận hành máy chủ.

Ngày lập: 2026-09-28. Bản kiểm: master sau merge `22d1905` (đổi tên Blind Luck Poker).

---

## 1. Phạm vi

| Trong phạm vi | Ngoài phạm vi (lần này) |
|---|---|
| Bản Normal trên máy chủ LAN (Neon Postgres) | Triển khai Oracle / internet công khai |
| Bản Lite (exe, SQLite) — một vòng ngắn | Tải lớn (> 8 người một bàn, nhiều bàn song song): đã có soak test tự động |
| Máy tính (Chrome, Edge), điện thoại (Android Chrome, iPhone Safari) | Trình duyệt cũ (IE, Safari < 16) |
| Tiếng Việt và English, nền tối và nền sáng | Kiểm thử bảo mật xâm nhập |

## 2. Chuẩn bị

### 2.1 Máy chủ (người vận hành làm)

1. Trên máy chủ: `pnpm build:normal`, rồi `deploy\normal-windows\run.ps1 -NoMigrate` (thêm migrate nếu có bản
   database mới). Ghi lại địa chỉ LAN script in ra (ví dụ `http://10.0.15.121:8080`).
2. Mở `http://localhost:8080/health` → phải thấy `"status":"ok"` và `"db":"ok"`.
3. Nếu máy khác không vào được: tạo luật tường lửa như `deploy/normal-windows/README.md` mục 6.
4. Trước mỗi lần khởi động lại: xem `/health` có `"rooms":0` — `stop.ps1` tắt cứng, stack đang trên bàn sẽ mất.

### 2.2 Người test

- Mỗi người **tự đăng ký** tài khoản của mình (email dạng `ten@test.local` là đủ, không có email xác nhận).
  Không gửi mật khẩu cho nhau hay dán vào chat.
- Máy chủ cho tối đa **10 lần đăng ký mỗi phút trên một địa chỉ IP** — nếu cả nhóm đi qua cùng một
  IP (ví dụ Cloudflare Tunnel), đăng ký lần lượt.
- Tài khoản có sẵn toàn bộ tủ đồ: xem `deploy/normal-windows/README.md` mục 9b (người vận hành giữ mật khẩu).
- Mỗi người ghi: tên hiển thị, thiết bị + trình duyệt, cỡ màn hình.

### 2.3 Ma trận thiết bị tối thiểu

| Mã | Thiết bị | Cỡ | Ghi chú |
|---|---|---|---|
| D1 | PC/laptop Chrome | ≥ 1440 px | nền tối, tiếng Việt |
| D2 | Laptop Edge | 1280–1366 px | nền sáng, English |
| T1 | Cửa sổ thu nhỏ hoặc máy tính bảng | ~900 px | |
| P1 | Android Chrome | 360–412 px | dọc |
| P2 | iPhone Safari | 375–430 px | dọc |

## 3. Cách chạy một đợt test

**Bộ test tự động của kế hoạch này:** `apps/normal-web/e2e/ops/` — mỗi test mang mã ca (S-01, E-05…), chạy bằng
`pnpm build:normal` rồi `pnpm --filter @bp/normal-web e2e:ops` (server thử PGlite, không đụng Neon, khoảng 20 phút).
Những ca nó tự làm được thì người test chỉ cần kiểm lại trên thiết bị thật; kết quả từng đợt ghi ở `docs/test-runs/`.

| Vòng | Ai | Thời lượng | Nội dung |
|---|---|---|---|
| 0 — Cổng tự động | Claude | ~10 phút | `pnpm typecheck && pnpm lint && pnpm test && pnpm build:normal && pnpm e2e:normal`, rồi `pnpm build:lite && pnpm --filter @bp/lite e2e`. Không xanh thì không mở vòng 1. |
| 1 — Khói | 1 người | 15 phút | Mục 4 (S-01…S-08) |
| 2 — Chức năng | từng người | 60 phút | Mục 5, chia module theo người |
| 3 — Nhiều người | 3–4 người | 45 phút | Mục 6, kịch bản chung một bàn |
| 4 — Mạng và vận hành | 1–2 người + người vận hành | 30 phút | Mục 5.G, 5.N |
| 5 — Lite | 1–2 người | 20 phút | Mục 5.O |

Mức ưu tiên: **P1** hỏng = chặn phát hành; **P2** hỏng = sửa trước đợt sau; **P3** = góp ý giao diện.

Ghi kết quả vào bảng ở mục 8 (✓ / ✗ / — bỏ qua). Mỗi ✗ cần: mã ca test, giờ xảy ra, tên hiển thị,
mã phòng (nếu có), thiết bị, ảnh chụp màn hình. Claude chép vào `docs/bug-log.md`, và chỉ sửa khi bạn duyệt.

## 4. Test khói (S)

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| S-01 | Mở địa chỉ máy chủ | Trang đăng nhập "Blind Luck Poker", tab trình duyệt cùng tên | P1 |
| S-02 | Đăng ký tài khoản mới | Vào thẳng trang Điểm danh (lần đầu trong ngày), số dư 100.000 điểm | P1 |
| S-03 | Bấm Nhận thưởng | Số dư +5.000, nút khoá lại; chấm vàng trên tab Điểm danh biến mất khi rời trang (xem T1 trong `docs/bug-log.md` §6) | P1 |
| S-04 | Sảnh → Tạo phòng Blind, 3 bot | Vào bàn, 3 bot ngồi sẵn, mã phòng 6 ký tự ở đầu trang | P1 |
| S-05 | Ngồi vào bàn → Sẵn sàng → Bắt đầu | Ngồi: số dư trừ hạn mức 5.000; ván chạy, lá chung lật, có người thắng, chồng trên bàn đổi; rời phòng: chồng về số dư | P1 |
| S-06 | Rời phòng | Về sảnh; phòng Blind của S-04 (chỉ còn bot) biến mất khỏi sảnh ngay (C-07); phòng không bot hiện nhãn "Đang đóng…" rồi biến mất sau ~60 giây (C-06) | P1 |
| S-07 | Hồ sơ, Tủ đồ, Thành tựu, Cài đặt; địa chỉ cũ `#/inventory` | Mỗi trang mở được, không trang trắng; `#/inventory` mở Tủ đồ và đổi thành `#/avatar` | P1 |
| S-08 | Tải lại trang (F5) ở bất kỳ màn nào | Vẫn đăng nhập, về đúng màn | P1 |

## 5. Test chức năng theo module

### A. Tài khoản

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| A-01 | Đăng ký với mật khẩu 7 ký tự | Bị từ chối, gợi ý "8–128 ký tự" | P2 |
| A-02 | Đăng ký với mật khẩu trùng email | Bị từ chối | P2 |
| A-03 | Đăng ký tên hiển thị 1 ký tự / 21 ký tự / có ký tự `@` | Bị từ chối, gợi ý "2–20 ký tự…" | P2 |
| A-04 | Đăng ký email đã có / tên hiển thị đã có | Thông báo rõ ràng, không lộ thông tin tài khoản khác | P2 |
| A-05 | Đăng nhập sai mật khẩu | Thông báo chung, không nói email có tồn tại hay không | P1 |
| A-06 | Đăng xuất (Cài đặt) → bấm Back của trình duyệt | Không xem lại được trang có dữ liệu tài khoản | P1 |
| A-07 | Đăng nhập cùng tài khoản trên máy thứ hai | Cả hai máy dùng được, số dư như nhau | P2 |
| A-08 | Đổi ngôn ngữ ở trang đăng nhập rồi đăng nhập | Ngôn ngữ giữ nguyên sau khi vào | P3 |
| A-09 | Ở trang đăng nhập, bấm qua lại giữa hai tab Đăng nhập / Đăng ký | Đổi form ngay ở lần bấm đầu; dưới form không còn dòng "Chưa có tài khoản? Đăng ký" / "Đã có tài khoản? Đăng nhập" (đã bỏ, review 29/09 No6) | P3 |

### B. Khung chung

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| B-01 | Kéo rộng/hẹp cửa sổ từ 1440 → 360 px | Thanh trên cùng không tràn, không có thanh cuộn ngang; ≤ 640 px tab thành icon + chữ | P2 |
| B-02 | Cài đặt → Sáng / Tối | Đổi ngay, giữ sau khi tải lại | P2 |
| B-03 | Cài đặt → English | Mọi chữ đổi sang tiếng Anh, kể cả trong bàn và hộp thoại | P2 |
| B-04 | Để một tab mở, người vận hành deploy bản mới, rồi bấm sang Hồ sơ | Trang tự tải lại một lần; nếu vẫn lỗi thì hiện "Đã có phiên bản mới" + nút Tải lại, không bao giờ trang trắng | P1 |

### C. Sảnh

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| C-01 | Người A tạo phòng công khai; người B đang ở sảnh | B thấy phòng xuất hiện ngay, không cần tải lại | P1 |
| C-02 | Lọc Tất cả / Hold'em / Blind | Chỉ hiện đúng loại | P3 |
| C-03 | A tạo phòng **riêng tư** có mật khẩu | B không thấy trong danh sách; nhập mã + đúng mật khẩu thì vào được, sai mật khẩu thì bị từ chối | P1 |
| C-04 | Nhập mã phòng không tồn tại | Báo không tìm thấy phòng | P2 |
| C-05 | Phòng đầy (ví dụ Blind 4 ghế, 3 bot, 1 người đã vào) | Danh sách ghi 4/4; người thứ hai bấm Vào phòng thì bị từ chối vì phòng đầy (bot chiếm ghế thật) | P2 |
| C-06 | Mọi người rời một phòng **không có bot** (ví dụ Hold'em) | Sảnh hiện "Đang đóng…" trong 60 giây rồi phòng biến mất; vào lại trong 60 giây thì phòng sống lại | P2 |
| C-07 | Người thật cuối cùng rời một phòng **còn bot** (ví dụ Blind, 2 bot); người khác đang xem sảnh | Phòng biến mất khỏi sảnh ngay (vài giây), không qua "Đang đóng…"; nếu rời giữa ván thì phòng đóng khi ván đó kết thúc. Người rớt mạng vẫn tính là còn trong phòng tới khi hết 5 phút làm người xem | P2 |

### D. Tạo phòng

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| D-01 | Hold'em: đổi Số người, Thời gian mỗi lượt (15/30/45/60), Mức cược (5 bậc), Buy-in tối thiểu/tối đa | Phòng tạo ra đúng cấu hình (xem đầu trang bàn) | P1 |
| D-02 | Buy-in tối thiểu > tối đa | Bị chặn, gợi ý rõ | P2 |
| D-03 | Tên phòng rỗng / 31 ký tự | Bị chặn | P2 |
| D-04 | Mật khẩu phòng 3 ký tự | Bị chặn, gợi ý "4–20 ký tự" | P2 |
| D-05 | Blind: 2 lá / 3 lá; Hoàn toàn may rủi / Chơi hoặc bỏ; Mức cược cố định; Số bot | Phòng đúng cấu hình; bot ngồi sẵn, luôn sẵn sàng | P1 |
| D-06 | Bật "Tự động bắt đầu" | Ván tự chạy khi tất cả người thật đã Sẵn sàng (≥ 2 người tính cả bot) | P2 |
| D-07 | Mở hộp thoại Tạo phòng, đổi qua lại Hold'em ↔ Blind | Hộp thoại giữ nguyên chiều cao (không giật lên xuống); các nút ở chân hộp thoại căn giữa, cách ô cuối một khoảng rõ (review 29/09 No12, No17) | P3 |

### E. Bàn Hold'em

Phòng Hold'em không có bot: cần ít nhất 2 người thật.

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| E-01 | Ngồi vào bàn, chọn mức mang vào | Số dư trừ đúng số mang vào, stack hiện trên ghế | P1 |
| E-02 | Bấm Bắt đầu khi chưa ai Sẵn sàng | Nút khoá, có gợi ý phải Sẵn sàng trước | P2 |
| E-03 | Chơi một ván đến showdown | Button/SB/BB đúng vị trí; lá chung ra đủ 3–1–1, mỗi lá trượt từ bộ bài cạnh pot rồi lật tại chỗ; lá của đối thủ nhấc lên rồi lật (~0,7 giây một lá, cách nhau 0,2 giây) rồi phiếu kết quả mới hiện — dòng kết quả dưới các ghế (tên tay bài, tiền thắng), viền sáng và số tiền trên tấm tên của người thắng cũng đợi đến lúc đó; tắt khi bật giảm chuyển động; người thắng được cộng pot trừ phí bàn 2% (tối đa 1 BB) | P1 |
| E-04 | Xem / Theo / Cược / Tố / Tất tay; dùng nút Min, ½, Pot, Max | Chỉ hiện hành động hợp lệ; tố thấp hơn mức tối thiểu bị chặn | P1 |
| E-05 | 3 người, stack khác nhau, hai người tất tay | Có pot phụ; mỗi pot chia đúng người đủ điều kiện | P1 |
| E-06 | Chọn trước "Xem/Bỏ", "Theo mọi mức", "Bỏ bài" khi chưa tới lượt | Tới lượt thì tự làm đúng lựa chọn; lựa chọn bị huỷ nếu có người tố làm nó không còn hợp lệ | P2 |
| E-07 | Để hết giờ không bấm gì | Tự Xem nếu được, không thì Bỏ bài | P1 |
| E-08 | Để hết giờ 3 lượt liên tiếp | Sau ván đó bị đứng dậy, stack về số dư | P2 |
| E-09 | Tạm nghỉ → bỏ qua 5 ván | Tự đứng dậy, stack về số dư | P2 |
| E-10 | Rời phòng giữa ván | Coi như bỏ bài; stack về số dư khi ván kết thúc | P1 |
| E-11 | Đứng dậy giữa hai ván | Stack về số dư ngay | P1 |
| E-12 | Ván sau tự bắt đầu | Khoảng 5 giây sau khi ván trước kết thúc, nếu còn ≥ 2 người có stack | P2 |

### F. Bàn Blind Poker

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| F-01 | Kiểu Hoàn toàn may rủi, 2 lá, 3 bot | Mỗi ván trừ đúng mức cược cố định **từ chồng trên bàn**; không có lượt quyết định; lật bài và chia pot trừ 2% phí; lá của đối thủ nhấc lên rồi lật (~0,7 giây một lá, cách nhau 0,2 giây; sau lá river thì đợi lá ấy nằm yên) rồi phiếu kết quả mới hiện — dòng kết quả dưới các ghế và số tiền trên tấm tên cũng đợi đến lúc đó; tắt khi bật giảm chuyển động | P1 |
| F-02 | Kiểu 3 lá | Mỗi người nhận 3 lá; xếp hạng dùng 5 lá tốt nhất trong 8 | P2 |
| F-03 | Kiểu Chơi hoặc bỏ, 2 người thật | Hai người quyết định cùng lúc, không ai thấy lựa chọn của người kia trước khi hết pha | P1 |
| F-04 | Cả hai chọn Bỏ | Pot chuyển sang ván sau, bàn hiện "Cộng dồn" | P1 |
| F-05 | Sau F-04, mọi người thật bấm Tạm nghỉ (vẫn giữ ghế) để không ván nào bắt đầu, chờ > 60 giây | Pot cộng dồn chia đều cho người thật đang ngồi ghế (cùng người bị mời đứng dậy vì hết hạn mức trong lúc pot đang cộng dồn, nếu còn trong phòng), phần lẻ bị thu; nếu không còn ai để chia thì cả pot bị thu | P2 |
| F-06 | Chỉ một người chọn Chơi | Người đó thắng cả pot, không lật lá chung, lá riêng không lộ | P1 |
| F-07 | (a) Bấm Ngồi vào bàn khi số dư < mức cược (kiểu A) hoặc < 2 × mức cược (kiểu B); (b) đang ngồi mà chồng trên bàn không đủ cho ván sau | (a) Bị từ chối, báo "Số dư không đủ", không bị trừ điểm (FR-R07); (b) bị mời đứng dậy sau ván, phần còn lại về số dư (xem F-10) | P2 |
| F-08 | Chủ phòng bấm Mời ra một bot | Bot rời ghế, ghế trống | P2 |
| F-09 | Bật "Tự động chơi" | Tự quyết định mỗi ván cho tới khi tắt | P3 |
| F-10 | Phòng mức cược 1.000, Chơi hoặc bỏ, 1 bot; ngồi vào bàn rồi Bỏ mọi ván | Ngồi: số dư −5.000 (hạn mức 5×), đầu phòng ghi "Hạn mức 5.000"; sau 4 ván chồng còn 1.000 < 2.000 → bị mời đứng dậy, thông báo "Bạn đã dùng hết hạn mức…", 1.000 về số dư, vẫn ở trong phòng; bấm ghế lại → hạn mức mới 5.000 | P1 |
| F-11 | Phòng Blind "Hoàn toàn may rủi" có tick "Nặn bài", 2 người thật; vào ván; người thứ nhất bóc cả hai lá bằng chuột (kéo từ mép dưới vào), người thứ hai bấm "Lật" | Đầu phòng có huy hiệu "Nặn bài"; mỗi người thấy bài của mình úp, dòng "Nặn bài của bạn…" và đồng hồ vòng ngay trên tấm tên của mình; bóc một lá chưa tính là đã lật (ghế kia chưa thấy "Đã lật"), bóc lá thứ hai thì ghế kia thấy "Đã lật" và khay báo "Đã lật — chờ người chơi khác"; người thứ hai bấm "Lật" thì cả hai lá mở, vòng nặn kết thúc **trước 20 giây**, lá chung ra và phiếu kết quả hiện | P1 |
| F-12 | Như F-11 trên điện thoại 375 × 812 có cảm ứng, 1 người thật + 1 bot; bóc một lá bằng ngón tay, lá còn lại bằng "Lật" | Hai lá, nút "Lật" và đồng hồ nằm trọn trong màn hình, trên khay; trang không cuộn ngang, trang và bàn không cuộn dọc, tên người chơi hiện đủ cạnh đồng hồ vòng, không chữ nào đè lên chữ khác; cú chạm là `pointerType: touch` và bóc được lá; bot đã lật từ đầu nên vòng kết thúc ngay khi người thật lật nốt | P2 |

### G. Kết nối

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| G-01 | Giữa ván, tải lại trang | Về đúng ghế, đúng bài, đúng lượt | P1 |
| G-02 | Tắt wifi 20 giây rồi bật lại | Người khác thấy ghế ghi "Mất kết nối"; máy mình hiện "Mất kết nối — đang kết nối lại…"; nối lại thì chơi tiếp | P1 |
| G-03 | Tắt wifi > 90 giây | Sau ván, bị đứng dậy, stack về số dư; bật lại vẫn thấy phòng (người xem) | P2 |
| G-04 | Chủ phòng rời phòng | Người vào phòng sớm nhất còn lại thành chủ phòng; bot không bao giờ là chủ | P1 |
| G-05 | Điện thoại khoá màn hình 1 phút rồi mở lại | Trang tự nối lại, không phải đăng nhập lại | P2 |

### H. Kinh tế và sổ điểm

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| H-01 | Sau mỗi ván (Blind: sau khi đứng dậy), so số dư với Hồ sơ → Lịch sử điểm. Ở Blind, tiền của từng ván nằm ở **chồng trên bàn** (đọc ở ghế và trên phiếu kết quả), không ở số dư; sổ chỉ có "Vào bàn" khi ngồi và "Rời bàn" khi rời ghế | Mỗi thay đổi có một dòng tương ứng, cộng trừ khớp số dư. Blind: "Vào bàn" (−hạn mức, hoặc −toàn bộ số dư nếu thấp hơn) và "Rời bàn" (+chồng) cho ra kết quả ròng của **cả lần ngồi**, không phải của từng ván. Ngoài hai dòng đó, số dư chỉ đổi khi có thưởng thành tựu, điểm danh, cứu trợ hoặc pot cộng dồn được chia ("Hoàn điểm"), mỗi thứ một dòng riêng — đối chiếu những dòng đó cùng | P1 |
| H-02 | Tài khoản mới, chưa nhận điểm danh (100.000): tạo phòng Blind Hoàn toàn may rủi mức cược 50.000, ngồi vào bàn (không cần chơi) — ghế lấy hết 100.000 (hạn mức 250.000) nên số dư về 0 ngay → mở trang Điểm danh, bấm Nhận cứu trợ (không nhận thưởng ngày) | Số dư lên đúng 5.000; bấm lại trong 24 giờ bị từ chối. Cứu trợ chỉ xét số dư: điểm đang nằm trên bàn không được tính — xem `docs/known-limitations.md` | P1 |
| H-03 | Cộng tổng stack cả bàn trước và sau một ván Hold'em | Tổng sau = tổng trước − phí bàn (2 % pot, tối đa 1 BB) | P1 |

### I. Điểm danh

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| I-01 | Đăng nhập lần đầu trong ngày | Tự mở trang Điểm danh một lần; lần đăng nhập sau trong ngày thì vào sảnh | P2 |
| I-02 | Nhận thưởng hai lần | Lần hai bị khoá | P1 |
| I-03 | Xem "Lần điểm danh tiếp theo" | 00:00 giờ Việt Nam hôm sau | P3 |
| I-04 | Ngày 7, 14, 21, 28 của chuỗi | Nhận thêm vật phẩm (không thử được trong một ngày — đã có test tự động; nếu có người chơi đủ chuỗi thì ghi lại) | P3 |

### J. Tủ đồ (ngoại hình)

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| J-01 | Tủ đồ → Ngoại hình: bấm Nữ / Nam ở đầu nhóm; ở tab Kiểu tóc chọn vài kiểu; đổi màu tóc, màu da, màu mắt; đội một chiếc mũ rồi quay lại Kiểu tóc; bấm Hoàn tác | Nút Nữ \| Nam luôn ở đầu nhóm Ngoại hình (cả bốn tab Kiểu tóc, Màu tóc, Màu da, Màu mắt). Đổi giới tính: kiểu tóc chuyển sang kiểu tương ứng (ví dụ Tóc bob ↔ Tóc rối), quần áo đổi bản cắt, màu và mũ giữ nguyên; tab Kiểu tóc chỉ hiện 4 kiểu của giới tính đang chọn, mỗi thẻ là chân dung đầu đúng màu tóc, màu da hiện tại và không đội mũ. Hình xem trước đổi ngay; màu áp đúng lên tóc/da/mắt, không lem sang nhau. Đổi màu tóc: đầu và tóc vẫn còn, chỉ đổi màu; đổi màu mắt: mắt đổi màu, không còn mắt gốc (review 29/09 No15, No16). Hoàn tác đưa cả giới tính về như đã lưu (nhân vật v4, Kế hoạch 19) | P1 |
| J-02 | Đội mũ | Tóc không lòi qua mũ (trừ mũ lưỡi trai) | P2 |
| J-03 | Đổi đồ → Hoàn tác | Quay về trạng thái đã lưu | P2 |
| J-04 | Đổi đồ → Lưu → mở Sảnh / vào bàn | Hình đại diện mới hiện ở sảnh và trên ghế; người khác trong bàn cũng thấy | P1 |
| J-05 | Lưu bộ đồ vào ô trống → mặc bộ khác → áp dụng lại bộ đã lưu | Đúng bộ đã lưu | P2 |
| J-06 | Bấm nút ‹ và › hai bên tên biểu cảm dưới sân khấu (hoặc phím ← →) để đi qua các biểu cảm (Bình thường, Vui, Buồn, …); thử từ Bình thường bấm ‹, và từ Ngủ bấm › | Tên giữa hai nút đổi theo và hình xem trước đổi biểu cảm; không cần lưu. Đi hết vòng thì quay lại (Bình thường ‹ → Ngủ, Ngủ › → Bình thường). Trên điện thoại hai nút to bằng ngón tay, hàng không xuống dòng (review 29/09 No10) | P3 |
| J-07 | Trên điện thoại: cuộn trang tủ đồ, mở "Đang dùng", "Bộ đồ đã lưu" | Không tràn ngang, bấm được mọi thẻ | P2 |
| J-08 | Tủ đồ: nhìn các hàng thẻ trong từng tab (Mũ, Quần áo, Danh hiệu & Huy hiệu…; tích "Hiện cả món chưa có" để thấy cả thẻ chưa có) | Thẻ cùng hàng cao bằng nhau, độ hiếm nằm ngay dưới tên; tiêu đề "Huy hiệu" không dính vào thẻ "Tay nóng" phía trên (review 29/09 No8b, No11b) | P3 |
| J-09 | Tài khoản mới: mở tủ đồ → tab Mũ → Quần áo → tích "Hiện cả món chưa có" → đổi sang Mũ, Danh hiệu & Huy hiệu → rời tủ đồ rồi mở lại | Mặc định chỉ hiện món đã có: Mũ ghi "Bạn chưa có món nào ở mục này.", Quần áo có bộ thường ngày với 5 chấm: chấm không màu của chính bộ gốc rồi 4 màu áo phông. Tích ô thì hiện cả món chưa có (có khóa) và ô vẫn tích khi đổi tab; mở lại tủ đồ thì ô bỏ tích. Có biến thể màu mà chưa có món gốc (ví dụ được tặng "Mũ nồi xanh dương"): thẻ hiện chính biến thể đó, ảnh tô đúng màu của nó, bấm là mặc (review 29/09 No11a, No8a). Mặc một biến thể (ví dụ chấm "Áo phông đỏ"): thẻ đổi sang tên và màu của biến thể đó, có nhãn "✓ Đang dùng"; bấm chấm ô cờ đầu hàng (bộ gốc) thì về lại "Bộ thường ngày" — trên điện thoại chấm vẫn nhỏ nhưng chạm hơi lệch vẫn trúng. Tích ô chỉ thêm thẻ và chấm: thẻ "Mũ nồi xanh dương" vẫn là chính nó, không đổi thành mũ gốc bị khóa (đợt sửa cuối Plan 18) | P2 |

### K. Thành tựu, Hồ sơ

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| K-01 | Hồ sơ: nhìn các nút dưới tên; rồi mở địa chỉ cũ `#/inventory` (dán vào thanh địa chỉ), sau đó bấm Back của trình duyệt | Hồ sơ chỉ còn hai nút: Phòng thay đồ và Thành tựu, không còn "Kho đồ". Địa chỉ cũ mở thẳng Phòng thay đồ (thanh địa chỉ đổi thành `#/avatar`); Back về trang trước đó chứ không quay lại `#/inventory` (review 29/09 No5; ngày nhận và nguồn gốc của món không còn hiện ở đâu cả, có chủ đích) | P2 |
| K-02 | Chơi đủ 10 ván Blind (bàn có bot, bật tự động bắt đầu). Hết hạn mức thì bị mời đứng dậy (F-10) nên phải bấm ghế để ngồi lại (Sẵn sàng, bật lại Tự động chơi) thì mới đủ 10 ván | Hiện thông báo "Đạt thành tựu mới: Mười ván Blind Poker", +2.000 điểm; trang Thành tựu cập nhật | P1 |
| K-03 | Vào 10 phòng khác nhau | Thành tựu "Mười phòng" mở | P3 |
| K-04 | Hồ sơ → Thống kê sau vài ván | Số ván chơi/thắng tăng đúng; "Ván gần đây" ghi "Tại bàn `<tên phòng>`" (hoặc "Tại `<tên phòng>`" khi tên phòng đã bắt đầu bằng "Bàn", không lặp chữ), đối thủ là bot hiện "Bot 1", "Bot 2"… chứ không hiện mã kiểu `bot:…` (review 29/09 No4); tên bot in nghiêng, không có huy hiệu "bot" nhìn thấy (vòng 2 R2-2) | P2 |
| K-05 | Hồ sơ → đổi tên hiển thị | Tên mới hiện ở sảnh, bàn, cài đặt; tên trùng người khác bị từ chối | P2 |

### M. Giao diện trên nhiều cỡ màn hình

Làm trên D1, T1, P1, P2 cho các màn: Đăng nhập, Sảnh, Tạo phòng, Bàn (trước và trong ván), Điểm danh, Hồ sơ,
Tủ đồ, Thành tựu, Cài đặt.

| Mã | Kỳ vọng | Ưu tiên |
|---|---|---|
| M-01 | Không có thanh cuộn ngang, không chữ bị cắt, không chữ đè lên chữ khác, không nút bị che | P2 |
| M-02 | Trên điện thoại, ghế của chính mình và các nút hành động nhìn thấy đủ trong bàn | P1 |
| M-03 | Chữ tiếng Việt có dấu hiển thị đúng font, không vỡ dòng giữa từ | P3 |
| M-04 | Nền sáng: chữ đọc được trên mọi nền (vàng trên kem, xanh trên xanh) | P3 |
| M-05 | Máy tính 1920×940 và 1366×768, vào bàn (chờ, trong ván, thẻ kết quả nhiều dòng): trang không có thanh cuộn dọc; ghế của mình chỉ còn hai dòng dưới bảng tên; "Ván tiếp theo sau…" nằm ở chân thẻ kết quả chứ không đè ghế; thân thẻ cuộn được bên trong và mờ ở chân khi còn cuộn được (review 29/09 No2, No11b) | P2 |

**Luật "không chữ đè chữ" (review 2026-09-29, No11b) đã thành test tự động:** `pnpm e2e:normal` đo mọi màn hình
kể trên — trừ Tủ đồ chỉ bốn tab (Ngoại hình, Mũ, Quần áo, Danh hiệu & Huy hiệu; ba tab đồ đo khi đã tích "Hiện cả
món chưa có", để có đủ thẻ) — ở 1920×940 (màn hình của bạn), 1366×768 và 375×812, gồm bàn Blind lúc chờ, trong ván
và thẻ kết quả; bộ `e2e/ops` đo thêm bàn Hold'em đang chơi và thẻ kết quả ở 1440×900 và ba cỡ trên, bàn Blind đang
chơi và thẻ kết quả ở 1440×900. Cách đo và những gì nó không thấy: `docs/ui-kit.md`, mục "The text-overlap rule";
màn nào, trạng thái nào, cỡ nào và test nào: `docs/test-matrix.md`. Người test vẫn nhìn bằng mắt những gì máy không
đo: chữ đè lên hình hay chạm mép thẻ, chữ trong ô nhập, bản English, và các cỡ màn hình khác.

### N. Vận hành máy chủ (người vận hành)

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| N-01 | `run.ps1 -NoMigrate` | In pid, địa chỉ LAN; `/health` báo ok | P1 |
| N-02 | Chạy `run.ps1` lần hai khi server đang chạy | Từ chối, không mở tiến trình thứ hai | P2 |
| N-03 | `stop.ps1` khi đang có người ở bàn | Cảnh báo tắt cứng; số dư đã ghi trong database còn nguyên sau khi chạy lại | P2 |
| N-04 | Xem `deploy/normal-windows/normal.log` sau đợt test | Không có dòng lỗi lặp lại, không có mật khẩu hay cookie trong log | P1 |
| N-05 | Deploy bản mới trong lúc có tab đang mở (cùng B-04) | Người dùng tự nhận bản mới, không trang trắng | P1 |

### O. Bản Lite (exe)

| Mã | Bước | Kỳ vọng | Ưu tiên |
|---|---|---|---|
| O-01 | `pnpm build:lite`, chép thư mục `apps/lite/release/lite/` sang máy khác, chạy exe | Console in `Listening on http://0.0.0.0:8080`, trình duyệt mở được | P1 |
| O-02 | Nhập tên hiển thị → vào sảnh | Có 100.000 điểm, không cần email | P1 |
| O-03 | Máy khác trong LAN vào, cùng chơi một bàn Blind và một bàn Hold'em | Như mục E, F | P1 |
| O-04 | `bind-poker-lite.exe --status` rồi `--stop` | In JSON trạng thái; tắt êm, mã thoát 0 | P2 |
| O-05 | Chạy exe thứ hai trên cùng thư mục dữ liệu | Từ chối: `another instance is already running (pid …)` | P2 |
| O-06 | Tắt rồi mở lại exe | Số dư và tên còn nguyên (SQLite) | P1 |

## 6. Kịch bản nhiều người (vòng 3, 3–4 người, ~45 phút)

1. Cả nhóm đăng nhập; A tạo phòng Hold'em 100/200, buy-in 50–200 BB, 30 giây, 6 ghế.
2. B, C vào bằng danh sách; D vào bằng mã phòng. A mang vào 50 BB, những người khác 200 BB (để có pot phụ).
3. Chơi 10 ván. Trong lúc chơi: B tải lại trang giữa ván (G-01); C tắt wifi 20 giây (G-02); D dùng
   nút chọn trước (E-06); A để hết giờ một lần (E-07).
4. Khi A hết stack: A đứng dậy rồi ngồi lại với mức mang vào mới — kiểm số dư A (H-01).
5. A rời phòng khi đang là chủ phòng → kiểm chủ phòng mới (G-04).
6. Chuyển sang phòng Blind "Chơi hoặc bỏ", mức cược 1.000, 2 lá, 1 bot. Chơi 10 ván; có ít nhất một ván
   cả nhóm cùng Bỏ để xem pot cộng dồn (F-04). Ai tiêu hết hạn mức 5.000 bị mời đứng dậy — bấm ghế để vào lại (F-10).
7. Mọi người thật bấm Tạm nghỉ, chờ 60 giây → pot cộng dồn được chia (F-05). Rời hết → phòng (còn 1 bot) biến
   mất khỏi sảnh ngay (C-07); "Đang đóng…" 60 giây chỉ có ở phòng không bot (C-06).
8. Mỗi người mở Hồ sơ → Lịch sử điểm, đối chiếu số dư (H-01), ghi lại số dư cuối.

## 7. Tiêu chí đạt

- Vòng 0 xanh.
- 100 % ca **P1** đạt trên D1 và ít nhất một điện thoại.
- Không có lệch điểm (H-01, H-03) — một lần lệch là lỗi nghiêm trọng, dừng đợt test.
- Không có trang trắng hay mất kết nối vĩnh viễn.
- Ca **P2** hỏng được ghi vào `docs/bug-log.md` kèm hướng sửa để bạn chọn.

## 8. Bảng ghi kết quả

Chép bảng này cho mỗi người test.

| Mã | D1 | D2 | T1 | P1 | P2 | Ghi chú / mã lỗi |
|---|---|---|---|---|---|---|
| S-01 | | | | | | |
| … | | | | | | |

## 9. Sau đợt test

1. Người vận hành: `/health` báo `"rooms":0` rồi mới `stop.ps1` hay deploy lại.
2. Claude: gom lỗi vào `docs/bug-log.md` (mã ca test, bước tái hiện, ảnh), đề xuất hướng sửa; chỉ sửa khi bạn duyệt.
3. Nếu có thay đổi lớn, chạy lại vòng 0 và vòng 1 trước khi mở lại cho nhóm.
