import { validateDisplayName } from '@bp/core'
import { Button, Field, LanguageSwitch } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, NETWORK_ERROR_CODE, type AuthMeDto, type NormalApi } from '../api.js'
import { useLanguagePref } from '../prefs.js'
import { loadLastEmail, saveLastEmail } from '../session.js'
import s from './normal.module.css'

const SPADE = '♠'
const EYE_OPEN = '◉'
const EYE_SHUT = '◎'

/** Fixed ids rather than `useId`: this screen renders once, and the reveal button needs a stable target. */
const PASSWORD_ID = 'bp-auth-password'
const PASSWORD_HINT_ID = 'bp-auth-password-hint'

export type AuthMode = 'signIn' | 'register'

/** The server's rule (`auth-service.ts`): 8–128 characters, and not the email address. */
export const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128

/** Refusals this screen has words for; anything else falls back to the kit's generic error. */
const KNOWN_CODES = new Set([
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'INVALID_NAME',
  'EMAIL_TAKEN',
  'DISPLAY_NAME_TAKEN',
  'BAD_CREDENTIALS',
  'RATE_LIMITED',
  'FORBIDDEN',
])

/**
 * A refusal in the player's language.
 *
 * `RATE_LIMITED` is the one code that carries a number: the server puts `retryAfterSec` beside the envelope,
 * `ApiError` keeps it, and the message says how long rather than merely that it was too often. The fallback
 * when the server sent no number is one minute, which is the width of every limiter's window (§19.2).
 */
export function refusalText(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError) {
    if (cause.code === NETWORK_ERROR_CODE) return t('auth.errors.NETWORK')
    if (cause.code === 'RATE_LIMITED') return t('auth.errors.RATE_LIMITED', { seconds: cause.retryAfterSec ?? 60 })
    if (KNOWN_CODES.has(cause.code)) return t(`auth.errors.${cause.code}`)
  }
  return t('common:errors.INTERNAL')
}

export interface AuthScreenProps {
  api: NormalApi
  mode: AuthMode
  /** Fires when the player picks the other tab; the app moves the route to `/login` or `/register`. */
  onMode: (mode: AuthMode) => void
  /** Fires with the account the server just bound the cookie to; the app opens the socket. */
  onSignedIn: (me: AuthMeDto) => void
  /** Why the player is back here — an expired session, most often. */
  message?: string | null
}

/**
 * The way in. One card on the ink ground with two tabs: sign in, or register.
 *
 * Nothing token-shaped crosses this screen. A successful call leaves a `HttpOnly` cookie the browser will
 * send from here on, and all this component gets back is who it now is — which it hands upward and forgets.
 * The only thing written to the device is the email, so coming back does not mean typing it again.
 */
export function AuthScreen({ api, mode, onMode, onSignedIn, message = null }: AuthScreenProps) {
  const { t } = useTranslation('normal')
  const { lang, setLang } = useLanguagePref()
  const [email, setEmail] = useState(loadLastEmail)
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [reveal, setReveal] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const registering = mode === 'register'

  // The live hint under the name field: the kit's default rule until the player types something the *server's*
  // validator would refuse, at which point it says which rule was broken. Same function the server runs, so a
  // name accepted here is never refused there for a different reason.
  const nameVerdict = validateDisplayName(displayName)
  const nameHint = displayName === '' || nameVerdict.ok ? t('auth.displayNameHint') : t(`auth.name.${nameVerdict.reason}`)

  const switchTo = (next: AuthMode): void => {
    if (next === mode) return
    setError(null)
    onMode(next)
  }

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return

    // The three rules the browser can check without a round trip. Everything else — whether the address is
    // registerable, whether the password matches — is the server's to say.
    const address = email.trim()
    if (address === '') {
      setError(t('auth.errors.INVALID_EMAIL'))
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      setError(t('auth.errors.INVALID_PASSWORD'))
      return
    }
    if (registering && !nameVerdict.ok) {
      setError(t('auth.errors.INVALID_NAME'))
      return
    }

    setBusy(true)
    try {
      // The *normalized* name is what gets sent, so a stray trailing space is corrected here rather than
      // refused there.
      const me = registering
        ? await api.register({ email: address, password, displayName: nameVerdict.ok ? nameVerdict.name : displayName })
        : await api.login({ email: address, password })
      saveLastEmail(address)
      onSignedIn(me)
    } catch (cause) {
      setError(refusalText(cause, t))
      setBusy(false)
    }
  }

  return (
    <main className={s.authStage}>
      <div className={s.card}>
        <div className={s.cardHead}>
          <span className={s.eyebrow}>
            <span aria-hidden="true">{SPADE}</span> {t('app.edition')}
          </span>
          <h1 className={s.authTitle}>{t('auth.title')}</h1>
          <p className={s.lead}>{t('auth.lead')}</p>
        </div>

        <div className={s.tabs} role="tablist" aria-label={t('auth.title')}>
          <button
            type="button"
            role="tab"
            className={s.tab}
            aria-selected={!registering}
            onClick={() => switchTo('signIn')}
          >
            {t('auth.signIn')}
          </button>
          <button
            type="button"
            role="tab"
            className={s.tab}
            aria-selected={registering}
            onClick={() => switchTo('register')}
          >
            {t('auth.register')}
          </button>
        </div>

        {message === null ? null : (
          <p className={s.notice} role="status">
            {message}
          </p>
        )}
        {error === null ? null : (
          <p className={s.alert} role="alert">
            {error}
          </p>
        )}

        <form className={s.form} onSubmit={submit} noValidate>
          <Field label={t('auth.email')}>
            <input
              className={s.input}
              type="email"
              value={email}
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder={t('auth.emailPlaceholder')}
              onChange={(event) => {
                setEmail(event.target.value)
                setError(null)
              }}
            />
          </Field>

          <div className={s.secretField}>
            <label className={s.label} htmlFor={PASSWORD_ID}>
              {t('auth.password')}
            </label>
            <div className={s.secret}>
              <input
                id={PASSWORD_ID}
                className={s.input}
                type={reveal ? 'text' : 'password'}
                value={password}
                minLength={MIN_PASSWORD_LENGTH}
                aria-describedby={registering ? PASSWORD_HINT_ID : undefined}
                autoComplete={registering ? 'new-password' : 'current-password'}
                onChange={(event) => {
                  setPassword(event.target.value)
                  setError(null)
                }}
              />
              <button
                type="button"
                className={s.reveal}
                aria-pressed={reveal}
                aria-label={reveal ? t('auth.hidePassword') : t('auth.showPassword')}
                onClick={() => setReveal(!reveal)}
              >
                <span aria-hidden="true">{reveal ? EYE_OPEN : EYE_SHUT}</span>
              </button>
            </div>
            {registering ? (
              <span className={s.hint} id={PASSWORD_HINT_ID}>
                {t('auth.passwordHint')}
              </span>
            ) : null}
          </div>

          {registering ? (
            <Field label={t('auth.displayName')} hint={nameHint}>
              <input
                className={s.input}
                type="text"
                value={displayName}
                autoComplete="nickname"
                autoCapitalize="words"
                spellCheck={false}
                placeholder={t('auth.displayNamePlaceholder')}
                onChange={(event) => {
                  setDisplayName(event.target.value)
                  setError(null)
                }}
              />
            </Field>
          ) : null}

          <Button className={s.submit} type="submit" variant="gold" size="lg" loading={busy}>
            {t(registering ? 'auth.submitRegister' : 'auth.submitSignIn')}
          </Button>
        </form>

        <button type="button" className={s.switcher} onClick={() => switchTo(registering ? 'signIn' : 'register')}>
          {t(registering ? 'auth.toSignIn' : 'auth.toRegister')}
        </button>
      </div>

      <div className={s.authLang}>
        <LanguageSwitch lang={lang} onChange={setLang} />
      </div>
    </main>
  )
}
