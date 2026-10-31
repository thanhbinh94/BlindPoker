# BP-42 — Danh hiệu Thần: bộ trang phục, màn ra mắt khi vào bàn, âm thanh đầu tiên của game

Spec thiết kế, 2026-10-31. Đây là **phase sau** mà spec `2026-10-28-chaos-round-three-design.md` (BP-41) để lại ở G10 / mục 9:
trang phục, phụ kiện và hào quang cho ba danh hiệu Hóa Thần (`title_god`), Bán Thần (`title_demigod`) và Kẻ Sát Thần
(`title_godslayer`). Phiên brainstorm cùng người dùng mở rộng phase này thêm **màn ra mắt khi vào bàn** và **âm thanh**.

Chỗ ghi **(phiên chọn)** là quyết định của phiên. Người dùng giao phiên tự viết spec ("tự brainstorming spec nhé vì tôi sẽ
không dùng claude code hôm nay"), nên mọi chỗ (phiên chọn) chờ người dùng duyệt trước khi lập plan.

## 1. Ý định

Ba danh hiệu Thần của BP-41 rất khó lấy: phải hóa Thần, thành Bán Thần, hoặc hạ Thần hai lần ở bàn có người thật. Hôm nay
chúng chỉ là **một dòng chữ** dưới tên ở ghế. Người dùng muốn người giữ danh hiệu **được cả bàn chú ý**, giống **pentakill
trong Liên Minh Huyền Thoại**: giọng hô vang lên, dòng chữ lớn chạy ngang màn hình, và cả trận cùng thấy đúng khoảnh khắc đó.

Phase này gồm ba phần:

1. **Màn ra mắt:** khi người giữ danh hiệu vào bàn, cả phòng thấy một băng thông báo lớn và nghe một đoạn nhạc ngắn riêng
   cho danh hiệu đó.
2. **Âm thanh đầu tiên của game:** nhạc hiệu EDM không lời, tự soạn, có nút tắt tiếng. Âm thanh cũng dùng cho các khoảnh khắc
   lớn của BP-41.
3. **Bộ trang phục danh hiệu:** áo, mũ / vương miện, hào quang và khung riêng cho từng danh hiệu, để người giữ danh hiệu nổi
   bật suốt ván.

**Thành công:** người giữ danh hiệu vào bàn thì cả bàn ngẩng lên nhìn, và người chơi muốn săn danh hiệu để có khoảnh khắc đó.
Nhìn chibi là biết ngay ai là Thần, Bán Thần hay Kẻ Sát Thần. Người không thích ồn thì một chạm là tắt hết tiếng.

**Không làm:**
- **Bài nhạc dài phát lặp suốt bàn** (người dùng muốn, nhưng để **phase sau**, mục 9).
- Giọng đọc người thật hoặc giọng máy.
- Bản Lite: không có tài khoản, không có danh hiệu.
- Bán các món của bộ danh hiệu. Chúng chỉ đến từ danh hiệu.
- Đổi luật chơi. Danh hiệu không cho lợi thế nào trong ván.

**Phản mục tiêu:**
- Màn ra mắt thành **spam**: ra vào bàn liên tục, cả bàn nghe đi nghe lại.
- Băng thông báo che người thắng hoặc khung chọn thẻ lâu hơn 3 giây (lời phàn nàn của BP-39).
- Âm thanh bật to bất ngờ, không tắt được, hoặc vẫn kêu khi tab đang ẩn.
- Chơi chậm lại: không có bước nào bắt người chơi chờ màn ra mắt xong.

## 2. Quyết định của người dùng

| # | Câu hỏi | Quyết định |
|---|---|---|
| H1 | Khi người giữ danh hiệu vào bàn, cả bàn có thấy gì đặc biệt? | **Có.** "Khi vào bàn tôi muốn có những hiệu ứng hoặc thông báo… cho toàn bộ người chơi phải chú ý." Phiên đoán, người dùng xác nhận "đúng rồi": người **đã sở hữu** danh hiệu vào bàn thì cả bàn thấy, còn trang phục và hào quang giữ họ nổi bật suốt ván. |
| H2 | Hình mẫu? | **Pentakill của Liên Minh Huyền Thoại.** |
| H3 | Có âm thanh không? | **Có, kèm nút tắt tiếng**, âm thanh "độc đáo một chút". Phiên có thể **tự tạo vài bản nhạc EDM không lời** cho hiệu ứng này để **cả phòng cùng nghe**. |
| H4 | Đoạn ngắn lúc vào bàn hay bài dài suốt thời gian Thần trị vì? | **Cả hai.** Người dùng muốn **một bài dài xuyên suốt cả bàn, lặp đi lặp lại**, nhưng ghi lại cho **phase sau**. Phase này làm đoạn ngắn. |
| H5 | Trang phục / phụ kiện / hào quang cho ba danh hiệu (G10 của BP-41)? | Thuộc phase này (BP-41 đã hoãn sang đây). |

## 3. Ai được ra mắt, và khi nào

- **Điều kiện:** người chơi đang **trang bị** (ô `title`) một trong ba danh hiệu `title_god`, `title_demigod`,
  `title_godslayer`. Chỉ sở hữu mà không đeo thì không ra mắt **(phiên chọn)**. Đeo danh hiệu là người chơi chọn khoe; ai
  muốn vào bàn lặng lẽ thì đổi danh hiệu khác. Mỗi người chỉ đeo được một danh hiệu, nên không cần thứ tự ưu tiên.
- **Lúc nào:** khi người đó **ngồi vào ghế** ở bất kỳ bàn Normal nào: Blind Poker, Hold'em, có hay không bật hỗn loạn
  **(phiên chọn)**. Danh hiệu là uy danh của người chơi, không riêng bàn hỗn loạn. Người chỉ vào xem thì không ra mắt.
- **Ai thấy:** mọi người trong phòng, kể cả người xem và chính người vừa ngồi.
- **Chống spam (phiên chọn):** mỗi người ra mắt **tối đa một lần mỗi phòng trong 10 phút**. Rời bàn rồi ngồi lại trong 10 phút
  thì không ra mắt lại. Đổi ghế trong cùng phòng không tính là vào bàn. Người chơi kết nối lại (mất mạng rồi vào lại) không
  ra mắt.
- **Đổi danh hiệu khi đang ngồi:** không ra mắt (chỉ tính lúc ngồi vào).
- **Ai quyết định:** máy chủ Normal quyết định có ra mắt hay không và báo cho cả phòng **(phiên chọn)**. Như vậy mọi máy cùng
  thấy một khoảnh khắc, việc chống spam không phụ thuộc máy khách, và người xem vào sau không thấy lại màn cũ.

## 4. Màn ra mắt (hình ảnh)

- Dùng **chung lớp khoảnh khắc** (`.moments`) và kiểu **băng thông báo lớn** (`ChaosHerald`) của BP-41, có ở **mọi bàn**,
  không chỉ bàn hỗn loạn. Băng có màu riêng cho từng danh hiệu:
  - Thần Bài: vàng–đỏ, như banner Thần của BP-41.
  - Bán Thần: trắng–bạc–vàng nhạt.
  - Kẻ Sát Thần: đen–đỏ thẫm.
- **Câu chữ (phiên chọn, vi; en do phiên dịch, người dùng duyệt):**
  - Hóa Thần: "Thần Bài {tên} đã giáng lâm!"
  - Bán Thần: "Bán Thần {tên} đã xuất hiện!"
  - Kẻ Sát Thần: "Kẻ Sát Thần {tên} đã vào bàn — Thần Bài hãy cẩn thận!"
- **Thời lượng:** khoảng 3 giây, khớp với đoạn nhạc (mục 5). Chạm để tắt sớm. Theo luật BP-41, băng **không đè** dải kết quả,
  khung chọn thẻ hay người thắng lâu hơn 3 giây, và **không hiện trong lúc lật bài** (khoảng giữ kết quả, Ruling 21). Một màn
  ra mắt rơi vào lúc đó thì chờ tới khi lật xong.
- **Hàng đợi (phiên chọn):** chỉ **màn ra mắt** xếp hàng. Banner Thần và xúc xắc của BP-41 giữ nguyên cách hiện hôm nay:
  chung một băng, và xúc xắc theo mốc thời gian cố định. Màn ra mắt chờ tới khi băng và bảng xúc xắc trống, rồi hiện **lần
  lượt**, mỗi màn trọn thời lượng của nó. Không chồng hai băng ra mắt lên nhau.
  - Tối đa **3 màn** chờ trong hàng; màn thứ tư trở đi bị bỏ.
  - Màn nào chờ quá **10 giây** thì bỏ, cả hình lẫn tiếng.
  - Như vậy tám người ngồi cùng lúc không thành 24 giây banner.
- **Ghế:** ghế của người vừa ra mắt **lóe sáng** theo màu danh hiệu trong lúc băng hiện.
- **Một dòng trong toast:** ở bàn hỗn loạn có thêm một dòng toast như các thẻ (BP-39). Bàn thường chưa có dải toast, nên
  băng thông báo là đủ.
- **Giảm chuyển động:** chỉ hiện chữ, không rung, không lóe; thời lượng giữ nguyên.

## 5. Âm thanh

### 5.1 Cách tạo (phiên chọn)

- **Tổng hợp ngay trong trình duyệt bằng Web Audio API**, nhạc được soạn bằng code: oscillator, bộ lọc, envelope, tiếng ồn
  trắng cho riser và snare. Không có file nhạc và không thêm thư viện. Như vậy không cần tài khoản dịch vụ AI tạo nhạc nào,
  không có bản quyền phải lo, và mỗi bản là độc nhất của game.
- Phần âm thanh nằm ở **ui-kit** (một module "sound" duy nhất) để Normal dùng. Lite không dùng ở phase này.
- **Không phát khi tab đang ẩn** (`document.hidden`). Một khoảnh khắc lỡ mất thì không phát bù.
- Trình duyệt chặn âm thanh trước lần chạm đầu tiên. Người chơi đã bấm để vào phòng, nên `AudioContext` được mở lại ở lần
  chạm đó. Nếu vẫn bị chặn thì im lặng, không báo lỗi.

### 5.2 Các đoạn nhạc (stinger)

Phong cách **EDM không lời**. Mỗi đoạn có cấu trúc riser → drop → đuôi, khớp với lúc băng thông báo xuất hiện. Con số là định
hướng, người dựng tinh chỉnh theo tai nghe:

| Đoạn | Dùng khi | Cảm giác | Dài |
|---|---|---|---|
| `entrance.god` | Thần Bài ra mắt | Uy nghi: riser trắng, hợp âm supersaw kiểu kèn đồng, kick nặng ở drop, đuôi vang | ~3,5 s |
| `entrance.demigod` | Bán Thần ra mắt | Sáng, bay: arpeggio pluck đi lên, lấp lánh, kick nhẹ | ~3 s |
| `entrance.godslayer` | Kẻ Sát Thần ra mắt | Dữ dội: bass reese gầm, riser căng, drop nặng, kết bằng một nhát "chém" (tiếng ồn quét) | ~4 s |
| `moment.ascend` | BP-41: ai đó hóa Thần Bài trong ván | Biến thể ngắn của `entrance.god` | ~2,5 s |
| `moment.demigod` | BP-41: ai đó thành Bán Thần | Biến thể ngắn của `entrance.demigod` | ~2 s |
| `moment.godslain` | BP-41: Thần Bài bị hạ | Biến thể ngắn của `entrance.godslayer` | ~2,5 s |
| `moment.jackpot` | BP-41: xúc xắc 6-6-6 nổ hũ | Chuông xèng + drop ngắn | ~2 s |

- Các khoảnh khắc BP-41 có tiếng **(phiên chọn)** vì chúng chính là những lúc "pentakill" của bàn hỗn loạn. Tiếng phát cùng
  lúc banner tương ứng hiện, nên cũng theo luật chống spoiler của BP-41: banner hạ Thần chờ lật bài xong, và 6-6-6 phát lúc
  xúc xắc dừng.
- **Âm lượng:** mặc định khoảng 60 % âm lượng tối đa của game, có bộ nén/giới hạn ở đầu ra để không đoạn nào chói tai.
- **Không chồng tiếng:** hai đoạn trùng nhau thì đoạn sau chờ, theo đúng hàng đợi của băng thông báo.

### 5.3 Nút tắt tiếng

- Nút **loa** trong thanh đầu phòng, ở mọi bàn và mọi khổ màn hình, đặt cạnh các nút hiện có. Nhãn trợ năng
  "Tắt tiếng" / "Bật tiếng".
- Có thêm một ô bật/tắt cùng ý nghĩa trong phần cài đặt của người chơi, nếu màn đó đã có chỗ phù hợp (người dựng chọn).
- **Lưu trên thiết bị** (localStorage, đọc/ghi trong try/catch) **(phiên chọn)**. Không cần đồng bộ theo tài khoản ở phase
  này. Mặc định: **bật tiếng**.
- Tắt tiếng thì mọi âm thanh của game im. Phase sau có bài nhạc nền thì tách hai nút: "Nhạc" và "Hiệu ứng" (mục 9).
- Phải có bản dịch vi + en và đi qua parity test như mọi chuỗi khác.

## 6. Bộ trang phục danh hiệu (G10)

Mỗi danh hiệu mở khóa **một bộ** gồm các món dùng ô sẵn có của chibi (`docs/avatar-2d.md` §2). Phiên đề xuất bộ dưới đây; tên
vi là (phiên chọn):

| Danh hiệu | Áo (`outfit`, hai dáng nam/nữ) | Đầu (`head`) | Hào quang (`aura`) | Khung (`frame`) |
|---|---|---|---|---|
| Hóa Thần | **Long bào Thần Bài**: vàng–đỏ, họa tiết bốn chất bài, viền kim tuyến | **Vương miện Át**: vương miện vàng gắn lá Át bích ở giữa | **Hào quang Thần Bài**: vầng sáng vàng, bốn lá Át bay quanh | **Khung Thần Bài**: vàng–đỏ, có vương miện nhỏ trên đỉnh |
| Bán Thần | **Áo choàng Bán Thần**: trắng–bạc, thắt lưng vàng nhạt | **Vòng nguyệt quế bạc**: vòng lá bạc kèm một quầng sáng mảnh | **Hào quang Bán Thần**: ánh sáng bạc–xanh nhạt, lấp lánh | **Khung Bán Thần**: bạc, cánh nhỏ hai bên |
| Kẻ Sát Thần | **Giáp Sát Thần**: giáp đen viền đỏ thẫm, áo choàng rách | **Mũ sừng Sát Thần**: mũ giáp đen có sừng, mắt đỏ | **Hào quang Sát Thần**: lửa đỏ thẫm, mảnh vương miện vỡ bay quanh | **Khung Sát Thần**: đen–đỏ, vết nứt |

- **Tổng cộng:** 3 áo (6 tranh vì có hai dáng), 3 món đầu, 3 hào quang, 3 khung, tức 12 món và 15 tranh. Tất cả độ hiếm `epic`.
- **Mở khóa:** cùng lúc với danh hiệu. Thành tựu Hóa Thần / Bán Thần / Kẻ Sát Thần trao **cả bộ**, không chỉ dòng danh hiệu.
  Không bán trong cửa hàng, không tặng qua GM trừ khi GM chủ động (giống các món thành tựu hiện có).
- **Trao bù (phiên chọn):** hôm nay chưa có đường backfill thành tựu nào trao món. Chạy lại một lần mở khóa sẽ trả lại
  300.000 / 150.000 / 500.000 điểm, nên không được dùng cách đó. Cần **một lần trao bù chỉ gồm vật phẩm**, chạy lại bao nhiêu
  lần cũng không trao trùng:
  - Ai đang **sở hữu** món `title_god` / `title_demigod` / `title_godslayer`, kể cả do GM tặng, thì nhận các món còn thiếu
    của bộ tương ứng. Sở hữu danh hiệu là có bộ.
  - Không có điểm, không có danh vọng, không ghi sổ tiền.
  - Chạy trên VPS là một bước của deploy phần B, đã nằm trong lệnh deploy.
  - Chạy trên máy LAN (Neon của người dùng) thì **hỏi trước**.
- **Hào quang động (phiên chọn):** hôm nay hào quang là tranh tĩnh. Riêng ba hào quang danh hiệu có thêm hiệu ứng CSS nhẹ
  (thở sáng / lấp lánh) trên lớp aura, có đường giảm chuyển động (đứng yên) kèm test. Không đổi các hào quang cũ. Phần này
  thuộc **phần B**, vì chưa có tranh thì chưa có món aura nào.
- **Các món chỉ vào danh mục (`items.json`) khi tranh đã có**: thiếu tranh thì `avatar:check` báo lỗi, và một món không có
  tranh vẫn mặc được trong tủ đồ.
- **Cách vẽ:** theo vòng lặp sinh ảnh ChatGPT của các đợt tủ đồ trước (`docs/avatar-2d.md` §10.3–§10.7, BP-33/35/36): tham
  chiếu dựng lại từ các lớp đã commit, `verify` → `ingest` → `avatar:check`. Món đầu cao (sừng, vương miện) dễ làm ChatGPT
  thu nhỏ nhân vật, nên phải đo bản nháp trước khi collect (bài học BP-35). Người dùng duyệt tranh như các đợt trước.
- Ba món danh hiệu chữ `title_*` giữ nguyên.

## 7. Thứ tự giao (phiên chọn)

Hai phần độc lập, giao theo thứ tự:

1. **Phần A — màn ra mắt + âm thanh + nút tắt tiếng.** Toàn bộ là code, phiên tự làm trọn được.
   - **Nghe thử trước khi deploy (phiên chọn):** người dựng không nghe được, nên tai là của người dùng. Phần A có một **trang
     nghe thử** trong playground của ui-kit (`#sounds`): bấm để phát từng đoạn của mục 5.2, mỗi đoạn kèm băng thông báo của nó.
   - Ngoài ra có các kiểm tra khách quan bằng `OfflineAudioContext`: độ dài trong khoảng ±10 % của bảng, không clip (đỉnh dưới
     0 dBFS sau bộ giới hạn), đuôi im ở cuối, và mỗi đoạn khác nhau.
   - Phần A merge khi gate xanh, nhưng **chỉ deploy sau khi người dùng nghe thử và duyệt câu chữ**. Người dùng chê đoạn nào thì
     sửa đoạn đó trước.
2. **Phần B — 15 tranh của bộ trang phục, hiệu ứng CSS cho ba hào quang, thành tựu trao cả bộ, và lần trao bù.** Cần trình
   duyệt có phiên ChatGPT của người dùng (Claude in Chrome) và người dùng duyệt tranh, nên chạy khi người dùng có mặt.

Hai phần có thể đi chung một nhánh hoặc tách làm hai nhánh BP; người lập plan chọn.

## 8. Ràng buộc

- Không thêm runtime dependency (Web Audio là API của trình duyệt). `@bp/core` giữ thuần.
- Mọi chuỗi có vi + en; số qua `formatPoints`; `react/jsx-no-literals`. Các từ ổn định của e2e không đổi.
- Chuyển động mới có đường giảm chuyển động kèm test. Chữ không đè chữ (`expectNoTextOverlap`). Không cuộn ngang và không làm
  stage cuộn ở 1920×940, 1366×768, 375×812 và hai khổ Galaxy S25 (360×780, 780×360).
- Luật chống spoiler của BP-41 (Rulings 20b, 21, 22, 28) áp cho cả băng ra mắt và tiếng.
- Không có đường tiền nào mới. Thưởng danh hiệu đã trả ở BP-41; phase này chỉ thêm vật phẩm.
- Ops pack: thêm case cho màn ra mắt (desktop + một khổ S25): một tài khoản đeo danh hiệu ngồi vào bàn, cả hai máy thấy đúng
  câu chữ, băng không đè kết quả, ngồi lại trong 10 phút không ra mắt lần hai, nút tắt tiếng đổi trạng thái và giữ sau F5.
  Âm thanh không kiểm bằng tai trong e2e. Chỉ kiểm rằng lệnh phát được gọi (hoặc không gọi khi tắt tiếng hay tab ẩn) qua một
  hook đo.
- Các tài khoản mới trong ops chỉ tạo qua `newPlayer` / `registerPatiently` (giới hạn đăng ký).

## 9. Phase sau (không thuộc spec này)

- **Bài nhạc nền EDM dài, phát lặp suốt bàn** (H4): ví dụ một bản khi có Thần Bài đang trị vì, hoặc một bản cho cả bàn hỗn
  loạn. Có nút "Nhạc" riêng, tách khỏi "Hiệu ứng". Cần quyết định: phát khi nào, cả phòng cùng nhịp hay mỗi máy tự phát, độ
  dài vòng lặp, cách giữ nhẹ CPU và pin trên điện thoại.
- Giọng hô kiểu pentakill (thu âm hoặc giọng máy), nếu người dùng muốn.
- Âm thanh cho thao tác thường (chia bài, tố, thắng ván).

## 10. Ghi chú cho người dựng (từ bước kiểm tra)

- **Phòng chưa biết danh hiệu đang đeo.** `@bp/server-kit` không giữ dữ liệu trang phục, còn máy khách lấy chibi qua HTTP.
  Màn ra mắt cần một hook phía Normal lúc ngồi ghế để đọc danh hiệu đang đeo từ DB. Thông điệp và trạng thái phía khách phải
  nằm **ngoài** `chaos`, và lớp khoảnh khắc phải vẽ ở **mọi bàn**, không chỉ `chaosTable` như hôm nay.
- **Lite không đổi (phiên chọn):** Lite dùng chung `RoomScreen`, nên nút loa và màn ra mắt phải tắt ở Lite. Lite không có âm
  thanh ở phase này.
- Thành tựu hôm nay trao một `reward.itemId` cùng điểm, một lần lúc mở khóa (`achievement-service.ts`). Trao cả bộ cần mở
  rộng dữ liệu thành tựu mà không trả điểm lần hai.

## 11. Để người dựng quyết định

- Cách máy chủ báo màn ra mắt (sự kiện phòng mới hay gắn vào sự kiện ngồi ghế), và nơi giữ dấu thời gian chống spam.
- Thế nào là "ngồi vào" so với lúc mang tiền lên bàn, và chủ phòng được xếp ghế ngay khi tạo phòng có ra mắt hay không.
- Kiến trúc module âm thanh, cách "soạn" từng đoạn trong code, cách test phần không nghe được.
- Vị trí đúng của nút loa ở từng khổ màn hình, miễn không gây chồng chữ hay cuộn.
- Cách thành tựu trao nhiều món (mở rộng dữ liệu thành tựu, hay thêm một danh sách món đi kèm).
