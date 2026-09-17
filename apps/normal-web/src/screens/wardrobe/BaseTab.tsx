import { Chibi } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, BaseDto, BaseId, ItemDto } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import s from './wardrobe.module.css'

export interface BaseTabProps {
  bases: readonly BaseDto[]
  draft: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  onPick: (base: BaseId) => void
}

/**
 * The fixed figures, chosen rather than owned (design §4.2, §5.1) — so unlike every other tab, nothing
 * here is ever locked. Each tile previews the base wearing the draft's *current* outfit, which is what
 * makes the choice legible: a player picking a body is picking a silhouette, not a wardrobe.
 *
 * One tile per base the catalogue answered with, however many that is: the list is
 * `apps/normal-server/data/avatar-bases.json` and adding a figure to it must not be a change here.
 */
export function BaseTab({ bases, draft, items, onPick }: BaseTabProps) {
  const { t } = useTranslation('normal')

  return (
    <div className={s.baseGrid} role="tabpanel">
      {bases.map((base) => {
        const preview = chibiFromApi({ ...draft, head: undefined, face: undefined, aura: undefined, frame: undefined, base: base.id }, items, baseMapOf(base))
        const selected = draft.base === base.id
        return (
          <button
            key={base.id}
            type="button"
            className={s.tile}
            aria-pressed={selected}
            onClick={() => onPick(base.id)}
          >
            {preview === null ? null : <Chibi subject={preview} frame="head" size={64} />}
            <span className={s.tileName}>{t(base.nameKey)}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A one-entry base map, so a tile can be previewed without depending on every other base being loaded. */
function baseMapOf(base: BaseDto): Map<string, BaseDto> {
  return new Map([[base.id, base]])
}
