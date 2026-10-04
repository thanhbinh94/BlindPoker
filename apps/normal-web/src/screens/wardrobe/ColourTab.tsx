import { useTranslation } from 'react-i18next'
import type { AchievementDefDto, AvatarConfigDto, ItemDto } from '../../api.js'
import { hintFor } from '../catalog.js'
import { ColourCard } from './cards.js'
import { slotCards } from './categories.js'
import s from './wardrobe.module.css'

export interface ColourTabProps {
  slot: 'hairColor' | 'eyeColor' | 'skinColor'
  catalog: readonly ItemDto[]
  owned: ReadonlySet<string>
  achievements: readonly AchievementDefDto[]
  draft: AvatarConfigDto
  /** "Hiện cả món chưa có" (No11a): unticked, only the owned swatches (and "Natural", always). */
  showLocked: boolean
  /** `undefined` equips nothing — the hairstyle's or the body's own colour — which is what the "Natural" swatch sends. */
  onPick: (itemId: string | undefined) => void
  /** The colour that fills the "Natural" swatch (avatar v4: the body's own skin on Màu da). Left out, the swatch is the
   * half-and-half mark that says "whatever it is drawn in" (Màu tóc, Màu mắt). */
  naturalColour?: string
  /** This tab's panel id and the tab that labels it (design §7) — set by `CategoryNav`'s own id scheme,
   * carried down through `WardrobeScreen` so the two ends of the relationship never drift apart. */
  panelId?: string
  labelledBy?: string
}

/**
 * The hair-colour, skin-tone and eye-colour tabs (design §4.3; Màu da since avatar v4, spec §6.1): round swatches
 * painted with each item's own `colour`, one row, no picture — there is nothing to draw a colour *as* other than
 * itself. The first card is "Natural" (the hairstyle's or the body's own colour, no item at all): always shown, never
 * locked, and untouched by the "Hiện cả món chưa có" box — it is not a catalogue row `applyFilter` has an opinion
 * about — so this tab never needs the empty line `ItemTab` draws (No11a). Every other swatch is a family of one,
 * in catalogue order: shown when owned or when the box is ticked, and locked exactly like `ItemTab`'s cards.
 */
export function ColourTab({ slot, catalog, owned, achievements, draft, showLocked, onPick, naturalColour, panelId, labelledBy }: ColourTabProps) {
  const { t } = useTranslation('normal')
  const shown = slotCards(slot, catalog, owned, showLocked).map((card) => card.shown)
  const natural = draft[slot] === undefined

  return (
    <div className={s.cardGrid} role="tabpanel" id={panelId} aria-labelledby={labelledBy}>
      <ColourCard item={null} owned wearing={natural} hint="" naturalColour={naturalColour} onPick={onPick} />
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
