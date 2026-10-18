import type { Language } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import type { NormalApi } from '../../api.js'
import s from '../normal.module.css'

export interface GmScreenProps {
  /** The guarded api: a `403` from any `/api/gm/*` call is `onForbidden`'s business, a `401` the gate's. */
  api: NormalApi
  lang: Language
  /** The server said this account is no longer a GM (demoted or locked since the page loaded): leave the console. */
  onForbidden: () => void
}

/**
 * The game master's console. The route, the lazy chunk and the heading are here so the plumbing can be proven;
 * the four tabs (overview, players, rooms, log) replace this body in the screen's own task.
 */
export function GmScreen(_props: GmScreenProps) {
  const { t } = useTranslation('normal')

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('gm.title')}</h1>
      </div>
    </main>
  )
}
