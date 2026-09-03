/**
 * The Node built-in modules `@bp/core` must never import, plus the host globals it must never touch (spec §22.2).
 *
 * Shared by `eslint.config.js` and `tooling/arch/boundaries.test.ts` so the lint rule and the boundary test can
 * never drift apart. Plain ESM JavaScript on purpose: `eslint.config.js` is loaded by Node itself, which cannot
 * import a `.ts` module on the version this repo targets (Node 22.13), and adding a build step for one list of
 * strings would be worse.
 *
 * A trailing `*` is a glob segment (`node:*`, `stream/*`) in both the ESLint patterns and `nodeBuiltinImportRegex`.
 */
export const NODE_BUILTINS = [
  'node:*',
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants', 'crypto', 'dgram',
  'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'fs/promises', 'http', 'http2', 'https', 'inspector',
  'module', 'net', 'os', 'path', 'path/posix', 'path/win32', 'perf_hooks', 'process', 'punycode', 'querystring',
  'readline', 'repl', 'stream', 'stream/*', 'string_decoder', 'sys', 'timers', 'timers/promises', 'tls',
  'trace_events', 'tty', 'url', 'util', 'util/types', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]

/** Host globals that would smuggle a runtime dependency into the pure engine. */
export const FORBIDDEN_GLOBALS = ['process', 'Buffer', 'require', '__dirname', '__filename', 'setTimeout', 'setInterval', 'setImmediate']

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/** `node:*` / `stream/*` become glob fragments; everything else is matched literally. */
const alternatives = () => NODE_BUILTINS.map((m) => (m.endsWith('*') ? `${escape(m.slice(0, -1))}[\\w/-]+` : escape(m))).join('|')

/** Matches `from '<builtin>'`, `import('<builtin>')` and `require('<builtin>')` for every entry of NODE_BUILTINS. */
export function nodeBuiltinImportRegex() {
  return new RegExp(`(?:from\\s*|import\\s*\\(\\s*|require\\s*\\(\\s*)['"](?:${alternatives()})['"]`)
}
