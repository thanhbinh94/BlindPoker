import { Segmented, type Language } from '@bp/ui-kit'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, type NormalApi } from '../../api.js'
import s from '../normal.module.css'
import { ActionsTab } from './ActionsTab.js'
import { GiftsTab } from './GiftsTab.js'
import g from './gm.module.css'
import { OverviewTab } from './OverviewTab.js'
import { PlayerDetail } from './PlayerDetail.js'
import { PlayersTab } from './PlayersTab.js'
import { RoomsTab } from './RoomsTab.js'
import { ShopTab } from './ShopTab.js'

type Tab = 'overview' | 'players' | 'rooms' | 'gifts' | 'shop' | 'actions'
const TABS: readonly Tab[] = ['overview', 'players', 'rooms', 'gifts', 'shop', 'actions']

/** The one refusal that means "you are not a game master any more", as opposed to "not this target" or "not now". */
function roleGone(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status === 403 && cause.code === 'FORBIDDEN'
}

type ApiCall = (...args: unknown[]) => Promise<unknown>

export interface GmScreenProps {
  /** The app's guarded api: a `401` is the session gate's business and never reaches the console. */
  api: NormalApi
  lang: Language
  /** The server said this account is no longer a GM (demoted or locked since the page loaded): leave the console. */
  onForbidden: () => void
}

/**
 * The game master's console: six tabs, and one player's page inside the second.
 *
 * Every tab reads through `useAsync`, which swallows the cause of a failure, so a tab cannot be the one to notice
 * that the role is gone. The notice therefore lives on the api instead: `guarded` is the app's api with each call's
 * rejection checked on its way out (the same shape as `guarded-api.ts`, one level in), and a `403 FORBIDDEN` from any
 * `/api/gm/*` call reports through `onForbidden` — once, because a tab firing three requests gets three refusals
 * and the app must be sent away once. Other 403s (`SELF_TARGET`, `TARGET_IS_GM`) are about the target, not the
 * caller, and stay in the dialog that asked.
 */
export function GmScreen({ api, lang, onForbidden }: GmScreenProps) {
  const { t } = useTranslation('normal')
  const [tab, setTab] = useState<Tab>('overview')
  const [playerId, setPlayerId] = useState<string | null>(null)

  const forbiddenRef = useRef(onForbidden)
  forbiddenRef.current = onForbidden
  const reported = useRef(false)
  const guard = useCallback((cause: unknown): never => {
    if (roleGone(cause) && !reported.current) {
      reported.current = true
      forbiddenRef.current()
    }
    throw cause
  }, [])

  const guarded = useMemo(() => {
    // Memoised per member: a caller may put `api.gmSearch` in a dependency list, and a proxy minting a new
    // function per read would loop it.
    const wrapped = new Map<string | symbol, ApiCall>()
    return new Proxy(api, {
      get(target, prop, receiver): unknown {
        const value = Reflect.get(target, prop, receiver) as unknown
        if (typeof value !== 'function') return value
        const cached = wrapped.get(prop)
        if (cached !== undefined) return cached
        const method = value as ApiCall
        const call: ApiCall = async (...args) => {
          try {
            return await method.apply(target, args)
          } catch (cause) {
            return guard(cause)
          }
        }
        wrapped.set(prop, call)
        return call
      },
    }) as NormalApi
  }, [api, guard])

  const tabs = TABS.map((value) => ({ value, label: t(`gm.tabs.${value}`) }))
  const shared = { api: guarded, lang, guard }

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('gm.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <Segmented
        options={tabs}
        value={tab}
        onChange={(next) => {
          setTab(next)
          setPlayerId(null)
        }}
        label={t('gm.title')}
        className={g.wrapSeg}
      />
      {tab === 'overview' ? <OverviewTab {...shared} /> : null}
      {tab === 'players' ? (
        <>
          {/* Kept mounted, only hidden, while a player is open: Back returns to the same query, the same pages and
              the same scroll, and costs no new search (a search is a metered write on the server). */}
          <div hidden={playerId !== null}>
            <PlayersTab {...shared} onOpen={setPlayerId} />
          </div>
          {playerId === null ? null : <PlayerDetail key={playerId} {...shared} playerId={playerId} onBack={() => setPlayerId(null)} />}
        </>
      ) : null}
      {tab === 'rooms' ? <RoomsTab {...shared} /> : null}
      {tab === 'gifts' ? <GiftsTab {...shared} /> : null}
      {tab === 'shop' ? <ShopTab {...shared} /> : null}
      {tab === 'actions' ? <ActionsTab {...shared} /> : null}
    </main>
  )
}
