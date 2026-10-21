import { PASSWORD_MIN_LENGTH, validateDisplayName, validatePassword } from '@bp/core'
import { Button, Field, LanguageSwitch } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, type AuthMeDto, type NormalApi } from '../api.js'
import { useLanguagePref } from '../prefs.js'
import { loadLastEmail, saveLastEmail } from '../session.js'
import s from './normal.module.css'
import { refusalText } from './refusal.js'

const SPADE = '♠'
const EYE_OPEN = '◉'
const EYE_SHUT = '◎'

/**
 * The sign-in hero (Task C1: `public/login/`, served `no-cache`). The 768 px file is the phone band's and a narrow
 * column's; the 1536 px one covers 62 % of a 1920 px desktop. The column is 62 vw from 1024 px up, the full width
 * below.
 */
const HERO_SRC = '/login/hero-1536.webp'
const HERO_SRCSET = '/login/hero-768.webp 768w, /login/hero-1536.webp 1536w'
const HERO_SIZES = '(min-width: 1024px) 62vw, 100vw'

/** Fixed ids rather than `useId`: this screen renders once, and the reveal button needs a stable target. */
const PASSWORD_ID = 'bp-auth-password'
const PASSWORD_HINT_ID = 'bp-auth-password-hint'
const PASSWORD_ERROR_ID = 'bp-auth-password-error'

export type AuthMode = 'signIn' | 'register'

export type AuthField = 'email' | 'password' | 'displayName'

/**
 * Which control a refusal is *about*.
 *
 * Everything listed here is a fault in one field, so it is shown on that field and the focus goes there —
 * hearing "that is not valid" without being told which box to go back to is the whole problem. What is
 * deliberately absent is as important: `BAD_CREDENTIALS` blames neither box (saying which half was wrong is
 * how an attacker enumerates addresses), and `RATE_LIMITED`, `FORBIDDEN` and `NETWORK` are about the
 * request rather than anything the player typed. Those stay on the card, as one assertive alert.
 */
export const FIELD_OF: Record<string, AuthField> = {
  INVALID_EMAIL: 'email',
  EMAIL_TAKEN: 'email',
  INVALID_PASSWORD: 'password',
  INVALID_NAME: 'displayName',
  DISPLAY_NAME_TAKEN: 'displayName',
}

/** A refusal, kept with the code that caused it so it can be put where it belongs. */
export interface AuthRefusal {
  code: string
  text: string
  /** The control at fault, or `null` when the refusal is about the request rather than a field. */
  field: AuthField | null
}

/** The same refusal, routed: `refusalText` for the words, `FIELD_OF` for where they go. */
export function refusalOf(cause: unknown, t: TFunction): AuthRefusal {
  const code = cause instanceof ApiError ? cause.code : 'INTERNAL'
  return { code, text: refusalText(cause, t), field: FIELD_OF[code] ?? null }
}

export interface AuthScreenProps {
  api: NormalApi
  mode: AuthMode
  /** Fires when the player picks the other side; the app moves the route to `/login` or `/register`. */
  onMode: (mode: AuthMode) => void
  /** Fires with the account the server just bound the cookie to; the app opens the socket. */
  onSignedIn: (me: AuthMeDto) => void
  /** Why the player is back here — an expired session, most often. */
  message?: string | null
}

/**
 * The way in. One card on the ink ground with two ways through it: sign in, or register.
 *
 * The two are **links**, not a tab widget. Picking one changes the hash route and the app re-renders this
 * screen in the other mode, so they behave exactly like the rail's nav — `href` and `aria-current="page"`,
 * which is what they are — rather than like a `tablist` with no panel to move to and no arrow keys.
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
  const [refusal, setRefusal] = useState<AuthRefusal | null>(null)
  const [busy, setBusy] = useState(false)

  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const registering = mode === 'register'

  // The live hint under the name field: the kit's default rule until the player types something the *server's*
  // validator would refuse, at which point it says which rule was broken. Same function the server runs, so a
  // name accepted here is never refused there for a different reason.
  const nameVerdict = validateDisplayName(displayName)
  const nameHint = displayName === '' || nameVerdict.ok ? t('auth.displayNameHint') : t(`auth.name.${nameVerdict.reason}`)

  /** The message this control should carry, if any. */
  const errorFor = (field: AuthField): string | undefined =>
    refusal !== null && refusal.field === field ? refusal.text : undefined
  const passwordError = errorFor('password')

  /**
   * Records a refusal and, when it belongs to a control, puts the caret there. The focus move is what
   * announces it: landing on the input reads its label, its `aria-invalid` state and the message now wired
   * to it through `aria-describedby`, which is more use than a banner the player has to go looking for.
   */
  const refuse = (next: AuthRefusal): void => {
    setRefusal(next)
    const box = next.field === 'email' ? emailRef : next.field === 'password' ? passwordRef : next.field === 'displayName' ? nameRef : null
    box?.current?.focus()
  }

  const localRefusal = (code: string): AuthRefusal => ({ code, text: t(`auth.errors.${code}`), field: FIELD_OF[code] ?? null })

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return

    // The three rules the browser can check without a round trip. Everything else — whether the address is
    // registerable, whether the password matches — is the server's to say.
    const address = email.trim()
    if (address === '') {
      refuse(localRefusal('INVALID_EMAIL'))
      return
    }
    // The server's own password rule (`@bp/core`): 8–128 characters and, for a new account, neither the whole
    // address nor the part before its `@` — what the hint under the box promises. A sign-in checks the length
    // only; whether the password is right is the server's answer.
    if (!validatePassword(password, registering ? address : undefined).ok) {
      refuse(localRefusal('INVALID_PASSWORD'))
      return
    }
    if (registering && !nameVerdict.ok) {
      refuse(localRefusal('INVALID_NAME'))
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
      // Cleared before the hand-off rather than after it: `onSignedIn` unmounts this screen today, but a
      // caller that kept it mounted would otherwise be left with a button disabled for good.
      setBusy(false)
      onSignedIn(me)
    } catch (cause) {
      refuse(refusalOf(cause, t))
      setBusy(false)
    }
  }

  const clearOn = <T,>(set: (value: T) => void) => (value: T): void => {
    set(value)
    setRefusal(null)
  }
  const onEmail = clearOn(setEmail)
  const onPassword = clearOn(setPassword)
  const onName = clearOn(setDisplayName)

  /** One of the two ways through the card. A real link: the route is what decides which side is showing. */
  const modeLink = (target: AuthMode, path: string, label: string) => (
    <a
      className={s.tab}
      href={`#${path}`}
      aria-current={mode === target ? 'page' : undefined}
      // The `href` is what makes this a link the browser understands; this tells the app in the same tick
      // rather than waiting for the `hashchange` task, exactly as `useHashRoute`'s own `navigate` does.
      onClick={() => onMode(target)}
    >
      {label}
    </a>
  )

  return (
    <main className={s.authStage}>
      {/* Layout A (spec Q8, picture V2): a table of friends fills the left column on a desktop and crowns the card on
          a phone. A night room in either theme, so it carries the night palette itself. The picture is decoration;
          the hero's heading and lead are the words. Spec R10: one `h1` is visible at a time — this one from 1024 px
          up, the card's below — and the other is `display: none` in the stylesheet. */}
      <section className={s.authHero} data-surface="night">
        <img
          className={s.heroImg}
          src={HERO_SRC}
          srcSet={HERO_SRCSET}
          sizes={HERO_SIZES}
          // No `fetchPriority`: `@types/react` types it, but React-DOM 18.3 does not know the prop and warns
          // (pre-flight P23). It comes back with React 19.
          decoding="async"
          alt=""
        />
        <div className={s.heroShade} aria-hidden="true" />
        <div className={s.heroText}>
          <h1 className={s.heroTitle}>{t('auth.title')}</h1>
          <p className={s.heroLead}>{t('auth.heroLead')}</p>
        </div>
      </section>

      <div className={s.authSide}>
        <div className={s.authCard}>
          <div className={s.cardHead}>
            {/* The rail's own mark; the edition is not something a player needs to read here (layout audit U5). */}
            <span className={s.markGlyph} aria-hidden="true">
              {SPADE}
            </span>
            <h1 className={s.authTitle}>{t('auth.title')}</h1>
            <p className={s.lead}>{t('auth.lead')}</p>
          </div>

          <nav className={s.tabs} aria-label={t('auth.title')}>
            {modeLink('signIn', '/login', t('auth.signIn'))}
            {modeLink('register', '/register', t('auth.register'))}
          </nav>

          {message === null ? null : (
            <p className={s.notice} role="status">
              {message}
            </p>
          )}
          {refusal === null || refusal.field !== null ? null : (
            <p className={s.alert} role="alert">
              {refusal.text}
            </p>
          )}

          <form className={s.form} onSubmit={submit} noValidate>
            <Field label={t('auth.email')} error={errorFor('email')}>
              <input
                ref={emailRef}
                className={s.input}
                type="email"
                value={email}
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                placeholder={t('auth.emailPlaceholder')}
                onChange={(event) => onEmail(event.target.value)}
              />
            </Field>

            <div className={s.secretField}>
              <label className={s.label} htmlFor={PASSWORD_ID}>
                {t('auth.password')}
              </label>
              <div className={s.secret}>
                <input
                  ref={passwordRef}
                  id={PASSWORD_ID}
                  className={s.input}
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  minLength={PASSWORD_MIN_LENGTH}
                  aria-invalid={passwordError === undefined ? undefined : true}
                  aria-describedby={
                    // The hint and the error both describe this box; both ids go on, in reading order.
                    [registering ? PASSWORD_HINT_ID : '', passwordError === undefined ? '' : PASSWORD_ERROR_ID]
                      .filter((id) => id !== '')
                      .join(' ') || undefined
                  }
                  autoComplete={registering ? 'new-password' : 'current-password'}
                  onChange={(event) => onPassword(event.target.value)}
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
              {passwordError === undefined ? null : (
                <span className={s.fieldError} id={PASSWORD_ERROR_ID}>
                  {passwordError}
                </span>
              )}
            </div>

            {registering ? (
              <Field label={t('auth.displayName')} hint={nameHint} error={errorFor('displayName')}>
                <input
                  ref={nameRef}
                  className={s.input}
                  type="text"
                  value={displayName}
                  autoComplete="nickname"
                  autoCapitalize="words"
                  spellCheck={false}
                  placeholder={t('auth.displayNamePlaceholder')}
                  onChange={(event) => onName(event.target.value)}
                />
              </Field>
            ) : null}

            <Button className={s.submit} type="submit" variant="gold" size="lg" loading={busy}>
              {t(registering ? 'auth.submitRegister' : 'auth.submitSignIn')}
            </Button>
          </form>
        </div>

        <div className={s.authLang}>
          <LanguageSwitch lang={lang} onChange={setLang} />
        </div>
      </div>
    </main>
  )
}
