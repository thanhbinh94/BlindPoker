import { Badge, Button, Field, Panel, Select } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, type AvatarConfigDto, type InventoryDto, type ItemCategory, type NormalApi, type OwnedItemDto } from '../api.js'
import { Avatar } from '../avatar/Avatar.js'
import { PartThumb } from '../avatar/PartThumb.js'
import { DEFAULT_HAIR_COLOR, HAIR_PRESETS, LAYER_ORDER, type AvatarLayer } from '../avatar/parts.js'
import { useAvatars } from '../avatar/useAvatars.js'
import { RARITY_TONE } from './catalog.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

/** The two layers a player may leave empty; the other four always carry an item. */
export const OPTIONAL_LAYERS: AvatarLayer[] = ['accessory', 'jewelry']

/** The colour the free field will accept, and the same shape the server's `HAIR_COLOR` demands. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** Refusals this screen has words for; anything else is the kit's generic failure. */
const KNOWN_CODES = new Set(['NOT_OWNED', 'WRONG_CATEGORY', 'INVALID_COLOR', 'MISSING_LAYER', 'INVALID_ITEM'])

export function avatarRefusal(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError && KNOWN_CODES.has(cause.code)) return t(`avatar.errors.${cause.code}`)
  return t('common:errors.INTERNAL')
}

/** The owned items of one category, in catalogue order (which is the order the server sent them). */
function ownedIn(items: OwnedItemDto[], category: ItemCategory): OwnedItemDto[] {
  return items.filter((item) => item.category === category)
}

/**
 * One layer replaced, spelled out per slot.
 *
 * The obvious `{ ...config, [layer]: id }` is a computed key over a union, which types as a string index and
 * loses exactly the distinction this function exists to keep: the four required layers cannot hold
 * `undefined`, and the two optional ones must, because that is how an empty slot is sent.
 */
function withLayer(config: AvatarConfigDto, layer: AvatarLayer, itemId: string): AvatarConfigDto {
  const optional = itemId === '' ? undefined : itemId
  switch (layer) {
    case 'base':
      return { ...config, base: itemId }
    case 'face':
      return { ...config, face: itemId }
    case 'clothing':
      return { ...config, clothing: itemId }
    case 'hair':
      return { ...config, hair: itemId }
    case 'accessory':
      return { ...config, accessory: optional }
    default:
      return { ...config, jewelry: optional }
  }
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
  layer: AvatarLayer
  items: OwnedItemDto[]
  /** The equipped item, or `''` for an empty optional slot. */
  value: string
  hairColor: string
  onPick: (itemId: string) => void
}

/**
 * One layer's worth of choices, as a radio group.
 *
 * Radios rather than a listbox because that is what this is — one of n, all visible, changeable with the
 * arrow keys — and because a tile that is a `<label>` around its own input gives the whole 44 px square to
 * the thumb without any of the pointer wiring a div would need. The name is on the input rather than in the
 * label text so a screen reader hears "Áo dài", not "Áo dài, rare, epic".
 */
function LayerPicker({ layer, items, value, hairColor, onPick }: PickerProps) {
  const { t } = useTranslation('normal')
  const optional = OPTIONAL_LAYERS.includes(layer)

  return (
    <fieldset className={s.picker}>
      <legend className={s.groupTitle}>{t(`avatar.layer.${layer}`)}</legend>
      {items.length === 0 && !optional ? <p className={s.footnote}>{t('avatar.empty')}</p> : null}
      <div className={s.tiles}>
        {optional ? (
          <label className={s.tile}>
            <input
              className={s.tileInput}
              type="radio"
              name={`avatar-${layer}`}
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
              name={`avatar-${layer}`}
              aria-label={t(`items.${item.itemId}`)}
              checked={value === item.itemId}
              onChange={() => onPick(item.itemId)}
            />
            <PartThumb
              className={s.thumb}
              assetKey={item.assetKey ?? `${layer}/${item.itemId}`}
              {...(layer === 'hair' ? { hairColor } : {})}
            />
            <span className={s.tileName}>{t(`items.${item.itemId}`)}</span>
            {item.rarity === null ? null : <Badge tone={RARITY_TONE[item.rarity]}>{t(`inventory.rarity.${item.rarity}`)}</Badge>}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/**
 * The wardrobe: pick a piece per layer, a colour for the hair, a title and a badge, and save the lot.
 *
 * Everything offered here is owned — the picker lists `GET /api/me/inventory`, never the catalogue — so the
 * only refusal a correct client can provoke is a race with a grant, and the server's four codes are mapped
 * anyway because a `PUT` that says no with no words is a save button that appears to do nothing.
 *
 * There is no dirty-state guard on navigation: leaving with unsaved changes loses them silently. That is a
 * deliberate omission for this task, noted so the next one can decide whether it is worth a dialog.
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
  const byCategory = useMemo(() => inventory?.items ?? [], [inventory])

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

  const pick = (layer: AvatarLayer, itemId: string): void => commit(withLayer(config, layer, itemId))
  const setTitle = (id: string): void => commit({ ...config, title: id === '' ? undefined : id })
  const setBadgeItem = (id: string): void => commit({ ...config, badge: id === '' ? undefined : id })

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

  /** The full config, with the optional slots *omitted* rather than emptied — the server reads `''` as a bad id. */
  const payload = (): AvatarConfigDto => ({
    base: config.base,
    face: config.face,
    clothing: config.clothing,
    hair: config.hair,
    hairColor,
    ...(config.accessory === undefined ? {} : { accessory: config.accessory }),
    ...(config.jewelry === undefined ? {} : { jewelry: config.jewelry }),
    ...(config.title === undefined ? {} : { title: config.title }),
    ...(config.badge === undefined ? {} : { badge: config.badge }),
  })

  const save = async (): Promise<void> => {
    if (busy) return
    if (!colorValid) {
      setError(t('avatar.hairInvalid'))
      return
    }
    setBusy(true)
    try {
      const answer = await api.setAvatar(payload())
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

  const slotOptions = (category: ItemCategory): { value: string; label: string }[] => [
    { value: '', label: t('avatar.none') },
    ...ownedIn(byCategory, category).map((item) => ({ value: item.itemId, label: t(`items.${item.itemId}`) })),
  ]

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('avatar.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('avatar.lead')}</p>

      <div className={s.previewCard}>
        <Avatar config={config} size="lg" label={t('avatar.mine')} />
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
        <Field
          label={t('avatar.hairCustom')}
          hint={t('avatar.hairHint')}
          error={colorValid ? undefined : t('avatar.hairInvalid')}
        >
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

      {LAYER_ORDER.map((layer) => (
        <LayerPicker
          key={layer}
          layer={layer}
          items={ownedIn(byCategory, layer)}
          value={config[layer] ?? ''}
          hairColor={hairColor}
          onPick={(itemId) => pick(layer, itemId)}
        />
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
