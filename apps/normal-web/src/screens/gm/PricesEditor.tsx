import { Button, Panel, Select, type SelectOption } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmPriceChangeDto, GmShopPriceRowDto, ItemSlot, Rarity } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import s from '../normal.module.css'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import { lockLabel, rankName } from './shopLabels.js'
import type { GmTabProps } from './tabProps.js'

/** The server's own bound on a price (`shop-service.ts`, `PRICE_MAX`). */
const PRICE_MAX = 1_000_000_000
const RANKS = [1, 2, 3, 4, 5] as const
const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic']
const SLOTS: readonly ItemSlot[] = ['outfit', 'head', 'face', 'aura', 'frame', 'hairStyle', 'hairColor', 'eyeColor', 'skinColor', 'title', 'badge']

interface Draft {
  /** The price as typed; `''` on an unpriced row leaves the rarity's seed to the server. */
  price: string
  minRank: number
  enabled: boolean
}

const draftOf = (row: GmShopPriceRowDto): Draft => ({ price: row.priced ? String(row.pricePoints) : '', minRank: row.minRank, enabled: row.enabled })

/** The typed price as a number, `null` for anything the server would refuse, `undefined` for an empty box. */
function parsePrice(text: string): number | null | undefined {
  const trimmed = text.trim()
  if (trimmed === '') return undefined
  if (!/^\d+$/u.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value <= PRICE_MAX ? value : null
}

/** One row's edit as the server wants it — only the fields that differ — or `null` when nothing does. */
function changeOf(row: GmShopPriceRowDto, draft: Draft): GmPriceChangeDto | null {
  const change: GmPriceChangeDto = { itemId: row.itemId }
  const price = parsePrice(draft.price)
  if (typeof price === 'number' && (!row.priced || price !== row.pricePoints)) change.pricePoints = price
  if (draft.minRank !== row.minRank) change.minRank = draft.minRank
  if (draft.enabled !== row.enabled) change.enabled = draft.enabled
  return Object.keys(change).length > 1 ? change : null
}

export interface PricesEditorProps {
  api: GmTabProps['api']
  rows: readonly GmShopPriceRowDto[]
  onDone: (message: string) => void
}

/**
 * Block "Giá": every catalogue item with its price, minimum rank and on/off switch, filtered by slot and rarity, the
 * unpriced ones first. Edits stay local until one Save sends the changed rows only — and only their changed fields —
 * with one reason. The status column is the shop's own verdict, so a GM sees that switching on an achievement's item
 * still does not sell it.
 */
export function PricesEditor({ api, rows, onDone }: PricesEditorProps) {
  const { t } = useTranslation('normal')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(rows.map((row) => [row.itemId, draftOf(row)])))
  const [slot, setSlot] = useState<ItemSlot | 'all'>('all')
  const [rarity, setRarity] = useState<Rarity | 'all'>('all')
  const [saving, setSaving] = useState(false)

  const draftFor = (row: GmShopPriceRowDto): Draft => drafts[row.itemId] ?? draftOf(row)
  const edit = (itemId: string, patch: Partial<Draft>): void => {
    setDrafts((prev) => {
      const row = rows.find((r) => r.itemId === itemId)
      if (row === undefined) return prev
      return { ...prev, [itemId]: { ...(prev[itemId] ?? draftOf(row)), ...patch } }
    })
  }

  const changes = rows.flatMap((row) => {
    const change = changeOf(row, draftFor(row))
    return change === null ? [] : [change]
  })
  const invalid = rows.some((row) => parsePrice(draftFor(row).price) === null)

  // "Chưa định giá" first, then the catalogue's order.
  const shown = [...rows]
    .filter((row) => (slot === 'all' || row.slot === slot) && (rarity === 'all' || row.rarity === rarity))
    .sort((a, b) => Number(a.priced) - Number(b.priced))

  const slotOptions: SelectOption<ItemSlot | 'all'>[] = [
    { value: 'all', label: t('gm.shop.prices.all') },
    ...SLOTS.map((value) => ({ value, label: t(`gm.shop.slot.${value}`) })),
  ]
  const rarityOptions: SelectOption<Rarity | 'all'>[] = [
    { value: 'all', label: t('gm.shop.prices.all') },
    ...RARITIES.map((value) => ({ value, label: t(`inventory.rarity.${value}`) })),
  ]
  const rankOptions: SelectOption<number>[] = RANKS.map((n) => ({ value: n, label: t('gm.shop.prices.rankOption', { n, rank: rankName(n, t) }) }))

  const confirm = async (values: ReasonValues): Promise<void> => {
    const result = await api.gmSetShopPrices(changes, values.reason)
    onDone(t('gm.done.shopPrices', { count: result.changed }))
  }

  return (
    <Panel title={t('gm.shop.prices.title')}>
      <div className={g.stack}>
        <div className={g.filterForm}>
          <div className={g.field}>
            <label className={s.label} htmlFor="gm-price-slot">
              {t('gm.shop.prices.filterSlot')}
            </label>
            <Select id="gm-price-slot" value={slot} options={slotOptions} onChange={(next) => setSlot(next)} />
          </div>
          <div className={g.field}>
            <label className={s.label} htmlFor="gm-price-rarity">
              {t('gm.shop.prices.filterRarity')}
            </label>
            <Select id="gm-price-rarity" value={rarity} options={rarityOptions} onChange={(next) => setRarity(next)} />
          </div>
        </div>
        <p className={s.footnote}>{t('gm.shop.prices.achievementNote')}</p>

        {shown.length === 0 ? (
          <p className={s.footnote}>{t('gm.shop.prices.empty')}</p>
        ) : (
          <div className={`${g.tableWrap} ${g.priceScroll}`}>
            <table className={`${g.table} ${g.cards}`} aria-label={t('gm.shop.prices.title')}>
              <thead>
                <tr>
                  <th scope="col">{t('gm.shop.prices.colItem')}</th>
                  <th scope="col">{t('gm.shop.prices.colLock')}</th>
                  <th scope="col">{t('gm.shop.prices.colPrice')}</th>
                  <th scope="col">{t('gm.shop.prices.colRank')}</th>
                  <th scope="col">{t('gm.shop.prices.colEnabled')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const draft = draftFor(row)
                  const name = itemName(row.itemId, t)
                  const bad = parsePrice(draft.price) === null
                  return (
                    <tr key={row.itemId}>
                      <td>
                        <span className={g.value}>
                          <span className={g.rowName}>{name}</span>
                          <span className={g.sub}>{[t(`gm.shop.slot.${row.slot}`), t(`inventory.rarity.${row.rarity}`)].join(' · ')}</span>
                        </span>
                      </td>
                      <td data-label={t('gm.shop.prices.colLock')}>{lockLabel(row.lock, t)}</td>
                      <td data-label={t('gm.shop.prices.colPrice')}>
                        <input
                          className={`${s.input} ${g.numInput}`}
                          type="text"
                          inputMode="numeric"
                          autoComplete="off"
                          aria-label={t('gm.shop.prices.priceOf', { item: name })}
                          aria-invalid={bad ? true : undefined}
                          placeholder={row.priced ? undefined : t('gm.shop.prices.unpriced')}
                          value={draft.price}
                          onChange={(event) => edit(row.itemId, { price: event.target.value })}
                        />
                      </td>
                      <td className={g.rankCell} data-label={t('gm.shop.prices.colRank')}>
                        <Select
                          aria-label={t('gm.shop.prices.rankOf', { item: name })}
                          value={draft.minRank}
                          options={rankOptions}
                          onChange={(minRank) => edit(row.itemId, { minRank })}
                        />
                      </td>
                      <td data-label={t('gm.shop.prices.colEnabled')}>
                        <input
                          className={g.check}
                          type="checkbox"
                          aria-label={t('gm.shop.prices.enabledOf', { item: name })}
                          checked={draft.enabled}
                          onChange={(event) => edit(row.itemId, { enabled: event.target.checked })}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {invalid ? (
          <p className={s.alert} role="alert">
            {t('gm.shop.prices.invalid')}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={changes.length === 0 || invalid} onClick={() => setSaving(true)}>
            {t('gm.shop.prices.save')}
          </Button>
          {changes.length === 0 ? null : <span className={s.footnote}>{t('gm.shop.prices.changed', { count: changes.length })}</span>}
        </div>
      </div>

      <ReasonDialog
        open={saving}
        title={t('gm.shop.prices.saveTitle', { count: changes.length })}
        fields={{}}
        confirmLabel={t('gm.shop.prices.save')}
        onConfirm={confirm}
        onClose={() => setSaving(false)}
      />
    </Panel>
  )
}
