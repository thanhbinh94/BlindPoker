import { Button, LanguageSwitch, Modal, Panel, Segmented, THEME_MODES, formatPoints } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguagePref, useThemePref } from '../prefs.js'
import { clearToken } from '../session.js'
import s from './lite.module.css'

const EMPTY = '—'

export interface SettingsScreenProps {
  /** From the socket's `WELCOME`; `null` until it lands. */
  me: { playerId: string; displayName: string } | null
  /** The live balance from the socket. Printed here so the rail can drop its copy on a phone. */
  balance: number
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
export function SettingsScreen({ me, balance, onSignedOut, version }: SettingsScreenProps) {
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
            <dt className={s.rowLabel}>{t('game:labels.balance')}</dt>
            <dd className={s.rowValue}>
              {formatPoints(balance, lang)} {t('common:units.pointsShort')}
            </dd>
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
              <Segmented
                options={THEME_MODES.map((mode) => ({ value: mode, label: t(`settings.${mode}`) }))}
                value={theme}
                onChange={setTheme}
                label={t('settings.theme')}
              />
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
        {/* A quiet button: signing out is not a risky act, the confirm in the dialog is (layout audit C4). */}
          <Button variant="ghost" onClick={() => setConfirming(true)}>
          {t('settings.signOut')}
        </Button>
      </div>

      <Modal
        open={confirming}
        title={t('settings.signOut')}
        closeLabel={t('game:actions.close')}
        onClose={() => setConfirming(false)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              {t('game:actions.cancel')}
            </Button>
            <Button variant="danger" onClick={signOut}>
              {t('game:actions.confirm')}
            </Button>
          </>
        }
      >
        <p className={s.modalText}>{t('settings.signOutConfirm')}</p>
      </Modal>
    </main>
  )
}
