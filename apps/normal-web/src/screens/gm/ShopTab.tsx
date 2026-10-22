import { Button } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import s from '../normal.module.css'
import { useAsync } from '../useAsync.js'
import { FeaturedEditor } from './FeaturedEditor.js'
import g from './gm.module.css'
import { PricesEditor } from './PricesEditor.js'
import { ReputationEditor } from './ReputationEditor.js'
import type { GmTabProps } from './tabProps.js'
import { WelcomeEditor } from './WelcomeEditor.js'

/**
 * The Cửa hàng tab (Plan 27, spec B4 and A5): four blocks over one read of `GET /api/gm/shop` — the prices, the week's
 * shelf, the welcome gift and reputation's two tables. Each block keeps its edits to itself until its own Save, which
 * asks for a reason; once the server takes it, the whole tab is read again and a line says what happened.
 *
 * Each block is keyed on the part of the reply it edits, so a reload that changed that part starts the block afresh
 * from the server's values, and one that did not leaves another block's unsaved edits where they were.
 */
export function ShopTab({ api }: GmTabProps) {
  const { t } = useTranslation('normal')
  const config = useAsync(() => api.gmShop())
  const [done, setDone] = useState<string | null>(null)

  const data = config.data
  if (data === null) {
    return config.loading ? (
      <p className={s.footnote} role="status">
        {t('screens.loading')}
      </p>
    ) : (
      <div className={g.stack}>
        <p className={s.alert} role="alert">
          {t('gm.shop.error')}
        </p>
        <p>
          <Button variant="ghost" onClick={config.reload}>
            {t('screens.retry')}
          </Button>
        </p>
      </div>
    )
  }

  const onDone = (message: string): void => {
    setDone(message)
    config.reload()
  }

  return (
    <div className={g.stack}>
      <p className={s.footnote}>{t('gm.shop.lead')}</p>
      {/* Always in the page, so a screen reader has the region before its text arrives. */}
      <div role="status">{done === null ? null : <p className={s.notice}>{done}</p>}</div>

      <PricesEditor key={JSON.stringify(data.prices.map((p) => [p.itemId, p.priced, p.pricePoints, p.minRank, p.enabled]))} api={api} rows={data.prices} onDone={onDone} />
      {/* Not keyed: the chosen week survives a save; each week's shelf is keyed on its own data inside. */}
      <FeaturedEditor api={api} weeks={data.featured} rows={data.prices} onDone={onDone} />
      <WelcomeEditor
        key={data.welcomeChoices.join(',')}
        api={api}
        choices={data.welcomeChoices}
        slots={data.welcomeSlots}
        rows={data.prices}
        onDone={onDone}
      />
      <ReputationEditor key={JSON.stringify(data.reputation)} api={api} rules={data.reputation.rules} ranks={data.reputation.ranks} onDone={onDone} />
    </div>
  )
}
