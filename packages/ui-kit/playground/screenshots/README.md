# Playground visual check

States walked in a real browser against `pnpm --filter @bp/ui-kit playground` (Vite, port 5175), at 1280 × 800 and
375 × 812, before the fixes in `fix(ui-kit): fit the room to one screen…` and again after them. Measurements were
taken from the live DOM (bounding boxes of every seat, the board/pot block, the tray and the room's scroll height),
so "no overlap" and "nothing clipped" below are checked numbers, not impressions.

**No PNGs are committed.** The harness available here renders and inspects pages but cannot write image files to
disk, and faking them would be worse than saying so. Each state below carries the verdict instead. To reproduce:
start the playground, set the controls named in each row, and look.

## Controls

`Mode` (Hold'em / Blind A / Blind B) · `View` (Room / Lobby) · `Seats` (4 / 6 / 9) · `Theme` (dark / light) ·
`Language` (vi / en) · `Force stack layout` · `Next hand`.

## States

| # | State | Verdict |
| --- | --- | --- |
| 1 | Room · Hold'em · 4 seats · dark · vi · 1280 × 800 · my turn mid-hand | **Pass.** Ring oval 734 × 367 centred between header and tray; no seat overlaps another or the board; the tray (fold / call / raise / all-in + presets + slider) is fully on screen and the page does not scroll. |
| 2 | Room · Hold'em · 9 seats · dark · vi · 1280 × 800 | **Pass.** All nine plates evenly spaced around the rim (equal-arc spacing), compact plate variant, zero pairwise overlaps, none of them touching the board. Was two overlapping pairs of 67 × 56 px before the fix. |
| 3 | Room · Hold'em · 6 seats · **light** · en · 1280 × 800 | **Pass.** Names, stacks, badges, presets, amount field and the all-in outline all keep dark-theme contrast on the felt and tray (`data-surface="night"`); the page around them is parchment. Before the fix the plate names were near-black on navy and effectively unreadable. |
| 4 | Room · Blind B (play or fold) · 4 seats · dark · vi · 1280 × 800 · DECISION phase | **Pass.** Three hole cards per seat, decision tray reduced to "Bỏ bài" / "Chơi 5.000", no sizing controls offered. |
| 5 | Hand result overlay · light · en | **Pass.** Winner card, payout, table fee and uncalled-bet line legible; the card and its "next hand in N sec" countdown stay night-side over the felt in the light theme; the scrim does not swallow the seats. |
| 6 | Room · Hold'em · not my turn (bot acting) | **Pass.** The tray holds its place with "Waiting for your turn" and the felt above it does not resize. Before the fix the tray unmounted and the table jumped ~133 px on every turn. |
| 7 | Room · stack layout · 9 seats · dark · vi · 375 × 812 | **Pass.** Opponents' strip scrolls inside its own row; board, pot, my hole cards, my plate and the four action buttons (one row, no wrapped labels) are all on screen at once with no page scroll. Before the fix the tray started 940 px down an 836 px viewport. |
| 8 | Lobby · dark · vi · 1280 × 800 | **Pass.** Two tickets (open hold'em, locked blind) with perforated stubs and mode glyphs, filter segment, player bar, join-by-code panel, create CTA. Room-code placeholder no longer clipped by its letter-spacing. |
| 9 | Lobby · create-room modal · light · en · 1280 × 800 and 375 × 812 | **Pass.** Dialog scrolls; the "Create room" footer stays pinned at its foot at both sizes. Before the fix the submit button was below the fold on a phone. |
| 10 | Room · 800 × 700 (short window) | **Degraded but usable.** The ring compacts (container query on the felt) and the stack layout takes over below 620 px of viewport height. Between those two points the table is tight but nothing is unreachable. |
| 11 | `prefers-reduced-motion: reduce` | **Pass by construction.** `theme/global.css` disables every animation and transition under the media query, and there is no JS animation loop; verified by inspection, as the harness cannot emulate the preference. |

## `#worst` — a frozen room at its tallest

`#worst/<state>/<seats>/<lang>[/long][/landscape|/desktop]` renders the room in one hand-written state, no engine
running. `state` is `waiting`, `turn`, `result` or `blindS` (a Blind Poker squeeze table: pure luck, two hole cards, one
bot, my cards face down with the Lật pill, the "Nặn bài" badge and a 15 s round countdown on my plate); `seats` is 2–9;
`lang` is `vi` or `en`. The tokens after the language are read by name, in any order: `long` gives the viewer a
30-character name, `landscape` or `desktop` **forces** that room frame whatever the window is. Without a frame token the
window's own media query chooses (`LANDSCAPE_PHONE`: landscape, height ≤ 500 px, width ≥ 700 px). Examples:
`#worst/turn/9/vi/landscape`, `#worst/blindS/6/vi`.

Sizes walked for Plan 26 (Part B), forced `/landscape`: **915 × 355**, **915 × 412** and **844 × 390**, each for
`waiting`, `turn`, `result` and `blindS` at 6 and 9 seats; plus `blindS` at 6 seats with no frame token at
**1920 × 940**, **1366 × 768** and **375 × 812**. Screenshots were taken with Playwright against the running playground
and live DOM boxes were measured (no two `[data-plate]` boxes intersect in any of the 27 shots; no `[data-seat]` box
intersects the tray or the dock in any of them). PNGs are not committed.

| State (landscape, `vi`) | Verdict |
| --- | --- |
| `waiting` · 6 and 9 seats · all three sizes | **Pass.** Nine plates round the rim with the dock (Sẵn sàng / Bắt đầu, count) in the bottom-right corner; names are cut to "…" at nine seats, nothing overlaps. |
| `turn` · 6 seats · all three sizes | **Pass.** The four action buttons stay in the corner with their amounts; the viewer's cards and plate sit under the board; no overlap. |
| `turn` · 9 seats · 915 × 355 | **Tight, no overlap.** Every plate is clear of the next. The deck and the left seats' cards sit close (a bet chip and a seat's cards touch), and a folded seat's "Đã bỏ bài" tag lies under the deck. Names are cut to three letters. |
| `result` · 6 and 9 seats · all three sizes | **Pass.** One compact winners card over the felt with "Đóng", the fee line and the countdown; the dock row is free and the page does not scroll. At 915 × 355 the card covers most of the table, as intended. |
| `blindS` · 6 seats · all three sizes | **Pass.** Two big face-down cards with the Lật pill over their foot, the badge beside the room's name, "Tự động chơi" bottom-left, the wait line bottom-right. |
| `blindS` · 9 seats · 915 × 412 and 844 × 390 | **Pass.** Same as six seats; the crowd is dense but each plate, card pair and chip is readable. |
| `blindS` · 9 seats · 915 × 355 | **Crowded.** No plate overlaps another, but on the left the deck touches Lê Hoàng's chip and its cards graze her "Đã lật" pill, and on the right Hồ Tuyết's cards cover the last digit of Bùi Gia's chip. See the B7 report. |
| `blindS` · 6 seats · 1920 × 940, 1366 × 768, 375 × 812 | **Pass.** The desktop and stacked frames are unchanged: the Lật pill lies over my cards, the badge sits in the header. |

## Not covered here

Spectator mode, chat and avatars do not exist yet (see the "Known gaps" section of `docs/ui-kit.md`).
