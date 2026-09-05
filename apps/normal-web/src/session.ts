/**
 * What this browser remembers between visits — which is almost nothing.
 *
 * The Normal session is a `HttpOnly` cookie: the server sets it, the browser sends it, and this code can
 * neither read it nor write it. **Nothing token-shaped is ever stored here**, and that is the security
 * property, not an oversight — a session in `localStorage` is a session any injected script can walk off with.
 *
 * The one thing kept is the email last signed in with, so returning to the sign-in page does not mean typing
 * an address again. It is a convenience and it is treated as one: any failure to read or write it is ignored.
 */
export const LAST_EMAIL_KEY = 'bp.normal.lastEmail'

/** How long an address may be before it is not worth remembering (`MAX_EMAIL_LENGTH` on the server). */
const MAX_EMAIL_LENGTH = 254

/**
 * `localStorage`, or `null` where it cannot be reached. Reading the property itself throws in a browser with
 * site data blocked, so even the lookup is guarded.
 */
export function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadLastEmail(storage: Storage | null = deviceStorage()): string {
  try {
    const raw = storage?.getItem(LAST_EMAIL_KEY) ?? ''
    return raw.length > MAX_EMAIL_LENGTH ? '' : raw
  } catch {
    return ''
  }
}

export function saveLastEmail(email: string, storage: Storage | null = deviceStorage()): void {
  const trimmed = email.trim()
  if (trimmed === '' || trimmed.length > MAX_EMAIL_LENGTH) return
  try {
    storage?.setItem(LAST_EMAIL_KEY, trimmed)
  } catch {
    /* storage unavailable: the next sign-in form simply starts empty */
  }
}

/** Signing out forgets the prefill too — a shared machine should not name the last person on it. */
export function clearLastEmail(storage: Storage | null = deviceStorage()): void {
  try {
    storage?.removeItem(LAST_EMAIL_KEY)
  } catch {
    /* storage unavailable */
  }
}
