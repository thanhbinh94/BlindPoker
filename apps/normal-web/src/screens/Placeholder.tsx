import { Button } from '@bp/ui-kit'
import { useTranslation } from 'react-i18next'
import s from './normal.module.css'

export interface PlaceholderProps {
  /** The hash route this stands in for, printed verbatim so a tester can see which one they landed on. */
  route: string
  /** The one control this route must not swallow while the real screen is missing — sign-out, on `/settings`. */
  action?: { label: string; onClick: () => void }
}

/**
 * **Temporary.** Every route in `App.tsx` exists so the shell, the rail and the session gate can be tested
 * end to end; Profile, Avatar, Inventory and Achievements have since replaced their placeholders, and Daily
 * and Settings arrive in Task 4. When the last one lands this file goes with it — it is scaffolding, not a
 * feature, and nothing outside `App.tsx` should import it.
 */
export function Placeholder({ route, action }: PlaceholderProps) {
  const { t } = useTranslation('normal')
  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('placeholder.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>
      <p className={s.footnote}>{t('placeholder.lead')}</p>
      <p className={s.route}>{route}</p>
      {action === undefined ? null : (
        <p>
          <Button variant="ghost" onClick={action.onClick}>
            {action.label}
          </Button>
        </p>
      )}
    </main>
  )
}
