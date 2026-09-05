import { Badge, Button, Panel, type Language } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, InventoryDto, ItemCategory, NormalApi, OwnedItemDto } from '../api.js'
import { PartThumb } from '../avatar/PartThumb.js'
import { CATEGORIES, RARITY_TONE } from './catalog.js'
import { formatDay } from './format.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

/** How an item was acquired, as the server records it. Anything else still gets words rather than a raw key. */
const SOURCES = new Set(['default', 'daily', 'achievement'])

/** `title` and `badge` are words rather than layers, so there is no part to draw for them. */
const DRAWN: ItemCategory[] = ['base', 'face', 'clothing', 'hair', 'accessory', 'jewelry']

/** Which slot of the equipped config an item would sit in, so "equipped" can be read off the avatar. */
export function isEquipped(item: OwnedItemDto, avatar: AvatarConfigDto): boolean {
  return item.category !== null && avatar[item.category] === item.itemId
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

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('inventory.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('inventory.lead')}</p>
      <p className={s.footnote}>{t('inventory.summary', { owned: inventory.items.length })}</p>

      {CATEGORIES.map((category) => {
        const owned = inventory.items.filter((item) => item.category === category)
        return (
          <Panel title={t(`inventory.category.${category}`)} key={category}>
            {owned.length === 0 ? (
              <p className={s.footnote}>{t('inventory.empty')}</p>
            ) : (
              <ul className={s.grid}>
                {owned.map((item) => {
                  const source = SOURCES.has(item.source) ? item.source : 'other'
                  return (
                    <li className={s.card} key={item.itemId} data-equipped={String(isEquipped(item, inventory.avatar))}>
                      {DRAWN.includes(category) ? (
                        <PartThumb
                          className={s.thumb}
                          assetKey={item.assetKey ?? `${category}/${item.itemId}`}
                          {...(category === 'hair' ? { hairColor: inventory.avatar.hairColor } : {})}
                        />
                      ) : null}
                      <span className={s.cardName}>{t(`items.${item.itemId}`)}</span>
                      <span className={s.cardMarks}>
                        {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
                        {isEquipped(item, inventory.avatar) ? <Badge tone="gold">{t('inventory.equipped')}</Badge> : null}
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
