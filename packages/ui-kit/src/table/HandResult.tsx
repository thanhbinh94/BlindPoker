import type { ChaosOutcome, RoomView, ShowdownHand } from '@bp/core'
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import type { ClientChaosCredit, ClientHand } from '../client/types.js'
import { formatPoints, handLabel, type Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { cx } from '../primitives/cx.js'
import { Card } from './Card.js'
import { ChaosCardInfo } from './ChaosCardInfo.js'
import type { RoomFrame } from './frame.js'
import { CARD_STAGGER_MS } from './motion.js'
import s from './table.module.css'

export interface HandResultProps {
  hand: ClientHand
  room: RoomView
  myPlayerId: string | null
  lang: Language
  onDismiss?: () => void
  /**
   * The room's "next hand in N seconds", printed in the card's footer beside the fee (review 2026-09-29, No2: free
   * text under the card landed on the viewer's own seat). It ticks every second, so it must stay out of the card's
   * live region, or a screen reader would read the whole receipt out again on every tick. It is outside it by
   * structure (review round 2, R2-4): the card is a group, only its head, note and body are the `status` region, and
   * the footer — this line included — follows it. It needs no `aria-live` of its own.
   */
  countdown?: ReactNode
  /**
   * The room's frame (Plan 26, B5). It is stamped on the card as `data-frame`: this module cannot name the room's own
   * hashed class, so the compact card of a phone held sideways keys its rules on the card's own attribute.
   */
  frame?: RoomFrame
  /**
   * Poker hỗn loạn: the points cards paid after this hand ("Cấp cứu +N", "Bạo kích ×2 +N", "Thần tài +N"), from
   * `ClientState.chaos.credits`. They may land a moment after the card is up, so each prints in the footer as it arrives.
   * The cards that acted are in `hand.result.chaosUsed`. Absent or empty, the card is as it was.
   */
  chaosCredits?: readonly ClientChaosCredit[]
  /**
   * How the result is drawn (BP-39, spec 2026-10-27 §3.2). `card` (the default) is the receipt dealt over the felt.
   * `strip` is the chaos table's result on a phone: a band directly above the tray (a region of the room's layout on a
   * phone held upright; at the stage's foot, in columns, on one held sideways) — the title and the countdown on its first
   * line with "Bỏ qua", then the winner's row and the viewer's, the rest folded into "+N người", then "Thẻ đã dùng". No
   * "Đóng": the strip leaves with the hand, and it covers no part of the felt the player needs.
   */
  variant?: 'card' | 'strip'
  /**
   * Poker hỗn loạn's "Bỏ qua" (spec §3.3): how many of the seated players have pressed it, out of how many, and whether
   * the viewer has. The count is shown to everyone; the button only with `onSkip` (a seated player — a spectator has
   * nothing to skip), and once pressed it reads "Đã bỏ qua" and stays down. Absent or `null` (a plain table, or no wait
   * running): no skip at all, and the result is exactly as it was.
   */
  skip?: ResultSkip | null
  /**
   * The room's stage (`<main>`), for the strip only: an opened strip grows upward over the felt as a sheet, at most its own
   * height plus 60 % of the stage's, and never above the stage's top. Absent, the sheet is capped at 60 % of the window.
   */
  stage?: RefObject<HTMLElement>
}

/** The "Bỏ qua" tally a result shows, and the press when the viewer may skip. */
export interface ResultSkip {
  skipped: number
  total: number
  mine: boolean
  /**
   * The press. When it returns a promise the button stays down until it settles: a double tap sends one request, and a
   * refusal gives the button back (an accepted press has made `mine` true by then).
   */
  onSkip?: () => void | Promise<unknown>
}

/**
 * The strip shows the winners and the viewer, and folds the rest into "+N người" — unless only one row would fold, which
 * the "+1" line would cost as much height as the row itself.
 */
const STRIP_FOLD_AFTER = 1
const USED_SEP = '; '
const NAME_SEP = ', '
const SEAT_SEP = ' — '

/**
 * `HAND_CANCELLED.reason` is an operator-facing token the server picks ("shutdown", "server restart", …). It is not
 * a sentence, and it is certainly not Vietnamese, so it is normalised to a key and looked up — anything the kit
 * does not have wording for falls back to a plain "the hand was cancelled" rather than leaking the raw token.
 */
const reasonKey = (reason: string): string => {
  const words = reason.trim().toLowerCase().split(/[\s_-]+/).filter((w) => w !== '')
  if (words.length === 0) return 'other'
  return words.map((w, i) => (i === 0 ? w : w[0]!.toUpperCase() + w.slice(1))).join('')
}

/**
 * Whether a scroll box holds more below its fold: taller inside than out, and not yet scrolled to the end. Measured
 * again on every scroll and whenever the box, or anything directly in it, changes size (a narrower window, a font
 * landing, a side-pot ledger appearing); `key` names what the box shows, so a new one is observed afresh.
 */
function useMoreBelow(ref: RefObject<HTMLElement>, key: unknown): boolean {
  const [more, setMore] = useState(false)
  useEffect(() => {
    const box = ref.current
    if (box === null) return
    const measure = (): void => setMore(box.scrollHeight - box.clientHeight - box.scrollTop > 1)
    measure()
    box.addEventListener('scroll', measure, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    if (observer !== null) for (const el of [box, ...Array.from(box.children)]) observer.observe(el)
    return () => {
      box.removeEventListener('scroll', measure)
      observer?.disconnect()
    }
  }, [ref, key])
  return more
}

/** Showdown card: who won, with what, and for how much. Renders only for a completed hand that carries a result. */
export function HandResult({
  hand,
  room,
  myPlayerId,
  lang,
  onDismiss,
  countdown,
  frame = 'desktop',
  chaosCredits = [],
  variant = 'card',
  skip = null,
  stage,
}: HandResultProps) {
  const { t } = useTranslation()
  const titleId = useId()
  const bodyRef = useRef<HTMLDivElement>(null)
  const moreBelow = useMoreBelow(bodyRef, hand.result)
  const result = hand.result
  if (hand.phase !== 'COMPLETE' || result === null) return null

  const seats = hand.seats ?? []
  const mySeat = seats.find((x) => x.playerId === myPlayerId)?.seat ?? null
  const nameOf = (seat: number): string =>
    seats.find((x) => x.seat === seat)?.displayName ?? room.players?.find((p) => p.seat === seat)?.displayName ?? String(seat)

  const showdown = new Map<number, ShowdownHand>((result.showdown ?? []).map((h) => [h.seat, h]))
  const paid = new Map<number, number>()
  for (const p of result.payouts) paid.set(p.seat, (paid.get(p.seat) ?? 0) + p.amount)

  const winners = [...paid.entries()].filter(([, amount]) => amount > 0).sort((a, b) => b[1] - a[1])
  const rest = [...showdown.keys()].filter((seat) => !paid.has(seat)).sort((a, b) => a - b)
  const rows = [...winners.map(([seat, amount]) => ({ seat, amount })), ...rest.map((seat) => ({ seat, amount: 0 }))]

  const title = result.cancelled ? t('labels.handCancelled') : winners.length > 1 ? t('labels.winners') : t('labels.winner')
  const feeText = `${t('labels.fee')} ${formatPoints(result.fee, lang)}`
  const carryText = `${t('labels.carryOver')} ${formatPoints(result.carryOverOut, lang)}`
  const uncalled = result.uncalledReturned
  const uncalledText =
    uncalled === null ? '' : `${t('labels.uncalledReturned')} ${nameOf(uncalled.seat)} ${formatPoints(uncalled.amount, lang)}`

  // Poker hỗn loạn: "Thẻ đã dùng" — Name — card, card; Name — card — and then each credit a card paid. A card something
  // stopped says so after its name. A hand that used none, and a table without chaos, print neither line. Each card's name
  // opens what it does, who played it, on whom and how it went (`ChaosCardInfo`, spec §3.5); the line reads as before.
  const cardName = (cardId: string): string => t(`chaos.cards.${cardId}.name`, { defaultValue: cardId })
  const usedBySeat = new Map<number, NonNullable<typeof result.chaosUsed>>()
  for (const u of result.chaosUsed ?? []) usedBySeat.set(u.seat, [...(usedBySeat.get(u.seat) ?? []), u])
  const usedPrefix = `${t('chaos.used')}: `
  const usedText =
    usedBySeat.size === 0 ? null : (
      <span className={cx(s.resultMeta, s.resultChaos)}>
        {usedPrefix}
        {[...usedBySeat].map(([seat, uses], i) => (
          <Fragment key={seat}>
            {i === 0 ? null : USED_SEP}
            {nameOf(seat) + SEAT_SEP}
            {uses.map((u, j) => {
              const outcome = u.outcome === 'applied' ? '' : ` (${t(`chaos.outcome.${u.outcome}`, { defaultValue: u.outcome })})`
              const use = { by: nameOf(seat), targets: (u.targets ?? []).map(nameOf), outcome: u.outcome as ChaosOutcome }
              return (
                <Fragment key={`${j}:${u.cardId}`}>
                  {j === 0 ? null : NAME_SEP}
                  <ChaosCardInfo cardId={u.cardId} use={use} className={s.resultCardName}>
                    {cardName(u.cardId)}
                  </ChaosCardInfo>
                  {outcome}
                </Fragment>
              )
            })}
          </Fragment>
        ))}
      </span>
    )
  const creditLines = chaosCredits.map((c, i) => {
    const paid = t(`chaos.credit.${c.reason}`, { amount: formatPoints(c.amount, lang), multiplier: c.multiplier ?? 2 })
    return { key: `${i}:${c.seat}:${c.reason}`, text: `${nameOf(c.seat)}: ${paid}${c.capped ? ` · ${t('chaos.capped')}` : ''}` }
  })

  // One box for the chaos lines, so the card is no wider for them than its own rows: "Thẻ đã dùng" on a line of its own, the
  // credits after it, and the box wraps at 34rem. It is the footer's — except on a phone held sideways, whose card has no height
  // for a footer of four lines: there it ends the scrolling body, after the rows and the ledger.
  const chaosBox =
    usedText === null && creditLines.length === 0 ? null : (
      <div className={s.resultChaosBox}>
        {usedText}
        {creditLines.map((line) => (
          <span key={line.key} className={cx(s.resultMeta, s.resultCredit)}>
            {line.text}
          </span>
        ))}
      </div>
    )

  // "Bỏ qua" (spec §3.3): the tally for everyone, the button for a seated player.
  const skipBlock = skip === null ? null : <SkipControl skip={skip} handId={hand.handId} />

  if (variant === 'strip') {
    // Winners first, then the viewer; the rest fold into "+N người" (spec §3.2): the strip must leave the felt its height on a
    // phone with eight seats.
    const shown = rows.filter(({ seat, amount }) => amount > 0 || seat === mySeat)
    const folded = rows.length - shown.length > STRIP_FOLD_AFTER ? rows.length - shown.length : 0
    const rowNode = ({ seat, amount }: { seat: number; amount: number }) => {
      const hit = showdown.get(seat)
      const payoutText = `+${formatPoints(amount, lang)}`
      return (
        <li key={seat} className={cx(s.stripRow, seat === mySeat && s.resultMine)} data-won={amount > 0 ? 'true' : undefined}>
          <span className={s.resultName}>{nameOf(seat)}</span>
          {hit === undefined ? <span /> : <span className={s.resultHand}>{handLabel(hit.category, t)}</span>}
          {amount > 0 ? <span className={s.resultPayout}>{payoutText}</span> : null}
        </li>
      )
    }
    return (
      <ResultStrip
        titleId={titleId}
        title={title}
        frame={frame}
        handId={hand.handId}
        countdown={countdown}
        skip={skipBlock}
        note={
          result.cancelled && result.reason !== null ? (
            <p className={s.resultNote}>{t(`cancel.${reasonKey(result.reason)}`, { defaultValue: t('cancel.other') })}</p>
          ) : null
        }
        rows={rows.map(rowNode)}
        shown={(folded > 0 ? shown : rows).map(rowNode)}
        folded={folded}
        used={usedText}
        credits={creditLines.map((line) => (
          <span key={line.key} className={cx(s.resultMeta, s.resultCredit)}>
            {line.text}
          </span>
        ))}
        {...(stage === undefined ? {} : { stage })}
      />
    )
  }

  return (
    <div className={s.result} role="group" aria-labelledby={titleId} data-frame={frame}>
      {/* The live region stops short of the footer (review round 2, R2-4): what a screen reader announces when the card
          appears is the title, the reason a hand was cancelled, and the rows and the pot ledger. The fee, the
          carry-over, the uncalled return and the countdown that ticks every second follow it, outside every live
          region, so no tick can have the receipt read out again. They stay on the card and are read on navigation. */}
      <div className={s.resultLive} role="status">
        <div className={s.resultHead}>
          <h2 id={titleId} className={s.resultTitle}>
            {title}
          </h2>
          {/* "Bỏ qua" on the card (BP-39): in the head, beside "Đóng", where the row has the room — in the footer it made the
              card 170 px wider, into the toasts' column at 1366 px, and pushed the winner's row out of a card stopped above the
              viewer's seat. */}
          {skipBlock}
          {onDismiss === undefined ? null : (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t('actions.close')}
            </Button>
          )}
        </div>

        {result.cancelled && result.reason !== null ? (
          <p className={s.resultNote}>{t(`cancel.${reasonKey(result.reason)}`, { defaultValue: t('cancel.other') })}</p>
        ) : null}

        {/* The card never grows past the felt it is dealt onto: with six hands shown down and a side pot or two, the
            ledger and the rows scroll here while the title, the close button and the footer stay put. While there is
            more below the fold, `data-more` fades the box's foot, so it reads as a list that goes on. */}
        <div ref={bodyRef} className={s.resultBody} data-more={moreBelow ? 'true' : undefined}>
          <ul className={s.resultRows}>
            {rows.map(({ seat, amount }) => {
              const hit = showdown.get(seat)
              const payoutText = `+${formatPoints(amount, lang)}`
              return (
                <li key={seat} className={cx(s.resultRow, seat === mySeat && s.resultMine)}>
                  <span className={s.resultName}>{nameOf(seat)}</span>
                  {hit === undefined ? null : <span className={s.resultHand}>{handLabel(hit.category, t)}</span>}
                  {hit === undefined ? null : (
                    <span className={s.resultCards}>
                      {hit.best.map((card, i) => (
                        <Card key={card} card={card} size="sm" delayMs={i * CARD_STAGGER_MS} highlighted={amount > 0} />
                      ))}
                    </span>
                  )}
                  {amount > 0 ? <span className={s.resultPayout}>{payoutText}</span> : null}
                </li>
              )
            })}
          </ul>

          {/* One pot needs no breakdown — `payouts` already says who took it. Two or more means somebody was all-in
              for less than the rest, and "who was eligible for which pot" is the only way that reads as fair. The
              ledger sits under the rows, as its hairline rule was drawn for: with the card capped at the felt's
              height the rows are what shows first, and the ledger is a scroll away. */}
          {result.pots.length > 1 ? (
            <ul className={s.pots}>
              {result.pots.map((pot, i) => {
                const label = i === 0 ? t('labels.mainPot') : t('labels.sidePot', { n: i })
                const eligibleText = `${t('labels.eligible')}: ${pot.eligibleSeats.map(nameOf).join(', ')}`
                return (
                  <li key={`${label}${pot.amount}`} className={s.potRow}>
                    <span className={s.potName}>{label}</span>
                    <span className={s.potAmount}>{formatPoints(pot.amount, lang)}</span>
                    <span className={s.potEligible}>{eligibleText}</span>
                    <span className={s.potWinners}>
                      {pot.winners
                        .map((w) => ({ seat: w.seat, text: `${nameOf(w.seat)} +${formatPoints(w.amount, lang)}` }))
                        .map((w) => (
                          <span key={w.seat} className={s.potWinner}>
                            {w.text}
                          </span>
                        ))}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
          {frame === 'landscape' ? chaosBox : null}
        </div>
      </div>

      <div className={s.resultFoot}>
        {result.fee > 0 ? <span className={s.resultMeta}>{feeText}</span> : null}
        {result.carryOverOut > 0 ? <span className={s.resultMeta}>{carryText}</span> : null}
        {uncalled === null ? null : <span className={s.resultMeta}>{uncalledText}</span>}
        {frame === 'landscape' ? null : chaosBox}
        {countdown === undefined || countdown === null ? null : <p className={s.resultNext}>{countdown}</p>}
      </div>
    </div>
  )
}

/**
 * "Bỏ qua" (spec §3.3): the tally for everyone, the button for a seated player. Its name is exactly "Bỏ qua" — never a word the
 * tray's "Bỏ bài" shares a locator with — and "Đã bỏ qua", down for good, once pressed. While the press is out the button is
 * down too (a double tap sends one request); a refusal gives it back. `aria-live="off"`: on the card it sits in the head,
 * inside the live region, and a press elsewhere at the table must not have the receipt read out again.
 */
function SkipControl({ skip, handId }: { skip: ResultSkip; handId: string }) {
  const { t } = useTranslation()
  /** The hand whose press is out: a new hand's button is never down for the last one's request. */
  const [pendingFor, setPendingFor] = useState<string | null>(null)
  const pending = pendingFor === handId
  const onSkip = skip.onSkip
  const press = (): void => {
    if (onSkip === undefined || pending || skip.mine) return
    const sent = onSkip()
    if (sent === undefined) return
    setPendingFor(handId)
    const done = (): void => setPendingFor((was) => (was === handId ? null : was))
    void Promise.resolve(sent).then(done, done)
  }
  return (
    <span className={s.resultSkip} aria-live="off">
      <span className={s.resultSkipCount}>{t('chaos.result.skipCount', { done: skip.skipped, total: skip.total })}</span>
      {onSkip === undefined ? null : (
        <Button variant={skip.mine ? 'ghost' : 'primary'} size="sm" disabled={skip.mine || pending} onClick={press}>
          {t(skip.mine ? 'chaos.result.skipped' : 'chaos.result.skip')}
        </Button>
      )}
    </span>
  )
}

interface ResultStripProps {
  titleId: string
  title: string
  frame: RoomFrame
  handId: string
  countdown: ReactNode
  skip: ReactNode
  note: ReactNode
  /** Every row, and the rows the closed strip shows (the winners and the viewer, when `folded` > 0). */
  rows: ReactNode[]
  shown: ReactNode[]
  folded: number
  used: ReactNode
  credits: ReactNode[]
  stage?: RefObject<HTMLElement>
}

/** The opened sheet may cover this share of the stage above the strip's closed top. */
const SHEET_STAGE_SHARE = 0.6
/** …and keeps this far below the stage's top edge. */
const SHEET_TOP_GAP = 8

/**
 * The chaos strip (spec §3.2, review fix round 1). Closed, it holds whole lines only — the winners' and the viewer's rows,
 * "Thẻ đã dùng" clamped to two lines, and one line of expanders: "+N người" for the folded rows, "+N thẻ khác" for the
 * cards (and credits) the clamp hides — and its height never changes, so the felt keeps what it was given. Either expander
 * opens it into a sheet that grows upward over the felt from the strip's own foot: every row and the whole line, with
 * "Đóng" in the expanders' place that folds it back. The sheet scrolls inside only when even its cap is not enough. Focus goes to "Đóng"
 * when it opens and back to the expander that opened it when it closes; the next hand brings a closed strip.
 */
function ResultStrip({ titleId, title, frame, handId, countdown, skip, note, rows, shown, folded, used, credits, stage }: ResultStripProps) {
  const { t } = useTranslation()
  const slotRef = useRef<HTMLDivElement>(null)
  const usedRef = useRef<HTMLDivElement>(null)
  const bodyId = useId()
  const [openFor, setOpenFor] = useState<string | null>(null)
  const open = openFor === handId
  /** The strip's closed height and the sheet's cap, taken as it opens (and again when the window changes size). */
  const [sheet, setSheet] = useState<{ closed: number; max: number | null } | null>(null)
  const opener = useRef<'people' | 'cards' | null>(null)
  const [hidden, setHidden] = useState(0)

  // How many cards (and credits) the two-line clamp hides: every card name, every credit, whose last line box starts at or
  // below the clamp's foot. Measured while closed, again whenever the box changes size.
  useEffect(() => {
    const box = usedRef.current
    if (box === null || open) return
    const measure = (): void => {
      if (box.scrollHeight <= box.clientHeight + 1) {
        setHidden(0)
        return
      }
      const foot = box.getBoundingClientRect().top + box.clientHeight - 1
      const items = Array.from(box.querySelectorAll(`.${s.resultCardName}, .${s.resultCredit}`))
      const count = items.filter((el) => {
        const lines = el.getClientRects()
        const last = lines[lines.length - 1]
        return last !== undefined && last.top >= foot
      }).length
      setHidden(Math.max(count, 1))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(box)
    return () => observer?.disconnect()
    // the box's content is the hand's: measured afresh for each hand, each opening and closing, and each credit that lands
  }, [open, handId, credits.length])

  const capOf = (closed: number): number | null => {
    const slot = slotRef.current
    const room = stage?.current
    if (slot === null || room === undefined || room === null) return null
    const a = slot.getBoundingClientRect()
    const b = room.getBoundingClientRect()
    if (b.height === 0) return null
    return Math.max(closed, Math.round(Math.min(closed + SHEET_STAGE_SHARE * b.height, a.bottom - b.top - SHEET_TOP_GAP)))
  }

  const openSheet = (which: 'people' | 'cards'): void => {
    const closed = slotRef.current?.offsetHeight ?? 0
    opener.current = which
    setSheet({ closed, max: capOf(closed) })
    setOpenFor(handId)
  }
  const closeSheet = (): void => setOpenFor(null)

  // Focus: onto "Đóng" as the sheet opens (it takes the pressed expander's place), back to that expander as it closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    const slot = slotRef.current
    if (slot === null) return
    if (open && !wasOpen.current) slot.querySelector<HTMLElement>('[data-strip-close]')?.focus()
    if (!open && wasOpen.current && opener.current !== null) slot.querySelector<HTMLElement>(`[data-strip-more='${opener.current}']`)?.focus()
    wasOpen.current = open
  }, [open])

  // The cap follows the window while the sheet is up (a phone turning, a browser bar sliding away).
  useEffect(() => {
    if (!open) return
    const again = (): void => setSheet((was) => (was === null ? was : { closed: was.closed, max: capOf(was.closed) }))
    window.addEventListener('resize', again)
    return () => window.removeEventListener('resize', again)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `capOf` reads refs only
  }, [open])

  const slotStyle =
    open && sheet !== null
      ? ({ height: sheet.closed, ...(sheet.max === null ? {} : { '--sheet-max': `${sheet.max}px` }) } as CSSProperties)
      : undefined
  const hasUsed = used !== null || credits.length > 0
  const peopleMore = !open && folded > 0
  const cardsMore = !open && hidden > 0

  return (
    <div ref={slotRef} className={s.stripSlot} data-open={open ? 'true' : undefined} style={slotStyle}>
      <div className={s.strip} role="group" aria-labelledby={titleId} data-frame={frame} data-open={open ? 'true' : undefined}>
        <div className={s.stripHead}>
          {/* The title alone names the group ("Người thắng", "Ván bị hủy": the ops pack finds the result by it); the countdown
              is its own element after it, outside every live region, as on the card. */}
          <h2 id={titleId} className={cx(s.resultTitle, s.stripTitle)}>
            {title}
          </h2>
          {countdown === undefined || countdown === null ? null : <p className={s.stripNext}>{countdown}</p>}
          {skip}
        </div>
        <div id={bodyId} className={s.stripBody}>
          <div className={s.stripPeople}>
            <div className={s.resultLive} role="status">
              {note}
              <ul className={s.stripRows}>{open ? rows : shown}</ul>
            </div>
          </div>
          {hasUsed ? (
            <div ref={usedRef} className={s.stripUsed} data-clamped={open ? undefined : 'true'}>
              {used}
              {credits}
            </div>
          ) : null}
        </div>
        {/* The expanders' line, under the body and outside its scroll, so the toggle is always in reach: closed, "+N người" and
            "+N thẻ khác"; opened, "Đóng" in their place, which folds the sheet back. */}
        {open || peopleMore || cardsMore ? (
          <div className={s.stripMores}>
            {open ? (
              <button type="button" className={s.stripMore} aria-expanded aria-controls={bodyId} data-strip-close="" onClick={closeSheet}>
                {t('actions.close')}
              </button>
            ) : null}
            {peopleMore ? (
              <button type="button" className={s.stripMore} aria-expanded={false} aria-controls={bodyId} data-strip-more="people" onClick={() => openSheet('people')}>
                {t('chaos.result.more', { count: folded })}
              </button>
            ) : null}
            {cardsMore ? (
              <button type="button" className={s.stripMore} aria-expanded={false} aria-controls={bodyId} data-strip-more="cards" onClick={() => openSheet('cards')}>
                {t('chaos.toast.more', { count: hidden })}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
