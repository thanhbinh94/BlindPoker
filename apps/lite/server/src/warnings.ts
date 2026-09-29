/**
 * The process warnings Lite keeps off the console, and nothing else.
 *
 * Two lines used to open every run of the exe — `--status` and `--stop` included — and an operator reads a
 * warning as "something is wrong" (finding T9 of the 2026-09-28 operation test). Neither is something they can
 * act on:
 *
 * - `node:sqlite` announces itself as an `ExperimentalWarning` the first time it loads.
 * - Node's single-executable loader warns that its `require()` only reaches built-in modules. What trips it is
 *   `ws` probing for its optional native add-ons (`bufferutil`, `utf-8-validate`) inside a `try`: the add-ons are
 *   not bundled, the probe fails as `ws` expects it to, and `ws` carries on without them. (Node's own "single
 *   executable application is experimental" warning is already off: `disableExperimentalSEAWarning` in
 *   `scripts/sea-config.template.json`.)
 *
 * Everything else is handed back to the handlers Node installed, deprecations and other experimental warnings
 * included — a swallow-all listener would hide the warnings that do matter.
 */

type WarningHandler = (warning: Error) => void

/** The two warnings above, matched on their type and the start of their text. */
export function isQuietWarning(warning: Error): boolean {
  if (warning.name === 'ExperimentalWarning') return warning.message.includes('SQLite is an experimental feature')
  if (warning.name === 'Warning') {
    return warning.message.startsWith('Currently the require() provided to the main script embedded into single-executable applications')
  }
  return false
}

/** What the filter needs of `process`: its `warning` listeners. An `EventEmitter` in the tests. */
export interface WarningSource {
  listeners(event: 'warning'): unknown[]
  removeListener(event: 'warning', listener: WarningHandler): unknown
  on(event: 'warning', listener: WarningHandler): unknown
}

/**
 * Takes the `warning` listeners that are there now (Node's default printer), and puts one in front of them that
 * drops the quiet warnings and passes every other one on, unchanged and in order.
 */
export function installWarningFilter(source: WarningSource = process as unknown as WarningSource): void {
  const handlers = source.listeners('warning') as WarningHandler[]
  for (const handler of handlers) source.removeListener('warning', handler)
  source.on('warning', (warning) => {
    if (isQuietWarning(warning)) return
    for (const handler of handlers) handler(warning)
  })
}
