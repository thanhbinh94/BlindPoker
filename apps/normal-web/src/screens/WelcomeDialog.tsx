import { Button, Chibi, defaultChibi, formatPoints, Modal, type Language } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ApiError,
  type AvatarConfigDto,
  type BodyDto,
  type Gender,
  type ItemDto,
  type NormalApi,
  type WelcomeClaimDto,
  type WelcomeStatusDto,
} from '../api.js'
import { chibiFromApi } from '../avatar/chibi.js'
import { itemName } from '../catalog-i18n.js'
import n from './normal.module.css'
import { refusalText } from './refusal.js'
import w from './welcome.module.css'

/**
 * The reputation the welcome gift adds: the server's `rules.welcome` default (spec 2026-10-21 §4 C1). The status route
 * does not carry it, so the dialog names the default; a game master who changes the rule changes the grant, not
 * these words.
 */
export const WELCOME_REPUTATION = 100

/** The full-body figure on each card: the 6:7 frame at this width, capped by the card (`.figure`). */
const FIGURE_SIZE = 144

/** Refusals that mean "this pick is no good any more": the dialog reads the choices again and asks for another. */
const STALE_PICK = new Set(['ALREADY_OWNED', 'NOT_A_CHOICE'])

export interface WelcomeDialogProps {
  api: NormalApi
  lang: Language
  /** The status the lobby read: the three choices and which of them the player owns. */
  status: WelcomeStatusDto
  /** The player's saved outfit, which each card dresses in its choice; `null` until the lobby's avatar read lands. */
  avatar: AvatarConfigDto | null
  items: ReadonlyMap<string, ItemDto>
  bodies: ReadonlyMap<string, BodyDto>
  /** The gift is taken (here, or — on `WELCOME_CLAIMED` — somewhere else): the lobby reads its status and the face again. */
  onClaimed(): void
  onClose(): void
}

/**
 * "Quà chào mừng" (spec 2026-10-21 §4 C1, R6, R17): three rare items, each drawn on the player's own figure, one to
 * pick and take with "Nhận" — or "Để sau", which closes the dialog and leaves the lobby's gift button in place. A
 * choice the player already owns is dimmed and cannot be picked; with all three owned the only answer left is the
 * reputation on its own.
 *
 * The server grants and wears the item and adds the reputation in one transaction, and pushes its own `RANK_UP`
 * notice, so the dialog only says what landed and hands the refresh to the lobby.
 */
export function WelcomeDialog({ api, lang, status, avatar, items, bodies, onClaimed, onClose }: WelcomeDialogProps) {
  const { t } = useTranslation('normal')
  /** The choices as read again after a stale pick; the lobby's until then. */
  const [fresh, setFresh] = useState<WelcomeStatusDto | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WelcomeClaimDto | null>(null)
  const [alert, setAlert] = useState<string | null>(null)
  /** The choices as they stood when the claim landed: the lobby's refresh then marks the new item owned, and the
   * dialog keeps showing what the player picked from rather than a row of "✓ Đã có". */
  const [claimedFrom, setClaimedFrom] = useState<WelcomeStatusDto | null>(null)

  const shown = claimedFrom ?? fresh ?? status
  const allOwned = shown.choices.every((choice) => choice.owned)
  const amount = formatPoints(WELCOME_REPUTATION, lang)

  // Before the lobby's avatar read lands, the first body the catalogue serves, in its first hairstyle and default
  // outfit — `chibiFromApi` falls back to both for an id it does not know.
  const firstGender = bodies.keys().next().value as Gender | undefined
  const base: AvatarConfigDto | null = avatar ?? (firstGender === undefined ? null : { v: 4, gender: firstGender, hairStyle: '', outfit: '' })

  const subjectFor = (itemId: string) => {
    const item = items.get(itemId)
    if (base === null) return defaultChibi(itemId)
    const config: AvatarConfigDto = item === undefined ? { ...base } : Object.assign({ ...base }, { [item.slot]: itemId })
    return chibiFromApi(config, items, bodies) ?? defaultChibi(itemId)
  }

  const claim = async (itemId: string | null): Promise<void> => {
    if (busy) return
    setBusy(true)
    setAlert(null)
    try {
      const answer = await api.welcomeClaim(itemId)
      setClaimedFrom(shown)
      setResult(answer)
      onClaimed()
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'WELCOME_CLAIMED') {
        // Taken in another tab: nothing is left to choose here.
        onClaimed()
        onClose()
        return
      }
      if (cause instanceof ApiError && STALE_PICK.has(cause.code)) {
        setAlert(t(`welcome.refusal.${cause.code}`))
        setPicked(null)
        try {
          const again = await api.welcome()
          if (again.claimed) {
            onClaimed()
            onClose()
            return
          }
          setFresh(again)
        } catch {
          /* the old choices stay; the server refuses a stale pick again, and says so again */
        }
      } else {
        setAlert(refusalText(cause, t))
      }
    } finally {
      setBusy(false)
    }
  }

  const done = result === null ? null : result.itemId === null ? t('welcome.doneReputationOnly', { amount }) : t('welcome.done', { item: itemName(result.itemId, t), amount })

  const footer =
    result !== null ? (
      // The button that was pressed (Nhận) is gone with the claim: focus moves here rather than falling to the page.
      <Button variant="gold" onClick={onClose} autoFocus>
        {t('welcome.start')}
      </Button>
    ) : (
      <>
        {allOwned ? (
          <Button variant="gold" loading={busy} onClick={() => void claim(null)}>
            {t('welcome.claimReputationOnly', { amount })}
          </Button>
        ) : (
          <Button variant="gold" loading={busy} disabled={picked === null} onClick={() => void claim(picked)}>
            {t('welcome.claim')}
          </Button>
        )}
        <Button variant="ghost" onClick={onClose}>
          {t('welcome.later')}
        </Button>
      </>
    )

  return (
    <Modal open title={t('welcome.title')} onClose={onClose} closeLabel={t('welcome.close')} footer={footer}>
      <p className={w.lead}>{allOwned ? t('welcome.leadAllOwned') : t('welcome.lead')}</p>
      <ul className={w.choices} aria-label={t('welcome.choices')}>
        {shown.choices.map((choice) => {
          const name = itemName(choice.itemId, t)
          return (
            <li key={choice.itemId}>
              <button
                type="button"
                className={w.card}
                aria-pressed={picked === choice.itemId}
                disabled={choice.owned || busy || result !== null}
                onClick={() => setPicked(choice.itemId)}
              >
                <Chibi subject={subjectFor(choice.itemId)} frame="full" size={FIGURE_SIZE} className={w.figure} />
                <span className={w.name}>{name}</span>
                {choice.owned ? <span className={w.owned}>{t('welcome.owned')}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
      {/* Always in the page, filled when the claim lands: a live region mounted with its text is not announced. Empty,
          it carries no class, so its margin does not open a gap under the cards (the global reset zeroes a `p`'s). */}
      <p className={done === null ? undefined : w.done} role="status">
        {done}
      </p>
      {alert === null ? null : (
        <p className={n.alert} role="alert">
          {alert}
        </p>
      )}
    </Modal>
  )
}
