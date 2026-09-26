import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, ItemDto } from '../../api.js'
import { hintFor } from '../catalog.js'
import { ColourCard } from './cards.js'
import { applyFilter, tabItems, type OwnershipFilter } from './categories.js'
import s from './wardrobe.module.css'

export interface ColourTabProps {
  slot: 'hairColor' | 'eyeColor'
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  filter: OwnershipFilter
  /** `undefined` equips nothing — the base's own colour — which is what the "Natural" swatch sends. */
  onPick: (itemId: string | undefined) => void
}

/**
 * The hair-colour and eye-colour tabs (design §4.3): round swatches painted with each item's own
 * `colour`, one row, no picture — there is nothing to draw a colour *as* other than itself. The first
 * card is "Natural" (the base's own colour, no item at all): always shown, never locked, and untouched
 * by the ownership filter — it is not a catalogue row `applyFilter` has an opinion about. Every other
 * card locks exactly like `ItemTab`'s.
 */
export function ColourTab({ slot, catalog, owned, achievements, draft, filter, onPick }: ColourTabProps) {
  const { t } = useTranslation('normal')
  const rows = tabItems(slot, catalog)
  const shown = applyFilter(rows, owned, filter)
  const natural = draft[slot] === undefined

  return (
    <div className={s.cardGrid} role="tabpanel">
      <ColourCard item={null} owned wearing={natural} hint="" onPick={onPick} />
      {shown.map((item) => {
        const isOwned = owned.has(item.id)
        const wearing = draft[slot] === item.id
        return (
          <ColourCard
            key={item.id}
            item={item}
            owned={isOwned}
            wearing={wearing}
            hint={isOwned ? '' : hintFor(item, achievements, t)}
            onPick={onPick}
          />
        )
      })}
    </div>
  )
}
