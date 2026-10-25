# BP-37 — Poker hỗn loạn: chế độ thẻ hiệu ứng cho bàn Blind Poker

Spec thiết kế, 2026-10-26. Người dùng mở brainstorming: "chế độ chơi mới mang tên 'Poker hỗn loạn' lấy cảm hứng từ
'Aram hỗn loạn' … mỗi người chơi được cung cấp 3 loại thẻ ngẫu nhiên có thể làm thay đổi ván đấu … trước hết mở rộng cho
chế độ Blind Poker". Mục 2 ghi các quyết định của người dùng (Q-table); chỗ nào ghi **(phiên chọn)** là quyết định của
phiên, người dùng sửa khi duyệt.

## 1. Ý định

Một bàn Blind Poker có thêm **thẻ hiệu ứng** làm ván đấu đảo chiều bất ngờ: đổi bài, thêm lá, rút lá của người khác,
bảo hiểm, cấp cứu, bạo kích… Cảm giác cần đạt là những pha **lật kèo** — đang thắng thành thua và ngược lại — khiến cả
bàn la lên, giống chọn lõi trong ARAM của LoL. Điểm vẫn là **điểm thật**: thẻ đổi người thắng, và chỉ vài thẻ có tên
(mục 6.3) được tạo điểm mới, trong một trần mỗi ngày.

**Thành công:** người chơi tạo bàn "Poker hỗn loạn" vì nó vui hơn bàn thường; mỗi lần lật bài có thẻ là một màn trình
diễn ai cũng hiểu chuyện gì vừa xảy ra; không ai mất nhiều điểm thật hơn một ván Blind thường; kinh tế điểm không bị
lạm phát vì thẻ.

**Không làm (non-goals):** chưa mở cho Texas Hold'em; không thẻ nào nhắm thẳng vào một người cụ thể; không thẻ nào làm
một người mất quá phần mình đã đặt trong ván; không bán thẻ bằng điểm hay bất kỳ hình thức trả tiền nào; không thay đổi
bàn Blind thường.

**Phản mục tiêu (thất bại dù chạy đúng):** một người "cày" điểm thật bằng thẻ (ngồi với bot lấy Cấp cứu/Bạo kích); một
người bị cả bàn "hành" liên tục; kết quả ván khó hiểu (thua mà không biết vì thẻ nào); bàn chậm đi đáng kể vì phải chờ
chọn thẻ.

## 2. Quyết định của người dùng

| # | Câu hỏi | Người dùng chọn |
|---|---|---|
| Q1 | Mở cho chế độ nào trước? | Blind Poker. |
| Q2 | Khi nào được chọn thẻ? | Đầu buổi (ván đầu tiên), rồi mỗi 5 hoặc 10 ván. |
| Q3 | Chọn thẻ thế nào? | Hiện 3 thẻ ngẫu nhiên, chọn 1. Thẻ có cấp Bạc, Vàng, Kim cương. |
| Q4 | Cấp thẻ ở khung chọn cố định? | **Cả bàn cùng một cấp** trong một khung (cùng Bạc, cùng Vàng hoặc cùng Kim cương). Không ưu ái người đang thua. |
| Q5 | Thẻ thưởng giữa chừng? | Có: tích điểm từ chuỗi thắng/thua (chuỗi thua tích nhanh hơn); đủ điểm thì mở 1 thẻ ngẫu nhiên, cấp ngẫu nhiên Bạc/Vàng/Kim cương. |
| Q6 | Thẻ tác động lên ai? | Buff bản thân hoặc debuff người khác (ví dụ lấy mất 1 lá ngẫu nhiên của mỗi người). |
| Q7 | Khi nào hiệu ứng áp? | Thẻ cho bản thân (buff, chống mất tiền) áp lúc chia bài; thẻ ảnh hưởng người khác áp lúc lật bài. Người để "Tự động chơi" thì thẻ cũng tự áp. |
| Q8 | Điểm thật hay ảo? | **Điểm thật.** |
| Q9 | Mức rào chắn? | "Hỗn loạn có rào chắn" (đề xuất của phiên, người dùng duyệt): thẻ không đổi mức tiền đặt; tối đa 1 debuff mỗi người mỗi ván; debuff không nhắm thẳng một người; có thẻ chặn; chỉ ở phòng bật chế độ. |
| Q10 | Thẻ Cấp cứu? | Có: Bạc +5×, Vàng +10×, Kim cương +20× mức cược vào stack. Chỉ kích hoạt khi stack dưới 2 mức cược; tối đa 3 lần mỗi tài khoản mỗi ngày; **dùng được cả ở bàn bot**. |
| Q11 | Số lượng thẻ? | Khoảng 15 Bạc, 12 Vàng, 10 Kim cương, rồi thêm Bạo kích, Thần tài, Tay bạc, Cấp độ (mục 5). |
| Q12 | Lưu trữ? | Dễ bật/tắt từng thẻ theo mùa, theo thời điểm. |
| Q13 | Ván hỗn loạn có tính vào thành tựu, danh vọng, chỉ số? | Theo đề xuất của phiên (người dùng duyệt): chỉ tính **số ván đã chơi** (`handsPlayedBlind`, `gamesCompleted`, `botHands`) và **số phòng đã vào**; **không** tính thắng, chuỗi thắng/thua, bộ bài mạnh, ván thắng lớn nhất. Danh vọng cộng theo ván chơi như bàn thường. |

## 3. Luật chơi

### 3.1 Bàn hỗn loạn

- Khi tạo phòng **Blind Poker** có thêm tùy chọn **"Poker hỗn loạn"** (bật/tắt, mặc định tắt) và **"Chu kỳ thẻ"**: 5
  hoặc 10 ván, mặc định 5 **(phiên chọn: để chủ phòng chọn giữa hai giá trị người dùng nêu)**.
- Sảnh hiện nhãn **"Hỗn loạn"** trên thẻ phòng, như nhãn "Nặn bài".
- Mọi luật Blind giữ nguyên (mức cược cố định, hạn mức 10×, "Chơi hoặc bỏ" / "Hoàn toàn may rủi", nặn bài, bot, cộng
  dồn, tất tay, pot phụ). Thẻ chỉ thêm hiệu ứng lên trên.

### 3.2 Khung chọn thẻ (draft)

- Khung chọn mở **trước ván đầu tiên** người chơi ngồi vào bàn hỗn loạn và **trước mỗi ván thứ 5k+1 (hoặc 10k+1)** tính
  theo số ván của bàn.
- **Cấp của khung** rút ngẫu nhiên một lần cho cả bàn: Bạc 60 %, Vàng 30 %, Kim cương 10 % **(phiên chọn)**. Mọi người
  trong khung nhận 3 thẻ khác nhau cùng cấp đó, rút ngẫu nhiên từ các thẻ **đang bật** của cấp ấy và **hợp với bàn**
  (bàn "Hoàn toàn may rủi" không rút thẻ đánh dấu ✱ ở mục 5).
- Người chơi có **15 giây** để chọn 1 **(phiên chọn)**. Hết giờ, người đang "Tự động chơi", người vắng mặt và bot đều
  được **chọn ngẫu nhiên** một trong ba.
- Người vào bàn giữa chừng nhận khung riêng (cùng cấp của khung gần nhất) trước ván đầu tiên của mình **(phiên chọn)**.
  Mỗi người chỉ được **một lần chọn cho mỗi chu kỳ** của bàn: đứng dậy rồi ngồi lại trong cùng chu kỳ thì không được
  chọn lại (không "quay lại" để đổi thẻ Kim cương) **(phiên chọn)**.
- **Đóng băng không lấy mất lượt chọn:** người đang bị đóng băng vẫn chọn thẻ ở khung chọn; đóng băng chỉ chặn thẻ **áp**
  trong ván bị đóng băng (mục 3.5) **(phiên chọn)**.
- Khung chọn không được làm ván chậm quá thời gian chọn: ván bắt đầu ngay khi mọi người đã chọn hoặc hết 15 giây.

### 3.3 Điểm hỗn loạn và thẻ thưởng

- Mỗi người có **điểm hỗn loạn** riêng ở bàn đó (không phải điểm thật, mất khi rời bàn): **+1** mỗi ván thắng, **+2**
  mỗi ván thua; từ ván thứ 3 của một chuỗi (thắng hoặc thua) trở đi, điểm ván đó **nhân đôi** **(phiên chọn)**.
- Đủ **10 điểm** thì trừ 10 và mở **1 thẻ thưởng**: cấp rút ngẫu nhiên Bạc 60 % / Vàng 30 % / Kim cương 10 %, thẻ rút
  ngẫu nhiên trong các thẻ đang bật của cấp đó. Thẻ thưởng **không phải chọn**, nhận ngay **(phiên chọn)**.
- Ván bỏ bài ("Bỏ bài") tính như thua; ván cộng dồn (không ai chơi) không tính; ván bị hủy không tính.

### 3.4 Thẻ trên tay: kích hoạt và thời hạn

- Thẻ đã chọn hoặc nhận **tự áp** đúng thời điểm của nó (mục 5, cột "Lúc áp"); người chơi không phải bấm gì
  (theo Q7). Thẻ có thời hạn n ván thì áp liên tiếp n ván kể từ ván kế tiếp.
- **Thẻ chờ điều kiện** (Cấp cứu, Thần tài, Khiên, Gương) nằm chờ tới khi điều kiện xảy ra hoặc tới khi người chơi rời
  bàn.
- **Mỗi thẻ là một bản riêng trên tay** (một ghế có thể giữ nhiều thẻ). Luật không cộng dồn chỉ áp cho **thẻ có thời
  hạn cùng kiểu hiệu ứng** (cùng `effect` ở mục 6.1, ví dụ hai thẻ `bestOfN`): thẻ mới cấp cao hơn thay thẻ cũ, cùng cấp
  thì cộng thời hạn, cấp thấp hơn thì bị bỏ. Cột "Nhóm" ở mục 5 chỉ để hiển thị và lọc, không quyết định cộng dồn
  **(phiên chọn)**.
- **Thẻ dùng một lần** (đổi lá, debuff, chia lại lá chung, cấp độ…) xếp hàng theo thứ tự nhận. Mỗi ván một ghế chỉ
  **phát ra tối đa 1 debuff** (thẻ debuff cũ nhất), các thẻ debuff khác chờ ván sau; thẻ buff một lần khác kiểu hiệu
  ứng thì áp cùng ván được **(phiên chọn)**.
- Tay bạc tuân theo đúng hai luật trên cho hiệu ứng nó rút mỗi ván.
- **Rời bàn** (đứng dậy, rời phòng, bị mời ra, hết điểm): mọi thẻ và điểm hỗn loạn mất **(phiên chọn)**.
- Ghế của người chơi hiển thị các thẻ đang có (biểu tượng nhỏ theo cấp), mọi người đều thấy **(phiên chọn: công khai,
  để cả bàn chờ màn lật kèo)**.

### 3.5 Thứ tự áp trong một ván

1. Trước khi chia: các thẻ "lúc chia" áp theo thứ tự ghế từ nút cái; "Thế giới đảo ngược" được báo cho cả bàn.
2. Lúc chọn (chỉ "Chơi hoặc bỏ"): các thẻ ✱ (nhìn trộm, bỏ không mất) cho người dùng thấy thêm thông tin.
3. Lúc lật bài: thứ tự cố định — (a) Khiên/Gương chặn hoặc phản; (b) debuff đổi lá riêng (rút, hạ, tráo); (c) thẻ đổi lá
   chung (chia lại, bão); (d) thẻ cho thêm lá (mượn lá); (e) chấm bài; (f) Bảo hiểm, Bạo kích, Thần tài tính tiền.
4. **Mỗi người chịu tối đa 1 debuff mỗi ván.** Debuff thứ hai nhắm vào cùng người trong ván đó bị bỏ (thẻ vẫn tính là đã
   dùng). Debuff "mỗi đối thủ" chỉ áp lên người chưa chịu debuff nào.
5. Debuff chỉ áp lên người **còn trong ván** (đã "Chơi" hoặc ở bàn may rủi). Chỉ một người chơi thì không có lật bài và
   debuff "lúc lật" được giữ sang ván sau.
6. Thẻ "Đóng băng" chặn **việc nhận thẻ mới và việc áp thẻ** của người bị đóng băng trong ván đó.

### 3.6 Hiển thị

- Màn chọn thẻ: 3 thẻ lớn có khung theo cấp (bạc, vàng, kim cương), tên, mô tả một câu, đồng hồ 15 giây.
- Lúc lật bài: mỗi thẻ áp hiện một dải thông báo ngắn trên bàn ("Bot 1 dùng **Rút lá cả bàn**") kèm hiệu ứng lá bị đổi,
  theo đúng thứ tự mục 3.5; thẻ kết quả ván có thêm dòng **"Thẻ đã dùng"**. Hoạt ảnh tôn trọng `prefers-reduced-motion`.
- Chuỗi chữ đều có vi và en (luật i18n của dự án); tên thẻ tiếng Việt là tên dưới đây, tiếng Anh do phiên dịch và người
  dùng duyệt.

## 4. Rào chắn kinh tế

- **Không thẻ nào làm một người mất nhiều hơn phần đã đặt trong ván** (tối đa 2 mức cược ở "Chơi hoặc bỏ", 1 mức ở
  "Hoàn toàn may rủi"). Không có thẻ cược thêm hay nhân pot từ tiền người thua.
- **Hoàn tiền trích từ pot** (Bảo hiểm, Bỏ không mất): trả lại cho người có thẻ trước khi chia pot cho người thắng;
  không tạo điểm.
- **Thẻ tạo điểm mới** chỉ có ba họ: **Cấp cứu, Bạo kích, Thần tài** (phần tiền). Mỗi khoản là một dòng riêng trong sổ
  điểm (`point_transactions`, reason `chaos_rescue` / `chaos_crit` / `chaos_fortune`), như "Cứu trợ" hiện nay, để
  `Σ số dư + Σ dòng nguồn/thoát` vẫn khớp và có test bảo toàn.
- **Cấp cứu chỉ nổ sau một ván thua ở bàn này** làm stack xuống dưới 2 mức cược — không nổ lúc vừa ngồi xuống, kể cả
  khi số dư mang vào đã dưới 2 mức cược. Tiền cấp cứu vào **stack trên bàn** (không vào số dư), ghi sổ `chaos_rescue`
  ngay lúc nổ; khi rời bàn nó về số dư cùng stack như mọi điểm khác **(phiên chọn)**.
- **Trần mỗi ngày** cho một tài khoản (ngày kinh tế, múi giờ `ECONOMY_TIMEZONE`):
  - Cấp cứu: tối đa **3 lần** (Q10);
  - **tổng điểm mới từ cả ba họ: tối đa 100.000 điểm** **(phiên chọn — người dùng duyệt)**. Lý do: mức cược Blind cao
    nhất là 50.000, nên một thẻ Cấp cứu Kim cương là 1.000.000 điểm, ba lần là 3 triệu, hơn tổng điểm của cả server
    hôm nay. Vượt trần thì phần tiền của thẻ bị cắt về phần còn lại của trần (thẻ vẫn tính là đã dùng), và người chơi
    thấy dòng "Đã chạm trần thẻ hôm nay".
- **Bot** cũng nhận và dùng thẻ (chọn ngẫu nhiên). Điểm của bot là điểm ảo: thẻ tạo điểm của bot không ghi sổ và không
  tính trần; thẻ debuff của bot lên người thật áp như của người.
- GM thấy các khoản `chaos_*` trong bảng nguồn/thoát mỗi ngày (Plan 26) như mọi nguồn điểm khác.

## 5. Bộ thẻ (47 thẻ: 18 Bạc, 15 Vàng, 14 Kim cương)

Ký hiệu: ✱ = chỉ bàn "Chơi hoặc bỏ". "Lúc áp": **chia** (khi bài vừa chia), **chọn** (trong lúc chọn Chơi/Bỏ),
**lật** (khi lật bài), **chờ** (khi điều kiện xảy ra), **ngay** (lúc nhận thẻ). "Mức cược" = mức cược cố định của bàn.

### 5.1 Bạc (18)

| id | Tên | Nhóm | Hiệu ứng | Lúc áp |
|---|---|---|---|---|
| `s_swap_one` | Đổi lá | đổi bài | Lá riêng thấp nhất được chia lại, 1 ván | chia |
| `s_luck_1` | Bùa may nhỏ | bùa may | Chia 2 bộ riêng, giữ bộ tốt hơn, 1 ván | chia |
| `s_high_card` | Chất bổ | bùa may | Bài riêng chắc chắn có ít nhất 1 lá từ 10 trở lên, 1 ván | chia |
| `s_suited` | Đồng hoa | bùa may | 2 lá riêng đầu tiên cùng chất, 1 ván | chia |
| `s_redeal_weak` | Chia lại bài yếu | đổi bài | Bài riêng không có đôi và không có lá từ J trở lên thì được chia lại một lần, 1 ván | chia |
| `s_peek_1` ✱ | Nhìn trộm | nhìn trộm | Xem trước 1 lá chung trước khi chọn, 1 ván | chọn |
| `s_free_fold` ✱ | Bỏ không mất | bảo hiểm | Nếu chọn Bỏ bài, được hoàn mức cược đầu ván (trích từ pot), 1 ván | chọn |
| `s_insure_half` | Bảo hiểm bạc | bảo hiểm | Thua thì được hoàn 50 % phần đã đặt, 1 ván | lật |
| `s_shield` | Khiên gỗ | khiên | Chặn 1 debuff kế tiếp | chờ |
| `s_rescue` | Cấp cứu bạc | cấp cứu | +5 × mức cược vào stack khi stack dưới 2 mức cược | chờ |
| `s_charge` | Tích lũy | điểm hỗn loạn | +3 điểm hỗn loạn | ngay |
| `s_steal_one` | Rút lá lẻ | debuff | 1 đối thủ ngẫu nhiên mất 1 lá riêng | lật |
| `s_lower` | Hạ lá | debuff | Lá riêng cao nhất của 1 đối thủ ngẫu nhiên bị chia lại | lật |
| `s_blindfold` ✱ | Che mắt | debuff | 1 đối thủ ngẫu nhiên không được xem bài riêng ở ván sau | chia |
| `s_freeze_one` | Đóng băng nhỏ | debuff | 1 đối thủ ngẫu nhiên không dùng được thẻ ở ván sau | chia |
| `s_crit` | Bạo kích bạc | bạo kích | Khi thắng: 20 % cơ hội phần thắng ròng ×2, trong 3 ván | lật |
| `s_fortune` | Thần tài bạc | thần tài | Xem 5.5 | chờ |
| `s_level` | Cấp độ bạc | cấp độ | Nhận ngay 1 thẻ Vàng ngẫu nhiên | ngay |

### 5.2 Vàng (15)

| id | Tên | Nhóm | Hiệu ứng | Lúc áp |
|---|---|---|---|---|
| `g_swap_all` | Đổi bài | đổi bài | Chia lại cả bài riêng khi bài không có đôi và không có lá từ Q trở lên, 1 ván | chia |
| `g_luck_3` | Bùa may | bùa may | Giữ bộ tốt hơn trong 2 bộ, 3 ván | chia |
| `g_extra_card` | Thêm lá | thêm lá | +1 lá riêng, 1 ván | chia |
| `g_peek_3` ✱ | Nhìn trộm vàng | nhìn trộm | Xem trước 3 lá chung trước khi chọn, 1 ván | chọn |
| `g_borrow` | Mượn lá | thêm lá | Được dùng thêm 1 lá riêng của 1 đối thủ ngẫu nhiên (chép, không lấy mất) | lật |
| `g_insure_full` | Bảo hiểm vàng | bảo hiểm | Thua thì được hoàn 100 % phần đã đặt, 1 ván | lật |
| `g_shield_3` | Khiên sắt | khiên | Chặn mọi debuff trong 3 ván | chờ |
| `g_rescue` | Cấp cứu vàng | cấp cứu | +10 × mức cược khi stack dưới 2 mức cược | chờ |
| `g_farm` | Cày điểm | điểm hỗn loạn | Điểm hỗn loạn nhân đôi trong 5 ván | chia |
| `g_steal_all` | Rút lá cả bàn | debuff | Mỗi đối thủ mất 1 lá riêng | lật |
| `g_redeal_board_1` | Chia lại lá chung | lá chung | 1 lá chung ngẫu nhiên được chia lại (cả bàn chịu) | lật |
| `g_freeze_all` | Đóng băng bàn | debuff | Mọi đối thủ không dùng được thẻ ở ván sau | chia |
| `g_crit` | Bạo kích vàng | bạo kích | Khi thắng: 25 % cơ hội ×2 và 10 % cơ hội ×3 phần thắng ròng, trong 3 ván | lật |
| `g_fortune` | Thần tài vàng | thần tài | Xem 5.5 | chờ |
| `g_level` | Cấp độ vàng | cấp độ | Nhận ngay 1 thẻ Kim cương ngẫu nhiên | ngay |

### 5.3 Kim cương (14)

| id | Tên | Nhóm | Hiệu ứng | Lúc áp |
|---|---|---|---|---|
| `d_pick_3` | Chọn bài | bùa may | Chia 3 bộ riêng, giữ bộ tốt nhất, 1 ván | chia |
| `d_luck_5` | Bùa may lớn | bùa may | Giữ bộ tốt hơn trong 2 bộ, 5 ván | chia |
| `d_extra_card_3` | Thêm lá kim cương | thêm lá | +1 lá riêng, 3 ván | chia |
| `d_peek_5` ✱ | Thấu thị | nhìn trộm | Xem trước cả 5 lá chung trước khi chọn, 1 ván | chọn |
| `d_insure_2` | Bảo hiểm kim cương | bảo hiểm | Thua thì được hoàn 100 % phần đã đặt, 2 ván | lật |
| `d_mirror` | Gương phản chiếu | khiên | Phản debuff kế tiếp về đúng người dùng | chờ |
| `d_rescue` | Cấp cứu kim cương | cấp cứu | +20 × mức cược khi stack dưới 2 mức cược (trong trần ngày) | chờ |
| `d_swap_hands` | Tráo bài | debuff | Tráo cả bài riêng với 1 đối thủ ngẫu nhiên | lật |
| `d_storm` | Bão lá chung | lá chung | Chia lại cả 5 lá chung (cả bàn chịu) | lật |
| `d_reverse` | Thế giới đảo ngược | luật ván | Bộ yếu nhất ăn pot ván này; cả bàn được báo từ lúc chia | chia |
| `d_crit` | Bạo kích kim cương | bạo kích | Khi thắng: 30 % cơ hội ×2 và 15 % cơ hội ×3 phần thắng ròng, trong 3 ván | lật |
| `d_fortune` | Thần tài kim cương | thần tài | Xem 5.5 | chờ |
| `d_gambler` | Tay bạc | tay bạc | Mỗi ván tự áp 1 hiệu ứng ngẫu nhiên của một thẻ Bạc hoặc Vàng đang bật (trừ Cấp cứu, Thần tài, Cấp độ, Tay bạc), tới khung chọn kế tiếp | chia |
| `d_level` | Cấp độ kim cương | cấp độ | Nhận ngay 2 thẻ ngẫu nhiên, mỗi thẻ cấp ngẫu nhiên từ Bạc tới Kim cương | ngay |

### 5.3a "Giữ bộ tốt hơn" và lá bị bỏ

- Bùa may, Chọn bài, Chất bổ… so các bộ **chỉ bằng lá riêng** (đôi/bộ ba trong lá riêng trước, rồi lá cao nhất, rồi lá
  kế), **không** nhìn lá chung — để thẻ là "may hơn" chứ không phải "chắc thắng", và vẫn đúng khi lá chung bị chia lại
  sau đó **(phiên chọn)**.
- Lá riêng bị bỏ (bộ không giữ, lá bị đổi, lá bị rút) **bị đốt**, không trả lại bộ bài; lá chung được rút sau đó từ phần
  còn lại của bộ bài như bình thường **(phiên chọn)**.

### 5.4 Bạo kích

- "Phần thắng ròng" = số điểm người có thẻ ăn từ pot trừ phần chính họ đã đặt vào pot đó. Thắng chia (hòa) thì tính trên
  phần chia của họ.
- Bạo kích tạo điểm mới: phần thêm (×2 → thêm 1 lần, ×3 → thêm 2 lần phần thắng ròng) ghi `chaos_crit`, tính vào trần
  ngày (mục 4). Người thua không mất thêm gì.
- Mỗi lần ×2/×3 xảy ra, bàn hiện "**Bạo kích ×2!**" trên ghế người thắng.

### 5.5 Thần tài

Thẻ nằm chờ; **chỉ nổ khi người có thẻ thắng một ván ngay sau một chuỗi thua từ 2 ván trở lên**. Thắng mà chuỗi thua
trước đó dưới 2 ván thì thẻ tiếp tục chờ. Thẻ mất khi rời bàn. Phần thưởng theo độ dài chuỗi thua vừa kết thúc
**(phiên chọn)**:

| Chuỗi thua | Thần tài bạc | Thần tài vàng | Thần tài kim cương |
|---|---|---|---|
| 2–3 ván | +2 × mức cược | +4 × mức cược | +8 × mức cược và 1 thẻ Bạc |
| 4–5 ván | +4 × mức cược và 1 thẻ Bạc | +8 × mức cược và 1 thẻ Vàng | +15 × mức cược và 1 thẻ Kim cương |
| từ 6 ván | +6 × mức cược và 1 thẻ Vàng | +12 × mức cược và 2 thẻ Vàng | +20 × mức cược và 2 thẻ Kim cương |

Tiền ghi `chaos_fortune`, tính vào trần ngày; thẻ thưởng rút ngẫu nhiên trong các thẻ đang bật của cấp đó và **kích
hoạt ngay** như thẻ vừa nhận.

### 5.6 Cấp độ và Tay bạc

- Cấp độ không có hiệu ứng riêng: nó đổi thành thẻ khác ngay lúc nhận. Thẻ nhận được từ Cấp độ không bao giờ là Cấp độ
  (tránh vòng lặp).
- Tay bạc là thẻ của cả một chu kỳ: từ ván kế tiếp tới khung chọn sau, mỗi ván rút 1 hiệu ứng mới; hiệu ứng rút được
  tuân theo mọi luật của thẻ gốc (nhóm, debuff tối đa 1, ✱ với kiểu bàn).

## 6. Lưu trữ và bật/tắt theo mùa

### 6.1 Danh mục thẻ — trong dữ liệu, không trong mã

- File `apps/normal-server/data/chaos-cards.json` (theo mẫu `items.json`, `achievements.json`, `daily-gifts.json`):
  mỗi thẻ một dòng `{ id, tier, family, effect, params, timing, modes, enabled }`.
  - `effect` là một **kiểu hiệu ứng** có sẵn trong engine (ví dụ `swapLowest`, `bestOfN`, `extraHole`, `peekBoard`,
    `refundStake`, `shield`, `rescue`, `chaosPoints`, `stealHole`, `redealHole`, `blindfold`, `freeze`, `crit`,
    `fortune`, `levelUp`, `borrowHole`, `redealBoard`, `swapHands`, `reverseRank`, `gambler`).
  - `params` chứa các con số (số ván, tỉ lệ, hệ số, ngưỡng) — đổi con số là đổi dữ liệu, không đổi mã.
  - `modes` = `["playOrFold"]` hoặc `["playOrFold","none"]` (thẻ ✱ chỉ `playOrFold`).
  - `enabled` là giá trị mặc định.
- Thêm một thẻ mới với kiểu hiệu ứng có sẵn = thêm một dòng dữ liệu và chuỗi vi/en. Kiểu hiệu ứng mới mới cần mã.
- Tên và mô tả thẻ nằm trong locale (`chaos.cards.<id>.name/desc`), vi và en, có test đối chiếu như item.

### 6.2 Bật/tắt theo mùa — GM sửa, ghi DB

- Bảng `chaos_card_rules` **(phiên chọn, theo mẫu `shop_prices` + `gift_months`)**: `card_id`, `enabled`, `weight`
  (trọng số rút, mặc định 1), `starts_at`, `ends_at` (null = không giới hạn), `updated_by`, `updated_at`.
  - Một thẻ đang bật khi: có dòng thì theo dòng (đúng khoảng thời gian), không có dòng thì theo `enabled` của file.
  - Ví dụ: bật bộ thẻ Halloween từ 25/10 tới 2/11, tắt Bạo kích trong một tuần nếu kinh tế lệch.
- Bảng `chaos_config` (khóa → JSON, theo mẫu `shop_config`): tỉ lệ cấp khung chọn (60/30/10), ngưỡng điểm hỗn loạn (10),
  trần ngày (100.000 điểm, 3 lần Cấp cứu), thời gian chọn (15 giây).
- Tab mới trong **"Quản trị"**: **"Thẻ hỗn loạn"** — danh sách thẻ theo cấp, bật/tắt, trọng số, khoảng ngày, và các số
  của `chaos_config`; mọi thay đổi cần lý do và ghi "Nhật ký" như các tab GM hiện có.
- Server đọc luật thẻ khi mở **mỗi khung chọn** (không cache qua nhiều khung), nên tắt một thẻ có hiệu lực từ khung kế
  tiếp; thẻ đang nằm trên tay người chơi vẫn chạy hết thời hạn.
- Ít nhất 3 thẻ phải còn bật ở mỗi cấp hợp với kiểu bàn; GM không lưu được trạng thái vi phạm điều này.

### 6.3 Nơi đặt mã (gợi ý cho người dựng)

- **`@bp/core`** (thuần, không I/O): kiểu hiệu ứng, áp thẻ vào trạng thái ván Blind (`packages/core/src/hand/blind.ts`
  và bộ chấm bài), luật nhóm/debuff/thứ tự, điểm hỗn loạn — tất cả nhận `Rng` vào để test được.
- **`@bp/server-kit`**: khung chọn, đồng hồ 15 giây, phát sự kiện (thẻ được chia, thẻ được chọn, thẻ đã áp), giữ thẻ
  của mỗi ghế trong phòng.
- **`apps/normal-server`**: đọc `chaos-cards.json` + `chaos_card_rules` + `chaos_config`, ghi sổ các khoản `chaos_*`,
  giữ trần ngày, API cho tab GM.
- **`@bp/ui-kit`** + **`apps/normal-web`**: tùy chọn tạo phòng, nhãn sảnh, màn chọn thẻ, biểu tượng thẻ trên ghế, dải
  thông báo lúc lật, dòng "Thẻ đã dùng" trong thẻ kết quả, tab GM.
- **Lite:** chưa bật ở bản Lite (không có tài khoản để giữ trần ngày, không có GM) **(phiên chọn)**; mã dùng chung qua
  package nên có thể mở sau.

## 7. Ràng buộc

- Luật dự án: điểm chỉ là điểm ảo, không nạp/rút/trả tiền; mọi đường tiền mới có test bảo toàn; mọi chuỗi chữ vi + en;
  hoạt ảnh có đường giảm chuyển động; không thêm thư viện runtime mới khi chưa ghi lý do vào spec.
- Thuật ngữ ổn định của bàn Blind giữ nguyên ("Chơi", "Bỏ bài", "Tất tay", "Tự động chơi", "Nặn bài"…).
- Bàn Blind không bật hỗn loạn chạy y như hôm nay (test hồi quy của engine Blind không đổi kết quả).
- Màn hình: kiểm tra ở 1920×940, 1366×768 và 375×812 (dọc và ngang), không chữ đè chữ.

## 8. Để người dựng quyết định

- Thiết kế hình thẻ (khung theo cấp, biểu tượng): phiên bản đầu dùng khung CSS + biểu tượng đơn giản; tranh vẽ thẻ để
  sau.
- Cách chia nhỏ thành các task, thứ tự làm, tên sự kiện giao thức cụ thể, schema chi tiết của bảng.
- Cách hiện hiệu ứng lá bị đổi (lật, mờ, trượt), miễn là theo thứ tự mục 3.5 và đọc được trên điện thoại.
- Hành vi chọn thẻ của bot ngoài "ngẫu nhiên" (có thể để ngẫu nhiên mãi).

## 9. Thành tựu, danh vọng và chỉ số (Q13)

- Ván ở bàn hỗn loạn được **gắn nhãn hỗn loạn** khi ghi lịch sử (`games` / sự kiện kết thúc ván), để các luồng thống
  kê lọc được.
- **Có tính:** `handsPlayedBlind`, `gamesCompleted`, `botHands`, `roomsJoined`; danh vọng theo luật danh vọng hiện có
  cho một ván đã chơi.
- **Không tính:** `handsWonBlind`, `bestWinStreak`, chuỗi thua, `bestHandRank`, `biggestWin` và mọi thành tựu dựa trên
  chúng. Lý do: thẻ đẩy các chỉ số này lên, và thành tựu của chúng trả điểm thật ngoài trần 100.000/ngày.
- Lịch sử ván và thẻ kết quả vẫn ghi đầy đủ (kèm dòng "Thẻ đã dùng").
