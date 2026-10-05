import type { TFunction } from 'i18next'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ItemDto, Rarity } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { ItemPreview } from './ItemTab.js'
import s from './wardrobe.module.css'

/**
 * The right column's cards (design §4, §7): one accessible-name recipe and one "wearing/locked" chrome,
 * shared by every card shape the wardrobe draws — a picture (`ItemCard`), a colour swatch (`ColourCard`) or
 * plain text (`WordCard`).
 *
 * Every card calls `onPick` unconditionally when it is owned — including the one already
 * worn — so a second press on an equipped optional slot's card can unequip it; that toggle is the
 * caller's decision (`WardrobeScreen.pick`), not this file's, exactly as `ItemTab` already worked.
 */

/** "<name>, <rarity>[, wearing|, locked: <hint>]" (design §7). Rarity reuses the `inventory.rarity.*` keys (the
 * Inventory screen's, folded into the wardrobe by No5, which kept them) rather than a second Vietnamese vocabulary
 * for the same three words; `locked`/
 * `wearing` reuse the old filter's "Chưa có" (`wardrobe.filter.locked`, kept for this label when No11a's box
 * replaced the filter buttons) and the wearing-pill strings for the same reason. */
function cardLabel(name: string, rarity: Rarity, owned: boolean, wearing: boolean, hint: string, t: TFunction<'normal'>): string {
  const rarityLabel = t(`inventory.rarity.${rarity}`)
  if (!owned) return `${name}, ${rarityLabel}, ${t('wardrobe.filter.locked')}: ${hint}`
  if (wearing) return `${name}, ${rarityLabel}, ${t('wardrobe.wearingBadge')}`
  return `${name}, ${rarityLabel}`
}

/** A colour dot's label and tooltip (Plan 20, T3): the member's name — and, for one the player does not own, "<name>,
 * Chưa có: <hint>", `cardLabel`'s wording without the rarity (a dot draws no rarity line). With the box ticked an owned
 * variant's card hides the original's own lock line, and its dot is the one place left that says how to get it. */
function dotLabel(name: string, owned: boolean, hint: string, t: TFunction<'normal'>): string {
  return owned ? name : `${name}, ${t('wardrobe.filter.locked')}: ${hint}`
}

/** Decorative glyphs kept out of JSX text (`react/jsx-no-literals`, `eslint.config.js`) the same way
 * `TableChrome`'s badge glyphs are — a named value referenced by identifier, not a literal in the markup. */
const CHECK_GLYPH = '✓ '
const LOCK_GLYPH = '\u{1F512} '

/** The gold "✓ Đang mặc" pill (design §4.1): decorative, because the accessible name already says
 * "wearing" in words. */
function WearingPill() {
  const { t } = useTranslation('normal')
  return (
    <span className={s.wearingPill}>
      <span aria-hidden="true">{CHECK_GLYPH}</span>
      {t('wardrobe.wearingBadge')}
    </span>
  )
}

/** The locked row: a lock glyph plus `hintFor`'s own text (design §4.1) — visible for a sighted player,
 * folded into the button's `aria-label` for everyone else. The glyph is its own element (rather than one
 * text node sharing the span with the hint) so the hint's own text stays independently queryable — by a
 * test, and by anything else that only wants the words, not the icon. */
function LockHint({ hint }: { hint: string }) {
  return (
    <span className={s.lockHint}>
      <span aria-hidden="true">{LOCK_GLYPH}</span>
      {hint}
    </span>
  )
}

function RarityLabel({ rarity }: { rarity: Rarity }) {
  const { t } = useTranslation('normal')
  return (
    <span className={s.cardRarity} aria-hidden="true">
      {t(`inventory.rarity.${rarity}`)}
    </span>
  )
}

export interface ItemCardProps {
  /** The family member the card draws, names and picks (`FamilyCard.shown`, `./categories.js`): the member worn in
   * the slot (No8a); else the original, when it is owned; else the first owned colour variant (No11a); else the
   * original — whichever way the box is ticked (final fix wave, B2). Everything the button says and does is this
   * member's — picture (tinted when it is a colour variant), name, rarity, "Đang dùng", lock and click. */
  item: ItemDto
  /** The family's original, which names the dot row; `item` itself when omitted (a lone card, or the original shown). */
  family?: ItemDto
  /** The draft's gender (design §4.1's gendered cut; a base's `wear` until Plan 19), forwarded straight to `ItemPreview`. */
  wear?: string
  owned: boolean
  wearing: boolean
  hint: string
  /** This card's dots (design §4.1's dot row): the family, the original first (No8a) — each one owned/worn
   * independently of the card itself, so with the box ticked an owned variant's card still shows the locked original's
   * dot, and a locked variant's. A member with no `asset.tint` (the original) is drawn as the untinted natural swatch.
   * Only the dots to draw: the caller has already dropped the ones not owned while the box is unticked. `hint` is how to
   * get a member the player does not own (`hintFor`'s text, `''` for one that is owned): its dot's label and title carry it. */
  variants?: { item: ItemDto; owned: boolean; wearing: boolean; hint: string }[]
  /** The family's original is locked while the card shows another member — the box ticked over an owned colour variant
   * (Plan 20, T3) — and this is how to get that original (`hintFor`'s text): drawn as one line, "<original name>: <hint>",
   * under the pick button and over the dot row, for a touch screen that has no tooltip to read the dot's hint from. It is
   * outside the pick button, so it is not part of what the button says, and the even-row rule still lines the bottoms up. */
  familyHint?: string
  /** Keeps the dot row's height on a card that has no variants of its own, so that in a tab where some cards do
   * have them every card's lock hint ends on the same line (No8b). `ItemTab` sets it; a lone card never needs it. */
  reserveDots?: boolean
  /** The card's picture, drawn in place of the item's icon (`ItemPreview`): a hairstyle's head portrait (Kiểu tóc,
   * avatar v4 — a hairstyle has no icon of its own, and is only worth seeing on a head). */
  thumb?: ReactNode
  onPick: (id: string) => void
}

/**
 * A pictured item (Kiểu tóc, Mũ, Phụ kiện mặt, Trang phục, Hào quang, Khung — design §4.1).
 *
 * Two elements, not one (V3 fix, 2026-09-27): a colour-variant dot is its own `<button>`, and a `<button>`
 * cannot contain another, so the card's visual chrome — border, background, `data-rarity` — lives on a
 * plain outer `<div>`, and everything that used to be the *whole* clickable card (picture, name, rarity,
 * lock hint) moves into an inner `.cardPick` button beside the dot row, both now inside the same bordered
 * box instead of the dots sitting below/outside it. Between the two, outside the button, can sit the locked original's
 * hint line (`familyHint`, Plan 20 T3).
 */
export function ItemCard({ item, family = item, wear, owned, wearing, hint, variants, familyHint, reserveDots = false, thumb, onPick }: ItemCardProps) {
  const { t } = useTranslation('normal')
  const name = itemName(item.id, t)
  const hasVariants = variants !== undefined && variants.length > 0

  return (
    <div className={s.cardCell}>
      <div className={s.card} data-rarity={item.rarity} data-wearing={wearing}>
        <button
          type="button"
          className={s.cardPick}
          aria-pressed={wearing}
          aria-disabled={!owned}
          aria-label={cardLabel(name, item.rarity, owned, wearing, hint, t)}
          onClick={() => {
            if (owned) onPick(item.id)
          }}
        >
          {wearing ? <WearingPill /> : null}
          <span className={thumb === undefined ? s.cardThumb : `${s.cardThumb} ${s.cardPortrait}`} data-locked={!owned}>
            {thumb === undefined ? <ItemPreview item={item} wear={wear} /> : thumb}
          </span>
          <span className={s.cardName} data-locked={!owned}>
            {name}
          </span>
          <RarityLabel rarity={item.rarity} />
          {owned ? null : <LockHint hint={hint} />}
        </button>
        {familyHint === undefined ? null : <LockHint hint={`${itemName(family.id, t)}: ${familyHint}`} />}
        {!hasVariants ? (
          reserveDots ? <div className={s.dotsSpacer} aria-hidden="true" /> : null
        ) : (
          <div className={s.colourDots} role="group" aria-label={itemName(family.id, t)}>
            {variants!.map(({ item: member, owned: memberOwned, wearing: memberWearing, hint: memberHint }) => {
              const tint = member.asset?.tint
              const memberLabel = dotLabel(itemName(member.id, t), memberOwned, memberHint, t)
              return (
                <button
                  key={member.id}
                  type="button"
                  className={tint === undefined ? `${s.colourDot} ${s.colourDotNatural}` : s.colourDot}
                  style={tint === undefined ? undefined : { background: tint }}
                  aria-label={memberLabel}
                  title={memberLabel}
                  aria-pressed={memberWearing}
                  aria-disabled={!memberOwned}
                  onClick={() => {
                    if (memberOwned) onPick(member.id)
                  }}
                >
                  {memberOwned ? null : <span className={s.lock} aria-hidden="true" />}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export interface ColourCardProps {
  /** `null` is the "Natural" swatch — the hairstyle's or the body's own colour, never locked, never anyone's rarity. */
  item: ItemDto | null
  owned: boolean
  wearing: boolean
  hint: string
  /** The "Natural" swatch's fill, when that colour is known (Màu da: the body's own skin); left out, the swatch is the
   * half-and-half mark. Ignored on any other swatch. */
  naturalColour?: string
  onPick: (id: string | undefined) => void
}

/** A colour swatch (Màu tóc, Màu da, Màu mắt — design §4.3): same wearing/lock chrome as `ItemCard`, a round
 * swatch of `item.colour` instead of a picture. */
export function ColourCard({ item, owned, wearing, hint, naturalColour, onPick }: ColourCardProps) {
  const { t } = useTranslation('normal')
  const name = item === null ? t('wardrobe.natural') : itemName(item.id, t)
  const clickable = item === null || owned
  const label = item === null ? name : cardLabel(name, item.rarity, owned, wearing, hint, t)

  return (
    <button
      type="button"
      className={s.card}
      data-rarity={item?.rarity}
      aria-pressed={wearing}
      aria-disabled={!clickable}
      aria-label={label}
      onClick={() => {
        if (clickable) onPick(item?.id)
      }}
    >
      {wearing ? <WearingPill /> : null}
      {item === null ? (
        <span className={s.naturalSwatch} style={naturalColour === undefined ? undefined : { background: naturalColour }} aria-hidden="true" />
      ) : (
        <span className={s.colourSwatchBig} style={{ background: item.colour }} aria-hidden="true" />
      )}
      <span className={s.cardName} data-locked={!clickable}>
        {name}
      </span>
      {item === null ? null : <RarityLabel rarity={item.rarity} />}
      {clickable ? null : <LockHint hint={hint} />}
    </button>
  )
}

export interface WordCardProps {
  item: ItemDto
  owned: boolean
  wearing: boolean
  hint: string
  onPick: (id: string) => void
}

/** A text-only card (Danh hiệu, Huy hiệu — design §4.4): the same wearing/lock chrome as `ItemCard`
 * with no picture to draw. */
export function WordCard({ item, owned, wearing, hint, onPick }: WordCardProps) {
  const { t } = useTranslation('normal')
  const name = itemName(item.id, t)

  return (
    <button
      type="button"
      className={s.card}
      data-rarity={item.rarity}
      aria-pressed={wearing}
      aria-disabled={!owned}
      aria-label={cardLabel(name, item.rarity, owned, wearing, hint, t)}
      onClick={() => {
        if (owned) onPick(item.id)
      }}
    >
      {wearing ? <WearingPill /> : null}
      <span className={s.cardName} data-locked={!owned}>
        {name}
      </span>
      <RarityLabel rarity={item.rarity} />
      {owned ? null : <LockHint hint={hint} />}
    </button>
  )
}
