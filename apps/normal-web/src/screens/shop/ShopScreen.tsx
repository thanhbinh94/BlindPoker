import { Button, defaultChibi, formatPoints, Modal, Segmented, useMediaQuery, type Language } from '@bp/ui-kit'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  type AvatarCatalogDto,
  type AvatarConfigDto,
  type ItemDto,
  type ItemSlot,
  type NormalApi,
  type Rarity,
  type ShopEntryDto,
  type ShopViewDto,
} from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import { useAvatars } from '../../avatar/useAvatars.js'
import { itemName } from '../../catalog-i18n.js'
import n from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import { avatarRefusal } from '../wardrobe/avatar-refusal.js'
import { newPurchaseId } from './purchase-id.js'
import { ShopCard } from './ShopCard.js'
import { ShopStage, type StageLayout } from './ShopStage.js'
import s from './shop.module.css'

/** Refusals the shop has words for (`shop.refusal.*`): the server said no, and the same press would only hear it again. */
const REFUSALS = new Set(['SHOP_DISABLED', 'RANK_TOO_LOW', 'ALREADY_OWNED', 'INSUFFICIENT_POINTS', 'PURCHASE_UNDONE', 'UNKNOWN_ITEM'])

const PHONE_QUERY = '(max-width: 767px)'
const DESKTOP_QUERY = '(min-width: 1024px)'

const RARITIES: readonly Rarity[] = ['common', 'rare', 'epic']

/** The slot filter (spec §3 B3): every slot the shop sells, the two colours folded into one "Màu sắc". */
type SlotFilter = 'all' | 'head' | 'face' | 'outfit' | 'aura' | 'frame' | 'title' | 'badge' | 'colour'
const FILTERS: readonly SlotFilter[] = ['all', 'head', 'face', 'outfit', 'aura', 'frame', 'title', 'badge', 'colour']

/** Each filter's words: the wardrobe's own tab and heading names, so a slot reads the same on both screens. */
const FILTER_KEY: Record<SlotFilter, string> = {
  all: 'shop.slot.all',
  head: 'wardrobe.tabs.head',
  face: 'wardrobe.tabs.face',
  outfit: 'wardrobe.tabs.outfit',
  aura: 'wardrobe.tabs.aura',
  frame: 'wardrobe.tabs.frame',
  title: 'wardrobe.words.titles',
  badge: 'wardrobe.words.badges',
  colour: 'shop.slot.colour',
}

const COLOUR_SLOTS = new Set<ItemSlot>(['hairColor', 'eyeColor', 'skinColor'])
/** The body's own looks: free in the wardrobe for everyone, so the shop shows one only when it is sold. */
const LOOK_SLOTS = new Set<ItemSlot>(['hairStyle', ...COLOUR_SLOTS])

/**
 * Whether a row belongs on the rarity shelves. A free hairstyle, skin tone, hair or eye colour is the wardrobe's to
 * hand out, so it never shows — today that is every hairstyle and skin tone, and "Màu sắc" lists the colours that sell
 * (spec §3 B3: the rare and epic colours); a priced one would show. Every other item shows, sold or with its source
 * label (spec §3 B1).
 */
function onShelves(entry: ShopEntryDto): boolean {
  return !(LOOK_SLOTS.has(entry.slot) && entry.lock?.kind === 'free')
}

function matches(entry: ShopEntryDto, filter: SlotFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'colour') return COLOUR_SLOTS.has(entry.slot)
  return entry.slot === filter
}

/** A slot's place on a shelf: the filters' own order, the colours together, anything without a filter last. */
function slotOrder(slot: ItemSlot): number {
  const filter: SlotFilter | null = COLOUR_SLOTS.has(slot) ? 'colour' : (FILTERS as readonly string[]).includes(slot) ? (slot as SlotFilter) : null
  return filter === null ? FILTERS.length : FILTERS.indexOf(filter)
}

const bySlotThenId = (a: ShopEntryDto, b: ShopEntryDto): number =>
  slotOrder(a.slot) - slotOrder(b.slot) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0)

/** A 4xx the shop has no words for (a malformed request): the same press would fail the same way, so no retry. */
function isClientError(cause: unknown): boolean {
  return cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 429
}

/** `2026-W43` → week 43 of 2026; anything else is shown as it came. */
function weekParts(weekKey: string): { week: string; year: string } | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(weekKey)
  return match === null ? null : { week: String(Number(match[2])), year: match[1]! }
}

interface ShopData {
  view: ShopViewDto
  catalog: ItemDto[]
  avatarCatalog: AvatarCatalogDto
  avatar: AvatarConfigDto
}

export interface ShopScreenProps {
  api: NormalApi
  lang: Language
  /** The live balance from the socket. A purchase's answer is shown until it moves (`onBalanceChanged` pushes it). */
  balance: number
  /** Whose face this is: a "Mặc luôn" refreshes the shared cache the lobby bar and the table draw from. */
  playerId: string | null
}

/**
 * The Cửa hàng (spec 2026-10-21 §3 B3, mockup B): the player's figure on the left, wearing whatever card was pressed
 * last; "Kệ tuần này" and the three rarity shelves on the right, each card the wardrobe's own with a footer that says
 * what can be done — buy it, how many points are missing, which rank it needs, or where it comes from.
 *
 * A try-on is client state only, merged over the saved outfit for the stage and nothing else. A purchase opens a
 * confirmation that names one `purchaseId` for as long as it is open, so a retry after a lost answer is the same
 * purchase, charged once. After a purchase the item stays on the figure with "Mặc luôn", which saves the saved outfit
 * plus whatever on try-on the player now owns.
 */
export function ShopScreen({ api, lang, balance, playerId }: ShopScreenProps) {
  const { t } = useTranslation('normal')
  const shop = useAsync<ShopData>(async () => {
    const [view, catalogAnswer, avatarCatalog, inventory] = await Promise.all([api.shop(), api.catalogItems(), api.avatarCatalog(), api.inventory()])
    return { view, catalog: catalogAnswer.items, avatarCatalog, avatar: inventory.avatar }
  })
  const { invalidate } = useAvatars(api, NO_IDS)

  const [shelf, setShelf] = useState<Rarity>('common')
  const [filter, setFilter] = useState<SlotFilter>('all')
  const [tryOn, setTryOn] = useState<Partial<AvatarConfigDto>>({})
  const [lastTried, setLastTried] = useState<ItemDto | null>(null)
  /** What this visit bought or was told it owns — on top of the view the server sent when the page opened. */
  const [bought, setBought] = useState<ReadonlySet<string>>(new Set())
  /** The saved outfit after a "Mặc luôn"; the inventory's until then. */
  const [saved, setSaved] = useState<AvatarConfigDto | null>(null)
  /** A purchase's balance, valid while the live one still reads what it read when the purchase answered. */
  const [paid, setPaid] = useState<{ live: number; balance: number } | null>(null)
  const [confirm, setConfirm] = useState<{ entry: ShopEntryDto; purchaseId: string } | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [buying, setBuying] = useState(false)
  const [justBought, setJustBought] = useState<string | null>(null)
  const [wearBusy, setWearBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  /**
   * Set, afresh, by each purchase: the dialog hands focus back to the "Mua" that opened it, which the purchase just replaced
   * with "✓ Đã có", so focus would fall to `<body>`. The effect runs after the dialog's cleanup and lands it on
   * "Mặc luôn", the next thing to do (or the card's "Mặc" link when the stage offers none).
   */
  const [focusWear, setFocusWear] = useState<{ itemId: string } | null>(null)
  const layoutRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (focusWear === null) return
    const root = layoutRef.current
    const target =
      root?.querySelector<HTMLElement>('[data-wear-now]') ?? root?.querySelector<HTMLElement>(`[data-item="${CSS.escape(focusWear.itemId)}"] a`)
    target?.focus()
  }, [focusWear])

  const phone = useMediaQuery(PHONE_QUERY)
  const desktop = useMediaQuery(DESKTOP_QUERY)
  const layout: StageLayout = phone ? 'phone' : desktop ? 'desktop' : 'tablet'

  const loaded = shop.data
  const items = useMemo(() => new Map((loaded?.catalog ?? []).map((item) => [item.id, item])), [loaded])
  const bodies = useMemo(() => new Map((loaded?.avatarCatalog.bodies ?? []).map((body) => [body.gender, body])), [loaded])
  const entries = useMemo(
    () =>
      (loaded?.view.entries ?? []).map((entry) =>
        bought.has(entry.itemId) && !entry.owned ? { ...entry, owned: true, purchasable: false } : entry,
      ),
    [loaded, bought],
  )

  if (shop.loading && loaded === null) {
    return (
      <main className={n.page}>
        <p className={n.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (loaded === null) {
    return (
      <main className={n.page}>
        <p className={n.alert} role="alert">
          {t('shop.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={shop.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </main>
    )
  }

  const { view } = loaded
  const shownBalance = paid !== null && paid.live === balance ? paid.balance : balance
  const owned = new Set(entries.filter((entry) => entry.owned).map((entry) => entry.itemId))
  const base = saved ?? loaded.avatar
  const config: AvatarConfigDto = { ...base, ...tryOn }
  const subject = chibiFromApi(config, items, bodies) ?? defaultChibi('shop')
  const trying = Object.keys(tryOn).length > 0
  const nameOf = (id: string): string => itemName(id, t)

  const tryItem = (item: ItemDto): void => {
    setTryOn((current) => ({ ...current, [item.slot]: item.id }))
    setLastTried(item)
    setJustBought(null)
  }

  const reset = (): void => {
    setTryOn({})
    setLastTried(null)
    setJustBought(null)
  }

  const openBuy = (entry: ShopEntryDto): void => {
    setConfirm({ entry, purchaseId: newPurchaseId() })
    setConfirmError(null)
    setAlert(null)
  }

  const buy = async (): Promise<void> => {
    if (confirm === null || buying) return
    setBuying(true)
    try {
      const result = await api.shopBuy(confirm.entry.itemId, confirm.purchaseId)
      // A repeated id answers what that id bought, which is this dialog's item — but the answer is the one to trust.
      const got = items.get(result.itemId)
      setBought((current) => new Set(current).add(result.itemId))
      setPaid({ live: balance, balance: result.balance })
      if (got !== undefined) {
        setTryOn((current) => ({ ...current, [got.slot]: got.id }))
        setLastTried(got)
      }
      setJustBought(result.itemId)
      setStatus(t('shop.bought', { item: nameOf(result.itemId) }))
      setConfirm(null)
      setFocusWear({ itemId: result.itemId })
    } catch (cause) {
      if (cause instanceof ApiError && REFUSALS.has(cause.code)) {
        // The server said no: the same press would hear it again, so the dialog closes and this id is done with.
        setConfirm(null)
        setStatus(null)
        setAlert(t(`shop.refusal.${cause.code}`))
        if (cause.code === 'ALREADY_OWNED') setBought((current) => new Set(current).add(confirm.entry.itemId))
        else if (cause.code !== 'INSUFFICIENT_POINTS') shop.reload()
      } else if (isClientError(cause)) {
        // A request the server could not read: nothing was bought, and pressing again would only be refused again.
        setConfirm(null)
        setStatus(null)
        setAlert(t('shop.failed'))
      } else {
        // No answer, or not one of the shop's: it may have gone through. The dialog stays, with the same id.
        setConfirmError(t('shop.retry'))
      }
    } finally {
      setBuying(false)
    }
  }

  /** "Mặc luôn": the saved outfit plus every try-on the player owns now — never one they do not, which the server refuses. */
  const wearNow = async (): Promise<void> => {
    if (wearBusy) return
    const next: AvatarConfigDto = { ...base }
    for (const [slot, id] of Object.entries(tryOn)) {
      if (typeof id === 'string' && owned.has(id)) Object.assign(next, { [slot]: id })
    }
    setWearBusy(true)
    try {
      const answer = await api.setAvatar(next)
      setSaved(answer.config)
      setTryOn({})
      setLastTried(null)
      setJustBought(null)
      setAlert(null)
      setStatus(t('shop.worn'))
      if (playerId !== null) invalidate(playerId)
    } catch (cause) {
      setAlert(avatarRefusal(cause, t))
    } finally {
      setWearBusy(false)
    }
  }

  const card = (entry: ShopEntryDto) => {
    const item = items.get(entry.itemId)
    if (item === undefined) return null
    return (
      <ShopCard
        key={entry.itemId}
        entry={entry}
        item={item}
        lang={lang}
        balance={shownBalance}
        rank={view.me.rank}
        wear={config.gender}
        trying={tryOn[item.slot] === item.id}
        onTry={tryItem}
        onBuy={openBuy}
      />
    )
  }

  const byId = new Map(entries.map((entry) => [entry.itemId, entry]))
  const featured = view.featured.slice(0, 6).flatMap((id) => {
    const entry = byId.get(id)
    return entry === undefined || !items.has(id) ? [] : [entry]
  })
  const shelfEntries = entries.filter((entry) => entry.rarity === shelf && onShelves(entry) && matches(entry, filter)).sort(bySlotThenId)
  const week = weekParts(view.weekKey)
  const confirmName = confirm === null ? '' : nameOf(confirm.entry.itemId)

  return (
    <main className={`${n.page} ${n.wide}`}>
      <div className={s.header}>
        <h1 className={s.title}>{t('shop.title')}</h1>
        <span className={n.rule} aria-hidden="true" />
      </div>

      <div className={s.layout} ref={layoutRef}>
        <ShopStage
          subject={subject}
          portrait={lastTried?.slot === 'frame' && tryOn.frame === lastTried.id}
          layout={layout}
          balance={shownBalance}
          lang={lang}
          standing={view.me}
          tryingName={trying && lastTried !== null ? nameOf(lastTried.id) : null}
          onReset={trying ? reset : undefined}
          onWearNow={justBought !== null && owned.has(justBought) ? () => void wearNow() : undefined}
          wearBusy={wearBusy}
          notice={
            alert === null && status === null ? null : (
              <>
                {alert === null ? null : (
                  <p className={`${n.alert} ${s.notice}`} role="alert">
                    {alert}
                  </p>
                )}
                {status === null ? null : (
                  <p className={`${n.notice} ${s.notice}`} role="status">
                    {status}
                  </p>
                )}
              </>
            )
          }
        />

        <div className={s.shelves}>
          {featured.length === 0 ? null : (
            <section className={s.section} aria-labelledby="shop-featured">
              <div className={s.sectionHead}>
                <h2 className={s.sectionTitle} id="shop-featured">
                  {t('shop.featured')}
                </h2>
                {week === null ? null : <span className={s.week}>{t('shop.week', week)}</span>}
              </div>
              <div className={s.grid} data-shelf="featured">
                {featured.map(card)}
              </div>
            </section>
          )}

          <section className={s.section} aria-label={t('shop.shelves')}>
            <Segmented
              label={t('shop.shelves')}
              options={RARITIES.map((value) => ({ value, label: t(`inventory.rarity.${value}`) }))}
              value={shelf}
              onChange={setShelf}
              className={s.shelfSwitch}
            />
            <div className={s.filters} role="group" aria-label={t('shop.slotFilter')}>
              {FILTERS.map((value) => (
                <button key={value} type="button" className={s.filter} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {t(FILTER_KEY[value])}
                </button>
              ))}
            </div>
            {shelfEntries.length === 0 ? (
              <p className={s.empty}>{t('shop.empty')}</p>
            ) : (
              <div className={s.grid} data-shelf={shelf}>
                {shelfEntries.map(card)}
              </div>
            )}
          </section>
        </div>
      </div>

      <Modal
        open={confirm !== null}
        title={t('shop.confirmTitle')}
        closeLabel={t('shop.close')}
        onClose={() => {
          if (!buying) setConfirm(null)
        }}
        footer={
          <>
            <Button variant="gold" loading={buying} onClick={() => void buy()}>
              {t('shop.buy')}
            </Button>
            <Button variant="ghost" disabled={buying} onClick={() => setConfirm(null)}>
              {t('shop.cancel')}
            </Button>
          </>
        }
      >
        {confirm === null ? null : (
          <p>
            {t('shop.confirm', {
              item: confirmName,
              price: formatPoints(confirm.entry.price, lang),
              left: formatPoints(Math.max(0, shownBalance - confirm.entry.price), lang),
            })}
          </p>
        )}
        {confirmError === null ? null : (
          <p className={n.alert} role="alert">
            {confirmError}
          </p>
        )}
      </Modal>
    </main>
  )
}

/** `useAvatars` wants an array it can key on; a fresh `[]` per render would restart its effect forever. */
const NO_IDS: string[] = []
