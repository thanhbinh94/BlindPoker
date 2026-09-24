import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, ItemDto } from '../../api.js'
import { itemName } from '../../catalog-i18n.js'
import { hintFor } from '../catalog.js'
import s from './wardrobe.module.css'

export interface ColourTabProps {
  slot: 'hairColor' | 'eyeColor'
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  /** `undefined` equips nothing — the base's own colour — which is what the "Natural" swatch sends. */
  onPick: (itemId: string | undefined) => void
}

/**
 * The hair-colour and eye-colour tabs (design §6): round swatches painted with each item's own
 * `colour`, one row, no picture — there is nothing to draw a colour *as* other than itself. The first
 * swatch is "Natural" (the base's own colour, no item at all) and is never locked; every other one
 * locks exactly like `ItemTab`'s tiles.
 */
export function ColourTab({ slot, catalog, owned, achievements, draft, onPick }: ColourTabProps) {
  const { t } = useTranslation('normal')
  const rows = catalog.filter((item) => item.slot === slot)
  const natural = draft[slot] === undefined

  return (
    <div className={s.colourGrid} role="tabpanel">
      <button
        type="button"
        className={s.colourSwatch}
        data-natural="true"
        aria-label={t('wardrobe.natural')}
        aria-pressed={natural}
        onClick={() => onPick(undefined)}
      >
        <span className={s.naturalMark} aria-hidden="true" />
      </button>
      {rows.map((item) => {
        const isOwned = owned.has(item.id)
        const equipped = draft[slot] === item.id
        return (
          <button
            key={item.id}
            type="button"
            className={s.colourSwatch}
            style={{ background: item.colour }}
            aria-label={itemName(item.id, t)}
            aria-pressed={equipped}
            aria-disabled={!isOwned}
            title={isOwned ? undefined : hintFor(item, achievements, t)}
            onClick={() => {
              if (isOwned) onPick(item.id)
            }}
          >
            {isOwned ? null : <span className={s.lock} aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}
