# The chibi avatar: assets and pipeline

The Normal edition's avatar is a **chibi**: a base — `f01` and `m01` today, and whatever
`apps/normal-server/data/avatar-bases.json` names tomorrow (§9.1) — drawn as a stack of
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
| Aura (the `aura` item's effect, 2026-09-24) | 400 across, centred on (192, 240) — wider than the frame |

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

2026-09-17: two refinements. **The face layer gives up the torso column**: below y 236 it holds nothing in
x ∈ [150, 234] (`TORSO_COLUMN`), because layer 50 sits above the outfit and the base's tank-top straps there
showed over every collar; hair tips either side stay. **A strand of hair above the head top goes to L60**:
`ingest --as base` cuts the rows above `measure`'s head top plus `STRAND_MARGIN` (6 px) — F01's ahoge —
out of L30 and every face layer into L60 (no longer `empty` for F01; the cut row is stored as `strandY` in
the manifest's `bases`), so a hat that sets `hidesHairFront` (`head_tophat01`) hides it instead of the
strand standing up behind the crown.

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
item_<slot>_<code>_<wear>_L<layer>           that item's cut for one wear, f or m (§3.1)
item_<slot>_<code>_icon                      that item's 96 × 96 inventory icon (§4.2) — not a layer
item_<slot>_<code>_<wear>_icon               a variant's own icon
item_<slot>_<code>_icon_tintmask             a tintable item's icon tint mask, 96 × 96 like its icon (§4.2, §4.4)
item_<slot>_<code>_<wear>_icon_tintmask      a tintable variant's own icon tint mask, cut from that wear's layer
bot_<index>_L30                              a bot's body
bot_<index>_face_<expression>_L50            a bot's expression
body_<gender>_L30                            a v4 body, gender f or m (Plan 19) — bald, cream, the relaxed pose
body_<gender>_face_<expression>_L50          one of a v4 body's six faces
item_hair_<gender>_<code>_L20                a hairstyle's back layer (Plan 19) — no icon, no per-wear variant
item_hair_<gender>_<code>_L60                that hairstyle's front layer
```

A file on disk always carries a density suffix the name above does not: `…@1x.png` / `…@2x.png`. The
manifest and every catalogue reference name the file **without** the suffix — `AvatarAssets`
(`packages/ui-kit/src/avatar2d/AvatarAssets.tsx`, `assetUrl`) appends it per density when it builds the
URL, so one stored name always resolves to both files.

`<layer>` is not free to pick per item: it is fixed by the slot (`head` 80, `face` 70, `outfit` 40,
`aura` 10, `frame` 90 — `SLOT_LAYER` in both `apps/normal-server/src/inventory/items.ts` and
`apps/normal-web/scripts/avatar-pipeline/manifest.mjs`), and both the server's catalogue loader and the
pipeline's own `check` command (`C8`) refuse a name whose layer disagrees with its slot.

A `<code>`'s own segments are **two characters or more**. That is what makes the one-letter wear in
`item_outfit_dealer01_m_L40` readable as a wear rather than as part of the code `dealer01_m`.

**The v4 names** (Plan 19, 2026-10-03; spec `2026-10-03-avatar-v4-design.md` §5.3, ruling 4). Gender,
hairstyle and skin are chosen separately now, so a body is drawn once per gender and a hairstyle is an item of
its own, cut into a back layer (L20) and a front layer (L60). `manifest.mjs` names them from `GENDERS`
(`f`, `m`) and the eight `HAIR_CODES` (`f_bob01`, `f_hime01`, `f_wavy01`, `f_ponytail01`, `m_tousled01`,
`m_neat01`, `m_curly01`, `m_spiky01`): `bodyFile(g)`, `bodyFaceFile(g, expr)` and `hairFile(code, 20 | 60)`;
`hairItemId(code)` is the hairstyle's catalogue id (`hair_<code>`) and `hairGender(code)` its gender.

- A hair code *starts* with its one-letter gender, which the two-character rule above forbids in a `<code>`. So
  hair layers have a pattern of their own, `item_hair_[fm]_<code>_L(20|60)`, beside the item pattern rather than
  inside it, and they never take a per-wear variant: `item_hair_f_bob01_m_L60` is illegal, as is any layer but
  20 and 60.
- `parseName` reads them as kinds `body` (`{ gender }`), `bodyFace` (`{ gender, expr }`) and `hair`
  (`{ gender, code }`), checked before the item and base readings either would otherwise fall into.
- They join `stageOneFiles` after the old names: 2 bodies, 12 faces and 16 hair layers, 172 entries in all. The
  `base_*` names stay on the list, and on disk, until the switch-over deletes them.
- A hair layer has no inventory icon: a hairstyle's wardrobe card is a portrait of the head wearing it.
- The manifest gains a `bodies` key beside `bases` — `{ [gender]: { transform } }` once a body is ingested — and a
  hair L60's entry gains `split` (§6).

## 3.1 One item, a layer per wear (2026-09-20)

Two stage-1 outfits are gendered — `dealer01` has a skirt, `tet_red01` is an áo dài — and neither reads
as the same garment on a male figure. The ruling is that they stay **one inventory item**: ownership,
achievements, the daily calendar and the `avatar_outfits` table all key on the item id, and a second id
would fork every one of them. What differs is only the layer that gets drawn.

So three things say "wear", and they say the same thing:

| | |
|---|---|
| `BASE_WEAR` (`scripts/avatar-pipeline/manifest.mjs`) | the art side's source of truth: `f01 → f`, `m01 → m`. The module refuses to load with a base in `BASES` that has no wear. |
| `"wear"` in `apps/normal-server/data/avatar-bases.json` | the registry's mirror of it, required on every base and validated by `loadBases`. `test/avatar-pipeline.test.ts` holds the two files against each other. |
| `asset.variants` in `apps/normal-server/data/items.json` | which layer an item draws for a given wear. Optional, keys ⊂ {`f`, `m`}, each name validated against the manifest exactly as `asset.file` is. |

A base whose wear the item has no entry for wears `asset.file` — the shared layer — so the second cut
of an item is added the day its picture exists and not before. `tet_red01` has none yet and every base
wears the one layer there is.

**Adding a variant**, end to end, is two steps:

1. Generate the picture on the base of that wear (D02, the same locked block as any other item, but on
   M01 rather than F01) and ingest it:

   ```bash
   pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> \
     --as item:outfit:dealer01 --base m01 --variant m
   ```

   That writes `item_outfit_dealer01_m_L40` at both densities, its own
   `item_outfit_dealer01_m_icon`, and a manifest entry carrying `variantOf` (the default layer) and
   `wear`. The wear must be the wear of `--base`, or the ingest is refused: the layer is the shape of
   the figure it was diffed against.

2. Add **one line** to the item's asset in `apps/normal-server/data/items.json`:

   ```json
   "variants": { "m": "item_outfit_dealer01_m_L40" }
   ```

Nothing else. No new item id, no catalogue row, no grant, no i18n key, no client change — the wardrobe
tile, the table seat and the lobby bar all resolve the layer from the base they are
drawing (`toWearRef` in `apps/normal-web/src/avatar/chibi.ts`).

## 4. The pipeline (`apps/normal-web/scripts/avatar-pipeline.mjs`, Node + `sharp`)

Four commands, each documented at length in the script's own header comment — read that first for every
flag; this is the shape of the four, not a copy of it.

```bash
pnpm --filter @bp/normal-web avatar:placeholder
# Draws the whole stage-1 set as labelled stand-ins (a shape plus the file's own name, so a wrong
# ingest is obvious at a glance) and writes both copies of the manifest. Idempotent: an entry the
# manifest already marks real (see §6 below) is left exactly alone, so re-running this after some
# real art has landed only re-draws what is still a stand-in. Every item's icon (§4.2) is refreshed
# with it: redrawn for a stand-in, kept for real art (or cut from the real layer on disk if missing).
# A per-wear variant (§3.1) is never invented here — it is not part of the stage-1 set at all — and a
# real one is carried through untouched rather than dropped for not being on the list.

pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as base:f01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as expr:f01:happy
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:head:tophat01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:outfit:dealer01 --base m01 --variant m
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:aura:fire01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:frame:gold
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as bot:3
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as bot:3:happy
# One generated (or hand-drawn) picture in, one layer at @1x and @2x out, plus its manifest entry.
# `base:` and `expr:` ingest a base's own body or one of its six expressions; `item:<slot>:<code>`
# ingests a wardrobe piece, drawn on F01 (D02 §5) and shared with every other base automatically —
# they are built to the same silhouette, and an item layer carries no skin (§4.1.1). Background removal keys off #00FF00 by default (`--white`
# for a white background instead) and, for an item, the layer is found by *diffing against the base's
# own body* rather than by any manual selection (§4.1), and written together with its inventory icon
# (§4.2). `--dry-run` prints what would happen and writes nothing. `--color-tol`, `--min-region` and
# `--max-hole` override the extraction defaults for one awkward picture. `--variant <f|m>` makes the
# cut the per-wear layer of an item that already exists (§3.1) rather than the item itself; the wear
# has to be the wear of `--base`, or the ingest is refused. An aura, a frame and a bot are placed differently
# again — see §4.3.

pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as body:f
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as body:f --anchor head
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as face:f:happy
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as hair:f_bob01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as hair:f_bob01 --recolour-to '#5e3e6f'
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:outfit:casual01 --base f
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:head:beanie01 --base f --hair f_bob01
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as item:outfit:dealer01 --base m --variant m
pnpm --filter @bp/normal-web avatar:ingest -- <picture.png> --as bot:3 --transform-from f
# The v4 targets (Plan 19, §4.6): a bald body and its neutral face, one of its other faces, a hairstyle cut into its
# front and back layers, and items and bots cut on a body (`--base f|m`, `--transform-from f|m`). `--anchor head` and
# `--recolour-to` are used on the user's word only.

pnpm --filter @bp/normal-web avatar:check
# Runs the acceptance criteria (D01 §10's ten, then C11, C12 and C13 — §5) over every committed layer and prints a
# pass/fail table; exits 1 on any failure. Pass names to check only those (`avatar:check base_f01_L30`), or `--skip C6`
# for the one criterion (an outfit must cover the base's underwear) that has no coordinates in the
# design and occasionally needs a human override.

pnpm --filter @bp/normal-web avatar:sheet
pnpm --filter @bp/normal-web avatar:sheet -- --hairs f_bob01,m_tousled01 --outfits casual01
# Composes docs/avatar-2d-sheet.png — the eyeballed style gate before a picture is ever committed (design
# §6, §9) — and docs/avatar-2d-fit-sheet.png, the hat-and-glasses fit check (Plan 19 §5.6). Both compose
# through the renderer's layer order and hide rules, and both read --dir like `check`. The review sheet,
# each block from a new row, twelve cards a row:
#   1. the v4 grid: for each gender, each of its hairstyles × casual01 and dealer01 × three tones —
#      skin_porcelain01's colour, natural, skin_deep01's colour, read from items.json and painted with the
#      shared `recolour` under the body's and the face's skin masks at the body's skin meanL. A tone whose
#      item is not in items.json yet is drawn natural, and its caption says so in amber (48 cards);
#   2. every outfit on both genders, on the gender's default hairstyle (the bob, the tousled cut) (12);
#   3. every aura, then every frame, on body f with the bob, in casual01 (8 + 6);
#   4. the six expressions per gender (12), the eight bots, and the portrait at 192, 40 and 32 px.
# A body wears its gender's cut of an outfit where the manifest has one (§3.1: dealer01_m, tet_red01_m),
# and the caption names it. --hairs and --outfits (comma lists; `hair_`/`outfit_` prefixes optional) narrow
# the v4 grid and nothing else — what the style gate shows the user. --out moves the review sheet.
# The fit sheet (--fit-out moves it) is every hat in STAGE_ONE_ITEMS.head and every face item × the eight
# hairstyles, on the hairstyle's gender, in casual01, cut to the portrait at @1x — one row per item, 96
# cards. A hat's hide rules drop the hair layer they name (§2: front → the hairstyle's L60, back → its L20),
# and the caption says which ("hides front", "hides front+back", "hides none").

pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs hides item_head_beanie01_L80 --front off
pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs hides item_head_hood_black01_L80 --front on --back on
# Sets a worn item's hide rules on that layer's entry in both manifests (or only in <dir>'s with --out
# <dir>); either flag may come alone. A rule that is off is left out of the entry. It then prints every
# items.json id drawn with that layer — its asset.file or one of its asset.variants, colour variants
# included:
#   remember items.json: head_beanie01, head_beanie_red01, head_beanie_grey01, head_beanie_mustard01 — same flags (bug 7)
# Set the same flags on every one of them by hand: the server refuses an item whose hidesHairFront /
# hidesHairBack disagree with its layer's in the manifest (bug 7). A stand-in's flags are redrawn from
# HIDES by `placeholder`, so `hides` is for real layers (Plan 19, batch C5).
```

`placeholder` and `ingest` write into `public/avatar/` by default; pointing either at a different `--out`
directory (as the pipeline's own tests do) also stops the server's copy of the manifest
(`apps/normal-server/data/avatar-manifest.json`) from being touched — the only way the whole pipeline is
testable without disturbing the committed artefact.

### 4.1 Cutting an item out (`extract.mjs`, 2026-09-17)

An item picture is the base *redrawn* by the generator with one change, so every pixel differs a little
and the figure drifts a few pixels. An item layer must still hold **only the item**: items are shared with
M01 (different hair and skin) and are shown alone as icons, so F01's hair under a brim, skin around a rim
or head above a collar is a visible defect even where F01's own layers would hide it. The steps, at @2x:

1. **Anchor** with the base's stored transform (as before).
2. **Register** (`registerToBase`): every whole-pixel shift within ±12 px and each scale in
   {0.99, 0.995, 1, 1.005, 1.01} about the axis and baseline is tried; the one with the lowest mean absolute
   RGB difference over pixels solid in both pictures wins, measured only where the slot changes nothing —
   the body (y ≥ 260) for `head`/`face`. An `outfit` is registered on the body instead (fix round 1): the
   same search maximises the intersection-over-union of the two silhouettes below the chin line, with pixels
   within 2 px of the base's outline counting 8 × (`SILHOUETTE_EDGE`), because the base's own limbs show
   wherever the outfit picture's limbs miss them. `ingest` logs the chosen offset.
3. **Neighbourhood difference** (`diffAgainstBase`): a pixel is the item only if its colour is more than
   `colorTol` away from *every* solid base pixel in the 5 × 5 window around it (or that whole window is
   transparent in the base), and it is not simply the base pixel under it darkened (a cast shadow,
   `shadowTol`). For an outfit the window reaches 4 px (@1x) in the 4 rows under the chin line
   (`CHIN_BAND`), where the picture's own chin sits a little off the base's once the body is registered.
4. **Slot limits**: `head` y < 260; `face` inside the crop and y < 250; `outfit` nothing above the chin line
   y = 236 (`OUTFIT_TOP_Y`), plus as much of the base as the underwear rule needs — see §4.1.1.
5. **Clean-up**: regions under `minRegion` dropped; for `head`/`face` also regions under 5 % of the
   largest; a small closing (`closeRadius`) and hole fill (`maxHole`) so a hat's crown is not cracked where
   the base's hair outline runs under it. An **outfit** fills its holes by where they lead instead of by how
   big they are — the region rule of §4.1.2.
6. **Cover the base's limbs** (outfits only, fix round 2): below y 236, outside the head region, every
   *non-skin* pixel the base inks that the outfit layer does not cover solidly joins the layer with the
   base's alpha and the outfit's own edge colour bled outward from the nearest **clothing** pixel of the
   layer — so a generated figure whose sleeves are a little narrower than the base's arms does not leave the
   base's outline beside them. The bleed once stopped at 5 px; since 2026-09-21 it does not stop at all
   (§4.1.3), because what it walks is the base's own clothing and line art, which may not show at any
   distance. It never walks onto the base's skin — a second, `coverReach`-limited pass does that, and only
   where the picture is transparent and the nearest thing it draws is cloth (§4.1.4).
7. **Edge** (`cutItem`): 1 px dilation and a 1 px feather, with the soft edge taking its colour from the
   item's own pixels next to it rather than from the hair or skin it was drawn over. The two places the
   layer takes the *base's* alpha — the union with the base and the limb cover — are re-applied after the
   feather, so where the layer ends because the base ends, its edge is the base's own edge rather than a
   second, softer one with the base's outline showing through it.

The defaults (`DIFF_DEFAULTS` in `extract.mjs`: `colorTol` 36, `shadowTol` 14, `skinTol` 24, `minRegion`
100 px @1x, `closeRadius` 1.5 px @1x, `maxHole` 400 px @1x, `gapOpening` 3 px @1x, `coverReach` 6 px @1x)
were tuned by eye on the first three real items
(`tophat01`, `glasses_round_gold01`, `dealer01`), rendering each layer alone and on F01.

### 4.1.1 An outfit layer holds clothing only (2026-09-17)

Items are shared by every base, and the bases after F01 share her body and pose but **not her skin tone**.
An outfit layer that carried F01's bare thighs would put cream legs on a darker figure, so the rule is flat:
**no pixel of the base's skin is ever part of an outfit layer.**

"The base's skin" is measured from the base being ingested on, not from a constant. `baseSkinColour`
(`frame.mjs`) takes the dominant colour of `SKIN_WINDOW` — x ∈ [140, 244], y ∈ [124, 250], the middle of
that base's own face, narrow enough that the hair beside it does not get a vote — and `skinTol` (24, RGB
distance) is how near a pixel has to be. A pixel of the *outfit picture* is skin when it matches the base
at the same registered position to within `skinTol`, or when it is that skin colour anywhere the base inks;
either way the difference (step 3) drops it.

Two things used to put it back, and both are now narrowed:

- **The union with the base** (`baseClothingUnion`). It used to take the base's whole body below the chin,
  then only the underwear band, and now takes the base's own **clothing** wherever it is — see §4.1.3.
- **The limb cover.** It bleeds only from the layer's *clothing* pixels, and only onto the base's *non-skin*
  pixels: it hides the base's line art standing beside a narrow sleeve, which is the double outline it was
  written for, and leaves the limb itself alone.

C6 was re-cut to match (`underwearRegion` in `checks.mjs`). The band's dominant colour on a real base is
her *face* — the band starts at y 176 and half of it is cheek — so the region now excludes the head region
and the base's own skin first, and the modal colour of what is left is the underwear. An outfit is measured
against the bases whose body layer the manifest marks `real`, because holding real art to a stand-in's
square shoulders reports a fault in neither.

### 4.1.2 An outfit's skin is a region, not a pixel (2026-09-21)

The first eight real outfits made the pixel-at-a-time test above fail in both directions. `tet_red01`'s
white silk trousers and `champion01`'s white ones are *shaded* down into F01's own skin tone, so
"is this pixel the base's skin colour?" said yes and punched cream blotches through both legs; on a darker
base they would have been tan blotches through white cloth. The same arithmetic the other way round dropped
pixels of a white t-shirt that happened to sit within `colorTol` of the tank-top strap five pixels away.

Colour cannot tell cloth from skin, but topology can. The only thing that may show through an outfit is the
**body**, and the body is not inside the clothes — a bare thigh, a hand and the neck all reach the outside
of the figure or the chin line the layer is cut at. So, after the difference and the clean-up
(`fillEnclosedGaps`):

> Take every region below `OUTFIT_TOP_Y` that the clothing mask does not hold — the "gaps", candidate skin
> and "unchanged" pixels alike. A gap stays a gap only if it is **connected** (4-connected through gap
> pixels) to the outside of the combined silhouette (the frame's own border, which C2 and C3 keep clear of
> the figure) or to the top cut line, **and thick** — it survives a morphological opening by `gapOpening`
> (3 px @1x). Every other gap is cloth: it is filled with the registered picture's own pixels.

There is **no size limit** for an outfit; `maxHole` goes on guarding `head` and `face`, where a glasses lens
is an enclosed hole that has to stay open. And the pixel test is narrowed to match (`skinOfBase`): the
positional clause stays as it was — a pixel that equals the base at the same registered position is the base
redrawn — but the *colour* clause now applies only where the base draws skin underneath. Colour alone never
removes a pixel the region rule calls cloth.

The thickness half was added on 2026-09-21 (round 2) because connectivity alone lets a gap **drain**: the
strip of shading down `casual01`'s shoulder runs into the neck opening, the fringe down `champion01`'s
inner trouser seam into the hem, the dashes round `tet_red01`'s cuff into the hand. Every one of those is
one to three pixels thick and every piece of body that is meant to show is tens of pixels across, so the
opening separates them cleanly. Two things about it are load-bearing and were each found the hard way:

- **Thickness is measured inside the combined silhouette only.** Measured over the whole gap mask an
  opening removes nothing, because every one of these strips runs *alongside* the exterior of the figure:
  the structuring element sits in the exterior with its rim over the strip and the dilation hands the strip
  straight back. So the erosion treats everything outside the figure as solid, and the exterior is used for
  connectivity alone.
- **The base's own hair is exempt from it** (inside the head region, over a non-skin base pixel, grown by
  `HAIR_MARGIN` so the ends of the strands are exempt too). The picture's hair is the base's hair redrawn a
  strand out of place, so the difference leaves a lattice of one-pixel gaps between the strands; filling
  those put 1 300–1 700 px of F01's purple into every shared layer and M01 wore it on his shoulders.

`r = 3` is the radius, chosen by sweeping 1.5–4 over the real pictures: 2 leaves about twice as much of the
fringe, and 4 closes `champion01`'s hands.

### 4.1.4 A limb wider than the outfit drawn over it (2026-09-21)

§4.1.3's cover never touches the base's skin, on the principle that a bare limb is the base's to draw.
`tuxedo01` showed what that costs: the base's legs are a pixel or two wider than the picture's trousers, so
a dashed line of the base's own skin — cream on F01, tan on M01 — ran down the outer edge of both trouser
legs and read as a leg poking out of them. What decides it is what the *picture* has nearest, not what the
base has (`coverBaseLimbsOutside`):

> A solid base pixel the picture leaves transparent, whose nearest pixel of the figure is **cloth**, is a
> limb the garment was drawn too narrow for: it is covered with that cloth's colour and the base's alpha,
> skin or not, out to `coverReach` (6 px @1x). One whose nearest pixel of the figure is an **open gap** — a
> bare thigh, a hand, the neck, drawn a little narrower than the base draws it — is left alone.

The line art *around* a bare limb counts as part of the limb (`OUTLINE_SPAN`, 2 px @1x): it is not the
base's colour anywhere, so the difference keeps it and in the layer it looks exactly like cloth, and left as
cloth it would win every race along a thigh.

### 4.1.3 The base's clothing never shows (2026-09-21)

D01 §10.7 asks that an outfit leave no underwear showing, and the union with the base was cut back to
`UNDERWEAR_BAND` (y 176–300) in 2026-09-17 to stop it carrying skin. The band turned out to be the wrong
shape for the job: the base's shorts flare past y 300 at the hip, and `tuxedo01`'s trousers left two grey
notches there. So the rule is stated by what it is about rather than by a rectangle:

> Every solid base pixel below `OUTFIT_TOP_Y`, outside the head region, that is **not the base's skin** —
> the grey tank top, the shorts and their outlines — is covered by the layer: by the registered picture's
> own pixel where it has one (with the base's alpha, *even where that pixel is skin-coloured* — a
> swimsuit-cut outfit still has to hide the underwear, and what hides it is the picture's pixel), and where
> the picture is transparent there, by the nearest clothing pixel's colour bled outward, at any distance.

The band's own second clause survives inside it: a pixel the picture *changed* by more than `colorTol` is
the outfit's cloth and joins the layer even over skin. `UNDERWEAR_COVERAGE` (C6's bar) went from 0.98 to
**0.995** with it; all eight real outfits report 100.0 % on both real bases.

The head region stays excluded, and it has to. Layer 50 gave up `TORSO_COLUMN` in 2026-09-17, so it is
tempting to let the union have that column back — but what the base inks there between y 236 and y 250 is
not its tank top (whose straps start at y ≈ 256), it is F01's *hair* beside her neck. Tried on 2026-09-21,
it put 1 300–1 700 px of purple into every shared layer and M01 wore it on his shoulders; the note in
`extract.mjs` says so, so that nobody tries it twice.

### 4.2 Inventory icons

For every item layer — head, face, outfit, aura, frame, real or stand-in — the pipeline also writes
`item_<slot>_<code>_icon@1x.png` (96 × 96) and `@2x.png` (192 × 192): the layer's @2x cut to its ink,
fitted with its aspect kept into 84 % of the square, centred on transparency; @1x is the @2x scaled down.
A frame's icon is its ring; an aura's is the aura — and since 2026-09-24 a real aura's or frame's icon is
cut from the ingested *picture* rather than from the layer (§4.3), so an aura that runs off the frame's sides
still shows as a whole ring. `ingest` writes the icon with the layer, `placeholder`
refreshes the stand-ins' icons. The manifest lists them under a separate `icons` key —
`{ kind: 'icon', of: '<layer name>', w: 96, h: 96, bytes2x, real | placeholder, tintMask? }` — so `files` stays the
set of frame-sized layers that `check`, the renderer and the server's loader read (the server ignores
`icons`).

The wardrobe's cards show the icon (`ItemPreview` in
`apps/normal-web/src/screens/wardrobe/ItemTab.tsx`), deriving the name from the item's `asset.file` —
`item_head_tophat01_L80` → `item_head_tophat01_icon` — so the API carries nothing new; the URL is built
with the same `AvatarAssets` base and `srcset` as a `Chibi` layer. Seeing an item *worn* is the big
preview's job: picking an owned tile puts it on the character there, and saving equips it.

**A colour variant's icon** (2026-10-01, Plan 18, review No8a). A colour variant shares its original's layer, so it
shares its icon too, and an untinted icon showed every variant in the original's colour. So every item layer with a
tint mask (§4.4) also gets `item_<slot>_<code>_icon_tintmask@1x/@2x.png`, the same size as its icon: the layer's own
written tint mask (so a hand-drawn override counts), cut with the **layer's** ink box and fitted exactly as the icon
is (`iconFit` + `applyIconFit` in `png.mjs`, which `iconPicture` itself uses — 192 px square, 84 %, centred; @1x is
the @2x halved). `masks` and `ingest` write it whenever they write the layer's tint mask, after the icon, and flag the
icon's manifest entry `tintMask: true` — a field on the entry, not a key of its own; `placeholder` re-cuts it
alongside a real icon it re-cuts. An aura's or a frame's icon is cut from the source picture rather than the layer
(§4.3), so neither gets one. `ItemPreview` then paints the icon of an item with `asset.tint` the way `Chibi` paints the
worn layer: `useTintedLayer` with the icon and `{ mask: <icon>_tintmask, colour: asset.tint, meanL: asset.tintMeanL }`
(the layer's own `masks.tint.meanL`), drawn as a `blob:` image with no `srcset`. Until it is ready the card keeps the
previous colour, or the plain icon on first paint; if the browser refuses it, the plain icon for good.

### 4.3 Auras, frames and bots (2026-09-24, Plan 12)

The registry loop generates these three last, and none of them is cut the way §4.1 cuts an item: an aura
and a frame are **square** pictures (≥ 1024, transparent, the effect in a ring with its middle empty) with no
figure in them to diff against a base, and a bot is a whole figure of its own. The shapes they are placed to
are the stand-ins' (`frame.mjs`, `itemShapes`), at full size.

**An aura** — `--as item:aura:<code>` — is placed by its ink box (`placeByInk`): scaled, aspect kept, until
the box's larger side is `AURA_SIZE` (400) frame units, and centred on (`AXIS_X`, `AURA_CY`) = (192, 240), the
effect spread round the whole body. 400 is wider than the 384 frame, so an aura is cut off at both sides —
expected, and the reason C2 exempts layer 10 (§5); C3 still holds the rows and columns where nothing is drawn.
It is written as `item_aura_<code>_L10` (`real: true`) with its icon, which is the *picture* fitted into the
square (§4.2), so the icon shows the whole ring rather than the frame-cut layer. A picture that carries its own
transparency (four transparent corners, which `verify` requires) is not colour-keyed at all — the green-screen
despill would turn a wind or earth aura's greens grey; one on a flat green (or `--white`) background is keyed
as usual.

**A frame** — `--as item:frame:<code>` — is placed the same way, fitted to `RING` (260) and centred on the
crop's centre (192, `CROP.y + CROP.size / 2` = 144), which keeps it 14 px inside the top of the frame. It must
leave the portrait showing: the mean alpha of the placed layer inside `RING_HOLLOW.radius` (40 %) of the
ring's half-width has to stay under `RING_HOLLOW.limit` (0.05), or the ingest is refused with the number
before anything is written. `item_frame_<code>_L90`, `real: true`, and its icon.

**A bot** — `--as bot:<n>` (n 0–7) — is drawn from F01's own picture (`f01_candidate_1.png`: same canvas,
proportions and pose, a robot body, no hair), so it is cut like a base but on **f01's stored transform**
(`--transform-from` semantics by default; the flag names another base), never anchored by its own box. It
writes exactly what the kit draws for a bot (`layersFor`): `bot_<n>_L30`, the whole figure — no strand cut,
since a bot has no L60 to move a strand (or an antenna) into and wears nothing to hide it under — and
`bot_<n>_face_neutral_L50`, its head region as a base's neutral face is cut. The registry generates only a
neutral and a happy picture, so the other five faces are written as **copies** of the neutral one, each
`real: true, copyOf: 'bot_<n>_face_neutral_L50'`, and `check` and the app see a complete set; a face that is
already real in its own right (a happy face ingested earlier) is left alone by a later neutral picture.
`--as bot:<n>:happy` cuts `bot_<n>_face_happy_L50` from the second picture's head region on the same
transform and replaces the copy; nothing else is touched. Bots have no icons and no entry under `bases`.

### 4.4 Tint masks (2026-09-24, Plan 13)

A base is drawn once, flat, in one hair colour and one eye colour. Recolouring it needs to know *which*
pixels are hair and which are iris — that boundary is not stored anywhere the generator produced, so the
pipeline cuts it out after the fact (design `2026-09-24-plan13-avatar-tint-design.md` §4.1, §4.3):

1. Every real base `L30`, every real base face (all six expressions), `L60` when it is not empty, and every
   tintable item (one with a `tintSeed`) gets a **hair**, **eyes** or **tint** mask — a `Uint8Array` cut by
   k-means over CIE Lab (hair: close to the scalp palette, far from skin; eyes: the not-hair not-skin blob
   in the eye band, brow eroded off; tint: a flood fill from a seeded point).
2. Each mask is written both densities as `<layer>_hairmask@1x/@2x.png`, `<layer>_eyemask@1x/@2x.png` or
   `<layer>_tintmask@1x/@2x.png` — white RGB, the coverage in alpha, hard-edged at `@2x` (the `@1x` copy's
   own downscale gives the soft rim) — beside the layer itself in `public/avatar/`.
3. The manifest entry gains a `masks` object, keyed `hair`/`eyes`/`tint`: `{ bytes2x, meanL, empty?,
   override? }`. `meanL` (`meanLightness`, `packages/ui-kit/src/avatar2d/recolour.mjs`) is the mask's own
   mean HSL lightness of the layer under it — what `recolour` (§5.1 of the design) shifts every tinted
   pixel's lightness relative to, so a base's `L30` and every one of its own layers can be tinted to the
   *same* target lightness without a seam between them.
4. `check`'s C11 (§5 below) holds every mask to its layer's own ink and a plausible shape; a mask that fails
   it is either bad art or a bad cut, and the review sheet (below) is where a person decides which.
5. A tint mask is also cut down to the item's icon (2026-10-01, Plan 18): `<icon>_tintmask@1x/@2x.png`, with the
   icon's own fit, and the icon's manifest entry flagged `tintMask: true` — what the wardrobe tints a colour
   variant's icon with (§4.2).

A cut the algorithm gets wrong is fixed by hand, not by tuning the algorithm for one picture: drop a PNG at
`assets/avatar-src/masks/<layer>_hairmask.png` (or `_eyemask`/`_tintmask`), white on transparent (or plain
white-on-black, if it carries no alpha channel) at either density, and the next `masks`/`ingest` run uses it
in place of the computed one and marks the manifest entry `override: true` — which is also what tells C11 to
trust its shape and check only that it still fits the layer.

```bash
pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs masks
# Cuts hair/eye/tint masks for every real base L30/L60, every real base face, and every item with a
# tintSeed, and skin/eye/hair masks for every real v4 body, body face and hair layer (§4.4.1) — the default
# target list (`maskTargets`) — plus each tint-masked item's icon tint mask (§4.2).
# `ingest` already calls this on whatever it just wrote, so a fresh base or item needs no separate run;
# `masks` is for re-cutting after an override lands, or after the algorithm itself changes. Pass names to
# mask only those — the four icon tint masks of 2026-10-01 came from:
#   masks item_head_beanie01_L80 item_head_beret_red01_L80 item_head_party_cone01_L80 item_outfit_casual01_L40

pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs masks --tint-seed 150,200 --as item:head:tophat01
# Records the tint seed (1x frame coordinates, inside the item's own colour region) on an item already in
# the manifest, then cuts its tint mask from it. A seed only has to be set once; every later `masks` or
# `ingest` run re-cuts from it.

pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs tint-sheet
# Composes docs/avatar-2d-tint-sheet.png: every base that has both a hair and an eye mask, in the three
# hair colours × three eye colours of design §4.2, dressed in casual01 and tinted with the shared
# `recolour` at the base's own meanLs — plus one card per items.json entry whose asset.tint is set, drawn
# on f01 with the item itself recoloured by its own tint mask. The eyeballed check before a colour or a
# tinted item ships, the same role avatar:sheet plays for the plain layer set.
```

### 4.4.1 Skin masks, and the eyes of a bald face (Plan 19, 2026-10-03)

A v4 body is bald and cream (design `2026-10-03-avatar-v4-design.md` §5.2), and the skin colour item tints it, so
every real `body_<g>_L30` and every real `body_<g>_face_<expr>_L50` gets a **skin** mask (§5.5 of that design),
written as `<layer>_skinmask@1x/@2x.png` and recorded under `masks.skin` like the others. `masks` and `ingest` cut
it with `skinMask` (`masks.mjs`), at `@2x`:

- The seed is `baseSkinColour` — the modal colour of `SKIN_WINDOW`, the cheeks and chin, which are skin on every
  body by construction.
- A pixel is skin when it is solid (alpha > 128), has a Lab chroma C* of at least `minChroma` (8), and is either
  within ΔE76 `SKIN_MASK.tolerance` (22) of the seed in Lab, or **warm and light enough**: its LCh hue
  h = atan2(b*, a*) is `SKIN_MASK.hue` (44–100°) and its L* at least `minL` (50), **at any chroma**. The first branch
  is light cream (and a light warm blush off its hue); the second is shaded skin, which travels a long way in Lab and
  gains chroma as it darkens while staying warm.
- **Why a hue window and no chroma ceiling (style gate, 2026-10-04):** the rule used to be "within 18° of the seed's
  hue, with 0.5–1.6 × its chroma". Under a deep tone (`#5c3a28`) that left the ears, the cheek and jaw shading and
  the neck shadow under the chin cream or orange, because shaded skin is the most saturated skin there is: measured
  on the real bodies, `@2x`,

  | what | Lab | C* | h |
  |---|---|---|---|
  | cream skin (the cheek) | (92.0, 4.8, 13.7) | 14.5 | 71° |
  | its highlights | L* 94–97 | 10–13 | up to ~100° |
  | shaded skin (cheek, ear, jaw) | (79.2, 22.1, 26.1) | 34 | 50° |
  | deeper shade (the neck under the chin) | (59.2, 26.7, 30.1) | 40 | 48° |
  | the ears' deepest pixels | L* 68–79 | 34–44 | 45–51° |
  | antialiased rim between skin and outline | L* 50–80 | 24–40 | 47–60° |
  | the mouth, inside (f / m) | L* 72–78 | 36–45 | 29–37° / 35–43° |
  | the outline, brows, lashes | L* 21–44 | — | outline 45–48° |
  | tank top / eye whites | — | 4.3 / ≤ 3 | — |
  | m's amber iris `#945e26`, its light side | L* 60–90 | 45–70 | 65–90° |

  The old ceiling (1.6 × 14.5 = 23) took 63 % of the first shade on body f and 39 % on body m, and the ears' rims
  none. So the window is absolute and the chroma open: the mouth's inside stops under 44° on both faces, the
  deepest ear shading starts at 45° — a thin margin, measured, not guessed — and nothing on a body is
  warmer-yellow than its own highlights. The pink mouth falls out on hue; its antialiased edge, a blend towards
  the skin, falls in, as the rim of any line does.
- **Why `minL` is 50:** the warm-brown outline is L* 30–45 with a hue (45–48°) inside the window, and the brows and
  lashes are as dark. Lightness is what keeps the line out, and the line keeps its colour, so it stays crisp on every
  skin tone (on a deep tone it reads as a warm-brown line round a dark figure).
- **Why `minChroma` is 8 (style gate, 2026-10-04):** `tolerance` alone cannot tell a *light* neutral from cream,
  whatever its hue. Mid and dark greys fall out on their own (the stand-ins' `#9aa3ad` is ΔE 32 from `#f1d2b6`), but
  greys from about `#b9b9b9` to `#f8f8f8` and an off-white like `#fdf8f5` are within ΔE 22 of it. The real v4 bodies
  came back with exactly that: a light bluish-grey tank top where the template asked for a mid-gray one — `body_f_L30`
  `rgb(206,205,213)` = Lab (82.7, 1.8, −3.8) and `body_m_L30` `rgb(199,197,205)` = Lab (79.9, 2.2, −3.8), both chroma
  C* 4.3 — only ΔE ~20 from the cheek (Lab (92.0, 4.8, 13.7), C* 14.5). The mask took the whole top of body f and
  patches of body m's, and a skin tint would have painted the shirt. Skin always carries warm chroma, about 12 and
  over even in its highlights: the cheek is C* 14.5, the thigh (91.5, 5.9, 14.1) 15.3, shaded skin (79.2, 22.1, 26.1)
  34 and (59.2, 26.7, 30.1) 40. So a pixel under C* 8 is not skin by either rule. The test comes before the closing,
  so the closing cannot fill the shirt back in. On the real bodies the share of tank-coloured pixels in the mask went
  from 97 % (body f) and 47 % (body m) to 0; the neutral faces lost 9 px and 0 px. The cost is that a near-white
  highlight under C* 8 (`#fff1e6` is 7.6) drops out of the mask and stays white under a tint, as a highlight should.
  The white of the eye (C* ≤ 3 on the real faces, `#fdf8f5` is 2.3) falls out the same way, and a hand-drawn
  `_skinmask` override still answers anything else that gets through.
- **The eyes are taken out by their eye mask only**, widened by `eyeGap` (1 px), so skin and eyes never share a
  pixel. On a face that is the eye mask as written (a hand-drawn `_eyemask` included); on a body `L30`, which carries
  the neutral face under the face layer, it is the eye mask `eyeMask` finds on it (not written anywhere). The eye mask
  is what keeps an iris out whose colour is warm: m's amber is inside the window and, on its light side, above
  `minL`. Until the style gate the padded **eye ellipses** were taken out too, widened by `eyeMargin` (3 px), because
  an off-white sclera is within ΔE 22 of cream; `minChroma` has made that unnecessary, and the ellipses are drawn
  much bigger than the eye, so they left a cream ring round both eyes under a deep tone.
- **The eye zone** (`eyeZone`: the eye ellipses ∪ the eye mask, widened by `eyeMargin`) is still what C11 adds to
  the skin to compare one face with another (§5) and what the hair face rule counts as face (§4.6) — the region that
  moves between "eye" and "skin" between expressions. It can come out too big: `eyeEllipses` finds the eyes from
  white blobs in the eye band and unions every blob on a side, then mirrors the box to the other side, so a small pale
  feature there that is not an eye white — a tear, a highlight on a cheek, a pale "zZ" bubble — widens both ellipses
  (a white cheek sparkle on the test face grows them from 44 × 52 to 62 × 70 px). Before the style gate the skin mask
  lost what they gained (24 % of the test face's skin); now it loses nothing, and C11's eye-zone guard on real faces
  (§5) is what catches a sparkle like that. **Every real face's skin-mask overlay is still checked by eye** at the
  style gate and in batch C1, and a bad one is answered with a hand-drawn `_skinmask` override.
- What is left is closed by 2 px and kept to pieces of at least `minRegion` (40 px). The closing fills the odd
  textured or near-white pixel inside the skin, but it **adds no pixel of line art** (L* under `minL`), none within
  `eyeMargin` of the eye mask (the white's corner between the iris and the lid is a near-white sliver it would
  otherwise fill) and nothing past the solid picture. So it fills no brow or lid line — the old closing took 92–93 %
  of the brows' dark pixels into the mask — and it does not cross the outline into the clothes. It still bridges a
  gap of up to about 4 px between two pieces of skin that is not line art, so a strap that thin would be filled back
  in; the real tank tops' straps are 8–20 px wide and taper to 4–6 px only at their very tips under the shoulder, and
  measured on both real bodies none of the top or the shorts is in the mask.
- **Measured on the real bodies after the style-gate fix** (`@2x`, each set's share inside the skin mask, before →
  after; shades are the pixels within ΔE 5 of the two shades above):

  | | shade (79.2, 22.1, 26.1) | shade (59.2, 26.7, 30.1) | skin round the eyes | ears | neck | outline (L* < 45) | brows |
  |---|---|---|---|---|---|---|---|
  | `body_f_L30` | 63.5 → 100 % | 41.8 → 100 % | 0 → 95.9 % | 74.9 → 98.9 % | 90.7 → 98.5 % | 3.5 → 0 % | 93 → 0 % |
  | `body_f_face_neutral_L50` | 59.2 → 100 % | 39.5 → 100 % | 0 → 95.9 % | 74.9 → 98.9 % | 78.2 → 100 % | 11.7 → 0 % | 93 → 0 % |
  | `body_m_L30` | 39.4 → 100 % | 60.8 → 100 % | 0 → 96.8 % | 80.1 → 99.7 % | 89.0 → 99.3 % | 3.7 → 0 % | 92 → 0 % |
  | `body_m_face_neutral_L50` | 29.7 → 100 % | 61.3 → 100 % | 0 → 96.8 % | 80.1 → 99.7 % | 87.9 → 100 % | 12.8 → 0 % | 92 → 0 % |

  The mouth, the irises and the tank top stay at 0 % on all four, and the eye whites at 0.1 % (f, 1 px) and 0.3 %
  (m, 3 px); no pixel of the tank top or the shorts is in either body's mask.

  The skin round the eyes left out is the eyes' pinkish inner corners (h under 44°) and the lashes' antialiased
  tips. Skin now covers 0.672 (f) and 0.663 (m) of the body `L30`s' ink, inside `SKIN_AREA` (§5).
- A hand-drawn `assets/avatar-src/masks/<layer>_skinmask.png` wins, as for hair, and is marked `override: true`.

A body face is never given a hair mask — there is no hair on it — and its eyes are cut with `eyeMask` handed an
empty hair array. `eyeMask` samples its "hair palette" just under the head top, which on a bald head is the scalp;
the hair-coloured leak it runs then does the work of its skin leak, and both eyes are still found (a unit test
holds a synthetic bald face to one eye each side). A v4 hair layer's **hair** mask is its ink, as a base L60's is.

The stand-ins keep the masks they were drawn with (§6); only real art is cut.

### 4.4.2 What colour a mask covers: `colours` (Plan 19)

```bash
pnpm --filter @bp/normal-web exec node scripts/avatar-pipeline.mjs colours body_f_L30 body_f_face_neutral_L50
# body_f_L30 skin #f1d2b6
# body_f_face_neutral_L50 skin #f1d2b6
# body_f_face_neutral_L50 eyes #35292d
```

One line per mask of each named layer: the layer's colour under the mask, each pixel weighted by the mask's
alpha (`maskColour`). An eye mask can hold the pupil, the lash line and the highlights as well as the iris, so an
eye line is the **iris alone**: the pixels of HSL lightness 0.15–0.85 and saturation ≥ 0.2 — or, for a grey iris
(under a quarter of those mid-tones saturated), all the mid-tones; with no mid-tones at all (a stand-in's flat dark
eye), the whole mask; an empty mask prints `empty`. HSL because `recolour` tints in it: it gives every masked pixel
the eye colour's hue and saturation and shifts its lightness, so the hue and saturation of the coloured part are
what an eye colour has to match, and the dark, light and grey pixels would only pull them towards black, white or
grey. A hair layer's line adds its hairstyle's `naturalColour` from `items.json`, once it has one, and how far the
drawn hair is from it: `natural #rrggbb ΔE n.n` (CIE76). The style gate records the drawn cream and the irises with
it, and every hairstyle batch holds its hair to its natural colour.

On the old bases this reproduces the plan's hairstyle natural colours exactly (the alpha-weighted mean under each
`base_<id>_L30_hairmask`). Its irises, measured on each `base_<id>_face_neutral_L50` — f01 `#2f6695`, f02
`#6f5c75`, f03 `#a8a364`, m01 `#ca904c`, m02 `#a0989e`, m03 `#a26846` — land within ΔE 1.2–4.7 of the values the
plan pinned for the migration (`#2e6a9b`, `#6b5771`, `#a9a564`, `#cc924c`, `#998c91`, `#ad6f4a`), which were measured
before `colours` existed.

### 4.5 A hairstyle's two layers: front and back (Plan 19, 2026-10-03)

A v4 hairstyle is drawn once, on its gender's bald body, and shipped as two layers: **L60**, over the face, and
**L20**, behind the body (design `2026-10-03-avatar-v4-design.md` §5.4). The ingest finds the hair as the
difference between the picture and the registered body, and `splitHair(region, body, { density, override })`
(`hair.mjs`) cuts that region in two. The rule follows the body's own head and shoulders, at `@2x`, with
`HAIR_SPLIT` in frame units × the density:

- **the head, grown** — the body's ink on every row above `measure(body).chin` + `shoulderMargin` (8), which takes
  in the skull, the face and the neck but not the shoulders, grown by `reach` (6): hair lying on the head, and a
  little rim round it;
- **the crown band** — every row above the head top + `crownBand` (0.35) × (chin − head top), across the grown
  head's whole width: the top of the hair is in front however far it stands out past the skull;
- **the body's own ink, on any row** (pre-flight #17) — a hair pixel over the body is drawn over the body, so a lock
  or a braid resting on a shoulder stays in front of the outfit rather than vanishing under it.

A hair pixel in any of the three is **front**; every other one is **back** — long hair behind the shoulders, a
ponytail, the back of the hair standing out of the head shape, a bunch standing out beside the jaw below the crown
band. Long hair behind the back shows only outside the silhouette, so it is never on the body's ink. Each pixel goes
to exactly one layer with its own coverage, so the two add up to the region. The body must be the frame at the
density given (768 × 896 at 2), or `splitHair` refuses it: every margin is in frame units × the density.

When the rule gets a hairstyle wrong, a hand-drawn **front mask**
`assets/avatar-src/masks/item_hair_<code>_frontmask.png` replaces it outright: front = region ∧ mask ≥ 128, the
rest is back. It is read as any hand-drawn mask is (its alpha, or its luminance when it has none) and applied by
ingesting the hairstyle again. The L60's manifest entry records `split: { region, front, back }`, the pixel counts
at ≥ 128, and C13 (§5) holds the two written layers to it.

### 4.6 Bodies, faces, hairstyles and items on a body: `ingest` (Plan 19, 2026-10-03)

The v4 set is ingested with the same command as everything else, and four more `--as` targets.

**A body** — `--as body:<g>` — is cut like a bot (§4.3): the whole figure as `body_<g>_L30` (`dropFaint`, no strand
cut — a bald head has none) and its head region as `body_<g>_face_neutral_L50` (`clipToFace`, as a base's face), on a
stored transform rather than its own box. Which one: `--transform-from <id>` when given; otherwise the body's own, when
it is ingested again (it stays where it was placed); otherwise `BODY_TRANSFORM_FROM`, f01's — `f01_candidate_1.png`
is the canvas both bodies are drawn on. The manifest gets `bodies.<g> = { transform }` beside `bases`, and both layers
are masked at once (skin; eyes and skin on the face, §4.4.1). `--dry-run` prints `measure`'s lines and then C12's
verdict for a cut into a temporary copy, masked there — e.g. `C12 FAIL — eye line 5.9 from F01's (want within
4.16), chin 13.0 from F01's (want within 12) — eyes (…) … apart, chin …` — writes nothing, and exits 1 when it
fails.

**`--anchor head`** (pre-flight #23) is for a body that fails C12 on position or scale alone — eyes and chin offset
or scaled consistently, the pose fine — and only on the user's word. The body is cut once on f01's transform (or
`--transform-from`'s) into a temporary directory and `headMetrics` taken there; the transform stored instead maps the
measured eye span onto `HEAD_REFERENCE.eyeSpan`, scaling about the eye midpoint, and the eye midpoint onto
(`eyeMidX`, `eyeMidY`): `bodies.<g> = { transform, anchor: 'head' }`. The ingest logs how the scale and the offset
moved from f01's, and where the feet land — they may sit off `BASELINE_Y` by that much (a body drawn 6 units low on
the synthetic test: `scale ×0.9999, offset moved +0.28, −5.89`, the feet from y 415 to 409.1); C2 and C3 still hold
them inside the frame. Ingested again without the flag, the body keeps the anchored transform. The anchor (and the
dry run's C12) measures **the eyes its own cut finds** — never a hand-drawn `body_<g>_face_neutral_L50_eyemask.png`,
which is drawn for the body where it is stored, not for the cut on f01's transform (A2a review); the face the ingest
then writes does take the hand-drawn mask, as every mask does.

**One of a body's faces** — `--as face:<g>:<expr>` — is an expression's cut, owned by the body:
`body_<g>_face_<expr>_L50` on `bodies.<g>.transform`, masked like the neutral one. It needs the body first.

**A hairstyle** — `--as hair:<code>` — is drawn on its gender's bald body (`hairGender`), and needs that body first.

1. The picture is anchored on the body's transform and registered on `body_<g>_L30` (`registerToBase`, measured on
   the rows `y ≥ HEAD_LIMIT_Y` the hair leaves alone).
2. `diffAgainstBase(…, { slot: 'hair' })` gives the region: no area limit — hair runs from the crown to below the
   shoulders — but **the hair face rule** (pre-flight #18, `hairFaceRule` and `applyFaceRule`; A2a ruling). A hair
   picture redraws the face a little — a cheek's shading moved or painted out, an iris a shade off, the mouth or a brow
   drawn again a few pixels away — and that redraw must not become hair, tinted the hair colour. Two clauses, in order:
   - **skin** — the region never holds a pixel inside the neutral face's skin mask whose colour in the picture is the
     body's skin (`isSkin` within `SKIN_TOLERANCE` of `baseSkinColour`);
   - **islands** — the *face interior* is the neutral face's skin mask ∪ its eye zone (`eyeZone`, §4.4.1: the eye
     ellipses and the eye mask, widened) ∪ the body L30's own skin mask on the rows above `FACE_LIMIT_Y` (250), with
     its holes filled, so the mouth, the brows and the eyes all fall inside it; every 8-connected piece of the region
     lying **wholly** inside the interior is dropped. The body's skin is there for the chin: the face layer gives up
     the torso column below y 236 (§4.3's `keepOnlyFace`) while the chin is at 243, so without it a mouth or a jaw
     redrawn across y 236 reached "outside" the face through the cut and stayed in the hair (A2a review: 652 px of
     a mouth at y 236). A redrawn feature is
     an island inside the face. A fringe always hangs down from hair outside it — over the head's outline, past the
     top of the skull — so it stays in the hair however far down it falls, and **C13 judges it**: a fringe drawn over
     the eyes is kept in the L60 and fails C13 (`the front lies over the eyes on 100.0 % of the eye mask` on the test).
   The rule is applied wherever a slot limit is — first on the raw difference, before the closing and the hole fill
   could join an island to the fringe, then on the core and after the feather — and the ingest logs what it dropped
   from the raw difference: `hair face rule: dropped 3379 px the picture redrew on the face (503 of skin, 2876 in
   islands inside the face)` on the test picture, whose cheek shading is painted out, irises recoloured, brows drawn
   again and mouth drawn again down past y 236 (an earlier rule that only dropped pixels near the eyes let a redrawn
   mouth and brows into the L60 — 614 px and 1134 px of them on an earlier version of the picture). One thing it cannot tell: a piece of hair that is drawn *apart from* the rest, inside
   the face — a fringe cut through by a skin-coloured shine band across its whole width loses the part below it.
3. `splitHair(region, body, { density: 2, override })` splits it (§4.5); `override` is the hand-drawn
   `item_hair_<code>_frontmask.png` from `assets/avatar-src/masks/` when one is there, read as any hand-drawn mask is.
4. `item_hair_<code>_L60` (front) and `_L20` (back) are written, the back `empty: true` when the split leaves nothing
   behind (a short style); the L60's entry records `split: { region, front, back }` — the pixels at alpha ≥ 128 of the
   hair as the two layers hold it, at the picture's own alpha, and of each. Both are masked (hair = ink).
5. **`--recolour-to #rrggbb`** (pre-flight #43), only when `colours` (§4.4.2) shows a mapped hairstyle more than
   15 ΔE from its `naturalColour`, and on the user's word: both layers' hair-masked pixels are recoloured to it with
   the shared `recolour`, each at its own hair `meanL` (the shading is kept, the mean lands on the colour), written
   again at both densities and masked again; the L60 records `recolouredTo`. A synthetic hair drawn `#4a2e20` reads
   ΔE 40.6 from `#5e3e6f` before and 0.0 after. Like an item's tint seed, the recolour is **kept**: the hairstyle
   ingested again without the flag is recoloured to its L60's `recolouredTo` once more, and the ingest says so
   (`item_hair_f_bob01_L60 keeps its recolour to #5e3e6f`). To drop it, delete `recolouredTo` from the L60's entry in
   both manifests first.

**An item on a body** — `--base f|m` (a gender rather than a base id) — is registered on and diffed against
`body_<g>_L30` exactly as §4.1 diffs against a base. With **`--hair <code>`** (a hairstyle of the same gender, already
real) it is measured against the body *wearing* that hairstyle — its L20 under the body, its L60 over it — so a hat
drawn over the bob takes none of the bob with it; without it, every hair pixel round the hat is new to the picture and
joins the hat. `--hair` is for head and face items: an outfit is drawn on the bald body (the outfit template says so),
and with long hair on the base, the outfit's union rule (§4.1.3) would take the hair below the chin for the base's own
clothing. **Never ingest an outfit with `--hair`** — nothing refuses it, and the outfit layer would take in, or paint over
(§4.1.3–§4.1.4), the hairstyle's hair below the chin. A body's wear is its gender (`wearOf('m')` is `'m'`), so `--variant m` goes with `--base m` and is refused
on body f, naming it. `--base f01` and the other old bases keep working until D1.

**A bot on a body** — `--transform-from f|m` — reads `bodies.<g>.transform`. Without the flag a bot still takes
f01's (`BOT_TRANSFORM_FROM`) until D1.

**`cutOn`.** Every item and bot layer ingested from now on records what it was cut on — `cutOn: 'f'`, or `'f01'` for
an old base — on the body and all six faces of a bot (copies included). An aura and a frame are placed by their ink
and have none. C6 routes on it (§5), and D1 checks that every outfit and bot was redrawn on a body.

**The tint seed is kept** (R13). An item ingested again without `--tint-seed` keeps the `tintSeed` its entry had —
`casual01`'s and the hats' were set once, by `masks --tint-seed` — so its tint mask and its icon's tint mask are cut
again from it, and the ingest says so: `item_head_beanie01_L80 keeps its tint seed (191, 98)`.

## 5. The thirteen acceptance criteria (`avatar:check`)

| | Checks (D01 §10, plan 13 §4.3, Plan 19 §5.1/§5.4/§5.5) |
|---|---|
| C1 | The frame, exactly, at both densities — one pixel out is a fail |
| C2 | Nothing opaque on the outermost row or column — except an aura (layer 10), which is 400 wide by design and reported `-` (2026-09-24, §4.3) |
| C3 | The empty part really is empty: no alpha at all more than 3 px outside the solid shape |
| C4 | No white fringe — the soft rim is the shape's own colour, not white bled in from the key |
| C5 | `head`/`face` items fit inside the 208×208 crop |
| C6 | An outfit covers the base's underwear — the band's non-skin pixels, on the bases whose body is real art (§4.1.1) **and that wear this layer** (§3.1: a variant is measured only against bases of its own wear; a default layer against every real base whose wear has no variant of that item); `--skip C6` exists for it. **Routed by `cutOn`** (Plan 19, §4.6): an outfit cut on a v4 body (`cutOn: 'f'` or `'m'`) is measured against the **real** `body_<g>_L30` of every gender that wears it (the same wear rule, a body's wear being its gender) and passes as e.g. `covers 100.0 % of body_f_L30 and body_m_L30`, or reports `n/a — no real body wears it yet`; an outfit without `cutOn`, or cut on an old base (`cutOn: 'f01'`), is measured on the old bases exactly as before — that branch goes with them in D1 |
| C7 | The `@1x` is really the `@2x` scaled down, not redrawn separately |
| C8 | The file name follows §3 above, with a layer that matches its slot |
| C9 | The manifest lists it, at that layer and that frame size |
| C10 | The `@2x` is inside the per-file share of the stage-1 budget (6 MB in the design; 32 MB since 2026-09-24 for real AI art, see `test/footprint.test.ts`), and the manifest's byte count matches the file on disk |
| C11 | Every mask a layer's manifest entry lists (§4.4, Plan 13) is the layer's own `@2x` size and covers none of its transparency; unless hand-drawn (`override`, which skips the area/shape rules below — though a real body's or face's skin mask may never be empty): hair is 3–20 % of the frame on `L30` and 0.7–1.3 × the same base's `face_neutral` hair mask on a face (skipped when that reference is empty); eyes on `neutral` are exactly two 8-connected blobs, 100–8000 px `@2x` each, one each side of centre — another open-eyed expression allows that or none, `closed`/`sleep` always none; tint is at least 2 % of the layer's own ink. A layer with no masks cut for it yet reports `-`. **Plan 19 (§4.4.1):** skin on a body `L30` covers `SKIN_AREA` (0.35–0.85, provisional until the style gate sets it to the real bodies' ± 0.10) of the layer's own ink; on a body face, the skin **and the eye zone** together — the pixels of the face's ink in its skin mask or in `eyeZone` (the eye ellipses and its eye mask, widened by `eyeMargin`; until the style gate exactly what `skinMask` took out, now only the eye mask's 1 px is, §4.4.1) — are 0.8–1.2 × the same measure on the same gender's `face_neutral` (controller ruling, 2026-10-03: between expressions only the eye region moves between "eye" and "skin" — a shut eye is eyelid skin, an open one iris, white and margin — so skin alone ran 1.3–1.5 × on shut-eye faces while the head's skin and eyes stay the same size — less since the style gate, when the open face's skin stopped giving up a ring round each eye, but still past 1.1 ×) — measured only when **both faces are real or both are stand-ins**, because between the style gate and batch C1 the neutral face is real art and the other five are still stand-ins, and a stand-in's oval says nothing about a drawn face; a mixed pair passes with `n/a — neutral is real, this face is a stand-in` (or the reverse) in its detail. On a **real face against a real neutral** two guards follow (controller ruling, A1b fix round 3), because a stray white blob in the eye band swells the eye zone and leaves the union at 1.00 × (§4.4.1; until the style gate the skin also lost exactly what the zone gained, now it loses nothing and the eye-zone guard is the one that catches it): **skin alone at least 0.8 ×** the neutral's skin alone (one-sided — a shut face only gains skin) and **the eye zone at most 1.5 ×** the neutral's eye zone, failing as e.g. `skin alone 0.76 × neutral's (min 0.8)`, `eye zone 1.87 × neutral's (max 1.5)`. They do not catch everything: a small pale feature — a tear, a highlight — can still inflate the eye zone under the limit (a pale tear on the test face: 1.27 ×); since the style gate that no longer costs the skin anything, but a skin mask can be wrong in other ways, so every real face's skin-mask overlay is checked by eye at the style gate and in batch C1. A real face whose own skin mask is empty fails — a hand-drawn one too — and so does a real face whose neutral face has no skin to compare with (a stand-in pair only notes it); a **real** v4 layer must carry the masks of its kind (skin on a body; skin and eyes on a face; hair on a hair layer) — one without them fails rather than reporting `-`, unless it is marked `empty: true` (a short hairstyle's blank `L20`, §4.6), which has nothing for a mask to sit on; a body face's eyes follow the base faces' rules; hair on a hair layer covers at least 0.9 of the layer's ink; and on any layer that has both, skin and eyes share no pixel at alpha ≥ 128 — hand-drawn or not |
| C12 | **The head stays put** ("đầu không xê dịch", Plan 19 §5.1, rulings 1–2): a real `body_<g>_L30` keeps F01's head, so every hat, pair of glasses, aura, frame and the portrait crop cut on F01 fit it. F01's skull cannot be measured (its hair is baked into its L30), so the eyes and the chin are: `headMetrics` takes the centroid of the gender's `face_neutral` eye mask at alpha ≥ 128 either side of its middle column, **in frame units as pixel index / 2 at `@2x`, with no half-pixel offset**, their midpoint and x distance, and the chin from `measure` on the body's `@1x`. Eye midpoint x and y and eye span must each lie within `HEAD_TOLERANCE` (4.16, 2 % of the 208 crop) of `HEAD_REFERENCE` — F01's own (190.9, 194.0) and 60.6 — and the chin within `CHIN_TOLERANCE` (12) of F01's 243 (controller ruling, Plan 19 gate: a bald chibi face is drawn shorter than F01's framed one — real v4 bodies chin at 233–236 with their eyes within ~2 units — and the chin anchors nothing once the outfits are redrawn on the new bodies, while glasses ride the eye line and hats the head top), for **both** genders: M01's head, measured the same way, sits 4.6 units lower (198.6) and is not a second reference. A failure names each part that is off, how far it is and its limit, e.g. `eye line 6.0 from F01's (want within 4.16)` or `chin 13.0 from F01's (want within 12)`, followed by ` — ` and where the eyes and chin are. A stand-in body, a real body whose neutral face is still a stand-in (the eyes it would measure are the stand-in's), a body whose neutral face has no eye mask, and every other layer report `-` |
| C13 | **The hair splits cleanly** ("tóc tách đúng", Plan 19 §5.4, §4.5 above): checked on a hair `L60` whose entry records a `split`, together with its `L20` sibling, counting pixels at alpha ≥ 128 at `@2x`. **No pixel is in both layers** (a strand drawn twice is over the face *and* behind the body); the two layers together hold **at least `HAIR_COVERAGE` (0.99) × `split.region`** (a strand in neither is lost from every look that wears the hairstyle); and the front covers **at most `HAIR_EYE_LIMIT` (1 %)** of the gender's `body_<g>_face_neutral_L50` eye mask — a fringe over the eyes hides every expression under it. Failures read e.g. `the two layers overlap at 120 pixels`, `the split covers 0.53 of the hair, want ≥ 0.99` (the share rounded down), `the front lies over the eyes on 33.2 % of the eye mask, want ≤ 1 %`. The eye part is `n/a` while the neutral face has no eye mask, and it is measured **like with like** only, as C11 and C12 are (controller ruling, A1c review): real hair against a stand-in neutral face reports `eyes n/a — body_<g>_face_neutral_L50 is a stand-in`, a stand-in hairstyle against a real one `eyes n/a — … is real, this hair is a stand-in`, because a stand-in's eyes are drawn where no head was measured. Overlap and coverage are checked in every case; a missing `L20` fails. The `L20` reports `-` (`n/a — checked with its L60`), as do an `L60` with no `split` and every other layer. On the stand-ins every `L60` passes with no overlap, coverage 1.00 and 0.0 % of the eyes |

## 6. Placeholder vs. real

Every manifest entry carries exactly one of two flags, never both: `"placeholder": true` for a stand-in
`avatar:placeholder` drew, `"real": true` for a layer `avatar:ingest` wrote from an actual picture.
`avatar:placeholder` reads this before it draws anything — an entry already marked `real` is left alone,
so running it again after some art has landed cannot silently overwrite that art with a shape. There is
no path back from `real` to `placeholder`: ingesting is the one-way door design §9's roadmap describes,
walked one item at a time as pictures are produced.

A real entry may also carry `"variantOf"` and `"wear"`: a per-wear cut of another item's layer (§3.1),
which is always real — `placeholder` never draws one — and which `variantOf` ties back to the item it
belongs to.

A real entry may also carry `"copyOf"` (2026-09-24): a bot's face written at the ingest of its neutral
picture as a byte copy of `bot_<n>_face_neutral_L50`, because the registry generates only a neutral and a happy
face per bot (§4.3). It is real — `placeholder` leaves it alone — and a later picture of that face replaces it
with an entry that has no `copyOf`.

A real entry may also carry `"empty": true`: an AI base's hair layers, which ship as fully transparent
frames (§2). `avatar:check` holds such a layer to being fully transparent at both densities (C3) and
reports C4–C6 as `-` for it; a fully transparent layer *without* the mark fails C3.

**A v4 stand-in carries its masks** (Plan 19, 2026-10-03). The server, the kit and the wardrobe are built on
stand-ins before the v4 art exists, and they tint skin, eyes and hair through masks, so `placeholder` draws
each body, body face and hair layer (§3) together with the masks real art will have:

| Stand-in | Masks | Drawn as |
|---|---|---|
| `body_<g>_L30` | `skin` | `relaxedFigure()` (`frame.mjs`): the bases' figure in the relaxed pose — the left leg resting out, both arms angled away, five short finger strokes per hand — with a bald head and a `body f` / `body m` plate. `figure()` itself is unchanged, because the old bases and the bots still draw with it |
| `body_<g>_face_<expr>_L50` | `skin`, `eyes` | the face oval and the expression, plate `f happy` |
| `item_hair_<g>_<code>_L60` | `hair` | a fringe-and-crown cap in the hairstyle's own tint, lowest point y 120 — clear of every stand-in eye (y 127–160) |
| `item_hair_<g>_<code>_L20` | `hair` | a long style (`f_hime01`, `f_wavy01`, `f_ponytail01`): two panels behind the shoulders, either side of the torso, from y 238 down; a short style: a crescent behind the head from y 130 down |

- The masks are **rendered** from the stand-in's own shapes (`placeholderMaskSvg`), never cut by the
  algorithm: a stand-in is flat colour, so its masks are exactly what was drawn.
  - **skin** is the skin-coloured shapes, less everything drawn on them — eyes, sad's tear, sleep's Z, the mouth
    and the plate — each cut 1 frame unit wider than drawn, so no pixel is ≥ 128 in both the skin and the eye
    mask;
  - **eyes** is the eye shapes alone: not the tear, which would split the right eye's blob, and nothing at all on
    `closed` and `sleep`, whose mask is written empty and marked `"empty": true`;
  - **hair** is the whole hair shape; the plate sits inside it.
- They are written as §4.4 describes — `<layer>_skinmask`, `_eyemask`, `_hairmask`, white with the coverage in
  alpha, at both densities — and the entry's `masks` holds `{ bytes2x, meanL }` for each, `meanL` measured on the
  stand-in itself.
- A hair L60's entry also holds `split: { region, front, back }`: in `@2x` pixels, the hairstyle's region (every
  pixel at least half covered by either layer's hair mask) and how much of it each layer holds. The two stand-in
  layers never share a pixel, so `front + back = region`.
- Every stand-in carries its code on an opaque plate inside its own shape. A long style's back plate runs up its
  left panel, turned a quarter, because a panel is narrower than the code.

`apps/normal-web/public/avatar/` ships whatever mix of the two the repository is currently at. Nothing
downstream — the server's catalogue, the kit's `Chibi`, any test — treats the two differently; a
placeholder is exactly as valid a layer as a real one, just not the picture the design wants for good.

## 7. How the kit composes a chibi

`@bp/ui-kit`'s `Chibi` (`packages/ui-kit/src/avatar2d/Chibi.tsx`) takes a `ChibiConfig` — since avatar v4 a `BodyRef` (the
body of a gender), a `HairRef` (a hairstyle's two layers), a `WearRef` per equipped slot and up to three colours — and stacks one `<img>` per layer `layersFor` returns (§2 above),
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
every device, with no request involved (`packages/ui-kit/src/avatar2d/defaults.ts`). Since avatar v4 (spec
`2026-10-03-avatar-v4-design.md` §6.4) that figure is **a body per gender** (`body_<g>_L30` with its six
`body_<g>_face_<expr>_L50`), **that gender's default hairstyle** (`hair_f_bob01` or `hair_m_tousled01`, a back half
`item_hair_<code>_L20` and a front half `_L60`) and `item_outfit_casual01_L40`, the one default outfit; a bot is
`bot_<n>_L30` and its six faces.

`apps/lite/scripts/build.mjs`'s `copyAvatarAssets()` copies **exactly those files, at `@1x` and `@2x`, and nothing
else** out of `apps/normal-web/public/avatar/` into `dist/public/avatar` — no mask (Lite never recolours: no
`_skinmask`, `_eyemask`, `_hairmask`, `_tintmask`), no old `base_*` ("bỏ được các ảnh base thừa"), and no *other*
wardrobe item, because Lite ships no store to buy them from — as one step of a full build, after the web bundle and
before the SEA blob is assembled. The bodies and the bots follow from their names (`isLiteAvatarFile`'s one pattern,
`scripts/avatar-files.mjs`); the rest is **read out of `items.json`**:

- **The default outfit** (2026-09-20): its `asset.file` *and every variant of it the catalogue lists* (§3.1), because
  a body drawn in a cut Lite did not copy renders undressed. Adding a cut to the default outfit stays one line of data.
- **The default hairs** (v4): for each of `LITE_DEFAULT_HAIRS` — the kit's and the server's `DEFAULT_HAIR` pair — the
  row's `asset.back` (L20) *and* `asset.file` (L60), because a hairstyle is two layers and a figure missing either
  renders bald. The build stops if a default hair is not in the catalogue, is not a `hairStyle`, lacks a layer, or names
  a file that `public/avatar/` does not have.

The names in `LITE_DEFAULT_HAIRS` are Lite's own copy of the kit's: `apps/lite/test/avatar-files.test.ts` pins them
and checks that the copy is **exactly the set the kit draws** (every `layersFor` file of both default chibis and the eight
bots, nothing more), and the Lite e2e checks at runtime that every layer on a table decodes. A third default hairstyle, a
male cut of the default outfit or a ninth bot is therefore a change that the tests name rather than a bald figure that
nobody sees. There is no dev-time equivalent of that copy (`docs/known-limitations.md`):
`pnpm --filter @bp/lite dev` needs `apps/normal-web` built at least once first, or every chibi 404s.

## 9. Adding an item, end to end

1. **The picture.** Draw it, or generate it against the locked block (D02, always **on F01** — every base
   shares her silhouette, and the layer carries no skin, so one picture serves them all: §4.1.1) and
   green-screen or white-background it per
   D01 §8. Then `avatar:ingest <file> --as item:<slot>:<code>` (§4 above); `--dry-run` first if unsure,
   and `avatar:check <name>` after, since ingest does not run the acceptance criteria itself.
2. **The catalogue.** Add the row to `apps/normal-server/data/items.json`: `id`, `slot`, `rarity`,
   `isDefault`, and `asset.{layer, file}` — `file` is the manifest name `ingest` just wrote, with no
   density suffix. An item that needs a second cut for male figures gains `asset.variants` later, and
   stays this one row when it does (§3.1). The server validates every row against the committed manifest at boot
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

## 9.1 Adding a base, end to end

Since 2026-09-17 a base is **data**: `BaseId` is `string` on the server (`inventory/slots.ts`), in the web
app (`src/api.ts`) and in the kit (`makeBase`), and what makes a given string a base is the registry,
`apps/normal-server/data/avatar-bases.json`. Adding `f02` is art, one JSON entry and one name per language —
no union to widen in three packages, and no tile to add to the wardrobe.

Two lists say what exists, and they are not interchangeable:

| | |
|---|---|
| `BASES` + `BASE_WEAR` (`scripts/avatar-pipeline/manifest.mjs`) | **the source of truth.** It is what `placeholder` draws a full stand-in set for, what `stageOneFiles` names, what `check` walks and what `sheet` composes — and which body each one wears its clothes on (§3.1). Art first. |
| `data/avatar-bases.json` | the server's registry, which *mirrors* it. Every entry names seven manifest files and declares its `wear`; `loadBases` refuses at boot any name the committed manifest does not list and any entry without a wear, so a base added here before its layers exist fails fast. The two files are held against each other by `apps/normal-web/test/avatar-pipeline.test.ts`. |

The order, therefore:

1. **The list.** Add the id to `BASES` *and its wear to `BASE_WEAR`* (the module refuses to load
   otherwise), then run `avatar:placeholder`. Nine stand-in files appear — `L20`,
   `L30`, `L60` and six expressions — in their own skin, hair and underwear tones, so a sheet of three bases
   reads as three characters rather than one drawn three times. The app builds and runs from here.
2. **The pictures.** Seven of them: the figure (`--as base:f02`) and five more expressions
   (`--as expr:f02:happy`, …; the base's own ingest writes `neutral`). Generate them against D02's locked
   block, on the same canvas as F01 — same body, same pose, its own head, hair and skin. Then
   `avatar:check`, and `avatar:sheet` to look at it beside the others.
3. **The registry entry.** A `bases.f02` `nameKey`, its `wear` (the same letter `BASE_WEAR` gave it), the
   three `layers` and the six `faces`, named exactly as
   `ingest` wrote them. `loadBases` validates every one against the manifest, requires `DEFAULT_BASE` to be
   present, and holds an id to `[a-z][a-z0-9]*` because it ends up inside a file name.
4. **The name, in both languages.** `bases.f02` in `apps/normal-web/src/locales/vi/normal.json` *and*
   `.../en/normal.json`. `locales.test.ts` fails if the registry names a base neither language does;
   `bases.f02` and `bases.f03` are already written, ahead of any art.
5. **Nothing else.** `/api/catalog/avatar` answers with every registry entry in the file's own order, the
   wardrobe's base tab renders one tile per entry, an item layer is worn unchanged (§4.1.1 is what makes
   that true across skin tones), and a stored config naming a base the registry has since dropped falls back
   to `DEFAULT_BASE` on read while `PUT` refuses it with `INVALID_BASE`.

## 10. Sổ tài sản và vòng lặp sinh ảnh — the asset registry and the generation loop (2026-09-24)

Plan 12, spec `docs/superpowers/specs/2026-09-24-avatar-asset-registry-design.md`. The pictures still to
generate are no longer a list in a chat: they are `assets/avatar-src/registry.json`, committed (the folder's
`.gitignore` carries `!registry.json`; the pictures themselves stay ignored), and
`apps/normal-web/scripts/avatar-registry.mjs` (`pnpm --filter @bp/normal-web avatar:registry <command>`)
drives it. Claude generates the pictures in ChatGPT in the user's Chrome, with the Claude in Chrome tools,
following §10.3; the script does everything either side of that.

### 10.1 The registry

One file: `{ version: 1, meta, templates, assets }`. It never repeats what another file owns — rarity,
achievements, frame geometry and catalogue names stay in `items.json`, `avatar-bases.json` and the pipeline —
and points at them by `catalog` id.

| Field | |
|---|---|
| `id` | the layer name without `_L<n>` (`item_head_beret_red01`, `f02`, `bot_3`, `body_f`, `item_hair_f_bob01`); a second face of an owner is `<owner>:<expression>` (`f02:happy`, `bot_3:happy`, `body_f:happy`) |
| `kind` / `slot` / `wear` | `base`, `expression`, `item` (slot `head`/`face`/`outfit`), `aura`, `frame`, `bot`, and since Plan 19 (v4) `body`, `bodyExpression`, `hair` (no slot); `wear` is `f`/`m` for a base, a body, a body's face, a hairstyle or an item's per-wear cut |
| `catalog` | the id in `avatar-bases.json` / `items.json` (`bot_<n>` for a bot, the gender for a body, `hair_<code>` for a hairstyle) |
| `look` | what `{{look.<key>}}` in the template reads |
| `reference` | the picture attached in ChatGPT: a file in `assets/avatar-src/`, `@<id>` of another asset (its `file`), or null (aura, frame) |
| `prompt` | null: rendered from `templates[kind]` (an item: `templates[slot]`) on every read, so editing a template edits every prompt; a string: a manual override |
| `file` | the generated picture's name in `assets/avatar-src/` |
| `ingest` | `{ as, base, variant, flags }` — the pipeline's `--as`, `--base`, `--variant` and extra flags (`--hides-hair-front`, …; since Plan 19 also `--hair <code>`, `--anchor head`, `--recolour-to <#rrggbb>`) |
| `status` | `todo` → `generated` → `ok` / `ng` → `approved`; `rework-<n>` (sent back by the user or by Claude's eye); `blocked` |
| `attempts` | one per picture: `{ n, at, chat, file, measure, verdict, reason, by }` |
| `ingested` | true once `ingest` has put it into `public/avatar/` |

The rules:

- **Ready** means: status `todo`, `ng` or `rework-<n>`; fewer than three attempts; and the reference resolves —
  the file exists, or the `@<id>` asset is `ok` or `approved` (so a base's expressions wait for the base).
- **Order** (`next`; Plan 19): bodies, hairstyles, outfits, the bodies' other faces, bots, head items, face
  items, then Plan 12's bases, expressions, auras and frames; within a group, the file's own order. (Plan 12 put
  head, face and outfit items first; every Plan 12 asset is done or blocked, so the reorder moved nothing.)
  `next --only <id,…>` hands out only the named ids — each still only once it is ready — in that same order;
  the style gate (Phase B) uses it to pick its five assets out of the queue.
- **The v4 kinds** (Plan 19). The ingest target and the reference of each:

  | Kind | `ingest.as` | Reference | Transform the cut takes |
  |---|---|---|---|
  | `body` | `body:<g>` | `f01_candidate_1.png` | f01's (`--anchor head` in `flags` then moves it by the eyes) |
  | `bodyExpression` | `face:<g>:<expr>` | `@body_<g>` | the body's own |
  | `hair` | `hair:<code>` (the code starts with its gender) | `@body_<g>` | the body's own |
  | `item` on a body | `item:<slot>:<code>`, `base` `f`/`m` (`--hair <code>` when drawn over a hairstyle) | `@body_<g>` | the body's own |
  | `bot` on a body | `bot:<n>` / `bot:<n>:happy` | `@body_f` / `@v4/bot_<n>` | the body at the root of its references (`transformSource`) |

  Reading the registry refuses a body, a body's face or a hairstyle whose `ingest.as` is not that target, and a
  hairstyle whose code is not one of the pipeline's eight (`HAIR_CODES`), naming the asset.
  `transformSource` (`scripts/avatar-registry/registry.mjs`) is the one place that says which transform a body,
  a bot or a new base is cut on; `ingest` and `verify` both ask it. It follows a bot's references back to the first
  picture that is a base's or a body's own: `v4/bot_3:happy` → `@v4/bot_3` → `@body_f` → body f; Plan 12's
  `bot_3:happy` → `@bot_3` → `f01_candidate_1.png` → f01.
- **The v4 templates** (Plan 19, A2c). `templates.body` is the **character lock** (spec §5.2): the head must be
  completely bald for a dress-up base, the face kept at exactly F01's size and place, `CHARACTER LOCK BODY_<code>`,
  then head, face (no blush, no makeup), cream skin, the relaxed pose, hands "with exactly five fingers (four
  fingers and one thumb)", clothing, line art and rendering. The clothing is a plain **mid-gray** tank top and
  **charcoal** shorts: a light-grey top would sit inside the skin mask's tolerance of cream (§4.4.1, A1b ruling;
  the real art's light top is now kept out by `minChroma`). Its look holds `code`, `figure`, `head`, `eyes`, `mouth`, and `head_fallback` — the buzz
  cut B2 puts in a manual prompt when ChatGPT cannot draw a clean bald head (R1). `templates.bodyExpression` (only
  the eyes and mouth, on the bald body) and `templates.hair` (`{{look.description}}`, `{{look.colour}}` — the
  hairstyle's natural colour with its hex; hair longer than the neck falls behind the shoulders, never over the
  tank top, arms or hands) are new. `outfit` (the head stays bald; no sleeve reaches past the wrists, so a short
  sleeve stays short and every finger stays visible), `head` (the hat sits on the hair; the fringe below the brim stays), `face` and `bot` ("the same relaxed
  standing pose and the same five-fingered hands") are rewritten for the new body; Plan 12's head and face items,
  casual01 and bots render from them too, but all of them are done or blocked. `base` and `expression` stay for
  Plan 12's assets until D1. Every v4 template ends with a **size line**: "Output the exact same image size as the
  input, 1024 by 1536 pixels," then, for a body, "with the face in exactly the same place and at exactly the same
  size as in the input", for a hairstyle "and keep the body's exact outline, width and height", and for the
  others "and keep the figure's exact outline, width and height".
- **The v4 assets and ids** (Plan 19, A2c; R16). A v4 redraw of a Plan 12 asset is **`v4/<old id>`** with the file
  **`v4_<old file>`**, so its attempts never mix with Plan 12's history; the new kinds take new ids. A2c seeds 44,
  all `todo`, in this file order — the style gate's five (both bodies, `f_bob01`, `m_tousled01`, casual01) first
  within their kinds:

  | Ids | Kind | Reference | File | `ingest` |
  |---|---|---|---|---|
  | `body_f`, `body_m` | `body` | `f01_candidate_1.png` | `body_<g>.png` | `body:<g>` |
  | `item_hair_<code>`, the eight `HAIR_CODES` | `hair` | `@body_<g>` | `item_hair_<code>.png` | `hair:<code>` |
  | `v4/item_outfit_<code>`: casual01, dealer01, tuxedo01, royal_robe01, tet_red01, champion01 | `item` / `outfit` | `@body_f` | `v4_item_outfit_<code>.png` | `item:outfit:<code>`, `base` f |
  | `v4/item_outfit_dealer01_m`, `v4/item_outfit_tet_red01_m` (`wear` m) | `item` / `outfit` | `@body_m` | `v4_item_outfit_<code>_m.png` | `item:outfit:<code>`, `base` m, `variant` m |
  | `body_<g>:<expr>`: happy, sad, surprised, closed, sleep | `bodyExpression` | `@body_<g>` | `body_<g>_<expr>.png` | `face:<g>:<expr>` |
  | `v4/bot_<n>`, n 0–7 | `bot` | `@body_f` | `v4_bot_<n>.png` | `bot:<n>` |
  | `v4/bot_<n>:happy` | `bot` | `@v4/bot_<n>` | `v4_bot_<n>_happy.png` | `bot:<n>:happy` |

  casual01's and the bots' looks are copied from their Plan 12 assets, the body faces' from f02's and m02's; the
  other outfits describe today's pictures (`item_outfit_<code>_icon@2x.png`) so the redraw keeps their design.
  `next` alone would hand out all eight hairstyles before casual01 (`PRIORITY`), so the gate names its assets with
  `next --only`. C3 and C5 add more the same way (`v4/item_outfit_<code>_m`, `v4/item_head_<code>`,
  `v4/item_face_<code>`).
- **Fix lines.** After a failure the next prompt is the prompt plus one line per *distinct* reason the earlier
  attempts failed for: `redrawn` → "same image size, same hair, same clothing", `tears` → "No tears",
  `hair_colour` → "same hair colour", `background` → "transparent background, no checkerboard", `cropped` →
  "whole figure inside the image", `strap` → "The tank top must be completely gone: no straps, no gray
  fabric anywhere", `scope` → "Change nothing outside the requested area". Plan 19 adds two the pipeline
  gives — `check:C12` → "Keep the face exactly the same size and in exactly the same place as in the input; only
  the body pose changes", `check:C13` → "The hair never covers the eyes; hair longer than the neck falls behind
  the shoulders" — and three only an eye gives, recorded with `reject <id> --reason fingers|bald|pose` when a
  picture `verify` passed fails the controller's look: `fingers` → "Each hand shows exactly five separate
  fingers: four fingers and a thumb", `bald` → "The head is completely bald: no hair, no hairline, no stubble",
  `pose` → "Relaxed pose: weight on one leg, arms hanging loosely away from the body". `style` (the user's
  taste) and every other reason add nothing.
  A body and a hairstyle have their own `redrawn` line (`KIND_FIX_LINES`, A2b review): either is `redrawn` only
  when it comes back on another canvas, and "same hair" would tell the model to keep hair on a bald body. A
  body's is "Output the exact same image size as the input, 1024 by 1536 pixels, with the face in exactly the
  same place and at exactly the same size as in the input"; a hairstyle's "Output the exact same image size as
  the input, 1024 by 1536 pixels, and keep the body's exact outline, width and height". Every other kind keeps
  the line above.
- **Three attempts.** The third `ng` sets `blocked`; the loop skips it and Claude tells the user.
- **Only the user approves.** `approve <id…>` or `approve --batch` (every `ok`) after the user answers a
  sheet; the user's "<id> ng" is `reject <id> [--reason style]`, which re-judges the last attempt (`verdict:
  'ng'`, `by: 'user'`) without spending an attempt and sets `rework-<n>` — or `blocked` after the third.

### 10.2 The commands

```bash
avatar:registry next [--limit n] [--json] [--only <id,…>]   # ready assets: id, file, reference path, attempt n, the prompt
avatar:registry collect <id> --chat <url> [--downloads <dir>] [--file <png>]
avatar:registry verify [<id…>] [--keep-tmp]  # every generated asset, or these
avatar:registry verify --picture <png> --as <spec> [--reference <png>] [--base <id>] [--variant <f|m>]
                       [--hair <code>] [--anchor head] [--recolour-to <#rrggbb>] [--transform-from <id>]
avatar:registry ingest [<id…>]
avatar:registry approve <id…> | --batch
avatar:registry reject <id…> [--reason style]
avatar:registry status                       # counts per status, the blocked ones with their reasons
```

`collect` takes the newest `*.png` in the downloads folder (`%USERPROFILE%\Downloads` unless `--downloads`;
ChatGPT names them `ChatGPT Image Sep 24, 2026, 12_42_45 AM.png`) that is newer than the asset's last attempt
— or at most 30 minutes old for a first attempt — and refuses, saying what it found, when there is none.
The picture replaced in `assets/avatar-src/` is kept as `<name>.prev<k>.png`. `verify --picture` scores one
file without touching the registry — the way to try a rule on a picture by hand. Its reference defaults to the
owner's picture: `f01_candidate_1.png` for a base, a body or a bot, `body_<g>.png` for a body's face, a hairstyle
or an item on a body (`--base f|m`), `<base>_candidate_1.png` otherwise. It takes the v4 flags as the registry's
`ingest.flags` would carry them, and `--transform-from <id>` where the reference's name cannot say which transform
a bot is cut on (a v4 bot: `--transform-from f`).

`next --only <id,…>` (Plan 19) hands out only the named ids, comma-separated, in the usual order and each only
once it is ready (`next --only item_hair_f_bob01` prints nothing while `body_f` is not `ok`); an id the registry
does not have is refused. `--limit` still applies.

### 10.3 Generating in ChatGPT (Claude, with Claude in Chrome)

There is no script for this step; it is a fixed procedure. The user approved the downloads for the whole loop
(2026-09-24).

1. `avatar:registry next --limit 10`. Each entry gives the asset id, its file, the **absolute path** of the
   reference picture (or "none") and the prompt, fixes included.
2. For each asset, in order:
   1. Open `https://chatgpt.com/` in a new tab — a new chat for every asset, so nothing of the last picture
      carries over.
   2. Attach the reference picture through the page's hidden `input[type=file]` (Claude in Chrome's file
      upload, with the absolute path from step 1). An aura or a frame has none; skip this.
   3. Paste the prompt exactly as `next` printed it, and send.
   4. Wait for the assistant's image to finish (up to 4 minutes). The chat URL is now
      `https://chatgpt.com/c/<id>`; note it.
   5. Click the image's download button.
   6. `avatar:registry collect <id> --chat <url>`.
3. A message that the image limit is reached, or a CAPTCHA: **stop**. Claude does not solve a CAPTCHA. Set
   `meta.pausedUntil` in `registry.json` to when the limit lifts (ISO time — `next` hands nothing out
   before it), and tell the user.
4. `avatar:registry verify`, then — for each `ng` still under three attempts — back to step 2 with the new
   prompt `next` prints.

When ChatGPT's page changes, this procedure changes; the registry does not.

### 10.4 What `verify` measures

`verify` never writes into `public/avatar/`. The rules run in order, the first failure is the `reason`, and
every number computed up to it is stored on the attempt as `measure` (`scripts/avatar-registry/verify.mjs`
has the exact definitions).

| Reason | Fails when |
|---|---|
| `size` | a figure: not portrait, height under 1152, or an aspect more than 5 % off both 2:3 and 3:4 — the image model answers a 1024 × 1536 edit with **1086 × 1448**, and that picture is usable; an aura or frame: more than 5 % off square, or a side under 1024 |
| `background` | a corner is not fully transparent, or more than 5 % of the outer 8 px band is opaque near-white or near-grey (a painted checkerboard) |
| `redrawn` | against the reference: the scale (reference height over picture height, head top to feet) is outside 0.90–1.10, or the width ratio after that scaling is outside 0.96–1.04 — a figure redrawn wider at the same height, which the pipeline could only register at IoU 0.645 |
| `drift` | an edge of the box is more than 12 px off the reference's. A base: all four edges of the raw box. An expression, a face or an outfit: all four, the top taken at `measure()`'s head top (below the strand of hair, which a generator redraws differently every time) unless the raw box tops agree better. A head item: left, right and bottom only — a hat hides the strand and moves the top (a visor dropped it 77 px). An outfit's bottom edge may sit up to 24 px *lower* (shoes) |
| `heads` | outside 2.0–2.5 heads (`measure()` after `removeChroma`); not asked of a head item, whose hat counts as head |
| `hair_colour` | the mean colour of the top-of-head band (x 330–700, y 250–330 of the reference) moved by more than 12 — expressions, face and outfit items (not a head item: the hat covers the band) |
| `scope` | 1 % or more of the figure changed outside what the asset may change: an expression, below the head region (`FACE_LIMIT_Y`); a head or face item, below `HEAD_LIMIT_Y` and outside the crop. Not an outfit, whose cut discards everything above the chin line anyway. "Changed" is asked the way `diffAgainstBase` asks it: no reference pixel within 2 px is within RGB distance 40 |
| `check:<Cn>` | the criteria (§5; thirteen since Plan 19) on the layers an ingest into a **copy** of `public/avatar/` wrote; a new base's expression gets its base ingested into the copy first, from the reference. `pipeline` if the ingest itself threw |
| `hollow` | an aura or a frame: mean alpha inside 40 % of the half-width is 0.05 or more — asked right after `background`; an aura or a frame that passes goes on to the `check:<Cn>` / `pipeline` rule and nothing else (2026-09-24) |

A picture on the reference's own canvas is compared where it stands, since the pipeline will cut it there. A
picture on another canvas is scaled and anchored onto the reference's first — head top and centre line, or a
head item's feet and centre line — and the pipeline is given that aligned copy, because an expression or item
is cut with its base's stored transform, measured on the reference's canvas. Since 2026-09-24 (§4.3) a bot runs
the pipeline rule too, on f01's transform: `bot:<n>` is checked on its body and all six faces, `bot:<n>:happy`
on that one face. A bot's picture is handed to the pipeline as it is, not aligned: it is taken to be on
F01's own canvas (§4.3), like a base drawn with `--transform-from`.

**The v4 kinds (Plan 19).** The same rules in the same order; `—` means not asked.

| Kind (reference) | `redrawn` / `drift` | `heads` | `hair_colour` | `scope` | `check:<Cn>` |
|---|---|---|---|---|---|
| `body` (`f01_candidate_1.png`) | **the bottom edge and the centre line of the figure box only**, each ≤ 12 px (pre-flight #23): the feet stay on F01's ground line. The bald head (lower and narrower than F01's hair) and the new pose (the arms elsewhere) are meant to differ. On another canvas: `redrawn`, since a body is cut on f01's transform, as a bot is | 2.0–2.5 | — | — | ingest `body:<g>` into the copy on f01's transform (with the asset's `--anchor head` when its `flags` carry it); C1–C13 on `body_<g>_L30` and `body_<g>_face_neutral_L50` — C12 holds the head |
| `bodyExpression` (`@body_<g>`) | as an expression | advisory, as an expression | as an expression (on a bald body the band is the scalp) | the head region (`FACE_LIMIT_Y`), as an expression | as an expression: `face:<g>:<expr>` on the body's transform; C1–C13 on `body_<g>_face_<expr>_L50` |
| `hair` (`@body_<g>`) | **the bottom edge and the centre line of the legs only** — the rows from 0.8 of the body's height down, which no hairstyle reaches — each ≤ 12 px. On another canvas the picture is placed at scale 1 by those two first (the model's 1086 × 1448 moves the figure, it does not resize it), and is `redrawn` if the legs' width ratio is then outside 0.96–1.04 | — | — | outside the head region **and** outside the body grown by 4 px (`HAIR_BODY_MARGIN`, `allowedArea('hair')`): hair falls behind the shoulders and the back, never over the torso, the arms or the hands | `hair:<code>` on the body's transform; C1–C13 on `item_hair_<code>_L20` and `_L60` — C13 holds the split |
| `item` on a body (`@body_<g>`, `base` `f`/`m`) | as today | as today | as today | as today | as today, owned by the body; `--hair <code>` passed through |
| `bot` on a body (`@body_f`, `@v4/bot_<n>`) | as today (feet and centre line) | — | — | — | as today, on the transform `transformSource` names: body f's |

What the cut needs comes from `transformSource` (§10.1), never from the reference's file name. When the copy has
no transform for the owner yet, the reference is ingested into the copy first: as `base:<id>` as before, or as
`body:<g>` when the owner is a body (a hairstyle, a body's face or an item on a body verified before its body is
ingested). A bot's or a body's reference stands in only when it *is* the picture at the root of its references
(`referenceOwner`): `v4/bot_3`'s `@body_f` can, `v4/bot_3:happy`'s `@v4/bot_3` cannot, and that one fails
`pipeline` until body f is in `public/avatar/`. A body's face and a hairstyle on another canvas are aligned onto
the body's canvas before the cut, as an expression is; a body, like a bot, is handed over as it is. The asset's
`--hair`, `--anchor` and `--recolour-to` reach the trial ingest as they reach the real one.

Measured on the real pictures of Plan 11 (2026-09-24), every accepted picture passes: all ten real expressions,
`tophat01`, `glasses_round_gold01`, and all eight outfits and cuts (`casual01` as regenerated, `tuxedo01`,
`champion01`, `royal_robe01`, `dealer01`, `tet_red01`, `dealer01_m`, `tet_red01_m`). Two rulings of that day
made the outfits pass. **An outfit has no `scope` rule**: five of them had their whole head redrawn
(`tet_red01` 15.9 % of it changed, `tuxedo01` 4.4 %), and the outfit cut discards everything above the chin, so
none of it reached a layer. **An outfit's feet may sit up to 24 px lower** than the base's: `casual01`'s
sneakers put its bottom edge 19 px down.

### 10.5 What `ingest` does

For every `ok` or `approved` asset not yet `ingested`: the real pipeline `ingest()` into `public/avatar/`
(both manifests), with the asset's `ingest` spec, the registration line printed. Then:

- a **new base** is checked and not registered: it prints what `BASES`/`BASE_WEAR` (`manifest.mjs`),
  `avatar-bases.json` and `bases.<id>` in both locales still lack; adding it stays the hand edit of §9.1;
- an item's **per-wear cut** gains `asset.variants.<wear>` in `items.json`, if it is not there, in the file's own
  formatting (§3.1);
- a **bot, an aura or a frame** goes in like everything else (2026-09-24 — the "not supported yet" set is gone):
  `item:aura:<code>`, `item:frame:<code>`, `bot:<n>` and `bot:<n>:happy` are the pipeline's own targets
  (§4.3), passed straight through, and a bot is given f01's transform — the base at the root of its reference
  chain (`f01_candidate_1.png`, or `@bot_<n>` → that);
- a **body, a body's face or a hairstyle** (Plan 19) goes in on its own target (§4.6): a body on f01's
  transform, a face and a hairstyle on the body's; a v4 bot on the body at the root of its references
  (`transformSource`, §10.1). The asset's `--hair`, `--anchor head` and `--recolour-to` flags reach `ingest()`.

### 10.6 A batch

A batch is ten assets:

1. `next --limit 10`; generate and `collect` each (§10.3).
2. `verify`; regenerate each `ng` (at most three attempts in all); `ingest`.
3. `avatar:check`, `avatar:sheet`, then one commit, "art: batch n": `registry.json`, the layers and both
   manifests, and `items.json` if a variant landed.
4. Send the user the sheet. "<id> ng" → `reject <id>`, and the asset goes back into the queue with its reason;
   an answer of "ok", or silence, → `approve --batch`.
