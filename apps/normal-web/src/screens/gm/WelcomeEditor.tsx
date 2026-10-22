import { Button, Panel, Select, type SelectOption } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmShopPriceRowDto, ItemSlot } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import s from '../normal.module.css'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import type { GmTabProps } from './tabProps.js'

/** The welcome gift offers exactly three (spec C1); the server refuses any other count. */
export const WELCOME_COUNT = 3

export interface WelcomeEditorProps {
  api: GmTabProps['api']
  choices: readonly string[]
  slots: readonly ItemSlot[]
  rows: readonly GmShopPriceRowDto[]
  onDone: (message: string) => void
}

/**
 * Block "Quà chào mừng": the three items a new player picks one of. Each picker offers what sells now from the
 * wearable slots, plus whatever the slot holds today (so a choice that has since become a gift still reads, and can be
 * replaced). Save needs three different items.
 */
export function WelcomeEditor({ api, choices, slots, rows, onDone }: WelcomeEditorProps) {
  const { t } = useTranslation('normal')
  const [draft, setDraft] = useState<string[]>(() => Array.from({ length: WELCOME_COUNT }, (_, i) => choices[i] ?? ''))
  const [saving, setSaving] = useState(false)

  const eligible = rows.filter((row) => row.lock === null && slots.includes(row.slot)).map((row) => row.itemId)
  const complete = draft.every((id) => id !== '') && new Set(draft).size === WELCOME_COUNT
  const dirty = draft.join(',') !== choices.join(',')

  const optionsFor = (current: string): SelectOption<string>[] => {
    const ids = eligible.includes(current) || current === '' ? eligible : [current, ...eligible]
    return [{ value: '', label: t('gm.shop.welcome.pick') }, ...ids.map((id) => ({ value: id, label: itemName(id, t) }))]
  }

  const confirm = async (values: ReasonValues): Promise<void> => {
    await api.gmSetWelcomeChoices(draft, values.reason)
    onDone(t('gm.done.welcome'))
  }

  return (
    <Panel title={t('gm.shop.welcome.title')}>
      <div className={g.stack}>
        <p className={s.footnote}>{t('gm.shop.welcome.lead')}</p>
        <div className={g.welcomeGrid}>
          {draft.map((id, i) => (
            <div className={g.field} key={i}>
              <label className={s.label} htmlFor={`gm-welcome-${String(i)}`}>
                {t('gm.shop.welcome.choice', { n: i + 1 })}
              </label>
              <Select
                id={`gm-welcome-${String(i)}`}
                value={id}
                options={optionsFor(id)}
                onChange={(next) => setDraft((prev) => prev.map((old, j) => (j === i ? next : old)))}
              />
            </div>
          ))}
        </div>
        {complete ? null : <p className={s.footnote}>{t('gm.shop.welcome.needThree')}</p>}
        <div className={s.choices}>
          <Button variant="gold" disabled={!complete || !dirty} onClick={() => setSaving(true)}>
            {t('gm.shop.welcome.save')}
          </Button>
        </div>
      </div>
      <ReasonDialog
        open={saving}
        title={t('gm.shop.welcome.saveTitle')}
        fields={{}}
        confirmLabel={t('gm.shop.welcome.save')}
        onConfirm={confirm}
        onClose={() => setSaving(false)}
      />
    </Panel>
  )
}
