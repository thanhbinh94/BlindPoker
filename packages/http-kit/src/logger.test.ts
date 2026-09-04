import { describe, expect, it, vi } from 'vitest'
import { createJsonLogger } from './logger.js'

function capture(): { lines: string[]; out: (line: string) => void } {
  const lines: string[] = []
  return { lines, out: (line) => lines.push(line) }
}

describe('createJsonLogger', () => {
  it('writes one JSON object per call, with the level, an ISO time and the message', () => {
    const { lines, out } = capture()
    createJsonLogger('debug', out).info('listening', { port: 8080 })
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0]!) as Record<string, unknown>
    expect(entry).toMatchObject({ level: 'info', msg: 'listening', port: 8080 })
    expect(new Date(entry.time as string).toISOString()).toBe(entry.time)
  })

  it('works without data', () => {
    const { lines, out } = capture()
    createJsonLogger('debug', out).warn('careful')
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'warn', msg: 'careful' })
  })

  it('drops everything below the configured level', () => {
    const { lines, out } = capture()
    const log = createJsonLogger('warn', out)
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(lines.map((l) => (JSON.parse(l) as { level: string }).level)).toEqual(['warn', 'error'])
  })

  it('passes everything through at `debug` and nothing below `error` at `error`', () => {
    const debug = capture()
    const error = capture()
    for (const [level, sink] of [['debug', debug], ['error', error]] as const) {
      const log = createJsonLogger(level, sink.out)
      log.debug('d')
      log.info('i')
      log.warn('w')
      log.error('e')
    }
    expect(debug.lines).toHaveLength(4)
    expect(error.lines).toHaveLength(1)
  })

  it('defaults to the console, keeping warn and error on their own channels', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const logger = createJsonLogger('debug')
      logger.debug('d')
      logger.info('i')
      logger.warn('w')
      logger.error('e')
      expect(log).toHaveBeenCalledTimes(2)
      expect(warn).toHaveBeenCalledTimes(1)
      expect(error).toHaveBeenCalledTimes(1)
      expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ level: 'error', msg: 'e' })
    } finally {
      log.mockRestore()
      warn.mockRestore()
      error.mockRestore()
    }
  })
})
