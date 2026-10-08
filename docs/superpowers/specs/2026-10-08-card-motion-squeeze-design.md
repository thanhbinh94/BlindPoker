# Lật bài có chuyển động và chế độ nặn bài — thiết kế

Ngày 2026-10-08. Người dùng (06/10): *"kiểm tra lại phần hiệu ứng lật bài hiện tại. đang thấy chỉ hiển thị sấp ngửa,
chứ không có hiệu ứng lật từ từ như css transition ease chẳng hạn"*, rồi *"tôi muốn game trở nên vui hơn (khi không
dùng auto) bằng cách bổ sung chế độ nặn bài"*, và (08/10) *"với chế độ nặn bài thì cần có mode riêng, chỉ dành cho blind
poker, và lúc này thời gian mỗi vòng tăng lên = 20s tối đa hoặc khi toàn bộ người chơi hoàn thành nặn và lật bài"*.
Các lựa chọn được duyệt từng câu trong phiên brainstorming 06–08/10 (có bản mẫu chạy thật trong trình duyệt).

Spec này sửa `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8 (mục 9 dưới đây).

## 1. Mục tiêu

**Trước thay đổi** (đo bằng quay chậm 10× trên bàn thật, 06/10):
- lá chung (flop, turn, river) *hiện ra* với mặt ngửa sẵn: xoay nhẹ từ cạnh và mờ dần lên trong 0,34 s — không có lúc nào
  thấy mặt lưng;
- bài của mình hiện ngửa ngay lúc chia;
- bài đối thủ khi so bài đã lật hai mặt (0,6 s, từ 2026-09-29) nhưng nhỏ và khó thấy;
- không có cách nào tự tay mở bài.

**Sau thay đổi**:
- mọi lá đi ra từ một **bộ bài** vẽ trên bàn, úp, rồi mới lật — lá chung lật tại chỗ sau khi trượt tới;
- bài đối thủ khi so bài **nhấc lên rồi lật**, sau khi lá river đã nằm yên;
- bàn Blind Poker có **chế độ nặn bài**: bài của mình chia úp, người chơi tự tay bóc từ chỗ chạm để xem; vòng nặn tối đa
  20 giây, hết sớm khi ai cũng đã lật;
- không thêm thư viện: CSS 3D, Web Animations API và JavaScript cho cử chỉ. Three.js và anime.js đã cân nhắc và bỏ
  (three.js là 3D thật, quá nặng cho lật bài 2D; anime.js chỉ sắp chuỗi, trình duyệt đã có sẵn).

## 2. Quyết định của người dùng

| # | Câu hỏi | Chọn |
|---|---|---|
| Q1 | Lật từ từ ở đâu | Cả ba: lá chung; bài đối thủ khi so bài; bài mình lúc chia |
| Q2 | Kiểu lật lá chung (xem mẫu A/B/C chạy thật) | **C** — chia từ bộ bài rồi lật |
| Q3 | Nặn bài áp dụng cho lá nào | Chỉ bài của mình |
| Q4 | Cách nặn (mẫu A kéo mép, B nặn góc, C giữ, D bóc từ điểm chạm) | **D**, bóc theo đúng điểm chạm, đường nếp mảnh |
| Q5 | Vị trí bộ bài | Giữa bàn, phía trên các lá chung, cạnh pot |
| Q6 | Bật/tắt nặn | **Chế độ của bàn** Blind Poker, không phải công tắc trên máy (thay cho lựa chọn "công tắc Cài đặt" đã chọn trước đó) |
| Q7 | Quan hệ với "Cách chơi" | Lựa chọn thêm, đi với cả hai cách chơi; timer cố định 20 s |

Mẫu D cuối (v10) nằm ở `.superpowers/brainstorm/` (git-ignored): bóc 2D bằng cắt và dịch, không dùng 3D vì Chrome xếp
lớp sai khi nếp gấp chéo (răng cưa).

## 3. Định nghĩa

- **Bộ bài**: hình chồng bài úp cố định ở giữa bàn, phía trên các lá chung, cạnh ô pot. Mọi lá trượt ra từ đây.
- **Chia từ bộ bài** (kiểu C): lá úp trượt từ bộ bài tới chỗ của nó (0,36 s, ease-out, hơi xoay), rồi — với lá sẽ ngửa —
  lật quanh trục dọc tại chỗ (0,6 s, ease-in-out). Lá sau trượt tới trong lúc lá trước đang lật (cách nhau 0,3 s).
- **Nhấc lên rồi lật** (kiểu B): lá đang úp trên bàn nhấc lên (to ra 10 %, bóng đổ rộng ra), xoay giữa không trung, đặt
  xuống hơi quá đà một nhịp rồi nằm yên; 0,72 s một lá, cách nhau 0,2 s.
- **Bóc** (kiểu D): cử chỉ nặn bài. Chạm vào lá, kéo vào trong hoặc hất. Hướng bóc là hướng từ điểm chạm vào tâm lá (không
  chốt về cạnh/góc; chạm trong vòng 16 px quanh tâm thì bóc từ mép dưới). Nếp gấp vuông góc với hướng đó, cách mép đã chạm
  một đoạn tỉ lệ với quãng kéo (kéo 0,75 × chiều dài lá theo hướng ấy là bóc hết). Phần chưa bóc là mặt lưng cắt tại nếp;
  phần đã bóc là mặt ngửa gập qua nếp nằm lên phần còn lại, **đúng chiều** (dịch dọc hướng bóc, không soi gương), có bóng
  đổ và một dải sáng–tối mảnh (10 px) dọc nếp, chỉ trong lá. Kéo quá nửa (p ≥ 0,5), hoặc hất nhanh (≥ 0,9 px/ms theo
  hướng bóc khi p > 0,12), thì lá bóc hết (≈ 0,26 s) rồi trượt về nằm ngửa tại chỗ (0,22 s); thả sớm thì úp lại (0,2 s).
- **Pha nặn** (`SQUEEZE`): pha của ván Blind kiểu may rủi trong bàn nặn, giữa chia bài và lật lá chung.
- **Đã lật**: ghế có mọi lá riêng đã ngửa trên máy của người đó (bóc tay, nút "Lật", tự lật khi chọn Chơi/Bỏ hoặc khi bật
  Tự động chơi, hay server lật hộ khi hết giờ).

## 4. Luật

### 4.1 Chuyển động (mọi bàn, cả hai edition)

1. Ván bắt đầu: bài riêng chia từ bộ bài tới từng ghế theo vòng như người chia thật — lá thứ nhất cho từng ghế theo chiều
   kim đồng hồ từ ghế sau dealer, rồi lá thứ hai, (lá thứ ba). Bài đối thủ giữ úp. Bài của mình: ở bàn Hold'em và bàn Blind
   không nặn, lật tại chỗ ngay sau khi trượt tới; ở bàn Blind nặn, giữ úp (§4.2).
2. Lá chung: flop ba lá chia từ bộ bài rồi lật lần lượt; turn, river từng lá. Server vẫn phát mỗi bước cách nhau 1,5 s
   (§8.3 bước 5 của spec gốc); một lá mất 0,36 + 0,6 ≈ 1 s nên nằm yên trước bước sau.
3. So bài: bài đối thủ nhấc lên rồi lật, cách nhau 0,2 s trong một ghế. Thẻ kết quả chỉ mở sau khi lá cuối cùng đã lật
   xong (`REVEAL_HOLD_MS` tính lại từ các hằng số mới; thẻ kết quả giữ nguyên).
4. Mở bàn giữa ván, vào lại sau khi rớt mạng, hay ván đã xong khi màn hình thấy lần đầu: bài đang có hiện tại chỗ, không
   chia lại, không lật (như nay).
5. `prefers-reduced-motion: reduce`: không chuyển động nào, mọi lá hiện ngay ở trạng thái cuối (như nay). Bóc tay vẫn dùng
   được nhưng không có chuyển động chuyển tiếp.

### 4.2 Chế độ nặn bài (bàn Blind Poker)

1. Khi tạo bàn Blind có ô **"Nặn bài"** (`blind.squeeze`, mặc định tắt), đi cùng cả hai cách chơi. Bàn Hold'em không có.
   Khi bật, ô "Thời gian mỗi lượt" ẩn đi: timer cố định **20 giây** (server ép, bỏ qua giá trị client gửi). Danh sách
   phòng và đầu bàn mang nhãn "Nặn bài".
2. Bài của mình chia úp. Người chơi bóc từng lá (§3), hoặc bấm nút **"Lật"** (viên nhỏ dưới bài của mình) để mở mọi lá
   còn úp. Việc bóc chỉ diễn ra trên máy mình; server đã gửi lá từ lúc chia như nay.
3. **May rủi + nặn**: sau khi chia, vào pha nặn tối đa 20 s; đồng hồ hiện trên bàn như pha quyết định. Pha kết thúc sớm
   khi mọi ghế người thật trong ván đã lật; bot tính là đã lật từ đầu pha. Hết giờ, server lật hộ các ghế còn úp. Rồi
   lật lá chung và so bài như thường.
4. **Chơi hoặc bỏ + nặn**: không có pha riêng. Pha quyết định dài 20 s, mỗi người nặn rồi chọn Chơi/Bỏ. Pha kết thúc sớm
   khi mọi người đã chọn (như nay). Chọn mà chưa lật thì lá tự lật trên máy mình. Hết giờ chưa chọn vẫn là Bỏ (như nay).
5. Chưa nặn vẫn hành động được (chơi mù). Tự động chơi: máy lật ngay khi chia.
6. Mỗi người chỉ thấy việc nặn của mình; các ghế khác thấy nhãn **"Đã lật"** ở ghế đã lật trong pha, để biết đang chờ ai.
7. Vào lại giữa pha: lá đã lật hiện ngửa, lá chưa lật vẫn úp và bóc được; trạng thái "đã lật" theo ghế nằm trong ván.
8. Người rớt mạng giữa pha nặn: đồng hồ 20 s lo phần còn lại (server lật hộ).
9. 3 lần "hết giờ" liên tiếp ở pha nặn **không** tính là timeout hành động (§8.7 spec gốc chỉ áp cho pha quyết định):
   không lật cũng không bị mời đứng dậy.

## 5. Thay đổi kỹ thuật

### 5.1 `@bp/core`

- `BlindRules.squeeze: boolean`. `HandPhase` thêm `'SQUEEZE'`. `HandPlayer.revealed: boolean`: `true` ở bàn không nặn và
  với bot; `false` cho người thật ở bàn nặn lúc chia.
- Pha đầu của ván Blind: nặn + may rủi → `SQUEEZE`; nặn + chơi hoặc bỏ → `DECISION` (như nay); không nặn → như nay.
- Lệnh mới `{ type: 'REVEALED'; seat }`: hợp lệ trong `SQUEEZE`, và trong `DECISION` của bàn nặn; đặt `revealed`, phát
  `PLAYER_REVEALED { seat }`; gọi lại khi đã lật là no-op (không lỗi). Trong `DECISION`, lệnh `ACTION play/fold` cũng đặt
  `revealed` và phát `PLAYER_REVEALED` nếu chưa.
- Chuyển pha: vào `SQUEEZE` phát `SQUEEZE_PHASE { seats, turnSeq }` (ghế người thật chưa lật). Khi mọi ghế trong ván đã
  `revealed` → phát `SQUEEZE_ENDED`, sang `REVEAL` (lá chung theo `ADVANCE` như nay). `TIMEOUT` không dùng cho pha này:
  hết giờ, runner gửi `REVEALED` cho từng ghế còn úp.
- `HandView` (từng ghế) thêm `revealed`.

### 5.2 `@bp/core` protocol và `@bp/server-kit`

- `BlindRoomConfig.squeeze?: boolean` (mặc định `false`; `validate` chấp nhận boolean). Khi `true`, `turnTimerSec` bị ép
  `20` trong `validateRoomConfig` (không báo lỗi). `RoomSummary.config` mang theo, nên sảnh gắn nhãn được.
- `ClientMessage` thêm `{ t: 'REVEAL'; reqId?: string }`. `Room` nhận: chưa ngồi hoặc không trong ván → `ERROR NOT_IN_HAND`;
  còn lại chuyển `REVEALED` cho runner, trả `ACK`.
- `HandRunner`: pha `SQUEEZE` đặt deadline `turnTimerMs` (20 s) như `DECISION`, gửi `deadlineAt` kèm `SQUEEZE_PHASE`;
  hết giờ gửi `REVEALED` cho mọi ghế chưa lật; bot không cần timer (đã lật từ đầu). `SQUEEZE_ENDED` xoá deadline.
- Bàn nặn + chơi hoặc bỏ: runner không đổi (timer 20 s do config).

### 5.3 `@bp/ui-kit`

- `client/types.ts`: `ClientPhase` thêm `'SQUEEZE'`; `ClientSeat.revealed`. Reducer: `SQUEEZE_PHASE` (pha, `deadlineAt`),
  `PLAYER_REVEALED` (ghế), `SQUEEZE_ENDED` (sang `REVEAL`, xoá deadline); snapshot đọc `revealed` từ view.
- `table/Card.tsx`: thêm `dealFrom?: { dx: number; dy: number }` (trượt từ bộ bài, toạ độ tương đối do `PokerTable` đo),
  `reveal?: 'flip' | 'lift'` (lật tại chỗ sau khi tới, hay nhấc lên lật khi đang úp mà được ngửa). Keyframe `deal` cũ thay
  bằng trượt; keyframe `flip` hiện có giữ cho lá chung; keyframe `lift` mới cho so bài. Hằng số: `DEAL_MS` 360,
  `FLIP_MS` 600, `LIFT_MS` 720, `DEAL_STAGGER_MS` 120 (từng lá quanh bàn khi chia), `BOARD_STAGGER_MS` 300 (lá chung),
  `SHOWDOWN_STAGGER_MS` 200; `CARD_STAGGER_MS` 60 hiện có giữ cho thẻ kết quả.
- `table/PeelCard.tsx` (mới): lá bóc được, 2D như mẫu v10 — hình học nếp và vùng cắt trong `table/peel.ts` (thuần, test
  được): `peelGeometry(u, p, w, h)` → clip của mặt lưng, clip và dịch của mặt ngửa, vị trí dải nếp; ngưỡng mở và hất.
  Pointer events với `setPointerCapture`, `touch-action: none`. Gọi `onRevealed()` khi lá nằm ngửa xong.
- `table/Deck.tsx` (mới): bộ bài, đặt trong `PokerTable` phía trên `CommunityCards`, cạnh `Pot`; `PokerTable` đo vị trí bộ
  bài và từng ô lá (ghế, lá chung) để truyền `dealFrom`.
- `Seat`: ghế của mình ở bàn nặn trong pha `SQUEEZE`/`DECISION` vẽ `PeelCard` cho lá chưa lật; khi lá cuối ngửa → gửi
  `REVEAL`. Nút "Lật" dưới bài của mình (gửi `REVEAL` sau khi lật mọi lá). Ghế khác: nhãn "Đã lật" khi `revealed` trong
  pha. Tự động chơi: gửi `REVEAL` ngay khi có bài.
- `TurnTimer`: chạy trong `SQUEEZE` như `DECISION`.
- `lobby/CreateRoomFields`: ô "Nặn bài" ở phần Blind; khi bật ẩn ô timer. `RoomList`, `RoomHeader`: nhãn "Nặn bài".
- `screens/reveal-hold.ts`: `REVEAL_HOLD_MS` = `LIFT_MS + (MOST_HOLE_CARDS − 1) × SHOWDOWN_STAGGER_MS + SETTLE_MS`.
- i18n (vi, en): `create.squeeze`, `labels.squeezeMode`, `labels.revealed`, `actions.revealCards`, `phases.squeeze`.

### 5.4 Editions

- Normal và Lite dùng chung core/server-kit/ui-kit: cả hai có chế độ nặn và chuyển động mới. Không migration DB (cấu hình
  phòng không lưu).

## 6. Lỗi và trường hợp biên

- `REVEAL` ngoài pha nặn/quyết định hoặc ở bàn không nặn: no-op, `ACK` (client cũ không gửi; client mới gửi thừa vô hại).
- Pha nặn ở ván chỉ còn một người thật và bot: kết thúc ngay khi người đó lật.
- Người thật đứng dậy/rời phòng giữa pha nặn: ghế đó rời ván như nay; điều kiện "mọi ghế đã lật" tính trên ghế còn trong
  ván.
- `prefers-reduced-motion`: `PeelCard` vẫn nhận cử chỉ, nhưng mở/úp tức thời.
- Màn hình hẹp (375 px): lá của mình cỡ `md` (32–46 px rộng) vẫn bóc được; ngưỡng kéo tính theo kích thước lá thực.
- Thẻ kết quả vẫn không mở đè lên lá đang lật (giữ `useRevealHold`).

## 7. Bảo toàn điểm

Không đổi: chế độ nặn không chạm tiền, chỉ kéo dài pha và thêm trạng thái "đã lật".

## 8. Kiểm thử

- core: pha `SQUEEZE` (vào pha, `REVEALED` từng ghế, kết thúc sớm khi đủ, no-op khi lặp, bot đã lật sẵn, runner lật hộ
  khi hết giờ), `DECISION` ở bàn nặn (`play/fold` đặt `revealed`), view mang `revealed`; validate `squeeze` và ép timer 20.
- server-kit: `Room` nhận `REVEAL` (ACK, NOT_IN_HAND), runner deadline 20 s và lật hộ, snapshot giữa pha.
- ui-kit: `peel.ts` (hình học với 8 hướng và một hướng lệch bất kỳ, ngưỡng, hất), `PeelCard` (pointer events, `onRevealed`),
  reducer (ba sự kiện mới), `Card` (hằng số khớp token CSS như test hiện có), `reveal-hold`, `CreateRoomForm` (ẩn timer).
- e2e Normal: một ván Blind nặn với hai trình duyệt (bóc bằng `mouse.down/move/up`, nhãn "Đã lật" bên kia, pha hết sớm);
  ảnh chụp bàn ở 1920×940, 1366×768, 375×812 theo thói quen dự án. Lite smoke: tạo bàn nặn.
- Kiểm tra tay trên điện thoại thật (cử chỉ chạm) trước khi báo xong.

## 9. Tài liệu phải sửa

- `docs/superpowers/specs/2026-09-04-bind-poker-design.md` §8.1 (thêm `squeeze`, timer 20 s), §8.3 (pha nặn), §8.5 (bot
  đã lật), §8.7 (timeout pha nặn không tính); §17 (pha, lệnh, sự kiện mới).
- `docs/server-kit.md`, `docs/ui-kit.md`, `docs/test-matrix.md`, `docs/acceptance-checklist.md`, `CHANGELOG.md`.

## 10. Ngoài phạm vi

- Nặn bài ở Hold'em; nặn bài đối thủ; âm thanh; chọn tốc độ chuyển động; nhiều bộ bài.

## 11. Triển khai

Một plan (superpowers:subagent-driven-development), thứ tự: core → server-kit → ui-kit (chuyển động, rồi bóc, rồi sảnh)
→ e2e → docs. Gộp `--no-ff` vào master, build hai edition, khởi động lại host LAN (không cần migration).
