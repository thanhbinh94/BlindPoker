import { Badge, Button, Field, Panel, Select } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  GEOMETRIC_SLOTS,
  OPTIONAL_SLOTS,
  type AvatarConfigDto,
  type GeometricSlot,
  type InventoryDto,
  type ItemSlot,
  type NormalApi,
  type OwnedItemDto,
} from '../api.js'
import { PartPortrait, Portrait } from '../avatar3d/Portrait.js'
import { avatarPayload, DEFAULT_HAIR_COLOR, HAIR_PRESETS, HEX_COLOR, withSlot } from '../avatar3d/config.js'
import { useAvatars } from '../avatar/useAvatars.js'
import { itemName } from '../catalog-i18n.js'
import { RARITY_TONE } from './catalog.js'
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

export interface AvatarScreenProps {
  api: NormalApi
  /**
   * Whose face this is. The saved config is pushed straight into the header above, but the *shared* cache —
   * what the table and the lobby bar draw from — has a minute-long entry that would otherwise keep showing
   * the old face, so it is dropped by id after a save.
   */
  playerId: string | null
}

interface PickerProps {
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
function SlotPicker({ slot, items, config, onPick }: PickerProps) {
  const { t } = useTranslation('normal')
  const optional = (OPTIONAL_SLOTS as readonly string[]).includes(slot)
  const value = config[slot] ?? ''

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
              name={`avatar-${slot}`}
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
              name={`avatar-${slot}`}
              aria-label={itemName(item.itemId, t)}
              checked={value === item.itemId}
              onChange={() => onPick(item.itemId)}
            />
            <PartPortrait className={s.thumb} config={config} slot={slot} itemId={item.itemId} />
            <span className={s.tileName}>{itemName(item.itemId, t)}</span>
            {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * The wardrobe: pick a piece per slot, a colour for the hair, a title and a badge, and save the lot.
 *
 * This is the **interim** v2 screen. Plan 8's Task 4 replaces it with a `AvatarStage` and the body, skin and
 * eye pickers design §6 asks for; what is here is the Plan 6 wardrobe carried across to the v2 slots so the
 * `/avatar` route keeps working in between — which matters, because everything else in this task (the
 * portraits, the cache, the item tiles) is only observable through a screen that can equip something.
 *
 * Everything offered here is owned — the picker lists `GET /api/me/inventory`, never the catalogue — so the
 * only refusal a correct client can provoke is a race with a grant, and the server's codes are mapped anyway
 * because a `PUT` that says no with no words is a save button that appears to do nothing.
 *
 * There is no dirty-state guard on navigation: leaving with unsaved changes loses them silently. Design §6
 * asks for one; it belongs with the screen that replaces this.
 */
export function AvatarScreen({ api, playerId }: AvatarScreenProps) {
  const { t } = useTranslation('normal')
  const wardrobe = useAsync<InventoryDto>(() => api.inventory())
  const { invalidate } = useAvatars(api, NO_IDS)

  /** The edited config. `null` until the inventory lands, then seeded from what is equipped. */
  const [draft, setDraft] = useState<AvatarConfigDto | null>(null)
  /** What is in the free colour box, which may be half-typed and therefore not a colour yet. */
  const [colorText, setColorText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const inventory = wardrobe.data
  const config = draft ?? inventory?.avatar ?? null
  const owned = useMemo(() => inventory?.items ?? [], [inventory])

  if (wardrobe.loading && inventory === null) {
    return (
      <main className={s.page}>
        <p className={s.footnote} role="status">
          {t('screens.loading')}
        </p>
      </main>
    )
  }

  if (config === null) {
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
    setSaved(false)
    setError(null)
  }

  const pick = (slot: GeometricSlot, itemId: string): void => commit(withSlot(config, slot, itemId))
  const setTitle = (id: string): void => commit(withSlot(config, 'title', id))
  const setBadgeItem = (id: string): void => commit(withSlot(config, 'badge', id))

  const hairColor = config.hairColor || DEFAULT_HAIR_COLOR
  const typed = colorText ?? hairColor
  const colorValid = HEX_COLOR.test(typed)

  const onColorText = (next: string): void => {
    setColorText(next)
    setSaved(false)
    setError(null)
    if (HEX_COLOR.test(next)) setDraft({ ...config, hairColor: next })
  }

  const onPreset = (preset: string): void => {
    setColorText(preset)
    commit({ ...config, hairColor: preset })
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
      setDraft(answer.config)
      setColorText(null)
      setError(null)
      setSaved(true)
      if (playerId !== null) invalidate(playerId)
    } catch (cause) {
      setError(avatarRefusal(cause, t))
      setSaved(false)
    } finally {
      setBusy(false)
    }
  }

  const slotOptions = (slot: ItemSlot): { value: string; label: string }[] => [
    { value: '', label: t('avatar.none') },
    ...ownedIn(owned, slot).map((item) => ({ value: item.itemId, label: itemName(item.itemId, t) })),
  ]

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('avatar.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('avatar.lead')}</p>

      <div className={s.previewCard}>
        <Portrait config={config} size="lg" label={t('avatar.mine')} />
        <div className={s.previewSide}>
          {error === null ? null : (
            <p className={s.alert} role="alert">
              {error}
            </p>
          )}
          {saved ? (
            <p className={s.notice} role="status">
              {t('avatar.saved')}
            </p>
          ) : null}
          <Button variant="gold" size="lg" loading={busy} onClick={() => void save()}>
            {t('avatar.save')}
          </Button>
        </div>
      </div>

      <Panel title={t('avatar.hairColor')}>
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
      </Panel>

      {GEOMETRIC_SLOTS.map((slot) => (
        <SlotPicker key={slot} slot={slot} items={ownedIn(owned, slot)} config={config} onPick={(itemId) => pick(slot, itemId)} />
      ))}

      <Panel>
        <div className={s.slots}>
          <Field label={t('avatar.titleSlot')}>
            <Select value={config.title ?? ''} options={slotOptions('title')} onChange={setTitle} />
          </Field>
          <Field label={t('avatar.badgeSlot')}>
            <Select value={config.badge ?? ''} options={slotOptions('badge')} onChange={setBadgeItem} />
          </Field>
        </div>
      </Panel>
    </main>
  )
}
