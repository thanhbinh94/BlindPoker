import { Button, Chibi, Field, Modal } from '@bp/ui-kit'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, BodyDto, ItemDto, NormalApi, OutfitDto } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import s from './wardrobe.module.css'

const OUTFIT_NAME_MAX = 24
const PLUS_GLYPH = '+'

/** One slot's worth of dialog state: which slot, what the name field says, whether this is a fresh save
 * (the draft becomes the slot's config) or a rename (only the name changes), and — for a save — whether
 * the slot already held something when the dialog opened, which picks the title/submit label (design
 * §3.1 item 4: "Lưu vào đây" for an empty slot, "Lưu đè vào đây" for one the menu opened over). */
interface DialogState {
  slot: number
  name: string
  mode: 'save' | 'rename'
  filled: boolean
}

export interface OutfitBarProps {
  api: NormalApi
  /** Length 5, index `slot - 1` — the server's own numbering (design §5.3). */
  outfits: (OutfitDto | null)[]
  draft: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  /** `/api/catalog/avatar`'s bodies, keyed by `gender` — what each portrait is drawn on. */
  bodies: ReadonlyMap<string, BodyDto>
  onOutfitsChanged: (next: (OutfitDto | null)[]) => void
  /** The server's own answer to `apply` — the config now equipped — so the caller can push it straight
   * into the draft without a second round trip. */
  onApplied: (config: AvatarConfigDto) => void
}

/**
 * Five saved outfits (design §3.1 item 4, §5.3): a snapshot of a whole configuration, named, that can be
 * worn again in one click. Slot numbers in this UI are 1..5 throughout, matching the API exactly —
 * `outfits[i]` is slot `i + 1`.
 *
 * A filled portrait opens a small menu (Áp dụng · Lưu đè vào đây · Đổi tên · Xoá); an empty one skips
 * the menu and opens the naming dialog straight away, the same one the menu's "Lưu đè vào đây" and
 * "Đổi tên" reuse — moved here from `OutfitBar` verbatim (dialogs, api calls, error handling), which this
 * component replaces.
 *
 * Every empty slot's visible caption is the same plain "Trống" (design §3.1 item 4), but its accessible
 * name is numbered ("Ô {{n}} trống") — otherwise a screen reader announces five identical buttons with no
 * way to tell them apart.
 */
export function SavedOutfits({ api, outfits, draft, items, bodies, onOutfitsChanged, onApplied }: OutfitBarProps) {
  const { t } = useTranslation('normal')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [openMenu, setOpenMenu] = useState<number | null>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  // The menu closes on Escape, or on any click outside the slot that opened it — a menu left open when
  // the player's attention has moved elsewhere would sit there stale over whatever they do next.
  useEffect(() => {
    if (openMenu === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpenMenu(null)
    }
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target
      const container = itemRefs.current[openMenu - 1]
      if (container !== null && container !== undefined && target instanceof Node && container.contains(target)) return
      setOpenMenu(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [openMenu])

  const replace = (slot: number, next: OutfitDto | null): void => {
    const copy = [...outfits]
    copy[slot - 1] = next
    onOutfitsChanged(copy)
  }

  const openSave = (slot: number, existing: OutfitDto | null): void => {
    setError(null)
    setOpenMenu(null)
    setDialog({ slot, name: existing?.name ?? t('outfits.defaultName', { n: slot }), mode: 'save', filled: existing !== null })
  }
  const openRename = (slot: number, existing: OutfitDto): void => {
    setError(null)
    setOpenMenu(null)
    setDialog({ slot, name: existing.name, mode: 'rename', filled: true })
  }

  const submitDialog = async (): Promise<void> => {
    if (dialog === null || busy) return
    const trimmed = dialog.name.trim()
    if (trimmed === '') return
    setBusy(true)
    try {
      const config = dialog.mode === 'rename' ? (outfits[dialog.slot - 1]?.config ?? draft) : draft
      const saved = await api.saveOutfit(dialog.slot, trimmed, config)
      replace(dialog.slot, saved)
      setDialog(null)
      setError(null)
    } catch {
      setError(t('outfits.error'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (slot: number): Promise<void> => {
    if (busy) return
    setOpenMenu(null)
    setBusy(true)
    try {
      await api.deleteOutfit(slot)
      replace(slot, null)
      setError(null)
    } catch {
      setError(t('outfits.error'))
    } finally {
      setBusy(false)
    }
  }

  const apply = async (slot: number): Promise<void> => {
    if (busy) return
    setOpenMenu(null)
    setBusy(true)
    try {
      const { config } = await api.applyOutfit(slot)
      onApplied(config)
      setError(null)
    } catch {
      setError(t('outfits.error'))
    } finally {
      setBusy(false)
    }
  }

  const dialogTitle =
    dialog === null ? '' : dialog.mode === 'rename' ? t('outfits.rename') : dialog.filled ? t('outfits.overwrite') : t('outfits.saveHere')

  return (
    <section className={s.savedOutfits}>
      <h2 className={s.savedOutfitsTitle}>{t('outfits.title')}</h2>
      {error === null ? null : (
        <p role="alert" className={s.savedOutfitsError}>
          {error}
        </p>
      )}
      <div className={s.outfitGrid}>
        {outfits.map((outfit, at) => {
          const slot = at + 1
          const chibi = outfit === null ? null : chibiFromApi(outfit.config, items, bodies)
          const menuOpen = openMenu === slot
          return (
            <div
              className={s.outfitItem}
              key={slot}
              ref={(el) => {
                itemRefs.current[at] = el
              }}
            >
              <button
                type="button"
                className={s.outfitPortrait}
                data-filled={outfit !== null}
                aria-haspopup={outfit === null ? undefined : 'true'}
                aria-expanded={outfit === null ? undefined : menuOpen}
                aria-label={outfit === null ? t('outfits.emptySlot', { n: slot }) : t('outfits.menu', { name: outfit.name })}
                disabled={busy}
                onClick={() => (outfit === null ? openSave(slot, null) : setOpenMenu(menuOpen ? null : slot))}
              >
                {chibi === null ? (
                  <span aria-hidden="true" className={s.outfitPlus}>
                    {PLUS_GLYPH}
                  </span>
                ) : (
                  // Lazy (plan 27 E2): the column can scroll, and the five heads wait behind the stage and the cards.
                  <Chibi subject={chibi} frame="head" size={54} lazy />
                )}
              </button>
              <span className={s.outfitName}>{outfit?.name ?? t('outfits.empty')}</span>

              {!menuOpen || outfit === null ? null : (
                <div className={s.outfitMenu}>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void apply(slot)}>
                    {t('outfits.apply')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => openSave(slot, outfit)}>
                    {t('outfits.overwrite')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => openRename(slot, outfit)}>
                    {t('outfits.rename')}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(slot)}>
                    {t('outfits.delete')}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      <Modal
        open={dialog !== null}
        title={dialogTitle}
        closeLabel={t('wardrobe.close')}
        onClose={() => setDialog(null)}
        footer={
          <Button variant="gold" loading={busy} onClick={() => void submitDialog()}>
            {dialogTitle}
          </Button>
        }
      >
        <Field label={t('outfits.nameLabel')}>
          <input
            type="text"
            maxLength={OUTFIT_NAME_MAX}
            value={dialog?.name ?? ''}
            onChange={(event) => setDialog((prev) => (prev === null ? prev : { ...prev, name: event.target.value }))}
          />
        </Field>
      </Modal>
    </section>
  )
}
