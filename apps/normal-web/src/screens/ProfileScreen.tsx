import { validateDisplayName, type HandCategory } from '@bp/core'
import { Badge, Button, Field, Panel, formatPoints, handLabel, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { HistoryEntryDto, LedgerEntryDto, MeDto, NormalApi, PlayerStatsDto } from '../api.js'
import { Portrait } from '../avatar3d/Portrait.js'
import { itemName } from '../catalog-i18n.js'
import { formatDay, formatMoment, formatSigned } from './format.js'
import s from './normal.module.css'
import { refusalText } from './refusal.js'
import { useAsync } from './useAsync.js'

/** §19.2 serves the last twenty hands by default, and twenty is what a profile page is for. */
export const HISTORY_LIMIT = 20

/** One ledger page. Fifty rows is roughly a screen and a half on a phone — enough to scroll, short to fetch. */
export const LEDGER_PAGE = 50

/** `TxReason` in `@bp/server-kit`, which this app may not import: the values, copied, with a fallback under them. */
const REASONS = new Set([
  'starting_balance',
  'settlement',
  'buy_in',
  'cash_out',
  'refund',
  'daily_reward',
  'daily_login',
  'daily_item_fallback',
  'relief',
  'achievement',
])

/** A reason the server invented after this bundle shipped still reads as *something*, never as a raw key. */
export function reasonLabel(reason: string, t: TFunction): string {
  return t(REASONS.has(reason) ? `ledger.reason.${reason}` : 'ledger.reason.other')
}

type StatKey = keyof PlayerStatsDto

/**
 * The sixteen counters of §10.3, in five groups.
 *
 * The grouping is what makes them readable: "hands played" appears twice, once under each mode, and only the
 * heading above it says which is which — which is also why the labels are per-metric rather than per-group.
 */
export const STAT_GROUPS: { key: string; metrics: StatKey[] }[] = [
  { key: 'holdem', metrics: ['handsPlayedHoldem', 'handsWonHoldem', 'bestHandRank', 'biggestWin'] },
  { key: 'blind', metrics: ['handsPlayedBlind', 'handsWonBlind'] },
  { key: 'streaks', metrics: ['currentWinStreak', 'bestWinStreak', 'currentLoseStreak', 'bestLoseStreak'] },
  { key: 'login', metrics: ['totalLoginDays', 'loginStreak', 'bestLoginStreak'] },
  { key: 'social', metrics: ['botHands', 'roomsJoined', 'gamesCompleted'] },
]

/** The one counter that is points rather than a tally, so the only one that carries a unit. */
const POINT_METRICS = new Set<StatKey>(['biggestWin'])

/** A `HandCategory` ordinal in words. Anything outside 0…9 is an item this bundle predates: say nothing. */
function categoryText(category: number, t: TFunction): string {
  return category < 0 || category > 9 ? t('profile.stats.none') : handLabel(category as HandCategory, t)
}

/**
 * The stats column is not the history column: `bestHandRank` *defaults* to 0, so a zero there means "no
 * showdown has been won yet" rather than "a high card". A hand's own `bestCategory` is `null` when there was
 * none, which is why that one is read straight.
 */
function statText(stats: PlayerStatsDto, metric: StatKey, lang: Language, t: TFunction): string {
  if (metric === 'bestHandRank') return stats.bestHandRank === 0 ? t('profile.stats.none') : categoryText(stats.bestHandRank, t)
  const value = formatPoints(stats[metric], lang)
  return POINT_METRICS.has(metric) ? `${value} ${t('common:units.pointsShort')}` : value
}

/** The mode label belongs to the game, so it comes from the kit's `game` namespace, not this app's. */
const modeLabel = (mode: string, t: TFunction): string => t(`game:mode.${mode}`, { defaultValue: mode })

export interface ProfileScreenProps {
  api: NormalApi
  lang: Language
  /**
   * The live balance. It comes from the socket rather than from `GET /api/me`, because the socket is what
   * moves it: a hand settles and `BALANCE` arrives, and a number this page had fetched once would be stale
   * in a way the player would read as points having gone missing.
   */
  balance: number
  /**
   * A successful rename, reported upwards. The rail and the lobby bar read the name from the session gate,
   * not from this page's copy of `GET /api/me`, so a rename that stayed here would leave the old name
   * everywhere else until the next reload.
   */
  onRenamed?: (displayName: string) => void
}

/* ── the rename form ───────────────────────────────────────────────────────── */

interface RenameFormProps {
  api: NormalApi
  current: string
  onRenamed: (displayName: string) => void
}

/**
 * The one thing on this page that writes.
 *
 * It runs `validateDisplayName` — the *server's* validator, out of `@bp/core` — as the player types, so a
 * name refused here is refused for the same reason it would have been refused there, and the round trip is
 * spent only on the one rule a browser cannot check: whether somebody else already has it (409).
 */
function RenameForm({ api, current, onRenamed }: RenameFormProps) {
  const { t } = useTranslation('normal')
  const [value, setValue] = useState(current)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const verdict = validateDisplayName(value)
  const hint = value === '' || verdict.ok ? t('auth.displayNameHint') : t(`auth.name.${verdict.reason}`)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    setNote(null)
    if (!verdict.ok) {
      setError(t('auth.errors.INVALID_NAME'))
      return
    }
    if (verdict.name === current) {
      setError(t('profile.rename.same'))
      return
    }
    setBusy(true)
    try {
      const saved = await api.rename(verdict.name)
      setError(null)
      // The header changes here and the table does not, which is why the note says so: the seat's name was
      // copied into the room when the player joined it, and the room is where it stays until they rejoin.
      setNote(t('profile.rename.saved'))
      setValue(saved.displayName)
      onRenamed(saved.displayName)
    } catch (cause) {
      setError(refusalText(cause, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={s.form} onSubmit={(event) => void submit(event)} noValidate>
      <Field label={t('profile.rename.label')} hint={hint} error={error ?? undefined}>
        <input
          className={s.input}
          type="text"
          value={value}
          autoComplete="nickname"
          autoCapitalize="words"
          spellCheck={false}
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
            setNote(null)
          }}
        />
      </Field>
      {note === null ? null : (
        <p className={s.notice} role="status">
          {note}
        </p>
      )}
      <Button type="submit" variant="gold" loading={busy}>
        {t('profile.rename.submit')}
      </Button>
    </form>
  )
}

/* ── the ledger ────────────────────────────────────────────────────────────── */

interface LedgerPanelProps {
  api: NormalApi
  lang: Language
}

/**
 * Where the points came from and went.
 *
 * It pages on the server's own cursor (`nextBefore`, the ledger's sequence id) rather than on an offset,
 * because rows arrive at the top while the player reads: an offset would show them the same row twice, and a
 * cursor cannot. A page shorter than the limit *is* the end of the history, which is why the absence of a
 * cursor — not the length of the last page — is what puts the button away.
 */
function LedgerPanel({ api, lang }: LedgerPanelProps) {
  const { t } = useTranslation('normal')
  const [entries, setEntries] = useState<LedgerEntryDto[]>([])
  const [nextBefore, setNextBefore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const pull = useCallback(
    async (before: number | null): Promise<void> => {
      setLoading(true)
      setFailed(false)
      try {
        const page = await api.ledger(before === null ? { limit: LEDGER_PAGE } : { limit: LEDGER_PAGE, before })
        setEntries((prev) => (before === null ? page.entries : [...prev, ...page.entries]))
        setNextBefore(page.nextBefore)
      } catch {
        setFailed(true)
      } finally {
        setLoading(false)
      }
    },
    [api],
  )

  useEffect(() => {
    void pull(null)
  }, [pull])

  return (
    <Panel title={t('profile.ledger.title')}>
      {/* The panel's own words, not the page's: this alert fires under a profile that rendered perfectly
          well, and "could not load your profile" read out over one is simply untrue. */}
      {failed ? (
        <p className={s.alert} role="alert">
          {t('profile.ledger.error')}
        </p>
      ) : null}

      {entries.length === 0 && !loading && !failed ? <p className={s.footnote}>{t('profile.ledger.empty')}</p> : null}

      {entries.length === 0 ? null : (
        <ul className={s.rows} aria-label={t('profile.ledger.title')}>
          {entries.map((entry) => (
            <li className={s.ledgerRow} key={entry.id}>
              <span className={s.rowMain}>
                <span className={s.rowTitle}>{reasonLabel(entry.reason, t)}</span>
                <time className={s.rowMeta} dateTime={new Date(entry.createdAt).toISOString()}>
                  {formatMoment(entry.createdAt, lang)}
                </time>
                {entry.refId === null ? null : <span className={s.rowRef}>{t('profile.ledger.ref', { id: entry.refId })}</span>}
              </span>
              <span className={s.amount} data-sign={entry.amount < 0 ? 'down' : 'up'}>
                {formatSigned(entry.amount, lang)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* A first page that failed leaves `nextBefore` at `null`, which is also how "you have read it all"
          looks — so without this branch the only way out of a failed first page is a full page reload.
          A *later* page that failed keeps its cursor, and "load more" retries that same page. */}
      {failed && entries.length === 0 ? (
        <Button variant="ghost" loading={loading} onClick={() => void pull(null)}>
          {t('screens.retry')}
        </Button>
      ) : nextBefore === null ? null : (
        <Button variant="ghost" loading={loading} onClick={() => void pull(nextBefore)}>
          {t('profile.ledger.loadMore')}
        </Button>
      )}
    </Panel>
  )
}

/* ── the page ──────────────────────────────────────────────────────────────── */

/**
 * The account, on one page: who you are, what you have done, and where your points went.
 *
 * Three requests land together (`me`, `stats`, `history`) because the header is meaningless without all
 * three and a page that fills in three times is worse than one that fills in once. The ledger is the
 * exception and loads on its own: it pages, and its "load more" must not be able to blank the header above it.
 */
export function ProfileScreen({ api, lang, balance, onRenamed }: ProfileScreenProps) {
  const { t } = useTranslation('normal')
  const bundle = useAsync<[MeDto, PlayerStatsDto, HistoryEntryDto[]]>(() =>
    Promise.all([api.me(), api.stats(), api.history(HISTORY_LIMIT)]),
  )
  /** A rename answers with the new name; the rest of `me` is unchanged, so only this is overlaid. */
  const [renamed, setRenamed] = useState<string | null>(null)

  const loaded = bundle.data
  const me = loaded?.[0]
  const stats = loaded?.[1]
  const history = loaded?.[2]

  if (bundle.loading && loaded === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (me === undefined || stats === undefined || history === undefined) {
    return (
      <main className={s.page}>
        <p className={s.alert} role="alert">
          {t('profile.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={bundle.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </main>
    )
  }

  const displayName = renamed ?? me.displayName
  const titleId = me.avatar.title
  const badgeId = me.avatar.badge
  // Amount and unit stay one string, exactly as the rail and the kit's `PlayerBar` print it.
  const balanceText = `${formatPoints(balance, lang)} ${t('common:units.pointsShort')}`

  return (
    <main className={s.page}>
      <header className={s.identityCard}>
        <Portrait config={me.avatar} name={displayName} size="lg" label={t('avatar.mine')} />
        <div className={s.identityText}>
          <span className={s.eyebrow}>{t('profile.title')}</span>
          <h1 className={s.identityName}>{displayName}</h1>
          <p className={s.marks}>
            {titleId === undefined || titleId === '' ? (
              <span className={s.footnote}>{t('profile.noTitle')}</span>
            ) : (
              <Badge tone="gold">{itemName(titleId, t)}</Badge>
            )}
            {badgeId === undefined || badgeId === '' ? null : <Badge tone="teal">{itemName(badgeId, t)}</Badge>}
          </p>
          <p className={s.footnote}>{t('profile.memberSince', { date: formatDay(me.createdAt, lang) })}</p>
          <p className={s.balanceLine}>
            <span className={s.rowMeta}>{t('profile.balance')}</span>
            <span className={s.balance}>{balanceText}</span>
          </p>
          <nav className={s.quickNav} aria-label={t('profile.title')}>
            <a className={s.quickLink} href="#/avatar">
              {t('profile.toAvatar')}
            </a>
            <a className={s.quickLink} href="#/inventory">
              {t('profile.toInventory')}
            </a>
            <a className={s.quickLink} href="#/achievements">
              {t('profile.toAchievements')}
            </a>
          </nav>
        </div>
      </header>

      <Panel title={t('profile.rename.title')}>
        <RenameForm
          api={api}
          current={displayName}
          onRenamed={(name) => {
            setRenamed(name)
            onRenamed?.(name)
          }}
        />
      </Panel>

      <Panel title={t('profile.stats.title')}>
        <div className={s.statGroups}>
          {STAT_GROUPS.map((group) => (
            <section className={s.statGroup} key={group.key}>
              <h3 className={s.groupTitle}>{t(`profile.stats.groups.${group.key}`)}</h3>
              <dl className={s.stats}>
                {group.metrics.map((metric) => (
                  <div className={s.stat} key={metric}>
                    <dt className={s.rowMeta}>{t(`profile.stats.${metric}`)}</dt>
                    <dd className={s.statValue}>{statText(stats, metric, lang, t)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </Panel>

      <Panel title={t('profile.history.title')}>
        {history.length === 0 ? (
          <p className={s.footnote}>{t('profile.history.empty')}</p>
        ) : (
          <ul className={s.rows} aria-label={t('profile.history.title')}>
            {history.map((hand) => {
              // On the id, never on the name: `label` is a display name for a human seat, and two accounts
              // may share one — including with the reader, who would then vanish from their own opponents
              // list, or appear in it.
              const others = hand.players.filter((seat) => seat.playerId !== me.playerId)
              return (
                <li className={s.handRow} key={hand.handId}>
                  <span className={s.rowMain}>
                    <span className={s.rowTitle}>{modeLabel(hand.mode, t)}</span>
                    <time className={s.rowMeta} dateTime={new Date(hand.endedAt).toISOString()}>
                      {formatMoment(hand.endedAt, lang)}
                    </time>
                  </span>
                  <span className={s.handMarks}>
                    {hand.cancelled ? <Badge tone="muted">{t('profile.history.cancelled')}</Badge> : null}
                    {hand.won ? <Badge tone="gold">{t('profile.history.won')}</Badge> : null}
                    <span className={s.amount} data-sign={hand.net < 0 ? 'down' : 'up'}>
                      {formatSigned(hand.net, lang)}
                    </span>
                  </span>
                  <dl className={s.handDetail}>
                    {hand.bestCategory === null ? null : (
                      <>
                        <dt className={s.rowMeta}>{t('profile.history.bestHand')}</dt>
                        <dd className={s.rowValue}>{categoryText(hand.bestCategory, t)}</dd>
                      </>
                    )}
                    <dt className={s.rowMeta}>{t('profile.history.opponents')}</dt>
                    <dd className={s.seats}>
                      {others.map((seat) => (
                        <span className={s.seatChip} key={`${seat.seat}-${seat.label}`}>
                          <span className={s.seatName}>{seat.label}</span>
                          {seat.isBot ? <Badge tone="muted">{t('profile.history.bot')}</Badge> : null}
                        </span>
                      ))}
                    </dd>
                  </dl>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <LedgerPanel api={api} lang={lang} />
    </main>
  )
}
