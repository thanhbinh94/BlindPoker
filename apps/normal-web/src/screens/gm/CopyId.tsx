import { Button } from '@bp/ui-kit'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import g from './gm.module.css'

/** The old way in: select a throwaway field and ask the document to copy. It works where `navigator.clipboard` is absent. */
function copyThroughField(text: string): boolean {
  if (typeof document.execCommand !== 'function') return false
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  try {
    field.select()
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

/** True when the id reached the clipboard by either way. */
async function copyText(text: string): Promise<boolean> {
  // `navigator.clipboard` exists only on a secure origin: the LAN host at `http://<lan-ip>:8080` has none.
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // Denied: try the other way before giving up.
    }
  }
  return copyThroughField(text)
}

/**
 * A button that puts one id on the clipboard. The log's filters take a player id and a room id, and the only place
 * a game master can read one is on the row it belongs to; the id is also the button's tooltip, so it can be read
 * without copying. When neither clipboard way works (a locked-down browser) the id is printed next to the button,
 * whole and selectable, because a phone shows no tooltip and a silent click would be a button that does nothing.
 */
export function CopyId({ id }: { id: string }) {
  const { t } = useTranslation('normal')
  const [copied, setCopied] = useState(false)
  const [shown, setShown] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    if (!(await copyText(id))) {
      setShown(true)
      return
    }
    setShown(false)
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <Button variant="ghost" size="sm" title={id} onClick={() => void copy()}>
        {copied ? t('gm.copied') : t('gm.copyId')}
      </Button>
      {shown ? <span className={g.idLine}>{id}</span> : null}
    </>
  )
}
