import { Badge, Button, Panel, type Language } from '@bp/ui-kit'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, ItemDto, ItemSlot, NormalApi, OwnedItemDto } from '../api.js'
import { itemName } from '../catalog-i18n.js'
import { RARITY_TONE, SLOT_ORDER } from './catalog.js'
import { formatDay } from './format.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'
import { ItemPreview } from './wardrobe/ItemTab.js'

/** How an item was acquired, as the server records it. Anything else still gets words rather than a raw key. */
const SOURCES = new Set(['default', 'daily', 'achievement'])

interface InventoryData {
  items: OwnedItemDto[]
  avatar: AvatarConfigDto
  catalog: ItemDto[]
}

/** Which slot of the equipped config an item would sit in, so "equipped" can be read off the avatar. */
export function isEquipped(itemId: string, slot: ItemSlot | null, avatar: AvatarConfigDto): boolean {
  if (slot === null) return false
  return (avatar as unknown as Record<ItemSlot, string | undefined>)[slot] === itemId
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
 * Every drawn tile is an `ItemPreview` — the wardrobe's own picture, in read-only chrome here — the item's
 * inventory icon, the item on its own. `title` and `badge` have no layer at all, so their tiles carry words
 * and nothing else, the same as they always have.
 */
export function InventoryScreen({ api, lang }: InventoryScreenProps) {
  const { t } = useTranslation('normal')
  const wardrobe = useAsync<InventoryData>(async () => {
    const [inventory, catalogAnswer] = await Promise.all([
      api.inventory(),
      api.catalogItems().then(
        (answer) => answer.items,
        () => [] as ItemDto[],
      ),
    ])
    return { items: inventory.items, avatar: inventory.avatar, catalog: catalogAnswer }
  })
  const data = wardrobe.data

  const items = useMemo(() => new Map((data?.catalog ?? []).map((item) => [item.id, item])), [data])

  if (wardrobe.loading && data === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (data === null) {
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

  const avatar = data.avatar

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('inventory.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('inventory.lead')}</p>
      <p className={s.footnote}>{t('inventory.summary', { owned: data.items.length })}</p>

      {SLOT_ORDER.map((slot) => {
        const owned = data.items.filter((item) => item.slot === slot)
        return (
          <Panel title={t(`inventory.slot.${slot}`)} key={slot}>
            {owned.length === 0 ? (
              <p className={s.footnote}>{t('inventory.empty')}</p>
            ) : (
              <ul className={s.grid}>
                {owned.map((item) => {
                  const source = SOURCES.has(item.source) ? item.source : 'other'
                  const def = items.get(item.itemId)
                  const equipped = isEquipped(item.itemId, item.slot, avatar)
                  return (
                    <li className={s.card} key={item.itemId} data-equipped={String(equipped)}>
                      {def === undefined ? null : <ItemPreview item={def} />}
                      <span className={s.cardName}>{itemName(item.itemId, t)}</span>
                      <span className={s.cardMarks}>
                        {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
                        {equipped ? <Badge tone="gold">{t('inventory.equipped')}</Badge> : null}
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
