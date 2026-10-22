import { Button, Panel, Select, type SelectOption } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmShopConfigDto, GmShopPriceRowDto } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import s from '../normal.module.css'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import { weekLabel } from './shopLabels.js'
import type { GmTabProps } from './tabProps.js'

/** The shelf's size (spec B3): the server refuses a seventh too. */
export const FEATURED_MAX = 6

/** The cross on a remove button, a named value rather than a literal in the markup (`react/jsx-no-literals`). */
const REMOVE_GLYPH = '×'

type Week = GmShopConfigDto['featured'][number]

export interface FeaturedEditorProps {
  api: GmTabProps['api']
  weeks: readonly Week[]
  rows: readonly GmShopPriceRowDto[]
  onDone: (message: string) => void
}

/**
 * Block "Kệ tuần này": this week and the eight after it. A week the GM has arranged shows its shelf; one left to the
 * rotation shows what the rotation puts there, and adding an item starts the GM's own list. At most six items, picked
 * from what sells now (the server judges each week as of its Monday and has the last word).
 */
export function FeaturedEditor({ api, weeks, rows, onDone }: FeaturedEditorProps) {
  const { t } = useTranslation('normal')
  const [weekKey, setWeekKey] = useState(weeks[0]?.weekKey ?? '')
  const week = weeks.find((w) => w.weekKey === weekKey) ?? weeks[0]
  if (week === undefined) return null

  const weekOptions: SelectOption<string>[] = weeks.map((w, i) => ({
    value: w.weekKey,
    label: [weekLabel(w.weekKey, t), i === 0 ? t('gm.shop.featured.current') : '', w.source === 'gm' ? t('gm.shop.featured.edited') : '']
      .filter((part) => part !== '')
      .join(' '),
  }))

  return (
    <Panel title={t('gm.shop.featured.title')}>
      <div className={g.stack}>
        <div className={g.field}>
          <label className={s.label} htmlFor="gm-featured-week">
            {t('gm.shop.featured.week')}
          </label>
          <Select id="gm-featured-week" value={week.weekKey} options={weekOptions} onChange={(next) => setWeekKey(next)} />
        </div>
        <WeekShelf key={`${week.weekKey}:${week.source}:${week.itemIds.join(',')}`} api={api} week={week} rows={rows} onDone={onDone} />
      </div>
    </Panel>
  )
}

type Pending = 'save' | 'clear'

function WeekShelf({ api, week, rows, onDone }: { api: GmTabProps['api']; week: Week; rows: readonly GmShopPriceRowDto[]; onDone: (message: string) => void }) {
  const { t } = useTranslation('normal')
  const stored = week.source === 'gm' ? week.itemIds : []
  const [draft, setDraft] = useState<string[]>(stored)
  const [addId, setAddId] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

  const full = draft.length >= FEATURED_MAX
  const dirty = draft.join(',') !== stored.join(',')
  const choices = rows.filter((row) => row.lock === null && !draft.includes(row.itemId))
  const choiceOptions: SelectOption<string>[] = [
    { value: '', label: t('gm.shop.featured.pick') },
    ...choices.map((row) => ({ value: row.itemId, label: itemName(row.itemId, t) })),
  ]
  const label = weekLabel(week.weekKey, t)

  const add = (): void => {
    if (addId === '' || full) return
    setDraft((prev) => (prev.length >= FEATURED_MAX || prev.includes(addId) ? prev : [...prev, addId]))
    setAddId('')
  }

  const confirm = async (values: ReasonValues): Promise<void> => {
    await api.gmSetShopFeatured(week.weekKey, pending === 'clear' ? [] : draft, values.reason)
    onDone(t('gm.done.shopFeatured'))
  }

  return (
    <div className={g.stack}>
      {draft.length === 0 && week.source === 'auto' ? (
        <>
          <p className={s.footnote}>{t('gm.shop.featured.auto')}</p>
          <ul className={s.rows} aria-label={t('gm.shop.featured.items')}>
            {week.itemIds.map((id) => (
              <li className={s.ledgerRow} key={id}>
                <span className={s.rowTitle}>{itemName(id, t)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className={s.footnote}>{t('gm.shop.featured.picked', { count: draft.length })}</p>
          <ul className={s.rows} aria-label={t('gm.shop.featured.items')}>
            {draft.map((id) => (
              <li className={s.ledgerRow} key={id}>
                <span className={s.rowTitle}>{itemName(id, t)}</span>
                <Button
                  variant="ghost"
                  aria-label={[t('gm.shop.featured.remove'), itemName(id, t)].join(' ')}
                  onClick={() => setDraft((prev) => prev.filter((other) => other !== id))}
                >
                  {REMOVE_GLYPH}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className={s.choices}>
        <Select aria-label={t('gm.shop.featured.pick')} value={addId} options={choiceOptions} disabled={full} onChange={(next) => setAddId(next)} />
        <Button variant="ghost" disabled={addId === '' || full} onClick={add}>
          {t('gm.shop.featured.add')}
        </Button>
      </div>
      {full ? <p className={s.footnote}>{t('gm.shop.featured.full')}</p> : null}

      <div className={s.choices}>
        <Button variant="gold" disabled={!dirty || draft.length === 0} onClick={() => setPending('save')}>
          {t('gm.shop.featured.save')}
        </Button>
        {week.source === 'gm' ? (
          <Button variant="ghost" onClick={() => setPending('clear')}>
            {t('gm.shop.featured.clear')}
          </Button>
        ) : null}
      </div>

      <ReasonDialog
        open={pending !== null}
        title={pending === 'clear' ? t('gm.shop.featured.clearTitle', { week: label }) : t('gm.shop.featured.saveTitle', { week: label })}
        fields={{}}
        confirmLabel={pending === 'clear' ? t('gm.shop.featured.clear') : t('gm.shop.featured.save')}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </div>
  )
}
