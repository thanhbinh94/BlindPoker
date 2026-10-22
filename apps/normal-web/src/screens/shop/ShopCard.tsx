import { Button, formatPoints, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'
import type { Gender, ItemDto, ShopEntryDto, ShopLockDto } from '../../api.js'
import { achievementName, itemName } from '../../catalog-i18n.js'
import { formatMonthKey } from '../format.js'
import { ColourCard, ItemCard, WordCard } from '../wardrobe/cards.js'
import s from './shop.module.css'

/**
 * What a shop card's footer says (spec 2026-10-21 §3 B3), first match wins:
 * - `owned` — "✓ Đã có" and a "Mặc" link into the wardrobe;
 * - `lock` — the server's source label ("🏆 Thành tựu: …", "📅 Quà tháng 11/2026", "Miễn phí — …", "Không bán");
 * - `rank` — the price and "🔒 cần Bậc thầy", no button: the rank is judged against the high-water mark (R15);
 * - `short` — "Mua · 30.000", disabled, and "thiếu 12.000 điểm";
 * - `buy` — "Mua · 30.000".
 *
 * The server judges every purchase again; this only decides what to offer.
 */
export type FooterState = 'owned' | 'lock' | 'rank' | 'short' | 'buy'

export function footerState(entry: ShopEntryDto, balance: number, rank: number): FooterState {
  if (entry.owned) return 'owned'
  if (entry.lock !== null || !entry.purchasable) return 'lock'
  if (entry.minRank > rank) return 'rank'
  if (balance < entry.price) return 'short'
  return 'buy'
}

/** A lock's words. An entry that is neither owned, locked nor purchasable should not exist; it reads "Không bán". */
export function lockLabel(lock: ShopLockDto | null, t: TFunction<'normal'>): string {
  switch (lock?.kind) {
    case 'achievement':
      return t('shop.lock.achievement', { name: achievementName(lock.achievementId, t) })
    case 'gift_month':
      return t('shop.lock.giftMonth', { month: formatMonthKey(lock.month) })
    case 'gift_default':
      return t('shop.lock.giftDefault')
    case 'free':
      return t('shop.lock.free')
    case 'default':
      return t('shop.lock.default')
    case 'unpriced':
      return t('shop.lock.unpriced')
    default:
      return t('shop.lock.disabled')
  }
}

/** The colour slots, drawn as a swatch rather than a picture. */
const COLOUR_SLOTS = new Set<ItemDto['slot']>(['hairColor', 'eyeColor', 'skinColor'])
/** The word slots, drawn as plain text. */
const WORD_SLOTS = new Set<ItemDto['slot']>(['title', 'badge'])

export interface ShopCardProps {
  entry: ShopEntryDto
  /** The catalogue row the card draws (P21: a shop entry carries no picture of its own). */
  item: ItemDto
  lang: Language
  /** The balance to judge "Mua" against: the live one, or the purchase's answer until the live one moves. */
  balance: number
  /** The player's rank, the high-water mark the server judges `minRank` against. */
  rank: number
  /** The figure's gender, for an item with a cut per gender. */
  wear?: Gender
  /** This card's item is on the stage as a try-on. */
  trying: boolean
  onTry: (item: ItemDto) => void
  onBuy: (entry: ShopEntryDto) => void
}

/**
 * One shop card: the wardrobe's own card (`ItemCard`, `ColourCard` or `WordCard`) with the shop's footer under it.
 *
 * Every card is drawn as the wardrobe draws an owned one — full colour, no lock line — and every card is pickable: in
 * the shop a press is a try-on, and an item worth selling is worth seeing in colour. What the player can do about it is
 * the footer's to say, so the card's own "locked" chrome would only repeat it, greyed.
 */
export function ShopCard({ entry, item, lang, balance, rank, wear, trying, onTry, onBuy }: ShopCardProps) {
  const { t } = useTranslation('normal')
  const state = footerState(entry, balance, rank)
  const price = formatPoints(entry.price, lang)
  const name = itemName(item.id, t)

  const footer = (
    <div className={s.footer} data-state={state}>
      {state === 'owned' ? (
        <>
          <span className={s.owned}>{t('shop.owned')}</span>
          <a className={s.wearLink} href={`#/avatar?item=${encodeURIComponent(item.id)}`} aria-label={t('shop.wearLabel', { item: name })}>
            {t('shop.wear')}
          </a>
        </>
      ) : state === 'lock' ? (
        <span className={s.note}>{lockLabel(entry.lock, t)}</span>
      ) : state === 'rank' ? (
        <>
          <span className={s.price}>{t('shop.price', { price })}</span>
          <span className={s.need}>{t('shop.needRank', { rank: t(`game:rank.${entry.minRank}`, { defaultValue: String(entry.minRank) }) })}</span>
        </>
      ) : (
        <>
          <Button variant="gold" size="sm" className={s.buy} disabled={state === 'short'} onClick={() => onBuy(entry)}>
            {t('shop.buyPrice', { price })}
          </Button>
          {state === 'short' ? <span className={s.short}>{t('shop.short', { amount: formatPoints(entry.price - balance, lang) })}</span> : null}
        </>
      )}
    </div>
  )

  return (
    <div className={s.slot} data-trying={trying} data-item={item.id}>
      {COLOUR_SLOTS.has(item.slot) ? (
        <ColourCard item={item} owned wearing={false} hint="" pickable footer={footer} onPick={() => onTry(item)} />
      ) : WORD_SLOTS.has(item.slot) ? (
        <WordCard item={item} owned wearing={false} hint="" pickable footer={footer} onPick={() => onTry(item)} />
      ) : (
        <ItemCard item={item} wear={wear} owned wearing={false} hint="" pickable footer={footer} onPick={() => onTry(item)} />
      )}
    </div>
  )
}
