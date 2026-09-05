/**
 * The two rows of spec §23 that are properties of the *source* rather than of a running server, and
 * so are checked by reading every file rather than by sending a request: nothing secret reaches the
 * log, and no component hands React raw HTML.
 *
 * "Lộ thông tin": the log must not carry a token, a password or a whole email address.
 *
 * A code review catches this on the day it is written and never again, so it is a test. The shape
 * of the check is what makes it usable: it reads *arguments*, not prose. `log.warn('admin shutdown
 * refused: wrong run token', { remote })` is exactly right and must stay legal — the word "token"
 * is in a message a human reads, and the only value passed is an address. What must not be legal is
 * the same line with `{ token }` beside it.
 *
 * So the source is blanked before it is searched: every string literal's *text* becomes spaces
 * while the interpolations inside a template literal are kept, because `${token}` is a value being
 * printed and `"token"` is not. Comments go the same way. Offsets are preserved throughout, so a
 * failure can name a line.
 *
 * Two things are deliberately *not* asserted. `console` itself is not banned: Lite's `main.ts` is a
 * CLI whose whole job is to print. And a *field name* is not banned either — `players.email` in a
 * Drizzle select is a column, not a log line. Only the argument list of a logging call is read.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Everything that ships or runs. Tests are excluded: a fixture may legitimately hold a fake token. */
const ROOTS = [
  'apps/lite/server/src',
  'apps/lite/web/src',
  'apps/normal-server/src',
  'apps/normal-web/src',
  'packages/core/src',
  'packages/http-kit/src',
  'packages/server-kit/src',
  'packages/ui-kit/src',
]

/**
 * What may never be *passed* to a logging call.
 *
 * `email` is on the list because §23 asks for no full address in the log; a player id or a display
 * name is what a line should identify somebody by. `body` covers `req.body` and every alias of it —
 * the one expression that dumps whatever a caller sent, credentials included.
 */
const FORBIDDEN = /\b(password|passwd|secret|token|cookie|authorization|credential|credentials|email|body)\b/i

/** The call sites that reach a log. `log`, `logger`, `deps.log`, `this.log`, `console`. */
const CALL = /(?:^|[^\w.])(?:console|(?:\w+\.)?log(?:ger)?)\.(?:log|info|warn|error|debug|trace)\s*\(/g

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) listFiles(path, acc)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) acc.push(path)
  }
  return acc
}

/**
 * The source with every literal's text and every comment replaced by spaces, and the interior of a
 * template's `${…}` left alone. Same length as the input, so an index still names the right line.
 */
export function blankLiterals(src: string): string {
  const out = src.split('')
  const blank = (i: number): void => { if (out[i] !== '\n') out[i] = ' ' }
  // Depth of `${…}` nesting inside the innermost template; `templates` is the stack of enclosing ones.
  const templates: number[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    const next = src[i + 1]
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') blank(i++)
      continue
    }
    if (ch === '/' && next === '*') {
      blank(i++); blank(i++)
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) blank(i++)
      blank(i++); blank(i++)
      continue
    }
    if (ch === "'" || ch === '"') {
      const quote = ch
      blank(i++)
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') blank(i++)
        blank(i++)
      }
      blank(i++)
      continue
    }
    if (ch === '`') {
      blank(i++)
      templates.push(0)
      continue
    }
    if (templates.length > 0 && templates[templates.length - 1] === 0) {
      // Inside a template's literal text: blank it, but step out at `${` and at the closing backtick.
      if (ch === '\\') { blank(i++); blank(i++); continue }
      if (ch === '`') { blank(i++); templates.pop(); continue }
      if (ch === '$' && next === '{') { blank(i++); blank(i++); templates[templates.length - 1] = 1; continue }
      blank(i++)
      continue
    }
    if (templates.length > 0 && ch === '{') { templates[templates.length - 1] = (templates[templates.length - 1] ?? 1) + 1; i += 1; continue }
    if (templates.length > 0 && ch === '}') {
      const depth = (templates[templates.length - 1] ?? 1) - 1
      templates[templates.length - 1] = depth
      i += 1
      continue
    }
    i += 1
  }
  return out.join('')
}

/** The text between a call's `(` and its matching `)`, in the blanked source. */
function argumentsOf(blanked: string, openParen: number): string {
  let depth = 0
  for (let i = openParen; i < blanked.length; i += 1) {
    if (blanked[i] === '(') depth += 1
    else if (blanked[i] === ')') {
      depth -= 1
      if (depth === 0) return blanked.slice(openParen + 1, i)
    }
  }
  return blanked.slice(openParen + 1)
}

interface Finding { file: string; line: number; term: string }

function scan(file: string): Finding[] {
  const src = readFileSync(file, 'utf8')
  const blanked = blankLiterals(src)
  const found: Finding[] = []
  for (const match of blanked.matchAll(CALL)) {
    const open = match.index + match[0].length - 1
    const term = FORBIDDEN.exec(argumentsOf(blanked, open))
    if (term === null) continue
    found.push({ file: file.slice(ROOT.length).replace(/\\/g, '/'), line: src.slice(0, open).split('\n').length, term: term[0] })
  }
  return found
}

describe('nothing secret reaches the log (spec §23)', () => {
  const files = ROOTS.flatMap((r) => listFiles(join(ROOT, r)))

  it('reads a real number of files, so a passing run is not an empty one', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('passes no token, password, cookie, email or request body to a logging call', () => {
    const findings = files.flatMap(scan).map((f) => `${f.file}:${String(f.line)} logs \`${f.term}\``)
    expect(findings).toEqual([])
  })

  describe('the scanner itself', () => {
    it('reads what is passed, not what is written in the message', () => {
      expect(scanSource("log.warn('refused: wrong run token', { remote })")).toEqual([])
      expect(scanSource('log.warn(`refused: wrong run token`, { remote })')).toEqual([])
      expect(scanSource('// a token is never logged\nconst x = 1')).toEqual([])
    })

    it('catches a value, however it is spelled', () => {
      expect(scanSource('log.info("signed in", { token })')).toHaveLength(1)
      expect(scanSource('console.log(req.body)')).toHaveLength(1)
      expect(scanSource('deps.log.debug("x", { pw: password })')).toHaveLength(1)
      expect(scanSource('logger.error("x", { c: req.headers.cookie })')).toHaveLength(1)
      expect(scanSource('log.info(`signed in as ${email}`)')).toHaveLength(1)
    })

    it('does not mistake a field name outside a logging call for a logged value', () => {
      expect(scanSource('const rows = await db.select({ email: users.email }).from(users)')).toEqual([])
    })
  })
})

/**
 * §23's XSS row rests on React escaping everything it renders, and there is exactly one way to opt
 * out of that. `dangerouslySetInnerHTML` is not used anywhere in this codebase — not for the avatar
 * SVGs (they are components), not for a translated string (i18next interpolation is escaped) — and
 * this is what keeps it that way: a `<div dangerouslySetInnerHTML={{ __html: player.displayName }}>`
 * would render a display name as markup, and display names come from strangers.
 */
describe('React is never handed raw HTML (spec §23)', () => {
  const files = ['apps/lite/web/src', 'apps/normal-web/src', 'packages/ui-kit/src'].flatMap((r) => listFiles(join(ROOT, r), []))

  it('reads a real number of files, so a passing run is not an empty one', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('uses dangerouslySetInnerHTML nowhere', () => {
    const offenders = files.filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'))
    expect(offenders.map((f) => f.slice(ROOT.length).replace(/\\/g, '/'))).toEqual([])
  })
})

/** The scanner over a string rather than a file — for the tests of the scanner itself. */
function scanSource(src: string): { line: number; term: string }[] {
  const blanked = blankLiterals(src)
  const found: { line: number; term: string }[] = []
  for (const match of blanked.matchAll(CALL)) {
    const open = match.index + match[0].length - 1
    const term = FORBIDDEN.exec(argumentsOf(blanked, open))
    if (term !== null) found.push({ line: src.slice(0, open).split('\n').length, term: term[0] })
  }
  return found
}
