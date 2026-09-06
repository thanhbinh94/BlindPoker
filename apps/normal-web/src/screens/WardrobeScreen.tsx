import { Badge, Button, Field, Modal, Select } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  OPTIONAL_SLOTS,
  type AvatarConfigDto,
  type Body,
  type GeometricSlot,
  type InventoryDto,
  type ItemDto,
  type ItemSlot,
  type NormalApi,
  type OwnedItemDto,
} from '../api.js'
import { LazyAvatarStage } from '../avatar3d/LazyStage.js'
import { PartPortrait } from '../avatar3d/Portrait.js'
import {
  avatarPayload,
  BODIES,
  DEFAULT_HAIR_COLOR,
  EYE_COLORS,
  HAIR_PRESETS,
  HEX_COLOR,
  portraitRelevant,
  SKIN_TONES,
  switchBody,
  withSlot,
  type BodyFit,
} from '../avatar3d/config.js'
import { figureDescription } from '../avatar3d/description.js'
import { canonicalConfig } from '../avatar3d/hash.js'
import { useAvatars } from '../avatar/useAvatars.js'
import { itemName } from '../catalog-i18n.js'
import { RARITY_TONE, WARDROBE_SLOTS, WORD_SLOTS } from './catalog.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

/** Refusals this screen has words for; anything else is the kit's generic failure. */
const KNOWN_CODES = new Set(['NOT_OWNED', 'WRONG_CATEGORY', 'INVALID_COLOR', 'MISSING_LAYER', 'INVALID_ITEM'])

export function avatarRefusal(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && KNOWN_CODES.has(cause.code)) return t(`avatar.errors.${cause.code}`)
  return t('common:errors.INTERNAL')
}

/** The owned items of one slot, in catalogue order (which is the order the server sent them). */
function ownedIn(items: OwnedItemDto[], slot: ItemSlot): OwnedItemDto[] {
  return items.filter((item) => item.slot === slot)
}

/** `useAvatars` wants an array it can key on; a fresh `[]` per render would restart its effect forever. */
const NO_IDS: string[] = []

/**
 * What the wardrobe knows about geometry, out of the catalogue and the player's own shelf.
 *
 * The catalogue is fetched beside the inventory because `OwnedItemDto` does not carry `variants` — the
 * inventory says *what is mine*, the catalogue says *what it was modelled for*, and changing body needs
 * both. A catalogue that did not arrive answers "everything fits": stripping an outfit on the strength
 * of a request that failed would lose a player their clothes over a flaky network.
 */
export function bodyFit(catalog: ItemDto[], owned: OwnedItemDto[]): BodyFit {
  const rows = new Map(catalog.map((item) => [item.id, item]))
  const fits = (itemId: string, body: Body): boolean => {
    const row = rows.get(itemId)
    if (row === undefined || row.variants === undefined) return true
    return row.variants[body] !== undefined
  }

  return {
    fits,
    fallback(slot: GeometricSlot, body: Body): string | undefined {
      const wearable = ownedIn(owned, slot).filter((item) => fits(item.itemId, body))
      // The slot's default piece first — every account owns one for each required slot, and it is the
      // piece the server itself would have started them with.
      const standard = wearable.find((item) => rows.get(item.itemId)?.isDefault === true)
      return (standard ?? wearable[0])?.itemId
    },
  }
}

/** Two configurations are the same outfit when they say the same things, whatever objects they are. */
const sameConfig = (a: AvatarConfigDto, b: AvatarConfigDto): boolean => canonicalConfig(a) === canonicalConfig(b)

/* ── the pickers ───────────────────────────────────────────────────────────── */

interface SlotPickerProps {
  slot: GeometricSlot
  items: OwnedItemDto[]
  /** The whole configuration, because a tile previews this item *on the figure that will wear it*. */
  config: AvatarConfigDto
  onPick: (itemId: string) => void
}

/**
 * One slot's worth of choices, as a radio group.
 *
 * Radios rather than a listbox because that is what this is — one of n, all visible, changeable with the
 * arrow keys — and because a tile that is a `<label>` around its own input gives the whole 44 px square to
 * the thumb without any of the pointer wiring a div would need. The name is on the input rather than in the
 * label text so a screen reader hears "Áo dài", not "Áo dài, rare, epic".
 */
function SlotPicker({ slot, items, config, onPick }: SlotPickerProps) {
  const { t } = useTranslation('normal')
  const optional = (OPTIONAL_SLOTS as readonly string[]).includes(slot)
  const value = config[slot] ?? ''
  // What the tiles are drawn from: the configuration with everything the head-and-shoulders crop cannot
  // show taken out of it, so picking a pair of shoes does not change the cache key of every tile on the
  // screen. `PartPortrait` narrows what it is given anyway; doing it once here is what keeps the memo
  // inside each of forty tiles from being invalidated in the first place.
  const preview = useMemo(() => portraitRelevant(config), [config])

  return (
    <fieldset className={s.picker}>
      <legend className={s.groupTitle}>{t(`avatar.slot.${slot}`)}</legend>
      {items.length === 0 && !optional ? <p className={s.footnote}>{t('avatar.empty')}</p> : null}
      <div className={s.tiles}>
        {optional ? (
          <label className={s.tile}>
            <input
              className={s.tileInput}
              type="radio"
              name={`wardrobe-${slot}`}
              aria-label={t('avatar.none')}
              checked={value === ''}
              onChange={() => onPick('')}
            />
            <span className={s.thumbEmpty} aria-hidden="true" />
            <span className={s.tileName}>{t('avatar.none')}</span>
          </label>
        ) : null}

        {items.map((item) => (
          <label className={s.tile} key={item.itemId}>
            <input
              className={s.tileInput}
              type="radio"
              name={`wardrobe-${slot}`}
              aria-label={itemName(item.itemId, t)}
              checked={value === item.itemId}
              onChange={() => onPick(item.itemId)}
            />
            <PartPortrait className={s.thumb} config={preview} slot={slot} itemId={item.itemId} />
            <span className={s.tileName}>{itemName(item.itemId, t)}</span>
            {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

interface TonePickerProps {
  /** `skinTone` and `eyeColor` are the two name tables in the locale bundle, indexed by position. */
  kind: 'skinTone' | 'eyeColor'
  legend: string
  palette: readonly string[]
  value: string
  onPick: (color: string) => void
}

/**
 * A closed palette, as named swatches (design §6: "Da (8 tông có tên)", "Mắt (6)").
 *
 * The colours themselves are a copy of the server's — `palettes.test.ts` holds the copy to the file the
 * server validates against — and their *names* are indexed by position, so the accessible name of every
 * swatch is a word plus the hex behind it. A grid of unlabelled coloured circles is unusable by anyone
 * who cannot see it, and hard to talk about for everyone else.
 */
function TonePicker({ kind, legend, palette, value, onPick }: TonePickerProps) {
  const { t } = useTranslation('normal')
  const current = value.toLowerCase()

  return (
    <fieldset className={s.picker}>
      <legend className={s.groupTitle}>{legend}</legend>
      <div className={s.swatches}>
        {palette.map((color, at) => (
          <label className={s.swatchTile} key={color}>
            <input
              className={s.tileInput}
              type="radio"
              name={`wardrobe-${kind}`}
              aria-label={t('wardrobe.swatch', { name: t(`wardrobe.${kind}.${at}`), color })}
              checked={current === color}
              onChange={() => onPick(color)}
            />
            <span className={s.swatchDot} style={{ background: color }} aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* ── the screen ────────────────────────────────────────────────────────────── */

export interface WardrobeScreenProps {
  api: NormalApi
  /**
   * Whose face this is. The saved config is pushed straight into the stage, but the *shared* cache — what
   * the table and the lobby bar draw from — has a minute-long entry that would otherwise keep showing the
   * old face, so it is dropped by id after a save.
   */
  playerId: string | null
}

/** What the last action left to say. One at a time: the newest thing that happened is the useful one. */
type Note = 'saved' | 'reset' | null

/**
 * The wardrobe: a figure on a stage, and everything that goes on it (avatar-3d design §6).
 *
 * Three things here are not obvious from the markup:
 *
 * - **Only what is owned is offered.** The pickers list `GET /api/me/inventory`, never the catalogue, so
 *   the only refusal a correct client can provoke is a race with a grant — and the server's codes are
 *   mapped anyway, because a save that says no with no words is a button that appears to do nothing.
 * - **Changing body is a migration, not a field assignment.** The server refuses a configuration that
 *   wears an item on a body it was never modelled for, so the swap re-dresses the slots that would have
 *   become invalid and *says which* — a top that silently became the default tee is a top the player
 *   will think they lost. See `switchBody`.
 * - **Leaving with unsaved changes is guarded twice.** `beforeunload` covers a reload or a closed tab;
 *   a capture-phase click on any `#/…` link covers the rail, which is how every other route in this app
 *   is reached. Both are armed only while there is something to lose.
 */
export function WardrobeScreen({ api, playerId }: WardrobeScreenProps) {
  const { t } = useTranslation('normal')
  const wardrobe = useAsync<[InventoryDto, ItemDto[]]>(() =>
    Promise.all([
      api.inventory(),
      // A failed catalogue is not a failed wardrobe: it costs the body switch its knowledge of variants
      // (see `bodyFit`) and nothing else, so it must not blank the screen.
      api.catalogItems().then(
        (answer) => answer.items,
        () => [] as ItemDto[],
      ),
    ]),
  )
  const { invalidate } = useAvatars(api, NO_IDS)

  /** The edited config, `null` while it is untouched — so the saved one is always the baseline. */
  const [draft, setDraft] = useState<AvatarConfigDto | null>(null)
  /** What the server last acknowledged, once it has acknowledged anything this session. */
  const [committed, setCommitted] = useState<AvatarConfigDto | null>(null)
  /** What is in the free colour box, which may be half-typed and therefore not a colour yet. */
  const [colorText, setColorText] = useState<string | null>(null)
  const [changedSlots, setChangedSlots] = useState<GeometricSlot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)
  /** The `#/…` a guarded click was heading for, while the confirmation is up. */
  const [leavingTo, setLeavingTo] = useState<string | null>(null)

  const loaded = wardrobe.data
  const owned = useMemo(() => loaded?.[0].items ?? [], [loaded])
  const catalog = useMemo(() => loaded?.[1] ?? [], [loaded])
  const saved = committed ?? loaded?.[0].avatar ?? null
  const config = draft ?? saved
  const dirty = draft !== null && saved !== null && !sameConfig(draft, saved)

  const fit = useMemo(() => bodyFit(catalog, owned), [catalog, owned])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      // Two lines for one behaviour: `preventDefault` is the modern spelling, `returnValue` the one
      // several browsers still require. Neither lets us choose the words — the browser's own are used.
      event.preventDefault()
      event.returnValue = ''
    }
    /**
     * The in-app half of the guard.
     *
     * Every route in this app is a `#/…` link (the rail, the profile's quick nav, the lobby bar), and a
     * hash that has already changed cannot be un-changed without pushing a second history entry. So the
     * click is caught in the capture phase, *before* the browser acts on it, and the destination is held
     * until the player says what to do with it.
     */
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

  if (wardrobe.loading && loaded === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (config === null || saved === null) {
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

  /**
   * Take an edit, and clear everything the *previous* action left on screen.
   *
   * `changedSlots` goes with `note` and `error`: the "these slots had to change" line is a statement
   * about one body switch, and left standing it would read as a statement about whatever the player did
   * next. `onBody` sets it again after calling this, so the one action that has something to say still
   * says it.
   */
  const commit = (next: AvatarConfigDto): void => {
    setDraft(next)
    setChangedSlots([])
    setNote(null)
    setError(null)
  }

  const pick = (slot: GeometricSlot, itemId: string): void => commit(withSlot(config, slot, itemId))

  const onBody = (body: Body): void => {
    const swapped = switchBody(config, body, fit)
    commit(swapped.config)
    setChangedSlots(swapped.changed)
  }

  const hairColor = config.hairColor || DEFAULT_HAIR_COLOR
  const typed = colorText ?? hairColor
  const colorValid = HEX_COLOR.test(typed)

  const onColorText = (next: string): void => {
    setColorText(next)
    setChangedSlots([])
    setNote(null)
    setError(null)
    if (HEX_COLOR.test(next)) setDraft({ ...config, hairColor: next })
  }

  const onPreset = (preset: string): void => {
    setColorText(preset)
    commit({ ...config, hairColor: preset })
  }

  const undo = (): void => {
    setDraft(null)
    setColorText(null)
    setChangedSlots([])
    setError(null)
    setNote('reset')
  }

  const save = async (): Promise<void> => {
    if (busy) return
    if (!colorValid) {
      setError(t('avatar.hairInvalid'))
      return
    }
    setBusy(true)
    try {
      const answer = await api.setAvatar(avatarPayload({ ...config, hairColor }))
      setCommitted(answer.config)
      setDraft(null)
      setColorText(null)
      setChangedSlots([])
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

  /** Go where the guarded click was going. The guard is not in the way: this is not a click. */
  const leave = (): void => {
    const target = leavingTo
    setLeavingTo(null)
    setDraft(null)
    if (target !== null) window.location.hash = target
  }

  const slotOptions = (slot: ItemSlot): { value: string; label: string }[] => [
    { value: '', label: t('avatar.none') },
    ...ownedIn(owned, slot).map((item) => ({ value: item.itemId, label: itemName(item.itemId, t) })),
  ]

  return (
    <main className={`${s.page} ${s.wide}`}>
      <div className={s.pageHead}>
        <h1>{t('wardrobe.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('wardrobe.lead')}</p>

      <div className={s.wardrobe}>
        <div className={s.stageColumn}>
          <LazyAvatarStage config={config} mode="edit" description={figureDescription(config, t)} />

          {error === null ? null : (
            <p className={s.alert} role="alert">
              {error}
            </p>
          )}
          {note === null ? null : (
            <p className={s.notice} role="status">
              {t(note === 'saved' ? 'wardrobe.saved' : 'wardrobe.resetDone')}
            </p>
          )}
          {changedSlots.length === 0 ? null : (
            <p className={s.notice} role="status">
              {t('wardrobe.bodyChanged', { slots: changedSlots.map((slot) => t(`avatar.slot.${slot}`)).join(', ') })}
            </p>
          )}
          {dirty ? <p className={s.footnote}>{t('wardrobe.dirty')}</p> : null}

          <div className={s.stageActions}>
            <Button variant="gold" size="lg" loading={busy} onClick={() => void save()}>
              {t('wardrobe.save')}
            </Button>
            <Button variant="ghost" disabled={!dirty} onClick={undo}>
              {t('wardrobe.reset')}
            </Button>
          </div>
        </div>

        <div className={s.groups}>
          <fieldset className={s.picker}>
            <legend className={s.groupTitle}>{t('wardrobe.body')}</legend>
            <div className={s.tiles}>
              {BODIES.map((body) => (
                <label className={s.tile} key={body}>
                  <input
                    className={s.tileInput}
                    type="radio"
                    name="wardrobe-body"
                    aria-label={t(`wardrobe.bodyName.${body}`)}
                    checked={config.body === body}
                    onChange={() => onBody(body)}
                  />
                  <span className={s.tileName}>{t(`wardrobe.bodyName.${body}`)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <TonePicker kind="skinTone" legend={t('wardrobe.skin')} palette={SKIN_TONES} value={config.skin} onPick={(skin) => commit({ ...config, skin })} />
          <TonePicker kind="eyeColor" legend={t('wardrobe.eyes')} palette={EYE_COLORS} value={config.eyes} onPick={(eyes) => commit({ ...config, eyes })} />

          <fieldset className={s.picker}>
            <legend className={s.groupTitle}>{t('avatar.hairColor')}</legend>
            <div className={s.swatches}>
              {HAIR_PRESETS.map((preset) => (
                <button
                  className={s.swatch}
                  key={preset}
                  type="button"
                  style={{ background: preset }}
                  aria-label={t('avatar.hairPreset', { color: preset })}
                  aria-pressed={hairColor.toLowerCase() === preset.toLowerCase()}
                  onClick={() => onPreset(preset)}
                />
              ))}
            </div>
            <Field label={t('avatar.hairCustom')} hint={t('avatar.hairHint')} error={colorValid ? undefined : t('avatar.hairInvalid')}>
              <input
                className={s.input}
                type="text"
                value={typed}
                spellCheck={false}
                autoCapitalize="none"
                maxLength={7}
                onChange={(event) => onColorText(event.target.value)}
              />
            </Field>
          </fieldset>

          {WARDROBE_SLOTS.map((slot) => (
            <SlotPicker key={slot} slot={slot} items={ownedIn(owned, slot)} config={config} onPick={(itemId) => pick(slot, itemId)} />
          ))}

          <fieldset className={s.picker}>
            <legend className={s.groupTitle}>{t('wardrobe.words')}</legend>
            <div className={s.slots}>
              {WORD_SLOTS.map((slot) => (
                <Field key={slot} label={t(slot === 'title' ? 'avatar.titleSlot' : 'avatar.badgeSlot')}>
                  <Select value={config[slot] ?? ''} options={slotOptions(slot)} onChange={(id) => commit(withSlot(config, slot, id))} />
                </Field>
              ))}
            </div>
          </fieldset>
        </div>
      </div>

      <Modal open={leavingTo !== null} title={t('wardrobe.leaveTitle')} closeLabel={t('wardrobe.close')} onClose={() => setLeavingTo(null)}>
        <p>{t('wardrobe.leaveBody')}</p>
        <div className={s.stageActions}>
          <Button variant="gold" onClick={() => setLeavingTo(null)}>
            {t('wardrobe.leaveStay')}
          </Button>
          <Button variant="ghost" onClick={leave}>
            {t('wardrobe.leaveGo')}
          </Button>
        </div>
      </Modal>
    </main>
  )
}
