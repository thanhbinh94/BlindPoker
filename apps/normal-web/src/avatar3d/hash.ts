import type { AvatarConfigDto } from '../api.js'

/**
 * The identity of a portrait: one short string per configuration (avatar-3d design §5).
 *
 * Everything downstream is keyed by it — the memory Map, the IndexedDB store, the `data-hash` an
 * end-to-end test reads off the `<img>` — so the only property that matters is that two
 * configurations hash the same **exactly when they would draw the same picture**. Two things follow,
 * and they are the whole of this module:
 *
 * - **The key order of the object must not matter.** A config assembled by the wardrobe, one parsed
 *   out of `GET /api/players/:id/avatar`, and one spread from an older copy all carry the same
 *   fields in different orders, and `JSON.stringify` would hash them differently. So the fields are
 *   written out in a fixed order rather than iterated.
 * - **Nothing but a v2 field may reach the digest.** A v1 config that has been migrated in place may
 *   still be carrying `base` or `clothing`; a future server may add a field this bundle ignores.
 *   Neither changes what is drawn, and neither may invalidate a cached portrait.
 *
 * The digest is FNV-1a, 32 bits, eight lower-case hex digits. It is not a cryptographic hash and does
 * not need to be: a collision would show one player another player's face, and at 2^32 over a few
 * hundred cached portraits per browser that is not a risk anybody will meet. What it buys instead is
 * being eight characters long, dependency-free and identical in every browser.
 */

/**
 * The v2 fields, in the one order this module ever writes them.
 *
 * `v` first because it is the version of the shape being hashed; then the figure, then the colours,
 * then the slots in the order the assembler stacks them. Adding a field here changes every hash and
 * therefore invalidates every cached portrait — which is correct when the new field changes the
 * picture, and is the reason not to add one that does not.
 */
const FIELDS = ['v', 'body', 'skin', 'eyes', 'hairColor', 'hair', 'top', 'bottom', 'shoes', 'hat', 'accessory', 'jewelry', 'title', 'badge'] as const

/** FNV-1a's 32-bit offset basis and prime. */
const OFFSET_BASIS = 0x811c9dc5
const PRIME = 0x01000193

/**
 * The exact text that gets hashed, exposed because a test that only compares digests cannot say
 * *why* two configs disagreed. It is JSON, so it is readable in a failure message.
 */
export function canonicalConfig(config: AvatarConfigDto): string {
  const parts: string[] = []
  for (const field of FIELDS) {
    const value = config[field]
    // An absent optional slot and a slot explicitly set to `undefined` are the same thing — an empty
    // slot — and must not hash differently. `null` and `''` reach here from a client that emptied a
    // slot the loose way; they mean the same and are dropped the same.
    if (value === undefined || value === null || value === '') continue
    parts.push(`${JSON.stringify(field)}:${JSON.stringify(value)}`)
  }
  return `{${parts.join(',')}}`
}

/** Eight lower-case hex digits, stable across browsers and across runs. */
export function hashConfig(config: AvatarConfigDto): string {
  const text = canonicalConfig(config)
  let hash = OFFSET_BASIS
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    // `Math.imul` rather than `*`: the product overflows 2^53 and a plain multiply would silently
    // start losing the low bits that carry the entropy.
    hash = Math.imul(hash, PRIME)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}
