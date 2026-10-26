# BP-39 — Poker hỗn loạn, vòng 2: phản hồi người chơi

Spec bổ sung, 2026-10-27. Sửa và bổ sung spec gốc `2026-10-26-chaos-poker-design.md` (BP-37) theo phản hồi người chơi ở
`docs/bug-log.md` §12 (H1–H7) và một yêu cầu thêm trong phiên brainstorm (xem thông tin thẻ bằng cách chạm). Chỗ nào spec
này nói khác spec gốc thì spec này thắng; chỗ nào không nhắc thì spec gốc giữ nguyên. Chỗ ghi **(phiên chọn)** là quyết
định của phiên, người dùng sửa khi duyệt.

## 1. Ý định

Người chơi rất thích chế độ hỗn loạn vì tính bất ngờ. Vòng này không thêm thẻ mà sửa **cách người chơi nhìn và điều
khiển** thẻ:

- Thấy người thắng **và** hiểu thẻ nào vừa nổ, kể cả trên điện thoại dọc (Galaxy S25, 360×780) và xoay ngang (780×360).
- Có đủ thời gian đọc mà cả bàn không bị kéo chậm vô lý.
- Tự quyết dùng thẻ thưởng vào ván mình thấy đáng nhất (mất chủ động là mất hứng).
- Không hết tiền trên bàn trước khi kịp trải nghiệm.

**Thành công:** trên S25 cả dọc lẫn ngang, người chơi thấy toàn bộ ván, người thắng và các thẻ đã dùng mà không phải
cuộn; chạm vào bất kỳ thẻ nào cũng đọc được nó làm gì; người chơi nói thẻ thưởng "của mình".

**Không làm:** không cân lại số liệu thẻ (H6, chờ thống kê của người dùng); không đổi bàn Blind thường và bàn Hold'em;
không mở cho Lite.

**Phản mục tiêu:** toast hay dải kết quả che lá chung hoặc nút hành động; một người đọc chậm bị người khác bấm qua mất
kết quả; người chơi để "Tự động chơi" bị phí thẻ thưởng; một người giữ cả tay thẻ thưởng rồi xả hết vào một ván.

## 2. Quyết định của người dùng

| # | Câu hỏi | Người dùng chọn |
|---|---|---|
| F1 | Điện thoại dọc: toast và kết quả đặt ở đâu? (H1, H3) | **Phương án B**: toast trải ngang ngay dưới thanh tiêu đề; kết quả ván là một **dải gọn sát trên khay nút**, có đếm ngược tới ván sau. Mặt bàn giữa không bị che. |
| F2 | Xoay ngang S25 780×360? (H4) | **L-B**: giống màn dọc — toast ngang trên cùng, kết quả là dải ngang chia cột sát trên nút. Màn chọn thẻ là **một hàng ngang 3 thẻ**, không cuộn. |
| F3 | Thông báo hiệu ứng thẻ (H3) | **Toast** thay cho dải thông báo giữa bàn (đề xuất (a) trong bug-log, người dùng duyệt qua F1). |
| F4 | Thời gian hiện kết quả (H2) | **Một con số cố định** (ví dụ 5–10 giây) và **nút bỏ qua** cho mọi người chơi để rút ngắn. |
| F5 | Xem thông tin thẻ trên điện thoại | Chạm vào thẻ thì thấy thông tin thẻ, bằng **tooltip tự làm** (không dùng `title` của trình duyệt). |
| F6 | Thẻ thưởng (H5) | **Giữ trên tay và tự bấm dùng** vào ván mình thấy đáng nhất. Người dùng xác nhận bản tóm tắt của phiên (mục 3.4). |
| F7 | Hạn mức bàn hỗn loạn (H7) | **Không giới hạn**: người chơi mang **toàn bộ số dư** lên bàn. |
| F8 | Cân bằng thẻ (H6) | Chưa làm; người dùng sẽ thống kê. |
| F9 | Lúc nào được bấm dùng thẻ thưởng? | **(a) Cả trong lúc chọn Chơi/Bỏ** của ván đang chạy (xem bài rồi mới quyết), và giữa hai ván. |
| F10 | Nhiều người cùng kích hoạt thẻ che người thắng trên điện thoại | Phải sửa (người dùng bổ sung 27/10) — mục 3.1. |

## 3. Thay đổi

### 3.1 Toast hiệu ứng thẻ (F1, F2, F3)

Thay dải thông báo giữa bàn (spec gốc §3.6, `ChaosBanner`) bằng **toast**:

- Mỗi thẻ nổ là một toast: "**Bot 1** dùng **Rút lá lẻ** → **Bạn**" kèm kết quả ngắn (bị chặn / không có tác dụng khi
  có). Không viết câu riêng cho từng hiệu ứng: nghĩa của thẻ đọc ở khung thông tin thẻ (mục 3.5) khi chạm vào toast
  **(phiên chọn: tránh ~27 câu × 2 ngôn ngữ và thêm dữ liệu vào sự kiện)**. Chữ không bị cắt "…": toast xuống dòng (tối
  đa 2 dòng ở 360 px).
- Ghi chú cả ván của "Thế giới đảo ngược" (đang nằm trong dải thông báo) chuyển thành một toast **ghim** suốt ván đó.
- Toast hiện theo đúng thứ tự áp (spec gốc §3.5), **chồng lên nhau**, tối đa **3** cái cùng lúc; cái mới đẩy cái cũ nhất
  ra. Mỗi toast ở lại khoảng **4 giây** kể từ khi nó hiện **(phiên chọn)**; chạm vào toast thì nó ở lại cho tới khi chạm
  lần nữa hoặc ván sau bắt đầu **(phiên chọn)**.
- Vị trí:
  - **Điện thoại dọc** (F1): trải ngang ngay dưới thanh tiêu đề bàn.
  - **Xoay ngang** (F2): trải ngang ở trên cùng, có thể xếp 2 toast cạnh nhau trên một hàng khi đủ chỗ.
  - **Máy tính** (1920×940, 1366×768): góc trên bên phải của vùng bàn **(phiên chọn)**; không đè ghế, lá chung, thẻ kết
    quả.
- Kết quả ván **không còn chờ hàng đợi thông báo**: dải kết quả mở ngay lúc tính tiền, toast chạy song song.
- **Nhiều người cùng kích hoạt thẻ (người dùng bổ sung 27/10):** trên điện thoại, đôi khi các thông báo kích hoạt che
  mất phần người thắng. Luật để điều này không thể xảy ra:
  - Vùng toast và dải kết quả là **hai vùng tách riêng** của bố cục điện thoại (toast ở trên, kết quả ở dưới, mặt bàn ở
    giữa), không phải hai lớp nổi chồng lên nhau. Toast không bao giờ được vẽ đè lên dải kết quả, dù có bao nhiêu thẻ.
  - Vùng toast có **chiều cao tối đa cố định**: dọc tối đa 3 toast; ngang **một hàng** (tối đa 2 toast cạnh nhau)
    **(phiên chọn)**.
  - Có nhiều thẻ nổ hơn số chỗ thì các toast dư **gộp thành một toast "+N thẻ khác"**; chạm vào nó mở danh sách đủ các thẻ
    của ván (người chơi tự mở, đóng bằng chạm lại hoặc chạm ra ngoài). Danh sách đầy đủ vẫn có ở dòng "Thẻ đã dùng" của
    dải kết quả.
  - Lúc dải kết quả đang mở mà còn toast đang chờ hiện thì các toast đó vào thẳng "+N thẻ khác", không làm vùng toast
    giãn ra **(phiên chọn)**.
  - Test: bàn 8 người, cả 8 ghế cùng nổ thẻ trong một ván; ở 360×780 và 780×360, khung của mọi toast không giao với khung
    dải kết quả, lá chung và khay nút, và không cần cuộn.
- Hiệu ứng lá bị đổi (lật, mờ) giữ như BP-37. Hoạt ảnh vào/ra của toast có đường giảm chuyển động.
- Quyền riêng tư giữ như BP-37: thẻ lúc chia bài riêng tư (`PRIVATE_AT_DEAL`) chỉ hiện toast cho chủ thẻ và người bị
  nhắm; cả bàn biết qua tổng kết lúc tính tiền.

### 3.2 Dải kết quả ván (F1, F2)

- Trên điện thoại (dọc và ngang), thẻ kết quả ván của bàn hỗn loạn thành **dải sát trên khay nút**, không bao giờ bị
  toast đè:
  - Dòng đầu: "**Người thắng** · Ván tiếp theo sau N giây" và nút **"Bỏ qua"** (mục 3.3).
  - Các dòng người chơi: tên — bộ bài — tiền thắng/thua, người thắng in đậm trên cùng.
  - Dòng **"Thẻ đã dùng"**: tên thẻ kèm người dùng, ví dụ "Rút lá lẻ (Bot 1), Bão lá chung (Bạn)". Mỗi tên thẻ chạm
    được (mục 3.5).
  - Xoay ngang: các phần xếp thành cột cạnh nhau để dải thấp nhất có thể (L-B).
- Bàn đông (tới 8 người) mà không đủ chỗ: dải hiện người thắng và **người xem** trước, những người còn lại thu thành
  "+N người" mở ra được — **không** để cả màn hình phải cuộn **(phiên chọn)**.
- Máy tính giữ thẻ kết quả như hiện tại, có thêm nút "Bỏ qua" và đếm ngược.
- Bàn Blind thường và Hold'em không đổi.

### 3.3 Thời gian kết quả và nút "Bỏ qua" (F4)

- Ở bàn hỗn loạn, ván sau chia sau **10 giây** tính từ lúc tính tiền (thay 5 giây của `handIntervalMs`) **(phiên chọn:
  con số trong khoảng 5–10 người dùng nêu, chọn đầu trên vì thẻ cần đọc)**. Số này nằm trong `chaos_config`
  (`resultSeconds`), GM chỉnh trong tab "Thẻ hỗn loạn" trong khoảng **5–15** giây, có lý do và ghi "Nhật ký" như các số
  khác.
- Mỗi người chơi đang ngồi có nút **"Bỏ qua"** trên dải kết quả. Bấm rồi thì nút thành "Đã bỏ qua" (không bỏ bấm lại).
- **Ván sau bắt đầu ngay khi mọi người chơi thật đang ngồi đều đã bấm** **(phiên chọn — người dùng chưa trả lời giữa
  "mọi người" và "một người"; phiên chọn "mọi người" để người đọc chậm không bị người khác bấm qua mất kết quả)**. Được
  tính là đã bấm: bot, người đang "Tạm nghỉ", người đang "Tự động chơi", người mất kết nối. Hết giờ thì chia như thường.
- Dải kết quả hiện số đã bấm trên tổng, ví dụ "Bỏ qua 2/4", cho mọi người.
- Bỏ qua chỉ rút ngắn lúc chờ sau tính tiền. Khung chọn thẻ (spec gốc §3.2) vẫn có đồng hồ 15 giây riêng của nó.
- Server là nơi quyết định: client gửi một lệnh bỏ qua, server đếm, phát số đếm, và khi đủ thì dời giờ chia ván (cập nhật
  `nextHandAt`). Lệnh bỏ qua ngoài lúc chờ kết quả bị bỏ qua lặng lẽ.

### 3.4 Thẻ thưởng: giữ trên tay, tự bấm dùng (F6)

Thay spec gốc §3.3 câu "Thẻ thưởng không phải chọn, nhận ngay" và một phần §3.4:

- **Nhận:** đủ 10 điểm hỗn loạn thì trừ 10 và nhận **1 thẻ thưởng**, cấp và thẻ vẫn ngẫu nhiên (60/30/10, thẻ đang bật
  hợp với bàn) để giữ bất ngờ. Thẻ **không tự chạy** mà vào **tay thẻ thưởng** của người đó.
- **Tay thẻ thưởng:** tối đa **3** thẻ. Tay đầy thì điểm hỗn loạn **giữ lại** (không trừ, không mất), thẻ mở khi có chỗ
  **(phiên chọn: không phải hỏi "thay thẻ nào", không mất gì)**.
- **Bấm dùng:** người chơi chạm một thẻ trong tay rồi xác nhận "Dùng" (chạm để xem thông tin thẻ, mục 3.5; dùng là một
  bước riêng để không dùng nhầm).
  - Bấm được **giữa hai ván** (lúc dải kết quả hoặc lúc chờ) và **trong lúc chọn Chơi/Bỏ** của ván đang chạy (F9). Hết
    lúc chọn thì khóa tới khi ván tính tiền xong. Bàn "Hoàn toàn may rủi" không có lúc chọn nên chỉ bấm được giữa hai ván
    (áp ván sau) **(phiên chọn)**.
  - Thẻ lúc lật bấm giữa ván được thêm vào trạng thái ván **sau khi đã chia** (`HandState.chaos`), nên `@bp/core` phải
    nhận thẻ thêm vào giữa ván, trước lúc lật, và Bạo kích/Bảo hiểm tính đúng với thẻ đó.
  - Thẻ **lúc chia bài** bấm trong ván đang chạy thì áp từ ván sau; bấm giữa hai ván thì áp ván sau.
  - Thẻ **lúc lật bài** (debuff, chia lại lá chung, mượn lá) bấm trong lúc chọn thì áp lúc lật của **chính ván đó**;
    bấm giữa hai ván thì áp ván sau.
  - Thẻ có thời hạn n ván áp n ván kể từ ván nó bắt đầu áp.
  - Mỗi ván một người chỉ bấm dùng **1 thẻ thưởng** **(phiên chọn: tránh xả cả tay vào một ván)**.
  - Thẻ đã bấm dùng vào hàng như thẻ chọn ở khung chọn và theo đúng luật của chúng (một debuff mỗi ghế mỗi ván, mỗi người
    chịu tối đa một debuff, Khiên/Gương, đóng băng chặn). Khi ghế có cả debuff đã bấm và debuff từ khung chọn đang chờ,
    debuff **đã bấm** nổ trước **(phiên chọn: người chơi vừa chọn ván này)**.
  - Người đang bị **đóng băng** không bấm dùng được trong ván bị đóng băng.
- **Thẻ không cần bấm** — nhận làm thẻ thưởng thì chạy như hôm nay, không vào tay thẻ thưởng **(phiên chọn)**:
  - thẻ chờ điều kiện (Cấp cứu, Thần tài, Khiên, Gương): vào hàng thẻ đang có, tự nổ khi đủ điều kiện;
  - thẻ "ngay khi nhận" (Tích lũy, Cấp độ): nổ ngay; thẻ do Cấp độ sinh ra cũng chạy ngay như hôm nay;
  - thẻ thưởng của Thần tài (spec gốc §5.5) và thẻ thưởng bị giữ vì đóng băng: chạy như hôm nay.
- **Thẻ lúc chọn** (✱ Nhìn trộm, Bỏ không mất) vào tay thẻ thưởng; bấm dùng thì áp cho **ván sau** (nhìn trộm hiện khi
  lúc chọn của ván đó mở) **(phiên chọn)**.
- **Thông báo khi dùng:** một thẻ bấm dùng trong ván đang chạy chỉ được báo cho người khác **lúc nó nổ** (toast, số thẻ
  trên ghế giảm); trước đó chỉ chủ thẻ thấy "đã đặt dùng". Nếu chủ thẻ bỏ bài hoặc ván không có lật bài, thẻ **trở về tay
  thẻ thưởng** và không ai biết nó đã được đặt **(phiên chọn: để việc bấm dùng không lộ người đó sẽ "Chơi")**.
- **Giới hạn 1 thẻ thưởng mỗi ván** tính theo **ván thẻ áp vào**, không theo ván bấm **(phiên chọn)**.
- **Tự động chơi / vắng mặt:** thẻ thưởng không tự dùng, nằm trên tay chờ người chơi quay lại.
- **Bot:** dùng thẻ thưởng ngay ván kế tiếp sau khi nhận (như hôm nay).
- **Rời bàn:** mất cả tay thẻ thưởng, như mọi thẻ khác.
- **Người khác thấy gì:** biểu tượng trên ghế cho thấy người đó đang giữ **bao nhiêu** thẻ thưởng, nhưng không thấy là
  thẻ gì cho tới khi dùng. Thẻ đã dùng hiện như thẻ thường (toast, "Thẻ đã dùng").
- **Thẻ từ khung chọn** (đầu buổi, mỗi 5 hoặc 10 ván) giữ nguyên: tự áp, công khai trên ghế.
- Nơi hiện tay thẻ thưởng: một khay nhỏ gần ghế của mình / khay nút, không đè lá của mình hay nút hành động; trên điện
  thoại dọc và ngang vẫn không cuộn.

### 3.5 Khung thông tin thẻ (F5)

- Một thành phần **tooltip tự làm** trong `@bp/ui-kit`, dùng chung cho mọi chỗ có thẻ hỗn loạn: 3 thẻ ở màn chọn thẻ, tay
  thẻ thưởng, biểu tượng thẻ trên ghế (kể cả cụm "+N"), toast, tên thẻ trong dòng "Thẻ đã dùng".
- Mở bằng **chạm** (cảm ứng), **rê chuột** hoặc **focus bàn phím** (máy tính). Đóng bằng chạm lại, chạm ra ngoài, `Esc`,
  hoặc khi phần tử mang nó biến mất.
- Nội dung: **tên thẻ**, **cấp** (Bạc/Vàng/Kim cương, theo màu cấp), **mô tả đầy đủ** (`chaos.cards.<id>.desc`, không cắt),
  lúc áp (lúc chia / lúc lật / chờ điều kiện), thời hạn còn lại nếu có. Với thẻ đã dùng: **ai dùng, nhắm vào ai, kết quả**
  (đã áp / bị chặn / không có tác dụng).
- Tự đặt lên trên hoặc xuống dưới để luôn nằm trọn trong màn hình ở 360 px dọc và 780×360 ngang; không bao giờ tràn ngang.
- Ở màn chọn thẻ, chạm lần đầu vào thẻ trên điện thoại chỉ **chọn** thẻ như hôm nay; thông tin thẻ đã nằm ngay trên thẻ
  (mục 3.6), nên không cần tooltip để chọn **(phiên chọn: không đổi luồng chọn đã có test)**. Chỗ cần tooltip là những
  chỗ chỉ có biểu tượng hoặc tên.
- Truy cập: phần tử mở được có vai trò nút, tooltip nối bằng `aria-describedby`; trình đọc màn hình đọc được nội dung.
- Bỏ các `title=` của thẻ hỗn loạn (đang chỉ hiện khi rê chuột, vô dụng trên điện thoại).
- Không thêm thư viện runtime mới.

### 3.6 Màn chọn thẻ xoay ngang (F2)

- Khi xoay ngang (chiều cao nhỏ), 3 thẻ ở màn chọn thẻ nằm **một hàng ngang**, mỗi thẻ có tên, cấp và mô tả 2–3 dòng,
  đồng hồ ở góc; không cuộn ở 780×360.
- Màn dọc giữ như BP-37 (đã kiểm ở 375×812), chỉ kiểm thêm ở 360×780.

### 3.7 Hạn mức bàn hỗn loạn (F7)

- Bàn hỗn loạn **không có hạn mức**: khi ngồi, người chơi mang **toàn bộ số dư** lên bàn (vẫn cần đủ ít nhất một mức
  cược như hôm nay). Bàn Blind thường giữ hạn mức 10× (BP-31).
- Màn tạo phòng và sảnh: khi bật "Poker hỗn loạn", ô "Hạn mức" hiện **"Không giới hạn"** thay con số.
- Bot ở bàn hỗn loạn vẫn được nạp lại tới 10 mức cược như hôm nay (điểm của bot là điểm ảo) **(phiên chọn)**.
- Rời bàn trả cả stack về số dư như mọi bàn. Rào chắn kinh tế của spec gốc §4 giữ nguyên (không ván nào mất quá phần đã
  đặt; Cấp cứu vẫn chỉ nổ khi stack dưới 2 mức cược sau một ván thua — với hạn mức không giới hạn điều này nghĩa là gần
  hết số dư).
- Đây là một đường tiền: test bảo toàn `Σ số dư + Σ dòng nguồn/thoát` cho ngồi xuống với toàn bộ số dư và rời bàn.

### 3.8 Thẻ "Rút lá lẻ" (H6, chỉ ghi nhận)

- Đã kiểm mã: "Rút lá lẻ" chọn người bị rút **ngẫu nhiên** trong các đối thủ còn trong ván và bỏ một lá **ngẫu nhiên**
  (`engine.ts` `applyRevealEffects` / `handDebuff`, `rng.int`). Cảm giác "rút lá mạnh" là vì bàn 2 lá mất 1 lá là mất nửa
  bài, và nó nổ sau khi đã hết lá chung.
- Vòng này không đổi số liệu. Mô tả thẻ trong tooltip ghi rõ "một lá ngẫu nhiên" nếu mô tả hiện tại chưa ghi **(phiên
  chọn)**. Cân bằng chờ thống kê của người dùng, qua trọng số trong tab GM nếu được.

## 4. Ràng buộc

- Luật dự án giữ nguyên: điểm ảo, test bảo toàn cho đường tiền (F7), vi + en cho mọi chuỗi mới ("Bỏ qua", "Đã bỏ qua",
  "Bỏ qua 2/4", "Dùng", "Không giới hạn", "Thẻ thưởng"…), hoạt ảnh có đường giảm chuyển động, không thêm thư viện runtime.
- Thuật ngữ ổn định không đổi; "Bỏ qua" là thuật ngữ mới, không trùng "Bỏ bài".
- Bàn Blind thường và Hold'em chạy y như hôm nay: không đổi thời gian giữa ván, hạn mức, thẻ kết quả.
- Kiểm tra màn hình ở **1920×940, 1366×768, 375×812** như mọi lần, **thêm 360×780 (S25 dọc) và 780×360 (S25 ngang)** cho
  bàn hỗn loạn: không cuộn, không chữ đè chữ (`expectNoTextOverlap`), toast không đè dải kết quả, lá chung và nút hành
  động. Các khổ S25 vào bộ ops (`e2e:ops`) cho các ca hỗn loạn.
- Giao thức: thêm lệnh bỏ qua, sự kiện đếm bỏ qua, lệnh dùng thẻ thưởng và trạng thái tay thẻ thưởng (riêng cho chủ;
  người khác chỉ nhận số lượng). Không lộ thẻ thưởng chưa dùng cho người khác qua snapshot hay sự kiện. Hôm nay
  `CHAOS_STATE` và `CHAOS_AWARDED` gửi mã thẻ của mọi ghế cho cả bàn, nên phải tách phần chủ thẻ thấy và phần người khác
  thấy (cả snapshot khi vào lại).
- `handIntervalMs` hiện là một thiết lập chung của server và `ChaosTable` chỉ đọc `chaos_config` khi mở khung chọn:
  `resultSeconds` cần đường đọc riêng (đổi trong tab GM có hiệu lực từ ván kế tiếp), và bỏ qua phải dời được `nextHandAt`.

## 5. Để người dựng quyết định

- Tên lệnh/sự kiện giao thức, chỗ lưu tay thẻ thưởng trong `ChaosTable`, chia task.
- Hình dáng toast, tooltip, khay thẻ thưởng (theo token của ui-kit), hoạt ảnh vào/ra.
- Cách thu gọn dải kết quả khi bàn đông, miễn là theo mục 3.2.
- Cách thêm khổ S25 vào ops (dự án mới hay tham số hóa các ca hỗn loạn), miễn là các ca hỗn loạn chạy ở cả hai khổ.
