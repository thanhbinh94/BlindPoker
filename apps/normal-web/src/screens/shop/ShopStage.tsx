import { Button, formatPoints, LiveFigure, TurnButton, type ChibiConfig, type ChibiFacing, type ChibiReaction, type Language } from '@bp/ui-kit'
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ReputationLine, type ReputationStanding } from '../ReputationLine.js'
import s from './shop.module.css'

/** How the stage is laid out: the column beside the shelves (≥ 1024 px, 768–1023 px) or the strip above them (≤ 767 px). */
export type StageLayout = 'desktop' | 'tablet' | 'phone'

/**
 * The full-body figure's width per layout. `Chibi`'s full frame is 6:7, so each is the width whose height fits the
 * stage around it (`.stage`, `.strip` in `shop.module.css`): 260 → 303 px in the 320 px column's 310 px stage, 190 →
 * 222 px in the 240 px column's 230 px stage, 78 → 91 px in the phone's 96 px strip.
 */
const FIGURE_SIZE: Record<StageLayout, number> = { desktop: 260, tablet: 190, phone: 78 }
/** A frame is drawn around the head only, so a frame on try-on swaps the figure for a framed head portrait. */
const PORTRAIT_SIZE: Record<StageLayout, number> = { desktop: 240, tablet: 180, phone: 84 }

export interface ShopStageProps {
  /** The figure: the player's saved outfit with the try-on merged over it. */
  subject: ChibiConfig
  /** A frame is on try-on: draw the framed head instead of the whole figure. */
  portrait: boolean
  layout: StageLayout
  balance: number
  lang: Language
  standing: ReputationStanding
  /** The name of the item last put on, while anything is on try-on. */
  tryingName: string | null
  /** "Về đồ đang mặc": present while anything is on try-on. */
  onReset?: () => void
  /** "Mặc luôn": present after a purchase while what was bought is still on the figure. */
  onWearNow?: () => void
  wearBusy?: boolean
  /**
   * The page's last word (a purchase's "đã vào tủ đồ", a refusal), drawn under the balance: it is read where the player
   * is looking, inside the pinned stage, and never sits scrolled off at the top of the page.
   */
  notice?: ReactNode
  /** A reaction from the screen (BP-30, spec K6 §3.2): a cheer when a card goes on try-on and when a purchase goes
   * through. Each new `key` plays once; any other render hands down the same one, so it plays nothing. */
  react?: ChibiReaction | null
}

/**
 * The shop's figure (spec 2026-10-21 §3 B3, mockup B): the player's own chibi wearing whatever card was last pressed,
 * the balance and the reputation line under it, and the two ways back — "Về đồ đang mặc" drops the try-on, "Mặc luôn"
 * saves it after a purchase. On a phone the column folds into one sticky strip above the shelves, so a try-on stays
 * in sight while the shelves scroll under it.
 *
 * BP-30 (spec K6 §3.2, P15): the figure is live — it breathes, blinks, cheers on `react`, waves when tapped — and
 * "Xoay" turns it on every size: under the column's stage, and at the end of the phone's strip. One `LiveFigure` serves
 * both frames, its `frame` and `size` swapped, so a frame on try-on keeps the figure's life and facing.
 */
export function ShopStage({
  subject,
  portrait,
  layout,
  balance,
  lang,
  standing,
  tryingName,
  onReset,
  onWearNow,
  wearBusy = false,
  notice = null,
  react = null,
}: ShopStageProps) {
  const { t } = useTranslation('normal')
  // Kept here, not on the screen: which way the figure faces is a look at it, never part of a try-on (spec K6 §3.3, R5).
  const [facing, setFacing] = useState<ChibiFacing>('right')
  const figure = (
    <LiveFigure
      subject={subject}
      frame={portrait ? 'head' : 'full'}
      size={portrait ? PORTRAIT_SIZE[layout] : FIGURE_SIZE[layout]}
      label={t('shop.figure')}
      live="idle"
      greet
      react={react}
      facing={facing}
    />
  )
  const turn = <TurnButton facing={facing} onTurn={setFacing} className={s.stageTurn} />
  const balanceLine = <p className={s.balance}>{t('shop.balance', { points: formatPoints(balance, lang) })}</p>
  const actions =
    onReset === undefined && onWearNow === undefined ? null : (
      <div className={s.stageActions}>
        {onWearNow === undefined ? null : (
          <Button variant="gold" size="sm" loading={wearBusy} onClick={onWearNow} data-wear-now="">
            {t('shop.wearNow')}
          </Button>
        )}
        {onReset === undefined ? null : (
          <Button variant="ghost" size="sm" onClick={onReset}>
            {t('shop.reset')}
          </Button>
        )}
      </div>
    )
  const trying = tryingName === null ? null : <p className={s.trying}>{t('shop.trying', { item: tryingName })}</p>

  if (layout === 'phone') {
    return (
      <section className={s.stripWrap} aria-label={t('shop.figure')}>
        <div className={s.strip}>
          <div className={s.stripFigure}>{figure}</div>
          <div className={s.stripText}>
            {balanceLine}
            <ReputationLine standing={standing} lang={lang} />
          </div>
          {turn}
        </div>
        {notice}
        {trying}
        {actions}
      </section>
    )
  }

  return (
    <section className={s.stageColumn} data-layout={layout} aria-label={t('shop.figure')}>
      <div className={s.stage}>
        <div className={s.stageFigure}>{figure}</div>
      </div>
      {turn}
      {trying}
      {actions}
      {balanceLine}
      {notice}
      <ReputationLine standing={standing} lang={lang} />
    </section>
  )
}
