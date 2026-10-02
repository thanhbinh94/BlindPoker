import { Chibi, type ChibiConfig } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { BaseDto, BaseId, ItemDto, Rarity } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { ItemPreview } from './ItemTab.js'
import s from './wardrobe.module.css'

/**
 * The right column's cards (design §4, §7): one accessible-name recipe and one "wearing/locked" chrome,
 * shared by every card shape the wardrobe draws — a picture (`ItemCard`), a colour swatch (`ColourCard`),
 * plain text (`WordCard`) or a base's portrait (`BaseCard`, which has neither rarity nor a lock and so
 * does not share the recipe at all).
 *
 * Every card but `BaseCard` calls `onPick` unconditionally when it is owned — including the one already
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
  /** The draft base's wear (design §4.1's gendered cut), forwarded straight to `ItemPreview`. */
  wear?: string
  owned: boolean
  wearing: boolean
  hint: string
  /** This card's dots (design §4.1's dot row): the family, the original first (No8a) — each one owned/worn
   * independently of the card itself, so with the box ticked an owned variant's card still shows the locked original's
   * dot, and a locked variant's. A member with no `asset.tint` (the original) is drawn as the untinted natural swatch.
   * Only the dots to draw: the caller has already dropped the ones not owned while the box is unticked. */
  variants?: { item: ItemDto; owned: boolean; wearing: boolean }[]
  /** Keeps the dot row's height on a card that has no variants of its own, so that in a tab where some cards do
   * have them every card's lock hint ends on the same line (No8b). `ItemTab` sets it; a lone card never needs it. */
  reserveDots?: boolean
  onPick: (id: string) => void
}

/**
 * A pictured item (Mũ, Phụ kiện mặt, Trang phục, Hào quang, Khung — design §4.1).
 *
 * Two elements, not one (V3 fix, 2026-09-27): a colour-variant dot is its own `<button>`, and a `<button>`
 * cannot contain another, so the card's visual chrome — border, background, `data-rarity` — lives on a
 * plain outer `<div>`, and everything that used to be the *whole* clickable card (picture, name, rarity,
 * lock hint) moves into an inner `.cardPick` button beside the dot row, both now inside the same bordered
 * box instead of the dots sitting below/outside it.
 */
export function ItemCard({ item, family = item, wear, owned, wearing, hint, variants, reserveDots = false, onPick }: ItemCardProps) {
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
          <span className={s.cardThumb} data-locked={!owned}>
            <ItemPreview item={item} wear={wear} />
          </span>
          <span className={s.cardName} data-locked={!owned}>
            {name}
          </span>
          <RarityLabel rarity={item.rarity} />
          {owned ? null : <LockHint hint={hint} />}
        </button>
        {!hasVariants ? (
          reserveDots ? <div className={s.dotsSpacer} aria-hidden="true" /> : null
        ) : (
          <div className={s.colourDots} role="group" aria-label={itemName(family.id, t)}>
            {variants!.map(({ item: member, owned: memberOwned, wearing: memberWearing }) => {
              const tint = member.asset?.tint
              const memberName = itemName(member.id, t)
              return (
                <button
                  key={member.id}
                  type="button"
                  className={tint === undefined ? `${s.colourDot} ${s.colourDotNatural}` : s.colourDot}
                  style={tint === undefined ? undefined : { background: tint }}
                  aria-label={memberName}
                  title={memberName}
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
  /** `null` is the "Natural" swatch — the base's own colour, never locked, never anyone's rarity. */
  item: ItemDto | null
  owned: boolean
  wearing: boolean
  hint: string
  onPick: (id: string | undefined) => void
}

/** A colour swatch (Màu tóc, Màu mắt — design §4.3): same wearing/lock chrome as `ItemCard`, a round
 * swatch of `item.colour` instead of a picture. */
export function ColourCard({ item, owned, wearing, hint, onPick }: ColourCardProps) {
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
        <span className={s.naturalSwatch} aria-hidden="true" />
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

export interface BaseCardProps {
  base: BaseDto
  /** The base wearing the draft's current outfit (design §4.2) — computed by the caller (`BaseTab`),
   * which is the one that knows the rest of the draft. */
  portrait: ChibiConfig
  selected: boolean
  onPick: (id: BaseId) => void
  /** The portrait's own width (V5 fix, 2026-09-27): a fixed 96 px overflowed a phone's 3-column grid —
   * `.baseCard`'s minimum content width (padding plus this fixed-width chibi) exceeded the column's own
   * share, so the grid — the whole page — scrolled sideways. Defaults to 96, the desktop/tablet value;
   * `BaseTab` passes a smaller one on phone. */
  portraitSize?: number
}

/** A figure tile (tab Thân — design §4.2): chosen, not owned, so it has neither a rarity nor a lock —
 * only ever a gold border when it is the draft's current base. */
export function BaseCard({ base, portrait, selected, onPick, portraitSize = 96 }: BaseCardProps) {
  const { t } = useTranslation('normal')
  return (
    <button type="button" className={s.baseCard} aria-pressed={selected} onClick={() => onPick(base.id)}>
      <Chibi subject={portrait} frame="head" size={portraitSize} />
      <span className={s.cardName}>{t(base.nameKey)}</span>
    </button>
  )
}
