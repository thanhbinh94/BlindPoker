import { Button, Panel, Segmented, Select, type Language, type SelectOption } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { CalendarEntryDto, GiftMonthDto, GiftRuleDto, ItemDto, ItemSlot } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { DailyCalendar } from '../DailyCalendar.js'
import { formatMonthKey } from '../format.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import type { GmTabProps } from './tabProps.js'

/** The streak has thirty-one tiers in every month (spec 2026-10-12 §4.3). */
const TIERS = 31

/**
 * The slots a fixed check-in gift may name: the daily draw's four plus the colours, the title and the badge. A
 * required slot (`outfit`, `hairStyle`) cannot be taken back from a player, so the server refuses it too.
 */
const GIFT_SLOTS: readonly ItemSlot[] = ['head', 'face', 'aura', 'frame', 'hairColor', 'eyeColor', 'title', 'badge']

/** The economy's day boundary. The server is the authority (`TIER_LOCKED`); this only decides which cells to grey. */
const ECONOMY_TIME_ZONE = 'Asia/Ho_Chi_Minh'

/** The month (`YYYY-MM`) and the day of month it is now, on the economy's clock. */
export function economyToday(now: number = Date.now()): { month: string; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ECONOMY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(
    now,
  )
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return { month: `${part('year')}-${part('month')}`, day: Number(part('day')) }
}

type Rules = Record<string, GiftRuleDto>

/** What the segmented control chooses among. `default` deletes the month's own rule, so the default shows through. */
type Mode = 'default' | 'common' | 'rare' | 'fixed'

const MODES: readonly Exclude<Mode, 'default'>[] = ['common', 'rare', 'fixed']

/** The cross on a remove button, a named value rather than a literal in the markup (`react/jsx-no-literals`). */
const REMOVE_GLYPH = '×'

const isFixed = (rule: GiftRuleDto | undefined): rule is { fixed: string[] } => rule !== undefined && 'fixed' in rule

const modeOf = (rule: GiftRuleDto | undefined): Mode => (rule === undefined ? 'default' : 'fixed' in rule ? 'fixed' : rule.draw)

/** The merged rules as the calendar draws them: one row per tier, the gift marker only (the points are the players'). */
function entriesOf(rules: Rules): CalendarEntryDto[] {
  return Array.from({ length: TIERS }, (_, i) => {
    const day = i + 1
    const rule = rules[String(day)]
    if (rule === undefined) return { day, points: 0, item: null, items: [] }
    if ('fixed' in rule) return { day, points: 0, item: rule.fixed[0] ?? null, items: rule.fixed }
    return { day, points: 0, item: rule.draw, items: [] }
  })
}

/** Whether two sets of the month's own rules say the same thing. */
function sameRules(a: Rules, b: Rules): boolean {
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]))
}

type Pending = 'save' | 'reset'

interface MonthEditorProps {
  api: GmTabProps['api']
  row: GiftMonthDto
  defaults: Rules
  items: readonly ItemDto[]
  /** Called with the `gm.done.*` key once the server took the change. */
  onDone: (key: 'setGiftMonth' | 'clearGiftMonth') => void
  lang: Language
}

/**
 * One month's rules, with the edits of this visit kept in local state until Save sends them all at once.
 *
 * Remounted (by its `key` in the tab) whenever the month or its stored version changes, so a saved month starts
 * again from what the server now holds and nothing here needs a reset effect.
 */
function MonthEditor({ api, row, defaults, items, onDone, lang }: MonthEditorProps) {
  const { t } = useTranslation('normal')
  const [draft, setDraft] = useState<Rules>(row.days)
  const [picked, setPicked] = useState<number | null>(null)
  const [addId, setAddId] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)

  const merged: Rules = { ...defaults, ...draft }
  const today = economyToday()
  const lockedThrough = row.month === today.month ? today.day : 0
  const monthLabel = formatMonthKey(row.month)

  const dirty = !sameRules(draft, row.days)
  const incomplete = Object.values(draft).some((rule) => isFixed(rule) && rule.fixed.length === 0)

  const setRule = (day: number, rule: GiftRuleDto | undefined): void => {
    setDraft((prev) => {
      const next = { ...prev }
      if (rule === undefined) delete next[String(day)]
      else next[String(day)] = rule
      return next
    })
  }

  const pick = (day: number): void => {
    setPicked(day)
    setAddId('')
  }

  const chooseMode = (day: number, mode: Mode): void => {
    if (mode === 'default') return setRule(day, undefined)
    if (mode === 'fixed') {
      // Pre-filled from what the day grants now, so adding a third item to day 28 keeps the two it already has.
      const now = merged[String(day)]
      return setRule(day, { fixed: isFixed(now) ? [...now.fixed] : [] })
    }
    return setRule(day, { draw: mode })
  }

  // A fixed list may not repeat an item the month already names, so everything named anywhere is out of the picker.
  const named = new Set(Object.values(merged).flatMap((rule) => (isFixed(rule) ? rule.fixed : [])))
  const choices = items.filter((item) => GIFT_SLOTS.includes(item.slot) && !item.isDefault && item.free !== true && !named.has(item.id))
  const choiceOptions: SelectOption<string>[] = [
    { value: '', label: t('gm.gifts.pickItem') },
    ...choices.map((item) => ({ value: item.id, label: itemName(item.id, t) })),
  ]

  const confirm = async (values: ReasonValues): Promise<void> => {
    if (pending === 'reset') {
      await api.gmClearGiftMonth(row.month, values.reason)
      onDone('clearGiftMonth')
    } else {
      await api.gmSetGiftMonth(row.month, draft, values.reason)
      onDone('setGiftMonth')
    }
  }

  const rule = picked === null ? undefined : draft[String(picked)]
  const defaultRule = picked === null ? undefined : defaults[String(picked)]
  const modeOptions: { value: Mode; label: string }[] = [
    { value: 'default', label: defaultRule === undefined ? t('gm.gifts.rule.none') : t('gm.gifts.rule.default') },
    ...MODES.map((mode) => ({ value: mode, label: t(`gm.gifts.rule.${mode}`) })),
  ]
  const list = isFixed(rule) ? rule.fixed : []

  return (
    <>
      <DailyCalendar entries={entriesOf(merged)} month={row.month} showPoints={false} onPick={pick} lockedThrough={lockedThrough} lang={lang} />

      {picked === null ? null : (
        <Panel title={t('gm.gifts.editDay', { day: picked })}>
          <div className={g.stack}>
            <Segmented
              options={modeOptions}
              value={modeOf(rule)}
              onChange={(mode) => chooseMode(picked, mode)}
              label={t('gm.gifts.ruleOf', { day: picked })}
              className={g.wrapSeg}
            />
            {isFixed(rule) ? (
              <div className={g.stack}>
                <ul className={s.rows} aria-label={t('gm.gifts.items', { day: picked })}>
                  {list.map((id) => (
                    <li className={s.ledgerRow} key={id}>
                      <span className={s.rowTitle}>{itemName(id, t)}</span>
                      <Button
                        variant="ghost"
                        aria-label={[t('gm.gifts.removeItem'), itemName(id, t)].join(' ')}
                        onClick={() => setRule(picked, { fixed: list.filter((other) => other !== id) })}
                      >
                        {REMOVE_GLYPH}
                      </Button>
                    </li>
                  ))}
                </ul>
                <div className={s.choices}>
                  <Select aria-label={t('gm.gifts.pickItem')} value={addId} options={choiceOptions} onChange={(next) => setAddId(next)} />
                  <Button
                    variant="ghost"
                    disabled={addId === ''}
                    onClick={() => {
                      setRule(picked, { fixed: [...list, addId] })
                      setAddId('')
                    }}
                  >
                    {t('gm.gifts.addItem')}
                  </Button>
                </div>
                {list.length === 0 ? <p className={s.footnote}>{t('gm.gifts.needItem')}</p> : null}
              </div>
            ) : null}
          </div>
        </Panel>
      )}

      <div className={s.choices}>
        <Button variant="gold" disabled={!dirty || incomplete} onClick={() => setPending('save')}>
          {t('gm.gifts.save')}
        </Button>
        {row.source === 'db' ? (
          <Button variant="ghost" onClick={() => setPending('reset')}>
            {t('gm.gifts.reset')}
          </Button>
        ) : null}
      </div>

      <ReasonDialog
        open={pending !== null}
        title={pending === 'reset' ? t('gm.gifts.resetTitle', { month: monthLabel }) : t('gm.gifts.saveTitle', { month: monthLabel })}
        fields={{}}
        confirmLabel={pending === 'reset' ? t('gm.gifts.reset') : t('gm.gifts.save')}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </>
  )
}

/**
 * The check-in gifts of the months to come, on the calendar a player sees, editable a day at a time.
 *
 * A month's own rules replace the default's for the days they name; every other day shows the default through. So
 * the calendar is drawn from the merged rules, and "as default" simply deletes a day's own rule. A month that has
 * been edited is marked in the picker, and can be dropped back to the default whole.
 */
export function GiftsTab({ api, lang }: GmTabProps) {
  const { t } = useTranslation('normal')
  const gifts = useAsync(() => api.gmGifts())
  const catalog = useAsync(() => api.catalogItems())
  const [month, setMonth] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const data = gifts.data
  if (data === null) {
    return gifts.loading ? (
      <p className={s.footnote} role="status">
        {t('screens.loading')}
      </p>
    ) : (
      <div className={g.stack}>
        <p className={s.alert} role="alert">
          {t('gm.gifts.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={gifts.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </div>
    )
  }

  const row = data.months.find((candidate) => candidate.month === month) ?? data.months[0]
  const monthOptions = data.months.map((candidate) => ({
    value: candidate.month,
    label: candidate.source === 'db' ? [formatMonthKey(candidate.month), t('gm.gifts.edited')].join(' ') : formatMonthKey(candidate.month),
  }))

  return (
    <div className={g.stack}>
      <p className={s.footnote}>{t('gm.gifts.lead')}</p>

      {row === undefined ? null : (
        <>
          <div className={g.field}>
            <label className={s.label} htmlFor="gm-gift-month">
              {t('gm.gifts.month')}
            </label>
            <Select
              id="gm-gift-month"
              value={row.month}
              options={monthOptions}
              onChange={(next) => {
                setMonth(next)
                setDone(null)
              }}
            />
          </div>

          {done === null ? null : (
            <p className={s.footnote} role="status">
              {done}
            </p>
          )}

          <MonthEditor
            key={`${row.month}:${row.source}:${row.updatedAt ?? 0}`}
            api={api}
            row={row}
            defaults={data.default}
            items={catalog.data?.items ?? []}
            lang={lang}
            onDone={(key) => {
              setDone(t(`gm.done.${key}`))
              gifts.reload()
            }}
          />
        </>
      )}
    </div>
  )
}
