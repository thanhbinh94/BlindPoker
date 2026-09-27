import { Button } from '@bp/ui-kit'
import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { isChunkLoadError } from '../stale-chunk.js'
import s from './normal.module.css'

/**
 * What a lazy account screen shows instead of a blank page when its chunk could not load (bug 4): a new version
 * was deployed under an open tab, and `lazyScreen` has already spent its one automatic reload — or the failure
 * was something else. Either way the player gets a sentence and a button, never an empty page.
 *
 * Keyed by route in `App.tsx`, so moving to another screen starts from a clean slate.
 */
interface State {
  error: unknown
}

export interface UpdateBoundaryProps {
  children: ReactNode
  /** Injected in tests; the page reload otherwise. */
  onReload?: () => void
}

export class UpdateBoundary extends Component<UpdateBoundaryProps, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error }
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children
    return <UpdateNotice stale={isChunkLoadError(this.state.error)} onReload={this.props.onReload ?? (() => window.location.reload())} />
  }
}

function UpdateNotice({ stale, onReload }: { stale: boolean; onReload: () => void }) {
  const { t } = useTranslation('normal')
  return (
    <div className={s.updateNotice} role="alert">
      <p className={s.updateTitle}>{t(stale ? 'screens.newVersion' : 'screens.failed')}</p>
      <p className={s.updateHint}>{t('screens.reloadHint')}</p>
      <Button variant="gold" onClick={onReload}>
        {t('screens.reload')}
      </Button>
    </div>
  )
}
