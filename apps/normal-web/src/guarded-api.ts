import { ApiError, UNAUTHENTICATED_CODE, type NormalApi } from './api.js'

/** The shape every `NormalApi` member has, once the proxy has stopped caring which one it is. */
type ApiCall = (...args: unknown[]) => Promise<unknown>

/**
 * The Global Constraint "`401` anywhere → sign-in screen with a 'session expired' note", as one wrapper.
 *
 * Every signed-in screen calls the API through this. A refusal that says the session is gone is not a
 * screen's problem to render — there is nothing a retry button can do about it — so it is caught once, here,
 * and turned into the one thing that helps: back to the sign-in card, with a line saying why.
 *
 * Three rules, and each of them is a bug that was actually possible without it:
 *
 * - **The code, not the status.** `POST /api/auth/login` answers `401 BAD_CREDENTIALS` for a wrong password,
 *   which is a form error and not an expiry. Only `UNAUTHENTICATED` ends a session — which is also why the
 *   sign-in card and the boot probe are given the *raw* api rather than this one.
 * - **Once.** A screen that fires three requests in parallel gets three 401s; the player must be signed out
 *   once, not three times, and `signOut` must not race a re-render of the card it just navigated to.
 * - **Rethrow.** The caller still has to stop. Swallowing the refusal would leave a screen sitting in its
 *   loading state under a sign-in card it can no longer see.
 *
 * The latch is per wrapper, and the wrapper is rebuilt for each session (`App.tsx` keys the memo on the
 * gate's player id), so the next session starts with it open again.
 */
export function guardApi(api: NormalApi, onUnauthenticated: () => void): NormalApi {
  let signedOut = false
  // Memoised so `guarded.me` is the same function on every render — a caller may reasonably put it in a
  // dependency list, and a proxy that minted a new closure per read would loop them.
  const guards = new Map<string | symbol, ApiCall>()

  return new Proxy(api, {
    get(target, prop, receiver): unknown {
      const value = Reflect.get(target, prop, receiver) as unknown
      if (typeof value !== 'function') return value

      const cached = guards.get(prop)
      if (cached !== undefined) return cached

      const method = value as unknown as ApiCall
      const guarded: ApiCall = async (...args) => {
        try {
          return await method.apply(target, args)
        } catch (cause) {
          if (cause instanceof ApiError && cause.code === UNAUTHENTICATED_CODE && !signedOut) {
            signedOut = true
            onUnauthenticated()
          }
          throw cause
        }
      }
      guards.set(prop, guarded)
      return guarded
    },
  }) as NormalApi
}
