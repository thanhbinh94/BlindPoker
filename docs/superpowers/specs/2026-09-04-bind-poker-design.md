# Bind Poker — Software Requirement Specification & Thiết kế hệ thống

- Ngày: 2026-09-04
- Trạng thái: Bản thiết kế đã được duyệt qua brainstorming, chờ duyệt spec
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
| `maxPlayers` | 2–8 |
| `botCount` | 0 … maxPlayers − 1 |
| `turnTimer` | 10/15/30 giây, mặc định 15 (chỉ dùng cho pha DECISION) |

### 8.2 Điều kiện tham gia ván
- Kiểu A: balance ≥ W. Kiểu B: balance ≥ 2W (đủ ante + Play).
- Người không đủ điều kiện ngồi ngoài ván đó (trạng thái `SITTING_OUT`), vẫn ở ghế.
- Cần ≥ 2 người đủ điều kiện (bot tính là người), ngược lại về `WAITING`.

### 8.3 Luồng ván
1. `STARTING`: dealer marker chuyển ghế kế tiếp (chỉ ảnh hưởng thứ tự chia bài và chip lẻ). Mỗi người đủ điều kiện bị trừ W vào pot. Nếu có pot cộng dồn từ ván trước, cộng vào pot.
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
- Khi phòng đóng hoặc không còn ≥ 2 người đủ điều kiện trong 60 giây: chia đều cho những người còn ngồi ghế và đủ điều kiện ở ván gần nhất; phần dư không chia được ghi `table_fee`.

### 8.5 Bot trong Blind Poker
- Bot ngồi từ khi tạo phòng theo `botCount`, luôn ready, không đếm là host.
- Balance bot ảo (RAM) khởi đầu 1.000.000, tự nạp lại khi < 2W; không ghi vào kinh tế người chơi.
- Kiểu A: bot không có quyết định. Kiểu B: xem mục 9.

### 8.6 Hàng ranking
Như mục 7.7.

### 8.7 Timer và hành động mặc định
- Chỉ pha `DECISION` có timer. Hết giờ = `fold`.
- 3 timeout liên tiếp → đứng dậy sau ván (như Normal).

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
- `threshold = 6 + 0.8 × (số đối thủ − 1)`; `score = chen + N(0, 1.5)` (nhiễu ngẫu nhiên); `play` nếu `score ≥ threshold`, ngược lại `fold`.
- Nếu `carryOverPot > 4W` giảm threshold 1,5 (pot lớn đáng theo).
- Kỳ vọng: bot play ~55–65% với 2 đối thủ, ~40% với 7 đối thủ.

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
Server kiểm tra từng giá trị thuộc tập cho phép; sai → `ERROR INVALID_ROOM_CONFIG`.

### 11.3 Ghế và trạng thái người trong phòng
- Vào phòng = là "người xem trong phòng" (không ghế). `SIT_DOWN{seat, buyIn?}` chiếm ghế (Hold'em kèm buy-in; Blind không). `STAND_UP` rời ghế.
- Trạng thái ghế: `EMPTY`, `SEATED`, `READY`, `IN_HAND`, `FOLDED`, `ALL_IN`, `SITTING_OUT`, `DISCONNECTED`.
- Ready chỉ có ý nghĩa ở `OPEN`; khi ván bắt đầu tất cả ghế `READY` vào ván.

### 11.4 Host
- Người tạo phòng là host. Quyền: Start, kick người chưa vào ván, đóng phòng khi `OPEN`.
- Host rời (hoặc quá cửa sổ reconnect) → host = người có `joinedAt` sớm nhất còn trong phòng. Bot không thể là host.

### 11.5 Mã phòng
6 ký tự `[A-Z2-9]` bỏ ký tự dễ nhầm, sinh ngẫu nhiên, duy nhất trong tiến trình.

## 12. Economy

### 12.1 Nguyên tắc
Điểm giữa người chơi là zero-sum; nguồn duy nhất là hệ thống (daily, achievement, cứu trợ), bể duy nhất là phí bàn và bot thắng. Mọi thay đổi balance đi qua `BalanceRepository.applySettlement` với `reason`.

### 12.2 Tham số (JSON `economy.json`, chung cả hai edition; Normal đọc thêm phần item)
| Tham số | Giá trị |
|---|---|
| `startingBalance` | 100.000 |
| `tableFeeRate` | 0,02 |
| `tableFeeCapHoldemBB` | 1 |
| `reliefThreshold` / `reliefTarget` / `reliefCooldownHours` | 5.000 / 5.000 / 24 |
| `blindWagerTiers` | 1k, 2k, 5k, 10k, 20k, 50k |
| `holdemBlindTiers` | 100/200, 250/500, 500/1k, 1k/2k, 2.5k/5k |

### 12.3 Phí bàn
Hold'em: `min(floor(totalPot × 0,02), 1 BB)`. Blind: `floor(pot × 0,02)`. Không thu khi pot cộng dồn (chưa kết thúc). Ghi `table_fee`.

### 12.4 Cứu trợ
`POST /api/economy/relief` (cả hai edition, REST — không nằm trong protocol gameplay): nếu `balance < 5.000` và `lastReliefAt` cách ≥ 24 giờ → balance = 5.000, ghi `relief`.

### 12.5 Ước lượng cân bằng
- Người chơi đều: 30 ván Blind 5k/ngày, pot trung bình 15k → phí ≈ 300 × 30 = 9.000/ngày ở trần, thực tế 3.000–6.000. Daily trung bình 12.500 → dòng ròng +6.000 ÷ +9.000/ngày, tương đương 1–2 mức cược thấp. Chấp nhận: người chơi đều có tiến độ cảm nhận được, nhưng không "in tiền".
- Người chơi nhiều (200 ván/ngày) phí ≈ 20.000–40.000 → âm nhẹ, phải thắng để giữ điểm.
- Theo dõi: `SELECT reason, SUM(amount) FROM point_transactions WHERE created_at >= now() - interval '1 day' GROUP BY reason`. Nếu tổng nguồn > 1,5 × tổng bể trong 30 ngày liên tục → nâng `tableFeeRate` lên 0,03 hoặc mở shop đổi điểm (roadmap).

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

Tổng tối đa 376.000/tháng. Nếu không còn item chưa sở hữu ở bậc đó → thay bằng 10.000 điểm.

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
- Module `achievement` lắng nghe `StatsUpdated{playerId, changedMetrics}`; với mỗi def có metric thay đổi và chưa unlock: nếu `stats[metric] ≥ threshold` → ghi `player_achievements`, cộng thưởng qua `applySettlement(reason='achievement')`, thêm item, phát `AchievementUnlocked` tới client qua WS message `NOTIFICATION` (lightweight).
- `best_hand_rank` là metric số (category index 0–9) nên "special hand" dùng ngưỡng: flush=5, full house=6, quads=7, straight flush=8, royal=9.

### 14.2 Danh mục khởi đầu (28)
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

Thêm achievement = thêm dòng JSON. Thêm metric = thêm cột `player_stats` + logic đếm trong module stats.

## 15. Avatar / Inventory (Normal-only)

### 15.1 Mô hình
- Avatar = tổ hợp lớp SVG theo category, thứ tự vẽ: `base` → `face` → `clothing` → `hair` → `accessory` → `jewelry`. `hairColor` là thuộc tính của lớp hair (CSS variable).
- `items` seed từ `items.json`: `{ id, category, rarity: 'common'|'rare'|'epic', nameKey, assetKey, isDefault }`. Khoảng 40 item khởi đầu; item `isDefault` cấp cho mọi tài khoản mới.
- `title` và `badge` cũng là item (category `title`, `badge`), hiển thị cạnh tên trên bàn.
- `avatar_config`: `{ base, face, clothing, hair, hairColor, accessory?, jewelry?, title?, badge? }`, server kiểm tra mọi id trong inventory trước khi lưu.
- Nguồn item: daily (7/14/21/28), achievement. Không có shop ở MVP.
- Trên bàn, người khác nhận `avatarConfig` (≈ 100 byte); `normal-web` render bằng component `Avatar`. Lite không có component này, `Seat` hiển thị chữ cái đầu tên.

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
- `ACTION{reqId, baseSeq, action}`: server từ chối `STALE_STATE` nếu `baseSeq < currentSeq` **và** state đã đổi lượt kể từ đó (cho phép baseSeq cũ nếu vẫn cùng lượt để tránh từ chối oan do event phụ như PLAYER_JOINED). Server nhớ 32 `reqId` gần nhất mỗi kết nối; trùng → trả lại kết quả cũ, không áp dụng lại.

### 16.5 Heartbeat
Server gửi `PING` mỗi 15 giây; không nhận `PONG` trong 30 giây → đóng socket → xử lý như disconnect. Client: 3 lần không nhận PING trong 45 giây → tự đóng và reconnect với backoff 1, 2, 4, 8 giây (tối đa 30 giây).

### 16.6 Disconnect / Reconnect
- Socket đóng → `ReconnectTracker` đặt hạn 90 giây (`RECONNECT_WINDOW_SEC`), ghế → `DISCONNECTED`, phát `PLAYER_DISCONNECTED`. Ván tiếp tục; tới lượt hết timer → hành động mặc định.
- Kết nối lại với cùng session trong hạn → gắn vào ghế, phát `PLAYER_RECONNECTED`, gửi snapshot.
- Quá hạn → đánh dấu `LEAVING`; khi ván kết thúc (hoặc ngay nếu không trong ván): đứng dậy, stack về balance, ghế trống; giữ trong phòng 5 phút với vai "người xem" để nếu quay lại còn thấy phòng; sau đó rời phòng.
- Kết nối mới cùng session khi kết nối cũ còn sống → cũ nhận `SESSION_REPLACED` rồi đóng, mới nhận snapshot.

### 16.7 Server shutdown
`SIGTERM`/`SIGINT` → dừng nhận kết nối mới → với mỗi phòng đang `IN_GAME`: hủy ván, hoàn mọi cược trong ván về stack, pot cộng dồn chia đều → mọi stack về balance → `applySettlement` → gửi `ERROR SERVER_SHUTDOWN` → đóng socket → thoát. Tối đa 10 giây.

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
```
Reducer thuần, không đồng hồ: nhịp lật bài và timeout là lệnh do server-kit gửi. Điều này khiến mọi kịch bản test là danh sách lệnh → so sánh state/events.

### 17.3 Events
`HAND_STARTED{handId, button, blinds|wager, carryOver}`, `CARDS_DEALT{seat, cards}` (riêng từng người; người khác nhận `cardCount`), `BLINDS_POSTED`, `DECISION_PHASE{deadlineAt}`, `TURN_CHANGED{seat, legal, deadlineAt}`, `PLAYER_ACTED{seat, action, amount}`, `DECISIONS_REVEALED{seat→play|fold}`, `COMMUNITY_REVEALED{cards}`, `POT_UPDATED{pots}`, `SHOWDOWN{hands: {seat, cards, rank, label}}`, `SETTLEMENT{payouts, fee, carryOver}`, `HAND_COMPLETE{nextHandAt?}`, `HAND_CANCELLED{reason}`.

## 18. Database

### 18.1 Interface (server-kit)
```ts
interface PlayerRepository {
  findById(id: string): Promise<PlayerRecord | null>
  updateProfile(id: string, patch: Partial<Pick<PlayerRecord,'displayName'>>): Promise<void>
}
interface BalanceRepository {
  get(playerId: string): Promise<number>
  applySettlement(entries: { playerId: string; delta: number; reason: TxReason; refId?: string }[]): Promise<void> // 1 transaction, từ chối nếu balance âm
}
interface SessionRepository { create(playerId): Promise<SessionRecord>; findValid(id): Promise<SessionRecord|null>; revoke(id): Promise<void> }
interface GameHistoryRepository { recordHand(summary: HandSummary): Promise<void> }
```

### 18.2 Normal — PostgreSQL 16, Drizzle ORM, migration SQL trong `apps/normal-server/drizzle/`
```sql
users(id uuid pk, email citext unique, password_hash text, created_at, last_login_at)
players(id uuid pk fk users, display_name varchar(20) unique, balance bigint check>=0, avatar_config jsonb,
        equipped_title text, equipped_badge text, last_relief_at, created_at)
sessions(id text pk, user_id fk, expires_at, user_agent, created_at)
point_transactions(id bigserial pk, player_id fk, amount bigint, reason text, ref_id text, created_at) -- index (player_id, created_at), (reason, created_at)
games(id uuid pk, mode text, config jsonb, started_at, ended_at)
game_players(game_id fk, player_id fk, seat int, net_result bigint, best_hand text, pk(game_id, player_id))
items(id text pk, category text, rarity text, name_key text, asset_key text, is_default bool)
inventory(player_id fk, item_id fk, source text, acquired_at, pk(player_id, item_id))
player_achievements(player_id fk, achievement_id text, progress bigint, unlocked_at, pk(player_id, achievement_id))
daily_logins(player_id pk fk, month char(7), streak int, last_claim_date date, claimed_days int)
player_stats(player_id pk fk, ...bộ đếm mục 10.3..., updated_at)
```
`games`/`game_players` ghi một dòng mỗi ván đã settlement (không ghi ván bị hủy). Không có bảng rooms.

### 18.3 Lite — SQLite (`node:sqlite`), WAL mode, `PRAGMA user_version` để migrate
```sql
players(id text pk, display_name text unique collate nocase, session_token_hash text unique, balance integer check>=0,
        hands_played integer, hands_won integer, streak integer, last_daily_claim text, last_relief_at text, created_at text)
hand_log(id integer pk, hand_id text, mode text, summary text, created_at text)  -- chỉ ghi khi LITE_HAND_LOG=1
```
`SessionRepository` của Lite: token = 32 byte ngẫu nhiên base64url; DB lưu SHA-256 của token; phiên không hết hạn (mạng nội bộ), có thể xóa bằng lệnh admin (roadmap).

### 18.4 Bất biến dữ liệu
- `balance ≥ 0` do DB ép; `applySettlement` chạy trong transaction và kiểm tra trước khi ghi.
- Stack trong RAM ⇔ đã trừ balance; mọi đường thoát (đứng dậy, rời, timeout, shutdown) đều trả stack.

## 19. API (REST)

Prefix `/api`. JSON. Lỗi: `{ error: { code, message } }`. Mutating request yêu cầu header `X-Requested-With: bind-poker`.

### 19.1 Chung
| Method | Path | Mô tả |
|---|---|---|
| GET | `/health` | `{ status, uptime, db: ok }` (Normal kiểm tra DB) |
| GET | `/api/config` | Tham số công khai: bậc cược, giới hạn phòng, edition, ngôn ngữ hỗ trợ |

### 19.2 Normal
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/auth/register` | `{email, password, displayName}` → tạo user + player + inventory mặc định, set cookie |
| POST | `/api/auth/login` | `{email, password}` → cookie; rate-limit 5/phút/IP+email |
| POST | `/api/auth/logout` | Hủy session |
| GET | `/api/me` | Profile + balance + stats tóm tắt |
| PATCH | `/api/me` | `{displayName}` |
| PUT | `/api/me/avatar` | `avatar_config` (kiểm tra sở hữu) |
| GET | `/api/me/stats` | `player_stats` |
| GET | `/api/me/inventory` | Item sở hữu |
| GET | `/api/me/achievements` | Định nghĩa + progress + unlocked |
| GET | `/api/me/history?limit=` | 20 ván gần nhất |
| GET | `/api/rewards/daily` | Streak, hôm nay đã nhận chưa, phần thưởng hôm nay/mai |
| POST | `/api/rewards/daily/claim` | Nhận thưởng |
| POST | `/api/economy/relief` | Cứu trợ |

### 19.3 Lite
| Method | Path | Mô tả |
|---|---|---|
| POST | `/api/session` | `{displayName}` → `{playerId, sessionToken}` (lần đầu) |
| GET | `/api/me` | Header `Authorization: Bearer <token>` → profile, balance, stats tối giản |
| GET | `/api/rewards/daily` · POST `/api/rewards/daily/claim` | Chỉ điểm |
| POST | `/api/economy/relief` | Cứu trợ |

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
| `READY` | `{ ready: boolean }` | |
| `START_GAME` | — | Host |
| `KICK` | `{ playerId }` | Host, chỉ người chưa trong ván |
| `ACTION` | `{ reqId, baseSeq, action: { kind: 'fold'|'check'|'call'|'bet'|'raise'|'allIn'|'play', amount? } }` | |
| `RESYNC` | — | |
| `PONG` | — | |

### 20.2 Server → Client
| t | Payload |
|---|---|
| `WELCOME` | `{ playerId, displayName, balance, serverTime }` |
| `ROOM_LIST` | `{ rooms: RoomSummary[] }` |
| `ROOM_SNAPSHOT` | `{ seq, room: RoomView, hand?: HandView }` |
| `GAME_EVENT` | `{ seq, event: GameEvent }` |
| `ROOM_EVENT` | `{ seq, event: PLAYER_JOINED \| PLAYER_LEFT \| PLAYER_SAT \| PLAYER_STOOD \| PLAYER_READY \| HOST_CHANGED \| PLAYER_DISCONNECTED \| PLAYER_RECONNECTED \| ROOM_CLOSED }` |
| `BALANCE` | `{ balance }` — sau settlement/daily/relief |
| `NOTIFICATION` | `{ kind, payload }` — Normal dùng cho achievement; Lite không gửi |
| `ACK` | `{ reqId }` |
| `ERROR` | `{ reqId?, code, message }` |
| `SESSION_REPLACED` | — |
| `PING` | — |

### 20.3 Mã lỗi
`UNAUTHENTICATED, INVALID_MESSAGE, RATE_LIMITED, ROOM_NOT_FOUND, ROOM_FULL, WRONG_PASSWORD, INVALID_ROOM_CONFIG, NOT_HOST, SEAT_TAKEN, INSUFFICIENT_BALANCE, NOT_YOUR_TURN, ILLEGAL_ACTION, INVALID_AMOUNT, STALE_STATE, DUPLICATE_REQUEST, NOT_IN_HAND, SERVER_SHUTDOWN, INTERNAL`.

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
- `pnpm build:normal`: `tsc -b` core, server-kit, normal-server; `vite build` normal-web → `apps/normal-server/public`; `docker build -f apps/normal-server/Dockerfile`.
- `pnpm build:lite`: `vite build apps/lite/web` → `apps/lite/dist/public`; `esbuild apps/lite/server/src/main.ts --bundle --platform=node --target=node22 --format=cjs --external:node:*` → `dist/server.cjs`; `node --experimental-sea-config apps/lite/sea/sea-config.json` (assets = toàn bộ `dist/public` + `locales`), copy `node.exe` (Node 22 LTS win-x64, tải và cache trong `tooling/node-bin/`, kiểm SHA-256), `postject` inject blob, → `release/lite/bind-poker-lite.exe`. Static được đọc bằng `sea.getAsset()`, fallback đọc thư mục `public/` cạnh exe nếu tồn tại (cho dev).
- Kiểm tra sau build (test `lite-footprint.test.ts`): `server.cjs` không chứa `pg`, `drizzle`, `argon2`, `react-router`; tổng gzip `dist/public` ≤ 250 KB; exe ≤ 120 MB.

### 22.5 Cấu hình runtime (env)
| Biến | Normal | Lite |
|---|---|---|
| `PORT` | 8080 | 8080 |
| `HOST` | 0.0.0.0 | 0.0.0.0 |
| `DATABASE_URL` | bắt buộc | — |
| `SQLITE_PATH` | — | `./bind-poker.sqlite` |
| `SESSION_SECRET` | bắt buộc (≥ 32 ký tự) | — |
| `ALLOWED_ORIGINS` | bắt buộc (CSV) | mặc định cùng host |
| `RECONNECT_WINDOW_SEC` | 90 | 90 |
| `ECONOMY_TIMEZONE` | Asia/Ho_Chi_Minh | Asia/Ho_Chi_Minh |
| `LOG_LEVEL` | info | info |
| `LITE_HAND_LOG` | — | 0 |
Lite đọc `.env` cạnh exe nếu có; không có thì dùng mặc định.

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

## 27. Responsive Design

### 27.1 Breakpoint và bố cục bàn
- `≥ 1024`: elip đầy đủ, ghế của mình ở đáy giữa, ActionBar dưới ghế mình.
- `768–1023`: elip hẹp, chữ nhỏ hơn, ActionBar nổi.
- `< 768` dọc: lưới đối thủ 2 hàng trên cùng; community + pot giữa; bài mình + ActionBar ghim đáy (`position: sticky`), nút ≥ 44 px; slider cược thay bằng nút preset + input.
- `< 768` ngang (điện thoại xoay): dùng bố cục elip thu nhỏ, ẩn header.
- Lá bài: `clamp(36px, 8vw, 72px)` chiều rộng.

### 27.2 Màn hình
| # | Màn | Normal | Lite |
|---|---|---|---|
| 1 | Landing/Login/Register | ✓ | Nhập tên |
| 2 | Home/Lobby | ✓ | ✓ |
| 3 | Room list | ✓ | ✓ |
| 4 | Create room | ✓ | ✓ |
| 5 | Join room (mã/mật khẩu) | ✓ | ✓ |
| 6 | Poker table | ✓ | ✓ |
| 7 | Player profile | ✓ | Rút gọn |
| 8 | Avatar customization | ✓ | ✗ |
| 9 | Inventory | ✓ | ✗ |
| 10 | Achievements | ✓ | ✗ |
| 11 | Daily reward | ✓ | ✓ (điểm) |
| 12 | Settings | ✓ | ✓ |
| 13 | Language selection (trong Settings và header) | ✓ | ✓ |

### 27.3 Bàn chơi phải hiển thị
Người chơi (tên, stack, avatar/chữ cái, badge/title ở Normal), lá riêng, lá chung, pot (+ side pot, + pot cộng dồn), cược hiện tại của từng người, lượt (viền sáng + timer vòng tròn), trạng thái fold/all-in/sitting-out/disconnected, người thắng + bài thắng + số điểm nhận, mode và variant, mã phòng.

## 28. Deployment

### 28.1 Normal
- `apps/normal-server/Dockerfile` đa stage: stage build cài toàn bộ workspace và build; stage runtime `node:22-alpine` chỉ copy `dist/`, `public/`, `drizzle/`, `node_modules` production của normal-server (dùng `pnpm deploy --prod`).
- `deploy/normal/docker-compose.yml`: `app`, `postgres:16` (volume), `caddy` (HTTPS tự động, proxy HTTP + WS tới app). `.env` cho compose.
- Migration: container `app` chạy `node dist/migrate.js` rồi `node dist/main.js` (entrypoint). Migration idempotent.
- Health: `GET /health`; compose `healthcheck`.
- Backup: `deploy/normal/backup.sh` (`pg_dump -Fc`) chạy cron hàng ngày, giữ 14 bản; hướng dẫn restore `pg_restore`.
- Log: pino JSON ra stdout, gom bằng `docker logs`/driver.
- Tài liệu `docs/deployment-normal.md`.

### 28.2 Lite
- `pnpm build:lite` trên máy Windows dev (yêu cầu Node 22 + pnpm) → `release/lite/` gồm `bind-poker-lite.exe`, `.env.example`, `README-lite.md`.
- Vận hành: copy thư mục vào host, (tùy chọn) đổi `.env`, chạy exe → console in `Listening on http://<ip>:8080`. Mở firewall cổng 8080 nếu cần.
- Chạy nền: hướng dẫn `sc create BindPokerLite binPath= "C:\bind-poker\bind-poker-lite.exe"` hoặc Task Scheduler.
- Nâng cấp: dừng exe, thay file, chạy lại; SQLite tự migrate theo `user_version`.
- Tài liệu `docs/deployment-lite.md`, kèm troubleshooting (cổng bận, quyền ghi file sqlite, SmartScreen chặn exe chưa ký).

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

### 29.5 Lite
SQLite repository + migrate `user_version`; khởi động server bundle trên cổng ngẫu nhiên, tạo session, tạo phòng qua WS; `lite-footprint.test.ts` (chuỗi cấm, kích thước); smoke test exe: chạy `bind-poker-lite.exe --port 0 --smoke` in ra cổng, gọi `/health`, thoát.

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

## 33. MVP Scope

**MUST**: Core Hold'em; Blind 2/3 lá kiểu A/B; room; realtime + reconnect; bot Blind; điểm + phí bàn + cứu trợ; daily reward; basic player/session; Normal edition (auth, Postgres); Lite edition (exe, SQLite); en + vi; responsive; test core/integration; deploy docs.

**SHOULD** (làm trong M7–M8): achievement; avatar; inventory; thống kê đầy đủ; bot Hold'em; lịch sử ván.

**COULD** (roadmap): chat, emote, spectator, leaderboard, replay, shop đổi điểm, bot nâng cao.

**WON'T**: tiền thật, cash-out, marketplace, NFT, blockchain, ML AI, mạng xã hội.

## 34. Future Roadmap

1. Shop đổi điểm lấy cosmetic (bể điểm bổ sung) khi số liệu cho thấy lạm phát.
2. Quên mật khẩu qua email; xác minh email; đăng nhập Google (module riêng trong normal-server).
3. Ký code exe Lite; bản Linux binary.
4. Leaderboard tuần/tháng; spectator; chat trong phòng (lightweight protocol).
5. Lưu ván qua restart (event sourcing nhẹ theo phòng).
6. Đa tiến trình Normal với sticky routing theo phòng.
7. Bot Hold'em có mô hình đối thủ đơn giản.
8. PIN tùy chọn cho phiên Lite.

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

## Phụ lục B — Bảng kiểm chấp nhận (mục 40 & 66 requirement)

Được sao chép vào `docs/acceptance-checklist.md` và tick khi M9 hoàn thành; mỗi mục gắn với test hoặc bước kiểm thủ công có ghi chú.
