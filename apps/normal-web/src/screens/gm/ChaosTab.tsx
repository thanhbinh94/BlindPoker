import { Button, Panel } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ChaosConfigDto, ChaosTierDto, GmChaosCardDto, GmChaosRuleChangeDto } from '../../api.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import type { GmTabProps } from './tabProps.js'

const TIERS: readonly ChaosTierDto[] = ['silver', 'gold', 'diamond']

/** The economy's zone: UTC+7 all year (Ho Chi Minh has no summer time), as `GiftsTab` assumes. The server judges the day. */
const ECONOMY_TIME_ZONE = 'Asia/Ho_Chi_Minh'
const ECONOMY_OFFSET = '+07:00'
const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DD` of the economy day that holds `at`. */
export function economyDayOf(at: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: ECONOMY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** The first instant of the economy day `key` (`YYYY-MM-DD`), in epoch ms. */
export function dayStartOf(key: string): number {
  return Date.parse(`${key}T00:00:00${ECONOMY_OFFSET}`)
}

/** A whole number from 0 to `max`, else `null`. */
function parseWhole(text: string, max: number): number | null {
  const trimmed = text.trim()
  if (!/^\d+$/u.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isSafeInteger(value) && value <= max ? value : null
}

const WEIGHT_MAX = 100

/** What a card row holds while it is being edited. Dates are economy days as the date input writes them. */
interface Draft {
  enabled: boolean
  weight: string
  from: string
  to: string
  /** "Theo file" was pressed: the row shows the file's values and saving sends `clear: true` (until the next edit). */
  cleared: boolean
}

/** The file's own state of a card: what applies with no rule. */
const fileDraft = (card: GmChaosCardDto): Draft => ({ enabled: card.fileEnabled, weight: '1', from: '', to: '', cleared: false })

/** The card as the server has it. The window's last day is the day before `endsAt`, which is the start of the next one. */
function draftOf(card: GmChaosCardDto): Draft {
  const rule = card.rule
  if (rule === null) return fileDraft(card)
  return {
    enabled: rule.enabled,
    weight: String(rule.weight),
    from: rule.startsAt === null ? '' : economyDayOf(rule.startsAt),
    to: rule.endsAt === null ? '' : economyDayOf(rule.endsAt - 1),
    cleared: false,
  }
}

/**
 * A date box is fine when empty (open) or a real `YYYY-MM-DD` day. A date input also takes a five-digit year
 * (`20266-11-01`), which `Date.parse` turns into NaN and JSON into `null`: an open window the GM never asked for.
 */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u
const dayOk = (key: string): boolean => key === '' || (DAY_KEY.test(key) && Number.isFinite(dayStartOf(key)))

/** The window ends before it starts, by the numeric day starts (only judged when both ends are real days). */
const windowBroken = (draft: Draft): boolean => draft.from !== '' && draft.to !== '' && dayOk(draft.from) && dayOk(draft.to) && dayStartOf(draft.to) < dayStartOf(draft.from)
const isValid = (draft: Draft): boolean => parseWhole(draft.weight, WEIGHT_MAX) !== null && dayOk(draft.from) && dayOk(draft.to) && !windowBroken(draft)

/**
 * One card's edit as the server wants it, or `null` when nothing differs. A window end that was not touched keeps the
 * server's own instant, so changing a weight never moves a window a GM set some other way.
 */
function changeOf(card: GmChaosCardDto, draft: Draft): GmChaosRuleChangeDto | null {
  if (draft.cleared) return card.rule === null ? null : { cardId: card.id, clear: true }
  const was = draftOf(card)
  if (draft.enabled === was.enabled && draft.weight === was.weight && draft.from === was.from && draft.to === was.to) return null
  const weight = parseWhole(draft.weight, WEIGHT_MAX)
  // A date that is no real day never becomes a time: `NaN` would reach the server as `null`, an open end nobody chose.
  if (weight === null || !dayOk(draft.from) || !dayOk(draft.to)) return null
  const startsAt = draft.from === was.from ? (card.rule?.startsAt ?? null) : draft.from === '' ? null : dayStartOf(draft.from)
  const endsAt = draft.to === was.to ? (card.rule?.endsAt ?? null) : draft.to === '' ? null : dayStartOf(draft.to) + DAY_MS
  return { cardId: card.id, enabled: draft.enabled, weight, startsAt, endsAt }
}

/**
 * The Thẻ hỗn loạn tab (Plan 37, spec §6): every card of the catalogue in its tier, then the chaos numbers.
 * Cards and numbers are saved apart, each with a reason; once the server takes one, the tab is read again and a line
 * says what happened. Each editor is keyed on the part of the reply it edits, so a reload that changed it starts it
 * afresh from the server's values and one that did not leaves the other's unsaved edits alone.
 */
export function ChaosTab({ api }: GmTabProps) {
  const { t } = useTranslation('normal')
  const chaos = useAsync(() => api.gmChaos())
  const [done, setDone] = useState<string | null>(null)

  const data = chaos.data
  if (data === null) {
    return chaos.loading ? (
      <p className={s.footnote} role="status">
        {t('screens.loading')}
      </p>
    ) : (
      <div className={g.stack}>
        <p className={s.alert} role="alert">
          {t('gm.chaos.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={chaos.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </div>
    )
  }

  const onDone = (message: string): void => {
    setDone(message)
    chaos.reload()
  }

  return (
    <div className={g.stack}>
      <p className={s.footnote}>{t('gm.chaos.lead')}</p>
      {/* Always in the page, so a screen reader has the region before its text arrives. */}
      <div role="status">{done === null ? null : <p className={s.notice}>{done}</p>}</div>

      <CardsEditor
        key={JSON.stringify(data.cards.map((c) => [c.id, c.fileEnabled, c.rule, c.activeNow]))}
        api={api}
        cards={data.cards}
        onDone={onDone}
      />
      <ConfigEditor key={JSON.stringify(data.config)} api={api} config={data.config} onDone={onDone} />
    </div>
  )
}

interface CardsEditorProps {
  api: GmTabProps['api']
  cards: readonly GmChaosCardDto[]
  onDone: (message: string) => void
}

function CardsEditor({ api, cards, onDone }: CardsEditorProps) {
  const { t } = useTranslation('normal')
  const { t: tg } = useTranslation('game')
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(cards.map((card) => [card.id, draftOf(card)])))
  const [saving, setSaving] = useState(false)

  const draftFor = (card: GmChaosCardDto): Draft => drafts[card.id] ?? draftOf(card)
  const edit = (card: GmChaosCardDto, patch: Partial<Draft>): void => {
    setDrafts((prev) => ({ ...prev, [card.id]: { ...(prev[card.id] ?? draftOf(card)), ...patch, cleared: false } }))
  }
  const reset = (card: GmChaosCardDto): void => {
    setDrafts((prev) => ({ ...prev, [card.id]: { ...fileDraft(card), cleared: true } }))
  }

  const nameOf = (card: GmChaosCardDto): string => tg(`chaos.cards.${card.id}.name`, { defaultValue: card.id })
  const changes = cards.flatMap((card) => {
    const change = changeOf(card, draftFor(card))
    return change === null ? [] : [change]
  })
  // Every card is judged, whatever the screen shows: the alert names the bad ones.
  const invalidNames = cards.filter((card) => !isValid(draftFor(card))).map(nameOf)
  const invalid = invalidNames.length > 0

  const confirm = async (values: ReasonValues): Promise<void> => {
    const result = await api.gmSetChaosRules(changes, values.reason)
    onDone(t('gm.done.chaosRules', { count: result.changed }))
  }

  return (
    <div className={g.stack}>
      {TIERS.map((tier) => {
        const rows = cards.filter((card) => card.tier === tier)
        const title = t('gm.chaos.tierTitle', { tier: tg(`chaos.tier.${tier}`), on: rows.filter((card) => card.activeNow).length, total: rows.length })
        return (
          <Panel key={tier} title={title}>
            <div className={g.tableWrap}>
              <table className={`${g.table} ${g.cards} ${g.chaosTable}`} aria-label={title}>
                <thead>
                  <tr>
                    <th scope="col">{t('gm.chaos.colCard')}</th>
                    <th scope="col">{t('gm.chaos.colEnabled')}</th>
                    <th scope="col">{t('gm.chaos.colWeight')}</th>
                    <th scope="col">{t('gm.chaos.colFrom')}</th>
                    <th scope="col">{t('gm.chaos.colTo')}</th>
                    <th scope="col">{t('gm.chaos.colReset')}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((card) => {
                    const draft = draftFor(card)
                    const name = nameOf(card)
                    return (
                      <tr key={card.id}>
                        <td>
                          <span className={g.value}>
                            <span className={g.rowName}>{name}</span>
                            <span className={g.sub}>
                              {[t(`gm.chaos.family.${card.family}`, { defaultValue: card.family }), card.activeNow ? t('gm.chaos.stateOn') : t('gm.chaos.stateOff')].join(' · ')}
                            </span>
                          </span>
                        </td>
                        <td data-label={t('gm.chaos.colEnabled')}>
                          <input
                            className={g.check}
                            type="checkbox"
                            aria-label={t('gm.chaos.enabledOf', { card: name })}
                            checked={draft.enabled}
                            onChange={(event) => edit(card, { enabled: event.target.checked })}
                          />
                        </td>
                        <td data-label={t('gm.chaos.colWeight')}>
                          <input
                            className={`${s.input} ${g.numInput} ${g.weightInput}`}
                            type="text"
                            inputMode="numeric"
                            autoComplete="off"
                            aria-label={t('gm.chaos.weightOf', { card: name })}
                            aria-invalid={parseWhole(draft.weight, WEIGHT_MAX) === null ? true : undefined}
                            value={draft.weight}
                            onChange={(event) => edit(card, { weight: event.target.value })}
                          />
                        </td>
                        <td data-label={t('gm.chaos.colFrom')}>
                          <input
                            className={`${s.input} ${g.dateInput}`}
                            type="date"
                            aria-label={t('gm.chaos.fromOf', { card: name })}
                            aria-invalid={!dayOk(draft.from) || windowBroken(draft) ? true : undefined}
                            value={draft.from}
                            onChange={(event) => edit(card, { from: event.target.value })}
                          />
                        </td>
                        <td data-label={t('gm.chaos.colTo')}>
                          <input
                            className={`${s.input} ${g.dateInput}`}
                            type="date"
                            aria-label={t('gm.chaos.toOf', { card: name })}
                            aria-invalid={!dayOk(draft.to) || windowBroken(draft) ? true : undefined}
                            value={draft.to}
                            onChange={(event) => edit(card, { to: event.target.value })}
                          />
                        </td>
                        <td>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('gm.chaos.resetOf', { card: name })}
                            disabled={card.rule === null || draft.cleared}
                            onClick={() => reset(card)}
                          >
                            {t('gm.chaos.reset')}
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
        )
      })}

      <div className={g.saveBar}>
        {invalid ? (
          <p className={s.alert} role="alert">
            {t('gm.chaos.invalid')} {t('gm.chaos.invalidCards', { cards: invalidNames.join(', ') })}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={changes.length === 0 || invalid} onClick={() => setSaving(true)}>
            {t('gm.chaos.save')}
          </Button>
          {changes.length === 0 ? null : <span className={s.footnote}>{t('gm.chaos.changed', { count: changes.length })}</span>}
        </div>
      </div>

      <ReasonDialog
        open={saving}
        title={t('gm.chaos.saveTitle', { count: changes.length })}
        fields={{}}
        confirmLabel={t('gm.chaos.save')}
        onConfirm={confirm}
        onClose={() => setSaving(false)}
      />
    </div>
  )
}

/** The server's bounds (`chaos-service.ts`, `LIMITS`), checked here so the box says so first. */
const POINTS_THRESHOLD: readonly [number, number] = [1, 100]
const DRAFT_SECONDS: readonly [number, number] = [5, 60]
const RESULT_SECONDS: readonly [number, number] = [5, 15]
const DAILY_CAP: readonly [number, number] = [0, 10_000_000]
const DAILY_RESCUES: readonly [number, number] = [0, 20]

interface ConfigText {
  silver: string
  gold: string
  diamond: string
  pointsThreshold: string
  draftSeconds: string
  resultSeconds: string
  dailyCapPoints: string
  dailyRescues: string
}

const textOf = (config: ChaosConfigDto): ConfigText => ({
  silver: String(config.tierWeights.silver),
  gold: String(config.tierWeights.gold),
  diamond: String(config.tierWeights.diamond),
  pointsThreshold: String(config.pointsThreshold),
  draftSeconds: String(config.draftMs / 1000),
  resultSeconds: String(config.resultMs / 1000),
  dailyCapPoints: String(config.dailyCapPoints),
  dailyRescues: String(config.dailyRescues),
})

/** The boxes as a config, or `null` while any box is not a whole number in its range or no tier can be drawn. */
function configOf(text: ConfigText, was: ChaosConfigDto): ChaosConfigDto | null {
  const within = (value: string, [min, max]: readonly [number, number]): number | null => {
    const n = parseWhole(value, max)
    return n !== null && n >= min ? n : null
  }
  const silver = parseWhole(text.silver, Number.MAX_SAFE_INTEGER)
  const gold = parseWhole(text.gold, Number.MAX_SAFE_INTEGER)
  const diamond = parseWhole(text.diamond, Number.MAX_SAFE_INTEGER)
  const pointsThreshold = within(text.pointsThreshold, POINTS_THRESHOLD)
  const seconds = within(text.draftSeconds, DRAFT_SECONDS)
  const resultSeconds = within(text.resultSeconds, RESULT_SECONDS)
  const dailyCapPoints = within(text.dailyCapPoints, DAILY_CAP)
  const dailyRescues = within(text.dailyRescues, DAILY_RESCUES)
  // A draft time the server holds in odd milliseconds shows as "7.5": left alone, it is kept as it is.
  const draftMs = text.draftSeconds === textOf(was).draftSeconds ? was.draftMs : seconds === null ? null : seconds * 1000
  const resultMs = text.resultSeconds === textOf(was).resultSeconds ? was.resultMs : resultSeconds === null ? null : resultSeconds * 1000
  if (silver === null || gold === null || diamond === null || pointsThreshold === null || draftMs === null || resultMs === null || dailyCapPoints === null || dailyRescues === null) return null
  if (silver + gold + diamond <= 0) return null
  return { tierWeights: { silver, gold, diamond }, pointsThreshold, draftMs, resultMs, dailyCapPoints, dailyRescues }
}

interface ConfigEditorProps {
  api: GmTabProps['api']
  config: ChaosConfigDto
  onDone: (message: string) => void
}

type ConfigField = keyof ConfigText

/** Block "Số liệu hỗn loạn": the tier odds, the points for a bonus card, the draft and result times and the daily limits. */
function ConfigEditor({ api, config, onDone }: ConfigEditorProps) {
  const { t } = useTranslation('normal')
  const [text, setText] = useState<ConfigText>(() => textOf(config))
  const [saving, setSaving] = useState(false)

  const next = configOf(text, config)
  const dirty = JSON.stringify(text) !== JSON.stringify(textOf(config))

  const confirm = async (values: ReasonValues): Promise<void> => {
    if (next === null) return
    await api.gmSetChaosConfig(next, values.reason)
    onDone(t('gm.done.chaosConfig'))
  }

  const fields: readonly { key: ConfigField; label: string }[] = [
    { key: 'silver', label: t('gm.chaos.config.weightSilver') },
    { key: 'gold', label: t('gm.chaos.config.weightGold') },
    { key: 'diamond', label: t('gm.chaos.config.weightDiamond') },
    { key: 'pointsThreshold', label: t('gm.chaos.config.pointsThreshold') },
    { key: 'draftSeconds', label: t('gm.chaos.config.draftSeconds') },
    { key: 'resultSeconds', label: t('gm.chaos.config.resultSeconds') },
    { key: 'dailyCapPoints', label: t('gm.chaos.config.dailyCap') },
    { key: 'dailyRescues', label: t('gm.chaos.config.dailyRescues') },
  ]
  const boxBroken = (key: ConfigField): boolean => {
    // One box is judged by the whole: swap in a known-good config for the others and see whether this one still fails.
    const probe = textOf({ tierWeights: { silver: 1, gold: 1, diamond: 1 }, pointsThreshold: 10, draftMs: 15_000, resultMs: 10_000, dailyCapPoints: 0, dailyRescues: 0 })
    return configOf({ ...probe, [key]: text[key] }, config) === null && text[key] !== textOf(config)[key]
  }

  return (
    <Panel title={t('gm.chaos.config.title')}>
      <div className={g.stack}>
        <div className={g.configGrid}>
          {fields.map(({ key, label }) => {
            const id = `gm-chaos-${key}`
            return (
              <div className={g.field} key={key}>
                <label className={s.label} htmlFor={id}>
                  {label}
                </label>
                <input
                  id={id}
                  className={s.input}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={boxBroken(key) ? true : undefined}
                  value={text[key]}
                  onChange={(event) => setText((prev) => ({ ...prev, [key]: event.target.value }))}
                />
              </div>
            )
          })}
        </div>
        {next === null ? (
          <p className={s.alert} role="alert">
            {t('gm.chaos.config.invalid')}
          </p>
        ) : null}
        <div className={s.choices}>
          <Button variant="gold" disabled={next === null || !dirty} onClick={() => setSaving(true)}>
            {t('gm.chaos.config.save')}
          </Button>
        </div>
      </div>

      <ReasonDialog
        open={saving}
        title={t('gm.chaos.config.saveTitle')}
        fields={{}}
        confirmLabel={t('gm.chaos.config.save')}
        onConfirm={confirm}
        onClose={() => setSaving(false)}
      />
    </Panel>
  )
}
