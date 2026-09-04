/**
 * The Lite session lives entirely in one browser: a display name buys a bearer token, and that token is the
 * player. There is no password and no recovery — losing the token means losing the name, which is why signing
 * out asks first (see `SettingsScreen`).
 */
export const TOKEN_KEY = 'bp.lite.token'

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

export function loadToken(storage: Storage | null = deviceStorage()): string | null {
  try {
    const raw = storage?.getItem(TOKEN_KEY) ?? null
    return raw === null || raw === '' ? null : raw
  } catch {
    return null
  }
}

export function saveToken(token: string, storage: Storage | null = deviceStorage()): void {
  try {
    storage?.setItem(TOKEN_KEY, token)
  } catch {
    /* storage unavailable: the session simply does not survive a reload */
  }
}

export function clearToken(storage: Storage | null = deviceStorage()): void {
  try {
    storage?.removeItem(TOKEN_KEY)
  } catch {
    /* storage unavailable */
  }
}
