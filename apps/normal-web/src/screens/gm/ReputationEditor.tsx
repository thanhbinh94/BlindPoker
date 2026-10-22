import { Button, Panel } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RankThresholdDto } from '../../api.js'
import s from '../normal.module.css'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import { rankName } from './shopLabels.js'
import type { GmTabProps } from './tabProps.js'

/** The eight sources in the order of the spec's table (A2); a key the server adds later is listed after them. */
const RULE_ORDER = ['hand_played', 'hand_won', 'daily_login', 'achievement_small', 'achievement_big', 'achievement_item', 'welcome', 'newcomer_day7']

/** A whole number of 0 or more, else `null`. */
function parseWhole(text: string): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) ? value : null
}

export interface ReputationEditorProps {
  api: GmTabProps['api']
  rules: Record<string, number>
  ranks: readonly RankThresholdDto[]
  onDone: (message: string) => void
}

type Pending = 'rules' | 'ranks'

/**
 * Block "Danh vọng": what each source pays and where each rank starts, each table saved on its own with a reason.
 * The form only checks that each box is a whole number; the ladder's order is the server's to judge (rank 1 at 0,
 * strictly rising), and its refusal is printed in the dialog, in words.
 */
export function ReputationEditor({ api, rules, ranks, onDone }: ReputationEditorProps) {
  const { t } = useTranslation('normal')
  const keys = [...RULE_ORDER.filter((key) => key in rules), ...Object.keys(rules).filter((key) => !RULE_ORDER.includes(key))]
  const [ruleText, setRuleText] = useState<Record<string, string>>(() => Object.fromEntries(keys.map((key) => [key, String(rules[key] ?? 0)])))
  const [rankText, setRankText] = useState<string[]>(() => ranks.map((r) => String(r.threshold)))
  const [pending, setPending] = useState<Pending | null>(null)

  const changedRules: Record<string, number> = {}
  let rulesInvalid = false
  for (const key of keys) {
    const value = parseWhole(ruleText[key] ?? '')
    if (value === null) rulesInvalid = true
    else if (value !== rules[key]) changedRules[key] = value
  }
  const ladder = ranks.map((r, i) => ({ rank: r.rank, threshold: parseWhole(rankText[i] ?? '') }))
  const ranksInvalid = ladder.some((r) => r.threshold === null)
  const ranksDirty = ladder.some((r, i) => r.threshold !== ranks[i]?.threshold)

  const ruleLabel = (key: string): string => t(`gm.reputation.rule.${key}`, { defaultValue: key })

  const confirm = async (values: ReasonValues): Promise<void> => {
    if (pending === 'rules') {
      await api.gmSetReputationRules(changedRules, values.reason)
      onDone(t('gm.done.reputationRules'))
    } else {
      await api.gmSetReputationRanks(ladder.map((r) => ({ rank: r.rank, threshold: r.threshold ?? 0 })), values.reason)
      onDone(t('gm.done.reputationRanks'))
    }
  }

  return (
    <Panel title={t('gm.reputation.title')}>
      <div className={g.stack}>
        <div className={g.tableWrap}>
          <table className={g.table} aria-label={t('gm.reputation.rulesTitle')}>
            <thead>
              <tr>
                <th scope="col">{t('gm.reputation.colSource')}</th>
                <th scope="col" className={g.num}>
                  {t('gm.reputation.colAmount')}
                </th>
              </tr>
            </thead>
            <tbody>
              {keys.map((key) => (
                <tr key={key}>
                  <td>{ruleLabel(key)}</td>
                  <td className={g.num}>
                    <input
                      className={`${s.input} ${g.numInput}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={t('gm.reputation.amountOf', { rule: ruleLabel(key) })}
                      aria-invalid={parseWhole(ruleText[key] ?? '') === null ? true : undefined}
                      value={ruleText[key] ?? ''}
                      onChange={(event) => setRuleText((prev) => ({ ...prev, [key]: event.target.value }))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rulesInvalid ? (
          <p className={s.alert} role="alert">
            {t('gm.reputation.invalid')}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={rulesInvalid || Object.keys(changedRules).length === 0} onClick={() => setPending('rules')}>
            {t('gm.reputation.saveRules')}
          </Button>
        </div>

        <div className={g.tableWrap}>
          <table className={g.table} aria-label={t('gm.reputation.ranksTitle')}>
            <thead>
              <tr>
                <th scope="col">{t('gm.reputation.colRank')}</th>
                <th scope="col" className={g.num}>
                  {t('gm.reputation.colThreshold')}
                </th>
              </tr>
            </thead>
            <tbody>
              {ranks.map((r, i) => (
                <tr key={r.rank}>
                  <td>{rankName(r.rank, t)}</td>
                  <td className={g.num}>
                    <input
                      className={`${s.input} ${g.numInput}`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      aria-label={t('gm.reputation.thresholdOf', { rank: rankName(r.rank, t) })}
                      aria-invalid={ladder[i]?.threshold === null ? true : undefined}
                      value={rankText[i] ?? ''}
                      onChange={(event) => setRankText((prev) => prev.map((old, j) => (j === i ? event.target.value : old)))}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={s.footnote}>{t('gm.reputation.ranksNote')}</p>
        {ranksInvalid ? (
          <p className={s.alert} role="alert">
            {t('gm.reputation.invalid')}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={ranksInvalid || !ranksDirty} onClick={() => setPending('ranks')}>
            {t('gm.reputation.saveRanks')}
          </Button>
        </div>
      </div>

      <ReasonDialog
        open={pending !== null}
        title={pending === 'ranks' ? t('gm.reputation.ranksDialog') : t('gm.reputation.rulesDialog')}
        fields={{}}
        confirmLabel={pending === 'ranks' ? t('gm.reputation.saveRanks') : t('gm.reputation.saveRules')}
        onConfirm={confirm}
        onClose={() => setPending(null)}
      />
    </Panel>
  )
}
