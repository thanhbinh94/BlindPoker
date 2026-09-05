import { Button, LanguageSwitch, Modal, Panel, type Language } from '@bp/ui-kit'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MeDto, NormalApi } from '../api.js'
import { useThemePref } from '../prefs.js'
import s from './normal.module.css'
import { useAsync } from './useAsync.js'

export interface SettingsScreenProps {
  api: NormalApi
  lang: Language
  /** The app owns the language, so the switch here is the same control the rail carries — not a second one. */
  onLanguage: (lang: Language) => void
  /**
   * The app's sign-out path. It is the app's and not this screen's because a session can also end *without*
   * anybody pressing this button — an expired cookie, a refused upgrade — and there must be exactly one place
   * that tells the server, drops the socket, forgets the email and returns to the card.
   */
  onSignedOut: () => void
  /** `NORMAL_VERSION`, passed rather than imported: importing it from `App.tsx` would pull the app into this chunk. */
  version: string
}

/**
 * The four things a player changes about the app rather than about the game: how it looks, what language it
 * speaks, whose account it is signed into, and which build they are looking at when something goes wrong.
 *
 * Only the account section needs the network, so only it has a loading state; the theme and the language are
 * device preferences that are already known before the first render.
 */
export function SettingsScreen({ api, lang, onLanguage, onSignedOut, version }: SettingsScreenProps) {
  const { t } = useTranslation('normal')
  const { theme, setTheme } = useThemePref()
  const account = useAsync<MeDto>(() => api.me())
  const [confirming, setConfirming] = useState(false)
  const me = account.data

  return (
    <main className={s.page}>
      <div className={s.pageHead}>
        <h1>{t('settings.title')}</h1>
        <span className={s.rule} aria-hidden="true" />
      </div>

      <Panel title={t('settings.theme.title')}>
        <p className={s.footnote}>{t('settings.theme.lead')}</p>
        <div className={s.choices} role="group" aria-label={t('settings.theme.title')}>
          <Button variant={theme === 'dark' ? 'gold' : 'ghost'} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')}>
            {t('settings.theme.dark')}
          </Button>
          <Button variant={theme === 'light' ? 'gold' : 'ghost'} aria-pressed={theme === 'light'} onClick={() => setTheme('light')}>
            {t('settings.theme.light')}
          </Button>
        </div>
      </Panel>

      <Panel title={t('settings.language.title')}>
        <p className={s.footnote}>{t('settings.language.lead')}</p>
        <div className={s.choices}>
          <LanguageSwitch lang={lang} onChange={onLanguage} />
        </div>
      </Panel>

      <Panel title={t('settings.account.title')}>
        {me === null ? (
          account.loading ? (
            <p className={s.footnote} role="status">
              {t('screens.loading')}
            </p>
          ) : (
            <>
              <p className={s.alert} role="alert">
                {t('settings.account.error')}
              </p>
              <p>
                <Button variant="ghost" onClick={account.reload}>
                  {t('screens.retry')}
                </Button>
              </p>
            </>
          )
        ) : (
          <dl className={s.stats}>
            <div className={s.stat}>
              <dt className={s.rowMeta}>{t('settings.account.displayName')}</dt>
              <dd className={s.statValue}>{me.displayName}</dd>
            </div>
            <div className={s.stat}>
              <dt className={s.rowMeta}>{t('settings.account.email')}</dt>
              {/* The column is nullable: §19.2 allows an account with no address on it. */}
              <dd className={s.statValue}>{me.email ?? t('settings.account.noEmail')}</dd>
            </div>
          </dl>
        )}
        <p>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            {t('settings.account.signOut')}
          </Button>
        </p>
      </Panel>

      <Panel title={t('settings.about.title')}>
        <dl className={s.stats}>
          <div className={s.stat}>
            <dt className={s.rowMeta}>{t('settings.about.edition')}</dt>
            <dd className={s.statValue}>{t('app.edition')}</dd>
          </div>
          <div className={s.stat}>
            <dt className={s.rowMeta}>{t('settings.about.version')}</dt>
            <dd className={s.statValue}>{version}</dd>
          </div>
        </dl>
      </Panel>

      {/* Signing out is cheap to do and slow to undo — the player has to type a password to get back in — so it
          asks first. The dialog is the kit's, which means the focus trap and the Escape key come with it. */}
      <Modal
        open={confirming}
        title={t('settings.signOut.title')}
        onClose={() => setConfirming(false)}
        closeLabel={t('settings.signOut.close')}
      >
        <p className={s.footnote}>{t('settings.signOut.body')}</p>
        <div className={s.choices}>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            {t('settings.signOut.cancel')}
          </Button>
          <Button variant="danger" onClick={onSignedOut}>
            {t('settings.signOut.confirm')}
          </Button>
        </div>
      </Modal>
    </main>
  )
}
