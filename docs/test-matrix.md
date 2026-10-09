# Test matrix — spec §29.2, §29.3 and §30

Every requirement in the spec's server-kit integration list (§29.2), its multiplayer
requirement (§29.3) and its edge-case table (§30) appears here exactly once, with the
test that holds it up. The rows after the summary are not the spec's: the text-overlap rule
of the 2026-09-29 review (No11b), and the squeeze round and card motion of Plan 21 (the
amendments of spec §8 and §17 that `docs/superpowers/specs/2026-10-08-card-motion-squeeze-design.md` makes).

Status legend:

- **covered** — a test already existed before Plan 7.
- **added in Plan 7** — written for this milestone (`packages/server-kit/src/edge-cases.test.ts`,
  `packages/server-kit/src/soak.test.ts`, `packages/server-kit/src/testing/soak.ts`).
- **partly covered** — the mechanism is tested, but part of the row is a documented
  consequence rather than an assertable behaviour. The reason is spelled out.
- **added in Plan 16** — the one row after the summary, which is not the spec's: the text-overlap
  rule the 2026-09-29 review asked for (No11b).
- **added in Plan 21** — the ten rows of the "Plan 21" section, which are not the spec's either: the Blind
  squeeze mode and the card motion (spec 2026-10-08).

Paths are relative to the repository root. Test names are the `it(...)` titles; the
`describe` is given where it disambiguates.

Every citation here is machine-checked, the same way `docs/acceptance-checklist.md`'s are:
`tooling/arch/acceptance-links.test.ts` reads this file, requires each backticked path to exist, and
requires each piece of the "Test name" cell — split on ` · `, `›` and `…`, with parenthesised asides
dropped — to appear verbatim in one of the files that row names. Rename a test and forget this
table, and `pnpm test` is red. Ten rows were wrong when the check was first turned on and are fixed
here: six wrote `hold'em` where the `describe` uses a typographic `hold’em`, two named a run-file
test (`reports nothing when the pid is gone`) that does not exist under that name, one cited a
gateway title whose source wrote the apostrophe as a unicode escape rather than the character (the
source now uses the character, so the title is greppable), and one gave two display-name titles that
had drifted from the tests.

## §29.2 — Server-kit integration (real WebSockets, in-memory repositories)

| Requirement (§29.2) | Test file | Test name | Status |
|---|---|---|---|
| Tạo / vào / rời phòng | `packages/server-kit/src/gateway/gateway.test.ts` | lobby and rooms › lists public rooms live, joins by code, refuses wrong passwords and double rooms | covered |
| Mã phòng | `packages/server-kit/src/gateway/gateway.test.ts` | lobby and rooms › lists public rooms live, joins by code, … (joins by the lower-cased code) | covered |
| Mật khẩu | `packages/server-kit/src/gateway/gateway.test.ts` | lobby and rooms › … refuses wrong passwords and double rooms | covered |
| ready / start / autoStart | `packages/server-kit/src/room/room.test.ts` | ready needs a seat and an OPEN room; start needs the host and two ready seats · autoStart begins the hand when every seated human is ready | covered |
| Ván trọn vẹn Hold'em | `packages/server-kit/src/gateway/gateway.test.ts` | hold’em between two clients › enforces turn order, staleness, duplicates and legality | covered |
| Ván trọn vẹn Blind với bot | `packages/server-kit/src/gateway/gateway.test.ts` | blind hand against a bot over the wire › deals private cards only to their owner, drives the decision phase, settles the table stack and cashes it out on stand-up | covered |
| Timer hết giờ | `packages/server-kit/src/room/hand-runner.test.ts` | times out the acting seat and ignores a stale timer after the turn moved on | covered |
| Disconnect → reconnect nhận snapshot đúng | `packages/server-kit/src/gateway/gateway.test.ts` | reconnect and duplicate sessions › a dropped client keeps its seat, gets a snapshot on return, and a second login replaces the first | covered |
| Quá cửa sổ → đứng dậy | `packages/server-kit/src/room/room-hands.test.ts` | disconnect: others are told, the player receives nothing, reconnect restores delivery; expiry stands up then removes | covered |
| Kết nối trùng | `packages/server-kit/src/gateway/gateway.test.ts` | reconnect and duplicate sessions › … and a second login replaces the first | covered |
| `reqId` trùng | `packages/server-kit/src/gateway/gateway.test.ts` | hold’em between two clients › … duplicates … · bind and close races › replays the original ERROR when a failed request is retransmitted with the same reqId | covered |
| `baseSeq` cũ | `packages/server-kit/src/gateway/gateway.test.ts` | hold’em between two clients › … staleness … (`STALE_STATE`) | covered |
| Sai lượt | `packages/server-kit/src/gateway/gateway.test.ts` | hold’em between two clients › … (`NOT_YOUR_TURN`) | covered |
| Rate-limit | `packages/server-kit/src/gateway/gateway.test.ts` | abuse protection › rate-limits floods, closes after repeated invalid messages, and rejects oversized payloads | covered |
| Host rời | `packages/server-kit/src/edge-cases.test.ts` | §30 — host leaves mid-hand › the hand plays on without them, and the host passes to the earliest joiner once it ends | added in Plan 7 |
| Shutdown hoàn tiền | `packages/server-kit/src/gateway/gateway.test.ts` | shutdown › cancels hands, refunds, notifies and closes every socket | covered |

## §29.3 — Multiplayer

| Requirement (§29.3) | Test file | Test name | Status |
|---|---|---|---|
| 6 client × 3 phòng × 20 ván song song; tổng điểm và không có `seq` hụt | `packages/server-kit/src/soak.test.ts` | multiplayer soak (§29.3) › hold'em: 6 clients over 3 rooms play 20 hands each with no seq gaps and no points created or lost · blind: the same run against one bot per room conserves points across balances, fees and bot nets · the seq rule the soak clients apply › accepts the next frame, ignores one the snapshot already covered, and calls a hole a gap (the gap detector's positive control — a healthy run never takes that branch) | added in Plan 7 |

## §30 — Edge cases

| Situation (§30) | Test file | Test name | Status |
|---|---|---|---|
| Rớt mạng giữa lượt → ghế DISCONNECTED, ván tiếp tục, hết timer → mặc định | `packages/server-kit/src/room/room-hands.test.ts` | disconnect: others are told, the player receives nothing, reconnect restores delivery; expiry stands up then removes | covered |
| Đóng trình duyệt (như rớt mạng) | `packages/server-kit/src/gateway/gateway.test.ts` | reconnect and duplicate sessions › a dropped client keeps its seat, gets a snapshot on return … | covered |
| Host rời → chuyển host người vào sớm nhất; nếu đang ván, ván tiếp tục | `packages/server-kit/src/edge-cases.test.ts` | §30 — host leaves mid-hand › the hand plays on without them, and the host passes to the earliest joiner once it ends | added in Plan 7 |
| Phòng trống → còn bot: đóng ngay khi người thật cuối cùng rời (No3); không còn ai, kể cả bot: xóa sau 60 giây; pot cộng dồn chia theo §8.4 | `packages/server-kit/src/room/room.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | join: password, capacity net of seated bots, duplicates; leave: host transfer and empty-room close · The last person out of a room that still seats bots › the host leaving between hands closes the room in the same turn of the queue, and nothing is left armed · the host leaving mid-hand closes the room when that hand ends … · a disconnected host keeps the room open until the spectator grace removes them, and then it closes at once · a pot carried over when the last person leaves goes to the carry_over sink, and the books still balance · a room with nobody left and no bots either keeps its sixty-second grace … · sinks the whole carry-over pot when the room closes with nobody seated · releases a carry-over pot to the seated humans once the room cannot start a hand for carryOverReleaseMs · seats stood up for a spent limit keep their share of the carried-over pot, so an all-fold table does not pay the house | covered |
| Phòng đầy → `ROOM_FULL` | `packages/server-kit/src/room/room.test.ts` | join: password, capacity net of seated bots, duplicates; … | covered |
| Action trùng → `reqId` trả lại kết quả cũ | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/edge-cases.test.ts` | hold’em between two clients › … duplicates … · replays the original ERROR when a failed request is retransmitted with the same reqId · §30 — the same reqId sent again, on the same socket and on a fresh one › replays on the connection that remembers it, and is re-evaluated — never re-applied — on a new one | covered + added in Plan 7 |
| Action sai lượt → `NOT_YOUR_TURN` | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | hold’em between two clients › enforces turn order … · rejects stale, out-of-turn, illegal and non-seated actions with the right codes | covered |
| Cược sai → `INVALID_AMOUNT` kèm min/max hợp lệ | `packages/server-kit/src/edge-cases.test.ts` | §30 — a bet outside the legal range › is refused as INVALID_AMOUNT and the message names the bounds that would have worked | added in Plan 7 |
| Timeout → check/fold (Hold'em), fold (Blind B); 3 lần liên tiếp → đứng dậy | `packages/core/src/hand/holdem.test.ts`, `packages/core/src/hand/blind.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | timeout checks when possible, otherwise folds · timeout counts as fold · three consecutive timeouts stand a player up after the hand; a lone seat returns the room to OPEN | covered |
| Hòa → chia đều, chip lẻ theo vị trí | `packages/core/src/betting/pots.test.ts`, `packages/core/src/hand/holdem.test.ts` | splits ties and hands odd chips clockwise from the button · side pots: short all-in, ties split with odd chip after the button | covered |
| Side pot → thuật toán tầng §7.4 | `packages/core/src/betting/pots.test.ts`, `packages/core/src/hand/holdem.test.ts` | creates side pots for uneven all-ins · handles several pots with different eligibility · side pots: short all-in, ties split with odd chip after the button | covered |
| Kết nối trùng → thay kết nối cũ | `packages/server-kit/src/gateway/gateway.test.ts` | reconnect and duplicate sessions › … a second login replaces the first | covered |
| Server restart → hủy ván, hoàn cược, stack về balance, thông báo | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | shutdown › cancels hands, refunds, notifies and closes every socket · shutdown cancels the hand, refunds, cashes out and closes · a shutdown during a hand whose only person pressed Leave closes the room once, for the shutdown’s reason | covered |
| Lite bị tắt cứng trên Windows → số dư đã ghi vẫn đúng, stack trên bàn và pot cộng dồn mất | `apps/lite/server/src/run-file.test.ts`, `apps/lite/server/src/app.test.ts` | overwrites a run file left behind by a hard kill · is stale when the pid is gone, without asking the network (the wreckage of a hard kill is not an owner) · accepts the run token from the loopback, drains the room and gives the buy-in back (the graceful path this row contrasts with) | partly covered — the loss itself is what happens when no code runs, so there is nothing to assert; only the recovery path and the graceful alternative are testable |
| `bind-poker.run.json` còn lại sau tắt cứng → `--stop` xoá và thoát 0 | `apps/lite/server/src/run-file.test.ts` | deletes the file it owns and tolerates a second call · leaves a file that another instance has since taken over · leaves a file whose token differs even when the pid happens to match · is stale when the pid is gone, without asking the network … | covered |
| Tiến trình thứ hai trên cùng thư mục dữ liệu | `apps/lite/test/smoke.test.ts`, `apps/lite/server/src/app.test.ts` | refuses to start, and leaves the running instance able to stop itself · is left completely alone by a smoke-style app, which is given no path | covered |
| WS lỗi giữa gửi → client backoff reconnect, RESYNC | `packages/ui-kit/src/client/connection.test.ts`, `packages/ui-kit/src/client/reducer.test.ts` | reconnects with exponential backoff, re-sends HELLO, stops on SESSION_REPLACED and on disconnect() · WELCOME → RESYNC → snapshot restores the room we were already sitting in · a game event with no hand advances seq and sets resyncNeeded | covered |
| Race giữa timer và action đến cùng lúc → hàng đợi tuần tự; timer kiểm `handId` + `turnSeq` | `packages/server-kit/src/edge-cases.test.ts`, `packages/server-kit/src/room/hand-runner.test.ts` | §30 — a timer and an action arriving together › applies exactly one of them, whichever reached the queue first, and drops the other · a stale decision timer is ignored once the phase resolved | added in Plan 7 |
| Bot thay người → không thay; bot chỉ theo `botCount` | `packages/server-kit/src/edge-cases.test.ts` | §30 — bots do not stand in for people › the seat a human vacates mid-hand stays empty: the table keeps exactly botCount bots | added in Plan 7 |
| Người rời giữa ván Hold'em có cược trong pot → fold; cược ở lại pot | `packages/server-kit/src/edge-cases.test.ts` | §30 — leaving a hold'em hand with chips already in the pot › folds the seat and leaves the chips where they are: the leaver is never refunded | added in Plan 7 |
| Người thiếu blind → all-in phần có | `packages/server-kit/src/edge-cases.test.ts` | §30 — a player who cannot cover the blind › posts what they have and is all-in for it, and the hand still balances | added in Plan 7 |
| Tất cả fold ở Blind B → cộng dồn | `packages/core/src/hand/blind.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | everyone folds → pot carries over, no fee · carries the pot over when everyone folds and pays it out in a later hand | covered |
| Balance thay đổi ngoài ván (daily) trong khi ngồi bàn → chỉ ảnh hưởng balance, không ảnh hưởng stack | `packages/server-kit/src/edge-cases.test.ts`, `packages/server-kit/src/gateway/gateway.test.ts` | §30 — a balance that changes while the player is at a table › touches the hold'em balance and leaves the chips on the table alone · notify reaches a live session, and balanceChanged pushes the balance without touching a blind seat’s table stack (the Blind half: the balance is pushed, the table stack is left alone — spec 2026-09-29) | added in Plan 7 |
| Đổi tên trùng → `DISPLAY_NAME_TAKEN` | `apps/normal-server/src/auth/auth-service.test.ts`, `apps/normal-server/src/http/routes-me.test.ts`, `apps/lite/server/src/app.test.ts` | refuses a display name another account already folds to · refuses a name another player already holds, folded case included · rejects a name already in use with DISPLAY_NAME_TAKEN | covered |
| Hai người cùng `SIT_DOWN` một ghế → hàng đợi tuần tự; người sau nhận `SEAT_TAKEN` | `packages/server-kit/src/edge-cases.test.ts` | §30 — two players sit down on one seat › the queue lets exactly one in and the loser gets SEAT_TAKEN with their buy-in untouched | added in Plan 7 |

## Summary

| | §29.2 | §29.3 | §30 | total |
|---|---|---|---|---|
| rows | 16 | 1 | 25 | 42 |
| had a test before Plan 7 | 15 | 0 | 16 | 31 |
| got a new test in Plan 7 | 1 | 1 | 9 | 11 |
| …of which had no test at all before | 1 | 1 | 8 | 10 |
| partly covered, reason given | 0 | 0 | 1 | 1 |

Nothing is left with no test at all. The one *partly* covered row is the Lite hard kill,
where the row's own subject is what happens when no code runs.

## Review 2026-09-29 — the text-overlap rule (No11b)

Not a row of the spec: the user asked, in the 2026-09-29 review, that text drawn over other text become a test rule.
The rule and its limits are `docs/ui-kit.md`'s "The text-overlap rule". It runs inside tests that already visit each
screen, on the accounts they already make — the default e2e may not register more — at the user's screen
(1920×940), a laptop's (1366×768) and a phone's (375×812):

- sign-in card, both tabs: all three, and 1440×900; on the desktop also as signing out leaves it (`normal.spec.ts`);
- lobby; a lobby of six rooms (a patched `ROOM_LIST`: Hold'em and Blind, open, in a hand and closing, a lock, and two
  names that wrap — the server's longest cut after two lines), which must also fit 1920×940 and not scroll sideways
  on the phone; and the lobby's create-room dialog in both modes: all three (`normal.spec.ts`);
- room taking seats, in a hand, and on the result card counting down and held: all three; on the phone the stage
  is also read scrolled to its foot (`normal.spec.ts`);
- wardrobe (Ngoại hình — opening on Kiểu tóc under the Nữ | Nam switch since avatar v4 — Mũ, Quần áo — the view of
  No8's screenshot, the old inventory's "Trang phục" group — and Danh hiệu & Huy hiệu; the inventory screen folded
  into it, No5): all three, plus 900×1100, the item tabs measured with "Hiện cả món chưa có" ticked
  (`wardrobe-layout.spec.ts`); Ngoại hình → Kiểu tóc with the gender switch on its own: 1920×940, 1366×768 and
  375×812 (`wardrobe-layout.spec.ts`); the wardrobe's owned-only empty state — a fresh account's Mũ, the box
  unticked, one line in place of the grid (No11a): 1920×940 and 375×812 (`wardrobe-layout.spec.ts`); a coloured
  outfit worn: 1920×940 and 1366×768 (`avatar-tint.spec.ts`). The wardrobe's other six tabs are not read;
- profile with a hand in its history, achievements, Settings and its sign-out dialog: all three; on the phone the
  profile is also read before the hand (`normal.spec.ts`); Settings in the light theme at 1440×900, 900×1100 and
  375×812 (`wardrobe-layout.spec.ts`);
- daily page, the reward waiting and the receipt: all three (`normal.spec.ts`);
- the operation-test pack: a Hold'em hand in play, its result card counting down and a side-pot card at the pack's
  1440×900 and at all three (`03-holdem`); a Blind hand in play, a carried-pot card and a card with an uncalled play
  returned at 1440×900 (`04-blind`).

| Rule | Test file | Test name | Status |
|---|---|---|---|
| Không chữ nào đè lên chữ khác trên mọi màn hình chính (No11b); bộ phát hiện tự kiểm bằng trang mẫu tĩnh | `apps/normal-web/e2e/overlap.spec.ts`, `apps/normal-web/e2e/normal.spec.ts`, `apps/normal-web/e2e/wardrobe-layout.spec.ts`, `apps/normal-web/e2e/avatar-tint.spec.ts`, `apps/normal-web/e2e/ops/03-holdem.spec.ts`, `apps/normal-web/e2e/ops/04-blind.spec.ts` | hai đoạn chữ đè lên nhau thì báo lỗi, kèm chữ, khung và đường dẫn CSS · một tài khoản chơi trọn một ván Blind với bot · điểm danh hằng ngày · @mobile sảnh, bàn chơi và hồ sơ trên màn hình điện thoại · desktop: nhóm và tab con không gãy dòng; ảnh chụp tối và sáng · máy tính bảng … · @mobile điện thoại: không cuộn ngang, nhóm và tab con không gãy dòng; ảnh chụp tối và sáng · chọn màu tóc đỏ tô lại chibi bằng canvas và giữ nguyên khi lưu · E-01 E-02 E-03 E-12 E-07 E-08: buy in, play a hand out … · E-05: three all-ins of different sizes make a side pot · E-10 E-11: leaving mid-hand folds and settles after; … · F-03 F-04 F-05: two players decide blind to each other; … · F-06: one plays, one folds … | added in Plan 16 |

## Plan 21 — the squeeze round and the card motion (spec 2026-10-08)

Not rows of §29.2, §29.3 or §30: the user asked for cards that are dealt from a deck and turned, and for a Blind
"nặn bài" mode (06–08/10), and the spec amends §8.1, §8.3 (step 2b), §8.5, §8.7 and §17 of the main design. Each rule
below is held by the layer that owns it, from the engine up to the browser. The two e2e scenarios, F-11 and F-12, are
the pack's Blind cases (`docs/operation-test-plan.md`) and run outside `pnpm test`, as every e2e does; the Lite scenario
is the smoke that a squeeze room can be created and played out on the second edition. What no test has seen — a touch
on a real phone, the peel in Firefox or WebKit — is `docs/known-limitations.md`.

| Rule | Test file | Test name | Status |
|---|---|---|---|
| §8.1 `squeeze`: off by default, Blind only; ticked, `turnTimer` is forced to 20 s and the client's value ignored; `REVEAL` is a bare message (§20.1) | `packages/core/src/protocol/validate.test.ts` | squeeze mode (spec 2026-10-08) › is off unless asked for, and comes back on a validated config either way · forces the round to 20 s on a squeeze table, whatever timer was sent — and refuses 20 s elsewhere · refuses a squeeze flag that is not a boolean … · carries squeeze into the ruleset · parses REVEAL as a bare message with an optional reqId | added in Plan 21 |
| §8.3 step 2b and §17: the `SQUEEZE` phase of pure luck, the `REVEALED` command, `SQUEEZE_PHASE` / `PLAYER_REVEALED` / `SQUEEZE_ENDED`, `revealed` in the view; bots turned from the deal; play-or-fold has no phase of its own; a Hold'em seat has nothing to turn | `packages/core/src/hand/blind.test.ts`, `packages/core/src/hand/holdem.test.ts`, `packages/core/src/hand/engine.test.ts` | squeeze mode (spec 2026-10-08) › pure luck: deals into a SQUEEZE phase, bots already revealed, ending when every human has turned · a table of bots only skips the phase: SQUEEZE_PHASE names nobody and the hand is in REVEAL at once · play or fold: no SQUEEZE phase; REVEALED marks the seat without ending the round; a decision turns the cards too · REVEALED is a no-op outside squeezing, and ADVANCE is refused during SQUEEZE · the view carries revealed per seat, and a Hold’em or plain Blind seat is always revealed · every player is revealed from the deal: there is nothing to turn by hand, and REVEALED is a no-op · a squeeze hand is stepped through by turning every unturned seat | added in Plan 21 |
| §8.3 step 2b and §8.7, in the room: the round opens with a deadline and ends the moment the humans have turned; when it runs out the server turns the rest and no action is timed out (`consecutiveTimeouts` stays 0); `REVEAL` without a hand or a seat is refused (`NOT_IN_HAND`, `NOT_SEATED`) and is nothing when repeated, late or at a Hold'em table; play-or-fold keeps its `DECISION` round; a seat that leaves does not hold the round | `packages/server-kit/src/room/room-hands.test.ts` | squeeze mode (spec 2026-10-08) › opens a SQUEEZE round with a deadline and ends it the moment the one human has turned · turns the seats that have not turned when the round runs out, and goes on · REVEAL is refused with no hand or no seat, and is nothing when sent again · play or fold on a squeeze table keeps its decision round: the deadline comes from the config, and deciding turns the cards · a REVEAL after the round is over leaves the hand’s timers alone: the next card comes on time · a REVEAL at a Hold’em table, in the middle of a turn, sends nothing and leaves the deadline where it was · a seat that leaves in the middle of the round does not hold it: it is turned for them, and the round ends with the rest | added in Plan 21 |
| §8.3 step 2b, in the runner and on the wire: one table-wide deadline and no bot timer; at the deadline exactly the unturned seats are turned (guarded by the phase and `turnSeq`, so a late timer does nothing); an auto-fold seat is turned for; over a real socket `REVEAL` is `ACK`ed and `SQUEEZE_PHASE` carries `deadlineAt` | `packages/server-kit/src/room/hand-runner.test.ts`, `packages/server-kit/src/gateway/gateway.test.ts` | HandRunner — squeeze round › arms one table-wide deadline and no bot timer, and a seat turning its cards leaves it alone · turns exactly the seats that have not turned when the deadline passes, and goes on to the reveal · a squeeze timer that fires after the hand was cancelled does nothing · a seat marked auto-fold is turned for, so the round does not wait on it · squeeze round over the wire › answers REVEAL with ACK in the round, sends the deadline with its opening event, and ends the round on the turn | added in Plan 21 |
| Spec §4.2.7, §5.3: the client follows the round — phase `SQUEEZE`, `revealed` per seat only in a squeeze room, a snapshot's hand is `restored`, arrival stamps for the motion; auto-play turns the cards once per hand; `client.reveal()` | `packages/ui-kit/src/client/reducer.test.ts`, `packages/ui-kit/src/client/useGameClient.test.tsx` | squeeze mode (spec 2026-10-08) › starts a pure-luck squeeze hand in SQUEEZE with my seat unrevealed and the bot revealed, then follows the round · a hand from a snapshot is restored, and keeps the view’s revealed flags · a plain hand carries no revealed flag at all · a snapshot of a plain hand carries no revealed flag either, although the view always has one · a squeeze room that plays or folds opens in DECISION, with the seats still unrevealed · arrival stamps (the card motion reads them) › stamps the first deal, the latest board and the showdown with the client time they arrived, and a new hand starts clean · a hand built from a snapshot has no stamps: nothing was seen arriving · a reconnect snapshot stamps nothing, even on a hand that was being followed · useGameClient squeeze mode › auto-play turns the cards at once in a squeeze room: one REVEAL per hand, none when off · does not ask again once my cards are turned, and asks for nothing in a plain room · client.reveal() sends REVEAL with a request id and resolves on the ACK | added in Plan 21 |
| §4.2.1: the "Nặn bài" box in the Blind fields; ticked, the timer cell reads the fixed 20 s and the form submits `blind.squeeze` with `turnTimerSec: 20`; the badge in the room list and the room header | `packages/ui-kit/src/lobby/CreateRoomForm.test.tsx`, `packages/ui-kit/src/lobby/RoomList.test.tsx`, `packages/ui-kit/src/table/RoomHeader.test.tsx` | the "Nặn bài" option › is a checkbox in Blind mode, unchecked to begin with, named just "Nặn bài" and described by its hint · sits under the bot count, in its cell of the wager row, and shows no hint line of its own · is not offered at a Hold’em table, and appears when the mode is flipped to Blind · swaps the turn-timer select for the round’s fixed length when it is checked, and gives the select back when it is not · says the fixed length in English too · submits blind.squeeze true and a 20 s round, whatever timer was picked before the box was ticked · submits blind.squeeze false and the chosen timer when it is not checked — or was ticked and then cleared · does not follow the host to a Hold’em table: ticked, then flipped to Hold’em, the timer and the config are Hold’em’s own · the squeeze badge › marks a Blind room that is a squeeze table "Nặn bài" · puts nothing on a Blind room without the option, or with it false, nor on a Hold’em room · marks a squeeze table "Nặn bài" · puts nothing on a Blind table without the option, or with it false, nor on a Hold’em table | added in Plan 21 |
| §4.1 (the card motion): every card is dealt from the deck, round the table from the seat after the button; the board slides in and turns; an opponent's cards lift and turn at the showdown, after the river when it came with it; a restored or remounted hand is not dealt again; the result card waits for the lift; reduced motion switches it all off | `packages/ui-kit/src/table/Card.test.tsx`, `packages/ui-kit/src/table/CommunityCards.test.tsx`, `packages/ui-kit/src/table/PokerTable.test.tsx`, `packages/ui-kit/src/table/motion.test.ts`, `packages/ui-kit/src/screens/reveal-hold.test.ts` | a dealt face-up card slides in from the deck anchor and then turns — the back drawn as artwork for the slide · a dealt face-down card slides in and stays a back; with no deck anchor a dealt card fades in as before · measures from where the card lands to the deck, with the entrance keyframe off while it reads the boxes · keeps the delay it mounted with, for the slide and for the turn after it · reveal="lift" turns a revealed card with the lift keyframes instead of the flat turn · lifts on its own delay with the shadow widening on the wrapper, and leaves the deal delay as it mounted · keeps the resting face out of the lift and slide keyframes, and the constants match the tokens · lists every moving class of the card under reduced motion · staggers the flop by BOARD_STAGGER_MS and starts the turn and river at once · staggers nothing on a board that was not just dealt · slides the hole cards and the newest board cards in from the deck when they have just arrived · deals nothing for cards that arrived a while ago, nor for a hand rebuilt from a snapshot · deals the next hand afresh though it has as many cards as the last · lifts the cards of a showdown that %s on their own delays · puts the deck in one row with the pot, under the board (%s) · starts at the first seat after the button and wraps round · covers a lift, two more lifts’ stagger and the settle margin · grows by the river’s slide and turn when the showdown came with it · holds REVEAL_HOLD_MS after a showdown alone, and the river’s slide and turn longer after one that came with it | added in Plan 21 |
| §3, §4.2.2 (the peel): the fold from the pressed point into the centre, at any angle; the open threshold and the flick; a short drag, a cancelled pointer or a lost capture always snaps back; a second finger is ignored; opened from outside; reduced motion | `packages/ui-kit/src/table/peel.test.ts`, `packages/ui-kit/src/table/PeelCard.test.tsx` | points from the press into the centre, exactly, and from the bottom near the middle · measures the card along the peel: the bottom edge runs the height, a corner the diagonal · at p = 0 nothing is peeled; at p = ½ the face sits in place over the far half; at p = 1 the face has moved a card length · a corner peel folds along the diagonal · peeling along %s: the face moves 2pL − L, the fold sits at sMin + pL, and the ends are whole or empty · travel is the drag projected on the peel, and opening needs half a card or a flick · starts face down and named as a card to peel; a drag past half opens it and reports once · a short drag snaps back and reports nothing; so does a pointer the browser cancels · a flick opens a card barely begun; a drag as far but slow, or one that stopped before it was let go, drops back · a pointer the system takes away always drops the card back, however far or fast it went · a capture lost without a release drops the card back; the one every release brings changes nothing · a capture lost by a child of the card, as the card takes the pointer, leaves the peel alone · reads the speed on the events’ own clock: a drag whose press was handled late is no flick · follows the pointer that pressed it: a second finger meanwhile is ignored · lets a touch on a card that is up scroll the room · a re-render mid-open with a new callback neither restarts the open nor reports twice · takes over a drag in progress when it is opened from outside · a card that mounts open — a hand restored after the round — is simply up, and reports once · opens at once from outside, and a drag still peels but opens or drops back the moment it is let go | added in Plan 21 |
| §4.2.2–§4.2.6, on the table: the viewer's cards are `PeelCard`s for the whole hand; the "Lật" pill turns both and keeps its place; `REVEAL` goes out once, after the last card is up; the round's ring sits on the viewer's own plate (until the choice, in play-or-fold); "Đã lật" and "Đã chọn" on the other seats; the tray's wait lines; auto-play offered | `packages/ui-kit/src/table/Seat.test.tsx`, `packages/ui-kit/src/table/PokerTable.test.tsx`, `packages/ui-kit/src/table/ActionBar.test.tsx`, `packages/ui-kit/src/screens/RoomScreen.test.tsx` | deals the viewer two cards to peel, the "Lật" pill under them and the round’s ring on the plate · keeps the pill’s place, out of sight and out of reach, once there is nothing left to turn · tells the table only when the last card is peeled up by hand · opens what is still down when the server has the seat turned, in the same cards, and sends nothing back · opens what is still down when the round is over, and sends nothing · deals the next hand face down again, with the pill, and tells the table about that hand too · says "Đã lật" on another seat that has turned, during the round only · keeps the round’s ring on a play-or-fold table until I have chosen, not just until my cards are up · lets "Đã chọn" stand for "Đã lật" on another seat that has decided · gives the pill a 28 px tap height · keeps the viewer’s cards plain cards on a table that is no squeeze table · gives my seat cards to peel and the round’s ring, and no one else either (%s) · keeps my ring through a play-or-fold decision once my cards are up, until I have chosen · shows a spectator who has turned, and gives no one cards to peel · hands the room the reveal once my cards are up · offers auto-play in a pure-luck squeeze room, where it means turning the cards at once · asks a squeeze seat to turn its cards, then says it waits for the others · sends one reveal once "Lật" has turned my cards · keeps the controls live while the reveal is out, and swallows a refused or dropped one | added in Plan 21 |
| §8 (the tests of the spec), in a browser: two players, one peeling by mouse and one pressing "Lật", the round over before 20 s; a 375 × 812 phone peeling by touch with the layout whole; the Lite edition creating a squeeze room and playing it out | `apps/normal-web/e2e/ops/04-blind.spec.ts`, `apps/lite/e2e/lite.spec.ts` | F-11: a squeeze table — one peels by hand, the other presses Lật, and the round ends before its 20 s · F-12: @mobile the squeeze fits a phone — the viewer’s cards, the Lật pill and the timer are on screen · bàn nặn bài: huy hiệu "Nặn bài", vòng 20 giây thay ô giờ, và nút Lật mở các lá úp | added in Plan 21 — e2e, run outside `pnpm test` |

## Ruling recorded: the `reqId` cache is per connection

Plan 7's first review round raised the `reqId` ring buffer as an open question, with a
`BUG:`-skipped test attached. It has been ruled on, and the skip is gone.

The **spec is the authority and the gateway already matches it**: §16.4 says the server
remembers the last 32 `reqId`s *per connection* (`ClientConnection.rememberReq`). So

- on the **same** socket, a retransmission replays the exact frame the first attempt
  produced — an `ACK` stays an `ACK`, an `ERROR` stays the same `ERROR`;
- on a **fresh** socket after a reconnect, the buffer is gone with the old connection, so
  the retransmission is re-evaluated on its merits and the `turnStartSeq` / turn guard
  refuses it (`STALE_STATE` or `NOT_YOUR_TURN`). It is never applied twice.

What was wrong was `docs/server-kit.md`'s *Reconnecting and frame order → In-flight
actions* paragraph, which promised the replay across the reconnect. That paragraph now
states the per-connection contract, tells the client to expect an `ERROR` on the new
socket, and points it at the snapshot rather than the answer to the retransmission for
the truth about whether the action landed.

Both halves are now pinned by one live test — `§30 — the same reqId sent again, on the
same socket and on a fresh one` — which also asserts exactly one `PLAYER_ACTED` across all
three sends. **No test in this matrix is skipped.**
