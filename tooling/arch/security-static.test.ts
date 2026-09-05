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
 * **How it reads the source: the TypeScript parser, not a lexer of its own.** The first version of
 * this file blanked string literals with a hand-rolled scan, and got the precedence of "opening a
 * template" and "already inside one" the wrong way round: a closing backtick pushed a second frame
 * instead of popping, so from the first backtick in a file onward everything was treated as
 * template text and erased. Half the scanned source and 47 of its 67 logging calls disappeared —
 * including all of the auth and request-handling code — while the suite stayed green, because the
 * only guards counted *files*, not surviving call sites. Regex literals had the same effect
 * (`/[a-z'`]/` opens a phantom string and a phantom template). `typescript` is already a
 * devDependency and knows all of this, so the scan walks a real syntax tree: a finding is a
 * `CallExpression` on a logging receiver, and the names it reports are identifiers and property
 * names *inside that call's arguments*. A string literal contributes nothing; a `${…}` inside a
 * template contributes its expression. There is nothing left for a lexer bug to hide.
 *
 * **Scope, stated so nobody reads more into a green run than it means.**
 *
 * - It reads `ROOTS` below — both apps' `src/` and all four packages' `src/`, non-test `.ts`/`.tsx`
 *   only. `tooling/`, `scripts/`, `deploy/`, the SEA build and every test file are outside it.
 * - A logging call is `<receiver>.<log|info|warn|error|debug|trace>(…)` where the receiver's last
 *   segment is `console`, `log` or `logger`. `deps.log.warn`, `this.deps.log.warn` and
 *   `console.error` all qualify.
 * - It cannot see an **aliased or wrapped** logger: `const l = deps.log; l.warn({ token })`,
 *   `log.child({ … }).warn(…)`, or a helper of one's own that takes a payload and logs it.
 * - It cannot see a value that reaches a log through **concatenation or a rename**:
 *   `log.info('t=' + t)`, or `const t = session.token` logged as `{ t }`. It matches *names*, and
 *   only whole ones — `accessToken` and `session_token` count, `bodyLimit` does not.
 * - It says nothing about anything **outside a logging call**: a `players.email` column in a
 *   Drizzle select is a field name, not a log line, and `console` itself is not banned — Lite's
 *   `main.ts` is a CLI whose whole job is to print.
 *
 * So this is a heuristic that catches the obvious mistake on the day it is written. Code review
 * still owns the rest, and `docs/security.md` says so in the same words.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
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
 * Matched against a name whole, and against each `camelCase` / `snake_case` segment of a longer one,
 * so `accessToken` and `session_token` are the same finding as `token`. `email` is on the list
 * because §23 asks for no full address in the log; a player id or a display name is what a line
 * should identify somebody by.
 */
const FORBIDDEN = new Set(['password', 'passwd', 'secret', 'token', 'cookie', 'authorization', 'credential', 'credentials', 'email'])

/**
 * …and the one term matched only as a *whole* name.
 *
 * `body` covers `req.body` and every alias of it — the one expression that dumps whatever a caller
 * sent, credentials included. It is not split into segments, because `bodyLimit` is a configured
 * number and `bodyParser` is a function, and neither is a payload.
 */
const FORBIDDEN_WHOLE = new Set(['body'])

/** The methods that reach a log, on a receiver whose last segment is one of `LOG_RECEIVERS`. */
const LOG_METHODS = new Set(['log', 'info', 'warn', 'error', 'debug', 'trace'])
const LOG_RECEIVERS = new Set(['console', 'log', 'logger'])

/**
 * Calls this scan lets through, each named by its exact text so it cannot quietly cover a second
 * one, and each asserted to still exist so it cannot rot into a dead exemption.
 */
const ALLOWED: { file: string; call: string; why: string }[] = [
  {
    file: 'apps/lite/server/src/main.ts',
    call: 'console.log(body)',
    why: '`--check` prints the `/health` response it has just read — a status, an uptime and two counts, with nothing of anyone\'s session in it — and a `fetch` response body is called `body`. This is the CLI printing to a terminal, not a server writing a log file.',
  },
]

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) listFiles(path, acc)
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) acc.push(path)
  }
  return acc
}

/** `deps.log.warn` and `this.deps.log.warn` qualify; `log.child({}).warn` deliberately does not. */
function isLoggingCallee(callee: ts.Expression): boolean {
  if (!ts.isPropertyAccessExpression(callee) || !LOG_METHODS.has(callee.name.text)) return false
  const receiver = callee.expression
  const last = ts.isIdentifier(receiver) ? receiver.text : ts.isPropertyAccessExpression(receiver) ? receiver.name.text : null
  return last !== null && LOG_RECEIVERS.has(last.toLowerCase())
}

/**
 * Every name a call's argument *prints*: identifiers, property names, object keys and the
 * expressions inside a template's `${…}`. A string literal's text is not a name and contributes
 * nothing, which is the whole distinction between a message and a value.
 */
function namesIn(node: ts.Node, out: string[]): void {
  if (ts.isStringLiteralLike(node)) return
  if (ts.isTemplateExpression(node)) {
    for (const span of node.templateSpans) namesIn(span.expression, out)
    return
  }
  if (ts.isIdentifier(node)) { out.push(node.text); return }
  if (ts.isPropertyAccessExpression(node)) { namesIn(node.expression, out); out.push(node.name.text); return }
  if (ts.isShorthandPropertyAssignment(node)) { out.push(node.name.text); return }
  if (ts.isPropertyAssignment(node)) {
    if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) out.push(node.name.text)
    namesIn(node.initializer, out)
    return
  }
  ts.forEachChild(node, (child) => { namesIn(child, out) })
}

interface LogCall { file: string; line: number; call: string; names: string[] }

/** Every logging call in one parsed file, whether or not it is a finding. */
function logCalls(file: string, src: string): LogCall[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind)
  const out: LogCall[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isLoggingCallee(node.expression)) {
      const names: string[] = []
      for (const arg of node.arguments) namesIn(arg, names)
      out.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        call: node.getText(sf).replace(/\s+/g, ' '),
        names,
      })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return out
}

/** The first forbidden term a call prints, or `null`. */
function forbiddenIn(names: string[]): string | null {
  for (const name of names) {
    if (FORBIDDEN_WHOLE.has(name.toLowerCase())) return name.toLowerCase()
    // Split *before* lowering, so `accessToken` yields `token` and `bodyLimit` yields `limit`.
    for (const segment of name.split(/_+|(?<=[a-z0-9])(?=[A-Z])/)) {
      if (FORBIDDEN.has(segment.toLowerCase())) return segment.toLowerCase()
    }
  }
  return null
}

interface Finding { file: string; line: number; call: string; term: string }

function findings(calls: LogCall[]): Finding[] {
  const out: Finding[] = []
  for (const call of calls) {
    const term = forbiddenIn(call.names)
    if (term !== null) out.push({ file: call.file, line: call.line, call: call.call, term })
  }
  return out
}

/** The scanner over a string rather than a file — for the tests of the scanner itself. */
export function scanSource(src: string): Finding[] {
  return findings(logCalls('fixture.ts', src))
}

describe('nothing secret reaches the log (spec §23)', () => {
  const files = ROOTS.flatMap((r) => listFiles(join(ROOT, r)))
  const rel = (f: string): string => f.slice(ROOT.length).replace(/\\/g, '/')
  const calls = files.flatMap((f) => logCalls(f, readFileSync(f, 'utf8')).map((c) => ({ ...c, file: rel(c.file) })))

  it('reads a real number of files, so a passing run is not an empty one', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  /**
   * The guard that the first version of this file did not have, and whose absence let a scanner
   * blind to 47 of 67 call sites pass as green: counting *files* proves only that the walk found
   * them, not that the parse survived contact with a backtick.
   *
   * The floor is a floor, not a pin — a call site deleted in good faith should not break the build
   * — but it sits close enough under the real number (**84** on 2026-09-05, counted by this same
   * walk) that losing one file's worth of them fails loudly.
   */
  it('still sees the logging calls it is meant to read', () => {
    expect(calls.length).toBeGreaterThanOrEqual(75)
  })

  it('passes no token, password, cookie, email or request body to a logging call', () => {
    const offenders = findings(calls).filter((f) => !ALLOWED.some((a) => a.file === f.file && a.call === f.call))
    expect(offenders.map((f) => `${f.file}:${String(f.line)} logs \`${f.term}\` — ${f.call}`)).toEqual([])
  })

  it('keeps no exemption that no longer names a real call', () => {
    const live = new Set(calls.map((c) => `${c.file} ${c.call}`))
    expect(ALLOWED.filter((a) => !live.has(`${a.file} ${a.call}`)).map((a) => `${a.file} ${a.call}`)).toEqual([])
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
      expect(scanSource('this.deps.log.warn("x", { accessToken })')).toHaveLength(1)
    })

    /**
     * The two positive controls the old lexer failed. A template literal and a regex are the two
     * constructs that used to swallow the rest of the file; each is followed here by a call that
     * *must* still be found, so a scanner that goes blind after one of them fails this test instead
     * of reporting an empty, reassuring list.
     */
    it('is not blinded by a template literal earlier in the file', () => {
      const src = 'const url = `ws://${host}/ws`\nlog.info("signed in", { token })'
      expect(scanSource(src)).toHaveLength(1)
      expect(scanSource(src)[0]?.line).toBe(2)
    })

    it('is not blinded by a regex literal earlier in the file', () => {
      // The real one, from `apps/normal-server/src/auth/auth-service.ts`: an apostrophe and a
      // backtick inside a character class, which a hand-rolled scan reads as a string and a template.
      const src = "const EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~.-]{1,64}@example\\.com$/\nlog.info(\"signed in\", { token })"
      expect(scanSource(src)).toHaveLength(1)
      expect(scanSource(src)[0]?.line).toBe(2)
    })

    it('does not mistake a field name outside a logging call for a logged value', () => {
      expect(scanSource('const rows = await db.select({ email: users.email }).from(users)')).toEqual([])
    })

    it('does not mistake configuration whose name merely starts with a term', () => {
      expect(scanSource('log.info("listening", { bodyLimit, port })')).toEqual([])
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
