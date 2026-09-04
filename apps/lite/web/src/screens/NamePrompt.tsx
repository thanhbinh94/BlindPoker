import { Button, Field, LanguageSwitch } from '@bp/ui-kit'
import type { TFunction } from 'i18next'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError, NETWORK_ERROR_CODE, type LiteApi, type SessionDto } from '../api.js'
import { useLanguagePref } from '../prefs.js'
import s from './lite.module.css'

const SPADE = '♠'
/** Unicode letters (Vietnamese diacritics included), digits, space, underscore, hyphen, dot. */
const NAME_PATTERN = /^[\p{L}\p{N} _.-]+$/u
const MIN_NAME = 2
const MAX_NAME = 20
/** Refusals this screen has words for; anything else falls back to the kit's generic error. */
const PROMPT_CODES = new Set(['INVALID_NAME', 'DISPLAY_NAME_TAKEN', 'RATE_LIMITED'])

/**
 * The server's rule, restated on the client (`session-service.ts`): a name is taken exactly as typed, so
 * surrounding whitespace is a refusal rather than something to quietly trim away.
 */
export function validateDisplayName(raw: string): boolean {
  if (raw.trim() !== raw) return false
  if (raw.length < MIN_NAME || raw.length > MAX_NAME) return false
  return NAME_PATTERN.test(raw)
}

function refusalText(cause: unknown, t: TFunction): string {
  if (cause instanceof ApiError) {
    if (cause.code === NETWORK_ERROR_CODE) return t('prompt.errors.network')
    if (PROMPT_CODES.has(cause.code)) return t(`prompt.errors.${cause.code}`)
  }
  return t('common:errors.INTERNAL')
}

export interface NamePromptProps {
  api: LiteApi
  /** Fires with the fresh session; the app stores the token and opens the socket. */
  onSession: (session: SessionDto) => void
  /** Why the player is back here — an expired session, most often. */
  message?: string | null
}

/**
 * The way in. One ticket on the ink ground: a torn stub, a name, and a door. There is no password to forget
 * and nothing to verify, so the whole screen is a single field and the rule that governs it.
 */
export function NamePrompt({ api, onSession, message = null }: NamePromptProps) {
  const { t } = useTranslation('lite')
  const { lang, setLang } = useLanguagePref()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (busy) return
    if (!validateDisplayName(name)) {
      setError(t('prompt.errors.INVALID_NAME'))
      return
    }
    setBusy(true)
    try {
      onSession(await api.createSession(name))
    } catch (cause) {
      setError(refusalText(cause, t))
      setBusy(false)
    }
  }

  return (
    <main className={s.promptStage}>
      <div className={s.ticket}>
        <aside className={s.stub} aria-hidden="true">
          <span className={s.stubGlyph}>{SPADE}</span>
          <span className={s.stubSerial}>{t('app.edition')}</span>
        </aside>
        <span className={`${s.notch} ${s.notchTop}`} aria-hidden="true" />
        <span className={`${s.notch} ${s.notchBottom}`} aria-hidden="true" />

        <form className={s.ticketBody} onSubmit={submit} noValidate>
          <span className={s.eyebrow}>{t('app.name')}</span>
          <h1 className={s.promptTitle}>{t('prompt.title')}</h1>
          <p className={s.lead}>{t('prompt.lead')}</p>
          {message === null ? null : (
            <p className={s.notice} role="status">
              {message}
            </p>
          )}

          <Field label={t('prompt.name')} hint={t('prompt.rules')} error={error ?? undefined}>
            <input
              className={s.input}
              type="text"
              value={name}
              autoComplete="nickname"
              autoCapitalize="words"
              spellCheck={false}
              placeholder={t('prompt.placeholder')}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
          </Field>

          <Button className={s.submit} type="submit" variant="gold" size="lg" loading={busy}>
            {t('prompt.submit')}
          </Button>
        </form>
      </div>

      <div className={s.promptLang}>
        <LanguageSwitch lang={lang} onChange={setLang} />
      </div>
    </main>
  )
}
