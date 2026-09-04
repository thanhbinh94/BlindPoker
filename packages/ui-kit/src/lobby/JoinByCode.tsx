import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { Language } from '../i18n/index.js'
import { Button } from '../primitives/Button.js'
import { Field } from '../primitives/Field.js'
import { cx } from '../primitives/cx.js'
import s from './lobby.module.css'

export interface JoinByCodeProps {
  onJoin: (code: string, password?: string) => void | Promise<unknown>
  busy?: boolean
  lang: Language
  error?: string | null
}

/** Private rooms are reached by their six-character code; the field normalises case and stray spaces. */
export function JoinByCode({ onJoin, busy = false, error = null }: JoinByCodeProps) {
  const { t } = useTranslation()
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')

  const trimmed = code.trim()
  const onCode = (event: ChangeEvent<HTMLInputElement>): void => setCode(event.target.value.toUpperCase())
  const onPassword = (event: ChangeEvent<HTMLInputElement>): void => setPassword(event.target.value)

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (trimmed === '' || busy) return
    void onJoin(trimmed, password === '' ? undefined : password)
  }

  return (
    <form className={s.join} onSubmit={submit} noValidate>
      <div className={s.joinRow}>
        <span className={s.joinField}>
          <Field label={t('labels.code')}>
            <input
              className={cx(s.input, s.code)}
              type="text"
              value={code}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder={t('lobby.codePlaceholder')}
              disabled={busy}
              onChange={onCode}
            />
          </Field>
        </span>
        <span className={s.joinField}>
          <Field label={t('labels.password')}>
            <input
              className={s.input}
              type="password"
              value={password}
              autoComplete="off"
              placeholder={t('lobby.passwordPlaceholder')}
              disabled={busy}
              onChange={onPassword}
            />
          </Field>
        </span>
        <Button type="submit" variant="primary" loading={busy} disabled={trimmed === ''}>
          {t('actions.join')}
        </Button>
      </div>
      {error === null || error === undefined ? null : (
        <p className={s.alert} role="alert">
          {error}
        </p>
      )}
    </form>
  )
}
