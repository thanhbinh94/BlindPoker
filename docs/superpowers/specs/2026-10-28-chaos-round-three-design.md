# BP-41 — Poker hỗn loạn, vòng 3: thẻ đột biến, Thần Bài, xúc xắc vận may

Spec thiết kế, 2026-10-28. Bổ sung spec gốc `2026-10-26-chaos-poker-design.md` (BP-37) và `2026-10-27-chaos-feedback-design.md`
(BP-39). Chỗ spec này nói khác thì spec này thắng; chỗ không nhắc thì giữ nguyên. Chỗ ghi **(phiên chọn)** là quyết định của
phiên, người dùng sửa khi duyệt. Trang phục / phụ kiện / hào quang Thần (mục 9) là **phase sau**, không thuộc spec này.

## 1. Ý định

Người chơi thích sự bất ngờ của bàn hỗn loạn và muốn **hỗn loạn hơn nữa**: thẻ đột biến, thẻ lật kèo thật sự, những khoảnh khắc
cả bàn cùng la lên ("X đã trở thành Thần Bài!", ba con 6 nổ hũ). Vòng này thêm khoảng 39 thẻ mới, một hệ **Thần Bài / Bán Thần**
có thông báo nổi và danh hiệu, và họ thẻ **Xúc xắc vận may** kiểu Đấu Trường Chân Lý.

**Thành công:** bàn hỗn loạn có những ván đảo chiều mà người chơi kể lại; Thần Bài xuất hiện thỉnh thoảng (không phải mỗi ván), ai
cũng thấy và muốn hạ Thần; danh hiệu Hóa Thần / Bán Thần / Kẻ Sát Thần được săn.

**Không làm:** trang phục Thần (phase sau); không đổi bàn Blind thường, Hold'em, Lite; không cân lại 47 thẻ cũ (H6 chờ thống kê).

**Phản mục tiêu:** một người bị cả bàn "hành" tới cháy túi trong vài ván mà không có cửa gỡ; Thần Bài xuất hiện liên tục làm bàn
mất vui; điểm mới in ra không kiểm soát được (GM không có nút hạ); một hiệu ứng mà người chơi không hiểu vì sao mình thua.

## 2. Quyết định của người dùng

| # | Câu hỏi | Người dùng chọn |
|---|---|---|
| G1 | Rào chắn kinh tế ("thẻ không đổi mức cược, không ai mất quá phần đã đặt") cho các thẻ mạnh? | **Mở rào** để tăng độ vui; có vấn đề thì GM tắt từng thẻ. |
| G2 | Thêm các thẻ người dùng nêu (Siêu cộng dồn, Liều ăn nhiều, Nâng tầm uy lực, Mạo hiểm gia, Đảo bài, Ép chia thưởng, Cướp đoạt, Ép cược → đổi tên, Cấm bỏ bài, Thách đấu)? | Có, phiên đánh giá cấp. |
| G3 | Thêm thẻ hỗn loạn / lật kèo, tập trung Vàng và Kim cương? | Có; phiên đề xuất, người dùng duyệt bộ thẻ ở mục 6. |
| G4 | Cá chép hóa rồng (Kim cương) với Thần Bài / Bán Thần? | Có, theo mô tả của người dùng (mục 4). |
| G5 | Thần Bài / Bán Thần kéo dài bao lâu? | **5 ván**; phiên thêm: Thần bị đánh bại thì mất ngôi ngay, hiệu ứng xấu chỉ 3 ván đầu (người dùng: "hợp lý"). |
| G6 | Thưởng danh hiệu? | **Tăng cao**: Hóa Thần 300.000 điểm + 300 danh vọng; Bán Thần 150.000 + 150; Kẻ Sát Thần (thắng Thần 2 lần) 500.000 + 500. |
| G7 | Thông báo Thần / Bán Thần / hạ Thần? | Phải **thật nổi** để thu hút; câu chữ người dùng đặt (mục 4.5). |
| G8 | Tỉ lệ cấp khung chọn thẻ? | **50 / 35 / 15** (Bạc / Vàng / Kim cương), thay 60/30/10. |
| G9 | Thẻ gieo xúc xắc lấy thưởng kiểu Đấu Trường Chân Lý? | Có, họ 3 cấp; **Kim cương cộng đủ 3 xúc xắc** (mục 5). |
| G10 | Trang phục / phụ kiện / hào quang Thần, Bán Thần, Kẻ Sát Thần? | **Phase sau.** |
| G11 | Bộ lá A của Thần có được bảo vệ? | **(a) Có**: Thần miễn nhiễm mọi thẻ cướp / đổi / xáo / chia lại bài riêng; Nhật thực không tắt Thần; muốn hạ Thần phải ghép bộ mạnh hơn. Ở bàn "Chơi hoặc bỏ", trong lúc có Thần **không ai được Bỏ bài** (như Cấm bỏ bài), để luôn có người đối đầu. |
| G12 | Bot có tính cho danh hiệu? | Danh hiệu chỉ tính ở **bàn có ít nhất 2 người thật**; **Thần là bot thì không tính danh hiệu** (hạ Thần bot không tính Kẻ Sát Thần). Người hạ Thần bot vẫn nhận 2 thẻ Kim cương (phiên chọn: thưởng trong ván, không phải danh hiệu). |

## 3. Luật chung cho thẻ mới

- Mọi luật BP-37/BP-39 giữ nguyên trừ chỗ mục 3–6 nói khác: thẻ đến từ khung chọn (tự áp) hoặc thẻ thưởng (giữ trên tay, bấm "Dùng");
  một debuff mỗi ghế mỗi ván; mỗi người chịu tối đa một debuff mỗi ván; Khiên/Gương chặn debuff; Đóng băng chặn áp thẻ; bàn
  "Hoàn toàn may rủi" không có thẻ chỉ dành cho "Chơi hoặc bỏ" (✱).
- **Rào chắn mở (G1)** chỉ cho các thẻ đánh dấu 🔓 ở mục 6: chúng được đổi mức cược, chuyển tiền giữa người chơi, hoặc ép chơi.
  Mọi thẻ khác vẫn theo rào cũ. Không thẻ nào làm stack âm: khoản phải trả vượt stack thì trả tới hết stack (như tất tay).
- **"Miễn nhiễm rút bài"** (chống hiệu ứng rút bài) nghĩa là các hiệu ứng lấy / hạ / tráo / cướp lá riêng của người đó
  (`stealHole`, `lowerHole`, `swapHands`, Cướp đoạt, Đổi lá hàng xóm, Xào bài, Hoán vị định mệnh, Đổi bài liều, Ngược dòng,
  Lời nguyền) không tác dụng lên họ trong thời gian đó (báo "không có tác dụng").
- **"Bài mạnh nhất trước khi lật"** (Cướp đoạt, Liều ăn nhiều, Sới lớn) tính trên các lá riêng (2 hoặc 3 tùy bàn) trước khi có lá
  chung, theo thứ hạng tay bài thường (đôi > lá cao…), để vẫn còn khả năng thua sau khi lật 5 lá chung.
- **Lá A có hạn** (4 lá trong bộ): các hiệu ứng đòi lá A (Thần Bài, Siêu cộng dồn) lấy theo thứ tự áp; thiếu lá A thì lấy lá cao
  nhất còn lại (phiên chọn).
- **Điểm mới** (nổ hũ, bạo kích của Thần Bài / Bán Thần / Liều ăn nhiều / Thách đấu khi thắng hũ, xúc xắc) tính vào trần điểm thẻ
  mỗi ngày (`chaos_config.dailyCapPoints`, hiện 10.000.000 trên VPS) và ghi sổ như `chaos_crit` / `chaos_fortune`, hoặc reason mới
  nếu cần (người dựng chọn, có test bảo toàn). **Chuyển tiền giữa người chơi** (Thách đấu, Thuế thắng, Ép chia thưởng, Bom nổ chậm,
  Thần Bài thách đấu) không tạo điểm: trừ người này, cộng người kia, cùng ván. **Mất điểm do xúc xắc xui** là một dòng thoát (sink)
  riêng trong sổ.
- **Thẻ nào là debuff** (Khiên / Gương chặn, tính vào "một debuff mỗi ghế / mỗi người mỗi ván") (phiên chọn): thẻ **nhắm vào một
  người cụ thể** — Cướp đoạt, Đổi bài liều, Ngược dòng, Lời nguyền, Đổi lá hàng xóm, Xào bài, Bom nổ chậm, Thách đấu (bạc, vàng),
  Kẻ phá đám, Trộm điểm. **Không phải debuff** (luật của ván / dòng tiền cả bàn): Thuế thắng, Ép chia thưởng, Cấm bỏ bài, Hoán vị
  định mệnh, Đại hồng thủy, Nhật thực, Sới lớn. Với hiệu ứng nhắm **nhiều ghế**, Gương chỉ **chặn** cho ghế có Gương (không dội
  ngược); Khiên cũng vậy.
- **Thiếu lá trong bộ** (Đại hồng thủy, Lá chung thứ sáu, thêm lá…): hiệu ứng nào cần nhiều lá hơn số còn lại thì "không có tác
  dụng" (như các thẻ chia lại hiện có) (phiên chọn).
- **Mạo hiểm gia — cược nhân** (phiên chọn): phần cược vượt mức của người giữ là **tiền chết** vào pot (không ai cần theo, không trả
  lại như cược không ai theo); người thắng pot lấy cả phần đó. Nhân áp cho **toàn bộ** phần đặt của người giữ trong ván (cả mức cược
  đầu ván và phần "Chơi"); nổ hũ 5 × **mức cược cơ bản**.
- Bot nhận và dùng thẻ mới như thẻ cũ. Điểm của bot là điểm ảo; khoản chuyển giữa bot và người thật đi theo luật hiện có
  (stack bot ảo, không ghi sổ).

## 4. Cá chép hóa rồng — Thần Bài / Bán Thần

### 4.1 Thẻ

- Kim cương, `wait` (thẻ chờ điều kiện, giữ tới khi kích hoạt; không phải bấm). Đến từ khung chọn hoặc thẻ thưởng.
- **Năng lượng:** mỗi ván người giữ thẻ **thua**, năng lượng +5..+7 % (ngẫu nhiên, nguyên). Đầu mỗi ván (trước khi chia), tung theo
  năng lượng: trúng → **hóa Thần Bài** ở ván đó; năng lượng ≥ 100 % → chắc chắn hóa ở ván kế tiếp. Năng lượng hiện trên thẻ (tooltip).
- **Thắng khi chưa hóa thần** → thành **Bán Thần** ngay ván kế tiếp.
- Hóa Thần hoặc Bán Thần → thẻ dùng hết.

### 4.2 Thần Bài (5 ván)

- **Một Thần mỗi bàn tại một thời điểm.** Người thứ hai trúng khi ngôi đang có người → năng lượng giữ nguyên, tung lại ván sau khi
  ngôi trống (phiên chọn).
- Mỗi ván làm Thần: **toàn lá A** (2 hoặc 3 tùy bàn; thiếu A theo mục 3); **thắng thì bạo kích** ×2 / ×3 / ×4 với tỉ lệ 40 % / 25 % /
  10 % (phiên chọn, trong dữ liệu thẻ).
- **3 ván đầu** áp lên **mọi người khác** một hiệu ứng xấu, **chọn ngẫu nhiên một lần** lúc hóa thần (phiên chọn):
  1. **Thần rút bài:** mỗi ván, mỗi người khác mất 1 lá ngẫu nhiên lúc lật bài (không lấy lá cuối).
  2. **Thần thách đấu** 🔓: mỗi ván, Thần thách đấu riêng từng người còn trong ván: ai thua Thần (so tay bài) trả Thần 1 mức cược của
     bàn; ai thắng Thần được Thần trả 1 mức cược.
  3. **Thần tráo bài:** mỗi ván, bài riêng của những người khác bị xáo ngẫu nhiên giữa họ lúc lật bài.
  Khiên / Gương chặn hiệu ứng này như debuff thường (Gương phản về Thần). Hiệu ứng xấu của Thần **không** tính vào giới hạn
  "một debuff mỗi ván" của người chịu (phiên chọn: nó là luật của ván, không phải một thẻ).
- **Mất ngôi sớm:** một người **thắng ván mà Thần có chơi và thua** (Thần không thắng pot nào) → người thắng **hạ Thần**: Thần mất ngôi
  từ ván sau, người hạ Thần nhận **2 thẻ Kim cương ngẫu nhiên** (vào tay thẻ thưởng nếu còn chỗ, thẻ chờ điều kiện tự vào; tay đầy thì
  thẻ thứ hai bị bỏ — phiên chọn) và tính 1 lần "hạ Thần". Nhiều người cùng thắng (chia pot) → mỗi người được tính.
- Thần rời ghế / bị đóng băng ở một ván: ván đó không có hiệu ứng Thần; rời bàn thì mất ngôi.
- **Bảo vệ Thần (G11):** trong lúc giữ ngôi, Thần miễn nhiễm rút bài (mục 3) và mọi hiệu ứng xáo / chia lại / cướp / đổi bài riêng
  (kể cả Hoán vị định mệnh, Đại hồng thủy với bài riêng của Thần, Ngược dòng, Cướp đoạt, Đổi bài liều); Nhật thực và Kẻ phá đám
  không tắt được Thần. Thẻ làm mạnh bài của người khác (Lá ma, Lá chung thứ sáu, Giữ bộ tốt hơn…) vẫn chạy bình thường.
- **Không bỏ bài khi có Thần (G11):** ở bàn "Chơi hoặc bỏ", mỗi ván có Thần (kể cả 2 ván cuối), không ai được chọn "Bỏ bài"; người
  "Tự động chơi" tự Chơi.

### 4.3 Bán Thần (5 ván)

- Mỗi ván: **bài mạnh** (như "Giữ bộ tốt hơn" 3 bộ, `bestOfN` sets 3) và **thắng thì bạo kích** ×2 / ×3 với 30 % / 10 % (phiên chọn).
- Không áp gì lên người khác; thua không mất danh (hết 5 ván mới hết). Có thể có Bán Thần cùng lúc với Thần Bài.

### 4.4 Danh hiệu (G6)

| Danh hiệu | Điều kiện | Thưởng |
|---|---|---|
| Hóa Thần | Thành Thần Bài lần đầu | 300.000 điểm + 300 danh vọng + vật phẩm danh hiệu `title_god` |
| Bán Thần | Thành Bán Thần lần đầu | 150.000 điểm + 150 danh vọng + `title_demigod` |
| Kẻ Sát Thần | Hạ Thần 2 lần (cộng dồn mọi bàn) | 500.000 điểm + 500 danh vọng + `title_godslayer` |

- Theo hệ thành tựu hiện có (`achievements.json`, chỉ số người chơi mới: số lần hóa thần, bán thần, hạ thần), mỗi danh hiệu thưởng **một
  lần**. Đây là **ngoại lệ** của luật Q13 (ván hỗn loạn không tính thành tựu): chỉ ba chỉ số này được tính ở bàn hỗn loạn.
- Thưởng không tính vào trần điểm thẻ mỗi ngày (là thành tựu, ghi sổ như thành tựu). Bot không nhận danh hiệu.
- **Chống cày (G12):** một lần hóa Thần / Bán Thần / hạ Thần chỉ được đếm cho danh hiệu khi ván đó có **ít nhất 2 người thật** ngồi
  bàn; hạ một Thần là bot **không** được đếm.
- Danh vọng thưởng **riêng từng danh hiệu** (300 / 150 / 500): dữ liệu thành tựu thêm trường danh vọng riêng cho một thành tựu (hôm nay
  danh vọng theo luật chung `achievement_item`) — phiên chọn, để giữ đúng con số người dùng đặt.
- Vật phẩm danh hiệu là danh hiệu hiển thị như `title_*` hiện có (chữ, không cần tranh); trang phục Thần là phase sau.

### 4.5 Thông báo nổi (G7)

- Câu chữ (vi; en do phiên dịch):
  - "Cảnh báo: {tên} đã tích luỹ đủ năng lượng và trở thành Thần Bài!"
  - "Cảnh báo: {tên} đã chiến thắng định mệnh và trở thành Bán Thần!"
  - "{tên} đã đánh bại Thần Bài!"
- **Băng thông báo lớn** chạy ngang màn hình, chữ to, màu vàng-đỏ rực, hiệu ứng sáng / rung nhẹ khoảng 3 giây, cho **mọi người trong
  phòng** (kể cả người xem). Hiện **đầu ván** (hóa thần, bán thần) hoặc **lúc tính tiền** (hạ thần). Không đè dải kết quả / khung chọn
  thẻ lâu hơn 3 giây; chạm để tắt sớm. Có đường giảm chuyển động (chỉ hiện chữ, không rung). Ghế Thần / Bán Thần có viền / huy hiệu
  riêng suốt thời gian giữ ngôi, kèm số ván còn lại.
- Thông báo cũng có một dòng trong toast của ván như thẻ thường.

## 5. Xúc xắc vận may (G9)

Họ 3 thẻ, `wait`-kiểu "cuối ván": gieo **khi ván kết thúc** (thắng hay thua đều gieo), 1 lần rồi hết thẻ. Cả bàn thấy xúc xắc lăn
(~1,5 giây, có đường giảm chuyển động) và kết quả.

| Cấp | Gieo | Kết quả |
|---|---|---|
| Bạc | 1 con | 1–2: không gì · 3–4: +2 điểm hỗn loạn · 5: 1 thẻ Bạc · 6: 1 thẻ Vàng |
| Vàng | 2 con, cộng | 2: mất 1 mức cược · 3–6: +3 điểm hỗn loạn · 7–9: 1 thẻ Vàng · 10–11: 1 thẻ Kim cương · 12: nổ hũ 10 × mức cược |
| Kim cương | 3 con, **cộng đủ cả 3** | 3: mất 2 mức cược · 4–7: +5 điểm hỗn loạn · 8–11: 1 thẻ Vàng · 12–14: 1 thẻ Kim cương · 15–17: 2 thẻ Kim cương · 18: nổ hũ 30 × mức cược + 1 thẻ Kim cương + thông báo nổi |

- **Ba con giống nhau** (Kim cương): gấp đôi thưởng của ô đó, kể cả số thẻ (phiên chọn). Vì tổng 3 chỉ có 1-1-1 và 18 chỉ có
  6-6-6, hai ô đầu / cuối thực tế là: **1-1-1 mất 4 mức cược**; **6-6-6 nổ hũ 60 × mức cược + 2 thẻ Kim cương + thông báo nổi**. Các
  bộ ba khác: 2-2-2 (6) +10 điểm hỗn loạn · 3-3-3 (9) 2 thẻ Vàng · 4-4-4 (12) 2 thẻ Kim cương · 5-5-5 (15) 4 thẻ Kim cương.
- Thẻ nhận được đi theo luật thẻ thưởng (tay thẻ thưởng, hoặc tự chạy nếu là thẻ chờ điều kiện). Nổ hũ = điểm mới (trần ngày).
  Mất mức cược = trừ stack (tới hết stack), dòng thoát riêng.
- Bàn "Hoàn toàn may rủi" và "Chơi hoặc bỏ" đều dùng được.

## 6. Bộ thẻ mới (39 thẻ: 12 Bạc, 13 Vàng, 14 Kim cương)

Cột "Lúc": chia (deal) / chọn (decision, chỉ "Chơi hoặc bỏ" ✱) / lật (reveal) / cuối ván / chờ (wait) / ngay (now). Số ván là thời hạn.
Tên tiếng Anh do phiên dịch. Mọi con số nằm trong `params` của dữ liệu thẻ (GM đổi được trọng số / bật tắt như thẻ cũ).

### 6.1 Kim cương (14)

| Thẻ | Lúc | Làm gì |
|---|---|---|
| Cá chép hóa rồng | chờ | Mục 4. |
| Siêu cộng dồn | chia | Mỗi ván +5..7 % cơ hội được **toàn lá A**; tới 100 % thì chắc chắn; nổ xong về 0, thẻ hết. Thời hạn: tới khi nổ (tối đa 20 ván — phiên chọn). |
| Liều ăn nhiều | chia | Tối đa 10 ván, tới khi thắng: **bớt 1 lá** (bàn 2 lá còn 1), bù lại "Giữ bộ tốt hơn" 3 bộ và **miễn nhiễm rút bài**; thắng thì bạo kích ×3/×4/×5 (50/30/20 %) rồi hết thẻ. |
| Mạo hiểm gia 🔓 | chia | Tối đa 5 ván, tới khi thắng: mức cược **của riêng người giữ** ×2, ×4, ×8, ×16, ×32 (phần dư vào pot như cược thường; thiếu stack thì tất tay). Thắng → nổ hũ 5 × mức cược + 5 điểm hỗn loạn, hết thẻ. Thua đủ 5 ván → hết thẻ. |
| Ép chia thưởng 🔓 | lật | 2 ván: nếu bạn còn trong ván, thua, thì nhận **một nửa phần lời** của người thắng (người thắng trả). |
| Cướp đoạt | chia | 2 ván: bỏ bài mình; lấy từ bài của các đối thủ (không lấy của người miễn nhiễm) những lá ghép thành **tay mạnh nhất trước khi lật**; người bị lấy nhận lá thay thế từ bộ bài; thiếu lá thì lấy lá ngẫu nhiên từ bộ sao cho vẫn mạnh nhất có thể. |
| Hoán vị định mệnh | lật | Bài riêng của mọi người còn trong ván (kể cả bạn) bị xáo ngẫu nhiên giữa họ. |
| Ngược dòng | lật | Sau khi đủ lá chung, nếu bạn không đứng đầu thì **đổi bài với người đang đứng đầu** (một lần). |
| Gậy ông đập lưng ông | lật | Mọi debuff nổ trong ván này (của bất kỳ ai, trừ của bạn) dội ngược về chính người dùng. |
| Đại hồng thủy | lật | Chia lại toàn bộ: bài riêng mọi người còn trong ván và 5 lá chung. |
| Nhật thực | chia | Ván này mọi thẻ của người khác bị tắt (không áp, không mất); chỉ thẻ của bạn chạy. |
| Lá ma | chia | 1 ván: một lá riêng ngẫu nhiên của bạn thành **lá đa năng** (tính như lá bất kỳ để ghép bộ tốt nhất). |
| Bom nổ chậm 🔓 | chia | Bom đặt lên 1 đối thủ ngẫu nhiên, mỗi ván chuyền sang người ngẫu nhiên khác (không phải bạn); hết 3 ván, ai cầm bom trả bạn 1 mức cược. |
| Xúc xắc vận may (KC) | cuối ván | Mục 5. |

### 6.2 Vàng (13)

| Thẻ | Lúc | Làm gì |
|---|---|---|
| Siêu cộng dồn vàng | chia | Như bản KC nhưng chỉ **đôi A**, tối đa 60 %, tối đa 20 ván. |
| Đảo bài | chia | 4 ván, luân phiên +1 lá / −1 lá (bắt đầu +1); ván −1 thì miễn nhiễm rút bài. |
| Sới lớn 🔓 (tên mới của "Ép cược") | chia | 3 ván: **cả bàn** cược ×2 mức cược cơ bản; người mở thẻ được "Giữ bộ tốt hơn" 2 bộ. |
| Thách đấu vàng 🔓 | lật | Thách 1 đối thủ ngẫu nhiên còn trong ván; nếu tay bạn hơn tay họ: 30 % họ trả bạn 2 mức cược, 10 % trả 3. |
| Trộm điểm | ngay | Lấy 5 điểm hỗn loạn của người có nhiều điểm hỗn loạn nhất (không phải bạn). |
| Bia đỡ đạn | chờ | Debuff kế tiếp nhắm vào bạn chuyển sang một người ngẫu nhiên khác. |
| Mắt diều hâu vàng ✱ | chọn | Xem toàn bộ bài riêng của một đối thủ ngẫu nhiên trước khi chọn Chơi / Bỏ. |
| Đổi bài liều | lật | Đổi bài riêng với một đối thủ ngẫu nhiên còn trong ván. |
| Lá chung thứ sáu | chia | Ván này có 6 lá chung cho cả bàn (chọn 5 lá tốt nhất từ 6 + bài riêng). |
| Thuế thắng 🔓 | lật | 3 ván: ai thắng (trừ bạn) nộp bạn 10 % phần lời. |
| Lời nguyền | chia | 3 ván: một đối thủ ngẫu nhiên có lá cao nhất bị đổi thành một lá 2. |
| Xúc xắc định mệnh | lật | Gieo 1 con: 1–2 bạn mất 1 lá (không lấy lá cuối), 3–4 không gì, 5–6 thêm 1 lá và bạo kích ×2 nếu thắng. |
| Xúc xắc vận may (Vàng) | cuối ván | Mục 5. |

### 6.3 Bạc (12)

| Thẻ | Lúc | Làm gì |
|---|---|---|
| Nâng tầm uy lực | chờ | Lần nhận thẻ kế tiếp (khung chọn hoặc thưởng) lên 1 cấp: khung chọn của bạn ra cấp cao hơn cấp của bàn; Kim cương thì giữ nguyên. Ngoại lệ có chủ ý của Q4 ("cả bàn cùng cấp"). |
| Cấm bỏ bài 🔓 ✱ | chia | Ván sau, người khác không được "Bỏ bài" (chỉ "Chơi"); người "Tự động chơi" tự Chơi. |
| Thách đấu bạc 🔓 | lật | Như bản Vàng nhưng chỉ 25 % họ trả 2 mức cược. |
| Mắt diều hâu ✱ | chọn | Xem 1 lá ngẫu nhiên của một đối thủ ngẫu nhiên trước khi chọn. |
| Hên xui | chia | Tung đồng xu: ván này +1 lá hoặc −1 lá. |
| Cao thủ | chờ | Thắng ván kế tiếp → +3 điểm hỗn loạn. |
| Tích tiểu thành đại | chia | 5 ván: mỗi ván thua được thêm +1 điểm hỗn loạn. |
| Xào bài | lật | Một đối thủ ngẫu nhiên bị chia lại 1 lá riêng ngẫu nhiên (debuff). |
| Đổi lá hàng xóm | lật | Đổi 1 lá ngẫu nhiên của bạn với 1 lá ngẫu nhiên của người ngồi bên trái còn trong ván. |
| Kẻ phá đám | chia | Tắt 1 thẻ ngẫu nhiên (đang áp ván này) của một đối thủ ngẫu nhiên. |
| Mồi lửa | chia | 3 ván: mọi người ngồi bàn mỗi ván +1 điểm hỗn loạn. |
| Xúc xắc vận may (Bạc) | cuối ván | Mục 5. |

### 6.4 Cấp và lý do (phiên chọn)

Thẻ đổi hẳn kết quả hoặc dòng tiền (cướp bài, chia thưởng, cược gấp đôi, lá đa năng, chia lại toàn bộ, Thần) là Kim cương; thẻ mạnh
nhưng cần thêm may (đổi bài liều, thách đấu, lá chung thứ sáu) là Vàng; thẻ nhỏ / một lần / chỉ cộng điểm hỗn loạn là Bạc.

## 7. Tỉ lệ cấp và cấu hình

- `DEFAULT_CHAOS_CONFIG.tierWeights` = 50 / 35 / 15 (G8). Khi deploy, dòng `chaos_config` đang có trên VPS (ghi tay 28/10, 60/30/10,
  trần 10.000.000) được đổi `tierWeights` sang 50/35/15, giữ các số khác.
- Mọi thẻ mới có trong `chaos-cards.json` (bật mặc định) và `CHAOS_CARDS_SPEC`; GM bật / tắt / trọng số / khoảng ngày như thẻ cũ. Luật
  "ít nhất 3 thẻ bật mỗi cấp cho mỗi kiểu bàn" giữ nguyên.

## 8. Hiển thị

- Thẻ mới dùng khung thẻ, tooltip, toast, "Thẻ đã dùng", tay thẻ thưởng như BP-39; mỗi kiểu hiệu ứng mới có câu kết quả ngắn trong toast
  (ví dụ "Bom nổ ở {tên}: −1.000", "Xúc xắc 6-6-6!").
- Băng thông báo Thần (mục 4.5), viền / huy hiệu ghế Thần và Bán Thần, xúc xắc lăn (mục 5), thời hạn còn lại trên thẻ (Siêu cộng dồn
  hiện %, Cá chép hiện năng lượng, Thần hiện ván còn lại).
- Kiểm tra màn hình như mọi lần (1920×940, 1366×768, 375×812, 360×780, 780×360), không cuộn, không chữ đè chữ; băng thông báo không
  làm trang cuộn.

## 9. Phase sau (không thuộc spec này)

Trang phục / phụ kiện / hào quang siêu hiếm Thần, Bán Thần, Kẻ Sát Thần: chỉ mở khóa khi có danh hiệu tương ứng và thêm điều kiện mua.

## 10. Ràng buộc

- Điểm ảo; mọi đường tiền mới (chuyển giữa người chơi, nổ hũ, mất do xúc xắc, cược nhân của Mạo hiểm gia / Sới lớn) có test bảo toàn
  `Σ số dư + Σ dòng nguồn/thoát`.
- vi + en cho mọi chuỗi; hoạt ảnh có đường giảm chuyển động; không thêm thư viện runtime; `@bp/core` thuần.
- Thuật ngữ ổn định giữ nguyên ("Tố" không dùng làm tên thẻ — vì vậy "Ép cược" thành "Sới lớn").
- Bàn Blind thường, Hold'em, Lite không đổi. Migration DB (nếu cần cho chỉ số danh hiệu) chạy trên VPS khi deploy; máy chủ LAN không đụng.

## 11. Ghi chú cho người dựng (từ bước kiểm tra)

- Trạng thái **theo bàn** mới (ngôi Thần, người cầm bom) và trạng thái **trên thẻ** (năng lượng Cá chép, % Siêu cộng dồn) — hôm nay
  trạng thái hỗn loạn là theo ghế và mất khi rời ghế.
- `ChaosPort` hôm nay chỉ cộng điểm: mất do xúc xắc cần đường trừ ghi dòng thoát; truy vấn trần ngày cần tính reason mới.
- Bạo kích hôm nay chỉ ×2 / ×3 (`ChaosCredit.multiplier`): cần ×4 / ×5.
- `HandSummary` chỉ có cardIds: ba chỉ số danh hiệu cần trường mới.
- "Nâng tầm uy lực" cho một ghế cấp khác trong khi `CHAOS_DRAFT` báo một cấp cho cả bàn: offer riêng của ghế đó mang cấp riêng.

## 12. Để người dựng quyết định

- Tên kiểu hiệu ứng mới trong engine, thứ tự áp chi tiết trong mục "lúc lật" (theo tinh thần spec gốc §3.5), cách chia task.
- Hình băng thông báo, viền Thần, xúc xắc (theo token ui-kit).
- Reason sổ điểm mới hay tái dùng reason cũ, miễn bảo toàn và GM thấy trong bảng nguồn / thoát.
