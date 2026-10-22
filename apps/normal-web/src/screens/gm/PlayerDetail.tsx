import { Badge, Button, Panel, formatPoints } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GmPlayerDetailDto } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { formatDay, formatMoment, formatSigned } from '../format.js'
import { LedgerPanel } from '../LedgerPanel.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import g from './gm.module.css'
import { ReasonDialog, type ReasonValues } from './ReasonDialog.js'
import type { GmTabProps } from './tabProps.js'

/** The hands the console shows under a player: enough to see what they have been doing, not a report. */
const HISTORY_LIMIT = 20

type ActionKind =
  | 'points'
  | 'item'
  | 'wardrobe'
  | 'lock'
  | 'unlock'
  | 'promote'
  | 'demote'
  | 'unlockAchievement'
  | 'resetCheckin'
  | 'grantReputation'

/** What each action asks for besides the reason, and the sentence of consequence shown above the form. */
const ACTIONS: Record<ActionKind, { fields: { amount?: boolean; item?: boolean; achievement?: boolean }; body?: string }> = {
  points: { fields: { amount: true } },
  item: { fields: { item: true } },
  wardrobe: { fields: {} },
  lock: { fields: {}, body: 'gm.dialog.lockBody' },
  unlock: { fields: {} },
  promote: { fields: {} },
  demote: { fields: {} },
  unlockAchievement: { fields: { achievement: true } },
  // Its sentence names the points and items, so it is computed from the preview rather than keyed.
  resetCheckin: { fields: {} },
  // Its amount is a range with its own label (1..100 000, never a deduction), set where the dialog opens.
  grantReputation: { fields: { amount: true }, body: 'gm.dialog.reputationBody' },
}

/** The most reputation one grant may add; the server refuses past it too. */
export const MAX_REPUTATION_GRANT = 100_000

export interface PlayerDetailProps extends GmTabProps {
  playerId: string
  onBack: () => void
}

/**
 * One account, with the six things a game master can do to it.
 *
 * Every action goes through the same `ReasonDialog`; when it succeeds the account is read again (the balance, the
 * lock and the role are all things the action just changed), the ledger underneath is fetched afresh, and a line says
 * what happened. The server is the judge of what is allowed — the buttons are hidden only where the answer is
 * always no (locking a game master), and a refusal that gets through is printed in the dialog, in words.
 */
export function PlayerDetail({ api, lang, playerId, onBack }: PlayerDetailProps) {
  const { t } = useTranslation('normal')
  const detail = useAsync(() => api.gmPlayer(playerId))
  const history = useAsync(() => api.gmPlayerHistory(playerId, HISTORY_LIMIT))
  // What today's check-in gave, read before the button is offered: a reset with nothing to undo is refused anyway.
  const checkin = useAsync(() => api.gmCheckin(playerId))
  // The picker's options, read once.
  const catalog = useAsync(() => api.catalogAchievements())
  const [action, setAction] = useState<ActionKind | null>(null)
  const [done, setDone] = useState<string | null>(null)
  /** Bumped by every successful action; the ledger is keyed on it, so it starts over from the newest row. */
  const [ledgerKey, setLedgerKey] = useState(0)
  const player = detail.data
  const rankName = (rank: number): string => t(`game:rank.${rank}`, { defaultValue: String(rank) })

  const perform =async (kind: ActionKind, values: ReasonValues): Promise<string> => {
    switch (kind) {
      case 'points': {
        if (values.amount === undefined) throw new Error('amount')
        const result = await api.gmPoints(playerId, values.amount, values.reason)
        return t('gm.done.points', { balance: formatPoints(result.balance, lang) })
      }
      case 'item': {
        if (values.itemId === undefined) throw new Error('itemId')
        const result = await api.gmGrantItem(playerId, values.itemId, values.reason)
        return t('gm.done.item', { count: result.granted.length })
      }
      case 'wardrobe': {
        const result = await api.gmGrantWardrobe(playerId, values.reason)
        return t('gm.done.item', { count: result.granted.length })
      }
      case 'lock':
        await api.gmLock(playerId, values.reason)
        return t('gm.done.lock')
      case 'unlock':
        await api.gmUnlock(playerId, values.reason)
        return t('gm.done.unlock')
      case 'promote':
        await api.gmSetRole(playerId, 'gm', values.reason)
        return t('gm.done.role')
      case 'demote':
        await api.gmSetRole(playerId, 'player', values.reason)
        return t('gm.done.role')
      case 'unlockAchievement':
        if (values.achievementId === undefined) throw new Error('achievementId')
        await api.gmUnlockAchievement(playerId, values.achievementId, values.reason)
        return t('gm.done.unlockAchievement')
      case 'resetCheckin':
        await api.gmResetCheckin(playerId, values.reason)
        return t('gm.done.resetCheckin')
      case 'grantReputation': {
        if (values.amount === undefined) throw new Error('amount')
        const result = await api.gmGrantReputation(playerId, values.amount, values.reason)
        return t('gm.done.grantReputation', { points: formatPoints(result.reputation, lang), rank: rankName(result.rank) })
      }
    }
  }

  const confirm = async (values: ReasonValues): Promise<void> => {
    if (action === null) return
    const message = await perform(action, values)
    setDone(message)
    setLedgerKey((n) => n + 1)
    detail.reload()
    if (action === 'resetCheckin') checkin.reload()
  }

  /** The sentence above the reset form: what leaves the player's balance and wardrobe. */
  const dialogBody = (kind: ActionKind): string | undefined => {
    if (kind === 'resetCheckin') {
      const given = checkin.data
      if (given === null) return undefined
      return t('gm.dialog.checkinBody', {
        points: formatPoints(given.points, lang),
        items: given.itemIds.length === 0 ? t('gm.dialog.noItems') : given.itemIds.map((id) => itemName(id, t)).join(', '),
      })
    }
    const key = ACTIONS[kind].body
    return key === undefined ? undefined : t(key)
  }

  const open = (kind: ActionKind): void => {
    setDone(null)
    setAction(kind)
  }

  const back = (
    <p>
      <Button variant="ghost" onClick={onBack}>
        {t('gm.player.back')}
      </Button>
    </p>
  )

  if (player === null) {
    return (
      <div className={g.stack}>
        {back}
        {detail.loading ? (
          <p className={s.footnote} role="status">
            {t('screens.loading')}
          </p>
        ) : (
          <>
            <p className={s.alert} role="alert">
              {t('gm.player.error')}
            </p>
            <p>
              <Button variant="ghost" onClick={detail.reload}>
                {t('screens.retry')}
              </Button>
            </p>
          </>
        )}
      </div>
    )
  }

  return (
    <div className={g.stack}>
      {back}
      <Panel title={player.displayName}>
        <div className={g.stack}>
          <Facts player={player} lang={lang} />
          <p className={g.lockNote}>
            {player.room === null ? t('gm.player.notInRoom') : t('gm.player.inRoom', { name: player.room.name, code: player.room.code })}
          </p>
          <p className={g.lockNote}>{t('gm.player.inventory', { count: player.inventoryCount })}</p>
          <p className={g.lockNote}>{t('gm.player.reputation', { points: formatPoints(player.reputation, lang), rank: rankName(player.rank) })}</p>
          {player.locked === null ? null : (
            <p className={`${s.alert} ${g.lockNote}`}>
              {t('gm.player.lockedSince', { at: formatMoment(player.locked.at, lang), reason: player.locked.reason })}
            </p>
          )}
          <div className={g.actionsRow}>
            <Button variant="gold" onClick={() => open('points')}>
              {t('gm.actions.points')}
            </Button>
            <Button variant="ghost" onClick={() => open('item')}>
              {t('gm.actions.item')}
            </Button>
            <Button variant="ghost" onClick={() => open('wardrobe')}>
              {t('gm.actions.wardrobe')}
            </Button>
            {player.role === 'gm' ? null : player.locked === null ? (
              <Button variant="ghost" onClick={() => open('lock')}>
                {t('gm.actions.lock')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => open('unlock')}>
                {t('gm.actions.unlock')}
              </Button>
            )}
            {player.role === 'gm' ? (
              <Button variant="ghost" onClick={() => open('demote')}>
                {t('gm.actions.demote')}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => open('promote')}>
                {t('gm.actions.promote')}
              </Button>
            )}
            <Button variant="ghost" onClick={() => open('unlockAchievement')}>
              {t('gm.actions.unlockAchievement')}
            </Button>
            <Button
              variant="ghost"
              disabled={checkin.loading || checkin.data?.claimedToday !== true}
              onClick={() => open('resetCheckin')}
            >
              {t('gm.actions.resetCheckin')}
            </Button>
            <Button variant="ghost" onClick={() => open('grantReputation')}>
              {t('gm.actions.grantReputation')}
            </Button>
          </div>
        </div>
      </Panel>

      {/* Always in the page, so a screen reader has the region before its text arrives; and outside what reloads. */}
      <div role="status">
        {done === null ? null : <p className={s.notice}>{done}</p>}
      </div>

      <LedgerPanel key={ledgerKey} load={(opts) => api.gmPlayerLedger(playerId, opts)} lang={lang} title={t('gm.player.ledger')} />

      <Panel title={t('gm.player.history')}>
        {history.data === null ? (
          <p className={s.footnote}>{history.loading ? t('screens.loading') : t('profile.history.empty')}</p>
        ) : history.data.length === 0 ? (
          <p className={s.footnote}>{t('profile.history.empty')}</p>
        ) : (
          <ul className={s.rows} aria-label={t('gm.player.history')}>
            {history.data.map((hand) => (
              <li className={s.handRow} key={hand.handId}>
                <span className={s.rowMain}>
                  <span className={s.rowTitle}>{t(`game:mode.${hand.mode}`, { defaultValue: hand.mode })}</span>
                  <time className={s.rowMeta} dateTime={new Date(hand.endedAt).toISOString()}>
                    {formatMoment(hand.endedAt, lang)}
                  </time>
                  {hand.roomName === null ? null : <span className={s.rowMeta}>{hand.roomName}</span>}
                </span>
                <span className={s.handMarks}>
                  {hand.cancelled ? <Badge tone="muted">{t('profile.history.cancelled')}</Badge> : null}
                  {hand.won ? <Badge tone="muted">{t('profile.history.won')}</Badge> : null}
                  <span className={s.amount} data-sign={hand.net < 0 ? 'down' : 'up'}>
                    {formatSigned(hand.net, lang)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {action === null ? null : (
        <ReasonDialog
          open
          title={t(`gm.actions.${action}`)}
          body={dialogBody(action)}
          fields={{
            ...ACTIONS[action].fields,
            amount:
              action === 'grantReputation'
                ? { min: 1, max: MAX_REPUTATION_GRANT, label: t('gm.dialog.reputationAmount') }
                : ACTIONS[action].fields.amount,
            achievement: ACTIONS[action].fields.achievement
              ? { options: catalog.data?.achievements ?? [], disabledIds: new Set(player.unlockedAchievementIds) }
              : undefined,
          }}
          confirmLabel={t('gm.dialog.confirm')}
          onConfirm={confirm}
          onClose={() => setAction(null)}
        />
      )}
    </div>
  )
}

function Facts({ player, lang }: { player: GmPlayerDetailDto; lang: GmTabProps['lang'] }) {
  const { t } = useTranslation('normal')
  // Amount and unit stay one string, as the profile and the rail print it.
  const balance = `${formatPoints(player.balance, lang)} ${t('common:units.pointsShort')}`
  return (
    <dl className={g.facts}>
      <Fact label={t('gm.player.email')}>{player.email}</Fact>
      <Fact label={t('gm.player.balance')}>{balance}</Fact>
      <Fact label={t('gm.player.role')}>{t(`gm.player.roles.${player.role}`)}</Fact>
      <Fact label={t('gm.player.created')}>{formatDay(player.createdAt, lang)}</Fact>
      <Fact label={t('gm.player.lastLogin')}>
        {player.lastLoginAt === null ? t('gm.player.neverSignedIn') : formatMoment(player.lastLoginAt, lang)}
      </Fact>
      <Fact label={t('profile.stats.handsPlayedHoldem')}>{formatPoints(player.stats.handsPlayedHoldem, lang)}</Fact>
      <Fact label={t('profile.stats.handsPlayedBlind')}>{formatPoints(player.stats.handsPlayedBlind, lang)}</Fact>
    </dl>
  )
}

function Fact({ label, children }: { label: string; children: string }) {
  return (
    <div className={g.fact}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}
