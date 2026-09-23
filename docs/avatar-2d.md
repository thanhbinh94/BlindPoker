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

A `<code>`'s own segments are **two characters or more**. That is what makes the one-letter wear in
`item_outfit_dealer01_m_L40` readable as a wear rather than as part of the code `dealer01_m`.

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
tile, the inventory card, the table seat and the lobby bar all resolve the layer from the base they are
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
# One generated (or hand-drawn) picture in, one layer at @1x and @2x out, plus its manifest entry.
# `base:` and `expr:` ingest a base's own body or one of its six expressions; `item:<slot>:<code>`
# ingests a wardrobe piece, drawn on F01 (D02 §5) and shared with every other base automatically —
# they are built to the same silhouette, and an item layer carries no skin (§4.1.1). Background removal keys off #00FF00 by default (`--white`
# for a white background instead) and, for an item, the layer is found by *diffing against the base's
# own body* rather than by any manual selection (§4.1), and written together with its inventory icon
# (§4.2). `--dry-run` prints what would happen and writes nothing. `--color-tol`, `--min-region` and
# `--max-hole` override the extraction defaults for one awkward picture. `--variant <f|m>` makes the
# cut the per-wear layer of an item that already exists (§3.1) rather than the item itself; the wear
# has to be the wear of `--base`, or the ingest is refused.

pnpm --filter @bp/normal-web avatar:check
# Runs the ten acceptance criteria (D01 §10) over every committed layer and prints a pass/fail table;
# exits 1 on any failure. Pass names to check only those (`avatar:check base_f01_L30`), or `--skip C6`
# for the one criterion (an outfit must cover the base's underwear) that has no coordinates in the
# design and occasionally needs a human override.

pnpm --filter @bp/normal-web avatar:sheet
# Composes every item on every base, across all six expressions, into docs/avatar-2d-sheet.png — the
# eyeballed style gate before a picture is ever committed (design §6, §9). A base whose wear has a
# real variant of an outfit is drawn wearing that variant, not the shared layer (§3.1).
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
A frame's icon is its ring; an aura's is the aura. `ingest` writes the icon with the layer, `placeholder`
refreshes the stand-ins' icons. The manifest lists them under a separate `icons` key —
`{ kind: 'icon', of: '<layer name>', w: 96, h: 96, bytes2x, real | placeholder }` — so `files` stays the
set of frame-sized layers that `check`, the renderer and the server's loader read (the server ignores
`icons`).

The wardrobe tiles and the inventory cards show the icon (`ItemPreview` in
`apps/normal-web/src/screens/wardrobe/ItemTab.tsx`), deriving the name from the item's `asset.file` —
`item_head_tophat01_L80` → `item_head_tophat01_icon` — so the API carries nothing new; the URL is built
with the same `AvatarAssets` base and `srcset` as a `Chibi` layer. Seeing an item *worn* is the big
preview's job: picking an owned tile puts it on the character there, and saving equips it.

## 5. The ten acceptance criteria (`avatar:check`)

| | Checks (D01 §10) |
|---|---|
| C1 | The frame, exactly, at both densities — one pixel out is a fail |
| C2 | Nothing opaque on the outermost row or column |
| C3 | The empty part really is empty: no alpha at all more than 3 px outside the solid shape |
| C4 | No white fringe — the soft rim is the shape's own colour, not white bled in from the key |
| C5 | `head`/`face` items fit inside the 208×208 crop |
| C6 | An outfit covers the base's underwear — the band's non-skin pixels, on the bases whose body is real art (§4.1.1) **and that wear this layer** (§3.1: a variant is measured only against bases of its own wear; a default layer against every real base whose wear has no variant of that item); `--skip C6` exists for it |
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

A real entry may also carry `"variantOf"` and `"wear"`: a per-wear cut of another item's layer (§3.1),
which is always real — `placeholder` never draws one — and which `variantOf` ties back to the item it
belongs to.

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
| `hollow` | an aura or a frame: mean alpha inside 40 % of the half-width is 0.05 or more |

A picture on the reference's own canvas is compared where it stands, since the pipeline will cut it there. A
picture on another canvas is scaled and anchored onto the reference's first — head top and centre line, or a
head item's feet and centre line — and the pipeline is given that aligned copy, because an expression or item
is cut with its base's stored transform, measured on the reference's canvas. A bot has no pipeline target yet:
it skips `check`, with the note `pipeline: skipped (bot)`.

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
- a **bot, an aura or a frame** is left `ok` with "not supported yet": the pipeline has no bot target, and its
  item cut diffs a picture against the base's body, which a square aura or ring picture is not.

### 10.6 A batch

A batch is ten assets:

1. `next --limit 10`; generate and `collect` each (§10.3).
2. `verify`; regenerate each `ng` (at most three attempts in all); `ingest`.
3. `avatar:check`, `avatar:sheet`, then one commit, "art: batch n": `registry.json`, the layers and both
   manifests, and `items.json` if a variant landed.
4. Send the user the sheet. "<id> ng" → `reject <id>`, and the asset goes back into the queue with its reason;
   an answer of "ok", or silence, → `approve --batch`.
