import { Button, Chibi, defaultChibi, Modal, type Expression } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  type AchievementDefDto,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type BaseId,
  type InventoryDto,
  type ItemDto,
  type ItemSlot,
  type NormalApi,
  type OutfitDto,
} from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import { useAvatars } from '../../avatar/useAvatars.js'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import { BaseTab } from './BaseTab.js'
import { ItemTab } from './ItemTab.js'
import { OutfitBar } from './OutfitBar.js'
import w from './wardrobe.module.css'

/** Refusals this screen has words for; anything else is the kit's generic failure. */
const KNOWN_CODES = new Set(['NOT_OWNED', 'WRONG_CATEGORY', 'MISSING_LAYER', 'INVALID_ITEM', 'INVALID_BASE'])

export function avatarRefusal(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && KNOWN_CODES.has(cause.code)) return t(`avatar.errors.${cause.code}`)
  return t('common:errors.INTERNAL')
}

const EXPRESSIONS: readonly Expression[] = ['neutral', 'happy', 'sad', 'surprised', 'closed', 'sleep']

/** The seven tabs of design §7, in the order the spec lists them: the base first, the words last. */
const TABS = ['base', 'head', 'face', 'outfit', 'aura', 'frame', 'words'] as const
type Tab = (typeof TABS)[number]

/** `useAvatars` wants an array it can key on; a fresh `[]` per render would restart its effect forever. */
const NO_IDS: string[] = []

export interface WardrobeScreenProps {
  api: NormalApi
  /** Whose face this is — the saved config is pushed straight into the preview, but the *shared* cache the
   * table and the lobby bar draw from has a minute-long entry that would otherwise keep the old face on
   * screen for up to that long. */
  playerId: string | null
}

interface WardrobeData {
  inventory: InventoryDto
  catalog: ItemDto[]
  avatarCatalog: AvatarCatalogDto
  outfits: (OutfitDto | null)[]
  achievements: AchievementDefDto[]
}

/** Sets a slot, or drops it entirely when `itemId` is `undefined` — the same rule `PUT /api/me/avatar`
 * reads: an omitted key is an empty slot, a `''` id is a malformed one. */
function withSlot(config: AvatarConfigDto, slot: ItemSlot, itemId: string | undefined): AvatarConfigDto {
  if (itemId === undefined) {
    const rest = { ...config } as Record<string, unknown>
    delete rest[slot]
    return rest as unknown as AvatarConfigDto
  }
  return { ...config, [slot]: itemId }
}

/** Two configurations are the same outfit when they name the same slots. */
function sameConfig(a: AvatarConfigDto, b: AvatarConfigDto): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

type Note = 'saved' | null

/**
 * The wardrobe: a chibi on a stage, an expression picker, seven tabs of tiles, and the outfit bar
 * (design §7).
 *
 * Only what is owned can be equipped — the tabs list the whole catalogue, but `ItemTab` locks anything not
 * in the player's inventory — so the only refusal a correct client can provoke is a race with a grant, and
 * `avatarRefusal` still maps the server's codes because a save that says no with no words is a button that
 * appears to do nothing.
 *
 * Leaving with unsaved changes is guarded twice — `beforeunload` for a reload or a closed tab, an in-app
 * confirmation for a `#/…` link elsewhere in the app — both wired up where `dirty` is computed, below.
 */
export function WardrobeScreen({ api, playerId }: WardrobeScreenProps) {
  const { t } = useTranslation('normal')
  const wardrobe = useAsync<WardrobeData>(async () => {
    const [inventory, catalogAnswer, avatarCatalog, outfitsAnswer, achievementsAnswer] = await Promise.all([
      api.inventory(),
      api.catalogItems(),
      api.avatarCatalog(),
      api.outfits(),
      api.catalogAchievements(),
    ])
    return {
      inventory,
      catalog: catalogAnswer.items,
      avatarCatalog,
      outfits: outfitsAnswer.outfits,
      achievements: achievementsAnswer.achievements,
    }
  })
  const { invalidate } = useAvatars(api, NO_IDS)

  const [draft, setDraft] = useState<AvatarConfigDto | null>(null)
  const [committed, setCommitted] = useState<AvatarConfigDto | null>(null)
  const [tab, setTab] = useState<Tab>('base')
  const [expression, setExpression] = useState<Expression>('neutral')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)
  /** The `#/…` a guarded click was heading for, while the confirmation is up. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)

  const loaded = wardrobe.data
  const saved = committed ?? loaded?.inventory.avatar ?? null
  const config = draft ?? saved
  const dirty = draft !== null && saved !== null && !sameConfig(draft, saved)

  // Leaving with an unsaved draft is guarded twice. `beforeunload` covers a reload or a closed tab; a
  // capture-phase click on any `#/…` link covers the rail, the profile's quick nav and the lobby bar —
  // every route in this app is one of those, and a hash that has already changed cannot be un-changed
  // without pushing a second history entry, so the click is caught *before* the browser acts on it and
  // the destination is held until the player says what to do with it. Both are armed only while `dirty`.
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // Two lines for one behaviour: `preventDefault` is the modern spelling, `returnValue` the one
      // several browsers still require. Neither lets us choose the words — the browser's own are used.
      event.preventDefault()
      event.returnValue = ''
    }
    const onClick = (event: MouseEvent): void => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const link = target.closest('a[href^="#"]')
      if (link === null) return
      const href = link.getAttribute('href')
      if (href === null || href === '' || href === window.location.hash) return
      event.preventDefault()
      event.stopPropagation()
      setLeavingTo(href)
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
    }
  }, [dirty])

  /** Go where the guarded click was going. The guard is not in the way: this is not a click. */
  const leave = (): void => {
    const target = leavingTo
    setLeavingTo(null)
    setDraft(null)
    if (target !== null) window.location.hash = target
  }

  const items = useMemo(() => new Map((loaded?.catalog ?? []).map((item) => [item.id, item])), [loaded])
  const bases = useMemo(() => new Map((loaded?.avatarCatalog.bases ?? []).map((base) => [base.id, base])), [loaded])
  const owned = useMemo(() => new Set((loaded?.inventory.items ?? []).map((item) => item.itemId)), [loaded])

  if (wardrobe.loading && loaded === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (loaded === null || config === null) {
    return (
      <main className={s.page}>
        <p className={s.alert} role="alert">
          {t('inventory.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={wardrobe.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </main>
    )
  }

  const commit = (next: AvatarConfigDto): void => {
    setDraft(next)
    setNote(null)
    setError(null)
  }

  const pick = (slot: ItemSlot, itemId: string): void => {
    const equipped = config[slot] === itemId
    const required = slot === 'outfit'
    commit(withSlot(config, slot, equipped && !required ? undefined : itemId))
  }

  const pickBase = (base: BaseId): void => commit({ ...config, base })

  const save = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const answer = await api.setAvatar(config)
      setCommitted(answer.config)
      setDraft(null)
      setError(null)
      setNote('saved')
      if (playerId !== null) invalidate(playerId)
    } catch (cause) {
      setError(avatarRefusal(cause, t))
      setNote(null)
    } finally {
      setBusy(false)
    }
  }

  const onOutfitApplied = (next: AvatarConfigDto): void => {
    setCommitted(next)
    setDraft(null)
    setError(null)
    setNote('saved')
    if (playerId !== null) invalidate(playerId)
  }

  const preview = chibiFromApi(config, items, bases) ?? defaultChibi('preview')

  return (
    <main className={`${s.page} ${s.wide}`}>
      <div className={s.pageHead}>
        <h1>{t('wardrobe.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>

      <div className={w.layout}>
        <div className={w.previewColumn}>
          <div className={w.previewFigures}>
            <Chibi subject={preview} frame="full" size={192} expression={expression} label={t('wardrobe.title')} />
            {tab === 'frame' ? <Chibi subject={preview} frame="head" size={96} expression={expression} /> : null}
          </div>

          <div className={w.expressionRow} role="group" aria-label={t('wardrobe.expression.legend')}>
            {EXPRESSIONS.map((expr) => (
              <button
                key={expr}
                type="button"
                className={w.expressionBtn}
                aria-pressed={expression === expr}
                aria-label={t(`wardrobe.expression.${expr}`)}
                onClick={() => setExpression(expr)}
              >
                {t(`wardrobe.expression.${expr}`)}
              </button>
            ))}
          </div>

          {error === null ? null : (
            <p className={s.alert} role="alert">
              {error}
            </p>
          )}
          {note === null ? null : (
            <p className={s.notice} role="status">
              {t('wardrobe.saved')}
            </p>
          )}

          <Button variant="gold" size="lg" loading={busy} onClick={() => void save()} disabled={!dirty && draft === null}>
            {t('wardrobe.save')}
          </Button>
        </div>

        <div className={w.picker}>
          <div className={w.tabs} role="tablist" aria-label={t('wardrobe.title')}>
            {TABS.map((key) => (
              <button
                key={key}
                type="button"
                className={w.tab}
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {t(`wardrobe.tabs.${key}`)}
              </button>
            ))}
          </div>

          {tab === 'base' ? (
            <BaseTab bases={loaded.avatarCatalog.bases} draft={config} items={items} onPick={pickBase} />
          ) : tab === 'words' ? (
            <>
              <h3 className={s.groupTitle}>{t('wardrobe.tabs.words')}</h3>
              <ItemTab
                slot="title"
                catalog={loaded.catalog}
                owned={owned}
                achievements={loaded.achievements}
                draft={config}
                onPick={(id) => pick('title', id)}
              />
              <ItemTab
                slot="badge"
                catalog={loaded.catalog}
                owned={owned}
                achievements={loaded.achievements}
                draft={config}
                onPick={(id) => pick('badge', id)}
              />
            </>
          ) : (
            <ItemTab
              slot={tab}
              catalog={loaded.catalog}
              owned={owned}
              achievements={loaded.achievements}
              draft={config}
              onPick={(id) => pick(tab, id)}
            />
          )}
        </div>
      </div>

      <OutfitBar
        api={api}
        outfits={loaded.outfits}
        draft={config}
        items={items}
        bases={bases}
        onOutfitsChanged={(next) => wardrobe.set({ ...loaded, outfits: next })}
        onApplied={onOutfitApplied}
      />

      <Modal open={leavingTo !== null} title={t('wardrobe.leaveTitle')} closeLabel={t('wardrobe.close')} onClose={() => setLeavingTo(null)}>
        <p>{t('wardrobe.leaveBody')}</p>
        <div className={s.stageActions}>
          <Button variant="gold" onClick={() => setLeavingTo(null)}>
            {t('wardrobe.leaveStay')}
          </Button>
          <Button variant="ghost" onClick={leave}>
            {t('wardrobe.leaveDiscard')}
          </Button>
        </div>
      </Modal>
    </main>
  )
}
