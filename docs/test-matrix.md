# Test matrix — spec §29.2, §29.3 and §30

Every requirement in the spec's server-kit integration list (§29.2), its multiplayer
requirement (§29.3) and its edge-case table (§30) appears here exactly once, with the
test that holds it up.

Status legend:

- **covered** — a test already existed before Plan 7.
- **added in Plan 7** — written for this milestone (`packages/server-kit/src/edge-cases.test.ts`,
  `packages/server-kit/src/soak.test.ts`, `packages/server-kit/src/testing/soak.ts`).
- **partly covered** — the mechanism is tested, but part of the row is a documented
  consequence rather than an assertable behaviour. The reason is spelled out.

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
| Ván trọn vẹn Blind với bot | `packages/server-kit/src/gateway/gateway.test.ts` | blind hand against a bot over the wire › deals private cards only to their owner, drives the decision phase, settles and pushes the balance | covered |
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
| Phòng trống → xóa sau 60 giây; pot cộng dồn chia theo §8.4 | `packages/server-kit/src/room/room.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | join: password, capacity net of seated bots, duplicates; leave: host transfer and empty-room close · sinks the whole carry-over pot when the room closes with nobody seated · releases a carry-over pot to the seated humans once the room cannot start a hand for carryOverReleaseMs | covered |
| Phòng đầy → `ROOM_FULL` | `packages/server-kit/src/room/room.test.ts` | join: password, capacity net of seated bots, duplicates; … | covered |
| Action trùng → `reqId` trả lại kết quả cũ | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/edge-cases.test.ts` | hold’em between two clients › … duplicates … · replays the original ERROR when a failed request is retransmitted with the same reqId · §30 — the same reqId sent again, on the same socket and on a fresh one › replays on the connection that remembers it, and is re-evaluated — never re-applied — on a new one | covered + added in Plan 7 |
| Action sai lượt → `NOT_YOUR_TURN` | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | hold’em between two clients › enforces turn order … · rejects stale, out-of-turn, illegal and non-seated actions with the right codes | covered |
| Cược sai → `INVALID_AMOUNT` kèm min/max hợp lệ | `packages/server-kit/src/edge-cases.test.ts` | §30 — a bet outside the legal range › is refused as INVALID_AMOUNT and the message names the bounds that would have worked | added in Plan 7 |
| Timeout → check/fold (Hold'em), fold (Blind B); 3 lần liên tiếp → đứng dậy | `packages/core/src/hand/holdem.test.ts`, `packages/core/src/hand/blind.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | timeout checks when possible, otherwise folds · timeout counts as fold · three consecutive timeouts stand a player up after the hand; a lone seat returns the room to OPEN | covered |
| Hòa → chia đều, chip lẻ theo vị trí | `packages/core/src/betting/pots.test.ts`, `packages/core/src/hand/holdem.test.ts` | splits ties and hands odd chips clockwise from the button · side pots: short all-in, ties split with odd chip after the button | covered |
| Side pot → thuật toán tầng §7.4 | `packages/core/src/betting/pots.test.ts`, `packages/core/src/hand/holdem.test.ts` | creates side pots for uneven all-ins · handles several pots with different eligibility · side pots: short all-in, ties split with odd chip after the button | covered |
| Kết nối trùng → thay kết nối cũ | `packages/server-kit/src/gateway/gateway.test.ts` | reconnect and duplicate sessions › … a second login replaces the first | covered |
| Server restart → hủy ván, hoàn cược, stack về balance, thông báo | `packages/server-kit/src/gateway/gateway.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | shutdown › cancels hands, refunds, notifies and closes every socket · shutdown cancels the hand, refunds, cashes out and closes | covered |
| Lite bị tắt cứng trên Windows → số dư đã ghi vẫn đúng, stack trên bàn và pot cộng dồn mất | `apps/lite/server/src/run-file.test.ts`, `apps/lite/server/src/app.test.ts` | overwrites a run file left behind by a hard kill · is stale when the pid is gone, without asking the network (the wreckage of a hard kill is not an owner) · accepts the run token from the loopback, drains the room and gives the buy-in back (the graceful path this row contrasts with) | partly covered — the loss itself is what happens when no code runs, so there is nothing to assert; only the recovery path and the graceful alternative are testable |
| `bind-poker.run.json` còn lại sau tắt cứng → `--stop` xoá và thoát 0 | `apps/lite/server/src/run-file.test.ts` | deletes the file it owns and tolerates a second call · leaves a file that another instance has since taken over · leaves a file whose token differs even when the pid happens to match · is stale when the pid is gone, without asking the network … | covered |
| Tiến trình thứ hai trên cùng thư mục dữ liệu | `apps/lite/test/smoke.test.ts`, `apps/lite/server/src/app.test.ts` | refuses to start, and leaves the running instance able to stop itself · is left completely alone by a smoke-style app, which is given no path | covered |
| WS lỗi giữa gửi → client backoff reconnect, RESYNC | `packages/ui-kit/src/client/connection.test.ts`, `packages/ui-kit/src/client/reducer.test.ts` | reconnects with exponential backoff, re-sends HELLO, stops on SESSION_REPLACED and on disconnect() · WELCOME → RESYNC → snapshot restores the room we were already sitting in · a game event with no hand advances seq and sets resyncNeeded | covered |
| Race giữa timer và action đến cùng lúc → hàng đợi tuần tự; timer kiểm `handId` + `turnSeq` | `packages/server-kit/src/edge-cases.test.ts`, `packages/server-kit/src/room/hand-runner.test.ts` | §30 — a timer and an action arriving together › applies exactly one of them, whichever reached the queue first, and drops the other · a stale decision timer is ignored once the phase resolved | added in Plan 7 |
| Bot thay người → không thay; bot chỉ theo `botCount` | `packages/server-kit/src/edge-cases.test.ts` | §30 — bots do not stand in for people › the seat a human vacates mid-hand stays empty: the table keeps exactly botCount bots | added in Plan 7 |
| Người rời giữa ván Hold'em có cược trong pot → fold; cược ở lại pot | `packages/server-kit/src/edge-cases.test.ts` | §30 — leaving a hold'em hand with chips already in the pot › folds the seat and leaves the chips where they are: the leaver is never refunded | added in Plan 7 |
| Người thiếu blind → all-in phần có | `packages/server-kit/src/edge-cases.test.ts` | §30 — a player who cannot cover the blind › posts what they have and is all-in for it, and the hand still balances | added in Plan 7 |
| Tất cả fold ở Blind B → cộng dồn | `packages/core/src/hand/blind.test.ts`, `packages/server-kit/src/room/room-hands.test.ts` | everyone folds → pot carries over, no fee · carries the pot over when everyone folds and pays it out in a later hand | covered |
| Balance thay đổi ngoài ván (daily) trong khi ngồi bàn → chỉ ảnh hưởng balance, không ảnh hưởng stack | `packages/server-kit/src/edge-cases.test.ts`, `packages/server-kit/src/gateway/gateway.test.ts` | §30 — a balance that changes while the player is at a table › touches the hold'em balance and leaves the chips on the table alone · notify reaches a live session, and balanceChanged refreshes a blind seat’s mirrored stack (the Blind half, where the seat *is* the balance — §8.1) | added in Plan 7 |
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
