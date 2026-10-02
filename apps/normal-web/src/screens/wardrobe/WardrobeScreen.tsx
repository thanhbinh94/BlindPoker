import { Button, defaultChibi, Modal, useMediaQuery, type Expression } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  OPTIONAL_SLOTS,
  SLOTS,
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
import { counts, GROUPS, PHONE_QUERY, panelId, slotCards, subTabId, type TabId } from './categories.js'
import { CategoryNav } from './CategoryNav.js'
import { ColourTab } from './ColourTab.js'
import { EquippedList } from './EquippedList.js'
import { ItemTab } from './ItemTab.js'
import { SavedOutfits } from './SavedOutfits.js'
import { StagePanel } from './StagePanel.js'
import w from './wardrobe.module.css'

/** Refusals this screen has words for; anything else is the kit's generic failure. */
const KNOWN_CODES = new Set(['NOT_OWNED', 'WRONG_CATEGORY', 'MISSING_LAYER', 'INVALID_ITEM', 'INVALID_BASE'])

export function avatarRefusal(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && KNOWN_CODES.has(cause.code)) return t(`avatar.errors.${cause.code}`)
  return t('common:errors.INTERNAL')
}

/** Every tab, flattened out of `GROUPS` (design §3.1) rather than re-listed here, so a tab added to a
 * group is automatically one this screen counts and offers a panel for. */
const ALL_TABS: readonly TabId[] = GROUPS.flatMap((group) => group.tabs)

/** `useAvatars` wants an array it can key on; a fresh `[]` per render would restart its effect forever. */
const NO_IDS: string[] = []

/** Plain-glyph icons (aria-hidden, matching `EquippedList`/`SavedOutfits`'s own convention): the phone
 * header's icon-only "Hoàn tác" (design §3.2). */
const UNDO_GLYPH = '↺'

/** Breakpoints (Global Constraints): phone (`PHONE_QUERY`, `./categories.js` — shared with `BaseTab`, which
 * used to carry its own copy of the same literal string) is anything under the tablet floor; desktop is
 * the point the stage stops being `compact` (design §3.1–§3.3). Tablet has no query of its own — it is
 * "not phone, not desktop", the same branch as desktop for markup, told apart only by CSS. */
const DESKTOP_QUERY = '(min-width: 1024px)'

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

/** Two configurations are the same outfit when they name the same slots — read off both objects key by
 * key (`v`, `base`, then every item slot) rather than via `JSON.stringify`, which used to make this
 * comparison sensitive to *key order*: removing an optional slot and then re-adding it moves that key to
 * the end of the spread object (`withSlot`'s `{ ...config, [slot]: itemId }`), so two configs naming the
 * exact same outfit could stringify to two different strings and show a false "Có thay đổi chưa lưu". A
 * slot absent from one side and one explicitly `undefined` on the other now compare equal either way,
 * exactly as `withSlot`'s own "an omitted key is an empty slot" rule already treats them. */
function sameConfig(a: AvatarConfigDto, b: AvatarConfigDto): boolean {
  if (a.v !== b.v || a.base !== b.base) return false
  return SLOTS.every((slot) => a[slot] === b[slot])
}

type Note = 'saved' | null

/**
 * The wardrobe (design §3.1–§3.3): a header with the dirty label, undo and save; a left column of the
 * stage, the expression row, the wearing list and the saved outfits; a right column of `CategoryNav`'s
 * groups/tabs/filter and the active tab's cards. Phones fold the same pieces into one column, the wearing
 * list and saved outfits collapsed under `<details>`.
 *
 * Only what is owned can be equipped — the tabs list what the player owns, and with "Hiện cả món chưa có" ticked
 * the whole catalogue, where `ItemTab` locks anything not in the player's inventory (No11a) — so the only refusal a
 * correct client can provoke is a race with a grant, and
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
  const [tab, setTab] = useState<TabId>('base')
  /** "Hiện cả món chưa có" (design §3.1 item 3, §5.5; No11a): unticked whenever the wardrobe opens, then kept for the
   * visit across every tab change — never reset by `changeTab`, never stored. */
  const [showLocked, setShowLocked] = useState(false)
  const [expression, setExpression] = useState<Expression>('neutral')
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)
  /** The `#/…` a guarded click was heading for, while the confirmation is up. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)

  const phone = useMediaQuery(PHONE_QUERY)
  const desktop = useMediaQuery(DESKTOP_QUERY)

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
  /** Every tab's "n/m đã có" (design §3.1) — computed for all of them up front so `CategoryNav` has a
   * count ready the moment its active group changes, not just for whichever group is showing now. */
  const tabCounts = useMemo(() => {
    const catalog = loaded?.catalog ?? []
    const map: Partial<Record<TabId, { owned: number; total: number }>> = {}
    for (const id of ALL_TABS) {
      const count = counts(id, catalog, owned)
      if (count !== null) map[id] = count
    }
    return map
  }, [loaded, owned])

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

  /** A tab change from `CategoryNav` itself or from a jump off the wearing list. The "Hiện cả món chưa có" box keeps
   * its value across it (design §5.5, No11a — it used to reset the old filter to "all"). */
  const changeTab = (next: TabId): void => {
    setTab(next)
  }

  /** "Hoàn tác" (design §5.1): the draft goes back to the last saved config, no server round trip — the
   * same "clear the draft" `leave()` does, plus dropping whatever error/notice was on screen, since both
   * were about the draft this just threw away. */
  const undo = (): void => {
    setDraft(null)
    setError(null)
    setNote(null)
  }

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
  // Which cut of a gendered item the tiles show: the *draft* base's, so picking a male figure switches
  // the dealer uniform's tile to the trousers the preview beside it is now wearing.
  const wear = bases.get(config.base)?.wear
  // The words tab's one empty line (No11a): neither of its two slots has a card to list. Asked of the same
  // `slotCards` each `ItemTab` draws from, so the line and the two (then absent) headings never disagree.
  const wordsEmpty =
    tab === 'words' && (['title', 'badge'] as const).every((slot) => slotCards(slot, loaded.catalog, owned, showLocked).length === 0)
  // The phone header's collapsible "Đang mặc (n)" summary (design §3.2): the two always-filled rows
  // (Thân, Trang phục) plus however many of `api.ts`'s own `OPTIONAL_SLOTS` the draft currently fills —
  // the same eight slots `EquippedList`'s `ROWS` lists past `base`/`outfit`, read off the one source
  // rather than a second copy of the list kept here.
  const equippedCount = 2 + OPTIONAL_SLOTS.filter((slot) => config[slot] !== undefined).length
  // The full-body figure's own width (V5 fix): `Chibi`'s "full" frame is a fixed 6:7 box, so a width of
  // `stage_height * 6/7` is exactly the width whose height equals the stage around it — the figure then
  // fits with no clip at all. Desktop keeps the tighter frame it was tuned to — 320 wide into a 330 px stage
  // clipped a verified-safe ~43 px (11.5 %) off a 373 px figure; the stage is 300 px since layout audit L5
  // (it gave the column the room to show the saved outfits), and 290 wide keeps that same 11.5 %. The
  // 280/250 px tablet/phone stages get the zero-clip number instead, since there is no verified-safe amount
  // to reproduce for them.
  const stageFullSize = phone ? 214 : desktop ? 290 : 240

  const stageNode = (
    <StagePanel
      subject={preview}
      expression={expression}
      onExpression={setExpression}
      portrait={tab === 'frame'}
      compact={!desktop}
      fullSize={stageFullSize}
    />
  )

  const equippedNode = (
    <EquippedList
      config={config}
      items={items}
      bases={bases}
      onRemove={(slot) => commit(withSlot(config, slot, undefined))}
      onJump={changeTab}
    />
  )

  const savedNode = (
    <SavedOutfits
      api={api}
      outfits={loaded.outfits}
      draft={config}
      items={items}
      bases={bases}
      onOutfitsChanged={(next) => wardrobe.set({ ...loaded, outfits: next })}
      onApplied={onOutfitApplied}
    />
  )

  const pickerNode = (
    <div className={w.picker}>
      <CategoryNav tab={tab} onTab={changeTab} counts={tabCounts} showLocked={showLocked} onShowLocked={setShowLocked} showFilter={tab !== 'base'} />

      {tab === 'base' ? (
        <BaseTab bases={loaded.avatarCatalog.bases} draft={config} items={items} onPick={pickBase} panelId={panelId('base')} labelledBy={subTabId('base')} />
      ) : tab === 'words' ? (
        // One `tabpanel` for the whole tab (design §7) — `title` and `badge` are two `ItemTab` calls, not
        // two tabs, and a `role="tabpanel"` has to appear exactly once for the sub-tab that names it;
        // wrapping both calls here (rather than letting each draw its own, as it used to) is what keeps
        // their headings *inside* the one panel too, instead of sitting outside any panel at all. A slot with
        // nothing to list draws nothing, heading included; with both empty the panel says so once (No11a).
        // Holding only the empty line, the panel takes the focus itself (the ARIA tabs pattern).
        <div role="tabpanel" id={panelId('words')} aria-labelledby={subTabId('words')} tabIndex={wordsEmpty ? 0 : undefined}>
          {wordsEmpty ? <p className={w.emptyOwned}>{t('wardrobe.emptyOwned')}</p> : null}
          <ItemTab
            slot="title"
            catalog={loaded.catalog}
            owned={owned}
            achievements={loaded.achievements}
            draft={config}
            wear={wear}
            showLocked={showLocked}
            onPick={(id) => pick('title', id)}
          />
          <ItemTab
            slot="badge"
            catalog={loaded.catalog}
            owned={owned}
            achievements={loaded.achievements}
            draft={config}
            wear={wear}
            showLocked={showLocked}
            onPick={(id) => pick('badge', id)}
          />
        </div>
      ) : tab === 'hairColor' || tab === 'eyeColor' ? (
        <ColourTab
          slot={tab}
          catalog={loaded.catalog}
          owned={owned}
          achievements={loaded.achievements}
          draft={config}
          showLocked={showLocked}
          onPick={(id) => commit(withSlot(config, tab, id))}
          panelId={panelId(tab)}
          labelledBy={subTabId(tab)}
        />
      ) : (
        <ItemTab
          slot={tab}
          catalog={loaded.catalog}
          owned={owned}
          achievements={loaded.achievements}
          draft={config}
          wear={wear}
          showLocked={showLocked}
          onPick={(id) => pick(tab, id)}
          panelId={panelId(tab)}
          labelledBy={subTabId(tab)}
        />
      )}
    </div>
  )

  return (
    <main className={`${s.page} ${s.wide}`}>
      {/* Title, gold rule, actions: the lobby's title row, so the two wide screens read alike (layout audit U3). */}
      <div className={w.header}>
        <h1 className={w.title}>{t('wardrobe.title')}</h1>
        {!dirty ? null : (
          <span className={w.dirtyLabel} role="status">
            {t('wardrobe.dirty')}
          </span>
        )}
        <span className={s.rule} aria-hidden="true" />
        <div className={w.headerActions}>
          <Button variant="ghost" onClick={undo} disabled={!dirty} aria-label={phone ? t('wardrobe.undo') : undefined}>
            {phone ? <span aria-hidden="true">{UNDO_GLYPH}</span> : t('wardrobe.undo')}
          </Button>
          <Button variant="gold" loading={busy} onClick={() => void save()} disabled={!dirty && draft === null}>
            {phone ? t('wardrobe.saveShort') : t('wardrobe.save')}
          </Button>
        </div>
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

      {!phone ? (
        <div className={w.layout}>
          <div className={w.previewColumn}>
            {stageNode}
            {equippedNode}
            {savedNode}
          </div>
          {pickerNode}
        </div>
      ) : (
        <div className={w.layout}>
          {stageNode}
          {pickerNode}
          <details className={w.mobileSection}>
            <summary className={w.mobileSummary}>{t('wardrobe.equipped.count', { n: equippedCount })}</summary>
            {equippedNode}
          </details>
          <details className={w.mobileSection}>
            <summary className={w.mobileSummary}>{t('outfits.title')}</summary>
            {savedNode}
          </details>
        </div>
      )}

      <Modal
        open={leavingTo !== null}
        title={t('wardrobe.leaveTitle')}
        closeLabel={t('wardrobe.close')}
        onClose={() => setLeavingTo(null)}
        footer={
          <>
            <Button variant="gold" onClick={() => setLeavingTo(null)}>
              {t('wardrobe.leaveStay')}
            </Button>
            <Button variant="ghost" onClick={leave}>
              {t('wardrobe.leaveDiscard')}
            </Button>
          </>
        }
      >
        <p>{t('wardrobe.leaveBody')}</p>
      </Modal>
    </main>
  )
}
