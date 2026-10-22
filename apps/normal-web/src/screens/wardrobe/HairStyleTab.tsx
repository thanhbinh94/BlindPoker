import { Chibi } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, BodyDto, ItemDto } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import { hintFor, type HintSources } from '../catalog.js'
import { ItemCard } from './cards.js'
import { slotCards } from './categories.js'
import s from './wardrobe.module.css'

export interface HairStyleTabProps {
  catalog: readonly ItemDto[]
  /** The same catalogue, by id — what each portrait is drawn from (`chibiFromApi`). */
  items: ReadonlyMap<string, ItemDto>
  /** `/api/catalog/avatar`'s bodies, keyed by `gender`. */
  bodies: ReadonlyMap<string, BodyDto>
  owned: ReadonlySet<string>
  /** What a locked card's hint is worked out from (`hintFor`): the achievements and the check-in's named gifts. */
  hints: HintSources
  draft: AvatarConfigDto
  /** "Hiện cả món chưa có" (No11a): unticked, only the hairstyles the player owns. */
  showLocked: boolean
  onPick: (itemId: string) => void
  /** Each portrait's side in px: 96, or 72 on a phone, where three cards share 343 px (the old base cards' sizes). */
  portraitSize: number
  /** This tab's panel id and the tab that labels it (design §7), from `CategoryNav`'s own id scheme. */
  panelId?: string
  labelledBy?: string
}

/**
 * Kiểu tóc (avatar v4, spec §6.1): the hairstyles drawn for the draft's gender, as `ItemCard`s — the other gender's
 * are never listed, the box ticked or not (`slotCards`' `gender`). Each card's picture is a head portrait of the
 * draft wearing that hairstyle: its gender, its hair colour, its skin tone and its eyes, and nothing else — no hat,
 * no glasses, no aura, no frame (pre-flight #20). A hat that hides the front hair would otherwise draw every card
 * the same.
 *
 * A click wears the card's hairstyle; a second click on the worn one keeps it on, since a figure always wears one
 * (`WardrobeScreen.pick`, which treats `hairStyle` as required, like `outfit`). Nothing owned to list (No11a): the
 * panel stays and says so in one line, as on every tab.
 */
export function HairStyleTab({ catalog, items, bodies, owned, hints, draft, showLocked, onPick, portraitSize, panelId, labelledBy }: HairStyleTabProps) {
  const { t } = useTranslation('normal')
  const cards = slotCards('hairStyle', catalog, owned, showLocked, draft.hairStyle, draft.gender)
  const empty = cards.length === 0

  /** The draft's look with this hairstyle: the gender, the outfit (`chibiFromApi` needs one, and a head crop shows
   * none of it) and the three colours — no head, face, aura or frame. */
  const portraitOf = (hairStyle: string) => {
    const look: AvatarConfigDto = { v: draft.v, gender: draft.gender, hairStyle, outfit: draft.outfit }
    if (draft.hairColor !== undefined) look.hairColor = draft.hairColor
    if (draft.eyeColor !== undefined) look.eyeColor = draft.eyeColor
    if (draft.skinColor !== undefined) look.skinColor = draft.skinColor
    const subject = chibiFromApi(look, items, bodies)
    // Lazy (plan 27 E2): a portrait off screen asks for nothing until it comes near, and queues behind the stage.
    return subject === null ? undefined : <Chibi subject={subject} frame="head" size={portraitSize} lazy />
  }

  return (
    // Empty, the panel stays the same element and only the grid goes; with no card to Tab to, the panel itself takes
    // the focus (the ARIA tabs pattern), so its one line is reachable.
    <div className={empty ? undefined : s.cardGrid} role="tabpanel" id={panelId} aria-labelledby={labelledBy} tabIndex={empty ? 0 : undefined}>
      {empty ? <p className={s.emptyOwned}>{t('wardrobe.emptyOwned')}</p> : null}
      {cards.map(({ shown }) => {
        const isOwned = owned.has(shown.id)
        return (
          <ItemCard
            key={shown.id}
            item={shown}
            owned={isOwned}
            wearing={draft.hairStyle === shown.id}
            hint={isOwned ? '' : hintFor(shown, hints, t)}
            thumb={portraitOf(shown.id)}
            onPick={onPick}
          />
        )
      })}
    </div>
  )
}
