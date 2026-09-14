import { Button, Chibi, Field, Modal } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AvatarConfigDto, BaseDto, ItemDto, NormalApi, OutfitDto } from '../../api.js'
import { chibiFromApi } from '../../avatar/chibi.js'
import s from './wardrobe.module.css'

const OUTFIT_NAME_MAX = 24

/** One slot's worth of dialog state: which slot, what the name field says, and whether this is a fresh
 * save (the draft becomes the slot's config) or a rename (only the name changes). */
interface DialogState {
  slot: number
  name: string
  mode: 'save' | 'rename'
}

export interface OutfitBarProps {
  api: NormalApi
  /** Length 5, index `slot - 1` — the server's own numbering (design §5.3). */
  outfits: (OutfitDto | null)[]
  draft: AvatarConfigDto
  items: ReadonlyMap<string, ItemDto>
  bases: ReadonlyMap<string, BaseDto>
  onOutfitsChanged: (next: (OutfitDto | null)[]) => void
  /** The server's own answer to `apply` — the config now equipped — so the caller can push it straight
   * into the draft without a second round trip. */
  onApplied: (config: AvatarConfigDto) => void
}

/**
 * Five saved outfits (design §5.3, Plan 10 §6.3's bar carried over): a snapshot of a whole configuration,
 * named, that can be worn again in one click. Slot numbers in this UI are 1..5 throughout, matching the
 * API exactly — `outfits[i]` is slot `i + 1`.
 */
export function OutfitBar({ api, outfits, draft, items, bases, onOutfitsChanged, onApplied }: OutfitBarProps) {
  const { t } = useTranslation('normal')
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const replace = (slot: number, next: OutfitDto | null): void => {
    const copy = [...outfits]
    copy[slot - 1] = next
    onOutfitsChanged(copy)
  }

  const openSave = (slot: number, existing: OutfitDto | null): void => {
    setError(null)
    setDialog({ slot, name: existing?.name ?? t('outfits.defaultName', { n: slot }), mode: 'save' })
  }
  const openRename = (slot: number, existing: OutfitDto): void => {
    setError(null)
    setDialog({ slot, name: existing.name, mode: 'rename' })
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

  return (
    <section>
      <h2>{t('outfits.title')}</h2>
      {error === null ? null : (
        <p role="alert">{error}</p>
      )}
      <div className={s.outfitBar}>
        {outfits.map((outfit, at) => {
          const slot = at + 1
          const chibi = outfit === null ? null : chibiFromApi(outfit.config, items, bases)
          return (
            <div className={s.outfitSlot} key={slot} data-filled={outfit !== null}>
              {chibi === null ? (
                <span aria-hidden="true">{t('outfits.empty')}</span>
              ) : (
                <Chibi subject={chibi} frame="head" size={40} />
              )}
              <span>{outfit?.name ?? t('outfits.emptySlot', { n: slot })}</span>
              <div className={s.outfitActions}>
                <Button variant="ghost" size="sm" disabled={outfit === null || busy} onClick={() => void apply(slot)}>
                  {t('outfits.apply')}
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => openSave(slot, outfit)}>
                  {t('outfits.saveHere')}
                </Button>
                {outfit === null ? null : (
                  <>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => openRename(slot, outfit)}>
                      {t('outfits.rename')}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => void remove(slot)}>
                      {t('outfits.delete')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <Modal
        open={dialog !== null}
        title={dialog?.mode === 'rename' ? t('outfits.rename') : t('outfits.saveHere')}
        closeLabel={t('wardrobe.close')}
        onClose={() => setDialog(null)}
      >
        <Field label={t('outfits.nameLabel')}>
          <input
            type="text"
            maxLength={OUTFIT_NAME_MAX}
            value={dialog?.name ?? ''}
            onChange={(event) => setDialog((prev) => (prev === null ? prev : { ...prev, name: event.target.value }))}
          />
        </Field>
        <Button variant="gold" loading={busy} onClick={() => void submitDialog()}>
          {t('outfits.saveHere')}
        </Button>
      </Modal>
    </section>
  )
}
