# Test matrix — spec §29.2, §29.3 and §30

Every requirement in the spec's server-kit integration list (§29.2), its multiplayer
requirement (§29.3) and its edge-case table (§30) appears here exactly once, with the
test that holds it up. One row after the summary is not the spec's: the text-overlap rule
of the 2026-09-29 review (No11b).

Status legend:

- **covered** — a test already existed before Plan 7.
- **added in Plan 7** — written for this milestone (`packages/server-kit/src/edge-cases.test.ts`,
  `packages/server-kit/src/soak.test.ts`, `packages/server-kit/src/testing/soak.ts`).
- **partly covered** — the mechanism is tested, but part of the row is a documented
  consequence rather than an assertable behaviour. The reason is spelled out.
- **added in Plan 16** — the one row after the summary, which is not the spec's: the text-overlap
  rule the 2026-09-29 review asked for (No11b).

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
