import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { installWarningFilter, isQuietWarning, type WarningSource } from './warnings.js'

const warning = (name: string, message: string): Error => Object.assign(new Error(message), { name })

/** The exact text Node 22's single-executable loader prints, as the 2026-09-28 run saw it on every start. */
const SEA_REQUIRE =
  'Currently the require() provided to the main script embedded into single-executable applications only supports loading built-in modules.\n' +
  'To load a module from disk after the single executable application is launched, use require("module").createRequire().\n' +
  'Support for bundled module loading or virtual file systems are under discussions in https://github.com/nodejs/single-executable'

describe('isQuietWarning (T9)', () => {
  it('names the single-executable require() warning and the node:sqlite one', () => {
    expect(isQuietWarning(warning('Warning', SEA_REQUIRE))).toBe(true)
    expect(isQuietWarning(warning('ExperimentalWarning', 'SQLite is an experimental feature and might change at any time'))).toBe(true)
  })

  it('names nothing else — other experimental features, deprecations, plain warnings', () => {
    expect(isQuietWarning(warning('ExperimentalWarning', 'Single executable application is an experimental feature and might change at any time'))).toBe(false)
    expect(isQuietWarning(warning('ExperimentalWarning', 'The Fetch API is an experimental feature'))).toBe(false)
    expect(isQuietWarning(warning('DeprecationWarning', 'Buffer() is deprecated'))).toBe(false)
    expect(isQuietWarning(warning('Warning', 'Possible EventEmitter memory leak detected'))).toBe(false)
    // The same words under another type are somebody else's warning.
    expect(isQuietWarning(warning('DeprecationWarning', SEA_REQUIRE))).toBe(false)
  })
})

describe('installWarningFilter (T9)', () => {
  function source() {
    const emitter = new EventEmitter()
    const printer = vi.fn()
    emitter.on('warning', printer)
    return { emitter, printer, target: emitter as unknown as WarningSource }
  }

  it('drops the quiet warnings and hands every other one to the handlers that were there, in order', () => {
    const { emitter, printer, target } = source()
    const second = vi.fn()
    emitter.on('warning', second)
    installWarningFilter(target)

    emitter.emit('warning', warning('Warning', SEA_REQUIRE))
    emitter.emit('warning', warning('ExperimentalWarning', 'SQLite is an experimental feature and might change at any time'))
    expect(printer).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    const kept = warning('DeprecationWarning', 'Buffer() is deprecated')
    emitter.emit('warning', kept)
    expect(printer.mock.calls).toEqual([[kept]])
    expect(second.mock.calls).toEqual([[kept]])
    expect(printer.mock.invocationCallOrder[0]!).toBeLessThan(second.mock.invocationCallOrder[0]!)
  })

  it('leaves exactly one listener behind, so nothing is printed twice', () => {
    const { emitter, target } = source()
    installWarningFilter(target)
    expect(emitter.listenerCount('warning')).toBe(1)
  })
})
