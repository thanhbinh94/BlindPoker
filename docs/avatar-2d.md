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
- A pixel is skin when it is solid (alpha > 128) and either within ΔE76 `SKIN_MASK.tolerance` (22) of the seed in
  Lab, or within `hueSpread` (18°) of the seed's LCh hue, at L* ≥ `minL` (50), with a chroma `chroma` (0.5–1.6) ×
  the seed's. The second branch is shaded and lit skin, which travels a long way in Lab and keeps its hue; shaded
  cream sits at L* ~70 and stays in.
- **Why `minL` is 50:** the warm-brown outline the bodies are drawn with, `#7a4a32`, is L* 36.5 with a hue only
  17.7° from cream — inside `hueSpread`. Lightness is what keeps the line out, and the line keeps its colour, so it
  stays crisp on every skin tone. A pink mouth falls out on hue.
- **The limit of `tolerance`:** a *light* neutral is close to cream in Lab whatever its hue. Mid and dark greys
  fall out on their own (the stand-ins' `#9aa3ad` is ΔE 32 from `#f1d2b6`), but greys from about `#b9b9b9` to
  `#f8f8f8` — `#d9d9d9` and `#f0f0f0` included — and an off-white like `#fdf8f5` are within ΔE 22 and would be cut
  as skin. The eye white is taken out by geometry (next point). Pale underwear is covered by every outfit anyway
  (C6); at the style gate it is answered first by a darker underwear in the body template, then, if it persists, by
  a hand-drawn `_skinmask` override.
- The eyes are taken out, widened by `eyeMargin` (3 px): always the padded ellipse round each eye's white
  (`eyeEllipses`) — no eye mask holds the white, and an off-white sclera is within ΔE 22 of cream — and, on a face,
  the eye mask as written as well (a hand-drawn `_eyemask` included), so skin and eyes never share a pixel. This is
  the **eye zone** (`eyeZone`), and C11 measures faces by it (§5).
- **The eye zone can be too big.** `eyeEllipses` finds the eyes from white blobs in the eye band and unions every
  blob on a side, then mirrors the box to the other side. A small pale feature there that is not an eye white — a
  tear, a highlight on a cheek, a pale "zZ" bubble, white hair shine — widens both ellipses, and the skin mask loses
  what they gain: a white cheek sparkle on the test face grows them from 44 × 52 to 62 × 70 px and takes 24 % of the
  skin. C11's two guards on real faces (§5) catch a sparkle like that, but not everything: a pale tear still
  passes both (skin alone 0.93 ×, eye zone 1.27 ×), and the skin it takes stays cream when the face is tinted to
  another skin colour. So **every real face's skin-mask overlay is checked by eye** at the style gate and in batch
  C1, and a bad one is answered with a hand-drawn `_skinmask` override. Bald faces do not make this go away; there
  is just no hair shine left to cause it.
- What is left is closed by 2 px and kept to pieces of at least `minRegion` (40 px).
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

## 5. The thirteen acceptance criteria (`avatar:check`)

| | Checks (D01 §10, plan 13 §4.3, Plan 19 §5.1/§5.4/§5.5) |
|---|---|
| C1 | The frame, exactly, at both densities — one pixel out is a fail |
| C2 | Nothing opaque on the outermost row or column — except an aura (layer 10), which is 400 wide by design and reported `-` (2026-09-24, §4.3) |
| C3 | The empty part really is empty: no alpha at all more than 3 px outside the solid shape |
| C4 | No white fringe — the soft rim is the shape's own colour, not white bled in from the key |
| C5 | `head`/`face` items fit inside the 208×208 crop |
| C6 | An outfit covers the base's underwear — the band's non-skin pixels, on the bases whose body is real art (§4.1.1) **and that wear this layer** (§3.1: a variant is measured only against bases of its own wear; a default layer against every real base whose wear has no variant of that item); `--skip C6` exists for it |
| C7 | The `@1x` is really the `@2x` scaled down, not redrawn separately |
| C8 | The file name follows §3 above, with a layer that matches its slot |
| C9 | The manifest lists it, at that layer and that frame size |
| C10 | The `@2x` is inside the per-file share of the stage-1 budget (6 MB in the design; 32 MB since 2026-09-24 for real AI art, see `test/footprint.test.ts`), and the manifest's byte count matches the file on disk |
| C11 | Every mask a layer's manifest entry lists (§4.4, Plan 13) is the layer's own `@2x` size and covers none of its transparency; unless hand-drawn (`override`, which skips the area/shape rules below — though a real body's or face's skin mask may never be empty): hair is 3–20 % of the frame on `L30` and 0.7–1.3 × the same base's `face_neutral` hair mask on a face (skipped when that reference is empty); eyes on `neutral` are exactly two 8-connected blobs, 100–8000 px `@2x` each, one each side of centre — another open-eyed expression allows that or none, `closed`/`sleep` always none; tint is at least 2 % of the layer's own ink. A layer with no masks cut for it yet reports `-`. **Plan 19 (§4.4.1):** skin on a body `L30` covers `SKIN_AREA` (0.35–0.85, provisional until the style gate sets it to the real bodies' ± 0.10) of the layer's own ink; on a body face, the skin **and the eye zone** together — the pixels of the face's ink in its skin mask or in `eyeZone` (the eye ellipses and its eye mask, widened by `eyeMargin`: exactly what `skinMask` takes out) — are 0.8–1.2 × the same measure on the same gender's `face_neutral` (controller ruling, 2026-10-03: between expressions only the eye region moves between "eye" and "skin" — a shut eye is eyelid skin, an open one iris, white and margin — so skin alone runs 1.3–1.5 × on shut-eye faces while the head's skin and eyes stay the same size) — measured only when **both faces are real or both are stand-ins**, because between the style gate and batch C1 the neutral face is real art and the other five are still stand-ins, and a stand-in's oval says nothing about a drawn face; a mixed pair passes with `n/a — neutral is real, this face is a stand-in` (or the reverse) in its detail. On a **real face against a real neutral** two guards follow (controller ruling, A1b fix round 3), because a stray white blob in the eye band swells the eye zone by exactly what the skin loses and leaves the union at 1.00 × (§4.4.1): **skin alone at least 0.8 ×** the neutral's skin alone (one-sided — a shut face only gains skin) and **the eye zone at most 1.5 ×** the neutral's eye zone, failing as e.g. `skin alone 0.76 × neutral's (min 0.8)`, `eye zone 1.87 × neutral's (max 1.5)`. They do not catch everything: a small pale feature — a tear, a highlight — can still inflate the eye zone under both limits (a pale tear on the test face: 0.93 ×, 1.27 ×) and leave a patch that stays cream under every other skin colour, so every real face's skin-mask overlay is checked by eye at the style gate and in batch C1. A real face whose own skin mask is empty fails — a hand-drawn one too — and so does a real face whose neutral face has no skin to compare with (a stand-in pair only notes it); a **real** v4 layer must carry the masks of its kind (skin on a body; skin and eyes on a face; hair on a hair layer) — one without them fails rather than reporting `-`; a body face's eyes follow the base faces' rules; hair on a hair layer covers at least 0.9 of the layer's ink; and on any layer that has both, skin and eyes share no pixel at alpha ≥ 128 — hand-drawn or not |
| C12 | **The head stays put** ("đầu không xê dịch", Plan 19 §5.1, rulings 1–2): a real `body_<g>_L30` keeps F01's head, so every hat, pair of glasses, aura, frame and the portrait crop cut on F01 fit it. F01's skull cannot be measured (its hair is baked into its L30), so the eyes and the chin are: `headMetrics` takes the centroid of the gender's `face_neutral` eye mask at alpha ≥ 128 either side of its middle column, **in frame units as pixel index / 2 at `@2x`, with no half-pixel offset**, their midpoint and x distance, and the chin from `measure` on the body's `@1x`. Eye midpoint x and y, eye span and chin must each lie within `HEAD_TOLERANCE` (4.16, 2 % of the 208 crop) of `HEAD_REFERENCE` — F01's own (190.9, 194.0), 60.6 and 243 — for **both** genders: M01's head, measured the same way, sits 4.6 units lower (198.6) and is not a second reference. A failure names each part and how far it is, e.g. `eye line 6.0 from F01's`. A stand-in body, a real body whose neutral face is still a stand-in (the eyes it would measure are the stand-in's), a body whose neutral face has no eye mask, and every other layer report `-` |
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
copies the `base_*` and `bot_*` files, plus the default outfit's, out of
`apps/normal-web/public/avatar/` into `dist/public/avatar` — never any *other* wardrobe item, because Lite
ships no store to buy them from — as one step of a full build, after the web bundle and before the SEA
blob is assembled. Which files are "the default outfit's" is **read out of `items.json`**
(`scripts/avatar-files.mjs`, 2026-09-20): its `asset.file` *and every variant of it the catalogue lists*
(§3.1), because a Lite `m` base drawn in a cut Lite did not copy renders undressed. Adding a cut to the
default outfit therefore stays one line of data. There is no dev-time equivalent of that copy (`docs/known-limitations.md`):
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
| `id` | the layer name without `_L<n>` (`item_head_beret_red01`, `f02`, `bot_3`); a second face of an owner is `<owner>:<expression>` (`f02:happy`, `bot_3:happy`) |
| `kind` / `slot` / `wear` | `base`, `expression`, `item` (slot `head`/`face`/`outfit`), `aura`, `frame`, `bot`; `wear` is `f`/`m` for a base or an item's per-wear cut |
| `catalog` | the id in `avatar-bases.json` / `items.json` (`bot_<n>` for a bot) |
| `look` | what `{{look.<key>}}` in the template reads |
| `reference` | the picture attached in ChatGPT: a file in `assets/avatar-src/`, `@<id>` of another asset (its `file`), or null (aura, frame) |
| `prompt` | null: rendered from `templates[kind]` (an item: `templates[slot]`) on every read, so editing a template edits every prompt; a string: a manual override |
| `file` | the generated picture's name in `assets/avatar-src/` |
| `ingest` | `{ as, base, variant, flags }` — the pipeline's `--as`, `--base`, `--variant` and extra flags (`--hides-hair-front`, …) |
| `status` | `todo` → `generated` → `ok` / `ng` → `approved`; `rework-<n>` (sent back by the user or by Claude's eye); `blocked` |
| `attempts` | one per picture: `{ n, at, chat, file, measure, verdict, reason, by }` |
| `ingested` | true once `ingest` has put it into `public/avatar/` |

The rules:

- **Ready** means: status `todo`, `ng` or `rework-<n>`; fewer than three attempts; and the reference resolves —
  the file exists, or the `@<id>` asset is `ok` or `approved` (so a base's expressions wait for the base).
- **Order** (`next`): head items, face items, outfits (all on F01), then new bases, expressions, auras, frames,
  bots; within a group, the file's own order.
- **Fix lines.** After a failure the next prompt is the prompt plus one line per *distinct* reason the earlier
  attempts failed for: `redrawn` → "same image size, same hair, same clothing", `tears` → "No tears",
  `hair_colour` → "same hair colour", `background` → "transparent background, no checkerboard", `cropped` →
  "whole figure inside the image", `strap` → "The tank top must be completely gone: no straps, no gray
  fabric anywhere", `scope` → "Change nothing outside the requested area". `style` (the user's taste) and
  every other reason add nothing.
- **Three attempts.** The third `ng` sets `blocked`; the loop skips it and Claude tells the user.
- **Only the user approves.** `approve <id…>` or `approve --batch` (every `ok`) after the user answers a
  sheet; the user's "<id> ng" is `reject <id> [--reason style]`, which re-judges the last attempt (`verdict:
  'ng'`, `by: 'user'`) without spending an attempt and sets `rework-<n>` — or `blocked` after the third.

### 10.2 The commands

```bash
avatar:registry next [--limit n] [--json]    # ready assets: id, file, reference path, attempt n, the prompt
avatar:registry collect <id> --chat <url> [--downloads <dir>] [--file <png>]
avatar:registry verify [<id…>] [--keep-tmp]  # every generated asset, or these
avatar:registry verify --picture <png> --as <spec> [--reference <png>] [--base <id>] [--variant <f|m>]
avatar:registry ingest [<id…>]
avatar:registry approve <id…> | --batch
avatar:registry reject <id…> [--reason style]
avatar:registry status                       # counts per status, the blocked ones with their reasons
```

`collect` takes the newest `*.png` in the downloads folder (`%USERPROFILE%\Downloads` unless `--downloads`;
ChatGPT names them `ChatGPT Image Sep 24, 2026, 12_42_45 AM.png`) that is newer than the asset's last attempt
— or at most 30 minutes old for a first attempt — and refuses, saying what it found, when there is none.
The picture replaced in `assets/avatar-src/` is kept as `<name>.prev<k>.png`. `verify --picture` scores one
file without touching the registry — the way to try a rule on a picture by hand.

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
| `check:<Cn>` | the ten criteria (§5) on the layers an ingest into a **copy** of `public/avatar/` wrote; a new base's expression gets its base ingested into the copy first, from the reference. `pipeline` if the ingest itself threw |
| `hollow` | an aura or a frame: mean alpha inside 40 % of the half-width is 0.05 or more — asked right after `background`; an aura or a frame that passes goes on to the `check:<Cn>` / `pipeline` rule and nothing else (2026-09-24) |

A picture on the reference's own canvas is compared where it stands, since the pipeline will cut it there. A
picture on another canvas is scaled and anchored onto the reference's first — head top and centre line, or a
head item's feet and centre line — and the pipeline is given that aligned copy, because an expression or item
is cut with its base's stored transform, measured on the reference's canvas. Since 2026-09-24 (§4.3) a bot runs
the pipeline rule too, on f01's transform: `bot:<n>` is checked on its body and all six faces, `bot:<n>:happy`
on that one face. A bot's picture is handed to the pipeline as it is, not aligned: it is taken to be on
F01's own canvas (§4.3), like a base drawn with `--transform-from`.

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
  chain (`f01_candidate_1.png`, or `@bot_<n>` → that).

### 10.6 A batch

A batch is ten assets:

1. `next --limit 10`; generate and `collect` each (§10.3).
2. `verify`; regenerate each `ng` (at most three attempts in all); `ingest`.
3. `avatar:check`, `avatar:sheet`, then one commit, "art: batch n": `registry.json`, the layers and both
   manifests, and `items.json` if a variant landed.
4. Send the user the sheet. "<id> ng" → `reject <id>`, and the asset goes back into the queue with its reason;
   an answer of "ok", or silence, → `approve --batch`.
