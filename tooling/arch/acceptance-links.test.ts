/**
 * Keeps `docs/acceptance-checklist.md` honest.
 *
 * The checklist is the project's own answer to requirement.txt §40 and §66, and every row of it
 * points at something a reader can run. A row that cites a test which has since been renamed,
 * moved or deleted is worse than a row with no citation at all: it reads as proof and is not one.
 * So this test parses the checklist and holds each citation to the file system.
 *
 * The citation format the checklist uses, and the only one this parser recognises:
 *
 *     `path/to/file.test.ts` → `the exact it() title`
 *
 * The path is repository-relative; the title is the literal string that appears in that file. A
 * shortened but still verbatim prefix of a long title is allowed — what is checked is that the
 * cited text occurs in the cited file, so a rename breaks the build either way.
 *
 * Rows whose evidence is a manual step or a shell command cite no test path and are simply not
 * matched; §40's build rows are like that. The count assertion below is the guard against a parser
 * that silently stops matching and makes every other assertion here vacuous.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CHECKLIST = join(ROOT, 'docs', 'acceptance-checklist.md')

/** A backticked span that names a test file: `packages/core/src/cards/cards.test.ts`. */
const TEST_PATH = /^[\w./@-]+\.(?:test|spec)\.tsx?$/

/** Statuses a row may carry (controller ruling for this document). */
const STATUSES = new Set(['✓', 'partial', '✗'])

interface Citation {
  path: string
  title: string
  line: number
}

/**
 * Every `file` → `title` pair in the document, in order.
 *
 * Deliberately built from *all* backticked spans rather than from a single arrow-shaped regex: a
 * test path with no title behind it — a citation somebody half-wrote — must be an error, not a
 * silent skip. So each span that looks like a test path claims the next span as its title, and a
 * path with nothing after it is reported.
 */
function parseCitations(markdown: string): { citations: Citation[]; danglingPaths: string[] } {
  const spans: { text: string; line: number }[] = []
  let line = 1
  for (const chunk of markdown.split(/(`[^`\n]*`)/)) {
    if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length > 1) spans.push({ text: chunk.slice(1, -1), line })
    line += (chunk.match(/\n/g) ?? []).length
  }

  const citations: Citation[] = []
  const danglingPaths: string[] = []
  for (let i = 0; i < spans.length; i++) {
    if (!TEST_PATH.test(spans[i]!.text)) continue
    const next = spans[i + 1]
    if (!next || TEST_PATH.test(next.text)) {
      danglingPaths.push(`${spans[i]!.text} (line ${spans[i]!.line})`)
      continue
    }
    citations.push({ path: spans[i]!.text, title: next.text, line: spans[i]!.line })
    i++ // the title is consumed; it is never itself a path
  }
  return { citations, danglingPaths }
}

/**
 * The status of every requirement row: the last cell of a four-cell table row, split into the
 * status token and whatever reason follows it. Header rows (first cell `#`) and the `|---|`
 * separator are not requirement rows and are left out.
 */
function rowStatuses(markdown: string): { status: string; reason: string; line: number }[] {
  const out: { status: string; reason: string; line: number }[] = []
  markdown.split('\n').forEach((text, index) => {
    const trimmed = text.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return
    const cells = trimmed.slice(1, -1).split(/(?<!\\)\|/) // a `\|` inside a cell is an escaped pipe, not a divider
    if (cells.length !== 4) return
    if (cells[0]!.trim() === '#') return // the header row
    const cell = cells[3]!.trim()
    if (cell === '' || /^-+$/.test(cell)) return // the separator
    const token = cell.split(/[\s—]/, 1)[0]!
    out.push({ status: token, reason: cell.slice(token.length).replace(/^[\s—-]+/, ''), line: index + 1 })
  })
  return out
}

describe('docs/acceptance-checklist.md', () => {
  it('is there at all — the other assertions mean nothing without it', () => {
    expect(existsSync(CHECKLIST), `${CHECKLIST} is missing`).toBe(true)
  })

  const markdown = existsSync(CHECKLIST) ? readFileSync(CHECKLIST, 'utf8') : ''
  const { citations, danglingPaths } = parseCitations(markdown)

  it('cites a real number of tests, so a parser that stopped matching would be caught', () => {
    expect(citations.length).toBeGreaterThanOrEqual(40)
  })

  it('leaves no test path without a title behind it', () => {
    expect(danglingPaths).toEqual([])
  })

  it('cites only test files that exist', () => {
    const missing = citations.filter((c) => !existsSync(join(ROOT, c.path)))
    expect(missing.map((c) => `line ${c.line}: ${c.path}`)).toEqual([])
  })

  it('cites only test names that appear in the file they are cited from', () => {
    const cache = new Map<string, string>()
    const unmatched: string[] = []
    for (const c of citations) {
      const full = join(ROOT, c.path)
      if (!existsSync(full)) continue // already reported above
      if (!cache.has(c.path)) cache.set(c.path, readFileSync(full, 'utf8'))
      if (!cache.get(c.path)!.includes(c.title)) unmatched.push(`line ${c.line}: ${c.path} has no "${c.title}"`)
    }
    expect(unmatched).toEqual([])
  })

  it('gives every requirement row one of the three statuses', () => {
    const rows = rowStatuses(markdown)
    expect(rows).toHaveLength(64) // 21 items in §40, 43 in §66 — a row that stops parsing is a row that stops being checked
    const wrong = rows.filter((r) => !STATUSES.has(r.status))
    expect(wrong.map((r) => `line ${r.line}: ${r.status}`)).toEqual([])
  })

  it('makes every row that is not a ✓ say why', () => {
    const unexplained = rowStatuses(markdown).filter((r) => r.status !== '✓' && r.reason.length < 20)
    expect(unexplained.map((r) => `line ${r.line}: ${r.status} with no reason`)).toEqual([])
  })

  it('covers every numbered item of requirement.txt §40 and §66', () => {
    const ids = new Set(markdown.match(/\|\s*(40|66)\.\d+\s*\|/g)?.map((m) => m.replace(/[|\s]/g, '')) ?? [])
    const forty = [...ids].filter((id) => id.startsWith('40.'))
    const sixtySix = [...ids].filter((id) => id.startsWith('66.'))
    expect(forty).toHaveLength(21)
    expect(sixtySix).toHaveLength(43)
  })

  describe('the parser itself', () => {
    it('pairs a path with the span that follows it, and only that one', () => {
      const md = 'a `packages/core/src/cards/cards.test.ts` → `creates 52 unique cards` and `pnpm test`'
      const { citations: found, danglingPaths: dangling } = parseCitations(md)
      expect(dangling).toEqual([])
      expect(found).toEqual([{ path: 'packages/core/src/cards/cards.test.ts', title: 'creates 52 unique cards', line: 1 }])
    })

    it('reports a path with no title behind it rather than skipping the row', () => {
      const { citations: found, danglingPaths: dangling } = parseCitations('see `packages/core/src/cards/cards.test.ts`')
      expect(found).toEqual([])
      expect(dangling).toHaveLength(1)
    })

    it('ignores backticks that are not test paths — commands, tokens, env vars', () => {
      const md = 'run `pnpm test` with `SIT_OUT` and `DATABASE_URL`'
      expect(parseCitations(md)).toEqual({ citations: [], danglingPaths: [] })
    })

    it('would fail on a title the file does not contain', () => {
      const source = readFileSync(join(ROOT, 'packages/core/src/cards/cards.test.ts'), 'utf8')
      expect(source.includes('creates 52 unique cards')).toBe(true)
      expect(source.includes('creates 53 unique cards')).toBe(false)
    })

    it('reads statuses out of four-cell rows and leaves the header and separator alone', () => {
      const md = ['| # | Yêu cầu | Evidence | Status |', '|---|---|---|---|', '| 40.1 | x | y | ✓ |', '| 40.2 | x | y | partial — the image was never built |'].join('\n')
      expect(rowStatuses(md).map((r) => r.status)).toEqual(['✓', 'partial'])
    })

    it('is not fooled by an escaped pipe inside a cell', () => {
      const md = '| 40.1 | x | run `grep -rn "a\\|b" apps` | ✓ |'
      expect(rowStatuses(md).map((r) => r.status)).toEqual(['✓'])
    })

    it('separates the status token from the reason behind it', () => {
      const md = ['| 40.2 | x | y | partial — the image was never built |'].join('\n')
      expect(rowStatuses(md)[0]).toEqual({ status: 'partial', reason: 'the image was never built', line: 1 })
    })
  })
})
