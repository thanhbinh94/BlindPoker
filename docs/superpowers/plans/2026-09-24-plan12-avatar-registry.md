# Avatar asset registry and generation loop — Implementation Plan (Plan 12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A committed registry of every avatar picture still to generate, and a CLI that renders prompts, collects downloads, verifies pictures against the pipeline, and ingests the good ones — so Claude can drive ChatGPT in the user's Chrome in batches without the user in the loop.

**Architecture:** One data file `assets/avatar-src/registry.json` (queue + history) and one CLI `apps/normal-web/scripts/avatar-registry.mjs` with subcommands `next | collect | verify | ingest | approve | status`, built on the existing pipeline modules (`scripts/avatar-pipeline/*.mjs`: `readPicture`, `removeChroma`, `alphaBBox`, `measure`, `ingest`, `runChecks`). The Chrome-driving step is done by Claude with the Claude in Chrome tools, following a written procedure; no code for it.

**Tech Stack:** Node 22 ESM, sharp (already a devDependency of normal-web), Vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-24-avatar-asset-registry-design.md` (this plan argues from it; §3 schema, §4 procedure, §5 verify rules, §6 ingest/batches, §7 seed).

## Global Constraints

- The registry never duplicates rarity, achievements, frame geometry or catalogue names; it points at `catalog` ids. (Spec §2.)
- `verify` never writes into `apps/normal-web/public/avatar/`; it ingests into a temp dir via the pipeline's `--out`. (Spec §5.)
- Max 3 attempts per asset; the 3rd `ng` sets `blocked`. (Spec §3.)
- A `null` prompt is re-rendered on every read from `templates[kind|slot]` + `look`; a string prompt is a manual override. (Spec §3.)
- `assets/avatar-src/.gitignore` gains `!registry.json`; the pictures themselves stay ignored.
- Commits end with a blank line then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- In Bash on this machine, `export PATH="$PATH:$(npm prefix -g)"` before pnpm; no long heredocs (use Write/Edit).

---

### Task 1: Registry file, schema, prompt rendering, `next`, `status`, `approve`

**Files:**
- Create: `apps/normal-web/scripts/avatar-registry.mjs` (CLI entry) and `apps/normal-web/scripts/avatar-registry/{registry.mjs,prompts.mjs,queue.mjs}`
- Create: `assets/avatar-src/registry.json` (seed below), modify `assets/avatar-src/.gitignore` (`!registry.json`)
- Test: `apps/normal-web/test/avatar-registry.test.ts`
- Modify: `apps/normal-web/package.json` scripts: `"avatar:registry": "node scripts/avatar-registry.mjs"`

**Interfaces (produces):**
- `readRegistry(path) → { version, meta, templates, assets }` validating: unique ids; `kind ∈ base|expression|item|aura|frame|bot`; item has `slot ∈ head|face|outfit`; `reference` is a filename or `@<id>` of an existing asset; `ingest.as` non-empty; `status` in the allowed set; `attempts` array. Throws with the offending id.
- `writeRegistry(path, registry)` — pretty JSON, 2 spaces, LF, trailing newline.
- `renderPrompt(asset, registry) → string`: template by `asset.kind` (item → by `asset.slot`), `{{look.<key>}}` substitution (missing key → throw), `{{ref}}` → reference filename; then `+ "\n" + fixLine(reason)` for each **distinct** `reason` code among failed attempts, from the fixed table in spec §3 (`redrawn`, `tears`, `hair_colour`, `background`, `cropped`, `strap` → "The tank top must be completely gone: no straps, no gray fabric anywhere", `scope` → "Change nothing outside the requested area", `style` → nothing (user's taste; no line)).
- `ready(asset, registry) → boolean`: status ∈ `todo|ng|rework-*` (not `blocked|ok|approved|generated`) AND reference resolves (file exists in `assets/avatar-src/` or the `@id` asset is `ok|approved`).
- `nextAssets(registry, { limit }) → asset[]` ordered by priority: item(head, face, outfit on f01) → base → expression → aura → frame → bot; stable by array order within a group.
- CLI: `next [--limit n] [--json]` prints, per asset: id, file, absolute reference path (or "none"), attempt number (n+1), and the rendered prompt in a fenced block. `status` prints counts per status and lists `blocked` with reasons. `approve <id…>|--batch` sets `ok → approved` (`--batch`: every `ok`). `reject <id…> [--reason style]` sets `rework-<n>` with an attempt-less reason record (`attempts[].verdict = 'ng', reason, by: 'user'`).

- [ ] **Step 1: Write failing tests** for validation (bad kind, dup id, dangling `@ref`), `renderPrompt` (substitution, missing key throws, fix lines appended once per distinct reason, `style` adds nothing, override string wins), `ready`/`nextAssets` (ordering, `@ref` gating, blocked skipped, limit), `approve`/`reject` transitions.
- [ ] **Step 2: Run** `pnpm --filter @bp/normal-web exec vitest run test/avatar-registry.test.ts` → FAIL.
- [ ] **Step 3: Implement** the three modules + CLI.
- [ ] **Step 4: Seed `registry.json`** exactly as listed under "Seed" below (templates + 61 assets). `node scripts/avatar-registry.mjs status` must print 61 todo.
- [ ] **Step 5: Tests pass; `pnpm lint`; commit** `feat(avatar-registry): registry, prompts, queue`.

### Task 2: `collect`, `verify`, `ingest`

**Files:**
- Create: `apps/normal-web/scripts/avatar-registry/{collect.mjs,verify.mjs,ingest.mjs}`
- Test: `apps/normal-web/test/avatar-registry-verify.test.ts` (synthetic pictures built with sharp, as `avatar-pipeline.test.ts` does)
- Modify: `docs/avatar-2d.md` (new section "Sổ tài sản và vòng lặp sinh ảnh": schema, the Chrome procedure of spec §4 step by step, verify reasons table, batch routine), `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` §9 one line pointing to Plan 12.

**Interfaces (produces):**
- `collect <id> --chat <url> [--downloads <dir>] [--file <path>]`: `--file` takes an explicit PNG; otherwise the newest `*.png` in `--downloads` (default `%USERPROFILE%\Downloads`) modified after the asset's last attempt (or within the last 30 min if none). Copies to `assets/avatar-src/<asset.file>`; an existing file is renamed `<name>.prev<k>.png` first. Appends attempt `{ n, at, chat, file, verdict: null }`, status → `generated`. Refuses if the newest PNG is older than the last attempt (prints what it found).
- `verify [<id…>] [--keep-tmp]`: every `generated` asset (or the given ids). Rules and reason codes exactly as spec §5: `size`, `background` (4 corners alpha 0; checkerboard = >5 % of pixels in the outer 8 px band are opaque near-white/near-grey), `drift` (bbox vs reference picture, each edge ≤ 12 px; reference = the picture file the asset references, resolving `@id` to that asset's `file`), `heads` (2.0–2.5 via `measure` after `removeChroma`), `hair_colour` (mean colour of opaque pixels in the reference's top-of-head band rows 250–330 x 330–700 @ source px, vs the same in the picture, RGB distance ≤ 12; expression/item only), `scope` (fraction of pixels whose RGB distance to the reference at the same coordinates > 40, counted only outside the allowed region: expression → outside head region y < 250 @1x-equivalent scaled to source; head/face item → outside CROP∪(y < HEAD_LIMIT_Y); outfit → above OUTFIT_TOP_Y; must be < 1 %), `pipeline` (copy `public/avatar/` to a temp dir, run the pipeline's `ingest` with the asset's `ingest` spec and `--out tmp`, then `runChecks` on the produced layer names; any failure → `check:<Cn>`), aura/frame: `size` (square ≥ 1024), `background`, `hollow` (mean alpha inside radius 40 % of half-width < 0.05). First failing rule wins; record `measure` (all numbers computed so far) on the attempt; status → `ok` or `ng` (3rd ng → `blocked`). Temp dir removed unless `--keep-tmp`.
- `ingest [<id…>]`: for `ok|approved` assets with `ingested !== true`: run the real pipeline ingest (`--as`, `--base`, `--variant`, flags) into `public/avatar/`; then, for a base: check `BASES`/`BASE_WEAR` (manifest.mjs), `avatar-bases.json` and the i18n `bases.<id>` keys and print exactly what is missing (do not edit); for an item variant: add `variants.<wear>` to `items.json` if absent; set `ingested: true`. Prints the pipeline's registration line.

- [ ] **Step 1: Failing tests**: `collect` with a fake downloads dir (newest wins, older-than-attempt refused, prev rename); each verify rule with one passing and one failing synthetic picture (a 1024×1536 transparent PNG with a drawn figure; a checkerboard background; a shifted copy for drift; a recoloured hair band; a change outside the head region; a square ring with/without a hollow); `ingest` marks `ingested` and adds `variants.m` on a fixture `items.json`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** Reuse pipeline functions by import; do not fork them.
- [ ] **Step 4: Real-data smoke** (not a test): `verify` on the existing real pictures by temporarily seeding attempts for `item_outfit_tuxedo01` (already ingested → skip in seed; instead run `node scripts/avatar-registry.mjs verify --dry <id>` … simpler: add a `--picture <path> --as <spec>` dry mode to `verify` that scores one file without touching the registry) against `assets/avatar-src/item_outfit_tuxedo01.png` (expect ok) and `assets/avatar-src/m01_surprised.png` (expect ok) and report the numbers.
- [ ] **Step 5: Docs, tests pass, lint, typecheck; commit** `feat(avatar-registry): collect, verify, ingest` and `docs(avatar): registry and generation loop`.

---

## Seed (Task 1 Step 4) — templates and the 61 assets

Templates (`{{look.*}}` keys named per kind):

```
base: Keep this exact image: same body shape, same pose, same size and position in the frame, same gray tank top and shorts, same transparent background, same semi-painterly anime rendering. Same head size and shape, same eye size and eye placement, similar hair volume on top of the head. Change only the hair, the eye colour, the expression and the skin tone:
Hair: {{look.hair}}
Eyes: {{look.eyes}}
Expression: {{look.expression}}
Skin: {{look.skin}}
Hair must not cover the tank top or the arms: long hair falls behind the back. Skin tone applies to the face, neck, arms and legs. Do not move, zoom, crop or redraw the body, arms, legs, clothing or framing.

expression: Keep this exact image: same character, same pose, same size and position in the frame, same image size, same hair and hair colour, same skin tone, same tank top and shorts, same transparent background. Change only the eyes and mouth to this expression: {{look.expression}}. Do not move, zoom, crop, recolour or redraw anything else.

head: Keep this exact image: same character, same pose, same size and position in the frame, same neutral face with open eyes, same hair colour, same tank top and shorts, same transparent background. Add only this: {{look.description}}, sitting naturally on top of the head, fully inside the image. The small hair strand on top of the head is hidden under it. The hat is at most slightly wider than the hair. Face and the rest of the hair unchanged. No glasses. Do not move, zoom, crop, recolour or redraw anything else.

face: Keep this exact image: same character, same pose, same size and position in the frame, same neutral face with open eyes, same hair and hair colour, same tank top and shorts, same transparent background. Add only this: {{look.description}}. No hat. Do not move, zoom, crop, recolour or redraw anything else.

outfit: Keep this exact image: same character, same pose, same size and position in the frame, same neutral face with open eyes, same hair and hair colour, same skin tone, same transparent background. Replace the gray tank top and shorts completely with: {{look.description}}. The tank top must be completely gone: no straps, no gray fabric visible anywhere. Simple shapes, few folds, no small patterns, no logos, nothing in the hands. No hat, no glasses. Do not move, zoom, crop, recolour or redraw anything else.

aura: A decorative circular aura effect for a character portrait: {{look.description}}. Centered in a square image, the center area is completely empty and transparent, effect concentrated in a ring around the center, soft glowing painterly style allowed, transparent background outside the effect, no character, no text, no watermark.

frame: A circular decorative frame ring for a player avatar: {{look.description}}. Perfectly round, the inside of the ring is completely empty and transparent, ring thickness about 8 percent of the image width, centered in a square image, clean cel-shaded style with colored outlines, transparent background inside and outside the ring, no character, no text, no watermark.

bot: Keep this exact image's proportions, pose, size and position in the frame, and the transparent background, but redraw the character as a cute chibi robot: {{look.description}}. Same 2.25-heads-tall proportions with an oversized round head, same standing pose with arms slightly away from the body, no hair, no clothing, smooth rounded metal body, cel-shaded with colored outlines, semi-painterly anime rendering. Face: {{look.expression}}. Do not move, zoom or crop.
```

Expression looks (used by every `<base>:<expr>` and `bot_<n>:happy`): happy = `a happy expression: eyes curved into happy arcs, wide open smile`; sad = `a sad expression: drooping eyes with a small tear highlight, downturned mouth`; surprised = `a surprised expression: eyes fully round and wider, small round open mouth. No tears`; closed = `eyes gently closed, calm small smile`; sleep = `sleeping: eyes closed, mouth slightly open, and add one small "z" letter floating just beside the head near the temple`. Bot happy = `a happy face: LED eyes as upward arcs, wide LED smile`.

Assets (id → reference, file, ingest, look):

1. `item_outfit_casual01` — ref `f01_candidate_1.png`, file `item_outfit_casual01.png`, ingest `item:outfit:casual01`, look.description `a plain white short-sleeved t-shirt with a round crew neck that fully covers both shoulders and the chest, blue jeans down to the ankles, white sneakers. Unisex cut`, color white/blue, style casual. Status `rework-1` with one attempt `{n:1, verdict:'ng', reason:'strap', by:'claude', file:'item_outfit_casual01.png'}`.
2–8. heads, ref `f01_candidate_1.png`, ingest `item:head:<code>` flags `--hides-hair-front` for all: `dealer_visor01` "a green dealer visor cap with a translucent green brim"; `beret_red01` "a red beret tilted to the right"; `crown_gold01` "a small golden crown with small red gems"; `conical_hat01` "a Vietnamese conical palm-leaf hat with a thin chin strap"; `beanie01` "a soft knitted dark teal beanie"; `party_cone01` "a short striped party cone hat with a small pom-pom, about one third of the head height"; `hood_black01` "a black cloak hood covering the top and back of the head, the side hair stays visible as in the reference" (flags also `--hides-hair-back`).
9–11. faces, ref `f01_candidate_1.png`, ingest `item:face:<code>`: `sunglasses01` "black sunglasses over the eyes with slightly transparent lenses, eyes faintly visible"; `masquerade01` "a small black masquerade mask with gold trim covering only the area around the eyes, with cut-outs showing the eyes"; `eyepatch01` "a black eyepatch over the left eye with a thin strap, the other eye unchanged".
12–19. auras, no reference, file `aura_<code>.png`, ingest `item:aura:<code>`: water01 "blue flowing water ripples with white sparkles"; fire01 "warm orange and red flame ring"; wind01 "pale green swirling wind streaks with small leaves"; earth01 "floating brown rock fragments with green moss and tiny glowing crystals"; lightning01 "crackling blue-white lightning arcs"; sakura01 "pink cherry blossom petals floating in a ring"; gold_cards01 "swirling golden light ribbons with small floating playing card suit symbols, spade heart club diamond"; ice01 "pale blue ice crystals and frost sparkles".
20–25. frames, no reference, file `frame_<code>.png`, ingest `item:frame:<code>`: bronze "a simple bronze metal ring"; silver "a polished silver ring with small engraved lines"; gold "a shiny gold ring with tiny gems"; monthly "a blue and white ring with a small calendar star emblem at the top"; veteran "a dark steel ring with laurel leaves on both sides"; founder "an ornate gold and crimson ring with a small crown emblem at the top".
26–29. bases, ingest `base:<id>`, file `<id>_candidate_1.png`:
   - `f02` wear f, ref `f01_candidate_1.png`: hair "long straight black hair falling behind the back, blunt straight bangs, two straight side locks ending at the chin, one soft highlight band, navy-black outlines"; eyes "iris gradient from deep violet to soft gray"; expression "calm gentle closed smile"; skin "very fair porcelain with a soft pink blush"; codes hair_style long_straight, hair_color black, eye_color violet_gray, skin_tone porcelain.
   - `f03` wear f, ref `f01_candidate_1.png`: hair "short wavy platinum blonde hair above the shoulders, side-swept bangs, one small braid resting above the left shoulder, warm gray outlines"; eyes "iris gradient from deep green to bright lime"; expression "playful open grin"; skin "warm tan brown with a soft gradient on the cheeks"; codes short_wavy, platinum, green, tan.
   - `m02` wear m, ref `m01_candidate_1.png`: hair "short neat black hair, fringe swept to the left showing part of the forehead, one soft highlight band, navy-black outlines"; eyes "iris gradient from dark slate to pale blue-gray, straight thin eyebrows"; expression "cool composed look, small straight closed mouth"; skin "light fair with a faint blush"; codes short_neat, black, slate, fair.
   - `m03` wear m, ref `m01_candidate_1.png`: hair "short curly black hair with tight round curls, tidy sides, dark outlines"; eyes "iris gradient from deep brown to warm chestnut, thick friendly eyebrows"; expression "wide friendly open smile"; skin "deep brown with a soft warm gradient on the cheeks"; codes short_curly, black, brown, deep_brown.
30–49. expressions `<base>:<expr>` for the four new bases × happy/sad/surprised/closed/sleep: ref `@<base>`, file `<base>_<expr>.png`, ingest `expr:<base>:<expr>` with `base: <base>`.
50–57. bots `bot_0`…`bot_7`, ref `f01_candidate_1.png`, file `bot_<n>.png`, ingest `bot:<n>` (NOTE: the pipeline has no `bot:` target yet — Task 2's `ingest` must print "not supported yet" for bots and leave them `ok`; a later plan adds the pipeline target), look.expression "neutral LED eyes, small LED smile", descriptions: 0 "white and sky-blue casing, round LED eyes"; 1 "black and orange casing, visor-shaped LED eyes"; 2 "mint green casing, small antenna, round LED eyes"; 3 "pink and white casing, heart-shaped LED eyes"; 4 "gold casing with a small crown-shaped crest, round LED eyes"; 5 "red and cream casing, square LED eyes"; 6 "purple casing with a single wide visor LED eye"; 7 "teal and white casing, two antennae, round LED eyes".
58–61. (Reserved: `bot_<n>:happy` for n 0–7 would make 65; include them too: ref `@bot_<n>`, file `bot_<n>_happy.png`, ingest `bot:<n>:happy`, look.expression = bot happy.) Total assets: 69. The spec's "61" counted bots once; the registry seeds 69.

## Self-review

- Spec coverage: §3 schema → T1; §4 procedure → docs in T2 (no code by design); §5 verify → T2; §6 ingest/status → T1/T2; §7 seed → T1 step 4; §8 tests → both tasks.
- Placeholders: none; every prompt and look is literal above.
- Consistency: bot ingest target does not exist in the pipeline — called out explicitly; verify's `pipeline` rule must skip bots (`reason: null`, note "pipeline: skipped (bot)").
