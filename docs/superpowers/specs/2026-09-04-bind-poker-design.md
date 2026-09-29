# Bind Poker — Software Requirement Specification & Thiết kế hệ thống

- Ngày: 2026-09-04 (cập nhật 2026-09-05 sau M9: §32, §33, §34 và Phụ lục B)
- Trạng thái: Đã duyệt và **đã hiện thực hóa hết phạm vi MVP** qua Plan 1–7. Bảng đối chiếu từng mục chấp nhận: `docs/acceptance-checklist.md`; hạn chế đã biết: `docs/known-limitations.md`
- Nguồn yêu cầu gốc: `requirement.txt`
- Ngôn ngữ tài liệu: tiếng Việt, thuật ngữ kỹ thuật và định danh mã giữ nguyên tiếng Anh

---

## 0. Kết quả phân tích yêu cầu

Phần này liệt kê các điểm thiếu, mơ hồ hoặc rủi ro phát hiện trong `requirement.txt` và cách xử lý. Các quyết định lớn được ghi trong Phụ lục A (Decision Log).

| # | Vấn đề phát hiện | Loại | Xử lý |
|---|---|---|---|
| R1 | Luật Blind Poker chỉ nói "cược cố định trước khi lật", không nói có quyết định hay không | Mơ hồ, luật game | Hỏi người dùng → hỗ trợ **hai kiểu** A (thuần may rủi) và B (Play/Fold), chọn khi tạo phòng |
| R2 | Bản 3 lá không định nghĩa số lá chung và cách chọn lá | Thiếu, luật game | Hỏi người dùng → luật poker chuẩn: 2 hoặc 3 lá riêng, 5 lá chung, 5 lá tốt nhất |
| R3 | Môi trường Lite "hạn chế về tech" không nói rõ có runtime gì | Rủi ro deploy | Hỏi người dùng → không có Node.js, Windows → đóng gói **một file exe** bằng Node SEA |
| R4 | Phương thức xác thực Normal không nêu | Bảo mật | Hỏi người dùng → email + mật khẩu |
| R5 | Không nêu poker variant cụ thể | Mơ hồ | Chọn **No-Limit Texas Hold'em** (variant phổ biến nhất, dùng chung evaluator với Blind) |
| R6 | Không nói Normal Poker có bot không | Thiếu | Bot hỗ trợ cả hai mode vì cùng interface; bot Hold'em là should-have |
| R7 | Kinh tế chỉ nêu min 5.000/ngày, không có bể điểm | Rủi ro kinh tế | Thiết kế phí bàn 2% làm bể chính, cứu trợ có trần, bảng daily có max 40.000 |
| R8 | Trạng thái phòng khi server restart | Thiếu | Không lưu ván giữa chừng; hoàn cược có kiểm soát khi tắt; ghi giới hạn |
| R9 | Cách tính điểm khi ngồi bàn Hold'em (chơi bằng toàn bộ số dư hay buy-in) | Thiếu | Buy-in tách stack khỏi balance, trả về khi đứng dậy |
| R10 | Xung đột: yêu cầu "monthly reset" và "consecutive streak" | Xung đột nhẹ | Streak reset về 1 vào ngày đầu tháng **và** khi bỏ lỡ một ngày |
| R11 | Yêu cầu "Lite excludes Normal assets" nhưng cùng codebase | Rủi ro kiến trúc | Mỗi edition là app riêng có `package.json` riêng; test tự động kiểm tra bundle |
| R12 | Timeout trong pha Blind B đồng thời | Thiếu | Timeout = Fold |
| R13 | Tất cả cùng Fold trong Blind B | Thiếu | Pot cộng dồn sang ván sau |
| R14 | Múi giờ cho daily reward | Thiếu | Config `ECONOMY_TIMEZONE`, mặc định `Asia/Ho_Chi_Minh` |

---

## 1. Product Overview

**Bind Poker** là web game poker nhiều người chơi thời gian thực, dùng điểm ảo, gồm hai chế độ:

- **Normal Poker**: No-Limit Texas Hold'em chuẩn.
- **Blind Poker**: biến thể lấy cảm hứng từ "3 cây": cược cố định trước khi lật bài, chia 2 hoặc 3 lá riêng, 5 lá chung, xếp hạng theo poker, có bot.

Sản phẩm phát hành dưới **hai edition từ một codebase**:

- **Normal Edition**: Internet công khai, tài khoản email/mật khẩu, PostgreSQL, avatar, inventory, achievement, daily reward, thống kê.
- **Lite Edition**: một file `bind-poker-lite.exe` cho Windows, chạy trên host nội bộ không có Node.js, SQLite nhúng, chỉ gồm gameplay + phiên đơn giản + daily reward tối giản.

Không có tiền thật ở bất kỳ dạng nào.

## 2. Goals

1. Gameplay đúng luật, server là nguồn sự thật duy nhất.
2. Realtime ổn định: reconnect, timer, chống action trùng/sai lượt.
3. Một core game engine dùng chung; đổi luật chỉ sửa một nơi.
4. Normal và Lite build và deploy độc lập; Lite không kéo theo dependency Normal.
5. UI responsive, song ngữ Anh/Việt, đổi ngôn ngữ lúc chạy.
6. Kiến trúc đơn giản, một tiến trình Node, không hạ tầng phụ ngoài Postgres (Normal).
7. Kinh tế điểm có nguồn và bể rõ ràng, có số liệu để điều chỉnh.

## 3. Non-Goals

- Tiền thật, nạp/rút, payment gateway, crypto, NFT, marketplace.
- Machine learning / LLM cho bot.
- Kubernetes, Redis, message queue, microservices.
- Lưu ván đang chơi qua restart server (MVP).
- Xác minh email, quên mật khẩu qua email (roadmap).
- Chat, emote, spectator, replay, leaderboard (could-have, không nằm trong MVP).

## 4. User Personas

| Persona | Mô tả | Edition |
|---|---|---|
| **Người chơi giải trí** | Chơi vài ván Blind Poker mỗi ngày trên điện thoại, thích nhận thưởng đăng nhập, sưu tầm avatar | Normal |
| **Người chơi poker** | Muốn chơi Hold'em đúng luật với bạn bè trong phòng riêng có mật khẩu | Normal |
| **Nhân viên văn phòng nội bộ** | Chơi trong mạng nội bộ / AWS WorkSpaces vào giờ nghỉ, không đăng ký tài khoản, không cài đặt gì | Lite |
| **Người vận hành Lite** | Copy một file exe vào máy Windows, chạy, không có quyền cài runtime | Lite |
| **Người vận hành Normal** | Deploy bằng Docker Compose trên VPS, cần backup DB, health check, log | Normal |

## 5. User Stories

**Chung (Core)**
- US-01 Là người chơi, tôi tạo phòng, chọn chế độ (Normal/Blind), cấu hình cược, số người, công khai/riêng tư, timer.
- US-02 Tôi xem danh sách phòng công khai và vào phòng, hoặc vào phòng riêng bằng mã.
- US-03 Tôi bấm Ready; host bấm Start khi đủ người.
- US-04 Trong ván, tôi thấy bài mình, bài chung, pot, lượt ai, đồng hồ, trạng thái từng người, kết quả và bài thắng.
- US-05 Khi tới lượt tôi chỉ thấy các hành động hợp lệ; hành động sai bị server từ chối với lý do.
- US-06 Mất mạng giữa ván, tôi mở lại trình duyệt trong 90 giây và trở lại đúng ghế với đúng trạng thái.
- US-07 Tôi chơi Blind Poker với bot khi không đủ người.
- US-08 Tôi đổi ngôn ngữ Anh/Việt bất kỳ lúc nào.
- US-09 Tôi chơi được trên điện thoại dọc.

**Normal-only**
- US-10 Tôi đăng ký bằng email và mật khẩu, đăng nhập, đăng xuất.
- US-11 Mỗi ngày tôi nhận thưởng đăng nhập, thấy streak và phần thưởng ngày tới.
- US-12 Tôi mở khóa achievement khi đạt mốc và nhận điểm/item.
- US-13 Tôi tùy chỉnh avatar từ item trong inventory; người khác thấy avatar tôi trên bàn.
- US-14 Tôi xem thống kê thắng/thua, bài đẹp nhất, ván lớn nhất.

**Lite-only**
- US-15 Tôi nhập tên hiển thị và chơi ngay, không mật khẩu; lần sau mở lại vẫn là tôi.
- US-16 Là người vận hành, tôi chạy một file exe và mở URL cho đồng nghiệp.

## 6. Functional Requirements

Ký hiệu: **[C]** Core, **[N]** Normal-only, **[L]** Lite-only, **[O]** optional/lightweight (có ở cả hai nhưng mức khác nhau).

### 6.1 Gameplay
- FR-G01 [C] Server sinh RNG, xáo bài, chia bài, xác định lượt, tính pot, xác định người thắng, chia pot.
- FR-G02 [C] Client chỉ nhận PlayerView: lá riêng của mình, lá chung đã lật, thông tin công khai của người khác.
- FR-G03 [C] Mọi action client được validate: đúng state, đúng lượt, đúng loại, đúng số tiền.
- FR-G04 [C] Normal Poker theo luật mục 7; Blind Poker theo luật mục 8.
- FR-G05 [C] Hand evaluator xếp hạng đúng cho 5–8 lá, xử lý tie và kicker.
- FR-G06 [C] Side pot khi có all-in không đều (Normal Poker).
- FR-G07 [C] Turn timer; hết giờ áp dụng hành động mặc định (mục 7.9, 8.7).
- FR-G08 [C] Ván tiếp theo tự bắt đầu sau 5 giây nếu còn ≥ 2 người đủ điều kiện.
- FR-G09 [C] Bot tham gia với action hợp lệ, có độ trễ 1–3 giây giả lập suy nghĩ.

### 6.2 Phòng
- FR-R01 [C] Tạo phòng với config mục 11.2; server áp giá trị mặc định và giới hạn.
- FR-R02 [C] Danh sách phòng công khai cập nhật realtime trong lobby.
- FR-R03 [C] Vào phòng riêng bằng mã 6 ký tự; phòng có mật khẩu yêu cầu mật khẩu.
- FR-R04 [C] Ready/unready; host Start khi ≥ 2 ready; tùy chọn tự bắt đầu khi tất cả ready.
- FR-R05 [C] Host rời → chuyển host; phòng trống 60 giây → xóa.
- FR-R06 [C] Rời bàn giữa ván = fold; stack trả về balance sau ván.
- FR-R07 [C] Ngồi xuống (sit down) yêu cầu đủ điểm theo mode; đứng dậy (stand up) trả stack.

### 6.3 Kết nối
- FR-C01 [C] Một WebSocket/người; heartbeat 15/30 giây.
- FR-C02 [C] Reconnect trong 90 giây giữ ghế; snapshot đầy đủ khi nối lại.
- FR-C03 [C] Kết nối trùng cùng session thay thế kết nối cũ.
- FR-C04 [C] Chống action trùng bằng `reqId`; chống action trên state cũ bằng `baseSeq`.
- FR-C05 [C] Rate-limit 20 message/giây/kết nối; message ≤ 4 KB.

### 6.4 Người chơi
- FR-P01 [C] Định danh `playerId`, `displayName`, `balance`.
- FR-P02 [N] Đăng ký/đăng nhập email + mật khẩu; session cookie.
- FR-P03 [L] Tạo phiên bằng tên hiển thị; token lưu client.
- FR-P04 [O] Thống kê: Lite đếm ván chơi/thắng; Normal đầy đủ mục 10.3.
- FR-P05 [N] Profile: avatar, title, badge, achievement, lịch sử.

### 6.5 Kinh tế
- FR-E01 [C] Điểm khởi đầu 100.000.
- FR-E02 [C] Phí bàn 2% pot (mục 12.3).
- FR-E03 [O] Daily reward: Lite chỉ điểm; Normal điểm + item (mục 13).
- FR-E04 [C] Cứu trợ: balance < 5.000 → nâng lên 5.000, tối đa 1 lần/24 giờ.
- FR-E05 [N] Sổ cái `point_transactions` cho mọi thay đổi balance.

### 6.6 Normal-only
- FR-N01 Achievement data-driven (mục 14).
- FR-N02 Avatar lớp SVG + inventory (mục 15).
- FR-N03 REST API mục 19.

### 6.7 Đa ngôn ngữ, giao diện
- FR-U01 [C] Không có chuỗi hiển thị hard-code; en + vi; đổi lúc chạy.
- FR-U02 [C] Responsive 360px → 2560px; bố cục dọc trên mobile.
- FR-U03 [C] 13 màn hình mục 27.2 theo edition.

## 7. Normal Poker Rules — No-Limit Texas Hold'em

### 7.1 Bàn và cấu hình
- 2–9 ghế. Blinds chọn một bậc: `100/200`, `250/500`, `500/1000`, `1000/2000`, `2500/5000`. Không ante.
- Buy-in tối thiểu/tối đa tính theo Big Blind (BB), mặc định 50–200 BB, host chọn trong khoảng 20–500 BB.
- Ngồi xuống: chọn số buy-in trong khoảng; trừ khỏi balance, tạo stack. Đứng dậy hoặc rời phòng: stack trả về balance (sau khi ván hiện tại kết thúc nếu đang chơi).
- Nạp thêm (top-up) giữa các ván tới tối đa buy-in max.

### 7.2 Button và blinds
- Ván đầu: button đặt ngẫu nhiên (RNG server) vào một ghế có người đủ điều kiện.
- Ván sau: button chuyển tới ghế kế tiếp theo chiều kim đồng hồ có người đang ngồi và có stack > 0. Không áp dụng dead-button (đơn giản hóa, ghi assumption).
- ≥ 3 người: SB là ghế kế button, BB kế SB. Heads-up: button là SB, hành động trước preflop và sau postflop.
- Người không đủ blind đặt all-in phần có.

### 7.3 Chia bài và vòng cược
- 2 lá riêng mỗi người, bắt đầu từ ghế kế button.
- Vòng: PREFLOP → FLOP (3 lá) → TURN (1) → RIVER (1).
- Preflop hành động bắt đầu từ ghế kế BB; các vòng sau từ ghế kế button còn trong ván.
- Hành động hợp lệ: `fold`, `check` (khi không có cược cần theo), `call`, `bet` (khi chưa có cược trong vòng), `raise`, `allIn`.
- Min bet = 1 BB. Min raise = mức tăng (raise increment) lớn nhất trong vòng; nếu chưa có raise thì = 1 BB.
- All-in nhỏ hơn một raise hợp lệ **không** mở lại quyền raise cho người đã hành động đủ trong vòng.
- Vòng kết thúc khi mọi người còn trong ván chưa all-in đã hành động ít nhất một lần và đã theo đủ mức cược cao nhất (BB có quyền option preflop).
- Nếu chỉ còn một người chưa fold → người đó thắng pot, không lật bài.
- Nếu ≤ 1 người còn có thể hành động (những người khác all-in) → lật hết lá chung còn lại theo nhịp 1,5 giây/lá rồi showdown.

### 7.4 Pot và side pot
- Thuật toán tầng: sắp xếp các mức all-in tăng dần; mỗi tầng tạo một pot gồm phần đóng góp ≤ mức đó của mọi người còn trong ván (kể cả đã fold — tiền fold vào pot tương ứng), người đủ điều kiện là những người chưa fold có đóng góp ≥ mức tầng.
- Mỗi pot chia riêng cho người thắng trong nhóm đủ điều kiện.

### 7.5 Showdown
- Mọi người chưa fold lật bài đồng thời (MVP không có muck).
- Xếp hạng bằng 5 lá tốt nhất từ 7 lá.
- Hòa: chia đều; chip lẻ trao cho người thắng gần button nhất theo chiều kim đồng hồ.
- Cược không được theo (uncalled bet) được trả lại người đặt trước khi tính pot và phí.

### 7.6 Phí bàn
- 2% mỗi pot (tính trên tổng pot chính + side), làm tròn xuống, tối đa 1 BB/ván, trừ trước khi chia. Ghi `table_fee`.

### 7.7 Hạng bài (từ cao xuống)
Royal flush (là straight flush cao nhất), Straight flush, Four of a kind, Full house, Flush, Straight, Three of a kind, Two pair, One pair, High card. Straight A-2-3-4-5 (wheel) hợp lệ và thấp nhất; A-K-Q-J-10 cao nhất; không "wrap-around".

### 7.8 Vòng đời ván
`STARTING` (xác định button, blinds) → `DEALING` → `BETTING(PREFLOP)` → `BETTING(FLOP)` → `BETTING(TURN)` → `BETTING(RIVER)` → `SHOWDOWN` → `SETTLEMENT` → `HAND_COMPLETE` → sau 5 giây `STARTING` nếu ≥ 2 người có stack > 0, ngược lại `WAITING`.

### 7.9 Timer và hành động mặc định
- Turn timer host chọn 15/30/45/60 giây, mặc định 30.
- Hết giờ: `check` nếu hợp lệ, ngược lại `fold`.
- 3 lượt timeout liên tiếp → sau ván người chơi bị đứng dậy (stack về balance), ghế trống.

### 7.10 Rời/rớt mạng
- Rời phòng giữa ván: fold ngay, stack trả về balance sau ván.
- Rớt mạng: ghế `DISCONNECTED`, ván tiếp tục, timeout áp dụng mặc định. Xem mục 16.6.

## 8. Blind Poker Rules

### 8.1 Cấu hình phòng
| Tham số | Giá trị |
|---|---|
| `holeCards` | 2 hoặc 3 |
| `decisionMode` | `none` (kiểu A — thuần may rủi) hoặc `playOrFold` (kiểu B) |
| `fixedWager` (W) | 1.000 / 2.000 / 5.000 / 10.000 / 20.000 / 50.000 |
| Hạn mức (L) | 5 × `fixedWager` — cố định, không chọn khi tạo phòng (sửa đổi 2026-09-29) |
| `maxPlayers` | 2–8 |
| `botCount` | 0 … maxPlayers − 1 |
| `turnTimer` | 10/15/30 giây, mặc định 15 (chỉ dùng cho pha DECISION) |

### 8.2 Điều kiện tham gia ván
- Ghế đủ điều kiện vào ván khi **chồng trên bàn** ≥ W (kiểu A) hoặc ≥ 2W (kiểu B, đủ ante + Play). Vào bàn cần số dư ≥ mức đó (§8.8).
- Ghế người thật có chồng không đủ bị mời đứng dậy khi ván kết thúc (§8.8); bot được nạp lại.
- Cần ≥ 2 người đủ điều kiện (bot tính là người), ngược lại về `WAITING`.

### 8.3 Luồng ván
1. `STARTING`: dealer marker chuyển ghế kế tiếp (chỉ ảnh hưởng thứ tự chia bài và chip lẻ). Mỗi người đủ điều kiện bị trừ W từ chồng vào pot. Nếu có pot cộng dồn từ ván trước, cộng vào pot.
2. `DEALING`: chia `holeCards` lá riêng cho mỗi người.
3. **Kiểu A**: bỏ qua bước 4.
4. **Kiểu B — `DECISION`**: tất cả quyết định **đồng thời** trong `turnTimer` giây: `play` (trừ thêm W vào pot) hoặc `fold`. Lựa chọn giấu kín tới khi pha kết thúc (mọi người đã chọn hoặc hết giờ). Hết giờ chưa chọn = `fold`. Kết thúc pha: công bố lựa chọn.
   - 0 người play: pot **cộng dồn** sang ván sau (`carryOverPot`), ván kết thúc, không lật bài, không phí bàn.
   - 1 người play: người đó thắng toàn bộ pot ngay, không lật lá chung, lá riêng không lộ.
   - ≥ 2 người play: sang bước 5 với những người này.
5. `REVEAL`: lật 3 lá chung, rồi 1, rồi 1 (nhịp 1,5 giây/lần) — chỉ để tạo kịch tính, không có hành động.
6. `SHOWDOWN`: mọi người còn trong ván lật lá riêng; xếp hạng bằng 5 lá tốt nhất từ `holeCards + 5` lá (7 hoặc 8), không ràng buộc phải dùng lá riêng.
7. `SETTLEMENT`: cược không được theo (uncalled bet) được trả lại người đặt trước khi tính pot và phí. Phí bàn 2% pot làm tròn xuống; phần còn lại cho người thắng; hòa chia đều, chip lẻ cho người thắng gần dealer marker nhất theo chiều kim đồng hồ.
8. `HAND_COMPLETE` → sau 5 giây `STARTING` nếu đủ điều kiện.

### 8.4 Pot cộng dồn
- Chỉ phát sinh ở kiểu B. Lưu trong state phòng. Hiển thị "Pot cộng dồn" trên bàn.
- Pot được giải phóng khi (a) phòng không thể bắt đầu ván mới liên tục trong `carryOverReleaseMs` (mặc định 60 giây), (b) phòng đóng, hoặc (c) server shutdown — tùy điều kiện nào đến trước.
- Chia đều cho **mọi người thật đang ngồi ghế** (không xét stack): `share = floor(pot / n)`. Chia vào **số dư** (không vào chồng trên bàn). Phần dư không chia được — hoặc toàn bộ pot khi không còn ai ngồi ghế — ghi thành một dòng sink `carry_over` qua `BalanceRepository.apply(entries, meta)`, không đưa cho một người bất kỳ.
- Sau khi giải phóng, `carryOverPot = 0` và phòng phát `ROOM_EVENT ROOM_STATUS` (trạng thái không đổi) để mọi view cập nhật lại con số.

### 8.5 Bot trong Blind Poker
- Bot ngồi từ khi tạo phòng theo `botCount`, luôn ready, không đếm là host.
- Bot **chiếm ghế thật**: chúng tính vào `maxPlayers`. Sức chứa người thật = `maxPlayers − botCount đang ngồi`; vượt quá → `ROOM_FULL`. `RoomSummary.playerCount` đếm cả người thật lẫn bot đang ngồi, để danh sách phòng không hứa hẹn những ghế không tồn tại.
- Bot có chồng ảo = L, tự nạp lại về L khi < mức cần cho một ván; không ghi vào kinh tế người chơi.
- Kiểu A: bot không có quyết định. Kiểu B: xem mục 9.

### 8.6 Hàng ranking
Như mục 7.7.

### 8.7 Timer và hành động mặc định
- Chỉ pha `DECISION` có timer. Hết giờ = `fold`.
- 3 timeout liên tiếp → đứng dậy sau ván (như Normal).

### 8.8 Hạn mức bàn (sửa đổi 2026-09-29)
- **Vào bàn**: server lấy `min(số dư, L)` từ số dư lên bàn, ghi `buy_in` (từ chối `INSUFFICIENT_BALANCE` nếu số dư < mức cần cho một ván). Không có hộp thoại chọn số.
- **Trong ván**: ante, tiền Chơi và tiền thắng chỉ đổi chồng trên bàn (có thể vượt L); sổ điểm mỗi ván chỉ ghi dòng sink phí bàn, không còn dòng `settlement` cho người chơi.
- **Hết hạn mức**: khi ván kết thúc, ghế người thật có chồng không đủ cho một ván bị mời đứng dậy, phần lẻ (nếu có) về số dư qua `cash_out`, người chơi nhận thông báo `TABLE_LIMIT_SPENT`, **ở lại phòng** làm người xem và tự chọn một ghế trống để vào lại (một lần vào bàn mới).
- **Mọi cách rời ghế trả cả chồng về số dư** (`cash_out`): Đứng dậy, Rời phòng, bị đuổi, quá hạn kết nối lại, ngồi ngoài đủ số ván, đóng phòng, server tắt đúng cách.
- **Tắt cưỡng bức Lite** mất chồng đang trên bàn, như Hold'em (mục 30).

Chi tiết và lý do: `docs/superpowers/specs/2026-09-29-blind-table-limit-design.md`.

## 9. Bot Design

### 9.1 Ranh giới
- Package `core/bot`; interface:
  ```ts
  interface BotStrategy {
    decide(view: PlayerView, legal: LegalActions, rng: Rng): PlayerAction
  }
  ```
- Bot chỉ nhận **PlayerView** (đúng thông tin một người chơi được thấy) — không nhìn bài người khác hay deck.
- Server-kit có `BotRunner`: khi tới lượt ghế bot (hoặc pha DECISION), chờ delay ngẫu nhiên 1–3 giây rồi gọi `decide` và đẩy action vào hàng đợi phòng như action người thường. Engine không phân biệt bot/người.

### 9.2 Đánh giá sức mạnh bài trước khi lật
- 2 lá: **công thức Chen** (điểm 0–20: A=10, K=8, Q=7, J=6, còn lại = rank/2; đôi ×2 tối thiểu 5; suited +2; trừ khoảng cách 1/2/4/5; +1 nếu khoảng cách ≤ 1 và cả hai lá < Q).
- 3 lá: max điểm Chen của 3 cặp con; +2 nếu có đôi, +5 nếu ba lá cùng số; +1 nếu ba lá cùng chất.

### 9.3 Blind Poker kiểu B
- `threshold = 3 + 0.5 × (số đối thủ − 1)`; `score = chen + N(0, 1.5)` (nhiễu ngẫu nhiên); `play` nếu `score ≥ threshold`, ngược lại `fold`.
- Nếu `carryOverPot > 4W` giảm threshold 1,5 (pot lớn đáng theo).
- Kỳ vọng: tỷ lệ play trung bình ≈ 50–55% (đo qua mô phỏng 2.000 ván với 2–8 người).

### 9.4 Normal Poker (should-have)
- Preflop theo Chen: `≥ 10` raise 2,5–3 BB (hoặc 3× cược trước); `7–9` call; `< 7` fold trừ khi được check miễn phí; đã có raise trước: `≥ 12` re-raise, `≥ 9` call.
- Postflop: tính hạng bài hiện tại + số outs thô (flush draw 9, open-ended 8, gutshot 4). `handStrength` ∈ [0,1] từ bảng theo category + outs. Quyết định theo pot odds: call nếu `handStrength ≥ toCall / (pot + toCall)` + nhiễu; bet/raise ½–¾ pot nếu `handStrength ≥ 0.7`; bluff 8% khi không có cược và ≤ 2 đối thủ.
- Luôn chọn từ `legal`; nếu số tiền tính ra ngoài khoảng, kẹp về min/max hợp lệ.

### 9.5 Kiểm chứng
- Mô phỏng 10.000 ván mỗi mode với bot: không có action bị từ chối, không ván nào treo, phân phối play/fold trong khoảng kỳ vọng.

## 10. Player System

### 10.1 Định danh chung (Core / server-kit)
```ts
interface PlayerIdentity { playerId: string; displayName: string; isBot: boolean }
```
Server-kit nhận identity từ `SessionResolver` do edition cung cấp (cookie → user ở Normal; token → player ở Lite).

### 10.2 Profile
| Trường | Normal | Lite |
|---|---|---|
| displayName (2–20 ký tự, unique không phân biệt hoa thường) | ✓ | ✓ |
| balance | ✓ | ✓ |
| avatarConfig, equippedTitle, equippedBadge | ✓ | — |
| createdAt, lastLoginAt | ✓ | ✓ |

### 10.3 Thống kê
- Lite: `handsPlayed`, `handsWon`.
- Normal (`player_stats`): `hands_played_holdem`, `hands_won_holdem`, `hands_played_blind`, `hands_won_blind`, `bot_hands`, `current_win_streak`, `best_win_streak`, `current_lose_streak`, `best_lose_streak`, `best_hand_rank` (mã category cao nhất từng thắng), `biggest_win` (điểm ròng lớn nhất một ván), `rooms_joined`, `games_completed`, `total_login_days`, `login_streak`, `best_login_streak`.
- Cập nhật bởi module `stats` trong normal-server khi nhận event `HandSettled`, `RoomJoined`, `DailyClaimed`.

## 11. Room System

### 11.1 Vòng đời phòng
`OPEN` (chờ, có thể ready) ⇄ `IN_GAME` (đang ván) → `CLOSED` (trống 60 giây hoặc host đóng khi không có ván).

### 11.2 Cấu hình phòng
```ts
interface RoomConfig {
  name: string                       // 1–30 ký tự
  mode: 'holdem' | 'blind'
  maxPlayers: number                 // holdem 2–9, blind 2–8
  isPrivate: boolean                 // private: không hiện trong danh sách, vào bằng mã
  password?: string                  // 4–20 ký tự, tùy chọn, lưu hash trong RAM
  turnTimerSec: number               // holdem 15/30/45/60; blind 10/15/30
  autoStart: boolean                 // tự start khi tất cả ready (≥2)
  holdem?: { smallBlind: number; bigBlind: number; minBuyInBB: number; maxBuyInBB: number }
  blind?:  { holeCards: 2 | 3; decisionMode: 'none' | 'playOrFold'; fixedWager: number; botCount: number }
}
```
Server kiểm tra từng giá trị thuộc tập cho phép; sai → `ERROR INVALID_ROOM_CONFIG`. `blind.decisionMode` **bắt buộc**, không có giá trị mặc định: thiếu nó → `INVALID_ROOM_CONFIG`. `INVALID_ROOM_CONFIG` là một yêu cầu bị từ chối, **không** phải frame hỏng: nó không tính vào `maxInvalidMessages` và không làm đóng kết nối.

`maxPlayers` là số ghế, bao gồm cả ghế bot: một phòng blind `maxPlayers: 4, botCount: 2` chỉ còn chỗ cho 2 người thật (mục 8.5).

### 11.3 Ghế và trạng thái người trong phòng
- Vào phòng = là "người xem trong phòng" (không ghế). `SIT_DOWN{seat, buyIn?}` chiếm ghế (Hold'em kèm buy-in; Blind không — server tự lấy `min(số dư, L)`, §8.8). `STAND_UP` rời ghế.
- Trạng thái ghế (`SeatStatus`, cấp phòng): `SEATED`, `READY`, `IN_HAND`, `SITTING_OUT`, `DISCONNECTED` (ghế trống = không có người, `seat: null`). `FOLDED`/`ALL_IN` **không** phải trạng thái phòng: chúng là cờ theo từng ván trong `HandView.seats` (`hasFolded`, `isAllIn`) và biến mất khi ván kết thúc.
- `SIT_OUT` giữ ghế nhưng xin bỏ qua các ván sau; **ván đang chơi vẫn đánh hết** (cờ chỉ tác động lên lần bắt đầu ván kế tiếp). `SIT_IN` bỏ yêu cầu đó. Chưa có ghế → `NOT_SEATED`.
- `SITTING_OUT` được tính lại mỗi lần phòng thử bắt đầu ván: `sittingOut = đã xin SIT_OUT || stack < mức tối thiểu`. Người thật đang ngồi mà stack không đủ mức cược sẽ `sittingOut = true` (và trở lại `false` khi đủ) — nên `SIT_IN` với stack vẫn thiếu thì ghế **vẫn** `SITTING_OUT`.
- Mỗi lần cờ đổi, phòng phát `ROOM_EVENT PLAYER_SIT_OUT{playerId, sittingOut}` (cả khi nguyên nhân là stack ngắn). Ngoài ra `RoomPlayerView` mang thẳng trường `sittingOut` (= `đã xin SIT_OUT || cờ hiệu lực`): `status` chỉ có một giá trị và `IN_HAND` xếp trên `SITTING_OUT`, nên người xin sit-out giữa ván sẽ thấy `status: 'IN_HAND', sittingOut: true` — client đọc trường này (không đọc `status`) thì nút bật/tắt sit-out không bị `RESYNC` hay reconnect giữa ván lật ngược.
- Ghế `SITTING_OUT` không được tính vào số ghế sẵn sàng: phòng chỉ bắt đầu khi có ≥ 2 ghế vừa `READY` vừa không sit-out (autoStart chờ, `START_GAME` → `NOT_ENOUGH_PLAYERS`); ngược lại phòng cũng không chờ người đang sit-out bấm ready.
- Xin sit-out mà bị bỏ qua **5 ván liên tiếp** → tự đứng dậy, trả stack về số dư (cùng đường với luật 3 lần hết giờ), phát `PLAYER_STOOD`. Bộ đếm về 0 khi **yêu cầu đổi** (`SIT_IN` sau `SIT_OUT`), khi ngồi xuống lại hoặc khi đứng dậy; gửi lại `SIT_OUT` chỉ được `ACK` và không đổi gì, nên không thể nạp lại bộ đếm để chiếm ghế mãi. Bộ đếm chỉ tăng theo **ván thực sự được chia**: ở bàn không đủ người để bắt đầu (2 ghế, 1 người sit-out) sẽ không có ván nào, nên ghế được giữ cho tới khi người đó rời hoặc phòng đóng vì trống.
- Ready chỉ có ý nghĩa ở `OPEN`; khi ván bắt đầu tất cả ghế `READY` vào ván.

### 11.4 Host
- Người tạo phòng là host. Quyền: Start, kick người chưa vào ván, đóng phòng khi `OPEN`.
- Host rời (hoặc quá cửa sổ reconnect) → host = người có `joinedAt` sớm nhất còn trong phòng. Bot không thể là host.

### 11.5 Mã phòng
6 ký tự `[A-Z2-9]` bỏ ký tự dễ nhầm, sinh ngẫu nhiên, duy nhất trong tiến trình.

## 12. Economy

### 12.1 Nguyên tắc
Điểm giữa người chơi là zero-sum; nguồn duy nhất là hệ thống (daily, achievement, cứu trợ), bể duy nhất là phí bàn và bot thắng. Mọi thay đổi balance đi qua `BalanceRepository.apply(entries, meta?)` với `reason` trên từng entry.

### 12.2 Tham số (JSON `economy.json`, chung cả hai edition; Normal đọc thêm phần item)
| Tham số | Giá trị |
|---|---|
| `startingBalance` | 100.000 |
| `tableFeeRate` | 0,02 |
| `tableFeeCapHoldemBB` | 1 |
| `reliefThreshold` / `reliefTarget` / `reliefCooldownHours` | 5.000 / 5.000 / 24 |
| `blindWagerTiers` | 1k, 2k, 5k, 10k, 20k, 50k |
| `blindTableLimitMultiplier` | 5 |
| `holdemBlindTiers` | 100/200, 250/500, 500/1k, 1k/2k, 2.5k/5k |

### 12.3 Phí bàn
Hold'em: `min(floor(totalPot × 0,02), 1 BB)`. Blind: `floor(pot × 0,02)`. Không thu khi pot cộng dồn (chưa kết thúc).

Phí được ghi thành **dòng sink** bởi `BalanceRepository.apply(entries, meta)` với `meta.kind = 'table_fee'` — cùng transaction với các entry của người chơi. Hold'em **và Blind** không có entry người chơi nào mỗi ván (chip đã nằm trên bàn) nên gọi `apply([], { kind: 'table_fee', refId: handId, fee })`: một batch rỗng chỉ để ghi dòng sink. Pot cộng dồn khi được giải phóng (mục 8.4) ghi sink `carry_over` theo đúng cơ chế đó.

### 12.4 Cứu trợ
`POST /api/economy/relief` (cả hai edition, REST — không nằm trong protocol gameplay): nếu `balance < 5.000` và `lastReliefAt` cách ≥ 24 giờ → balance = 5.000, ghi `relief`.

### 12.5 Ước lượng cân bằng
- Người chơi đều: 30 ván Blind 5k/ngày, pot trung bình 15k → phí ≈ 300 × 30 = 9.000/ngày ở trần, thực tế 3.000–6.000. Daily trung bình 12.500 → dòng ròng +6.000 ÷ +9.000/ngày, tương đương 1–2 mức cược thấp. Chấp nhận: người chơi đều có tiến độ cảm nhận được, nhưng không "in tiền".
- Người chơi nhiều (200 ván/ngày) phí ≈ 20.000–40.000 → âm nhẹ, phải thắng để giữ điểm.
- Theo dõi: `SELECT reason, SUM(amount) FROM point_transactions WHERE created_at >= now() - interval '1 day' GROUP BY reason` — các dòng sink (`table_fee`, `carry_over`) có `player_id IS NULL`, nên đây cũng là cách đọc tổng bể. Nếu tổng nguồn > 1,5 × tổng bể trong 30 ngày liên tục → nâng `tableFeeRate` lên 0,03 hoặc mở shop đổi điểm (roadmap).

### 12.6 Bảo toàn điểm
Bất biến kiểm tra trong test: với mọi ván, `Σ balance trước = Σ balance sau + phí bàn` (cộng cả bot). Vi phạm là bug nghiêm trọng.

## 13. Daily Reward

### 13.1 Quy tắc
- Ngày tính theo `ECONOMY_TIMEZONE` (mặc định `Asia/Ho_Chi_Minh`).
- Người chơi bấm **Nhận** (check-in) một lần/ngày. Không tự động.
- `streak`: nếu `lastClaimDate` = hôm qua → +1; nếu là hôm nay → đã nhận; ngược lại → 1.
- **Reset tháng**: nếu tháng của hôm nay ≠ tháng của `lastClaimDate` → streak = 1 (ngày 1 của tháng luôn là streak 1).
- Streak tối đa 31; ngày 29–31 dùng giá trị ngày 29.

### 13.2 Bảng thưởng (`daily-rewards.json`)
| Ngày | Điểm | Item (Normal) |
|---|---|---|
| 1 | 5.000 | |
| 2 | 6.000 | |
| 3 | 7.000 | |
| 4 | 8.000 | |
| 5 | 10.000 | |
| 6 | 12.000 | |
| 7 | 15.000 | 1 item `common` ngẫu nhiên chưa sở hữu |
| 8–13 | 10.000 | |
| 14 | 20.000 | 1 item `rare` |
| 15–20 | 10.000 | |
| 21 | 25.000 | 1 item `rare` |
| 22–27 | 12.000 | |
| 28 | 40.000 | Badge tháng (`badge_monthly`) + title `title_devoted` nếu chưa có |
| 29–31 | 12.000 | |

Tổng tối đa 376.000/tháng.

**Fallback 10.000 điểm chỉ áp dụng cho các bậc rút ngẫu nhiên** (ngày 7, 14, 21). Khi không còn item nào chưa sở hữu ở đúng rarity đó, lần nhận ghi thêm một dòng ledger `daily_item_fallback` cùng `refId` với lần nhận — một lần nhận, hai dòng, để §12.5 đo được catalogue đang cạn tới đâu. Ngày 28 là bậc **cố định**: nó cấp `badge_monthly` + `title_devoted`, và nếu người chơi đã có sẵn thì **không** trả thay bằng điểm — một phần thưởng cố định đã trao rồi không phải là catalogue cạn, trả 10.000 mỗi năm cho nó là một lỗ rò chậm.

Bậc ngẫu nhiên **không bao giờ rút** hai nhóm sau, để phần thưởng cố định giữ được lời hứa của nó:
- **category `title` và `badge`** — chúng là phần thưởng của achievement và của ngày 28, rút trúng bằng may rủi sẽ làm mất chỗ kiếm được.
- **mọi item nằm trong `reward.itemId` của `achievements.json`, cộng `badge_monthly` và `title_devoted`** — nếu ngày 14 rút trúng `badge_monthly` thì ngày 28 của người đó không còn gì để cấp và (đúng theo luật trên) cũng không trả bù, nên chuỗi 28 ngày trọn vẹn sẽ âm thầm đáng giá ít hơn bảng thưởng nói.

### 13.3 Lite
Cùng bảng, chỉ cột Điểm. Lưu `streak`, `last_daily_claim` trong `players`.

## 14. Achievement (Normal-only)

### 14.1 Cơ chế
- Định nghĩa trong `achievements.json`:
  ```ts
  interface AchievementDef {
    id: string; category: 'login' | 'holdem' | 'blind' | 'social'
    metric: keyof PlayerStats; threshold: number
    reward: { points?: number; itemId?: string }
  }
  ```
- Module `achievement` lắng nghe `StatsUpdated{playerId, changedMetrics}`; với mỗi def có metric thay đổi và chưa unlock: nếu `stats[metric] ≥ threshold` → ghi `player_achievements`, cộng thưởng qua `apply([{ ..., reason: 'achievement' }])`, thêm item, phát `AchievementUnlocked` tới client qua WS message `NOTIFICATION` (lightweight).
- `best_hand_rank` là metric số (category index 0–9) nên "special hand" dùng ngưỡng: flush=5, full house=6, quads=7, straight flush=8, royal=9.

### 14.2 Danh mục khởi đầu (32)
| id | metric ≥ | reward |
|---|---|---|
| login_days_7 / 30 / 100 | total_login_days 7/30/100 | 5k / 20k / item `hat_crown` |
| login_streak_7 / 28 | best_login_streak 7/28 | 5k / title `title_devoted` |
| holdem_hands_10 / 100 / 1000 | hands_played_holdem | 2k / 10k / 50k |
| holdem_wins_10 / 100 / 500 | hands_won_holdem | 5k / 20k / item `jacket_champion` |
| win_streak_3 / 5 / 10 | best_win_streak | 5k / 15k / title `title_hot_hand` |
| lose_streak_10 | best_lose_streak | 10k (an ủi) |
| hand_flush / full_house / quads / straight_flush / royal | best_hand_rank 5/6/7/8/9 | 3k / 5k / 20k / 50k / item `ring_royal` |
| big_win_100k / 500k | biggest_win | 10k / 30k |
| blind_hands_10 / 100 / 1000 | hands_played_blind | 2k / 10k / 50k |
| blind_wins_10 / 100 | hands_won_blind | 5k / 20k |
| bot_hands_50 | bot_hands | 5k |
| rooms_10 / 100 | rooms_joined | 2k / 10k |
| games_50 / 500 | games_completed | 5k / item `badge_veteran` |

Đếm đủ các id liệt kê ở trên là **32** (`apps/normal-server/data/achievements.json`) — tiêu đề mục này từng ghi 28 khi bảng còn ít dòng hơn.

Thêm achievement = thêm dòng JSON. Thêm metric = thêm cột `player_stats` + logic đếm trong module stats.

## 15. Avatar / Inventory (Normal-only)

> **Đã thay thế (Plan 11):** §15.1–§15.2 dưới đây tả nhân vật 3D của Plan 8, đã bị gỡ. Thiết kế hiện hành
> là `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` — chibi 2D xếp lớp PNG, hai thân cố định
> F01/M01, sinh bằng AI; tài liệu triển khai: `docs/avatar-2d.md`. Giữ nguyên phần dưới làm lịch sử.

### 15.1 Mô hình
- Avatar = **nhân vật 3D** (Plan 8, đặc tả riêng `2026-09-05-avatar-3d-design.md`): thân `male`/`female`, màu da (8 tông) / mắt (6) / tóc (`#rrggbb` tự do), cộng một item cho mỗi **slot**.
- `slot` ∈ `hair` `top` `bottom` `shoes` `hat` `accessory` `jewelry` `title` `badge`; bốn slot đầu bắt buộc, mỗi slot bắt buộc có đúng một item `isDefault`. Các slot v1 `base`/`face` đã bỏ (thân được chọn, khuôn mặt là màu).
- `items` seed từ `items.json`: `{ id, slot, rarity: 'common'|'rare'|'epic', nameKey, assetKey, isDefault, variants? }`; `variants` là `{ male?, female?: { file, node, tint? } }`, bắt buộc với slot hình học, không có với `title`/`badge`. 42 item khởi đầu; item `isDefault` cấp cho mọi tài khoản mới. Cột DB vẫn tên `items.category` nhưng chứa `slot`.
- `title` và `badge` cũng là item (slot `title`, `badge`), hiển thị cạnh tên trên bàn.
- `avatar_config`: `{ v: 2, body, skin, eyes, hairColor, hair, top, bottom, shoes, hat?, accessory?, jewelry?, title?, badge? }`; server kiểm tra mọi id thuộc inventory, đúng slot và có `variants[body]` trước khi lưu.
- Cấu hình v1 (Plan 6) được **migrate khi đọc** (`clothing_*` → `top`, mũ nón rời khỏi `accessory` sang `hat`, id đã gỡ → mặc định của slot); `PUT /api/me/avatar` chỉ nhận v2, thân/thiếu slot sai → `MISSING_LAYER`.
- Nguồn item: daily (7/14/21/28), achievement. Không có shop ở MVP.
- Trên bàn, người khác nhận `avatarConfig` (≈ 100–150 byte); `normal-web` dựng ảnh chân dung ở máy người chơi. Lite không có phần này, `Seat` hiển thị chữ cái đầu tên.

### 15.2 Tài sản và cách dựng
- Hình học đến từ **hai bộ CC0 Quaternius** (bản Standard/miễn phí), build sẵn thành 5 tệp `.glb` + `manifest.json` trong `apps/normal-web/public/avatar3d/` (~0,9 MB, ngân sách 6 MB). Nguồn 400 MB không commit; **kết quả build thì có** — không CI runner nào tải bộ nguồn, nên nếu không commit thì không build được app. Chi tiết: `docs/avatar-assets.md`.
- Khóa node là `<slot>/<itemId>/<body>`; `data/items.json` trỏ vào đúng khóa đó và test đối chiếu hai bên. Vật liệu chuẩn hóa còn sáu tên; `skin`/`eyes`/`hair` tô lại lúc chạy theo cấu hình người chơi, `cloth_primary` lấy `tint` của item.
- Hai bộ nguồn **không được dựng cho nhau** (thân là bản Superhero vạm vỡ, quần áo cắt cho bản Regular thon hơn và gắn xương hẹp hơn 2 cm), nên bước build *nắn* từng món về đúng bộ xương của thân rồi *bọc* nó lên da theo lề riêng của từng slot. Không làm việc này thì quần áo chìm vào trong thân tới 5 cm.
- Chỉ **hồ sơ** và **trình chỉnh** dựng 3D thật (`AvatarStage`, một WebGL context, vẽ theo sự kiện). Mọi nơi khác là **ảnh chân dung 128 px** dựng ở máy người chơi, cache theo `hashConfig` trong bộ nhớ và IndexedDB. Không upload, không dựng phía server, không lưu ảnh. Máy không có WebGL → chữ cái đầu tên.
- Ngân sách (§24): chunk three.js ≤ 200 KB gzip và lazy; tài sản ≤ 6 MB tổng, ≤ 1,5 MB mỗi tệp; ≤ 80 ms mỗi ảnh sau khi tài sản đã nạp; vào bàn tới khi đủ ảnh ≤ 2 s.

## 16. Realtime Architecture

### 16.1 Tổng quan
```text
Browser ── HTTPS ──> Fastify (static + REST) ──┐
        ── WSS  ──> WebSocket Gateway ─────────┤  cùng một tiến trình Node
                                                ├─ RoomManager ─ RoomActor[n] ─ core reducer
                                                ├─ TurnTimer, BotRunner, ReconnectTracker
                                                └─ Repositories (Postgres | SQLite)
```
Một tiến trình giữ toàn bộ phòng trong RAM. Không Redis, không pub/sub.

### 16.2 Kết nối và định danh
- Normal: cookie session kiểm tra lúc HTTP upgrade; từ chối 401 nếu không hợp lệ. Kiểm tra `Origin` thuộc danh sách cho phép.
- Lite: upgrade tự do; message đầu tiên phải là `HELLO{sessionToken}` trong 5 giây, sai → đóng.
- Mỗi kết nối gắn một `PlayerIdentity`; một player chỉ có một kết nối hoạt động.

### 16.3 RoomActor
- Mỗi phòng một hàng đợi lệnh `Command = PlayerAction | TimerExpired | BotAction | Join | Leave | ...`, xử lý tuần tự bằng promise chain. Không có hai lệnh cùng phòng chạy xen kẽ.
- Xử lý một lệnh: validate → `core.applyAction` → nhận `events` → tăng `seq` → lọc PlayerView cho từng người → gửi → thực thi side-effect (đặt timer, ghi DB khi settlement, phát domain event nội bộ).

### 16.4 Đồng bộ
- `ROOM_SNAPSHOT{seq, room, game?: PlayerView}` khi vào phòng, reconnect, RESYNC.
- `GAME_EVENT{seq, event}` cho từng thay đổi. Client kiểm tra `seq === last + 1`, sai → gửi `RESYNC`.
- `ACTION{reqId, baseSeq, action}`: server từ chối `STALE_STATE` nếu `baseSeq < currentSeq` **và** state đã đổi lượt kể từ đó (cho phép baseSeq cũ nếu vẫn cùng lượt để tránh từ chối oan do event phụ như PLAYER_JOINED). Server nhớ 32 `reqId` gần nhất mỗi kết nối **cùng frame mà lần đầu đã trả về**; trùng → phát lại đúng frame đó (`ACK` vẫn là `ACK`, lỗi vẫn là đúng `ERROR` cũ), không áp dụng lại và không biến một yêu cầu đã thất bại thành thành công.

### 16.5 Heartbeat
Server gửi `PING` mỗi 15 giây; không nhận `PONG` trong 30 giây → đóng socket → xử lý như disconnect. Client: 3 lần không nhận PING trong 45 giây → tự đóng và reconnect với backoff 1, 2, 4, 8 giây (tối đa 30 giây).

### 16.6 Disconnect / Reconnect
- Socket đóng → `ReconnectTracker` đặt hạn 90 giây (`RECONNECT_WINDOW_SEC`), ghế → `DISCONNECTED`, phát `PLAYER_DISCONNECTED`. Ván tiếp tục; tới lượt hết timer → hành động mặc định.
- Kết nối lại với cùng session trong hạn → gắn vào ghế, phát `PLAYER_RECONNECTED`, gửi snapshot.
- Quá hạn → đánh dấu `LEAVING`; khi ván kết thúc (hoặc ngay nếu không trong ván): đứng dậy, stack về balance, ghế trống; giữ trong phòng 5 phút với vai "người xem" để nếu quay lại còn thấy phòng; sau đó rời phòng.
- Kết nối mới cùng session khi kết nối cũ còn sống → cũ nhận `SESSION_REPLACED` rồi đóng, mới nhận snapshot.

### 16.7 Server shutdown
Hai pha, tối đa 10 giây (`shutdownTimeoutMs`; quá hạn thì bỏ dở và ghi warning):

1. **Ngừng nhận** (`Gateway.stopAccepting()`): upgrade mới trả `HTTP/1.1 503 Service Unavailable`; `CREATE_ROOM`/`JOIN_ROOM` trả `ERROR SERVER_SHUTDOWN`; `RoomManager.create` ném `SERVER_SHUTDOWN`. Phiên đang chơi vẫn chạy tiếp.
2. **Rút phòng rồi đóng socket**: với mỗi phòng — hủy ván đang chạy, hoàn mọi cược trong ván về stack, giải phóng pot cộng dồn (mục 8.4), mọi stack về balance qua `apply` → phòng `CLOSED`. Phòng `CLOSED` từ chối mọi lệnh sau đó bằng `ROOM_NOT_FOUND`, nên một `SIT_DOWN` chạy đua với shutdown không thể trừ buy-in vào phòng đang đóng. Cuối cùng gửi `ERROR SERVER_SHUTDOWN` và đóng mọi socket.

### 16.8 Lựa chọn công nghệ realtime
Native WebSocket (`ws`) thay Socket.IO: protocol tự định nghĩa đã bao gồm reconnect/ack/heartbeat; giảm dependency và kích thước bundle Lite; debug bằng DevTools trực tiếp. Xem Phụ lục A.

## 17. Game State Machine

### 17.1 Trạng thái phòng-ván
```text
                 ┌────────────────────────────────────────────────────┐
                 ▼                                                    │
 WAITING ──start──> STARTING ──> DEALING ──> [BETTING/DECISION] ──> REVEAL* ──> SHOWDOWN ──> SETTLEMENT ──> HAND_COMPLETE
    ▲                                              │                                                             │
    │                                              └──(chỉ còn 1 người)──────────────────────> SETTLEMENT        │
    └─────────────────────(< 2 người đủ điều kiện)───────────────────────────────────────────────────────────────┘
```
- Hold'em: `BETTING` lặp qua `street ∈ {PREFLOP, FLOP, TURN, RIVER}`; `REVEAL` chỉ dùng khi run-out do all-in.
- Blind: `DECISION` (kiểu B) hoặc bỏ qua (kiểu A); `REVEAL` lật 3 lá chung + 1 + 1.

### 17.2 Reducer
```ts
type Rng = { int(maxExclusive: number): number }
function createHand(config: RulesetConfig, seats: SeatInput[], rng: Rng): HandState
function legalActions(state: HandState, seat: number): LegalActions
function applyAction(state: HandState, cmd: HandCommand, rng: Rng): { state: HandState; events: GameEvent[] }
// HandCommand = PlayerAction{seat, action} | TimerExpired | AdvanceReveal (server đẩy để tạo nhịp lật bài)
//              | { type: 'CANCEL'; reason } (hủy ván: hoàn lại mọi chip đã cược, không thu phí)
```
Reducer thuần, không đồng hồ: nhịp lật bài và timeout là lệnh do server-kit gửi. Điều này khiến mọi kịch bản test là danh sách lệnh → so sánh state/events.

### 17.3 Events
`HAND_STARTED{handId, button, blinds|wager, carryOver}`, `CARDS_DEALT{seat, cards, cardCount}`, `BLINDS_POSTED`, `DECISION_PHASE{deadlineAt}`, `TURN_CHANGED{seat, legal, deadlineAt}`, `PLAYER_ACTED{seat, action, amount}`, `DECISION_MADE{seat}`, `DECISIONS_REVEALED{seat→play|fold}`, `COMMUNITY_REVEALED{cards}`, `POT_UPDATED{pot}`, `SHOWDOWN{hands: {seat, cards, rank, label}}`, `SETTLEMENT{payouts, fee, carryOver, uncalledReturned}`, `HAND_CANCELLED{reason, refunds, carryOverOut}`, `HAND_COMPLETE{nextHandAt?}`.

`CARDS_DEALT` mang `cardCount` và được lọc theo từng người xem bằng `filterEvent(event, viewerSeat)`: lá của ghế khác trả về `cards: []`, chỉ còn `cardCount` để client vẽ lưng bài.

## 18. Database

### 18.1 Interface (server-kit)
```ts
interface PlayerRepository {
  findById(playerId: string): Promise<PlayerRecord | null>
}
interface BalanceRepository {
  get(playerId: string): Promise<number>
  // Atomic: all entries or none. Cộng dồn delta theo từng playerId trước, rồi mới kiểm tra
  // `balance + net >= 0`; âm → InsufficientBalanceError và không ghi gì.
  // meta.fee > 0 → ghi thêm một dòng sink loại meta.kind trong cùng transaction
  // (point_transactions với player_id NULL).
  apply(entries: { playerId: string; delta: number; reason: TxReason; refId?: string }[],
        meta?: { refId: string; fee: number; kind: 'table_fee' | 'carry_over' }): Promise<void>
}
interface GameHistoryRepository { recordHand(summary: HandSummary): Promise<void> }
// Do edition cấp: biến một HTTP upgrade (cookie) và/hoặc token của HELLO thành PlayerIdentity.
interface SessionResolver {
  fromUpgrade?(req: IncomingMessage): Promise<PlayerIdentity | null>
  fromToken?(token: string): Promise<PlayerIdentity | null>
}
```

### 18.2 Normal — PostgreSQL 16, Drizzle ORM, migration SQL trong `apps/normal-server/drizzle/`
Bảng đúng như đã triển khai (`apps/normal-server/src/db/schema.ts`, migration `drizzle/0000_init.sql`). Mọi mốc thời gian là `timestamptz` (server suy luận theo UTC, chỉ mốc ngày của kinh tế mới theo `ECONOMY_TIMEZONE`); mọi cột tiền là `bigint` map sang `number`.
```sql
users(id uuid pk, email text unique, password_hash text, created_at, last_login_at)
      -- CHECK (email = lower(email)) — xem ghi chú (a) bên dưới
players(id uuid pk fk users on delete cascade, display_name varchar(20), name_key text unique,
        balance bigint default 0 CHECK (balance >= 0), avatar_config jsonb, equipped_title text,
        equipped_badge text, last_relief_at, created_at)
        -- name_key = dạng gấp của display_name (@bp/core `displayNameKey`) — "tên đã có người dùng" nghĩa là trùng cột này
sessions(id text pk, user_id fk on delete cascade, expires_at, user_agent, created_at, last_seen_at)
        -- id = hex(HMAC-SHA256(SESSION_SECRET, token)); index (user_id), (expires_at)
point_transactions(id bigserial pk, player_id fk NULL on delete restrict, amount bigint, reason text,
        ref_id text, kind text, created_at)
        -- player_id NULL = dòng sink; CHECK (player_id is not null or kind is not null) — sink phải khai kind
        -- index (player_id, created_at), (reason, created_at), (ref_id)
games(id text pk, room_id text, mode text, config jsonb, started_at, ended_at,
      fee bigint default 0, cancelled bool, settlement_error text)   -- id = handId của engine; index (room_id, started_at)
game_players(game_id fk on delete cascade, seat int, player_id fk NULL on delete set null, label text,
      is_bot bool, net bigint, won bool, best_category int, pk(game_id, seat))   -- index (player_id)
items(id text pk, category text, rarity text, name_key text, asset_key text, is_default bool)
      -- index (category, rarity); là projection của data/items.json, upsert lúc khởi động
inventory(player_id fk, item_id fk, source text, acquired_at, pk(player_id, item_id))
player_achievements(player_id fk, achievement_id text, progress bigint, unlocked_at, pk(player_id, achievement_id))
daily_logins(player_id pk fk, streak int, last_claim_date date, claimed_days int, month text)
player_stats(player_id pk fk, 16 bộ đếm mục 10.3, updated_at)
```
Ba điểm khác bản phác thảo ban đầu, đều có lý do:
- **(a) `email text` + CHECK lowercase** thay cho `citext`: cùng ngữ nghĩa unique không phân biệt hoa thường mà không phụ thuộc vào việc extension có được cài trong database đích hay không. CHECK nằm ở DB chứ không chỉ ở code, vì một đường ghi quên `lower()` là hai tài khoản cho một địa chỉ.
- **(b) `games.id` là `handId` của engine (text)**, không phải uuid sinh mới. `games` ghi một dòng cho mỗi ván engine đã kết thúc, **kể cả ván bị hủy** (`cancelled`), và `settlement_error` giữ lại ván mà settlement bị từ chối để đối soát — im lặng bỏ qua sẽ làm mất chính những ván cần điều tra.
- **(c) `game_players` khóa `(game_id, seat)`** với `player_id` cho phép NULL: bot ngồi ghế nhưng không có dòng `players`, nên `pk(game_id, player_id)` của bản phác thảo không biểu diễn được ghế bot. `label` giữ id phía engine (id người chơi với người, id bot với bot) và sống sót qua việc xóa tài khoản; `is_bot` phân biệt hai loại.

`point_transactions` là `ON DELETE restrict` chứ không cascade: xóa một player còn dòng ledger sẽ biến toàn bộ lịch sử của họ — cả các dòng cộng — thành dòng sink và làm sai bất biến §18.4. Không có bảng rooms.

### 18.3 Lite — SQLite (`node:sqlite`), WAL mode, `PRAGMA user_version` để migrate
File dữ liệu mở với `journal_mode = WAL` (trừ `:memory:`), `foreign_keys = ON`, `busy_timeout = 5000`. Migration là mảng append-only trong `db/migrations.ts`: phần tử `i` là version `i + 1`, mỗi lần khởi động chạy tiếp những version còn thiếu trong một transaction rồi đặt `PRAGMA user_version`.
```sql
players(id text pk, display_name text not null unique collate nocase, token_hash text not null unique,
        balance integer not null check (balance >= 0), hands_played integer, hands_won integer, streak integer,
        last_daily_claim text, last_relief_at integer, created_at integer)
sinks(id integer pk autoincrement, kind text, ref_id text, amount integer, created_at integer)
hand_log(id integer pk autoincrement, hand_id text, room_id text, mode text, fee integer, cancelled integer,
         summary text, created_at integer)   -- chỉ ghi khi LITE_HAND_LOG bật
-- idx_sinks_ref(ref_id), idx_hand_log_hand(hand_id), idx_hand_log_room_created(room_id, created_at)
```
`sinks` là vế còn lại của bất biến tiền (§18.4): mỗi lần điểm rời khỏi tay người chơi mà không sang tay người khác thì có đúng một dòng ở đây, ghi **trong cùng transaction** với các dòng `balance` của lần settlement đó.

| `kind` | `ref_id` | Ghi khi |
|---|---|---|
| `table_fee` | `handId` | Kết thúc mỗi ván có phí bàn (`fee > 0`), kể cả khi batch balance rỗng như Hold'em |
| `carry_over` | `roomId` | Pot cộng dồn hết hạn mà không trả lại được cho ai (phần dư sau khi chia đều) |

`hands_played` / `hands_won` là bộ đếm mỗi người chơi (§10.3 bản rút gọn), cập nhật cùng lúc với settlement.

`SessionResolver` của Lite: token = 32 byte ngẫu nhiên base64url; DB lưu SHA-256 của token (`token_hash`), không lưu token gốc; phiên không hết hạn (mạng nội bộ), có thể xóa bằng lệnh admin (roadmap).

### 18.4 Bất biến dữ liệu
- `balance ≥ 0` do DB ép; `apply` chạy trong transaction, cộng dồn theo người chơi rồi kiểm tra trước khi ghi.
- Bất biến tiền: `Σ balance người chơi + Σ dòng sink (+ stack trên bàn và pot cộng dồn đang sống)` là hằng số.
- Stack trong RAM ⇔ đã trừ balance; mọi đường thoát (đứng dậy, rời, timeout, shutdown) đều trả stack.

## 19. API (REST)

Prefix `/api`. JSON. Lỗi: `{ error: { code, message } }`. Mutating request yêu cầu header `X-Requested-With: bind-poker`.

### 19.1 Chung
| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | `{ status, uptime, connections, rooms, db }` — cùng một shape ở cả hai edition; Normal thêm `edition`/`version` và thật sự ping DB |
| GET | `/api/config` | Tham số công khai: bậc cược, giới hạn phòng, edition, ngôn ngữ hỗ trợ |

### 19.2 Normal
Đã triển khai trong `apps/normal-server/src/http/` (`routes.ts` + `routes-auth.ts`, `routes-me.ts`, `routes-rewards.ts`, `routes-catalog.ts`).

Auth = cookie phiên `bp_session` (`HttpOnly`, `SameSite=Lax`, `Secure` khi `COOKIE_SECURE`); thiếu hoặc sai → `401 UNAUTHENTICATED`. **XRW** = mọi request mutating phải kèm `X-Requested-With: bind-poker`, thiếu → `403 FORBIDDEN` (kiểm ở `preHandler`, trước cả auth).

| Method | Path | Auth | Thành công | Từ chối |
|---|---|---|---|---|
| GET | `/health` | — | `200 {status:"ok", uptime, connections, rooms, db:"ok", edition:"normal", version}` | `503` cùng shape với `status:"degraded", db:"error"` |
| GET | `/api/config` | — | `200 {edition:"normal", wsPath:"/ws", economy{startingBalance, blindWagerTiers, holdemBlindTiers, reliefThreshold, reliefTarget}, languages:["vi","en"], reconnectWindowSec}` | `429 RATE_LIMITED` |
| GET | `/api/catalog/items` | — | `200 {items: ItemDef[]}` | `429` |
| GET | `/api/catalog/achievements` | — | `200 {achievements:[{id, category, metric, threshold, reward}]}` | `429` |
| POST | `/api/auth/register` | XRW | `201 {playerId, displayName, balance}` + cookie; tạo `users` + `players` + inventory mặc định + `daily_logins` trong một transaction | `400 INVALID_EMAIL`/`INVALID_PASSWORD`/`INVALID_NAME` · `409 EMAIL_TAKEN`/`DISPLAY_NAME_TAKEN` · `429` (10/phút/IP) · `403` |
| POST | `/api/auth/login` | XRW | `200` cùng shape + cookie **id mới** (xoay id, §23) | `400` · `401 BAD_CREDENTIALS` · `429` (5/phút/IP+email) · `403` |
| POST | `/api/auth/logout` | XRW | `204`, xóa session và cookie | `403` |
| GET | `/api/auth/me` | ✔ | `200 {playerId, displayName, balance}` | `401` · `429` |
| GET | `/api/me` | ✔ | `200 {playerId, displayName, email, balance, avatar, stats{handsPlayed, handsWon}, daily{…}, relief{…}, createdAt, lastLoginAt}` | `401` · `429` |
| PATCH | `/api/me` | ✔ XRW | `200 {playerId, displayName}` | `400 INVALID_NAME` · `409 DISPLAY_NAME_TAKEN` · `401` · `403` · `429` |
| GET | `/api/me/stats` | ✔ | `200 PlayerStats` (đủ 16 bộ đếm §10.3) | `401` · `429` |
| GET | `/api/me/history?limit=20` | ✔ | `200 HistoryEntry[]` = `[{handId, roomId, mode, startedAt, endedAt, net, won, bestCategory, cancelled, players:[{playerId, label, seat, isBot, net, won}]}]` (service kẹp 1…50, mặc định 20). Mỗi ghế mang **cả hai**: `playerId` (uuid, `null` với bot và với tài khoản đã xóa — đây là khóa để client lọc ghế của chính mình) và `label` (tên hiển thị đã join từ `players` với người, id engine với bot; rơi về id engine khi tài khoản không còn) | `401` · `429` |
| GET | `/api/me/ledger?limit=50&before=<id>` | ✔ | `200 {entries:[{id, amount, reason, refId, createdAt}], nextBefore}` | `401` · `429` |
| GET | `/api/me/inventory` | ✔ | `200 {items:[{itemId, slot, rarity, nameKey, assetKey, source, acquiredAt}], avatar}` (`avatar` luôn là cấu hình v2, đã migrate khi đọc) | `401` · `429` |
| PUT | `/api/me/avatar` | ✔ XRW | `200 {config}` (`AvatarView`); chỉ nhận cấu hình v2 | `400 MISSING_LAYER` (không phải v2, thiếu slot bắt buộc, `body` lạ) / `INVALID_COLOR` (`skin`/`eyes` ngoài bảng, `hairColor` sai) / `INVALID_ITEM` (id lạ hoặc không có `variants[body]`) / `WRONG_CATEGORY` (sai slot) · `403 NOT_OWNED` · `401` · `403` XRW · `429` |
| GET | `/api/players/:id/avatar` | ✔ | `200 {playerId, displayName, avatar}` (v2), `cache-control: private, max-age=60` | `404 NOT_FOUND` (id lạ **và** id sai định dạng — không phân biệt để không dò được id) · `401` · `429` |
| GET | `/api/me/achievements` | ✔ | `200 [{id, category, metric, threshold, reward, progress, unlockedAt}]` | `401` · `429` |
| GET | `/api/rewards/daily` | ✔ | `200 DailyStatus {claimable, day, streak, reward, item, nextResetAt, calendar[31]}` | `401` · `429` |
| POST | `/api/rewards/daily/claim` | ✔ XRW | `200 {claimed:true, day, points, item, items, fallbackPoints, balance, streak}` | `409 ALREADY_CLAIMED` (kèm `claimed:false`) · `401` · `403` · `429` |
| POST | `/api/economy/relief` | ✔ XRW | `200 {granted:true, amount, balance}` | `409 NOT_ELIGIBLE` (kèm `granted:false, reason:"balance"\|"cooldown", retryAt`) · `401` · `403` · `429` |
| GET | `/*` | — | Static `PUBLIC_DIR` (đường dẫn không có phần mở rộng rơi về `index.html`) | `404 NOT_FOUND` (prefix giữ chỗ `api`/`ws`/`health`, đường dẫn có đuôi mà không có file, hoặc không cấu hình `PUBLIC_DIR`) |

- Thân lỗi và quy ước header giống hệt §19.3 (`{ error: { code, message } }`, trường phụ nằm **cạnh** `error`), chỉ khác CSP: Normal thêm `https://fonts.googleapis.com` vào `style-src` và `font-src 'self' https://fonts.gstatic.com`.
- Rate-limit: `/api/*` mutating phải qua **hai** rổ — 60/phút theo phiên (key = SHA-256 của cookie, không giữ token sống trong bộ nhớ) **và** 120/phút theo địa chỉ, vì người gửi mỗi request một giá trị `bp_session` mới sẽ tự sinh một rổ phiên mới mỗi lần và không bao giờ bị chặn. Đọc 240/phút theo IP. Chỉ `POST /api/auth/register` và `POST /api/auth/login` được miễn (chúng có limiter riêng, chặt hơn nhiều); `/health` và static không tính. `429` kèm header `Retry-After` và `retryAfterSec`.
- `/health` không chờ vô hạn: `ping()` đua với deadline của chính nó và handler đua lại lần nữa, nên một probe không bao giờ treo — quá 2 giây là trả `db:"error"`.
- Body của `/health` là **body của Lite** (§19.1) cộng thêm `edition` và `version`, để một check giám sát duy nhất dùng được cho cả hai edition. `status` là `"degraded"` (Lite ghi `"error"`) vì tiến trình trả lời thì theo định nghĩa là chưa chết; thứ một monitor nên đọc là mã trạng thái hoặc `db`, và hai thứ đó giống hệt nhau ở cả hai edition.
- `PATCH /api/me` **không** đổi tên trên bàn đang chơi: RoomActor giữ định danh nhận lúc bind, tên mới xuất hiện ở lần vào phòng kế tiếp.
- Upgrade WebSocket `/ws` xác thực bằng chính cookie đó; thiếu/sai → HTTP `401` ngay ở bước upgrade (không phải close code), `Origin` phải nằm trong `ALLOWED_ORIGINS`.

### 19.3 Lite
Đã triển khai trong `apps/lite/server/src/http/routes.ts`; client `apps/lite/web/src/api.ts` phản chiếu đúng bảng này.

| Method | Path | Auth | Thành công | Từ chối |
|---|---|---|---|---|
| GET | `/health` | — | `200 {status, uptime, connections, rooms, db}` | `503` cùng shape khi `db: "error"` |
| GET | `/api/config` | — | `200 {edition:"lite", wsPath:"/ws", economy{startingBalance, blindWagerTiers, holdemBlindTiers, reliefThreshold, reliefTarget}, languages}` | — |
| POST | `/api/session` | — | `201 {playerId, displayName, token, balance}` | `400 INVALID_NAME` · `409 DISPLAY_NAME_TAKEN` · `429 RATE_LIMITED` (10 lần/phút/IP, kèm header `Retry-After` và `retryAfterSec`) |
| GET | `/api/me` | Bearer | `200 {playerId, displayName, balance, stats{handsPlayed, handsWon}, daily{…}, relief{…}}` | `401 UNAUTHENTICATED` |
| GET | `/api/rewards/daily` | Bearer | `200 {allowed, alreadyClaimed, day, points, nextDay, nextPoints, streak, lastClaim}` | `401 UNAUTHENTICATED` |
| POST | `/api/rewards/daily/claim` | Bearer | `200 {claimed:true, points, streak, balance}` | `409 ALREADY_CLAIMED` (kèm `claimed:false`) · `401 UNAUTHENTICATED` · `403 FORBIDDEN` (thiếu XRW) · `429 RATE_LIMITED` (60/phút/địa chỉ) |
| POST | `/api/economy/relief` | Bearer | `200 {granted:true, amount, balance}` | `409 NOT_ELIGIBLE` (kèm `granted:false, reason:"balance"\|"cooldown", retryAt`) · `401 UNAUTHENTICATED` · `403 FORBIDDEN` (thiếu XRW) · `429 RATE_LIMITED` (60/phút/địa chỉ) |
| POST | `/api/admin/shutdown` | Run token | `200 {ok:true}` rồi tắt êm (stopAccepting → hoàn cược/cash-out → đóng listener → đóng database) | `429 RATE_LIMITED` (5 lần/phút) · `403 FORBIDDEN` (socket không phải loopback) · `401 UNAUTHENTICATED` (sai run token) |
| GET | `/*` | — | Static `dist/public` (hoặc asset trong exe); đường dẫn không có phần mở rộng rơi về `index.html` | `404 NOT_FOUND` |

- Thân lỗi luôn là `{ error: { code, message } }`; các trường phụ (`retryAfterSec`, `claimed`, `granted`, `reason`, `retryAt`) nằm cạnh `error`, không nằm trong nó.
- Mọi request mutating (`POST`/`PUT`/`PATCH`/`DELETE`) thiếu `X-Requested-With: bind-poker` → `403 FORBIDDEN`, kiểm ngay ở `preHandler` trước cả auth.
- Rate-limit: mọi `/api/*` mutating đi qua một rổ chung **60/phút theo địa chỉ** (`WRITE_RATE_LIMIT` trong `http/routes.ts`), trừ `POST /api/session` (10/phút) và `POST /api/admin/shutdown` (5/phút) vốn đã có limiter riêng chặt hơn — tính hai lần chỉ làm cái chặt hơn vô hình. Khóa là địa chỉ chứ không phải bearer token, vì Lite dựng Fastify với `trustProxy: false` nên `req.ip` là peer của socket (không giả được), còn token thì người gọi tự bịa mỗi request một cái là có rổ mới. Đọc (`GET`) không tính: chúng chỉ đọc SQLite trong tiến trình, không mở transaction ghi. `429` kèm header `Retry-After` và `retryAfterSec`.
- Header trên **mọi** phản hồi (kể cả 404 và lỗi): `x-content-type-options: nosniff`, `referrer-policy: no-referrer`, `x-frame-options: DENY`, và `content-security-policy: default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. Bản Normal nới đúng bốn chỗ (`normalCsp`): hai host Google Fonts, cộng **`script-src 'self' 'wasm-unsafe-eval'`** và **`blob:`** thêm vào `img-src` — cả hai cho avatar 3D. `'wasm-unsafe-eval'` chỉ cho phép biên dịch WebAssembly (bộ giải nén meshopt của `.glb`), **không** mở lại `eval()` hay `new Function()` như `'unsafe-eval'`; thiếu nó thì mọi ảnh chân dung im lặng rơi về chữ cái đầu tên. `blob:` là vì ảnh chân dung do chính trình duyệt dựng ra rồi hiện qua object URL — một `blob:` URL theo định nghĩa là cùng origin và chỉ trỏ tới `Blob` mà tài liệu này đang giữ, nên nó không mở thêm nguồn nào ra ngoài. Xem `docs/security.md`. `connect-src 'self'` đủ cho cả WebSocket: `ws://`/`wss://` cùng origin khớp `'self'` theo CSP 3, nên hai nguồn `ws:`/`wss:` cũ đã bỏ. Bốn directive cuối bịt những chỗ `default-src` không với tới: nhúng iframe, `<base href>`, đích của form, và plugin. `/health` và `/api/*` thêm `cache-control: no-store`.
- Cache của static: `assets/<tên>-<hash>.<ext>` → `public, max-age=31536000, immutable`; mọi thứ còn lại (`index.html`, `favicon.ico`) → `no-cache`.
- Prefix `api`, `ws`, `health` được giữ chỗ: gõ sai dưới các prefix đó là `404`, không bao giờ rơi về `index.html`.
- Lỗi Fastify trước khi vào handler được đổi thành code ổn định: `400 BAD_REQUEST`, `404 NOT_FOUND`, `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, `429 RATE_LIMITED`; mọi lỗi ≥ 500 trả `500 INTERNAL` và chỉ ghi chi tiết vào log.

## 20. WebSocket Protocol (`core/protocol`)

Mọi message: `{ t: string, ...payload }`. Client→server có `reqId?: string`. Server→client liên quan phòng có `seq: number`.

### 20.1 Client → Server
| t | Payload | Ghi chú |
|---|---|---|
| `HELLO` | `{ sessionToken }` | Chỉ Lite |
| `LIST_ROOMS` | — | Đăng ký nhận `ROOM_LIST` khi ở lobby |
| `CREATE_ROOM` | `{ config: RoomConfig }` | Tự vào phòng sau khi tạo |
| `JOIN_ROOM` | `{ roomId?, code?, password? }` | |
| `LEAVE_ROOM` | — | |
| `SIT_DOWN` | `{ seat, buyIn? }` | |
| `STAND_UP` | — | |
| `SIT_OUT` | — | Giữ ghế, bỏ qua từ ván sau (ván đang chơi vẫn đánh hết); chưa có ghế → `NOT_SEATED` |
| `SIT_IN` | — | Trở lại từ ván sau; stack dưới mức tối thiểu thì vẫn `SITTING_OUT` |
| `READY` | `{ ready: boolean }` | |
| `START_GAME` | — | Host |
| `KICK` | `{ playerId }` | Host, chỉ người chưa trong ván |
| `ACTION` | `{ reqId, baseSeq, action: { kind: 'fold'|'check'|'call'|'bet'|'raise'|'allIn'|'play', amount? } }` | |
| `RESYNC` | — | |
| `PONG` | — | |

Mọi message client → server có thể mang `reqId?`; server trả lại nó trong `ACK`/`ERROR`. Riêng `ACTION` bắt buộc phải có `reqId`.

### 20.2 Server → Client
| t | Payload |
|---|---|
| `WELCOME` | `{ playerId, displayName, balance, serverTime }` |
| `ROOM_LIST` | `{ rooms: RoomSummary[] }` |
| `ROOM_SNAPSHOT` | `{ seq, room: RoomView, hand?: HandView, deadlineAt: number | null }` |
| `GAME_EVENT` | `{ seq, event: GameEvent }` |
| `ROOM_EVENT` | `{ seq, event: PLAYER_JOINED \| PLAYER_LEFT \| PLAYER_SAT \| PLAYER_STOOD \| PLAYER_READY \| PLAYER_SIT_OUT \| HOST_CHANGED \| PLAYER_DISCONNECTED \| PLAYER_RECONNECTED \| ROOM_STATUS \| ROOM_CLOSED }` |
| `BALANCE` | `{ balance }` — sau settlement/daily/relief |
| `NOTIFICATION` | `{ kind, payload }` — Normal dùng cho achievement; Lite chỉ gửi `NOTIFICATION{kind:'KICKED'}` khi host kick (cả hai edition đều gửi thông báo này) |
| `ACK` | `{ reqId }` |
| `ERROR` | `{ reqId?, code, message }` |
| `SESSION_REPLACED` | — |
| `PING` | — |

`RoomView.players[]` (`RoomPlayerView`) = `{ playerId, displayName, isBot, isHost, connected, seat, status, sittingOut, stack, ready, cosmetics? }`. `status` là trạng thái ghế (mục 11.3, một giá trị, `IN_HAND` xếp trên `SITTING_OUT`); `sittingOut` là cờ sit-out riêng, độc lập với `status`, để client không phải suy ra yêu cầu sit-out từ một enum loại trừ nhau.

### 20.3 Mã lỗi
`UNAUTHENTICATED, INVALID_MESSAGE, RATE_LIMITED, ROOM_NOT_FOUND, ROOM_FULL, WRONG_PASSWORD, INVALID_ROOM_CONFIG, NOT_HOST, SEAT_TAKEN, INSUFFICIENT_BALANCE, NOT_YOUR_TURN, ILLEGAL_ACTION, INVALID_AMOUNT, STALE_STATE, DUPLICATE_REQUEST, NOT_IN_HAND, NOT_IN_ROOM, ALREADY_IN_ROOM, NOT_SEATED, GAME_IN_PROGRESS, NOT_ENOUGH_PLAYERS, DISPLAY_NAME_TAKEN, SERVER_SHUTDOWN, INTERNAL`.

### 20.4 Ranh giới protocol
Core protocol chỉ gồm các message trên. Avatar/inventory/achievement/auth đi REST. `NOTIFICATION` là kênh mở để edition đẩy thông báo không liên quan gameplay; core không định nghĩa payload bên trong.

## 21. Normal/Lite Feature Matrix

| Feature | Core | Normal | Lite |
|---|:-:|:-:|:-:|
| Card / Deck / RNG / Hand evaluator | ✓ | ✓ | ✓ |
| Hold'em engine (no-limit, side pot) | ✓ | ✓ | ✓ |
| Blind Poker engine (2/3 lá, kiểu A/B) | ✓ | ✓ | ✓ |
| Game state machine, validation | ✓ | ✓ | ✓ |
| Bot (Blind + Hold'em) | ✓ | ✓ | ✓ |
| Room manager, WS gateway, timer, reconnect | ✓ (server-kit) | ✓ | ✓ |
| Core protocol | ✓ | ✓ | ✓ |
| Basic player identity + balance | ✓ (interface) | ✓ | ✓ |
| Phí bàn, cứu trợ | ✓ | ✓ | ✓ |
| Daily reward | ✓ (bảng điểm) | Điểm + item | Điểm |
| Thống kê | — | Đầy đủ | Ván chơi/thắng |
| UI bàn chơi, lobby, i18n, responsive | ✓ (ui-kit) | ✓ | ✓ |
| Auth email/mật khẩu, session cookie | — | ✓ | ✗ |
| Session token đơn giản | — | ✗ | ✓ |
| PostgreSQL + Drizzle | — | ✓ | ✗ |
| SQLite (`node:sqlite`) | — | ✗ | ✓ |
| Sổ cái `point_transactions` | — | ✓ | ✗ |
| Achievement | — | ✓ | ✗ |
| Avatar / Inventory / Cosmetic | — | ✓ | ✗ |
| Lịch sử ván | — | ✓ | Tùy chọn (log) |
| Log JSON có cấu trúc, `/health` kiểm DB | — | ✓ | Log text, `/health` cơ bản |
| Docker image | — | ✓ | ✗ |
| Single exe Windows | — | ✗ | ✓ |

## 22. Normal/Lite Architecture

### 22.1 Monorepo
```text
bind-poker/
├── package.json  pnpm-workspace.yaml  tsconfig.base.json  vitest.workspace.ts
├── packages/
│   ├── core/          @bp/core        deps: (none)
│   ├── server-kit/    @bp/server-kit  deps: @bp/core, ws
│   └── ui-kit/        @bp/ui-kit      deps: @bp/core, react, react-dom, i18next, react-i18next
├── apps/
│   ├── normal-server/ @bp/normal-server deps: @bp/server-kit, fastify, @fastify/static, @fastify/cookie, @fastify/rate-limit, @fastify/helmet, drizzle-orm, pg, argon2, pino
│   ├── normal-web/    @bp/normal-web    deps: @bp/ui-kit, react-router, vite
│   └── lite/          @bp/lite          deps: @bp/server-kit, @bp/ui-kit, fastify, @fastify/static, @fastify/rate-limit, esbuild(dev), vite(dev), postject(dev)
├── docs/
└── tooling/eslint/    rule chặn import ngược
```

### 22.2 Dependency graph (ép bằng ESLint `no-restricted-imports` theo package + test đọc `package.json`)
```text
apps/normal-server ─┐                 apps/normal-web ─┐
                    ├─> packages/server-kit ─> core     ├─> packages/ui-kit ─> core
apps/lite/server ───┘                 apps/lite/web ───┘
```
Cấm: core → bất kỳ; server-kit → apps/ui-kit; ui-kit → server-kit/apps; apps ↔ apps.

### 22.3 Cách edition "cắm" vào server-kit
```ts
createGameServer({
  identity: SessionResolver,          // edition cung cấp
  repos: { player, balance, session, history },
  economy: EconomyConfig,
  onDomainEvent?: (e: DomainEvent) => void,   // Normal gắn stats/achievement; Lite bỏ qua
  logger,
})
```
Server-kit không import gì từ apps. Normal thêm route REST và module riêng vào cùng Fastify instance.

### 22.4 Build
- `pnpm build:normal` = `node apps/normal-server/scripts/build.mjs`: (1) `tsc -p tsconfig.build.json` — **typecheck** đúng phần sẽ ship (bỏ test, bỏ `test-db.ts`/`test-harness.ts` vì chúng nạp PGlite); (2) esbuild bundle **hai** entry `src/main.ts` và `src/migrate-cli.ts` → `dist/main.js`, `dist/migrate-cli.js` (`platform=node`, `format=esm`, `target=node22`); (3) kiểm `drizzle/` và `data/` nằm cạnh `dist/`. Plan 6 sẽ nối thêm `vite build` của `normal-web` → `PUBLIC_DIR`.
  - **Vì sao bundle chứ không phải `tsc --outDir dist`**: ba package workspace publish thẳng *source* TypeScript (`"exports": "./src/index.ts"`), nên một bản emit của `tsc` vẫn để lại `import … from '@bp/core'` trong `dist/` và `node dist/main.js` bên ngoài repo (tức là trong image) không resolve được. esbuild nội xạ đúng ba package đó.
  - **External** là toàn bộ dependency bên thứ ba — `pg` (+`pg-native` tùy chọn), `argon2` (native addon), `fastify`, `@fastify/cookie`, `drizzle-orm`, `ws` — chúng đến từ `node_modules` mà image cài. Vì vậy build **bắt buộc** mọi specifier còn lại trong bundle phải là một entry `dependencies` của `@bp/normal-server`: một devDependency lọt vào code ship sẽ làm hỏng container chứ không làm hỏng build, nên nó bị chặn ngay ở đây. `ws` có trong manifest chính vì lý do này — không dòng code nào của normal-server import nó, nhưng gateway của `@bp/server-kit` (đã bị bundle vào) thì có. Guard phân biệt specifier **nạp ngay** (`from`, `import` trần, `require()`) với specifier **nạp trễ** (`import()`): PGlite bị cấm tuyệt đối ở nhóm nạp ngay, vì `drizzle-orm/pglite/*` là subpath của một dependency *có khai* nên luật "phải là entry `dependencies`" không nhìn thấy nó, trong khi bản thân `@electric-sql/pglite` là devDependency và không hề có trong `node_modules` production. Vì thế `runMigrations` nạp cả hai migrator bằng `import()` bên trong đúng nhánh của nó.
  - `drizzle/` và `data/` **không** vào `dist/`: chúng được đọc từ đĩa lúc chạy, tìm bằng cách đi ngược từ `import.meta.url` tới thư mục có `package.json` tên `@bp/normal-server` (`src/db/migrate.ts` → `packageRoot()`). Từ `dist/main.js` đường đi đó dừng đúng ở package root, nơi cả hai đã sẵn sàng — nên image chỉ cần giữ nguyên bố cục `package.json` + `dist/` + `drizzle/` + `data/` cùng cấp.
  - Kiểm tra sau build (`apps/normal-server/test/build.test.ts`, bỏ qua khi `CI_SKIP_BUILD`): hai entry tồn tại, không còn specifier `@bp/*` hay `../../packages/`, `drizzle/`+`data/` đúng chỗ, và chạy thật `node dist/main.js` — thiếu biến thì thoát khác `0` và liệt kê tên biến không kèm stack, `DATABASE_URL` chết thì thoát nhanh với lỗi database.
- `pnpm build:lite` = `node apps/lite/scripts/build.mjs all --smoke`, ba bước theo thứ tự (`web`, `server`, `exe` cũng chạy riêng được):
  1. **web** — `vite build --config web/vite.config.ts` → `apps/lite/dist/public/**` (`index.html` + `assets/<tên>-<hash>.<ext>`, `base` tương đối, không source map).
  2. **server** — `esbuild server/src/main.ts --bundle --platform=node --target=node22 --format=cjs --external:node:* --define:process.env.NODE_ENV="production" --minify-syntax` → `dist/server.cjs`. Chỉ built-in `node:` được để external: trong exe không còn `node_modules` để resolve.
  3. **exe** — liệt kê `dist/public` thành **manifest `dist/assets.json`**; sinh `dist/sea-config.json` từ `scripts/sea-config.template.json` với `assets` = manifest + **từng file** trong `dist/public`; `node --experimental-sea-config dist/sea-config.json` → `dist/sea-prep.blob`; copy **chính `process.execPath`** (Node 22 đang chạy build — không tải node.exe về) thành `release/lite/bind-poker-lite.exe`; `postject … NODE_SEA_BLOB --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`; copy `release-src/README-lite.md` và `release-src/.env.example` sang cạnh exe.
- `useCodeCache` được thử `true` trước rồi tự lùi về `false` nếu sinh blob hoặc smoke hỏng. Hệ quả: **build không bit-reproducible** — code cache của V8 phụ thuộc bản Node và máy build, nên sha256 in ra cuối bước `exe` định danh đúng một file đã phát hành, không phải một thứ dựng lại được từ cùng commit. Bước `exe` bị bỏ qua khi không phải Windows, và dừng hẳn nếu Node không phải dòng 22 (blob SEA chỉ nạp được bởi đúng bản Node đã tạo ra nó). postject in `The signature seems corrupted!` — đúng như vậy: chèn section làm hỏng chữ ký Authenticode của bản Node gốc.
- Lúc chạy, `main.ts` phân biệt hai chế độ bằng `process.getBuiltinModule('node:sea')`: `sea.isSea()` → đọc `assets.json` rồi `sea.getAsset()`; ngược lại đọc thư mục (`PUBLIC_DIR`, mặc định `dist/public` **tính từ `resolveBaseDir()`** — thư mục chứa exe khi đóng gói, cwd khi chạy bằng `node`, đúng như `SQLITE_PATH` và `.env`), không có thì API vẫn chạy và log một cảnh báo.
- `--smoke` chạy chính exe vừa tạo: boot toàn bộ server trên cổng ephemeral, tự gọi `/health`, in JSON rồi thoát; khác `0` là build hỏng. Database đi vào thư mục tạm và bị xoá khi xong, trừ khi `SQLITE_PATH` được đặt tường minh — một lần kiểm tra không được tạo hay đụng tới file dữ liệu thật. Run file cũng bị xoá theo.
- Kiểm tra sau build (`apps/lite/test/footprint.test.ts` + `smoke.test.ts`): `server.cjs` không chứa `pg`, `drizzle`, `argon2`, `react-router`; gzip JS trong `dist/public` ≤ 250 KB và CSS ≤ 40 KB; exe ≤ 120 MB. **Nguồn chân lý của danh sách phụ thuộc là `apps/lite/package.json`** — footprint test chỉ grep vài gói *cấm*, nó là lưới chặn chứ không phải allowlist; thêm dependency thì sửa manifest, không sửa test.
- Kiểm tra bằng trình duyệt thật (tuỳ chọn, không nằm trong `pnpm test`): `pnpm --filter @bp/lite e2e` — Playwright dựng `node dist/server.cjs` với `SQLITE_PATH=:memory:`, chơi trọn một ván Blind hai người + một bot, tải lại trang giữa ván, và đối chiếu số dư `/api/me` với phiếu kết quả trên màn hình. Cần `playwright install chromium` một lần (~150 MB).

### 22.5 Cấu hình runtime (env)
| Biến | Normal | Lite |
|---|---|---|
| `PORT` | 8080 | 8080 |
| `HOST` | 0.0.0.0 | 0.0.0.0 |
| `DATABASE_URL` | **bắt buộc** — `postgres://` hoặc `postgresql://`; kiểm scheme lúc khởi động | — |
| `SQLITE_PATH` | — | `./bind-poker.sqlite` |
| `SESSION_SECRET` | **bắt buộc**, ≥ 32 ký tự — khóa HMAC sinh ra id phiên (`sessions.id = hex(HMAC-SHA256(secret, token))`). Đổi nó là đăng xuất toàn bộ; mật khẩu không bị ảnh hưởng (argon2 tự mang salt). Không bao giờ được ghi ra log | — |
| `ALLOWED_ORIGINS` | bắt buộc (CSV) | *(trống)* → `'same-host'`: `Origin` phải trùng `host[:port]` của header `Host` (không phân biệt scheme), không có `Origin` (client không phải trình duyệt) thì cho qua, còn lại `403` ở bước upgrade. Khai CSV khi sau reverse proxy — khi đó thiếu `Origin` cũng bị từ chối |
| `RECONNECT_WINDOW_SEC` | 90 | 90 (`roomOptions.reconnectWindowMs`) |
| `ECONOMY_TIMEZONE` | Asia/Ho_Chi_Minh | Asia/Ho_Chi_Minh |
| `LOG_LEVEL` | info | info |
| `LITE_HAND_LOG` | — | `false` (`1`/`true`/`yes` để bật) |
| `COOKIE_SECURE` | `true` | — (Lite không dùng cookie) |
| `TRUST_PROXY` | `false` | — |
| `MAX_CONNECTIONS` | 1.000 (§24) | — |
| `AUTO_MIGRATE` | `true` | — |
| `PUBLIC_DIR` | *(trống)* → chỉ API, log một cảnh báo | *(trống)* — thư mục giao diện thay bản nhúng trong exe |

Chi tiết bốn biến chỉ Normal có:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `COOKIE_SECURE` | `true` | Gắn `Secure` vào cookie phiên. Đặt `false` **chỉ** cho người dev chạy `http://localhost`; đặt `false` trên môi trường thật là gửi cookie phiên qua HTTP thuần |
| `TRUST_PROXY` | `false` | **Danh sách hop được tin**, không phải bật/tắt: `false`, một trong `loopback` / `linklocal` / `uniquelocal`, hoặc danh sách địa chỉ/CIDR ngăn cách bằng dấu phẩy (`10.0.0.0/8,192.168.1.7`). Chuỗi này được đưa thẳng cho `trustProxy` của Fastify (Fastify tự tách dấu phẩy rồi compile bằng `proxy-addr`). **`TRUST_PROXY=true` bị `loadConfig` TỪ CHỐI**: nó nghĩa là "tin mọi hop", nên `req.ip` thành phần tử **trái nhất** của `X-Forwarded-For` — thứ do client tự ghi, vì proxy *nối thêm* chứ không thay thế — và mọi rate-limit theo IP (đăng ký, đăng nhập, rổ theo địa chỉ ở §19.2) bị vô hiệu chỉ bằng cách đổi một header mỗi request. Số hop cũng không phải lời giải: Fastify ≥ 5.12 làm một giá trị số **fail closed**, dồn mọi client vào đúng địa chỉ của proxy. Compose §28.1 đặt `uniquelocal` (Caddy nằm trên mạng bridge, địa chỉ RFC1918) |
| `MAX_CONNECTIONS` | `1000` | Số kết nối WebSocket sống đồng thời tiến trình này nhận (mục tiêu §24); vượt qua thì upgrade bị trả `503`. Đi kèm là rổ 30 upgrade/phút/địa chỉ, tính **trước** khi tra session — mỗi upgrade bị từ chối trước đây vẫn tốn một lượt tra `sessions` trên pool 10 kết nối |
| `AUTO_MIGRATE` | `true` | Chạy migration ngay lúc boot. Đặt `false` khi có job riêng (`node dist/migrate-cli.js`) áp migration — đúng thứ mà nhiều replica cần, và là cấu hình của compose §28.1. Giá trị không nhận ra thì **dừng**, không âm thầm lấy mặc định |
| `PUBLIC_DIR` | *(trống)* | Thư mục bundle web để phục vụ ở `/`. Trống = chạy thuần API. Plan 6 (`normal-web`) là thứ đổ file vào đây |

`AUTO_MIGRATE` được đọc trong `main.ts` chứ không nằm trong `NormalConfig`: nó là tính chất của *lần khởi động này*, `buildApp` không dùng tới.

Normal đọc theo thứ tự: `.env` ở thư mục làm việc trước, **biến môi trường thật luôn thắng** — nên một deployment có thể đặt tất cả bằng biến container và không cần file. `loadConfig` báo **mọi** lỗi cùng lúc (một người điền `.env` mới nên biết hết trong một lần chạy, không phải mỗi lần restart một biến) rồi ném ra; `main.ts` in thông điệp đó ra stderr và thoát `1`, không kèm stack trace.

Lite đọc theo thứ tự: biến môi trường thắng, sau đó `.env` **cạnh exe** (cwd khi chạy bằng `node dist/server.cjs`), cuối cùng là mặc định. Giá trị sai làm process dừng ngay lúc khởi động kèm lý do. `SQLITE_PATH=:memory:` được chấp nhận (test và e2e); mọi đường dẫn tương đối khác tính từ thư mục exe.

## 23. Security

| Mối đe dọa | Biện pháp |
|---|---|
| Client thao túng bài/RNG/pot | Toàn bộ trong server; client chỉ nhận PlayerView; RNG `crypto.randomInt` |
| Action sai/lặp/sai lượt | `validateAction` core + `reqId` + `baseSeq` + hàng đợi tuần tự |
| Đăng nhập brute-force | argon2id (m=64MB, t=3, p=1), rate-limit 5/phút/IP+email, phản hồi thời gian đồng đều |
| Session hijack | Cookie `HttpOnly Secure SameSite=Lax`, session server-side, revoke khi logout, xoay id khi login |
| CSRF | SameSite=Lax + header `X-Requested-With` bắt buộc cho mutating; WS kiểm `Origin` |
| XSS | React escape mặc định; CSP `default-src 'self'`; không `dangerouslySetInnerHTML`; SVG avatar là component, không inject |
| Injection | Drizzle parameterized; SQLite prepared statements; schema validate mọi input |
| WS abuse | Rate-limit 20 msg/s, size 4 KB, đóng khi sai schema 3 lần, tối đa 3 phòng/người |
| Lộ thông tin | Lỗi trả mã; log không có token/mật khẩu/email đầy đủ; stack trace chỉ ở log |
| Secret | Env; `.env.example` mẫu; kiểm tra khởi động từ chối `SESSION_SECRET` yếu |
| Lite không mật khẩu | Ghi giới hạn: ai có token là người đó; mạng nội bộ tin cậy; roadmap PIN tùy chọn |

## 24. Performance

| Mục tiêu | Normal (2 vCPU, 2 GB) | Lite (1 vCPU, 512 MB RAM cho tiến trình) |
|---|---|---|
| Kết nối đồng thời | 1.000 | 200 |
| Phòng đang chơi đồng thời | 150 | 30 |
| Độ trễ action → broadcast (server) | p95 < 50 ms | p95 < 50 ms |
| Kích thước message | snapshot < 8 KB; event < 1 KB | như Normal |
| Tải trang đầu (gzip) | chunk đầu ≤ 500 KB | toàn bộ ≤ 250 KB |
| Khởi động | < 5 giây (kể cả migrate) | < 2 giây |
| RAM/phòng | < 200 KB | < 200 KB |
Biện pháp: delta events thay vì gửi lại snapshot; PlayerView tính một lần rồi lọc theo ghế; không gửi ROOM_LIST cho người đang trong phòng; Card SVG vẽ bằng code; lazy chunk Normal-only.

## 25. Scalability

- MVP: một tiến trình. Postgres chịu được nhiều tiến trình app nhưng phòng nằm trong RAM nên **một phòng thuộc một tiến trình**.
- Bước tiếp theo khi cần (không làm ở MVP): chạy N tiến trình, reverse proxy định tuyến theo `roomId` (sticky), danh sách phòng gộp qua bảng `rooms_live` trong Postgres có TTL. Không cần Redis cho tới khi phải chia sẻ lobby realtime giữa tiến trình.
- Lite không mở rộng ngang theo thiết kế.

## 26. Internationalization

- i18next; namespace `common`, `game` trong `@bp/ui-kit/locales/{en,vi}`; `normal` trong `normal-web`. Key dạng `game.action.raise`.
- Chọn ngôn ngữ: localStorage → `navigator.language` → `vi`. Đổi lúc chạy, không reload; lưu localStorage.
- Server không dịch: lỗi trả `code`, client tra `errors.<code>`. Tên bài (`hand.fullHouse`) và item (`nameKey`) là key.
- Số và ngày: `Intl.NumberFormat`, `Intl.DateTimeFormat` theo ngôn ngữ.
- Lint `react/jsx-no-literals` + test kiểm tra hai file locale có cùng tập key.
- Thêm ngôn ngữ = thêm thư mục locale + mục trong `SUPPORTED_LANGUAGES`.
- Đơn vị điểm không được hiển thị như tiền tệ (không dùng `đ`/`₫`/`VND`, không dùng từ "tiền"): số dư và stack luôn đọc là điểm.

## 27. Responsive Design

### 27.1 Breakpoint và bố cục bàn
- `≥ 1024`: elip đầy đủ, ghế của mình ở đáy giữa, ActionBar dưới ghế mình.
- `768–1023`: elip hẹp, chữ nhỏ hơn, ActionBar nổi.
- `< 768` dọc: lưới đối thủ 2 hàng trên cùng; community + pot giữa; bài mình + ActionBar ghim đáy (`position: sticky`), nút ≥ 44 px; slider cược thay bằng nút preset + input.
- Hàng đối thủ luôn hiển thị đủ mọi ghế (tối thiểu 2 hàng, không cuộn ẩn): lưới tự xuống dòng, và khi cần nhiều hàng hơn thì thu nhỏ plate (avatar + tên + stack + cược + trạng thái) trước, tuyệt đối không cuộn bên trong hàng đối thủ.
- `< 768` ngang (điện thoại xoay): dùng bố cục elip thu nhỏ, ẩn header.
- Lá bài: `clamp(36px, 8vw, 72px)` chiều rộng.

### 27.2 Màn hình
Cột cuối ghi nơi màn hình của **bản Normal** thực sự nằm sau Plan 6 (`apps/normal-web`); màn nào đến
từ `@bp/ui-kit` thì dùng nguyên component của kit chứ không viết lại.

| # | Màn | Normal | Lite | Trạng thái bản Normal |
|---|---|---|---|---|
| 1 | Landing/Login/Register | ✓ | Nhập tên | Đã triển khai (Plan 6) — `screens/AuthScreen.tsx`, route `#/login` và `#/register` |
| 2 | Home/Lobby | ✓ | ✓ | Đã triển khai (Plan 6) — `LobbyScreen` của ui-kit, thêm `extraNav` (điểm danh, hồ sơ, ảnh đại diện) |
| 3 | Room list | ✓ | ✓ | Đã triển khai (Plan 6) — trong `LobbyScreen` của ui-kit |
| 4 | Create room | ✓ | ✓ | Đã triển khai (Plan 6) — dialog tạo phòng của ui-kit |
| 5 | Join room (mã/mật khẩu) | ✓ | ✓ | Đã triển khai (Plan 6) — trong `LobbyScreen` của ui-kit |
| 6 | Poker table | ✓ | ✓ | Đã triển khai (Plan 6) — `RoomScreen` của ui-kit + `avatarFor`/`captionFor` của app |
| 7 | Player profile | ✓ | Rút gọn | Đã triển khai (Plan 6) — `screens/ProfileScreen.tsx` (thống kê, ván gần đây, lịch sử điểm, đổi tên) |
| 8 | Avatar customization | ✓ | ✗ | Đã triển khai — nhân vật 3D (Plan 8): `screens/WardrobeScreen.tsx` + `avatar3d/` |
| 9 | Inventory | ✓ | ✗ | Đã triển khai (Plan 6) — `screens/InventoryScreen.tsx` |
| 10 | Achievements | ✓ | ✗ | Đã triển khai (Plan 6) — `screens/AchievementsScreen.tsx` |
| 11 | Daily reward | ✓ | ✓ (điểm) | Đã triển khai (Plan 6) — `screens/DailyScreen.tsx` (lịch 31 ngày, biên nhận, cứu trợ) |
| 12 | Settings | ✓ | ✓ | Đã triển khai (Plan 6) — `screens/SettingsScreen.tsx` |
| 13 | Language selection (trong Settings và header) | ✓ | ✓ | Đã triển khai (Plan 6) — `LanguageSwitch` của ui-kit, trong rail của `Shell` và trong Settings |

### 27.3 Bàn chơi phải hiển thị
Người chơi (tên, stack, avatar/chữ cái, badge/title ở Normal), lá riêng, lá chung, pot (+ side pot, + pot cộng dồn), cược hiện tại của từng người, lượt (viền sáng + timer vòng tròn), trạng thái fold/all-in/sitting-out/disconnected, người thắng + bài thắng + số điểm nhận, mode và variant, mã phòng.

## 28. Deployment

### 28.1 Normal
- **`apps/normal-server/Dockerfile` hai stage.** Builder `node:22-alpine`: `npm i -g pnpm@9` (image không bật corepack), `apk add python3 make g++` (dự phòng khi `argon2` không có prebuild musl và phải biên dịch), copy manifest của **mọi** project trong workspace (`--frozen-lockfile` so lockfile với các project nó nhìn thấy, thiếu một cái là "lockfile cũ"), `pnpm install --frozen-lockfile --filter @bp/normal-server...`, `pnpm --filter @bp/normal-server build`, rồi `pnpm --filter @bp/normal-server deploy --prod /out`. Runtime `node:22-alpine`: `COPY --from=builder /out /app`, user `node` (không root), `NODE_ENV=production`, `EXPOSE 8080`, `HEALTHCHECK` bằng `node -e "fetch('http://127.0.0.1:8080/health')…"` (image không có curl), `CMD ["node","dist/main.js"]`.
  - **Image phục vụ luôn UI (Plan 6).** Builder cài với hai filter (`--filter @bp/normal-server... --filter @bp/normal-web...`), build server rồi build web (`pnpm --filter @bp/normal-web build`); runtime `COPY --from=builder /build/apps/normal-web/dist /app/public` và `ENV PUBLIC_DIR=/app/public`. Web bundle **không** nằm trong `/out`: `pnpm deploy` viết ra một *package*, và bundle web không phải file của `@bp/normal-server`. Mặc định của `config.ts` vẫn là `publicDir: null` (chỉ API) cho triển khai phục vụ web ở nơi khác; image mới là chỗ đặt giá trị.
  - Build context là **thư mục gốc repo** (`docker build -f apps/normal-server/Dockerfile .`) — một package workspace không cài được nếu thiếu workspace của nó. Vì thế danh sách loại trừ nằm ở `apps/normal-server/Dockerfile.dockerignore` (BuildKit đọc `<dockerfile>.dockerignore` trước): một `.dockerignore` đặt trong thư mục app sẽ không bao giờ được đọc.
  - `pnpm deploy --prod` là ngữ nghĩa **pnpm 9**: không có và không cần cờ `--legacy`. pnpm 10 hỏng ở **hai** chỗ, nên bản ghim 9 là ghim thật chứ không phải mặc định: `deploy` từ chối chạy nếu workspace không đặt `inject-workspace-packages=true` (rồi lại đòi `--legacy`), và pnpm 10 không chạy install script của dependency theo mặc định (`onlyBuiltDependencies`) nên bước `node-gyp-build` của argon2 bị bỏ qua âm thầm. `pnpm deploy --prod` đã được chạy thật trên pnpm 9.15.9: kết quả boot độc lập được, `node_modules` chỉ có sáu dependency production và không có devDependency nào. argon2 0.45.1 cũng có sẵn prebuild musl (`prebuilds/linux-x64/argon2.musl.node`), nên `python3 make g++` trong stage builder là dự phòng chứ không bắt buộc.
- **`deploy/normal/docker-compose.yml`: bốn service, một luật thứ tự.**

  | Service | Image | Vai trò |
  |---|---|---|
  | `db` | `postgres:16-alpine` | `POSTGRES_DB=bind_poker`, volume `pgdata`, healthcheck `pg_isready -U postgres -d bind_poker` (có `-d`: trong lúc initdb server đã nhận kết nối nhưng database ứng dụng chưa tồn tại) |
  | `migrate` | image của app | `command: node dist/migrate-cli.js`, `depends_on: db (service_healthy)`, `restart: "no"` — job restart khi lỗi là job giấu lỗi |
  | `app` | image của app | `depends_on: migrate (service_completed_successfully)`, `AUTO_MIGRATE=false`, `TRUST_PROXY=uniquelocal`, `COOKIE_SECURE=true`, `restart: unless-stopped`, **không publish port nào ra host** |
  | `caddy` | `caddy:2-alpine` | Port 80/443 (+443/udp), `Caddyfile` mount read-only, volume `caddy_data` (khóa ACME + chứng chỉ) và `caddy_config`, `depends_on: app` |

  `migrate` là service riêng chứ không phải một bước trong entrypoint của `app`: với `restart: unless-stopped`, migration chạy lúc boot sẽ chạy lại ở mỗi vòng crash-loop và ở mỗi replica thêm vào sau này. Migration vẫn idempotent (drizzle ghi bảng `drizzle.__drizzle_migrations`), nhưng thứ tự "db healthy → migrate xong → app khởi động" là thứ compose bảo đảm được còn entrypoint thì không.
- **Caddyfile**: `{$DOMAIN} { encode gzip; header Strict-Transport-Security "max-age=31536000; includeSubDomains"; reverse_proxy app:8080 }`. Đặt tên site bằng hostname là đủ để bật HTTPS tự động (Let's Encrypt + tự gia hạn + redirect 80→443). Caddy 2 **không** tự thêm HSTS như v1, nên nó là một dòng ở đây (không thuộc `http-kit`: Lite chạy http thuần trên LAN). WebSocket không cần cấu hình gì thêm — `reverse_proxy` chuyển tiếp `Connection`/`Upgrade` sẵn — và chính nó **nối thêm** vào `X-Forwarded-For`, thứ mà `TRUST_PROXY=uniquelocal` tin đúng một hop.
- **`.env`** (mẫu `deploy/normal/.env.example`): `DOMAIN`, `POSTGRES_PASSWORD`, `SESSION_SECRET` bắt buộc (compose dùng `${VAR:?…}` nên thiếu là dừng ngay lúc `docker compose config`, không phải lúc container chạy); `ECONOMY_TIMEZONE`, `LOG_LEVEL` tùy chọn. `DATABASE_URL` và `ALLOWED_ORIGINS` **được suy ra** trong compose (`postgres://postgres:${POSTGRES_PASSWORD}@db:5432/bind_poker`, `https://${DOMAIN}`) để không có hai chỗ khai cùng một sự thật.
- **Health**: `GET /health` trả `503` khi database không trả lời, nên `HEALTHCHECK` là kiểm tra phụ thuộc thật chứ không chỉ "tiến trình còn sống".
- **Backup**: `deploy/normal/backup.sh` — `docker compose exec -T db pg_dump -U postgres -Fc bind_poker`, cron hằng ngày, giữ 14 ngày, từ chối giữ file rỗng. Restore: `deploy/normal/restore.md` (`pg_restore --clean --if-exists --no-owner`, **dừng `app` trước**, chạy `migrate` sau khi restore nếu image đã mới hơn bản dump). `SESSION_SECRET` không nằm trong dump — chuyển host phải mang nó theo, nếu không mọi phiên mất hiệu lực.
- **Nâng cấp**: `git pull` → `docker compose up -d --build`; `migrate` tự chạy lại trước `app`. Không có down-migration: đường lùi là restore bản dump lấy ngay trước khi nâng cấp rồi chạy image cũ.
- **Log**: JSON một dòng ra stdout, gom bằng `docker logs`/log driver. Dòng khởi động không chứa `DATABASE_URL` hay `SESSION_SECRET`.
- **Trạng thái kiểm chứng (tính tới Plan 5 / Task 7):** `docker compose config`, `pnpm deploy --prod` và việc chạy artefact đã deploy một cách độc lập đều đã làm thật. `docker build`, `pnpm install` trong Alpine, quy trình ACME của Caddy và `service_completed_successfully` lúc chạy thì **chưa** — máy làm ra bộ file này không có Docker daemon. Cảnh báo tương ứng nằm ở `docs/deployment-normal.md` §2 và trong README.
- Tài liệu `docs/deployment-normal.md` (vận hành, tiếng Việt như mọi tài liệu vận hành khác) và `docs/normal-server.md` (bản đồ module cho người sửa code, tiếng Anh như mọi tài liệu phát triển khác).

### 28.2 Lite
- `pnpm build:lite` trên máy Windows x64 dev (yêu cầu Node 22 + pnpm 9) → `apps/lite/release/lite/` gồm đúng ba file:

  | File | Vai trò |
  |---|---|
  | `bind-poker-lite.exe` | Node 22 + `dist/server.cjs` + toàn bộ `dist/public` nhúng qua SEA (~81 MB, trần 120 MB) |
  | `.env.example` | Mọi biến §22.5 kèm mặc định và chú thích song ngữ; đổi tên thành `.env` để dùng |
  | `README-lite.md` | Hướng dẫn vận hành tại chỗ (tiếng Việt + tóm tắt tiếng Anh), nguồn ở `apps/lite/release-src/` |

- Database **không** đi kèm: `bind-poker.sqlite` (+ `-wal`, `-shm`) được tạo cạnh exe ở lần chạy đầu.
- Vận hành: copy thư mục vào host (thư mục có quyền ghi, không phải `C:\Program Files`), (tùy chọn) đổi `.env`, chạy exe → console in `Listening on http://0.0.0.0:8080`. Mở firewall cổng 8080 ở profile `Private` nếu cần. `GET /health` là endpoint giám sát (`503` khi database hỏng).
- Chạy nền: `schtasks /Create /TN "BindPokerLite" … /SC ONSTART /RU SYSTEM` (khuyến nghị) hoặc NSSM với `AppStopMethodConsole` — công cụ bọc dịch vụ duy nhất được hỗ trợ, vì nó dừng bằng Ctrl+C. Không dùng `sc.exe create`: exe không nói giao thức SCM nên Service Control Manager vừa báo start timeout dù server vẫn chạy, vừa giết cứng khi `sc stop`.
- **Dừng (Windows không có `kill -TERM`)** — chỉ ba đường sau là tắt êm: `bind-poker-lite.exe --stop`, `Ctrl`+`C`/`Ctrl`+`Break` trong console của server (`SIGINT`/`SIGBREAK`), và một service wrapper gửi Ctrl+C (NSSM). `taskkill`, `schtasks /End`, `sc stop` và đóng cửa sổ console là **tắt cứng**: số dư đã ghi vẫn an toàn (mọi bút toán trong transaction) nhưng **chồng đang trên bàn (Hold'em và Blind) và pot cộng dồn Blind B thì mất**. `main.ts` bắt `SIGTERM`/`SIGINT`/`SIGBREAK`/`SIGHUP` và chạy cùng một `close()` (drain 10 s).
- **`--stop` / `--status`**: lúc `listen()`, server ghi `bind-poker.run.json` cạnh file dữ liệu (giải như `SQLITE_PATH`) với `{ pid, port, host, token }` — `token` là 32 byte ngẫu nhiên hex, file mode `0600` ở nơi có — và xoá nó ở `close()`. `--stop` đọc file, `POST /api/admin/shutdown` qua loopback (`X-Requested-With` + `Authorization: Bearer <token>`), rồi poll `pid` tới 15 s và thoát `0`/`1`; `--status` in `/health` của tiến trình đang chạy. Endpoint chặn ba lớp theo thứ tự: rate-limit 5/phút → địa chỉ socket phải loopback (`127.0.0.0/8`, `::1`, `::ffff:127.0.0.1`), nếu không `403` → so token constant-time, sai `401`. Trả `{ ok: true }` rồi mới drain (stopAccepting → hoàn cược/cash-out → đóng listener → đóng database). Vì endpoint chỉ nghe loopback, `--stop` đòi `HOST` là `0.0.0.0` hoặc `127.0.0.1`; bind vào một IP LAN cụ thể thì chỉ còn Ctrl+C/NSSM.
- **Run file là của đúng một tiến trình.** `--smoke` không ghi run file (nó là tiến trình thứ hai, thường dùng chung thư mục dữ liệu với server đang chạy); xóa run file luôn đọc lại và đối chiếu `pid` + `token` trước khi unlink; và khi khởi động mà run file mô tả một bản **thật sự đang chạy** thì process **từ chối chạy** ("another instance is already running …") thay vì chiếm file — chiếm file sẽ làm bản đang giữ stack của người chơi mất đường tắt êm.
- **"Đang chạy" phải chứng minh được, không chỉ là `pid` còn sống.** Sau một lần tắt cứng run file vẫn nằm lại và hệ điều hành được phép cấp lại đúng `pid` đó cho một tiến trình bất kỳ, nên nếu chỉ hỏi `process.kill(pid, 0)` thì bản mới bị chặn oan bởi một trình duyệt tình cờ trùng pid. `claimRunFile` (`run-file.ts`) hỏi hai câu: `pid` còn sống **và** `GET /api/config` tại đúng địa chỉ ghi trong file (host `0.0.0.0`/`::`/rỗng → hỏi qua loopback) trả lời `edition: "lite"` trong vòng 1 giây → `held`, từ chối khởi động. Không có file, hoặc `pid` đã chết, là `vacant`/`stale` ngay — không cần hỏi mạng. Còn khi `pid` sống thì hai kết quả của lần hỏi mạng không nặng như nhau: kết nối bị **từ chối thẳng** (`ECONNREFUSED`/`ENOTFOUND`), hoặc trả lời HTTP lỗi/không phải JSON/`edition` khác, là bằng chứng chắc chắn — `stale`, server ghi một dòng `overwriting a stale bind-poker.run.json` kèm lý do rồi ghi đè; nhưng **hết 1 giây mà im lặng** chỉ là *chưa có bằng chứng* (một bản Lite sống nhưng bận đúng lúc đó im lặng y hệt), nên đây không tính là `stale` — server thử lại đúng một lần với cùng thời hạn, và nếu vẫn hết giờ thì kết quả là `unreachable`: process **từ chối khởi động hẳn**, với một thông báo lỗi riêng (khác câu "another instance is already running…" của `held`) bảo chạy `--stop` hoặc kiểm tra lại cổng — không bao giờ ghi đè chỉ vì im lặng, vì đó là hướng duy nhất mà cơ chế mới yếu hơn kiểm tra `pid`-only cũ nếu bỏ qua. Dùng `/api/config` chứ không phải `/health` vì nó đã mang sẵn `edition` (§19.3) nên không cần đổi shape của probe giám sát.
- Khởi động hỏng: in một dòng gợi ý (cổng bận / thiếu quyền / giá trị `.env` sai / đã có bản đang chạy) và, khi `process.stdin.isTTY`, chờ một phím trước khi thoát để cửa sổ double-click còn đọc được.
- Sao lưu: dừng server rồi chép cả ba file `.sqlite*`; hoặc `sqlite3.exe <db> ".backup '<đích>'"` khi đang chạy (chép tay lúc WAL đang mở có thể ra bản không nhất quán).
- Nâng cấp: `--stop`, thay file, chạy lại; SQLite tự migrate theo `user_version`. Migration chỉ thêm, không có đường hạ cấp tự động — sao lưu trước.
- Tài liệu `docs/deployment-lite.md`, kèm troubleshooting (cổng bận, quyền ghi file sqlite, SmartScreen chặn exe chưa ký, `no web assets found` khi chạy sai thư mục).

## 29. Testing

### 29.1 Core (Vitest, `packages/core`)
- Deck: 52 lá duy nhất; shuffle seed cố định cho kết quả cố định; phân phối thống kê thô.
- Evaluator: bảng vector ≥ 60 hand có kết quả kỳ vọng (mọi category, kicker, wheel, hai flush khác cao, quads với kicker); so `rank` với brute-force tổ hợp cho 7 và 8 lá trên 2.000 hand ngẫu nhiên seed.
- Hold'em betting: min-raise, all-in không mở lại raise, BB option, heads-up, side pot 3 tầng, chip lẻ, fold hết trước showdown, run-out.
- Blind: kiểu A/B × 2/3 lá; một người play; tất cả fold cộng dồn; thiếu điểm ngồi ngoài; timeout = fold; phí bàn.
- State machine: kịch bản lệnh → state/events khớp snapshot (inline snapshot).
- Validation: mọi loại action sai trả đúng mã.
- Bot: 10.000 ván mô phỏng mỗi mode, không action bị từ chối.
- Bất biến bảo toàn điểm chạy trong mọi test ván.

### 29.2 Server-kit (integration, WS thật, repo in-memory)
Tạo/vào/rời phòng, mã phòng, mật khẩu, ready/start/autoStart, ván trọn vẹn Hold'em và Blind với bot, timer hết giờ, disconnect → reconnect nhận snapshot đúng, quá cửa sổ → đứng dậy, kết nối trùng, `reqId` trùng, `baseSeq` cũ, sai lượt, rate-limit, host rời, shutdown hoàn tiền.

### 29.3 Multiplayer
6 client × 3 phòng × 20 ván song song; kiểm tra tổng điểm và không có `seq` hụt.

### 29.4 Normal
Auth (đăng ký/đăng nhập/sai mật khẩu/rate-limit/cookie flags), economy (bảng daily từng ngày, reset tháng, bỏ ngày, cứu trợ cooldown, phí bàn), achievement (unlock từ event, không unlock hai lần), inventory/avatar (từ chối item không sở hữu), Postgres repository (Docker `postgres:16`, bỏ qua nếu không có Docker với cảnh báo).

**`apps/normal-web`** — mỗi màn render thật với một `NormalApi` giả và được điều khiển qua `user-event`, mọi truy vấn bằng role + accessible name (test hành vi *và* test khả năng tiếp cận cùng lúc); `locales.test.ts` đối chiếu hai bundle ngôn ngữ với `data/items.json` + `data/achievements.json` của server; `test/footprint.test.ts` đo gzip của `dist/assets/*` (entry ≤ 500 KB, tổng ≤ 900 KB, CSS ≤ 60 KB) và **bỏ qua kèm cảnh báo** khi chưa build.

**E2E bản Normal (tuỳ chọn, ngoài `pnpm test`)** — `apps/normal-web/e2e/` chạy bằng `pnpm e2e:normal`, cần `pnpm build:normal` và `playwright install chromium`:
- `webServer` = `node apps/normal-server/scripts/e2e-server.mjs`: esbuild bundle `src/e2e-entry.ts` (chính `buildApp` production) ra `apps/normal-server/.e2e/server.mjs` — **không** phải `dist/`, vì bundle production bị chặn không được chứa PGlite — rồi chạy nó trên `127.0.0.1:8091` với PGlite trong tiến trình và `PUBLIC_DIR` trỏ vào `apps/normal-web/dist`. Hai project `desktop` (1440×900) và `mobile` (375×812), một worker, `vi-VN` + `Asia/Ho_Chi_Minh`.
- Kịch bản: đăng ký → sảnh → **đăng xuất rồi đăng nhập lại** (phiên chỉ là cookie) → tạo phòng Blind (2 lá, chơi/bỏ, cược 1.000, 1 bot) → ngồi, sẵn sàng, bắt đầu → chơi → phiếu kết quả; rồi tiến độ `blind_hands_10` phải là 1/10. Test thứ hai: điểm danh (biên nhận khớp `GET /api/me`), đổi màu tóc → lưu → tải lại → mở bằng **context khác** để thấy khuôn mặt đã lưu. Test `@mobile`: rail đủ bốn tab trong 375 px và không cuộn ngang, bàn ở bố cục stack, trang hồ sơ không cuộn ngang.
- Bất biến tiền kiểm bằng **ba nguồn độc lập**: số dư trước/sau từ `GET /api/me`, phí + tiền thắng đọc trên phiếu kết quả, và sổ điểm `GET /api/me/ledger`. Ràng buộc được viết ra: `Δ số dư = tiền thắng + phần cược dư hoàn lại − tiền đã bỏ ra`; `pot = Σ tiền thắng + phí` phải rơi vào đúng hai giá trị luật cho phép (bot bỏ bài sau ante, hoặc bot theo); `phí = ⌊2% pot⌋`; tổng mọi dòng sổ = số dư hiện tại và đúng **một** dòng `settlement` khớp phiếu kết quả. (Không viết `Σ delta người + net bot + phí = 0` như Lite: chỉ có một người thật nên net của bot phải suy ra từ chính phiếu kết quả, và đẳng thức rút về `0 = 0` — một assertion không bao giờ hỏng còn tệ hơn không có.)
- Ảnh chụp màn hình (đăng nhập, sảnh, bàn, phiếu kết quả, điểm danh, ảnh đại diện, thành tựu, hồ sơ — cả desktop lẫn 375×812) rơi vào `apps/normal-web/e2e/screenshots/`, không commit.

### 29.5 Lite
SQLite repository + migrate `user_version`; khởi động server bundle trên cổng ngẫu nhiên, tạo session, tạo phòng qua WS; `test/footprint.test.ts` (chuỗi cấm, gzip JS/CSS, kích thước exe); `test/smoke.test.ts`: chạy `bind-poker-lite.exe --smoke` (cổng ephemeral, database vào thư mục tạm), đọc JSON `/health` trên stdout, kiểm mã thoát.

**E2E (tuỳ chọn, ngoài `pnpm test`)** — `apps/lite/e2e/` chạy bằng `pnpm --filter @bp/lite e2e`, cần bản build và `playwright install chromium`:
- `webServer` = `node dist/server.cjs` (`PORT=8090`, `HOST=127.0.0.1`, `SQLITE_PATH=:memory:`, `PUBLIC_DIR=dist/public`); hai project `desktop` (1440×900) và `mobile` (375×812).
- Kịch bản: hai context vào bằng tên → tạo phòng Blind (2 lá, chơi/bỏ, cược 1.000, 1 bot) → vào bằng mã phòng → ngồi, sẵn sàng, bắt đầu → **tải lại trang giữa ván** (kiểm reconnect + cổng `roomStale`) → chơi/bỏ → phiếu kết quả.
- Bất biến tiền được kiểm bằng **hai nguồn độc lập**: số dư trước/sau từ `GET /api/me` (database) và phí bàn + tiền thắng đọc từ phiếu kết quả trên màn hình. `Σ delta người chơi + net của bot + phí = 0`, có tính phần cược dư được hoàn (`uncalledReturned`, §7.4), và `phí = ⌊2% pot⌋`.
- Ảnh chụp màn hình (name prompt, sảnh, bàn, điểm danh, cài đặt — cả desktop lẫn 375×812) rơi vào `apps/lite/e2e/screenshots/`, không commit.

### 29.6 Tách biệt kiến trúc
ESLint boundary; test đọc `package.json` từng package và kiểm graph mục 22.2; grep `edition` trong `packages/` phải rỗng.

## 30. Edge Cases

| Tình huống | Xử lý |
|---|---|
| Rớt mạng giữa lượt | Ghế DISCONNECTED, ván tiếp tục, hết timer → mặc định; reconnect 90 giây |
| Đóng trình duyệt | Như rớt mạng |
| Host rời | Chuyển host người vào sớm nhất; nếu đang ván, ván tiếp tục |
| Phòng trống | Xóa sau 60 giây; pot cộng dồn chia theo 8.4 |
| Phòng đầy | `ROOM_FULL` |
| Action trùng | `reqId` → trả lại kết quả cũ |
| Action sai lượt | `NOT_YOUR_TURN` |
| Cược sai | `INVALID_AMOUNT` kèm min/max hợp lệ |
| Timeout | Check/fold (Hold'em), fold (Blind B); 3 lần liên tiếp → đứng dậy |
| Hòa | Chia đều, chip lẻ theo vị trí |
| Side pot | Thuật toán tầng 7.4 |
| Kết nối trùng | Thay kết nối cũ |
| Server restart | Hủy ván, hoàn cược, stack về balance, thông báo |
| Lite bị tắt cứng trên Windows (`taskkill`, `schtasks /End`, `sc stop`, đóng cửa sổ) | Không có đường drain: số dư đã ghi vẫn đúng, nhưng chồng trên bàn (Hold'em và Blind, §8.8) và pot cộng dồn Blind B mất. Chỉ `--stop`, `Ctrl`+`C`/`Ctrl`+`Break`, hoặc NSSM (gửi Ctrl+C) mới tắt êm — §28.2 |
| `bind-poker.run.json` còn lại sau một lần tắt cứng | `--stop` phát hiện `pid` đã chết, xoá file (sau khi đối chiếu `pid`+`token`) và thoát `0`; lần khởi động sau ghi đè file |
| Tiến trình thứ hai trên cùng thư mục dữ liệu (server thứ hai, hay `--smoke`) | Server thứ hai từ chối khởi động kèm gợi ý `--stop`; `--smoke` không ghi run file. Run file của bản đang chạy không bị động tới |
| WS lỗi giữa gửi | Client backoff reconnect, RESYNC |
| Race giữa timer và action đến cùng lúc | Hàng đợi tuần tự; timer kiểm `handId` + `turnSeq` trước khi áp dụng |
| Bot thay người | Không thay; bot chỉ theo `botCount` |
| Người rời giữa ván Hold'em có cược trong pot | Fold; cược ở lại pot |
| Người thiếu blind | All-in phần có |
| Tất cả fold ở Blind B | Cộng dồn |
| Balance thay đổi ngoài ván (daily) trong khi ngồi bàn | Chỉ ảnh hưởng balance, không ảnh hưởng stack |
| Đổi tên trùng | `DISPLAY_NAME_TAKEN` |
| Hai người cùng SIT_DOWN một ghế | Hàng đợi tuần tự; người sau nhận `SEAT_TAKEN` |

## 31. Risks

| Rủi ro | Mức | Giảm thiểu |
|---|---|---|
| Node SEA còn thay đổi API giữa các bản Node | Trung bình | Ghim Node 22 LTS cụ thể; script build kiểm phiên bản; fallback: phát hành thư mục `node.exe + server.cjs` nếu SEA lỗi |
| SmartScreen/AV chặn exe chưa ký trên host nội bộ | Trung bình | Tài liệu hướng dẫn unblock; roadmap ký code |
| Sai luật side pot / min-raise | Cao (uy tín gameplay) | Test vector từ luật chuẩn, brute-force evaluator, bất biến bảo toàn điểm |
| Lạm phát điểm | Trung bình | Phí bàn, cứu trợ có trần, sổ cái để đo, tham số JSON |
| Reconnect phức tạp gây bug state | Cao | Snapshot đầy đủ thay vì replay; test integration chuyên biệt |
| `node:sqlite` còn experimental warning ở Node 22 | Thấp | Tắt warning bằng flag trong SEA config; nếu Node 24 ổn định hơn thì ghim 24 |
| Kích thước exe (~90 MB) | Thấp | Chấp nhận; ghi rõ |
| Phạm vi lớn, dễ lệch tiến độ | Cao | Milestone M0–M9, Lite lên trước để khóa core |

## 32. Assumptions

1. Poker variant: No-Limit Texas Hold'em; không ante; không dead-button.
2. Showdown lật đồng thời, không muck.
3. Phí bàn 2% là bể điểm được chấp nhận trong game điểm ảo.
4. Timeout: Hold'em check/fold; Blind B fold. 3 timeout liên tiếp → đứng dậy.
5. Blind B tất cả fold → pot cộng dồn.
6. Blind: tối đa 8 người; Hold'em tối đa 9.
7. Bot có ở cả hai mode; balance bot ảo không tính vào kinh tế.
8. Ván đang chơi không sống qua restart.
9. Ngày kinh tế theo `Asia/Ho_Chi_Minh`.
10. Lite: một phiên = một token trong trình duyệt; không mật khẩu; phiên không hết hạn.
11. Lite exe chỉ cho Windows x64; build trên máy dev Windows.
12. Không xác minh email; không quên mật khẩu ở MVP.
13. Tên hiển thị duy nhất trong hệ thống (mỗi edition độc lập).
14. Cứu trợ 1 lần/24 giờ, đưa về 5.000.
15. Tiếng Việt là ngôn ngữ mặc định khi không xác định được.
16. Lite: giao diện web được nhúng thẳng vào exe (SEA asset) và đọc bằng `sea.getAsset()`; khi dev thì server đọc thư mục `dist/public` (ghi đè bằng `PUBLIC_DIR`). Không có chế độ nào server tự đi tải asset.
17. `SIT_OUT` có hiệu lực từ **ván kế tiếp**: ván đang chơi vẫn chơi hết. Bộ đếm đứng dậy tự động đếm **ván được chia**, không đếm thời gian thực — nên trên bàn hai ghế mà một người ngồi ngoài thì không ván nào bắt đầu, không ván nào bị bỏ, và ghế được giữ cho tới khi người đó rời hoặc phòng đóng vì trống (`emptyRoomCloseMs`). Trường hợp bỏ bàn do đó thuộc về đường đóng-phòng-trống, không thuộc bộ đếm sit-out (§11.3).
18. Không đóng gói web font: `--font-display` **đặt tên** một face rồi rơi về Cambria / Constantia / Segoe UI. Giả định là mọi host mục tiêu (Windows với Lite; trình duyệt hiện đại với Normal) có ít nhất một trong ba, và cả ba đều đủ glyph tiền tổ hợp tiếng Việt. Việc đóng gói một bản subset nằm ở roadmap mục 9.
19. Ghế Blind hiện **chồng trên bàn** như Hold'em, không phải số dư thật (§8.8, sửa đổi 2026-09-29): số dư của người chơi không bị công khai ở cả hai chế độ. Trước đó Blind công khai số dư của mọi ghế vì ghế *chính là* số dư — hạn chế đó đã hết và được gỡ khỏi `docs/known-limitations.md`.
20. Avatar SVG vẽ trong app (Phụ lục A) là bản **tạm**. Bản thay thế 3D có đặc tả riêng — `2026-09-05-avatar-3d-design.md` — và nằm ngoài phạm vi tài liệu này.

## 33. MVP Scope

**MUST**: Core Hold'em; Blind 2/3 lá kiểu A/B; room; realtime + reconnect; bot Blind; điểm + phí bàn + cứu trợ; daily reward; basic player/session; Normal edition (auth, Postgres); Lite edition (exe, SQLite); en + vi; responsive; test core/integration; deploy docs.

**SHOULD** (làm trong M7–M8): achievement; avatar; inventory; thống kê đầy đủ; bot Hold'em; lịch sử ván.

**COULD** (roadmap): chat, emote, spectator, leaderboard, replay, shop đổi điểm, bot nâng cao.

**WON'T**: tiền thật, cash-out, marketplace, NFT, blockchain, ML AI, mạng xã hội.

**Tình trạng sau M9 (Plan 7).** Toàn bộ MUST và toàn bộ SHOULD đã giao — bằng chứng từng mục ở `docs/acceptance-checklist.md`. Không mục COULD nào được làm; tất cả vẫn ở roadmap mục 4. `SIT_OUT`/`SIT_IN` là thứ duy nhất được thêm ngoài hai danh sách trên: nó không có trong MVP scope ban đầu nhưng cần cho §11.3 và cho chính bảng kiểm §30, nên được đưa vào M9.

## 34. Future Roadmap

1. Shop đổi điểm lấy cosmetic (bể điểm bổ sung) khi số liệu cho thấy lạm phát.
2. Quên mật khẩu qua email; xác minh email; đăng nhập Google (module riêng trong normal-server).
3. Ký code exe Lite; bản Linux binary.
4. Leaderboard tuần/tháng; spectator; chat trong phòng (lightweight protocol).
5. Lưu ván qua restart (event sourcing nhẹ theo phòng).
6. Đa tiến trình Normal với sticky routing theo phòng.
7. Bot Hold'em có mô hình đối thủ đơn giản.
8. PIN tùy chọn cho phiên Lite.
9. Đóng gói sẵn một web font tiếng Việt đã subset trong `@bp/ui-kit` (hiện chỉ *đặt tên* font và rơi về Cambria/Constantia/Segoe UI — đủ phủ tiếng Việt trên Windows, vốn là host duy nhất của Lite). Cần tải file font lúc build và một công cụ subset, nên để lại roadmap.
10. Tách `--red` thành ink và fill như `--teal`/`--teal-fill`: một token không thể vừa đạt 4.5:1 làm chữ trên nền tối vừa đủ tối để `--red-ink` đọc được trên nó. Năm mục dưới chuẩn AA, phủ ba cặp token khác nhau — `--red` trên `--bg` (3.59:1) và trên `--bg-elev` (3.22:1) ở **cả** palette dark lẫn night (bốn mục), cộng cùng khuyết tật đó lặp lại trên nền felt riêng của `.panel.felt` (3.13:1) — được ghi nhận trong `tokens.test.ts` (`BELOW_AA`) và `docs/ui-kit.md` — Known gaps. Test đỏ nếu một cặp tệ đi, hoặc nếu một cặp được sửa mà dòng ghi nhận bị bỏ quên.
11. ~~Avatar 3D cho bản Normal~~ — **đã làm (Plan 8)**, theo `2026-09-05-avatar-3d-design.md`: three.js, chân dung dựng ở máy người chơi, catalog v2 theo `slot` + `variants[body]`. Bộ SVG của Plan 6 đã gỡ. Còn lại cho sau: animation idle, biểu cảm, bộ trang phục hiện đại/theo mùa (§10 của đặc tả ấy).
12. Nâng Vitest 2 → 3 và Vite 5 → 6 trên cả tám package, để dọn 7 advisory chỉ-dev còn lại. Không dùng override cho `vite` transitive dưới Vitest: làm thế là ghim một phiên bản Vitest 2 không được build cùng, đổi một advisory chỉ-dev lấy một test runner hỏng. Chi tiết và disposition từng advisory ở `docs/security.md` §2.
13. Chạy một lần suite của `normal-server` với `TEST_DATABASE_URL` trỏ vào PostgreSQL thật, và build ảnh Docker của bản Normal — hai việc chưa làm được trên máy dev vì không có Docker daemon (`docs/known-limitations.md`, `docs/deployment-normal.md` §2).

---

## Phụ lục A — Decision Log

| Decision | Reason | Alternative considered | Trade-off |
|---|---|---|---|
| TypeScript toàn bộ, monorepo pnpm | Core dùng chung server + client, một ngôn ngữ, requirement viết TS | Go backend + TS frontend | Mất chia sẻ types/validation; Node đủ hiệu năng cho quy mô |
| Fastify + `ws` (native WebSocket) | Nhẹ, protocol tự định nghĩa đã có reconnect/ack; bundle Lite nhỏ | Socket.IO | Mất fallback long-polling và rooms sẵn; không cần với trình duyệt hiện đại |
| React + Vite, không Next.js | Không cần SSR; entry riêng cho Lite dễ; bundle kiểm soát được | Next.js, Svelte | Svelte nhỏ hơn nhưng ít quen thuộc; Next thêm runtime không cần |
| PostgreSQL + Drizzle | Migration SQL rõ, type-safe, nhẹ | Prisma | Prisma engine binary nặng, không phù hợp tinh thần nhẹ |
| `node:sqlite` cho Lite | Không module native, SEA đóng gói được | better-sqlite3 | Mất một số API tiện; đổi lại cài đặt zero-dependency |
| Node SEA → một exe | Host không có Node.js, Windows | pkg, nexe, Docker | pkg không còn duy trì; Docker không có trên host |
| Blind Poker hai kiểu A/B theo config | Người dùng chọn; cùng engine tham số hóa | Chỉ B | A phục vụ ván nhanh thuần may rủi đúng tinh thần 3 cây |
| Blind dùng 5 lá chung, 5 lá tốt nhất | Người dùng chọn; dùng chung evaluator với Hold'em | 3+2 đúng 5 lá | Bản 3 lá dùng 8 lá, evaluator vẫn 56 tổ hợp |
| Phí bàn 2% làm bể điểm | Kinh tế zero-sum cần bể; đơn giản, đo được | Không bể; shop | Không bể → lạm phát; shop nhiều việc hơn, để roadmap |
| Pot cộng dồn khi tất cả fold | Giữ chi phí fold, tạo kịch tính, đơn giản | Hoàn ante | Hoàn ante làm fold miễn phí, bot/người luôn fold bài xấu không mất gì |
| Reducer thuần, timer ngoài core | Test deterministic, core không I/O | Engine tự quản timer | Server-kit phải gửi lệnh nhịp; đổi lại test dễ và tái lập |
| Snapshot + delta với `seq`, RESYNC | Đơn giản, chịu mất gói | Replay event log đầy đủ | Snapshot tốn băng thông hơn khi resync nhưng hiếm |
| Domain event bus nội bộ cho stats/achievement | Server-kit không biết Normal | Gọi trực tiếp | Event bus thêm một lớp gián tiếp nhỏ |
| Lite trước Normal trong milestone | Chứng minh core/server-kit độc lập sớm | Normal trước | Trì hoãn UI đầy đủ vài tuần |
| Không lưu ván qua restart | YAGNI, phức tạp cao | Event sourcing | Ván bị hủy khi deploy; hoàn tiền đầy đủ nên không mất điểm |
| Normal chạy `node-postgres` + Drizzle, test chạy **PGlite** trong tiến trình | Cùng một `AppDb` (kiểu `PgDatabase` trung tính driver) cho cả hai, nên query của test là query của production; toàn bộ suite chạy được mà không cần một server Postgres nào | Testcontainers; một database Postgres dùng chung cho CI | Testcontainers cần Docker daemon trên mọi máy dev; DB dùng chung thì test không song song được. Đổi lại: đường `pg` thật chỉ được chạy khi có `TEST_DATABASE_URL`, và khác biệt PGlite ↔ Postgres (nếu có) chỉ lộ ra ở đó |
| argon2id `m=64MiB, t=3, p=1` | Khuyến nghị OWASP cho argon2id; ~100 ms/lần trên phần cứng mục tiêu, đủ chậm để brute-force không kinh tế và đủ nhanh để không thành DoS tự gây | bcrypt; argon2 tham số nhẹ hơn | Native addon (phải biên dịch hoặc có prebuild musl trong image); một đợt đăng ký đồng thời tốn RAM đáng kể — nên test truyền tham số nhẹ qua `argon2Params` |
| Tách `@bp/http-kit` khỏi hai edition | `.env`, JSON logger, rate limiter, static asset, security header, CSRF guard, error envelope là **giống hệt** ở Lite và Normal; hai bản sao sẽ trôi khỏi nhau đúng ở phần bảo mật | Để nguyên trong Lite rồi Normal copy sang | Thêm một package và một ranh giới phải giữ (ESLint chặn http-kit import bất kỳ package workspace nào) |
| Id phiên = `hex(HMAC-SHA256(SESSION_SECRET, token))`, xoay id khi login | Bảng `sessions` không chứa thứ gì đăng nhập được: đọc trộm database không ra token, và người ghi được row cũng không tự chế được id cho một token họ chọn nếu không có secret. Xoay id khi login vô hiệu hóa session fixation | Lưu token băm SHA-256 như Lite; JWT không trạng thái | Đổi `SESSION_SECRET` là đăng xuất tất cả (đúng ý muốn, nhưng phải nói rõ trong tài liệu vận hành). JWT thì không revoke được |
| Dòng sink trong `point_transactions` dùng `reason = kind` | Bất biến tiền §18.4 đọc được từ **một** bảng: `Σ balance + Σ dòng player_id NULL`. Lite tách bảng `sinks` vì nó không có ledger; Normal có rồi thì bảng thứ hai chỉ là một chỗ nữa để lệch | Bảng `sinks` riêng như Lite | `reason` mang hai nghĩa tùy theo `player_id` NULL hay không; bù lại có CHECK `player_id is not null or kind is not null` để không tồn tại dòng mồ côi bị đếm nhầm thành sink |
| Phiên của web Normal **chỉ** là cookie, không token | Cookie `HttpOnly` không đọc được bằng JS nên XSS không mang phiên đi được; WebSocket dùng chính cookie đó lúc upgrade nên không có credential thứ hai, không có token trên query string, và không có khoảng thời gian socket mở mà chưa biết là ai. Đổi lại client phải hỏi `GET /api/auth/me` một lần lúc boot, vì nó không tự đọc được phiên của mình | Bearer token trong `localStorage` như Lite; token riêng cho WebSocket | Cần CSRF guard (`X-Requested-With`) cho mọi request thay đổi dữ liệu, và phiên chết trên socket trông y hệt mạng kém — nên gate phải dò lại bằng REST sau 10 s reconnect (`RECONNECT_PROBE_MS`) |
| ~~Avatar là SVG vẽ trong app~~ → **nhân vật 3D** (Plan 8) | SVG sáu lớp của Plan 6 không đổi được *hình dáng* — đổi giới tính, kiểu tóc hay trang phục chỉ đổi vài path phẳng. Plan 8 thay bằng nhân vật 3D thật, đặc tả riêng `2026-09-05-avatar-3d-design.md` | Giữ SVG và vẽ thêm part; thuê vẽ bộ vector đầy đủ | Bộ vector SVG (`avatar/parts.tsx`, `Avatar.tsx`, `PartThumb.tsx`) đã bị gỡ. Đổi lại phải tải một chunk three.js 150 KB gzip và ~0,9 MB `.glb`, cả hai lazy |
| Tài sản 3D là **CC0 Quaternius**, bản Standard miễn phí | Người dùng chọn: không thuê vẽ. CC0 nghĩa là không có nghĩa vụ ghi công, không có giấy phép phải theo dõi, và bộ Universal Base Characters + Modular Character Outfits phủ được thân nam/nữ, tóc và hai bộ trang phục | Thuê modeler; mua bản Source (trả phí) của cùng bộ; Ready Player Me | Bản miễn phí chỉ có 5 kiểu tóc và 2 bộ đồ mỗi thân, nên phần lớn catalogue là **xấp xỉ** (`docs/known-limitations.md`); và hai bộ không được dựng cho nhau, nên build phải nắn + bọc quần áo lên thân |
| **three.js**, không Babylon, không dựng phía server | Nhỏ hơn khi tree-shake, `GLTFLoader` + `MeshoptDecoder` có sẵn, và toàn bộ đồ họa nằm sau **một** `import()` nên bundler tách đúng một chunk mà test footprint gọi tên được | Babylon.js; dựng ảnh ở server rồi phát PNG | Dựng ở server sẽ cần GPU/headless GL trên máy chủ và một chỗ lưu ảnh; đổi lại máy yếu sẽ nhẹ hơn. Hiện máy không có WebGL rơi về chữ cái đầu tên |
| Ảnh chân dung dựng ở **máy người chơi**, cache theo hash cấu hình | Không upload, không lưu ảnh trên server, không có endpoint phát ảnh phải bảo vệ. Một `WebGLRenderer` ẩn + hàng đợi tuần tự vẽ mọi ảnh trong app; khóa cache là `hashConfig(config)` nên cùng một cấu hình cho cùng một ảnh ở mọi trình duyệt | Server dựng và CDN hóa; dựng lại mỗi lần hiện | Lần đầu trên máy lạnh mất ~3,4 s (chunk + `.glb`), trong lúc đó là chữ cái đầu tên. Sau đó IndexedDB giữ 200 ảnh theo LRU |
| Catalog item v2: `slot` + `variants[body]` | Một item phải tồn tại cho **cả hai thân**, và thân đổi được tự do; `variants` là chỗ duy nhất nói item đã được dựng cho thân nào, nên server từ chối được cấu hình mặc món chưa có biến thể | Hai catalogue riêng cho nam/nữ; một item chỉ hợp một thân | Migration v1→v2 phải đổi `category` → `slot`, gỡ `base`/`face`, và cấp item mặc định mới cho mọi tài khoản. Cột DB vẫn tên `items.category` |
| `.glb` nén **meshopt**, và CSP phải mở `'wasm-unsafe-eval'` | Giữ skin (`JOINTS_0`/`WEIGHTS_0`) để đứng được tư thế thì `outfits.glb` ở dạng quantize thường chiếm 97 % ngân sách mỗi tệp; meshopt đưa cả bộ từ 2,3 MB xuống 0,9 MB | `--no-meshopt` (KHR_mesh_quantization, three.js đọc thẳng); bỏ skin và ship sẵn tư thế đứng | Bộ giải nén là WebAssembly, nên `default-src 'self'` một mình chặn nó và mọi ảnh im lặng rơi về chữ cái đầu tên. `'wasm-unsafe-eval'` chỉ mở WebAssembly, không mở `eval()` — xem §19.2 và `docs/security.md` |
| `captionFor` là một slot của ui-kit, không phải logic trong kit | Danh hiệu và huy hiệu là khái niệm **chỉ** bản Normal có; kit không được biết đến `items.json` hay namespace i18n của app. Slot giữ ranh giới "kit chỉ phụ thuộc `@bp/core`" nguyên vẹn, và Lite truyền `undefined` là xong | Kit tự đọc title/badge từ state phòng; hard-code chuỗi trong kit | Mỗi edition tự lo dịch chuỗi của mình; app phải nhớ truyền cả `avatarFor` lẫn `captionFor` cho `RoomScreen` |

## Phụ lục B — Bảng kiểm chấp nhận (mục 40 & 66 requirement)

Bảng kiểm sống ở **[`../../acceptance-checklist.md`](../../acceptance-checklist.md)**, không sao chép lại ở đây — hai bản sao của cùng một bảng sẽ lệch nhau đúng ở chỗ quan trọng nhất.

**Đã hoàn thành ở M9 (Plan 7).** Cả 64 mục — 21 mục của requirement.txt §40 và 43 mục của §66 — đều đã được đối chiếu: **61 ✓, 3 partial, 0 ✗**. Mỗi dòng dẫn tới một test (đường dẫn tệp + tên `it()` nguyên văn), một bước e2e, hoặc một bước kiểm thủ công kèm kết quả mong đợi.

Ba dòng `partial` và lý do:

| Dòng | Lý do |
|---|---|
| 40.8 Normal builds successfully | Bản build Node được test chạy thật; **ảnh Docker chưa từng được build** vì máy dev không có Docker daemon. Tiền kiểm ở `docs/deployment-normal.md` §2 |
| 66.21 Persistent database works | Toàn bộ suite chạy trên PGlite; đường `pg` thật và `SELECT … FOR UPDATE` chỉ thực thi khi có `TEST_DATABASE_URL` |
| 66.40 Security checks pass | `pnpm audit --prod` sạch; `pnpm audit` đầy đủ còn 7 advisory, tất cả thuộc gói chỉ dùng khi build/test — `docs/security.md` §2 |

Bảng kiểm không tự mục nát được: `tooling/arch/acceptance-links.test.ts` đọc chính tệp markdown đó và kiểm rằng mọi tệp test được trích dẫn có thật, mọi tên test được trích dẫn nằm trong tệp đó, mọi dòng có đúng một trong ba trạng thái, và đủ cả 21 + 43 mục. Đổi tên một test mà quên sửa bảng thì `pnpm test` đỏ.

Danh sách hạn chế đã biết — gồm cả ba dòng trên — ở `docs/known-limitations.md`. Lịch sử theo từng plan ở `CHANGELOG.md`.
