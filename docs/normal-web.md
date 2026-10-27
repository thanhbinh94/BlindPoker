# `@bp/normal-web`

## Purpose

The Normal edition's browser client: a Vite/React bundle that talks to
[`@bp/normal-server`](normal-server.md) over REST and one WebSocket, and draws the table with
[`@bp/ui-kit`](ui-kit.md). It is served by the server itself — the Docker image builds it and points
`PUBLIC_DIR` at it — so the app, the API and the socket share one origin and one cookie.

What it owns, and nothing else owns: the account screens (sign-in, profile, wardrobe,
achievements, daily reward, settings), the REST client, the session gate, and the mapping from the
server's avatar config to the kit's chibi — the wardrobe screen and the profile figure both go through
it. The lobby and the table come from the kit unchanged.

Its counterpart is `apps/lite/web`, which solves the same problem for a LAN executable and a bearer
token. Neither may import the other, and neither may import a server package; ESLint enforces both.

To *deploy* this, read [`deployment-normal.md`](deployment-normal.md) (Vietnamese, like every
operator guide here). This page is for changing the code, and is English, like every developer doc.

Spec: §15 avatars, §19.2 API, §24 footprint, §27.2 screens, §29 end-to-end; and
`docs/superpowers/specs/2026-09-14-avatar-chibi-ai-design.md` §5–§8 for the avatar. The pipeline, the
layer files and how to add an item are [`avatar-2d.md`](avatar-2d.md).

---

## Module map

```
apps/normal-web/
  index.html            the document: dark by default, the display face, #root
  vite.config.ts        base '/', dev proxy to :8080 for /api and /ws
  src/
    main.tsx            theme → i18n → <App api={createApi()} />
    App.tsx             the session gate in front of the hash routes; lazy account screens
    api.ts              the REST client: one `call`, the DTOs, ApiError
    guarded-api.ts      guardApi — one wrapper, so any screen's UNAUTHENTICATED ends the session once
    catalog-i18n.ts     itemName / achievementName / achievementDesc — never print a raw i18n key
    session-gate.ts     useSessionGate — boot probe, 401 handling, the reconnect probe
    session.ts          the last email typed, remembered for the sign-in card only
    prefs.ts            theme and language, per device
    notifications.ts    the kit's notification list, with achievement ids translated
    avatar/
      useAvatars.ts     the shared avatar cache (module scope, 60 s, one request per id)
      chibi.ts          chibiFromApi — an AvatarConfigDto (v4) + the catalogue + the bodies → the kit's ChibiConfig
    screens/
      Shell.tsx         the rail and the page under it; publishes --bp-stage for the table
      AuthScreen.tsx    sign in and register, one card, two modes
      {Profile,Achievements,Daily,Settings}Screen.tsx   four of the lazy account screens
      LedgerPanel.tsx   the points ledger list, shared by the profile and the GM's player page
      gm/               the Quản trị screen (GM only, a lazy chunk): GmScreen · OverviewTab · PlayersTab · PlayerDetail
                        · RoomsTab · ActionsTab · ReasonDialog · CopyId · tabProps.ts · gm.module.css
      wardrobe/
        WardrobeScreen.tsx   the fifth — preview + expression stepper + Nữ | Nam + ten tabs + saved outfits
        HairStyleTab.tsx     Kiểu tóc: the gender's hairstyles, each card a head portrait of the draft
        gender.ts            swapGender — the Nữ | Nam switch: the gender and a hairstyle of that gender
        ItemTab.tsx          one slot's tiles: owned and clickable, or locked with a reason
        OutfitBar.tsx        five saved snapshots — apply / save here / rename / delete
      TableChrome.tsx   makeChibiFor / makeCaptionFor — the two slots RoomScreen takes from this app
      catalog.ts        hintFor — how a locked card is won (achievements, the check-in's named gifts, the draw)
      format.ts         dates, moments, signed amounts and the server's month keys
      useAsync.ts       load once, expose { data, loading, reload, set } — every account screen's spine
    locales/{vi,en}/normal.json
  public/avatar/             the chibi's PNG layers + avatar-manifest.json (committed; see avatar-2d.md)
  scripts/avatar-pipeline.mjs  the asset pipeline: placeholder | ingest | masks | colours | check | sheet | tint-sheet | hides
  test/footprint.test.ts   the download budget, measured on `dist/` and on `public/avatar/`
  e2e/                     Playwright against the real server (support.ts is shared, not a test)
```

---

## The API client

`src/api.ts` mirrors `apps/normal-server/src/http/*.ts` exactly — same paths, same headers, same
failure envelope (§19.2) — and knows nothing else: no retries, no caching, no state.

The one difference from Lite's client is the whole point of this edition: **there is no token**. The
session is an `HttpOnly` cookie the server set, which this code can neither read nor forge. Every
request carries `credentials: 'same-origin'`, the browser attaches the cookie, and every mutating
request carries `X-Requested-With: bind-poker` — the CSRF guard's proof that a `fetch`, not a form
post from another origin, made the call.

A refusal arrives as an `ApiError` with the server's own `code`, and screens translate the codes they
have words for and fall back to the kit's generic failure for the rest. `NETWORK` is the code the
client invents when the request never reached the server at all.

## The session gate

`useSessionGate` (`src/session-gate.ts`) is the only piece here with a rule of its own, and it is
shaped by what the session *is*. With no token to read, the only way to know whether this browser is
signed in is to ask: the app boots into `checking`, calls `GET /api/auth/me` once, and then shows
either the lobby or the sign-in card. Rendering the card while that probe is in flight would flash a
login form at a signed-in player on every reload, which is why `checking` is a state and not a
spinner.

Two consequences worth knowing before changing anything here:

- **The socket opens only when the gate says signed in.** `useGameClient` is created with
  `autoConnect: false` and one effect connects it, because a socket opened without a session is
  refused at the upgrade and would back off forever.
- **A dead session looks like a bad network.** The server authenticates the upgrade from the cookie,
  so an expired session is an HTTP 401 on the handshake — which the browser reports as an ordinary
  failed connection. After `RECONNECT_PROBE_MS` (10 s) of uninterrupted reconnecting the gate asks
  `GET /api/auth/me`: a 401 signs the player out with `session.expired`; anything else means the
  network is merely bad.
- **A live socket proves nothing.** Identity is bound once, at the upgrade, so a session that dies
  under an established socket is invisible to it: only a REST call notices. `guardApi` (`src/guarded-api.ts`)
  wraps the api handed to every signed-in screen, and an `ApiError` whose **code** is `UNAUTHENTICATED`
  calls `gate.onUnauthenticated()` once — debounced, so three parallel 401s are one sign-out — and
  rethrows. It guards on the code and not the status because `POST /api/auth/login` answers
  `401 BAD_CREDENTIALS` for a wrong password, which is a form error; the sign-in card and the gate's
  own probes therefore keep the **raw** api.

Every session ending goes through one path (`endSession` in `App.tsx`): the socket is disconnected,
the kit's client state is `reset()` (it outlives the session, so otherwise the next player on a shared
machine is greeted with the previous one's name and points), and `resetAvatarCache()` drops the faces.
While a session is live the app prefers the **gate's** identity over the socket's for the rail, the
lobby bar and the avatar, and takes the live balance from the socket only while the two agree on the
player id.

---

## Avatars

An avatar is a **chibi**, drawn as a stack of same-origin PNG `<img>`s — since Plan 19 (avatar v4, spec
`2026-10-03-avatar-v4-design.md`) a body per **gender** (`f`/`m`, chosen rather than owned), a two-layer hairstyle
and whatever is equipped in each slot, recoloured by up to three colours, on a 384×448 frame (design §3, §5).
Nothing is rendered on the server and nothing is rendered by this app either: every picture is the
browser laying out `<img>` tags, and `@bp/ui-kit`'s `Chibi` (`packages/ui-kit/src/avatar2d/`) is the one
component that does it. This app's own job is smaller than the 3D system's was — turn the server's
config into the shape `Chibi` draws, and wire a save back to every place a face is shown.

```
AvatarConfigDto (v4)      gender + hairStyle + outfit + head?/face?/aura?/frame?
                          + hairColor?/eyeColor?/skinColor? + title?/badge?
   │
   ├─ chibiFromApi()  ──►   ChibiConfig                the kit's own shape: a BodyRef, a HairRef, WearRefs
   │                          │                        and the three colours as hex
   │                          │
   │                          └─ hashChibi()  ──►  '1aa20c85'   the configuration's identity
   │
   └─ <Chibi subject frame expression>  ──►  a stack of <img>   seat plates, the lobby bar, wardrobe
                                                                  tiles, the profile figure
```

**`chibiFromApi(config, items, bodies)`** (`src/avatar/chibi.ts`) is the whole bridge. `bodies` is
`/api/catalog/avatar`'s `bodies`, keyed by `gender`; `App`, the profile and the table each build that map once
(`makeChibiFor(avatars, items, bodies)` for the seats). The body is `bodies.get(config.gender)`, its `tint` (where
skin and eyes may be recoloured) copied straight across; the hairstyle is the `hairStyle` row's two layers —
`{ id, back: asset.back, front: asset.file, tint: asset.hairTint }`; every other slot is resolved against
`items.json`, a gendered item drawing its cut for that gender (`layerFileFor(asset, gender)` =
`asset.variants?.[gender] ?? asset.file`); and `hairColor`, `eyeColor` and `skinColor` resolve to the hex their
item paints with. It is written to never throw at an id it does not recognise — a browser holding yesterday's
bundle can meet ids the server added since. An unknown gender answers `null` for the whole chibi (there is no body
to draw it on); an unknown hairstyle wears that gender's first hairstyle in catalogue order, and only a catalogue
with none of that gender answers `null`; an unknown optional item is simply omitted, the same way an unknown badge
drops from a seat caption rather than printing a raw key; an unknown `outfit` falls back to the catalogue's
default outfit, and only if that is *also* missing does the whole function give up. Where nothing can be drawn,
every caller falls back to the kit's `defaultChibi(seed)` (or the seat's initial).

The kit's own defaults — `DEFAULT_HAIR`, `hairRefOf`'s naming rule and `DEFAULT_OUTFIT_FILE`, which `defaultChibi`
draws with and which Lite draws every player with — are held to `items.json` by `src/avatar/kit-defaults.test.ts`
(Plan 19 R14), since the kit has no catalogue to look them up in.

**`data-chibi-hash`** (`hashChibi`, in the kit) is the configuration's identity — two different
configurations must not share one, and the same configuration must arrive at the same one wherever it
is drawn. `test/footprint.test.ts` and `e2e/avatar2d.spec.ts` both key off it, and so does the wardrobe's
own outfit bar, which is a snapshot of a whole `AvatarConfigDto` rather than of any one item.

**Bots never go through this path.** A bot has no account and no `GET /api/players/<id>/avatar` to
answer for it (`TableChrome.makeChibiFor` never asks); `PokerTable` draws `botChibi(player.playerId)`
instead — the kit's own robot art, unaffected by any wardrobe.

**Where the layer files come from** is [`avatar-2d.md`](avatar-2d.md): `scripts/avatar-pipeline.mjs`
turns a green-screened AI-generated picture into `@1x`/`@2x` PNGs under `public/avatar/`, validates the
result against thirteen acceptance criteria, and writes `avatar-manifest.json`. The shipped set is real art
(a body per gender, six faces each, eight two-layer hairstyles, the outfits, hats, glasses, auras, frames and eight
bots) apart from one stand-in the catalogue no longer offers; `avatar:placeholder` writes synthetic layers for
anything not yet drawn, so a new item can be built into every screen and every test before its picture exists
(`docs/known-limitations.md`).

### The wardrobe

`/avatar` — `wardrobe/WardrobeScreen.tsx`. A `Chibi` preview on the left, sized 192 px, with an expression stepper
under it to try each of the six faces — `‹  Vui  ›`, a previous and a next button around the current face's name,
wrapping at both ends, ArrowLeft/ArrowRight too, each button described by the name (review 2026-09-29, No10;
`wardrobe/StagePanel.tsx`) — then the **Đang dùng** list, whose first five rows are the look — **Giới tính**
(Nữ/Nam), **Kiểu tóc**, **Màu da**, **Màu tóc**, **Màu mắt** — then the items, and the five **Bộ đồ đã lưu**
slots. Giới tính, Kiểu tóc and Quần áo are never removable; the phone's "Đang dùng (n)" counts those three plus
every optional slot filled. On the right, ten tabs in three groups: **Ngoại hình** (Kiểu tóc, Màu tóc, Màu da, Màu
mắt — the screen opens on Kiểu tóc), **Trang phục** (Mũ, Phụ kiện mặt, Quần áo) and **Trang trí** (Hào quang,
Khung, Danh hiệu & huy hiệu — title and badge together, the two slots with no picture).

**The look (avatar v4, Plan 19; spec `2026-10-03-avatar-v4-design.md` §6.1–6.3).** The body is the gender, chosen
rather than owned: the **Nữ | Nam** switch (the kit's `Segmented`, a `group` named "Giới tính", passed to
`CategoryNav` as `lookHeader`) heads the Ngoại hình group on every one of its tabs and is not a tab itself — a row
no taller than the sub-tabs' on a desktop, a 44 px button each on a phone. Switching (`wardrobe/gender.ts`
`swapGender`) changes the draft only: the hairstyle goes to its `counterpart` when owned, else to the first owned
hairstyle of that gender; the outfit's cut follows the gender on its own (`layerFileFor`); colours, hat, glasses,
aura, frame, title and badge stay. With no hairstyle of the other gender owned it changes nothing, so a draft never
pairs a gender with the other gender's hairstyle. **Kiểu tóc** (`wardrobe/HairStyleTab.tsx`) lists that gender's
hairstyles only (`slotCards`/`counts` take the gender), each card a head portrait (`ItemCard`'s `thumb`, 96 px, 72 on
a phone) of the draft with that hairstyle — its gender, hair colour, skin and eyes, and no hat, glasses, aura or
frame, which would make every card look the same; the hairstyle is required like the outfit, so a press on the worn
card keeps it on. **Màu da** is a `ColourTab` like the hair and eye colours, its "Tự nhiên" swatch filled with the
body's cream (`naturalColour`). Plan 19 removed the old tab that chose one of six fixed figures, with the figures.

There is no separate inventory screen (review 2026-09-29, No5): what the account owns is this screen's default
list, and Profile links here and to the achievements only. `#/inventory` — an old bookmark or link — still opens
the wardrobe: `App` reads it as `/avatar` and swaps the address bar for `#/avatar` in place (`location.replace`: no
history entry, so "Back" does not bounce off it, and a `hashchange`, so the router reads `/avatar` from then on —
the kit's router has no replace of its own). The inventory's acquired date and
source ("Nhận ngày …", "Khởi đầu", "Miễn phí") and its "Đang sở hữu N món" total went with it, on purpose; the
wardrobe's "n/m đã có" counts remain.

- **`ItemTab`** lists what the player owns — a colour-variant family shows when any member is owned
  (`slotCards`, `categories.ts`; review 2026-09-29 No11a) — and, with **Hiện cả món chưa có** ticked, the whole
  catalogue for its slot, locking anything the player does not own (`aria-disabled`, with a hint — `hintFor` in
  `screens/catalog.ts`: the achievement that grants it; else the check-in gift that names it, "Quà điểm danh ngày
  28" or, for one month's, "Quà điểm danh ngày 28 tháng 11/2026", read from `GET /api/catalog/items`'s
  `dailyGifts`; else a daily-draw rarity; else "Chưa có cách nhận món này"). A tile's own picture (`ItemPreview`)
  is the item's pipeline icon (`docs/avatar-2d.md` §4.2), and a colour variant's is that icon tinted to the variant's colour
  through `useTintedLayer` (review 2026-09-29 No8a). A family's card is one member — the one worn; else the
  original, if owned; else the first owned variant; else the original — whichever way the box is ticked: ticking it
  only adds cards and dots (final fix wave, B2). The card is that member's picture, name, "Đang dùng" and click, and
  its dot row lists the whole family, the original first as a checkered dot; after a coloured outfit, that dot is the
  way back, the outfit slot being required. On a phone or under a finger every dot keeps its 16 px look inside a
  44 px touch target, and the row wraps to keep those targets apart (B1). A dot the player does not own is named
  `<name>, Chưa có: <hint>` (its `aria-label` and `title`). With the box ticked, a card that shows an owned member
  while the family's original is locked carries one more line, `🔒 <original's name>: <hint>` (`familyHint`, worded by
  the `wardrobe.familyHint` template), between the picture and the dots and outside the pick button, so a colour variant
  no longer hides how to unlock the original and the card's own name does not change (Plan 20). A family the player
  owns nothing of shows its locked original, whose own lock line already says how, so it gets no second line. The "Đang
  dùng" pill clears the skin swatch at every width. A tab
  with nothing to list keeps its
  `tabpanel`, focusable then, with one line in it.
- **`OutfitBar`** is a bookmark of a *whole* `AvatarConfigDto`, not of one item — "Mặc bộ này" replaces the
  draft outright, "Lưu vào đây" snapshots whatever is currently equipped into that slot under a name up
  to 24 characters. Both round-trip the server (`PUT /api/me/outfits/:slot`, `POST
  /api/me/outfits/:slot/apply`) rather than only touching local state, so a saved outfit survives a
  reload.

Picking a tile only ever changes the in-memory draft (`withSlot`); nothing reaches the
server until **Lưu tủ đồ** is pressed. Saving is `PUT /api/me/avatar` with the full v4 payload (an empty
optional slot is *absent* from the object, not `''`), and on success `invalidate(myId)` so the lobby bar
and every seat plate pick the new face up without a reload.

#### Wardrobe loading (Plan 27, E2)

The five reads still go out together, but in two groups: the stage and the cards draw as soon as the inventory, the
item catalogue and the avatar catalogue have answered; the saved outfits (drawn only once they arrive, never as five
empty slots in the meantime) and the achievements a locked card's hint names follow. If any of the five fails, the
screen shows the same "Không tải được phòng thay đồ", and "Thử lại" asks again for the group that failed. Every picture
below the stage waits until it is within 200 px of the screen: the saved-outfit heads and the Kiểu tóc portraits are
`<Chibi lazy>`, and a card's icon (`ItemPreview`, in the wardrobe and the Cửa hàng alike) draws an empty box of the
icon's size until then. A card icon's tint render queues behind every figure's, the first card of its grid first
(priority `-200 - index`). The stage stays eager.

Measured by the ops pack (`e2e/ops/08-shop.spec.ts`; Chromium, fresh HTTP cache):

- **P-04** (375×812, DPR 2): opening the wardrobe asks for 18 `/avatar/` pictures (the small portraits' @1x files), for
  the 5 figures and cards near the screen. It was 16 before BP-30: the stage's figure is live and loads its spare
  `closed` and `happy` faces once its own face is in (measured 2026-10-23). On Mũ with "Hiện cả món chưa có" ticked, 3 requests for the 4 hats near the screen out of 8, where loading
  every card (`IntersectionObserver` removed, the old behaviour) asks for 7. Back on Kiểu tóc it asks for none.
- **P-05** ("fast 3G": 1.6 Mbps down, 750 kbps up, 150 ms RTT, from a tap with the app already open): the stage is
  drawn and the first row of cards is on screen in about 850 ms at both 1366×768 and 375×812. The first row's pictures
  arrive in about 1.7 s at both sizes. On the phone that rests on Ruling 16: a `head` chibi whose `size × DPR` is at most
  the crop's 208 px loads its layers @1x, tinted and plain, whatever the screen's ratio. Before it, a 72 px Kiểu tóc
  portrait at DPR 2 loaded its hair layers @2x (about 440 KB for the row) and the pictures took about 3.2 s.
- In the desktop preview column (`overflow: auto`), the five saved-outfit heads draw on open at 1366×768 and 1920×940.
  Nothing appears late when the column scrolls, even though `rootMargin` does not apply inside a scrolling ancestor.

### Adding an item, end to end

1. **The picture.** Generate (or draw) it on the body of its gender per
   `docs/avatar/02-mo-ta-nhan-vat-khoa-va-yeu-cau-sinh-anh.md` — an outfit on the bald body, a hat or glasses on the
   body wearing a hairstyle — then `pnpm --filter @bp/normal-web avatar:ingest <file> --as item:<slot>:<id> --base f|m`
   (plus `--hair <code>` for a hat or glasses) — see [`avatar-2d.md`](avatar-2d.md) for the exact command and the
   thirteen checks `avatar:check` runs against it.
2. **The catalogue.** Add the row to `apps/normal-server/data/items.json` with its `slot`, `rarity`,
   `isDefault` and `asset.{layer,file}` naming the file the pipeline just wrote — see
   [`normal-server.md`](normal-server.md). The server validates the catalogue against the committed
   manifest at boot, so a row naming a file that was never ingested fails fast rather than 404ing per
   request.
3. **The name, in both languages.** `items.<id>` in `src/locales/vi/normal.json` *and*
   `src/locales/en/normal.json`. `locales.test.ts` fails if either is missing, if one language has a key
   the other does not, or if a name exists for an id the server does not serve. Renaming an id that ships
   already needs a row in `apps/normal-server/data/item-aliases.json` too, so an account that equipped the
   old id keeps wearing something rather than losing the slot.
4. **How it is won.** A grant in `data/achievements.json`; a `fixed` gift in `apps/normal-server/data/daily-gifts.json`
   (any slot, one month or every month — `normal-server.md`, "Changing the daily gifts"); the daily draw (a common or a
   rare in `head`/`face`/`aura`/`frame`/`hairColor`/`eyeColor`); or nothing — an item nobody owns is an item nobody
   sees, because the wardrobe lists the inventory and not the catalogue.
5. **The contact sheets.** `pnpm --filter @bp/normal-web avatar:sheet` re-composites the whole set into
   `docs/avatar-2d-sheet.png` — the eyeballed gate before a picture is committed — through the renderer's own
   layer order and hide rules. Since avatar v4 (Plan 19) it is a grid of each gender's hairstyles × three skin tones
   (porcelain, natural, deep) × two outfits (`casual01` and `dealer01`, in the gender's cut where there is one),
   then every outfit on both genders, every aura and frame, the six expressions per gender, the eight bots and the
   portrait at 192, 40 and 32 px. A second picture, `docs/avatar-2d-fit-sheet.png`, tries every hat and every pair
   of glasses on each of the eight hairstyles, cut to the portrait: the fit check. Look at both beside every
   other piece before committing. `--hairs` and `--outfits` narrow the grid to what a style gate shows
   (`docs/avatar-2d.md` §4).
6. **Commit the new PNGs, `avatar-manifest.json` and the catalogue together.** The layers are a committed
   build artefact; nothing under `public/avatar/` may be generated at build time, because no CI runner has
   the AI tool or the `assets/avatar-src/` originals (gitignored).

There is no drawing step and no per-item code in this app: `Chibi` is generic over whatever layers
`chibiFromApi` hands it.

### The avatar cache

`useAvatars(api, ids)` is a module-scope cache shared by every screen: one request per player id per
minute, in-flight requests collapsed, failures cached too (a failing endpoint must not become a
request storm from a screen that redraws on every card). Bots are filtered out by the caller — they
have no account, so their id would be a guaranteed 404 apiece.

`invalidate(playerId)` drops an entry and refetches; the wardrobe calls it after a save. There are
**two** caches in the way, and it clears both: this module's Map, and the browser's own — the route
answers `Cache-Control: private, max-age=60`, so the refetch is issued as
`api.playerAvatar(id, { fresh: true })`, which sets `cache: 'reload'`: past the browser's cache, and the
fresh answer written back over the stale one, so a reload inside the minute reads it too (`no-store` left the
stale entry in place). Only the invalidated id is marked; every other seat keeps the 60 s the header is there
for. Besides the wardrobe's save and the welcome gift, the app invalidates the player's own entry when a
`RANK_UP` arrives (Plan 27), so the lobby bar and the next seat show the new rank at once.

`resetAvatarCache()` empties it. One caller in the app — a session ending — because the cache is
module scope and keyed by player id, so the account that just signed out would otherwise sit there
and be re-read as a 401 once per TTL.

---

## The sign-in screen

`screens/AuthScreen.tsx` (routes `#/login` and `#/register`, styles in `screens/normal.module.css`) seats the card beside
a picture of a table of friends (spec 2026-10-20, Part C, layout A). The picture is decoration, not content.

- **From 1024 px up** (the rail's own breakpoint) the stage is a two-column grid, `minmax(0, 62fr) minmax(26rem, 38fr)`.
  The left column is `.authHero`, full height: the picture, a gradient shade that fades its right edge and foot into the
  night ground, and at the foot the hero's `h1.heroTitle` ("Blind Luck Poker") and `p.heroLead` (`auth.heroLead`). The
  card is centred in the right column with the language switch under it.
- **Below 1024 px** it is one column: `.authHero` is a 300 px band at the top and the card overlaps its foot by 50 px
  (`margin-top: -50px`). The hero's words are `display: none` there. What the band shows depends on the width:
  - **At most 767 px (a phone):** the picture is zoomed to 160 % anchored at 34 % 28 % (the approved mockup's crop, spec C1),
    so the band frames the three middle faces: the áo dài peeking at her card, the tuxedo, the friend between them.
  - **768 to 1023 px (a tablet):** `object-fit: cover` at `34% 28%` shows the picture's whole width, cropped top and bottom.
    The phone's zoom is off there because at 768 × 1024 it cut the crowned girl's face off the top (Ruling C2-4).
  - **A landscape phone** (`(orientation: landscape) and (max-height: 500px) and (max-width: 1023px)`; a short window
    1024 px or wider keeps the two columns): the band thins to a 72 px strip and the
    card overlaps it by 24 px. The card's mark and lead are hidden and its title is smaller, so the whole form, button
    included, fits at 915 × 412 and 844 × 390; the language switch sits below the fold there (Ruling C2-5).
- **One heading (spec R10).** Exactly one `h1` is visible at a time, by CSS only: the hero's from 1024 px up, where the
  card's own title and lead are hidden, and the card's below it. Both are in the DOM, so a unit test sees two and pins which
  class is which.
- **The picture** is `<img srcSet>` with two WebP sizes, `/login/hero-768.webp 768w` and `/login/hero-1536.webp 1536w`,
  `alt=""`, `decoding="async"`. No `fetchPriority`: React-DOM 18.3 warned about the prop. No animation, so there is no
  reduced-motion path to keep. The files are committed in `apps/normal-web/public/login/` (178 KB and 66 KB; budgets
  250 KB and 90 KB) and built from the AI-generated source `assets/login-hero-src/2026-10-20-v2.png` (gitignored) by
  `pnpm --filter @bp/normal-web login:hero` (`scripts/login-hero.mjs`, `sharp`, WebP quality 82, exits 1 over budget).
  The prompt, the rubric and the log of generations are in `docs/login-hero-art.md`; the licence caveat is in
  `docs/known-limitations.md`, with the avatar art's.
- **Light theme.** The hero section carries `data-surface="night"`, so the picture, its shade and its text keep the night
  palette in either theme, and `--bg` there is the night ground under the picture while it loads. The lead is light ink
  on a dark picture whichever theme the page wears.
- **Strings.** `auth.heroLead` in `src/locales/{vi,en}/normal.json`; the title is the existing `auth.title`.

Tests that pin it:

- `src/screens/AuthScreen.test.tsx` → `renders the hero picture with both sources and the hero lead`: the two `srcset`
  entries, `alt=""`, the lead, and the two `h1`s with their classes (`heroTitle`, then `authTitle`).
- `e2e/normal.spec.ts`, in `tourStart` (so in `một tài khoản chơi trọn một ván Blind với bot` and the other tours): the
  hero image has decoded (`naturalWidth > 0`, which a CSP refusal or a 404 would fail); at 320 × 812 the page does not
  scroll sideways under the band; at 1024 × 700 in the light theme the lead holds 4.5:1 against the lightest pixel under
  it (measured by a screenshot of the lead's box with the text hidden, decoded with `sharp`; 5.36 when written); and
  `expectNoTextOverlapAt` runs on both tabs, at 1920 × 940 and 1366 × 768 in the desktop tour
  (`OVERLAP_SCREENS`) and at the tour's own viewport in the others (375 × 812 in the `@mobile` tour, project `mobile`).

---

## The Daily screen

`screens/DailyScreen.tsx` draws `GET /api/rewards/daily`: today's card and its claim, the receipt, and the month's 31
tiers. The calendar is the **current month's**: the server sends `month` (`YYYY-MM`, the economy timezone) with it,
because the gift schedule may differ month to month (spec 2026-10-12). A tier's gift icon (`markerOf`) is coloured by
kind. A draw day carries `item` = `common` / `rare` and says "Vật phẩm thường" / "Vật phẩm hiếm"; a day with named gifts
carries `items` and says their names joined by " + " (`giftNames`, through `itemName`) — "Huy hiệu tháng + Chuyên cần +
Mũ chóp quý ông". A marker this bundle has no words for draws nothing. The icon's words are a tooltip and a visually
hidden span, so the legend under the calendar repeats them where a phone can read them: the draw kinds this month has,
then one line per named-gift day, "Ngày 28 tháng 11/2026: …" (`daily.marker.fixedDay`, the month through
`formatMonthKey`). The relief panel underneath is fed by `GET /api/me`.

---

## The Quản trị screen

`screens/gm/` (route `#/gm`, spec 2026-10-18, SRS §27.2) is the game master's console. It is a lazy chunk like the other
account screens, and its entry is a "Quản trị" row in Settings that shows only for `role === 'gm'` (`AuthMeDto.role`,
`MeDto.role`, held by the session gate). A promotion or a demotion made in the console sends a `GM_NOTICE`, and `App`
calls the gate's `refresh()` (a fresh `GET /api/auth/me`) when one with `action` `promote` or `demote` lands, so the row
and the route follow without a reload; a role changed by the CLI shows after F5. **The route is a convenience and the server is
the lock.** A player who types `#/gm` is sent to the lobby before the chunk is requested (`Redirect`, which uses
`window.location.replace` so Back is not trapped on a redirecting entry), and a GM demoted or locked since the page loaded
finds out on the next call.

- **Seven tabs** — Tổng quan, Người chơi, Phòng, Quà tháng, Cửa hàng (Plan 27), Thẻ hỗn loạn (Plan 37: every chaos card in its tier with a toggle, a weight 0–100 and an economy-day window whose last day is inclusive, "Theo file" = `clear: true`; then the chaos numbers, saved apart from the cards — tier weights, points threshold, draft time, daily cap, daily rescues and, since BP-39, "Thời gian xem kết quả, giây (5–15)" (`resultMs`, how long a chaos result stays up before the next deal; 10 s by default); `GET /api/gm/chaos`, `PUT /api/gm/chaos/rules`, `PUT /api/gm/chaos/config`, each save under a reason), Nhật ký. The Players tab stays mounted (hidden) while one player's page is
  open, so Back returns to the same search, results and cursor with no request.
- **The 403 proxy.** `useAsync` swallows the cause of a failure, so a tab cannot notice that the role is gone. `GmScreen`
  wraps the api in a `Proxy` that checks each call's rejection: a `403 FORBIDDEN` calls `onForbidden` once (a tab firing
  three requests gets three refusals and must leave once). `SELF_TARGET` and `TARGET_IS_GM` are also 403 (and
  `TARGET_IS_LOCKED` a 409) but are about the
  target, so they stay in the dialog that asked. A `401` is the session gate's business and never gets here.
- **`ReasonDialog`** sits behind every action. The reason (3 to 200 characters, spaces not counted) is required before
  Confirm enables; points take a whole non-zero amount within the cap (the field asks for no numeric keypad, so a minus
  can be typed on a phone); a server refusal prints in the dialog, which stays open. The words come from
  `gm.errors.<CODE>`, with the generic line as the fallback.
- **`CopyId`** copies a room or player id with `navigator.clipboard`, then `document.execCommand`, then leaves the id
  selectable: a plain-HTTP LAN host has no clipboard API.
- **Narrow screens.** At 640 px and below the tables become cards (each row's cells stack with their labels). That drops
  table semantics for some screen readers (`docs/known-limitations.md`).
- **`LedgerPanel`** was lifted out of `ProfileScreen` so the GM's player page shows the same ledger list. The two new
  reasons read "Quản trị viên cộng điểm" and "Quản trị viên trừ điểm" (`ledger.reason.gm_grant`, `gm_adjust`).
- **What a player sees.** A `NOTIFICATION` of kind `GM_NOTICE` goes through `notifications.ts`, which writes the signed
  amount (or the item's name) in front of the GM's reason, and names a promotion, a demotion or the whole wardrobe
  (`gm.notice.promote`, `demote`, `wardrobe`); a lock or a kick keeps the GM's words alone. The kit's `Toasts` interpolates `reason`
  (`notify.GM_NOTICE`). A locked account is refused at sign-in with `ACCOUNT_LOCKED` and the reason
  (`auth.errors.ACCOUNT_LOCKED`).
- **Two more actions on a player's page (Plan 26).** "Mở thành tựu" opens the `ReasonDialog` with a native `<select>`
  labelled "Thành tựu" (`fields.achievement`: every definition by its Vietnamese name, the ones the player already has
  disabled, from `GmPlayerDetailDto.unlockedAchievementIds`). "Đặt lại điểm danh" is enabled only once
  `GET /api/gm/players/:id/checkin` says the player has claimed today; its dialog body is computed, not keyed: it names
  the points (`formatPoints`) and the items the reset takes back (`gm.dialog.checkinBody`, `gm.dialog.noItems`). The
  player's toast reads "GM đã mở thành tựu "…" cho bạn." / "Lượt điểm danh hôm nay đã được mở lại: trừ lại {{amount}}
  điểm — {{reason}}" (`gm.notice.*`; the server's notice carries `amount`, and `gm.notice.reset_checkin_plain` covers a
  payload without one). `App` counts the `reset_checkin` notices it sees (once per notification object, like the role
  notices) and hands the count to `DailyScreen` as `checkinResets`; a change drops the receipt and reloads both panels,
  so the "Nhận thưởng" button comes back without a reload (Ruling 11).
- **The Quà tháng tab (`GiftsTab.tsx`).** A month `Select` (this month and 12 more, an edited month marked "(đã sửa)"),
  the month on `DailyCalendar` with each editable day a button "Ngày N" (days up to today in the current month are
  greyed: the server decides by its own zone with `TIER_LOCKED`, the tab by `Asia/Ho_Chi_Minh`), a `Segmented` for the day's
  rule ("Như mặc định" / "Ngẫu nhiên thường" / "Ngẫu nhiên hiếm" / "Cố định"), and for a fixed day a list of items with
  an item `Select` ("Chọn món" / "Thêm món"; it offers only items a gift may be: not default or free, a slot a claim can
  revoke, not already named in the month). "Lưu" opens the `ReasonDialog`; "Về mặc định" appears for a month that has a
  database row. The component keeps the month's edits in local state and is remounted when the saved month changes.
- **`DailyCalendar` is shared.** The Daily screen and the Quà tháng tab draw the same component
  (`screens/DailyCalendar.tsx`: `entries`, `month`, optional `day`/`claimable`, `onPick`, `lockedThrough`,
  `showPoints`), so what a GM saves looks exactly as a player will see it.
- **"Theo ngày" on the overview (`OverviewTab.tsx`, `ByDayPanel`).** A 7-day / 30-day `Segmented` over
  `GET /api/gm/stats/daily`: a table with a row per economy day (Ngày, Nguồn, Bể, Ròng) whose last column draws the day's
  sources (gold) and sinks (red) as bars on one scale, the largest single sum of the range; no chart library. At 375 px the
  table scrolls inside its wrapper (`docs/known-limitations.md`).
- **The Cửa hàng tab (`ShopTab.tsx`, Plan 27).** One read of `GET /api/gm/shop` feeds four blocks, each with its own
  Save behind the `ReasonDialog`: **Giá** (`PricesEditor.tsx`: every item with "Giá của …", "Bậc tối thiểu của …" and
  "Bán …", filtered by slot and rarity, unpriced rows first; Save sends only the changed fields of the changed rows),
  the week's shelf (`FeaturedEditor.tsx`), the welcome choices (`WelcomeEditor.tsx`) and reputation's rules and rank
  thresholds (`ReputationEditor.tsx`). After a save the tab is read again and a status line says what landed ("Đã lưu
  N giá."). A player's page adds "Cộng danh vọng" (a GM only ever adds reputation).

Tests: `screens/gm/*.test.tsx`, `screens/DailyCalendar.test.tsx`, `notifications.test.ts`, and the ops pack's section Q
(`e2e/ops/06-gm.spec.ts`, Q-01 to Q-04).

---

## The Cửa hàng and the welcome gift (Plan 27)

`screens/shop/ShopScreen.tsx` (route `#/shop`, a lazy account chunk, reached from the lobby's "Phòng thay đồ và cửa
hàng" links) draws `GET /api/shop`: a stage with the player's figure, their balance ("Số dư: N điểm") and their
reputation line, "Kệ tuần này" when the week has a shelf, then one shelf per rarity ("Theo độ hiếm") filtered by slot.
Each card (`ShopCard.tsx`) is the wardrobe's own card with the shop's footer: "Mua · N", "🔒 cần <Bậc>" under the
player's rank, "thiếu N điểm" when short, "✓ Đã có" with a link to wear it, or why the item does not sell. A press on a
card is a try-on; "Mua" asks "Mua món này?" and sends a fresh `purchaseId` (`purchase-id.ts`), so a retry after a
timeout is charged once.

`screens/WelcomeDialog.tsx` is the welcome gift: it opens over the lobby by itself once per account and browser
(`bp.welcomeShown`) while `GET /api/welcome` says it is not claimed, offers three rare items drawn on the player's own
figure, and grants the pick (worn at once) and the reputation with "Nhận"; "Để sau" leaves the lobby's "🎁 Quà chào
mừng" button as the way back. While the gift waits the daily reminder does not open Điểm danh. Tests:
`screens/shop/*.test.tsx`, `screens/WelcomeDialog.test.tsx`, and the ops pack's section P (`e2e/ops/08-shop.spec.ts`).

---

## i18n

Two bundles, `vi` (default) and `en`, both under the `normal` namespace, merged into the kit's i18n
by `main.tsx`. The kit's own namespaces (`common`, `game`) stay the kit's: a key that belongs to the
table is added there, not here.

`src/locales/locales.test.ts` is the parity test and it checks four things: every dotted leaf exists
in both languages, no value is empty, every catalogue item id has an `items.<id>` name (and no name
exists for an id the server does not serve), and every achievement id has a `name` and a `desc`. It
reads the server's `data/*.json` directly — the only thing this app ever reads out of `normal-server`,
data rather than code, and only from a test.

---

## Tests

```bash
pnpm --filter @bp/normal-web test        # vitest: jsdom unit + screen tests, plus the footprint budget
pnpm --filter @bp/normal-web typecheck   # src, test/ and e2e/ are three separate projects
```

Screen tests render the real screen against a hand-written `NormalApi` stub and drive it through
`@testing-library/user-event`, addressing everything by role and accessible name. That is deliberate:
these tests are the accessibility check as well as the behaviour check, and a query that has to reach
for a class name is a screen a keyboard cannot use.

### Footprint

`test/footprint.test.ts` measures the emitted bundle — gzip, because that is what the wire carries —
and holds four budgets:

| | Budget | Today |
|---|---:|---:|
| entry chunk (first paint) | 140 KB (Plan 27, Ruling 13) | ~136 KB |
| every JS chunk together | 900 KB | ~174 KB |
| the stylesheet | 60 KB | ~23 KB |
| `public/avatar/*@2x.png`, raw bytes (design §8) | 32 MB total (design: 6 MB; raised 2026-09-24 for real art) | ~17 MB (the v4 art) |

The first three are headroom rather than targets: their job is to catch a *step change* (a chart
library, a locale bundle that stopped being split), not to fail on the kilobyte a feature costs. The
avatar budget is the one design §8 actually sets a ceiling on — `@2x` only, since `@1x` is the same
pictures at a quarter the pixels and never dominates the total — and it does not skip on a missing
`dist/`: it reads `public/avatar/` directly, the committed layers rather than a build output, so it is
live on a fresh checkout that has not built anything.

One structural assertion sits beside the numbers: the entry chunk is read off `dist/index.html`'s module
script rather than guessed from a file name, and the five account screens must each still be a chunk of
their own — a screen that rejoined the entry is a chunk that stopped being emitted under its own name.
The three build-dependent blocks **skip with a warning** when `dist/` is missing, so `pnpm test` on a
fresh checkout stays green and says what it had nothing to measure. Run `pnpm build:normal` (or
`pnpm --filter @bp/normal-web build`) first to make them measure too.

---

## End-to-end

A Playwright pass over the built app against the **real** server: `apps/normal-server/src/e2e-entry.ts`
is the production `buildApp` — its routes, CSRF guard, cookie session, gateway and economy — on a
throwaway PGlite database, serving `apps/normal-web/dist` from the same origin. Nothing is mocked and
nothing is left behind; the database only ever existed inside the server process.

```bash
pnpm build:normal                                   # both halves; the e2e server refuses to start without dist/
pnpm --filter @bp/normal-web exec playwright install chromium   # once, ~150 MB
pnpm e2e:normal
```

`e2e/playwright.config.ts` runs one worker in `vi-VN` / `Asia/Ho_Chi_Minh` with two projects: desktop
(1440×900) and mobile (375×812, the `@mobile` tag). Its `webServer` is
`node ../normal-server/scripts/e2e-server.mjs`, which bundles the entry with esbuild to
`apps/normal-server/.e2e/server.mjs` — deliberately not `dist/`, which the server's own build guards
against ever containing PGlite — and runs it on `127.0.0.1:8091`.

`normal.spec.ts` and `avatar2d.spec.ts` share `e2e/support.ts` — the account, the cookie session, the
lobby, the create-room dialog and the two viewport assertions. It is a module the specs import, not a
test file; Playwright only collects `*.spec.ts`.

What the five tests are for:

- **The money.** One account plays a Blind hand against a bot to settlement, and the balance from
  `GET /api/me` (the database's own answer) is reconciled against the payout, the uncalled return and
  the table fee *as printed on the result card*. A settlement that quietly created or destroyed
  points fails here even though both halves would look consistent alone.
- **The session.** Register, sign out, sign back in — the only credential involved is the cookie.
- **The chrome on a phone.** The rail's four tabs must fit inside 375 px with nothing scrolling
  sideways, and the table must come up in the stack layout.
- **The wardrobe, end to end** (`avatar2d.spec.ts`). `Chibi.test.tsx` proves the layering and the hide
  rules under jsdom against a hand-built config; this file is the other half — that the *app* wires a
  saved choice back into the lobby bar, a seat plate and a second wardrobe visit consistently, on the
  layers `public/avatar/` ships. It opens on Kiểu tóc, switches Nữ to Nam (the bob
  gives way to its counterpart, "Tóc rối"), picks "Tóc vuốt dựng" and saves, checks that a locked epic
  tile (`aria-disabled`) does not equip on click, sits at a table and asserts the seat's
  `data-chibi-hash` matches the bar's and its `<img>`s name `body_m_L30` and `item_hair_m_spiky01_L60`
  while both bots' name `bot_`, then saves an outfit-bar snapshot, switches back to Nữ (the ponytail,
  the spiky hair's counterpart), picks the bob, saves, and applies the snapshot back — three hashes
  belonging to two configurations, since Nữ with the bob and nothing else equipped is exactly what the
  account started as. Nothing here needs a GPU: a chibi is a stack of same-origin `<img>`s, unlike the
  3D `avatar3d.spec.ts` this file replaced.

Every selector is a user-visible one: a role and its accessible name, in Vietnamese. It fails when
the thing a player reaches for stops being reachable, not when a class name changes. Screenshots
(both viewports) land in `e2e/screenshots/`, which is not committed.

The suite is **not** part of `pnpm test`: it needs a build and a browser download.
