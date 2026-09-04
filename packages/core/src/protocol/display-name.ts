/**
 * The one display-name rule: shared by the server that stores names, the form that asks for one,
 * and the index that keeps them apart.
 *
 * Where a display name is the whole identity — no password behind it — "is this name the same as
 * that one?" has to have exactly one answer, and all three of those places have to reach it the
 * same way. Three separate regexes had already drifted apart on whitespace, which is why this
 * lives here.
 *
 * Pure by construction: `String.prototype.normalize` and a Unicode-property regex, nothing else.
 */

/**
 * Characters a name may be made of: any letter, any combining mark, any digit, plus space,
 * underscore, hyphen and dot. Deliberately *not* a denylist — a denylist of confusables is a losing
 * game, and this admits nothing invisible: format characters (`\p{Cf}` — zero-width joiners, the
 * RTL/LTR overrides), control characters and every kind of exotic space fall outside it.
 */
const ALLOWED = /^[\p{L}\p{M}\p{N} _.\-]+$/u

/** The separators — the characters a name may contain but must not begin or end with. */
const EDGE = /^[ _.\-]|[ _.\-]$/

/**
 * Format characters: zero-width spaces and joiners, the bidi overrides, the soft hyphen, the BOM.
 * Checked against the *raw* input because JavaScript's `\s` counts U+FEFF as whitespace, so the
 * whitespace collapse below would otherwise launder a zero-width no-break space into a real space
 * instead of refusing the name that carried it.
 */
const FORMAT = /\p{Cf}/u

const MIN_CODE_POINTS = 2
const MAX_CODE_POINTS = 20

export type DisplayNameRefusal = 'length' | 'chars' | 'edges'

export type DisplayNameVerdict =
  | {
      ok: true
      /** The normalized name, exactly as it should be stored and shown. */
      name: string
      /** The identity key: what uniqueness is decided on. Never shown to anyone. */
      key: string
    }
  | { ok: false; reason: DisplayNameRefusal }

/**
 * The shape a name is stored in: NFC, no surrounding whitespace, runs of internal whitespace
 * collapsed to one plain space.
 *
 * NFC first because the same Vietnamese name arrives composed from one keyboard and decomposed from
 * another (`Bình` is one code point or two), and two spellings of one name must not become two
 * players. Collapsing whitespace closes the cheapest impersonation there is: `Bình  An` beside
 * `Bình An`. Every whitespace character — tab, NBSP, ideographic space — collapses to `' '`, so the
 * character check below never has to decide which spaces are acceptable.
 */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

/**
 * The key two names are compared on: lowercased under Vietnamese rules, then re-normalized because
 * case folding can decompose what NFC had composed.
 *
 * Only meaningful for a name that has already been through `normalizeDisplayName`; `validateDisplayName`
 * is the way to get both at once.
 */
export function displayNameKey(name: string): string {
  return name.toLocaleLowerCase('vi').normalize('NFC')
}

/**
 * Normalizes, then judges. The three refusals are distinct so a UI can say something useful:
 *
 * - `length` — outside 2–20 **code points** (not UTF-16 units: `😀` is one character to a player,
 *   and a name of accented Vietnamese must not be charged double for its diacritics).
 * - `chars` — something outside the allowed set: punctuation, emoji, or anything invisible.
 * - `edges` — starts or ends with a separator (`_`, `-`, `.`; surrounding whitespace is normalized
 *   away rather than refused). `Bình.` next to `Bình` is a near-duplicate nobody can see.
 */
export function validateDisplayName(raw: string): DisplayNameVerdict {
  if (FORMAT.test(raw)) return { ok: false, reason: 'chars' }
  const name = normalizeDisplayName(raw)
  const length = [...name].length
  if (length < MIN_CODE_POINTS || length > MAX_CODE_POINTS) return { ok: false, reason: 'length' }
  if (!ALLOWED.test(name)) return { ok: false, reason: 'chars' }
  if (EDGE.test(name)) return { ok: false, reason: 'edges' }
  return { ok: true, name, key: displayNameKey(name) }
}
