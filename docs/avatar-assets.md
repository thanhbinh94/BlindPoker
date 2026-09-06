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
            └─ apps/normal-web/public/avatar3d/  5 × .glb + manifest.json, committed (1.7 MB)
```

```
pnpm avatar:assets                                  rebuild everything
node apps/normal-web/scripts/avatar-assets.mjs --check    verify what is committed
node apps/normal-web/scripts/avatar-assets.mjs --list "@parts/Male_Ranger_Body.gltf"
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

1. **Lift the named node** out of its source glTF and bake its world transform into the vertices. Skins
   are dropped — glTF stores skinned geometry in *bind space*, so what is left is exactly the T-pose the
   pack ships — and so are animations, cameras, lights, tangents and texture coordinates.
2. **Merge** any sibling parts the item needs (a tunic plus its sleeves plus a hood) into one node.
3. **Scale** the result about its own bounding box, if the map asks — that is how six hairstyles and
   four garments cover thirteen ids (see the approximation table below).
4. **Simplify**, if the map asks, with `meshoptimizer`'s decimator. One mesh needs it: the ranger boots
   are 10,174 vertices each, five times the peasant footwrap they stand beside.
5. **Rename** the node to `<slot>/<itemId>/<body>` and every material to one of six canonical names.
6. **Tint** — the item's fixed colour goes on the material's `baseColorFactor`.

Then per output file: `weld` → `quantize` (KHR_mesh_quantization, positions at 14 bits, normals at 8) →
`dedup` → `prune`, and out as a `.glb`. The script **fails** if a mapped node is missing or a budget is
exceeded; it never writes a file that is over budget.

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

### Why not meshopt

`meshoptimizer` is installed and `--meshopt` turns EXT_meshopt_compression on, but it is **off by
default**. three.js reads KHR_mesh_quantization with no help at all, whereas EXT_meshopt_compression
throws inside `GLTFLoader` unless the caller wired `setMeshoptDecoder` first — a WASM decoder in the
lazy avatar chunk, and a black stage the day someone forgets it. The output sits at under a third of the
budget without it. If you turn it on, wire the decoder in the loader in the same commit.

## What is in the files, and what it costs

| File | Size | Holds |
|---|---:|---|
| `body-male.glb` | 172 KB | `body/male` (body + eyes + eyebrows) |
| `body-female.glb` | 179 KB | `body/female` |
| `hair.glb` | 192 KB | 7 hair items × 2 bodies |
| `outfits.glb` | 1 112 KB | 7 tops, 4 bottoms, 3 shoes × 2 bodies |
| `accessories.glb` | 118 KB | 3 hats, 3 accessories, 5 jewellery × 2 bodies |
| **total** | **1 774 KB** | 66 nodes, of a 6 144 KB budget |

Budgets the script enforces: **6 MB total**, **1.5 MB per file**. The test adds the design's tighter
**400 KB per body file**. `outfits.glb` is the one with the least headroom (28 %), because it carries
every garment; if it ever goes over, the first thing to reach for is a `simplify` ratio on the densest
source mesh, not a bigger budget.

`manifest.json` records, per file, its byte count and SHA-256, and per node, the file it lives in and the
share of that file's geometry it accounts for (accessors shared between nodes are split evenly, so the
node figures sum to the file rather than to a multiple of it — it is an attribution for deciding what to
load, not a measurement).

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

Two more limitations worth knowing:

- **T-pose only.** The avatar stands with its arms out, because that is the bind pose the packs ship and
  this pipeline does not re-pose anything. The design's "standing" and "portrait" poses (§4) are not
  implemented; a portrait framed on head and shoulders hides the arms anyway.
- **No masking under clothes.** The outfit meshes are shells laid over the whole base body rather than
  swapping body parts out, so a tight garment can show a sliver of the body through it at a grazing
  angle. The packs are built to layer this way and it is not visible at portrait size.

## Recipes

### Change a colour

Edit the `tint` in `apps/normal-web/scripts/avatar-map.json` (sRGB hex, converted to linear by the
script), run `pnpm avatar:assets`, commit the changed `.glb` and `manifest.json`.

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
