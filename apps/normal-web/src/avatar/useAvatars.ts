import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import type { NormalApi, PlayerAvatarDto } from '../api.js'

/**
 * How long a fetched avatar — or the knowledge that there is none — is trusted.
 *
 * Cosmetics change when a player visits the wardrobe, which is a screen away from the table; a minute of
 * staleness at another seat costs nothing, and `invalidate` covers the one case that matters (my own face,
 * right after I changed it). The player's *own* screens never wait for it.
 */
export const AVATAR_TTL_MS = 60_000

/**
 * What joins the requested ids into this hook's dependency key. A player id is a uuid, so `|` cannot occur
 * inside one and two different id sets cannot collide on the same key. (It is a printable character on
 * purpose: a raw control byte in a source file makes git treat the whole file as binary.)
 */
const SEP = '|'

interface CacheEntry {
  /** `null` is a real answer: this id has no avatar (404) or the request failed. */
  value: PlayerAvatarDto | null
  at: number
}

/**
 * One cache for the whole app, deliberately at module scope rather than in a context.
 *
 * Two things read avatars — the table and the profile/wardrobe header — and they are never mounted under a
 * common provider (the table lives inside `RoomScreen`, the header inside the shell). A module-level Map is
 * what lets the second one reuse what the first already fetched, and it is why `invalidate` can be called
 * from the wardrobe and be seen by a seat plate.
 */
const cache = new Map<string, CacheEntry>()

/** Requests currently on the wire, so eight seats asking for the same id send one request. */
const inflight = new Map<string, Promise<void>>()

/**
 * A generation counter per id, bumped by `invalidate`. A reply that belongs to a generation that has been
 * superseded is thrown away rather than written — otherwise a `PUT /api/me/avatar` followed immediately by
 * `invalidate` could be overwritten by the older request it raced.
 */
const generation = new Map<string, number>()

/**
 * Ids whose next fetch must skip the browser's HTTP cache.
 *
 * `GET /api/players/:id/avatar` is served `private, max-age=60`, so the re-fetch `invalidate` triggers would
 * otherwise be answered out of the browser's memory cache with the very face the player just replaced —
 * clearing *this* module's Map would have accomplished nothing. One id is marked per `invalidate` and the
 * mark is spent by the request it caused; the other seven seats keep the cache they benefit from.
 */
const forceFresh = new Set<string>()

/** Every mounted `useAvatars`, so a reply reaches all of them. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/**
 * Whether this id still needs asking about. It is `load()`'s question and only `load()`'s: what the hook
 * *serves* is the last known answer at any age (see `avatars` below), because a face that greys out and comes
 * back reads as a glitch rather than as a refresh.
 */
function stale(id: string, now: number): boolean {
  const hit = cache.get(id)
  return hit === undefined || now - hit.at >= AVATAR_TTL_MS
}

function load(api: NormalApi, id: string): void {
  if (inflight.has(id)) return
  const gen = generation.get(id) ?? 0
  const fresh = forceFresh.delete(id)

  // The `async` wrapper is what makes a synchronous throw (a stub with no `playerAvatar`, a bad base URL)
  // fail the same way a rejected request does. A failed avatar is a face nobody sees, never a broken table.
  const run = (async (): Promise<PlayerAvatarDto | null> => {
    try {
      return await api.playerAvatar(id, { fresh })
    } catch {
      return null
    }
  })().then((value) => {
    inflight.delete(id)
    // Superseded by an `invalidate` while in flight: drop the answer, and wake the hooks so the effect below
    // starts the replacement request.
    if ((generation.get(id) ?? 0) === gen) cache.set(id, { value, at: Date.now() })
    notify()
  })

  inflight.set(id, run)
}

export interface AvatarsHandle {
  /**
   * The avatars known for the requested ids. An id that has not answered yet is simply absent; an id that
   * answered "no such player" (or failed) maps to `null`. Both draw the neutral silhouette, so a caller
   * never has to tell them apart.
   */
  avatars: Map<string, PlayerAvatarDto | null>
  /**
   * Drop what is cached for one player and fetch it again — the wardrobe calls it after saving. Unlike an
   * expiry this *does* clear the entry, because the reason to call it is that the old face is known wrong.
   */
  invalidate: (playerId: string) => void
}

/**
 * Read the avatars for a set of players.
 *
 * The rules that matter, all of them consequences of where this runs — a poker table with up to eight seats,
 * redrawn on every action:
 *
 * - **One request per id, ever, per minute.** Eight seats mount at once and every one of them asks; `inflight`
 *   collapses that into one request, and the 60 s entry keeps a re-render from asking again.
 * - **A failure is cached too.** A player who has left, an id the server does not know, a network blip — all
 *   answer `null`, and that `null` is cached for the same minute. Without that, the one thing a failing
 *   endpoint would reliably produce is a request storm from a screen that redraws on every card.
 * - **Bots are never passed in.** They have no account; the caller filters them out (`makeAvatarFor` draws
 *   them a mark instead), so no request is ever made for one.
 */
export function useAvatars(api: NormalApi, playerIds: string[]): AvatarsHandle {
  const apiRef = useRef(api)
  apiRef.current = api

  const [version, bump] = useReducer((n: number) => n + 1, 0)

  // A stable dependency for a caller-provided array: the ids, not the array's identity.
  const key = useMemo(() => [...new Set(playerIds)].join(SEP), [playerIds])
  const ids = useMemo(() => (key === '' ? [] : key.split(SEP)), [key])

  useEffect(() => {
    listeners.add(bump)
    return () => {
      listeners.delete(bump)
    }
  }, [])

  // Deliberately un-keyed: this runs after *every* render, because an entry going stale is the passage of
  // time, not a change to anything React watches. Keyed on `[ids, version]` it would only ever notice an
  // expiry when some *other* id answered — so on a table with a settled roster and nothing in flight, a stale
  // face would sit there indefinitely. `load` early-returns on fresh and on in-flight ids, so the cost of
  // running it every render is one Map lookup per seat.
  useEffect(() => {
    const now = Date.now()
    for (const id of ids) if (stale(id, now)) load(apiRef.current, id)
  })

  const avatars = useMemo(() => {
    const out = new Map<string, PlayerAvatarDto | null>()
    // Stale-while-revalidate: the last known answer is served at any age, and the effect above is already
    // asking for its replacement. The player keeps their face until a better one arrives, rather than blinking
    // to the grey silhouette for the length of a request.
    for (const id of ids) {
      const hit = cache.get(id)
      if (hit !== undefined) out.set(id, hit.value)
    }
    return out
    // `version` is the whole point of this dependency list: the cache is not React state, so a reply changes
    // nothing observable until a notification says it has.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` is a deliberate cache-buster, not a read value: the module-level `cache` is outside React, so this counter is the only thing that can tell the memo a reply has landed.
  }, [ids, version])

  const invalidate = useCallback((playerId: string) => {
    generation.set(playerId, (generation.get(playerId) ?? 0) + 1)
    cache.delete(playerId)
    // Two caches sit between this hook and the server, and both have to be told.
    forceFresh.add(playerId)
    notify()
  }, [])

  return { avatars, invalidate }
}

/**
 * Empties the shared cache.
 *
 * One caller in the app, and it is the one case where forgetting *every* face is right: a session ending.
 * The cache is keyed by player id and lives at module scope, so without this the entry for the account that
 * just signed out — their display name and the cosmetics they wear — would sit behind the sign-in card, and
 * be re-fetched once per TTL as a 401 nobody reads. (Tests use it to start from nothing.)
 */
export function resetAvatarCache(): void {
  cache.clear()
  inflight.clear()
  generation.clear()
  forceFresh.clear()
}
