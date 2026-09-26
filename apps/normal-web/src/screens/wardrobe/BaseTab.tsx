import { useMediaQuery } from '@bp/ui-kit'
import type { AvatarConfigDto, BaseDto, BaseId, ItemDto } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import { BaseCard } from './cards.js'
import s from './wardrobe.module.css'

export interface BaseTabProps {
  bases: readonly BaseDto[]
  draft: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  onPick: (base: BaseId) => void
}

/**
 * The fixed figures, chosen rather than owned (design §4.2, §5.1) — so unlike every other tab, nothing
 * here is ever locked. Each card previews the base wearing the draft's *current* outfit, which is what
 * makes the choice legible: a player picking a body is picking a silhouette, not a wardrobe.
 *
 * One card per base the catalogue answered with, however many that is: the list is
 * `apps/normal-server/data/avatar-bases.json` and adding a figure to it must not be a change here.
 *
 * `chibiFromApi` can in principle answer `null` (an id the catalogue itself just handed back should
 * never actually fail to resolve, but the function's contract allows it for an unknown base or a
 * catalogue with no default outfit) — a base that fails to preview is skipped rather than rendered
 * without one, since `BaseCard.portrait` is not optional.
 */
export function BaseTab({ bases, draft, items, onPick }: BaseTabProps) {
  // V5 fix: a fixed 96 px portrait overflowed a phone's 3-column grid (`.baseCard`'s minimum content
  // width, padding plus that fixed-width chibi, exceeded the column's own share) — 72 px fits it instead.
  const phone = useMediaQuery('(max-width: 767px)')
  const portraitSize = phone ? 72 : 96

  return (
    <div className={s.cardGrid} role="tabpanel">
      {bases.map((base) => {
        const preview = chibiFromApi({ ...draft, head: undefined, face: undefined, aura: undefined, frame: undefined, base: base.id }, items, baseMapOf(base))
        if (preview === null) return null
        return (
          <BaseCard key={base.id} base={base} portrait={preview} selected={draft.base === base.id} onPick={onPick} portraitSize={portraitSize} />
        )
      })}
    </div>
  )
}

/** A one-entry base map, so a tile can be previewed without depending on every other base being loaded. */
function baseMapOf(base: BaseDto): Map<string, BaseDto> {
  return new Map([[base.id, base]])
}
