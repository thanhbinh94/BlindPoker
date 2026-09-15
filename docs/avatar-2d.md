# The chibi avatar: assets and pipeline

The Normal edition's avatar is a **chibi**: two locked bases (`f01`, `m01`), each drawn as a stack of
PNG layers on a fixed frame, dressed from a wardrobe of items that are themselves PNG layers. Nothing
is 3D, nothing is rendered on the server, and nothing is rendered by the browser either beyond laying
out `<img>` tags — every picture that reaches a screen was drawn (or generated) ahead of time and
shipped as a file.

Design: `docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` (cited §n below). Character rules
and prompt material: `docs/avatar/01-quy-cach-tai-san-nhan-vat-kho-do.md` (D01) and
`docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md` (D02), both Vietnamese, written for whoever
is drawing or generating the next picture. This page is for whoever is writing code around them, and is
in English like the other developer docs here. This page replaces `docs/avatar-assets.md`, which
described the deleted 3D pipeline (`docs/superpowers/specs/2026-09-05-avatar-3d-design.md`).

This app has replaced its avatar system twice: a flat SVG (Plan 6), then a 3D character built from
`.glb` meshes (Plan 8), and now this. Nothing about either predecessor survives in the code; the specs
are kept only as history.

---

## 1. The frame, and every number that never changes once a picture exists

Every layer is a PNG, `384×448` at `@1x` and `768×896` at `@2x` — a browser picks the density it needs
through `srcset`, so a 32 px seat plate and a 240 px profile figure share one set of files. A handful of
geometric constants are shared by every layer that has ever been drawn on it, and changing any of them
invalidates every picture that exists (design §3, D01 §3):

| | Value |
|---|---:|
| Frame | 384 × 448 (`@1x`) |
| Body box | 224 × 336 at (80, 72) |
| Vertical axis | x = 192 |
| Baseline | y = 408 |
| Avatar crop (the round portrait) | 208 × 208 at (88, 40) |
| Frame ring (the `frame` item's own decoration) | 260 × 260, centred on the crop |

The **crop** is what a seat plate, the lobby bar and a wardrobe tile actually show — `Chibi frame="head"`
in the kit crops to it with `object-position`, so a "head" item only has to sit inside that box, not be
drawn to it. The **frame ring** sits *outside* the crop on purpose (D01 §5): a `frame` item decorates the
round portrait's rim, and drawing it inside the crop's own 208×208 would clip it.

2026-09-15: the crop moved from 160 × 160 at (112, 48) and the ring from 208 × 208 — the first real F01
picture showed the old crop cutting the face at the eyes. The axis (x = 192) and the crop's centre y = 144
are unchanged.

## 2. Layers, bottom to top, and the hide rules

```
10  aura        item, optional — dropped from the head-crop view (it would bleed off a circular edge)
20  hairBack     the base's own hair-behind-the-body layer
30  body         the base itself
40  outfit       item, required — every base wears exactly one
50  face         the base's own expression layer — six of these, one per expression
60  hairFront    the base's own hair-in-front-of-the-body layer
70  face (item)  optional — glasses, a mask; a face *accessory*, distinct from layer 50's expression
80  head         item, optional — a hat, a hood, a crown
90  frame        item, optional — the portrait's rim decoration; dropped from the full-body view
```

Two hide rules, both carried on the `head` item and both about hair (D01 §4.3): `hidesHairFront` drops
layer 60, `hidesHairBack` drops layer 20. A hood covers the hair from every angle this frame ever shows,
so it sets both; a beret sits on top of it and sets neither. `head_hood_black01` is the one stage-1 item
that needs both (`apps/normal-server/data/items.json`).

2026-09-15: AI bases are flat — one picture with hair, face and body baked together — so `ingest --as base`
writes L30 as the whole figure, the neutral face L50 as the whole head region (the portrait crop above
`FACE_LIMIT_Y` = 250), and L20/L60 as empty frames marked `"empty": true`; a hood-style item that hides
hair can therefore only cover what its own picture covers, because the hide rules have no separate hair
layer left to drop.

Bots draw only two of these layers — `body` (30) and their own expression `face` (50) — because a bot
has no wardrobe at all (`packages/ui-kit/src/avatar2d/layers.ts`, `layersFor`).

Stage 2 dropped the `backdrop` layer (order 5, behind everything) that an earlier draft of this table
reserved: nothing ever drew it, no item or base ever shipped a file for it, and it is gone from `LAYERS`
(`apps/normal-web/scripts/avatar-pipeline/frame.mjs`) and from `AssetRef['layer']`
(`apps/normal-server/src/inventory/items.ts`) alike.

## 3. File names

```
base_<baseId>_L<layer>                       the base's own body/hair layers — no density suffix here
base_<baseId>_face_<expression>_L50          one of the base's six expression layers
item_<slot>_<code>_L<layer>                  a wardrobe item — <layer> is the slot's own fixed number
bot_<index>_L30                              a bot's body
bot_<index>_face_<expression>_L50            a bot's expression
```

A file on disk always carries a density suffix the name above does not: `…@1x.png` / `…@2x.png`. The
manifest and every catalogue reference name the file **without** the suffix — `AvatarAssets`
(`packages/ui-kit/src/avatar2d/AvatarAssets.tsx`, `assetUrl`) appends it per density when it builds the
URL, so one stored name always resolves to both files.

`<layer>` is not free to pick per item: it is fixed by the slot (`head` 80, `face` 70, `outfit` 40,
`aura` 10, `frame` 90 — `SLOT_LAYER` in both `apps/normal-server/src/inventory/items.ts` and
`apps/normal-web/scripts/avatar-pipeline/manifest.mjs`), and both the server's catalogue loader and the
pipeline's own `check` command (`C8`) refuse a name whose layer disagrees with its slot.

## 4. The pipeline (`apps/normal-web/scripts/avatar-pipeline.mjs`, Node + `sharp`)

Four commands, each documented at length in the script's own header comment — read that first for every
flag; this is the shape of the four, not a copy of it.

```bash
pnpm --filter @bp/normal-web avatar:placeholder
# Draws the whole stage-1 set as labelled stand-ins (a shape plus the file's own name, so a wrong
# ingest is obvious at a glance) and writes both copies of the manifest. Idempotent: an entry the
# manifest already marks real (see §6 below) is left exactly alone, so re-running this after some
# real art has landed only re-draws what is still a stand-in.

pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as base:f01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as expr:f01:happy
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:head:tophat01
# One generated (or hand-drawn) picture in, one layer at @1x and @2x out, plus its manifest entry.
# `base:` and `expr:` ingest a base's own body or one of its six expressions; `item:<slot>:<code>`
# ingests a wardrobe piece, always drawn on F01 (D02 §5) and shared with M01 automatically — the two
# bases are built to the same silhouette. Background removal keys off #00FF00 by default (`--white`
# for a white background instead) and, for an item, the layer is found by *diffing against the base's
# own body* rather than by any manual selection — the largest connected region that differs from the
# aligned base, edge-softened by 1 px. `--dry-run` prints what would happen and writes nothing.

pnpm --filter @bp/normal-web avatar:check
# Runs the ten acceptance criteria (D01 §10) over every committed layer and prints a pass/fail table;
# exits 1 on any failure. Pass names to check only those (`avatar:check base_f01_L30`), or `--skip C6`
# for the one criterion (an outfit must cover the base's underwear) that has no coordinates in the
# design and occasionally needs a human override.

pnpm --filter @bp/normal-web avatar:sheet
# Composes every item on both bases, across all six expressions, into docs/avatar-2d-sheet.png — the
# eyeballed style gate before a picture is ever committed (design §6, §9).
```

`placeholder` and `ingest` write into `public/avatar/` by default; pointing either at a different `--out`
directory (as the pipeline's own tests do) also stops the server's copy of the manifest
(`apps/normal-server/data/avatar-manifest.json`) from being touched — the only way the whole pipeline is
testable without disturbing the committed artefact.

## 5. The ten acceptance criteria (`avatar:check`)

| | Checks (D01 §10) |
|---|---|
| C1 | The frame, exactly, at both densities — one pixel out is a fail |
| C2 | Nothing opaque on the outermost row or column |
| C3 | The empty part really is empty: no alpha at all more than 3 px outside the solid shape |
| C4 | No white fringe — the soft rim is the shape's own colour, not white bled in from the key |
| C5 | `head`/`face` items fit inside the 208×208 crop |
| C6 | An outfit covers the base's underwear (no coordinates in the design; `--skip C6` exists for it) |
| C7 | The `@1x` is really the `@2x` scaled down, not redrawn separately |
| C8 | The file name follows §3 above, with a layer that matches its slot |
| C9 | The manifest lists it, at that layer and that frame size |
| C10 | The `@2x` is inside the per-file share of the 6 MB stage-1 budget, and the manifest's byte count matches the file on disk |

## 6. Placeholder vs. real

Every manifest entry carries exactly one of two flags, never both: `"placeholder": true` for a stand-in
`avatar:placeholder` drew, `"real": true` for a layer `avatar:ingest` wrote from an actual picture.
`avatar:placeholder` reads this before it draws anything — an entry already marked `real` is left alone,
so running it again after some art has landed cannot silently overwrite that art with a shape. There is
no path back from `real` to `placeholder`: ingesting is the one-way door design §9's roadmap describes,
walked one item at a time as pictures are produced.

A real entry may also carry `"empty": true`: an AI base's hair layers, which ship as fully transparent
frames (§2). `avatar:check` holds such a layer to being fully transparent at both densities (C3) and
reports C4–C6 as `-` for it; a fully transparent layer *without* the mark fails C3.

`apps/normal-web/public/avatar/` ships whatever mix of the two the repository is currently at. Nothing
downstream — the server's catalogue, the kit's `Chibi`, any test — treats the two differently; a
placeholder is exactly as valid a layer as a real one, just not the picture the design wants for good.

## 7. How the kit composes a chibi

`@bp/ui-kit`'s `Chibi` (`packages/ui-kit/src/avatar2d/Chibi.tsx`) takes a `ChibiConfig` — a `BaseRef`
plus a `WearRef` per equipped slot — and stacks one `<img>` per layer `layersFor` returns (§2 above),
positioned by CSS `z-index` rather than draw order, inside a box that is either the full 6:7 frame
(`frame="full"`) or the round head-crop (`frame="head"`, cut to the 208×208 window by a percentage
`left`/`top`/`width`/`height` on the layer stack, not `object-position` — a fixed geometry computed once
from the `size` prop stayed wrong once an ancestor shrank the rendered box below `size`; a percentage of
the root's own box is correct at whatever size it actually renders).
Each layer ships `srcset` at both densities and loads lazily; a table can hold up to nine seats' worth
at once (up to 72 `<img>` elements), which stage 1 accepts and a canvas-based seat composite is left for
later (design §7).

`hashChibi` folds the *configuration* — the equipped ids, not the expression or the frame — into a short
stable string, stamped on the root as `data-chibi-hash`. Two different configurations must not share
one; the same configuration must arrive at the same one wherever it is drawn (a seat plate, the lobby
bar, an outfit-bar tile) — that identity is what `test/footprint.test.ts`, `e2e/avatar2d.spec.ts` and the
outfit bar itself all key off.

Bots never carry a `ChibiConfig` at all: `botChibi(index)` answers a `BotChibi` — just a body and a face,
no wardrobe — and `layersFor` branches on `subject.kind` at the top, before any of the optional-slot logic
runs.

## 8. How Lite gets its assets

Lite has no wardrobe and no per-account cosmetic config (design §7 — "Không tủ đồ, không profile"), so
every human at a Lite table draws the same deterministic figure the kit itself can produce with nothing
from the server: `defaultChibi(displayName)` seeds a chibi from the player's own name, the same way on
every device, with no request involved — always wearing `item_outfit_casual01_L40`, the one default
outfit (`packages/ui-kit/src/avatar2d/defaults.ts`). `apps/lite/scripts/build.mjs`'s `copyAvatarAssets()`
(`isLiteAvatarFile`) copies the `base_*` and `bot_*` files, plus that one outfit's `@1x`/`@2x` pair, out of
`apps/normal-web/public/avatar/` into `dist/public/avatar` — never any *other* wardrobe item, because Lite
ships no store to buy them from — as one step of a full build, after the web bundle and before the SEA
blob is assembled. There is no dev-time equivalent of that copy (`docs/known-limitations.md`):
`pnpm --filter @bp/lite dev` needs `apps/normal-web` built at least once first, or every chibi 404s.

## 9. Adding an item, end to end

1. **The picture.** Draw it, or generate it against the locked block (D02, always **on F01** — the two
   bases share a silhouette, so one picture serves both) and green-screen or white-background it per
   D01 §8. Then `avatar:ingest <file> --as item:<slot>:<code>` (§4 above); `--dry-run` first if unsure,
   and `avatar:check <name>` after, since ingest does not run the acceptance criteria itself.
2. **The catalogue.** Add the row to `apps/normal-server/data/items.json`: `id`, `slot`, `rarity`,
   `isDefault`, and `asset.{layer, file}` — `file` is the manifest name `ingest` just wrote, with no
   density suffix. The server validates every row against the committed manifest at boot
   (`apps/normal-server/src/inventory/items.ts`), so a row naming a file that was never ingested — or
   naming the wrong layer for its slot — fails fast rather than 404ing per request.
3. **An alias, if the id is renamed.** `apps/normal-server/data/item-aliases.json` maps an old id to its
   replacement (or to `null`, dropped entirely) so an account that equipped the old id keeps wearing
   something rather than losing the slot silently on the next read.
4. **The name, in both languages.** `items.<id>` in `apps/normal-web/src/locales/vi/normal.json` *and*
   `.../en/normal.json` — `locales.test.ts` fails if either is missing, if one language has a key the
   other does not, or if a name exists for an id the server does not serve.
5. **How it is won.** A grant in `apps/normal-server/data/achievements.json`, or a slot in the daily
   calendar (`head`/`face`/`aura`/`frame` only — design §5.2), or nothing at all — the wardrobe lists the
   whole catalogue for every tab and locks whatever a player does not own, so an item nobody owns is an
   item nobody can equip, not an item nobody sees.
6. **The contact sheet.** `avatar:sheet` re-composites everything, item included, into
   `docs/avatar-2d-sheet.png` — look at the new piece beside every other one before committing it.
7. **Commit the PNGs, the manifest and the catalogue together.** The layers are a committed build
   artefact, never generated at build time — no CI runner has the AI tool, and the originals in
   `assets/avatar-src/` are gitignored on purpose (design §6, §10 — see also `docs/known-limitations.md`
   on the licensing question that keeps them out of the repository at all).

There is no drawing step and no per-item code on the client: `Chibi` is generic over whatever layers the
manifest and the catalogue hand it.
