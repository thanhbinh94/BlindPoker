/**
 * Every route an assembled Fastify instance answers, as data.
 *
 * This exists so a *guard* can be asserted over the whole surface rather than route by route. The
 * failure it is aimed at is not a broken guard — those have their own tests — but a new route that
 * quietly arrives without one: a `POST /api/…` added next month is registered in a route module,
 * and nothing in a per-route test suite would notice that the CSRF header or the rate limiter never
 * covered it. Enumerating and then parametrising means the new route is in the test the moment it
 * is in the server.
 *
 * `printRoutes` rather than an `onRoute` hook, and that is the whole reason this is a parser: the
 * hook only fires for routes registered *after* it is added, so using it would mean reaching inside
 * `buildApp` to install it before the route modules run — and then the test would be enumerating a
 * Fastify instance the test assembled, not the one the edition ships. `printRoutes` is asked of the
 * finished app, so what it lists is exactly what a request can reach.
 *
 * `commonPrefix: false` gets one line per node, but *not* a flat list: where one registered path is
 * a prefix of another — `/api/me` and `/api/me/avatar` — Fastify still nests the second under the
 * first and prints only its remaining segment. So the indent is load-bearing, and the parser walks
 * it as a stack rather than reading each line whole. Getting that wrong is not a cosmetic bug: it
 * silently drops `PUT /api/me/avatar` from the list, and a guard test over a list that quietly
 * omits routes is worse than no test at all.
 *
 * The wildcard the static fallback mounts appears as a bare `*`; it is returned like any other row,
 * and callers filter by path.
 *
 * **`printRoutes` is documented as debug output, not as an API.** That is a real risk and this is
 * where a Fastify upgrade should look first — but it is a loud one rather than a quiet one: both
 * editions assert the *exact* enumerated surface against a literal list, so a change to the tree
 * drawing fails those assertions outright instead of silently shortening the list a guard loop
 * runs over. The depth check below is the other half of that: an indent that jumps a level is a
 * format this parser has not been taught, and it throws rather than joining segments into a
 * plausible-looking path that no route has.
 */
import type { FastifyInstance, HTTPMethods } from 'fastify'

export interface EnumeratedRoute {
  /** The registered path, with its parameter placeholders intact (`/api/players/:id/avatar`). */
  path: string
  /** Typed as Fastify's own union so a caller can hand it straight back to `inject`. */
  method: HTTPMethods
}

/** `HEAD` is Fastify's own shadow of a `GET`; `OPTIONS` is a preflight. Neither is a route anyone wrote. */
const IMPLICIT = new Set(['HEAD', 'OPTIONS'])

/** The methods that change something, and therefore the ones a CSRF guard and a write limiter must cover. */
export type MutatingMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'
export const MUTATING_METHODS: readonly MutatingMethod[] = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * A mutating route, narrowed.
 *
 * `HTTPMethods` is wider than what `inject` accepts — Fastify 5 lists `QUERY`, which
 * `light-my-request` does not — so the guard tests would need a cast on every call. Narrowing here
 * instead means a caller can hand `route.method` straight to `inject`, and the one place that knows
 * these four strings is this module.
 */
export interface MutatingRoute extends EnumeratedRoute {
  method: MutatingMethod
}

/** `<tree drawing><segment>[ (METHOD, METHOD)]`. A node with no methods is a shared prefix, not a route. */
const LINE = /^([\s│├└─]*)(\S+)(?: \(([A-Z, ]+)\))?$/
/** One level of Fastify's tree drawing: `├── `, `└── ` or `│   `. */
const INDENT = 4

/**
 * Every `(path, method)` pair the instance serves, `HEAD` and `OPTIONS` dropped.
 *
 * Call it on a *ready* instance: routes registered inside a plugin are not in the tree until
 * `fastify.ready()` has resolved, and an app enumerated too early would report a reassuringly short
 * list of guarded routes with the unguarded ones still to come.
 */
export function enumerateRoutes(app: FastifyInstance): EnumeratedRoute[] {
  const out: EnumeratedRoute[] = []
  // `segments[d]` is the piece of path contributed at depth `d`; a line at depth `d` inherits
  // everything above it and replaces everything below. Seeded with the root Fastify does not draw:
  // every top-level route is already printed at one level of indent, so depth 0 is an empty string
  // nobody writes to.
  const segments: string[] = ['']
  for (const line of app.printRoutes({ commonPrefix: false }).split('\n')) {
    const match = LINE.exec(line)
    if (match === null) continue
    const [, indent = '', segment = '', methods] = match
    const depth = Math.floor(indent.length / INDENT)
    // A line may go one level deeper than the one before it, never two: the tree has a node for
    // every level. If it ever does, `segments.length = depth` would pad with holes and `join('')`
    // would invent a path — so this fails instead.
    if (depth > segments.length) throw new Error(`printRoutes indented by ${String(depth - segments.length)} levels at once; the format has changed: ${line}`)
    segments.length = depth
    segments.push(segment)
    if (methods === undefined) continue
    const path = segments.join('')
    for (const method of methods.split(',').map((m) => m.trim())) {
      // The tree prints whatever Fastify registered; `HTTPMethods` is that same set, named.
      if (!IMPLICIT.has(method)) out.push({ path, method: method as HTTPMethods })
    }
  }
  return out
}

/**
 * Every mutating route the instance answers, wherever it is mounted.
 *
 * Deliberately **not** filtered to `/api/`, even though that is what both editions' CSRF guard and
 * rate limiter key on. A filter here would give the guard and the test of the guard the same blind
 * spot: a `POST /upload` or a `DELETE /admin/cache` mounted next month would be unmetered by the
 * hook *and* absent from the loop, and the loop would report success. Returning the whole set makes
 * a route outside `/api` a test failure that a person has to answer for — either by metering it or
 * by adding it, by name and with a reason, to the caller's own exemption list.
 *
 * `/health` and the static fallback are not in this set at all: both editions register them as
 * `GET` only (which the exact-surface assertions pin), and a `GET` is not a mutation.
 */
export function mutatingRoutes(app: FastifyInstance): MutatingRoute[] {
  return enumerateRoutes(app).filter((r): r is MutatingRoute => MUTATING_METHODS.includes(r.method as MutatingMethod))
}
