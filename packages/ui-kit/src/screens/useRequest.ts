import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AckOrError } from '../client/connection.js'
import type { ClientError } from '../client/types.js'

export interface RequestRunner {
  /** Runs one `GameClientApi` call; resolves `true` on ACK, `false` when the server (or the socket) refused. */
  run: (call: () => Promise<AckOrError>) => Promise<boolean>
  busy: boolean
  /** The last refusal, shaped like a `ClientState` error so `Toasts` can render it unchanged. */
  error: ClientError | null
  clear: () => void
}

/**
 * A screen sees a refusal twice: once as the awaited `ERROR` reply to its own request, once as `state.lastError` when
 * the frame reaches the reducer. Only the first is guaranteed to be about *this* click, so screens surface that one
 * and keep the reducer's copy as a fallback. This is bookkeeping around the promise, not protocol logic.
 */
export function useRequest(): RequestRunner {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<ClientError | null>(null)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const run = useCallback(async (call: () => Promise<AckOrError>): Promise<boolean> => {
    setBusy(true)
    try {
      const reply = await call()
      if (!alive.current) return reply.t === 'ACK'
      if (reply.t === 'ERROR') {
        setError({ code: reply.code, message: reply.message, reqId: reply.reqId ?? null, at: Date.now() })
        return false
      }
      setError(null)
      return true
    } catch (cause) {
      // `request` rejects when the socket dies before the reply lands; the reconnect banner explains the rest.
      if (alive.current) setError({ code: 'INTERNAL', message: String(cause), reqId: null, at: Date.now() })
      return false
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  const clear = useCallback(() => setError(null), [])

  return useMemo(() => ({ run, busy, error, clear }), [run, busy, error, clear])
}
