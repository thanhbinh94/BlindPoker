# Avatar 3D assets

How the Normal edition's 3D character is built, what is in the five files it ships, and what to do to
add an item, change a colour or swap in a different source pack.

Spec: `docs/superpowers/specs/2026-09-05-avatar-3d-design.md` §4 (pipeline), §7 (budget), and the main
spec §15 (avatars), §24 (footprint). The item catalogue that consumes this lives on the server side —
see [`normal-server.md`](normal-server.md).

---

## The short version

```
assets/avatar-src/*.zip                 CC0 Quaternius packs, not committed (400 MB)
  └─ apps/normal-web/scripts/avatar-map.json     the only file that names a source mesh
       └─ apps/normal-web/scripts/avatar-assets.mjs
            └─ apps/normal-web/public/avatar3d/  5 × .glb + manifest.json, committed (1.0 MB)
```

```
pnpm avatar:assets                                  rebuild everything
node apps/normal-web/scripts/avatar-assets.mjs --check    verify what is committed
node apps/normal-web/scripts/avatar-assets.mjs --list "@parts"          a whole directory
node apps/normal-web/scripts/avatar-assets.mjs --list "@parts/Male_Ranger_Body.gltf"
node apps/normal-web/scripts/avatar-assets.mjs --no-meshopt   plain quantized output (see below)
```

The build output **is committed**, which is unusual and deliberate. The source packs are 400 MB that no
CI runner and no fresh clone has, so if `public/avatar3d/` were generated on demand the app could not be
built at all without first downloading them. `apps/normal-web/test/avatar-assets.test.ts` is what keeps
the committed artefact honest: it re-hashes every file against the manifest and re-runs `--check`.

## Where the assets come from

Two packs, both **CC0** (public domain), both by [Quaternius](https://quaternius.com/):

| Pack | What we use from it |
|---|---|
| [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) *[Standard]* | the male and female base body (with separate eye and eyebrow meshes), and five hairstyles |
| [Modular Character Outfits – Fantasy](https://quaternius.itch.io/modular-character-outfits-fantasy) *[Standard]* | the peasant and ranger outfits for both bodies, as separate body / arms / legs / feet / hood / pauldron parts |

`assets/avatar-src/README.md` records the URLs, the download date, the SHA-256 of each archive and the
exact itch.io request sequence used to fetch them. That directory is gitignored except for its README.

**Standard, not Source.** Both packs have a paid tier with far more content (eight bodies, twenty
hairstyles, more outfits). Everything below that reads as an approximation is a consequence of working
inside the free tier: it ships **five hairstyles and two outfits per body**, and this catalogue needs
six hairstyles, seven tops, four bottoms, three pairs of shoes, three hats, three accessories and five
pieces of jewellery.

## What the pipeline does to them

For every entry in `avatar-map.json`:

1. **Lift the named node** out of its source glTF. A skinned node's vertices are already in *bind space*
   and come across as they are, with their `JOINTS_0`/`WEIGHTS_0` and their skeleton (see below); an
   unskinned one (the hairstyles) has its world transform baked into the vertices. Animations, cameras,
   lights, tangents and texture coordinates are dropped.
2. **Merge** any sibling parts the item needs (a tunic plus its sleeves plus a hood) into one node.
3. **Scale** the result about its own bounding box, if the map asks — that is how six hairstyles and
   four garments cover thirteen ids (see the approximation table below).
4. **Simplify**, if the map asks, with `meshoptimizer`'s decimator. One mesh needs it: the ranger boots
   are 10,174 vertices each, five times the peasant footwrap they stand beside.
5. **Rename** the node to `<slot>/<itemId>/<body>` and every material to one of six canonical names.
6. **Tint** — the item's fixed colour goes on the material's `baseColorFactor`.

Then per output file: `weld` → `meshopt` (which is itself `reorder` + `quantize` + the compression
extension) → skin dedupe → `dedup` → `prune`, and out as a `.glb`. The script **fails** if a mapped node
is missing or a budget is exceeded; it never writes a file that is over budget — every file is built into
a scratch directory under `node_modules/.cache/`, the budgets are checked there, and only then is
`public/avatar3d/` replaced. A build that fails, for any reason, leaves the committed assets untouched.

### Skeletons, and the standing pose

The bodies and every outfit part keep their **skin**: joint indices, weights, and a skeleton of the 65
joints both packs name identically (`root`, `pelvis`, `spine_01..03`, `neck_01`, `Head`, `clavicle_*`,
`upperarm_*`, `lowerarm_*`, `hand_*`, fingers, `thigh/calf/foot/ball_*`). That is what lets the renderer
stand the avatar up: the bind pose the packs ship is a T-pose, and design §4 wants a standing one.

- `body-male.glb` and `body-female.glb` carry **one skeleton each**. `outfits.glb` carries **two** — one
  per body, shared by all fourteen garments of that body. A skin per garment would be 28 copies of a
  65 × 64-byte matrix table, 116 KB of a 1.5 MB budget, for no information.
- The rigs are not identical: the base pack puts `upperarm_l` at x = 0.212 (male) / 0.152 (female), the
  outfit pack at 0.192 / 0.152. A garment therefore keeps the outfit pack's skeleton, not the body's. It
  does not matter, because **a pose is a relative rotation**: turn `upperarm_l` by the same angle in both
  skeletons and body and sleeve move together.
- **Hair and the generated accessories are unskinned**, sitting at the bind position of the head. Only the
  arms are ever rotated, and nothing on the head moves when they are. Rotating the head or the hands
  would need those items parented to a bone at load time.
- `manifest.pose.armsDown` names the four joints to rotate and by how much, in radians, **in the joint's
  own bind frame** — in three.js that is `bone.rotateX/Y/Z` or
  `bone.quaternion.multiply(setFromEuler(...))`, *not* `bone.rotation.set(...)`. The values put the hands
  at hip height, a little forward, about 25° off the body; Task 4 should tune them by eye. The angles are
  the same for both skeletons, because both orient their arm joints the same way (a bone's local +Y is
  its own axis, its local +Z is the direction the avatar faces).

### What the manifest publishes

```jsonc
{
  "version": 1, "placeholder": false,
  "compression": "meshopt",              // the loader must wire MeshoptDecoder — see below
  "mapSha256": "…",                      // fingerprint of avatar-map.json; --check fails on drift
  "files":  { "outfits.glb": { "bytes": 645336, "sha256": "…", "skins": 2 } },
  "nodes":  { "top/clothing_aodai/female": {
                "file": "outfits.glb", "bytes": 148651,
                "bounds": { "min": [-0.832, 0.85, -0.142], "max": [0.832, 1.518, 0.135] },
                "tint": "#f2d7bd" } },
  "materials": ["cloth_primary", "…"],
  "anchors": { "male": { "Head": [0, 1.6, -0.017], "neck_01": […], "upperarm_l": […],
                         "upperarm_r": […], "hand_l": […], "hand_r": […], "pelvis": […] } },
  "pose": { "armsDown": { "upperarm_l": [0, 0, -1.134], "…": [] } },
  "budget": { "totalBytes": 6291456, "maxFileBytes": 1572864, "maxBodyBytes": 409600 }
}
```

`bounds` are metres in the same frame as `anchors`, captured **before** quantization (quantize rescales
positions and writes a compensating transform onto the node, so accessor min/max read afterwards are not
metres). They are what an inventory thumbnail frames by — a ring is two centimetres across and invisible
in a whole-body shot. `anchors` are bind positions of the joints a portrait camera and a stage want; the
rig's hips joint is called **`pelvis`**. Both are per body.

### Node keys

```
body/male                    body/female
hair/hair_ponytail/male      top/clothing_aodai/female     jewelry/ring_royal/male
```

`^(body/(male|female)|(hair|top|bottom|shoes|hat|accessory|jewelry)/[a-z0-9_]+/(male|female))$` — the
manifest, the item catalogue (`apps/normal-server/data/items.json`) and the renderer all speak this and
nothing else. After the build, no other file in the repository knows a source mesh exists.

### Materials

Six names, and only six: **`skin`**, **`eyes`**, **`hair`**, **`cloth_primary`**, **`cloth_secondary`**,
**`metal`**. The first three are recoloured at run time from the player's own configuration (skin tone,
eye colour, hair colour) and an item may not tint them — a sleeve mesh that carries part of the bare
forearm keeps that part recolourable. The other three carry the item's own fixed tint.

Several materials in one file may share a name; they differ only by `baseColorFactor`. The renderer
finds what to recolour by name, so that is exactly the behaviour wanted.

### Why there are no textures

The output carries **no textures at all** — flat PBR materials only. Two reasons, and the second is the
real one:

- No resizer is available. `sharp` is not installed (native build, and this repo does not carry native
  toolchains), so `textureCompress` cannot run, and the packs' base-colour maps are 1.3–4 MB each. Four
  of them would blow the entire 6 MB budget.
- More importantly, the body's base-colour map **bakes in one skin tone**, and the player picks from
  eight. A texture would fight the feature this whole plan exists to deliver. A `baseColorFactor` is
  what a runtime tint can actually address.

The face is therefore geometry, not paint: the eyes and eyebrows are separate meshes with their own
materials, merged into the body node, so they recolour with the player's eye and hair colour.

If someone later installs `sharp` and wants texture detail back, the place to add it is `optimise()` in
`avatar-assets.mjs` — `textureCompress({ encoder: sharp, resize: [512, 512], targetFormat: 'webp' })` —
and the budget check will tell you immediately whether it fits.

### Meshopt, and the decoder the loader must wire

The five files use **EXT_meshopt_compression** (`manifest.compression === "meshopt"`), and that is a
change from the first cut of this pipeline, which shipped plain quantized geometry. Keeping the skins put
`JOINTS_0`/`WEIGHTS_0` on every body and garment vertex, and the measured cost of that, both ways:

| | `--no-meshopt` | default (meshopt) | budget |
|---|---:|---:|---|
| `outfits.glb` | 1 496 KB | 630 KB | 1 536 KB per file |
| `body-male.glb` / `body-female.glb` | 247 / 256 KB | 101 / 104 KB | 400 KB per body |
| all five files | 2 309 KB | 1 017 KB | 6 144 KB |

Quantized output does still *fit* — `outfits.glb` at 97 % of its budget, with no room for another garment.
Meshopt is what buys the headroom back.

**The loader must call `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` before reading these files**, or
`GLTFLoader` throws and the stage stays black. `MeshoptDecoder` is a small WASM blob; it belongs in the
lazily-loaded avatar chunk beside the loader itself, and `manifest.compression` is there so the renderer
can assert what it is dealing with rather than assume. `--no-meshopt` rebuilds as plain
KHR_mesh_quantization, which three.js reads unaided — the escape hatch if that decoder ever becomes a
problem, at the price of the table above.

## What is in the files, and what it costs

| File | Size | Holds |
|---|---:|---|
| `body-male.glb` | 101.5 KB | `body/male` (body + eyes + eyebrows), 1 skeleton |
| `body-female.glb` | 104.1 KB | `body/female`, 1 skeleton |
| `hair.glb` | 96.0 KB | 7 hair items × 2 bodies, unskinned (`hair_none` is an empty node) |
| `outfits.glb` | 630.2 KB | 7 tops, 4 bottoms, 3 shoes × 2 bodies, 2 skeletons |
| `accessories.glb` | 84.8 KB | 3 hats, 3 accessories, 5 jewellery × 2 bodies (unskinned) |
| **total** | **1 016.6 KB** | 66 nodes, of a 6 144 KB budget |

Budgets **the script enforces**, in `enforceBudgets` at build time and again in `--check`: **6 MB total**,
**1.5 MB per file**, and the design's tighter **400 KB per body file** (`body-male.glb` and
`body-female.glb` sit at 25 % of it). All three are published in `manifest.budget`, so a footprint test
can read them rather than re-declare them. `outfits.glb` is the one with the least headroom (41 % of the
per-file budget) because it carries every garment; if it ever goes over, the first thing to reach for is a
`simplify` ratio on the densest source mesh, not a bigger budget.

`manifest.json` (22 KB, not counted against the budget) records, per file, its byte count, SHA-256 and
skin count, and per node, the file it lives in, its bounds, its baked tint and the share of that file's
geometry it accounts for. That `bytes` figure is the **uncompressed** attribution — accessor bytes before
meshopt, with accessors shared between nodes split evenly — so per file it sums to about 2.7 × the file on
disk. It is a way to decide what to load, not a measurement of download size.

## Approximations and known limitations

These are the places where the free tier does not have the mesh the catalogue asks for. Recorded here
rather than hidden, and each is a candidate for replacement if the paid tier or a Casual pack is ever
bought (design §9).

| Item | What it actually is |
|---|---|
| `hair_curly` | the parted cut, puffed out 14 % — no curly hair in the free tier |
| `hair_ponytail` | the long cut, narrowed to 72 % — no ponytail in the free tier |
| `hair_mohawk` | the buzzed cut, narrowed to 32 % and raised 45 % into a crest |
| `top_tee`, `clothing_polo` | the peasant tunic, tinted; no modern shirt exists in either pack |
| `clothing_kimono` | the peasant tunic and sleeves in deep red |
| `clothing_aodai` | the peasant tunic lengthened 26 % downward, plus sleeves, in ivory |
| `clothing_hoodie` | the peasant tunic and sleeves plus the ranger hood, in grey |
| `clothing_suit` | the ranger jerkin and sleeves in charcoal, its belts recoloured as lapels |
| `bottom_shorts` | the peasant leggings cut to 52 % of their height from the hip down |
| `bottom_skirt` | the same, cut to 62 % and flared 50 % — no skirt in the free tier |
| `shoes_sneakers`, `shoes_sandals` | the peasant footwrap at 60 % and 34 % height |
| `shoes_boots` | the ranger boots, decimated to a fifth of their triangles |
| every `hat`, `accessory` and `jewelry` item | **generated from primitives**, not from either pack |

The generated items deserve a word. A fantasy hood is not a nón lá and a pauldron is not a wedding ring,
so eleven items — the headband, the conical hat, the crown, glasses, sunglasses, the mask, and the five
pieces of jewellery — are built out of boxes, spheres, cones, cylinders and tori by the script itself.
They are placed **relative to a joint of that body's own bind pose** (`Head`, `neck_01`, `ring_01_l`),
read out of the source rig's inverse bind matrices, which is why the same numbers land correctly on both
the male and the female skeleton. For a conical hat a cone is arguably closer to the real thing than any
mesh in either pack; for the mask and the sunglasses, they are honestly placeholder-grade and should be
first in the queue if a modern-accessory pack is ever added.

Three more limitations worth knowing:

- **The geometry ships in the T-pose; the standing pose is the renderer's to apply.** The `.glb` files
  hold the bind pose the packs ship, because that is what a skin is defined against. What this pipeline
  publishes instead is the recipe: `manifest.pose.armsDown` (see *Skeletons, and the standing pose*
  above). Nothing renders standing until the loader rotates those four joints, and a full-body stage that
  forgets to will show a T-pose. The angles are derived from the rigs' axes, not from looking at a render
  — Task 4 should tune them by eye.
- **Three female tops tint the forearms and hands with the garment colour.**
  `top/clothing_hoodie/female`, `top/clothing_kimono/female` and `top/clothing_aodai/female` carry no
  `skin` primitive, where their male counterparts do. The cause is in the pack, not the map:
  `Male_Peasant_Arms` is a short sleeve (`MI_Peasant`) plus a separate bare-arm mesh (`MI_Regular_Male`),
  while `Female_Peasant_Arms` is a *single* `MI_Peasant` mesh that runs out to |x| = 0.832 — past `hand_l`
  at x = 0.641. Mapped through `materials.bySourceName`, that whole mesh becomes `cloth_primary`, so a
  female avatar in the kimono has deep-red hands and in the áo dài ivory ones, over the body's own
  skin-tinted hands. `Female_Ranger_Arms` does carry `MI_Regular_Female`, so `clothing_suit` and
  `jacket_champion` are fine, and `top_tee` merges no arms at all. Fixing it means either dropping the
  arms merge from those three (bare forearms, as `top_tee` has) or splitting the mesh by x and mapping
  the outboard half to `skin`; both are map-level changes, and both are worth doing the first time a
  full-body view of a female avatar in those garments is looked at.
- **No masking under clothes.** The outfit meshes are shells laid over the whole base body rather than
  swapping body parts out, so a tight garment can show a sliver of the body through it at a grazing
  angle. The packs are built to layer this way and it is not visible at portrait size.

## Recipes

### Change a colour

Edit the `tint` in `apps/normal-web/scripts/avatar-map.json` (sRGB hex, converted to linear by the
script), run `pnpm avatar:assets`, commit the changed `.glb` and `manifest.json`.

**The map owns the colour.** What the build baked is republished as `manifest.nodes[key].tint` — the first
`cloth_primary` / `metal` / `cloth_secondary` material the node carries — and any item that also names a
`tint` in `apps/normal-server/data/items.json` (today `clothing_aodai` and `accessory_conical_hat`) must
carry the same value, or `test/avatar-assets.test.ts` fails. Two sources of truth for one colour means an
item rendered in a colour nobody chose, so change the map first and copy the value across. Bodies and hair
have no tint at all: `skin`, `eyes` and `hair` are recoloured at run time from the player's configuration.
`--check` also refuses to pass if the map has moved on without a rebuild — `manifest.mapSha256` is a
fingerprint of `avatar-map.json`'s meaning (keys sorted, whitespace and `$comment`s ignored).

### Add an item

1. Find the source mesh: `node apps/normal-web/scripts/avatar-assets.mjs --list "@parts"` prints every
   node, material and joint of every glTF in that directory. (`@base`, `@hair` and `@parts` are the
   directory aliases defined at the top of the map.)
2. Add an entry to `items` in `avatar-map.json` with an `id`, a `slot`, and a `variants.male` /
   `variants.female`. A variant is either `{ file, node, merge?, tint?, scale?, scaleAnchor?, simplify? }`
   for a mesh from a pack, `{ primitive: { anchor, parts } }` for generated geometry, or `{ empty: true }`
   for a node with no geometry (that is how `hair_none` works).
3. `pnpm avatar:assets`. The script fails loudly if the node name is wrong or a budget is exceeded.
4. Add the matching entry to `apps/normal-server/data/items.json`, pointing `variants.<body>.node` at the
   new key and `.file` at the file the manifest says it landed in. `apps/normal-server/test/catalog-manifest.test.ts`
   checks the two agree.
5. Commit the map, both `.glb` files that changed, `manifest.json` and the catalogue together.

### Swap in a different or newer pack

1. Put the new archive in `assets/avatar-src/` and update its row in `assets/avatar-src/README.md` with
   the URL, the date and the new SHA-256. Update `sources[].sha256` in `avatar-map.json` too — the build
   refuses to run against an archive whose hash it does not recognise.
2. Delete the stale `assets/avatar-src/extracted/<pack>/`; the build unpacks what is missing (with
   `unzip`, falling back to Windows' `tar`).
3. `--list` the new pack, fix the `dirs` aliases and every `file`/`node` the names of which moved.
4. `pnpm avatar:assets`, then `pnpm --filter @bp/normal-web test`.

### Fetch the packs again from scratch

`assets/avatar-src/README.md` has the itch.io request sequence. Cloudflare in front of itch.io returns
an intermittent `403` interstitial to command-line clients; retrying a few seconds later works. Do not
try to defeat it — if retries stop working, download the two archives in a browser instead.
