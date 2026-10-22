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

/** The server's caps (`gm-service.ts`: `REPUTATION_RULE_MAX`, `RANK_THRESHOLD_MAX`), checked here so the box says so first. */
const RULE_MAX = 100_000
const THRESHOLD_MAX = 1_000_000_000

/** A whole number from 0 to `max`, else `null`. */
function parseWhole(text: string, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value <= max ? value : null
}

/** The ladder's own rule, as the server judges it: rank 1 at 0, each threshold above the one before. */
function ladderRises(thresholds: readonly number[]): boolean {
  return thresholds[0] === 0 && thresholds.every((value, i) => i === 0 || value > thresholds[i - 1]!)
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
 * The form checks each box (a whole number up to the server's cap) and the ladder's order (rank 1 at 0, strictly
 * rising) before any dialog opens; the server judges both again, and its refusal is printed in the dialog, in words.
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
    const value = parseWhole(ruleText[key] ?? '', RULE_MAX)
    if (value === null) rulesInvalid = true
    else if (value !== rules[key]) changedRules[key] = value
  }
  const ladder = ranks.map((r, i) => ({ rank: r.rank, threshold: parseWhole(rankText[i] ?? '', THRESHOLD_MAX) }))
  const ranksInvalid = ladder.some((r) => r.threshold === null)
  const ranksDirty = ladder.some((r, i) => r.threshold !== ranks[i]?.threshold)
  const ladderBroken = !ranksInvalid && !ladderRises(ladder.map((r) => r.threshold ?? 0))

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
                      aria-invalid={parseWhole(ruleText[key] ?? '', RULE_MAX) === null ? true : undefined}
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
            {t('gm.reputation.invalidRules')}
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
        {/* The ladder's rule: a note while it holds, the alert the moment an edit breaks it. */}
        <p className={ladderBroken ? s.alert : s.footnote} role={ladderBroken ? 'alert' : undefined}>
          {t('gm.reputation.ranksNote')}
        </p>
        {ranksInvalid ? (
          <p className={s.alert} role="alert">
            {t('gm.reputation.invalidRanks')}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={ranksInvalid || ladderBroken || !ranksDirty} onClick={() => setPending('ranks')}>
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
