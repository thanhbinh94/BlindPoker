import { Badge, Button, Panel, type Language } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import { GEOMETRIC_SLOTS, type AvatarConfigDto, type GeometricSlot, type InventoryDto, type NormalApi, type OwnedItemDto } from '../api.js'
import { PartPortrait } from '../avatar3d/Portrait.js'
import { itemName } from '../catalog-i18n.js'
import { RARITY_TONE, SLOT_ORDER } from './catalog.js'
import { formatDay } from './format.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

/** How an item was acquired, as the server records it. Anything else still gets words rather than a raw key. */
const SOURCES = new Set(['default', 'daily', 'achievement'])

/** `title` and `badge` are words rather than geometry, so there is no figure to draw for them. */
const isGeometric = (slot: string): slot is GeometricSlot => (GEOMETRIC_SLOTS as readonly string[]).includes(slot)

/** Which slot of the equipped config an item would sit in, so "equipped" can be read off the avatar. */
export function isEquipped(item: OwnedItemDto, avatar: AvatarConfigDto): boolean {
  return item.slot !== null && avatar[item.slot] === item.itemId
}

export interface InventoryScreenProps {
  api: NormalApi
  lang: Language
}

/**
 * Everything this account owns, grouped the way the wardrobe offers it.
 *
 * It reads the same `GET /api/me/inventory` the wardrobe does — one endpoint, two readings — which is why
 * "equipped" needs no second request: the equipped config arrives in the same body as the items, so the mark
 * can never disagree with what the avatar is actually wearing.
 *
 * Every tile is a **portrait of the player wearing that item** rather than a picture of the item on its own.
 * That is more expensive (each one is a render) and it is the right trade: a garment's colour and cut only
 * mean anything on the body, hair and skin tone that will actually wear them. The cost is paid lazily — a
 * tile below the fold does not render until it comes near the viewport — and each distinct configuration is
 * drawn once and then cached by hash, so scrolling back up costs nothing.
 */
export function InventoryScreen({ api, lang }: InventoryScreenProps) {
  const { t } = useTranslation('normal')
  const wardrobe = useAsync<InventoryDto>(() => api.inventory())
  const inventory = wardrobe.data

  if (wardrobe.loading && inventory === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (inventory === null) {
    return (
      <main className={s.page}>
        <p className={s.alert} role="alert">
          {t('inventory.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={wardrobe.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </main>
    )
  }

  const avatar = inventory.avatar

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('inventory.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('inventory.lead')}</p>
      <p className={s.footnote}>{t('inventory.summary', { owned: inventory.items.length })}</p>

      {SLOT_ORDER.map((slot) => {
        const owned = inventory.items.filter((item) => item.slot === slot)
        return (
          <Panel title={t(`inventory.slot.${slot}`)} key={slot}>
            {owned.length === 0 ? (
              <p className={s.footnote}>{t('inventory.empty')}</p>
            ) : (
              <ul className={s.grid}>
                {owned.map((item) => {
                  const source = SOURCES.has(item.source) ? item.source : 'other'
                  return (
                    <li className={s.card} key={item.itemId} data-equipped={String(isEquipped(item, avatar))}>
                      {isGeometric(slot) ? <PartPortrait className={s.thumb} config={avatar} slot={slot} itemId={item.itemId} /> : null}
                      <span className={s.cardName}>{itemName(item.itemId, t)}</span>
                      <span className={s.cardMarks}>
                        {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
                        {isEquipped(item, avatar) ? <Badge tone="gold">{t('inventory.equipped')}</Badge> : null}
                      </span>
                      <span className={s.rowMeta}>{t(`inventory.source.${source}`)}</span>
                      <time className={s.rowMeta} dateTime={new Date(item.acquiredAt).toISOString()}>
                        {t('inventory.acquired', { date: formatDay(item.acquiredAt, lang) })}
                      </time>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>
        )
      })}
    </main>
  )
}
