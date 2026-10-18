import { validateDisplayName, type HandCategory } from '@bp/core'
import { Badge, Button, Chibi, Field, Panel, defaultChibi, formatPoints, handLabel, type Language } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarCatalogDto, HistoryEntryDto, ItemDto, MeDto, NormalApi, PlayerStatsDto } from '../api.js'
import { chibiFromApi } from '../avatar/chibi.js'
import { itemName } from '../catalog-i18n.js'
import { LedgerPanel } from './LedgerPanel.js'
import { formatDay, formatMoment, formatSigned } from './format.js'
import s from './normal.module.css'
import { refusalText } from './refusal.js'
import { useAsync } from './useAsync.js'

/** §19.2 serves the last twenty hands by default, and twenty is what a profile page is for. */
export const HISTORY_LIMIT = 20

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

/**
 * The table line of a history row. Rooms are often called "Bàn 123", and "Tại bàn Bàn 123" says the word twice
 * (R2-2): when the name's first word already *is* the page language's word for a table, the line is "Tại {name}";
 * otherwise it is "Tại bàn {name}" and the word is added. Words are compared as composed Unicode, lower-cased in
 * the page's language, so "BÀN VIP" and a name typed with a combining accent count, and "Bàn123" or "Bàn-9" — one
 * word that merely starts with it — do not. The name itself is printed as the room has it.
 */
function tableLine(roomName: string, lang: Language, t: TFunction): string {
  const first = roomName.normalize('NFC').trim().split(/\s+/u)[0] ?? ''
  const word = t('profile.history.tableWord').normalize('NFC')
  const named = first.toLocaleLowerCase(lang) === word.toLocaleLowerCase(lang)
  return t(named ? 'profile.history.tableNamed' : 'profile.history.table', { name: roomName })
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
   * A successful rename, reported upwards. The rail and the lobby bar read the name from the session gate
   * and the socket's identity, not from this page's copy of `GET /api/me`, so a rename that stayed here
   * would leave the old name everywhere else until the next reload; the app updates both.
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
  const bundle = useAsync<[MeDto, PlayerStatsDto, HistoryEntryDto[], ItemDto[], AvatarCatalogDto]>(() =>
    Promise.all([
      api.me(),
      api.stats(),
      api.history(HISTORY_LIMIT),
      // The rig every chibi is drawn on — needed once, to turn `me.avatar` into the picture at the top of
      // this page. A failed fetch here still leaves the rest of the profile readable: the stage just falls
      // back to the seed-based default chibi, the same way a table seat does for a face it never got — so
      // both catalogue calls are caught here rather than left to fail the whole `Promise.all`.
      api.catalogItems().then(
        (answer) => answer.items,
        () => [] as ItemDto[],
      ),
      api.avatarCatalog().catch(
        () => ({ frame: { w: 0, h: 0 }, crop: { x: 0, y: 0, size: 0 }, bodies: [], manifestVersion: 0 }) as AvatarCatalogDto,
      ),
    ]),
  )
  /** A rename answers with the new name; the rest of `me` is unchanged, so only this is overlaid. */
  const [renamed, setRenamed] = useState<string | null>(null)

  const loaded = bundle.data
  const [me, stats, history, catalogItems, avatarCatalog] = loaded ?? [undefined, undefined, undefined, undefined, undefined]
  const items = useMemo(() => new Map((catalogItems ?? []).map((item) => [item.id, item])), [catalogItems])
  const bodies = useMemo(() => new Map((avatarCatalog?.bodies ?? []).map((body) => [body.gender, body])), [avatarCatalog])

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
  const chibi = chibiFromApi(me.avatar, items, bodies) ?? defaultChibi(displayName)

  return (
    <main className={s.page}>
      {/* A page title like every other page's (layout audit U3); the player's name heads the card below it. */}
      <div className={s.pageHead}>
        <h1>{t('profile.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <header className={s.identityCard}>
        {/* The backdrop is CSS, keyed on `data-title` — five gradient/glow variants, one per title, in
            `normal.module.css`. One figure, full body with its aura, beside the text (layout audit C7,
            2026-09-28: a 240 px body and a 192 px head used to stand side by side above the text, with room to
            spare around both). The frame ring is a `head`-only layer, so the head crop stays — as the small
            portrait beside the name, the size the table and the lobby show it at. */}
        <div className={s.identityStage} data-title={titleId ?? ''}>
          <Chibi subject={chibi} frame="full" size={200} label={displayName} />
        </div>
        <div className={s.identityText}>
          <div className={s.identityHead}>
            <Chibi subject={chibi} frame="head" size={56} />
            <h2 className={s.identityName}>{displayName}</h2>
          </div>
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
                    {hand.roomName === null ? null : (
                      <span className={`${s.rowMeta} ${s.handTable}`}>{tableLine(hand.roomName, lang, t)}</span>
                    )}
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
                        // A bot's label already reads "Bot n", so it carries no badge that would say "bot" again;
                        // and because no name is reserved (a human may be called "Bot 5"), it is marked by more
                        // than colour: the attribute styles the name in italics, and the word is there for a
                        // screen reader.
                        <span className={s.seatChip} data-bot={seat.isBot ? 'true' : undefined} key={`${seat.seat}-${seat.label}`}>
                          <span className={s.seatName}>{seat.label}</span>
                          {seat.isBot ? (
                            <>
                              {/* A space between the two flex items (it draws nothing) keeps the text "Bot 5 bot". */}
                              {' '}
                              <span className="visually-hidden">{t('profile.history.bot')}</span>
                            </>
                          ) : null}
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

      <LedgerPanel load={api.ledger} lang={lang} />
    </main>
  )
}
