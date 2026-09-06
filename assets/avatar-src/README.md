# Avatar 3D source packs

The 3D avatar of the Normal edition (Plan 8, `docs/superpowers/specs/2026-09-05-avatar-3d-design.md`)
is built from two **CC0** modular character packs by Quaternius. This directory holds the archives and
their unpacked contents; **nothing in it is committed** (see `.gitignore`). What ships is what
`apps/normal-web/scripts/avatar-assets.mjs` emits into `apps/normal-web/public/avatar3d/`.

## What to download

Both packs are the free *Standard* tier on itch.io ("name your own price" — the free tier needs no
account and no payment). Put the archives here with the file names below; the build script unpacks
them into `extracted/` itself.

| Archive | Pack | Downloaded | SHA-256 |
|---|---|---|---|
| `Universal Base Characters[Standard].zip` | [Universal Base Characters](https://quaternius.itch.io/universal-base-characters) — 2 base bodies, 5 hairstyles, eyebrows, beard | 2026-09-06 | `fdbf1804c90dfc1ea03e992bff7da2dfd1a79318e13270a660180f9308455f40` |
| `Modular Character Outfits - Fantasy[Standard].zip` | [Modular Character Outfits – Fantasy](https://quaternius.com/packs/modularcharacteroutfitsfantasy.html) → [itch.io](https://quaternius.itch.io/modular-character-outfits-fantasy) — Peasant and Ranger outfits, male and female, as separate body/arms/legs/feet/hood/pauldron parts | 2026-09-06 | `c3468b18871cc8c8f05ab14df7712baf22cb9f389cbd870babf130e595187f70` |

Sizes as downloaded: 128,968,391 and 294,347,394 bytes.

## Licence

Both packs are released by Quaternius under
[CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) (public domain dedication) —
usable in personal, educational and commercial projects, no attribution required. We credit
Quaternius in `docs/avatar-assets.md` anyway.

## Fetching them again

The itch.io free-download flow, which is what was used on 2026-09-06:

```
POST https://quaternius.itch.io/<slug>/download_url        (form field csrf_token, may be empty)
  -> { "url": "https://quaternius.itch.io/<slug>/download/<signed key>" }
GET  <that url>                                            -> HTML listing the uploads
POST https://quaternius.itch.io/<slug>/file/<upload id>?source=game_download   (form field csrf_token)
  -> { "url": "<expiring CDN url>" }
GET  <that url>                                            -> the zip
```

The `csrf_token` comes from the `<input name="csrf_token">` on the download page. Slugs are
`universal-base-characters` and `modular-character-outfits-fantasy`. Cloudflare in front of itch.io
returns an intermittent `403` interstitial to command-line clients; retrying the same request a few
seconds later succeeds, so the fetch loop just retries. **Do not** try to defeat the interstitial —
if retries stop working, download the two archives in a browser and drop them here by hand.

## Then

```
pnpm avatar:assets          # unpack (if needed), normalise, write public/avatar3d/ + manifest.json
```

See `docs/avatar-assets.md` for what the script does with them and how to add a new item.
