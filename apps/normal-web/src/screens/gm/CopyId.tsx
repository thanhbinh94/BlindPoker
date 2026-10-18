import { Button } from '@bp/ui-kit'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * A button that puts one id on the clipboard. The log's filters take a player id and a room id, and the only place
 * a game master can read one is on the row it belongs to; the id is also the button's tooltip, so it can be read
 * without copying. A clipboard that refuses (an insecure origin, a denied permission) leaves the label as it was.
 */
export function CopyId({ id }: { id: string }) {
  const { t } = useTranslation('normal')
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(id)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button variant="ghost" size="sm" title={id} onClick={() => void copy()}>
      {copied ? t('gm.copied') : t('gm.copyId')}
    </Button>
  )
}
