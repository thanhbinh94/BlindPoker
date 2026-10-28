# BP-41 Poker hỗn loạn vòng 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 39 new chaos cards (12 Bạc, 13 Vàng, 14 Kim cương) including Cá chép hóa rồng with the Thần Bài / Bán Thần reign, the three-tier Xúc xắc vận may, loud heralds, three titles with their rewards, the money fence opened for the 🔓 cards, and tier odds 50/35/15.

**Architecture:** Every rule stays in pure `@bp/core` `chaos/` (new effect kinds, table-level chaos state for the Thần and the bomb, per-card state for energy and charge, dice rolls, stake multipliers, transfers) driven by the existing `planHand` → Blind engine appliers → `afterHand` pipeline; `@bp/server-kit` carries the table-level state, the new events and the per-seat draft tier; `apps/normal-server` adds ledger reasons, the dice sink, the title stats (migration 0008) and the three titles; `@bp/ui-kit` adds the herald, the Thần/Bán Thần seat marks, the dice roll and the new toast lines.

**Tech Stack:** TypeScript, React 18, CSS modules, Vitest, Playwright (Chromium), Fastify, Drizzle/PGlite + Postgres.

**Spec:** `docs/superpowers/specs/2026-10-28-chaos-round-three-design.md` (amends `2026-10-26-chaos-poker-design.md` and `2026-10-27-chaos-feedback-design.md`).

**Branch / worktree:** `feature/BP-41-chaos-round-three` in `.worktrees/BP-41`.

## Global Constraints

- Points only; every new money path (stake multipliers of Mạo hiểm gia / Sới lớn, transfers of Thách đấu / Thuế thắng / Ép chia thưởng / Bom nổ chậm / Thần thách đấu, jackpots, dice losses) keeps `Σ balances + Σ sink rows` conserved, pinned by conservation tests (core simulation + server-kit room + normal-server ledger).
- New points (jackpots, crits ×2–×5, dice) count toward `chaos_config.dailyCapPoints`; title rewards do not (achievements).
- No stack goes below 0: any payment larger than the stack pays the stack (like all-in).
- Every string vi + en (parity tests); `react/jsx-no-literals`; `formatPoints`; stable terms unchanged; "Tố" is not a card name.
- `@bp/core` pure; no new runtime dependency; new motion has a reduced-motion path and a test.
- Plain Blind, Hold'em and Lite unchanged (golden / regression tests stay byte-for-byte).
- Herald copy exactly: "Cảnh báo: {{name}} đã tích luỹ đủ năng lượng và trở thành Thần Bài!", "Cảnh báo: {{name}} đã chiến thắng định mệnh và trở thành Bán Thần!", "{{name}} đã đánh bại Thần Bài!".
- Titles: Hóa Thần 300 000 points + 300 danh vọng + `title_god`; Bán Thần 150 000 + 150 + `title_demigod`; Kẻ Sát Thần (2 defeats) 500 000 + 500 + `title_godslayer`; counted only when the hand had ≥ 2 human seats; defeating a bot Thần never counts.
- Default tier weights 50 / 35 / 15; the VPS `chaos_config` row is updated at deploy (controller).
- Screens: 1920×940, 1366×768, 375×812, 360×780, 780×360; no scroll, no text over text.

## Review Focus

1. A Thần at a "Chơi hoặc bỏ" table: nobody can fold (server refuses `fold`, UI hides it, auto-play plays); the Thần's Aces survive every steal / swap / shuffle / redeal; Nhật thực does not switch the Thần off. Tests in Task 6.
2. Mạo hiểm gia at ×32 with a short stack: the holder goes all-in; the extra is dead money the pot's winner takes; conservation holds. Test in Task 5.
3. Dice loss bigger than the stack: pays the stack, sink row equals the amount taken, no negative stack. Test in Task 5 and Task 8.
4. Two Cá chép holders hit in the same hand: only one Thần; the other keeps energy and rolls again when the throne is empty. Test in Task 6.
5. A Thần who leaves mid-reign: the reign ends, the herald state clears on every client, the bomb/table state survives a reconnect snapshot. Tests in Task 7.

## Amendments (pre-flight 2026-10-29)

An independent review against the code (16 findings). These override the task text below.

**Task order and splits.** Run: 1 → 2 → 3a → 3b → 4 → 5a → 5b → 5c → 6 → 7a → 7b → 8 → 9 → 10 → 11.
- **3a** hole count and board: Siêu cộng dồn (KC, Vàng), Liều ăn nhiều (−1 card, bestOfN 3, immunity), Hên xui, Đảo bài, Lá ma, Lá chung thứ sáu, the evaluator cap, the Aces rule (pre-deal hook).
- **3b** Cướp đoạt, Lời nguyền, Nhật thực + Kẻ phá đám (two-pass plan), Mắt diều hâu (both), Mồi lửa, Tích tiểu thành đại, the immunity rule, deck-short fizzle.
- **5a** stake multipliers and dead money (Mạo hiểm gia, Sới lớn) + the no-fold plumbing (Cấm bỏ bài; the Thần reuses it).
- **5b** the `afterPayout` hook and every transfer (Thách đấu ×2, Ép chia thưởng, Thuế thắng, Bom nổ chậm, and the hook the Thần duel uses).
- **5c** dice (3 tiers + Xúc xắc định mệnh's die), crits ×4/×5, jackpots, Trộm điểm, Cao thủ, Nâng tầm uy lực, the 500-hand conservation simulation.
- **7a** table state across hands, herald/dice/table-state events, `seatCleared` ends a reign and clears a bomb, the hand runner's no-fold (`FORFEIT`).
- **7b** dice sink via `balances.apply([], {kind:'chaos_dice'})`, credits/reasons, title marks into `HandSummary`, **flip the 39 cards to enabled** (see A-churn).

**A1 (5a) dead money.** Keep the multiplied extra out of `totalCommitted`: a `state.chaos.deadMoney` taken from the stack at the ante (blind.ts ~83) and at "play" (~249), added to `pots[0]` next to `carryOverIn` in `settle` (common.ts ~104); `cancelHand` refunds it too. Short stack: the real wager first (keeps the holder eligible), then the extra. Per-seat stake travels in `ChaosHandPlan`; `DECISION_PHASE` gains per-seat call amounts and the client stops hard-coding `fixedWager` (ui-kit reducer.ts ~214). **Ruling 1:** Mạo hiểm gia and Sới lớn multiply (×2 × step); Bỏ không mất / Bảo hiểm cover `totalCommitted` only, never dead money.
**A2 (5a/6/7a/9) no-fold.** One mechanism: `ChaosHandPlan.noFoldSeats` (Cấm bỏ bài: every seat but the holder, stored for the next hand as a `ChaosMark` kind `'noFold'`; a Thần: every seat); legal actions `['play']` for those seats; `TIMEOUT` plays; `DECISION_PHASE` gains `noFold?: number[]`; a new hand command `{type:'FORFEIT', seat}` lets a seat that left (hand-runner.ts ~160) and the bot fallback (~196) still fold; UI hides "Bỏ bài" for listed seats.
**A3 (1/6) table state plumbing.** `planHand` and `afterHand` take `table` in and return `table` out; `afterHand` gets an `outcomes` input the room copies from `state.chaos` (dice-of-fate crit, duel wins, dethrone, aces dealt). The bomb is an array (two holders may each plant one).
**A4 (3a/6) Aces.** A pre-deal hook pulls the Thần's Aces (then Siêu cộng dồn's) from the shuffled deck before hole cards are dealt (blind.ts ~88); order Thần → Siêu cộng dồn → normal deal.
**A5 (5b) transfers.** Add `SettleHooks.afterPayout(payoutBySeat)` between common.ts ~138 and ~141 so `SETTLEMENT` stacks include transfers; the bomb pays inside the engine on its third hand. **Ruling 2:** transfer order duels (Thách đấu, Thần thách đấu) → Ép chia thưởng → Thuế thắng; crit `net` keeps reading stacks (after transfers).
**A6 (7b/8) dice sink.** No `ChaosPort.debit`: write the sink like the table fee — `balances.apply([], {refId, fee, kind:'chaos_dice'})` (room.ts ~936), add `'chaos_dice'` to `SettlementMeta.kind` (repositories.ts ~67), key `chaos_dice:<room>:<hand>:<seat>:<uid>`, lower the stack at once, retry once, log on failure like a lost fee; add to `SINK_REASONS` (gm-service.ts ~259). The dice event carries `stack` like `CHAOS_CREDIT`.
**A7 (5c/7b) prize privacy.** Dice prizes and the dethrone's diamonds for humans go to `bonusAwarded` (private), never `awarded`; `CHAOS_DICE` names tier and count, never a card id. **Ruling 3:** a prize that finds the bonus hand full is dropped (as the dethrone's second card).
**A8 (3a/3b/4) deal privacy.** Add Siêu cộng dồn, Lá ma, Liều ăn nhiều, Đảo bài, Hên xui, Cướp đoạt to `PRIVATE_AT_DEAL` (engine.ts ~22); Cướp đoạt's event reaches holder and victims only, without cards. Mắt diều hâu gets its own peek event blanked by `filterEvent` (view.ts ~65) and a reconnect field. Kẻ phá đám never names a card that came from a private bonus play.
**A9 (3a/9) evaluator and board.** `evaluate` throws above 10 cards (evaluator.ts ~71): **Ruling 4:** the chaos path evaluates the best 5 over all combinations when more than 10 cards (test the 12-card maximum); the wild card is a `SettleHooks` override (`evaluateSeat`), the plain evaluator untouched. The 6th board card: the river deals 2; `DEAL_RESERVE` 10 → 11 (engine.ts ~16). Task 9 adds a 6-slot board (`CommunityCards.tsx` ~22; update "still five wide" in ChaosTable.test.tsx ~86) and lays out 1-card and 5-card hands.
**A10 (1) catalogue validator.** Add every spec §3 debuff kind to `CHAOS_DEBUFF_EFFECTS` (types.ts ~29); add `'end'` to `CHAOS_TIMINGS` and skip it in `planHand` like `wait`; **Ruling 5:** dice cards are wait-like: never in the bonus hand, roll at the end of the first hand the seat plays after receiving it.
**A11 (3b) two-pass plan.** Nhật thực / Kẻ phá đám need a second pass over all seats; Nhật thực sets a plan flag `eclipsed` so `afterHand` does not tick durations of eclipsed seats; Trộm điểm resolves at room level with a shield check. **Ruling 6:** a second copy of a charge card adds hands and keeps the held card's charge; two crits never multiply — the highest multiplier rolls.
**A12 (6/7b) title marks** live in `state.chaos` and are copied into `HandSummary` where it is built (room.ts ~929, before `chaos.settleHand`); "≥ 2 humans" counts humans seated at the table.
**A13 (8) stats/achievements.** Title counters before `patchForHand`'s early return for chaos hands (stats-service.ts ~95); a new metric touches `StatMetric`, `isStatMetric`, `zeroStats`, `COLUMNS`, schema, drizzle meta + journal; per-achievement reputation: widen `unlockWithin` to `grantWithin`, use `def.reputation` when present under refId `ach:<player>:<id>`, parse it in definitions.ts, use it in backfill.ts; new category `chaos`. **Ruling 7:** titles from a hand with a `settlementError` are lost (rare; same as other stats). Achievement names/descriptions in normal-web locales belong to Task 10.
**A14 credit reasons.** Reuse `chaos_crit` for every crit; add only `chaos_jackpot` (dice and Mạo hiểm gia jackpots), in all five places (`ChaosCreditReason`, `TxReason`, `CREDIT_REASONS` + cap SQL, `SOURCE_REASONS`, `CHAOS_CREDIT.multiplier` 2|3|4|5).
**A15 events.** Herald and end-of-hand dice are room events (messages.ts), not hand events; Xúc xắc định mệnh's die rides on `CHAOS_APPLIED.dice?: number[]`.
**A16 spec contradiction.** Spec §4.2 lets Gương reflect the curse onto the Thần; §3 says multi-seat effects are only blocked. Follow §3 (the Thần is immune anyway) — **deviation** for the CHANGELOG.
**A-ops (11).** GM rules cannot force a Thần. Give Cá chép a param `energy0` (0 in production data); `buildApp` accepts `chaosCatalogue?` (default `loadChaosCatalogue()`), `e2e-entry.ts` (never shipped) reads `E2E_CHAOS_CARDS` set in ops.config.ts `env`; the ops fixture JSON sets `d_carp` `energy0: 100`, `enabled: false`; the Thần case turns it on via GM rules (diamond only, Cá chép + two harmless wait diamonds), accepts any name in the herald (a bot may pick it). Dice case: same forcing, no hook.
**A-churn.** Task 1's 50/35/15 and Task 2's 39 cards change seeded draws: fix those tests in the same task; Task 2 adds the 39 cards with `enabled: false`; Task 7b flips them to enabled once the engine and server run them.

---

### Task 1: Core types, config, protocol for round three

**Files:** `packages/core/src/chaos/types.ts`, `packages/core/src/protocol/messages.ts`, `packages/core/src/hand/types.ts` (events), `packages/core/src/index.ts`; tests beside them.

**Produces:**
- New `ChaosEffectKind`s (names the implementer's, one per card behaviour in spec §6; reuse existing kinds where the spec's card is a parameter change of one, e.g. Siêu cộng dồn vàng = the same kind as Kim cương with params).
- `ChaosTiming` gains `'end'` (cuối ván, the dice).
- `HeldCard.charge?: number` (per-card state: Cá chép energy %, Siêu cộng dồn %, Đảo bài phase, Liều ăn nhiều hands, Mạo hiểm gia step) — kept with the card, lost with the seat.
- `ChaosTableState` (table-level, server-held): `god: { seat, playerId, kind: 'god' | 'demigod'… } | null` (one god; demigods per seat), `bomb: { carrier, owner, handsLeft } | null`, and what each reign needs (hands left, the chosen curse 1/2/3). Exported, pure.
- `ChaosCredit.multiplier` widens to `2 | 3 | 4 | 5`; new `ChaosCreditReason`s if the implementer needs them (jackpot, dice) and a `ChaosDebit` type (`{ seat, amount, reason: 'chaos_dice_burn', cardId, uid }`).
- `DEFAULT_CHAOS_CONFIG.tierWeights = { silver: 50, gold: 35, diamond: 15 }`.
- Events: `CHAOS_HERALD { kind: 'god' | 'demigod' | 'godslain', seat, playerId }` (public), `CHAOS_DICE { seat, cardId, dice: number[], outcome }` (public), and whatever the reign/bomb needs on `CHAOS_STATE` (public table state: who is god/demigod with hands left, bomb carrier) — never a held bonus card.
- `HandSummary` (server-kit `repositories.ts`) gains per-player `chaosTitles?: { ascended?: true; demigod?: true; slew?: number }` so stats can count them.
- Update every literal that must compile (fixtures, tests) without changing behaviour.

- [ ] Tests: validate/parse any new client message (none expected), config default 50/35/15, type-level fixtures compile. Commit `feat(core): round-three chaos types — new effect kinds, table state for the Thần and the bomb, card charge, dice and herald events, tiers 50/35/15`.

### Task 2: The catalogue — 39 cards as data and copy

**Files:** `packages/core/src/chaos/fixtures.ts` (`CHAOS_CARDS_SPEC`), `apps/normal-server/data/chaos-cards.json`, `packages/ui-kit/src/i18n/locales/{vi,en}/game.json` (`chaos.cards.<id>.name/desc`, timing words if new), catalogue tests.

**Consumes:** Task 1 kinds/timings.

**Produces:** 39 rows with ids (`s_…`, `g_…`, `d_…`), tier, family, effect, params (every number of spec §4–§6 lives in params: percentages, hands, multipliers, dice tables encoded as params), timing, modes (✱ cards `['playOrFold']` only: Mắt diều hâu (both), Cấm bỏ bài), debuff flag per spec §3 list. vi names exactly as spec §6 (Sới lớn, not Ép cược); vi descriptions in the voice of the existing 47; en drafted. `chaos-cards.json` deep-equals `CHAOS_CARDS_SPEC` (existing test). Tier counts 18+12 / 15+13 / 14+14.

- [ ] Tests: counts per tier, every id has vi+en name/desc, ✱ modes, debuff flags, JSON = spec. Commit `feat(core, normal-server, ui-kit): the 39 round-three chaos cards as data, named and described in vi and en`.

### Task 3: Engine — deal-time and decision-time cards

**Files:** `packages/core/src/chaos/{plan,engine,hold,bonus}.ts`, `packages/core/src/hand/blind.ts` (only where the deal/decision flow needs a hook); tests.

**Cards:** Siêu cộng dồn (KC, Vàng), Liều ăn nhiều (−1 card, bestOfN 3, steal immunity; its crit is Task 5), Lá ma (wild card — the hand evaluator must accept one wild seat card; keep it in chaos code, no change to plain ranking), Lá chung thứ sáu (6 board cards, best 5 of board+hole), Hên xui, Đảo bài, Lời nguyền, Cướp đoạt, Nhật thực, Kẻ phá đám, Mắt diều hâu (bạc, vàng: private peek events like Nhìn trộm), Mồi lửa / Tích tiểu thành đại (points per hand), immunity rule ("miễn nhiễm rút bài", spec §3), deck-short rule (fizzle), Aces scarcity rule.

- [ ] Tests per card (deterministic rng fixtures), immunity, deck-short fizzle, plain-table golden unchanged. Commit `feat(core): round-three deal and decision cards …`.

### Task 4: Engine — reveal-time cards and the debuff rules

**Files:** `packages/core/src/chaos/engine.ts` (+ split into a new `engine-reveal.ts` if engine.ts grows past ~600 lines), tests.

**Cards:** Hoán vị định mệnh, Ngược dòng, Gậy ông đập lưng ông, Đại hồng thủy, Đổi bài liều, Xào bài, Đổi lá hàng xóm, Xúc xắc định mệnh, Thách đấu (bạc/vàng: the duel comparison and outcome; the payment is Task 5), Bia đỡ đạn (redirect), Cao thủ. Debuff classification per spec §3; Khiên/Gương on multi-seat effects only block for the shielded seat; order of reveal effects documented (spirit of spec gốc §3.5).

- [ ] Tests per card, shield/mirror on multi-seat, one-debuff rules, immunity. Commit `feat(core): round-three reveal cards …`.

### Task 5: Engine — money cards, crits ×4/×5, dice

**Files:** `packages/core/src/chaos/{settle,engine}.ts`, `packages/core/src/hand/blind.ts` + `hand/common.ts` only for the stake multiplier and dead money; tests incl. a conservation simulation.

**Cards / rules:** Mạo hiểm gia (holder's whole stake × step, extra = dead money, all-in when short, jackpot 5 × base wager + 5 chaos points on a win), Sới lớn (table ×2 for 3 hands; holder bestOfN 2), Cấm bỏ bài (others' `fold` illegal next hand; auto-play plays), Ép chia thưởng, Thuế thắng, Bom nổ chậm (carrier passes each hand; owner paid at 3), Thách đấu payment, crits ×4/×5 (Liều ăn nhiều 50/30/20 for ×3/×4/×5), Xúc xắc vận may Bạc/Vàng/KC (spec §5 tables incl. triples; cards awarded through the bonus path; jackpots → credits; losses → `ChaosDebit`), Trộm điểm, Nâng tầm uy lực (a seat flag consumed by the next receive/draft — the per-seat tier is read by Task 7).

- [ ] Tests: each card, a 500-hand random simulation with the new cards keeping every point (stacks + credits − debits), plain-table golden unchanged. Commit `feat(core): round-three money cards, jackpots and the dice of fortune …`.

### Task 6: Engine — Cá chép hóa rồng, Thần Bài, Bán Thần

**Files:** new `packages/core/src/chaos/god.ts` (+ tests), hooks in `plan.ts` / `engine.ts` / `settle.ts`.

**Rules (spec §4, G5, G11, G12):** energy +5..7 % per lost hand, roll at the start of each hand, ≥ 100 % certain next hand; one Thần per table (second waits); win before ascending → Bán Thần next hand; reign 5 hands; Thần all Aces (2/3), crit ×2/×3/×4 at 40/25/10 %; curse chosen once at random for the first 3 hands (steal from all / duel each for 1 wager / shuffle others' hands); Khiên blocks the curse for its seat, Gương blocks (no reflection); curse not counted in the one-debuff limit; dethrone = Thần played and won no pot → every winner gets 2 random diamond cards (bonus path; overflow dropped) and a `slew` mark; Thần protected from steal/swap/shuffle/redeal of hole cards and from Nhật thực / Kẻ phá đám; no fold at "Chơi hoặc bỏ" while a Thần reigns; Bán Thần bestOfN 3 + crit ×2/×3 at 30/10 % for 5 hands; Thần leaving / frozen → no effects that hand, leaving ends the reign. Title marks per hand: `ascended`, `demigod`, `slew` — the ≥ 2-humans and not-a-bot-Thần rules are applied by the server (Task 7) from the marks plus seat kinds.

- [ ] Tests: every rule above incl. Review Focus 1 and 4. Commit `feat(core): Cá chép hóa rồng — the Thần Bài's five-hand reign, the Bán Thần, and the fall of a Thần`.

### Task 7: Server-kit — table state, events, per-seat draft tier, title marks

**Files:** `packages/server-kit/src/room/{room-chaos,room}.ts`, `chaos-port.ts`, `testing/memory-chaos.ts`, `repositories.ts` (HandSummary), gateway if needed; tests.

**Produces:** `ChaosTable` holds `ChaosTableState` across hands (cleared on close; Thần leaving ends the reign); broadcasts `CHAOS_HERALD`, `CHAOS_DICE`, table state in `CHAOS_STATE` and snapshots; per-seat draft tier for Nâng tầm uy lực (the seat's `CHAOS_OFFER` carries its own tier; `CHAOS_DRAFT` keeps the table tier); `ChaosPort.debit(...)` for dice losses (under a key, retried like credits); credits with the new multipliers/reasons; `HandSummary.players[].chaosTitles` filled only when the hand had ≥ 2 human seats, and `slew` only against a human Thần; bots use the new cards; privacy unchanged (no bonus card leaks).

- [ ] Tests: herald/dice events, reign across hands + reconnect snapshot (Review Focus 5), per-seat tier, debit pending/retry, title marks with 1 vs 2 humans and a bot Thần, room conservation with the new money cards. Commit `feat(server-kit): …`.

### Task 8: Normal server — ledger, cap, titles, migration

**Files:** `apps/normal-server/src/chaos/{chaos-service,chaos-port}.ts`, `src/gm/gm-service.ts` (SOURCE/SINK reason sets), `src/stats/*`, `src/achievements/*`, `data/achievements.json`, `data/items.json` (three `title_*` items), `drizzle/0008_*.sql` + schema; tests.

**Produces:** new credit reasons in the daily-cap query and GM source list; `chaos_dice_burn` (or the implementer's name) as a sink row, conserved; player stats `chaosAscensions`, `chaosDemigods`, `chaosGodsSlain` (migration 0008, additive) fed from `HandSummary.chaosTitles` — the only chaos stats counted (spec §4.4 exception to Q13); achievements `chaos_god` (ascensions ≥ 1), `chaos_demigod` (demigods ≥ 1), `chaos_godslayer` (slain ≥ 2) with rewards points + item + **per-achievement reputation** (extend the achievement data format: a `reputation` number that overrides the rule default; existing achievements unchanged); title items render like existing `title_*`.

- [ ] Tests: cap includes new reasons, debit sink conservation, stats from summaries, each title unlocks once with its points + item + reputation, migration applies on PGlite. Commit `feat(normal-server): …`.

### Task 9: UI — herald, Thần/Bán Thần marks, dice, toasts

**Files:** `packages/ui-kit/src/table/` (new `ChaosHerald.tsx`, `ChaosDice.tsx` + tests), `Seat.tsx`, `ChaosToasts.tsx`, `ChaosCardInfo.tsx` (charge/energy, reign hands), `client/reducer.ts` + `types.ts` (herald, dice, table state), `table.module.css`, locales, playground scenarios (a Thần reign, a 6-6-6 roll, a bomb).

**Produces:** herald banner across the screen ~3 s (gold-red glow, gentle shake; reduced motion: text only; tap to dismiss; never makes the page scroll; never over the result strip / draft longer than its 3 s); Thần seat aura + badge with hands left, Bán Thần badge; dice roll ~1.5 s visible to the table with the result (reduced motion: result only); toast lines for every new effect kind; card info shows energy %, Siêu cộng dồn %, reign hands left; "Bỏ bài" hidden/disabled while a Thần reigns or Cấm bỏ bài applies.

- [ ] Tests incl. reduced-motion; screenshots via the playground at 1920×940, 1366×768, 375×812, 360×780, 780×360 into the SDD shots folder. Commit `feat(ui-kit): …`.

### Task 10: Normal web — GM tab, titles, profile

**Files:** `apps/normal-web/src/screens/gm/ChaosTab.tsx` (39 new cards listed by tier; tier odds field default 50/35/15), title items in profile/wardrobe display, locales; tests.

- [ ] Tests + screenshots of the GM tab and a profile with the three titles. Commit `feat(normal-web): …`.

### Task 11: Ops, docs

**Files:** `apps/normal-web/e2e/ops/10-chaos.spec.ts` (+ helpers), `docs/player-guide.md` §6a (Vietnamese: the new cards, Thần Bài, dice, titles), `docs/known-limitations.md`, `docs/server-kit.md`, `docs/ui-kit.md`, `docs/normal-server.md`, `docs/test-matrix.md` (+ pinned counts if rows added).

**Produces:** an ops case that forces a Thần reign through the GM card rules (only Cá chép on, energy reachable — or a GM-only test hook if the rules alone cannot force it; record the ruling) and checks the herald, the seat badge, no-fold, at desktop and the S25 sizes; a dice case (only dice cards on) checking the roll and the toast; the rest of the ops pack green.

- [ ] Commit `test(e2e), docs: …`.
