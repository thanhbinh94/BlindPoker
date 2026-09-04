import { Button, LanguageSwitch, Modal, Panel, THEME_MODES } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguagePref, useThemePref } from '../prefs.js'
import { clearToken } from '../session.js'
import s from './lite.module.css'

const EMPTY = '—'

export interface SettingsScreenProps {
  /** From the socket's `WELCOME`; `null` until it lands. */
  me: { playerId: string; displayName: string } | null
  /** Fired after the token is gone, so the app can drop back to the name prompt. */
  onSignedOut: () => void
  version: string
}

/**
 * Device settings, and the one irreversible button in the app.
 *
 * Theme and language are device preferences, so this screen owns them outright: it paints the root, writes
 * `bp.theme` / `bp.lang`, and nothing has to be told. Signing out is different — it destroys a session that
 * cannot be recreated, because the display name stays registered — so it asks first.
 */
export function SettingsScreen({ me, onSignedOut, version }: SettingsScreenProps) {
  const { t } = useTranslation('lite')
  const { theme, setTheme } = useThemePref()
  const { lang, setLang } = useLanguagePref()
  const [confirming, setConfirming] = useState(false)

  const signOut = (): void => {
    clearToken()
    setConfirming(false)
    onSignedOut()
  }

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1 className={s.pageTitle}>{t('settings.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>

      <Panel tone="ink" title={t('settings.account')}>
        <dl className={s.rows}>
          <div className={s.row}>
            <dt className={s.rowLabel}>{t('prompt.name')}</dt>
            <dd className={s.rowValue}>{me?.displayName ?? EMPTY}</dd>
          </div>
          <div className={s.row}>
            <dt className={s.rowLabel}>{t('settings.playerId')}</dt>
            <dd className={`${s.rowValue} ${s.mono}`}>{me?.playerId ?? EMPTY}</dd>
          </div>
        </dl>
      </Panel>

      <Panel tone="ink">
        <dl className={s.rows}>
          <div className={s.row}>
            <dt className={s.rowLabel}>{t('settings.theme')}</dt>
            <dd className={s.rowValue}>
              <div className={s.segment} role="group" aria-label={t('settings.theme')}>
                {THEME_MODES.map((mode) => (
                  <button key={mode} type="button" className={s.segBtn} aria-pressed={mode === theme} onClick={() => setTheme(mode)}>
                    {t(`settings.${mode}`)}
                  </button>
                ))}
              </div>
            </dd>
          </div>
          <div className={s.row}>
            <dt className={s.rowLabel}>{t('settings.language')}</dt>
            <dd className={s.rowValue}>
              <LanguageSwitch lang={lang} onChange={setLang} />
            </dd>
          </div>
          <div className={s.row}>
            <dt className={s.rowLabel}>{t('settings.version')}</dt>
            <dd className={`${s.rowValue} ${s.mono}`}>{version}</dd>
          </div>
        </dl>
      </Panel>

      <div className={s.dangerRow}>
        <Button variant="danger" onClick={() => setConfirming(true)}>
          {t('settings.signOut')}
        </Button>
      </div>

      <Modal open={confirming} title={t('settings.signOut')} closeLabel={t('game:actions.close')} onClose={() => setConfirming(false)}>
        <p className={s.modalText}>{t('settings.signOutConfirm')}</p>
        <div className={s.modalActions}>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('game:actions.cancel')}
          </Button>
          <Button variant="danger" onClick={signOut}>
            {t('game:actions.confirm')}
          </Button>
        </div>
      </Modal>
    </main>
  )
}
