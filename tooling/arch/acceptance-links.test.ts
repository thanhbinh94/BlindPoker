/**
 * Keeps `docs/acceptance-checklist.md` and `docs/test-matrix.md` honest.
 *
 * The checklist is the project's own answer to requirement.txt §40 and §66, and the matrix is the
 * same answer for spec §29.2, §29.3 and §30 — the one acceptance row 66.38 points at. Every row of
 * both points at something a reader can run. A row that cites a test which has since been renamed,
 * moved or deleted is worse than a row with no citation at all: it reads as proof and is not one.
 * So this test parses both documents and holds each citation to the file system.
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
 *
 * The matrix writes its citations differently — the backticked path or paths in one table cell and
 * the plain-text `it()` titles in the next, several to a cell, abbreviated with `…`, prefixed with
 * their `describe` and annotated in parentheses. `parseMatrixRows` below normalises that shape into
 * the same "this text must occur in one of these files" check.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CHECKLIST = join(ROOT, 'docs', 'acceptance-checklist.md')
const MATRIX = join(ROOT, 'docs', 'test-matrix.md')

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

/**
 * The shortest run of text in a matrix cell that is worth holding a file to. `staleness` and
 * `shutdown` are real, load-bearing fragments; anything shorter is a connective word an abbreviated
 * citation left behind, and asserting on it would only produce false confidence.
 */
const MIN_FRAGMENT = 8

interface MatrixCitation {
  /** Every file the row names; the fragment has to occur in at least one of them. */
  paths: string[]
  fragment: string
  line: number
}

/**
 * The pieces of a matrix "Test name" cell that must appear verbatim in one of the row's files.
 *
 * A cell holds one or more citations separated by ` · `, each of which may be `describe › it`, may
 * be abbreviated to `…` at either end or in the middle, and may carry a parenthesised aside that is
 * the document's own commentary rather than anything in the source. So: drop the parenthesised asides (set off by a space; a call's own `()` is part of a title), cut
 * the cell at every separator, strip the backticks a cell puts around error codes, and trim the
 * punctuation an abbreviation leaves dangling. What survives is literal test text.
 */
function matrixFragments(cell: string): string[] {
  return cell
    .replace(/\s\([^)]*\)/g, ' ') // commentary (set off by a space), never part of a title; a call's own `()` stays
    .split(/\s·\s|›|…/)
    .map((piece) => piece.replace(/`/g, '').replace(/^[\s,;:—-]+/, '').replace(/[\s,;:—-]+$/, ''))
    .filter((piece) => piece.length >= MIN_FRAGMENT)
}

/**
 * Every four-cell matrix row that names at least one test file, with its cell of titles already cut
 * into fragments. A row that names files and no title at all is reported rather than skipped — the
 * same rule `parseCitations` applies to a half-written checklist citation.
 */
function parseMatrixRows(markdown: string): { citations: MatrixCitation[]; titleless: string[]; rows: number } {
  const citations: MatrixCitation[] = []
  const titleless: string[] = []
  let rows = 0
  markdown.split('\n').forEach((text, index) => {
    const trimmed = text.trim()
    if (!trimmed.startsWith('|') || !trimmed.endsWith('|')) return
    const cells = trimmed.slice(1, -1).split(/(?<!\\)\|/)
    if (cells.length !== 4) return
    const paths = [...cells[1]!.matchAll(/`([^`\n]+)`/g)].map((m) => m[1]!).filter((p) => TEST_PATH.test(p))
    if (paths.length === 0) return // the header, the separator, and the summary table
    rows += 1
    const fragments = matrixFragments(cells[2]!)
    if (fragments.length === 0) titleless.push(`line ${index + 1}: ${paths.join(', ')} with no test name behind it`)
    for (const fragment of fragments) citations.push({ paths, fragment, line: index + 1 })
  })
  return { citations, titleless, rows }
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
    // 21 items in §40, 43 in §66, the three rows of Plan 21 (P21.1–P21.3) the two of Plan 22 (P22.1, P22.2), the three of Plan 25
    // (P25.1–P25.3) and P26.1 and P26.2 of Plan 26 (C3 adds P26.3), which are not requirement.txt's — a row that stops
    // parsing is a row that stops being checked
    expect(rows).toHaveLength(64 + 3 + 2 + 3 + 2)
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

describe('docs/test-matrix.md', () => {
  it('is there at all — the other assertions mean nothing without it', () => {
    expect(existsSync(MATRIX), `${MATRIX} is missing`).toBe(true)
  })

  const markdown = existsSync(MATRIX) ? readFileSync(MATRIX, 'utf8') : ''
  const { citations, titleless, rows } = parseMatrixRows(markdown)

  it('covers the whole matrix, so a parser that stopped matching would be caught', () => {
    // 16 rows of §29.2, 1 of §29.3, 25 of §30 — the counts the document's own summary gives — the text-overlap
    // rule of the 2026-09-29 review (No11b), the one row of Plan 16 that is not the spec's, the ten rows of Plan 21's
    // section (the squeeze round and the card motion, spec 2026-10-08), and the four of Plan 22's (the monthly daily
    // gifts, spec 2026-10-12), the seven of Plan 25's (the GM role, spec 2026-10-18) and the five of Plan 26's Part A (the GM's
    // second batch, spec 2026-10-20), the eight of Plan 26's Part B (the landscape frame and the portrait debts, same spec;
    // Part C adds its rows after them)
    expect(rows).toBe(43 + 10 + 4 + 7 + 5 + 8)
    expect(citations.length).toBeGreaterThanOrEqual(40)
  })

  it('leaves no row naming a file with no test name behind it', () => {
    expect(titleless).toEqual([])
  })

  it('cites only test files that exist', () => {
    const missing = new Set<string>()
    for (const c of citations) for (const p of c.paths) if (!existsSync(join(ROOT, p))) missing.add(`line ${c.line}: ${p}`)
    expect([...missing]).toEqual([])
  })

  it('cites only test names that appear in one of the files the row names', () => {
    const cache = new Map<string, string>()
    const read = (path: string): string => {
      if (!cache.has(path)) cache.set(path, existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), 'utf8') : '')
      return cache.get(path)!
    }
    const unmatched = citations
      .filter((c) => !c.paths.some((p) => read(p).includes(c.fragment)))
      .map((c) => `line ${c.line}: none of ${c.paths.join(', ')} has "${c.fragment}"`)
    expect(unmatched).toEqual([])
  })

  describe('the matrix parser itself', () => {
    it('cuts a cell into the fragments that have to be literal, and drops the commentary', () => {
      expect(matrixFragments('lobby and rooms › lists public rooms live, joins by code, … (joins by the lower-cased code)')).toEqual([
        'lobby and rooms',
        'lists public rooms live, joins by code',
      ])
    })

    it('keeps the parentheses of a call that is part of a title, and drops an aside set off by a space', () => {
      expect(matrixFragments('client.reveal() sends REVEAL with a request id (the ACK comes back)')).toEqual(['client.reveal() sends REVEAL with a request id'])
    })

    it('splits several citations in one cell, and unwraps a backticked error code', () => {
      expect(matrixFragments('everyone folds → pot carries over, no fee · rejects a name already in use with `DISPLAY_NAME_TAKEN`')).toEqual([
        'everyone folds → pot carries over, no fee',
        'rejects a name already in use with DISPLAY_NAME_TAKEN',
      ])
    })

    it('would fail on a title the row’s files do not contain', () => {
      const md = ['| x | `packages/core/src/cards/cards.test.ts` | creates 53 unique cards | covered |'].join('\n')
      const { citations: found } = parseMatrixRows(md)
      const source = readFileSync(join(ROOT, 'packages/core/src/cards/cards.test.ts'), 'utf8')
      expect(found).toHaveLength(1)
      expect(source.includes(found[0]!.fragment)).toBe(false)
    })

    it('reports a row that names a file and no test at all', () => {
      const md = ['| x | `packages/core/src/cards/cards.test.ts` | — | covered |'].join('\n')
      expect(parseMatrixRows(md).titleless).toHaveLength(1)
    })

    it('leaves the header, the separator and the summary table alone', () => {
      const md = ['| Requirement | Test file | Test name | Status |', '|---|---|---|---|', '| | §29.2 | §29.3 | §30 | total |', '| rows | 16 | 1 | 25 | 42 |'].join('\n')
      expect(parseMatrixRows(md)).toEqual({ citations: [], titleless: [], rows: 0 })
    })
  })
})
