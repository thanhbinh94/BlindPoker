export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/**
 * The logging surface the server packages expect. Declared here rather than imported: `@bp/http-kit`
 * depends on no workspace package, and the shape — four `(msg, data?)` methods — is the contract, so
 * `@bp/server-kit`'s `Logger` and this one are interchangeable structurally.
 */
export interface Logger {
  debug(msg: string, data?: object): void
  info(msg: string, data?: object): void
  warn(msg: string, data?: object): void
  error(msg: string, data?: object): void
}

const ORDER: LogLevel[] = ['debug', 'info', 'warn', 'error']

/**
 * Where each level goes by default. `warn` and `error` keep their own console channels so an
 * operator redirecting stderr still sees them; a caller that wants one stream passes `out`.
 */
const CONSOLE: Record<LogLevel, (line: string) => void> = {
  debug: (line) => console.log(line),
  info: (line) => console.log(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
}

/**
 * One JSON object per line — `{"level","time","msg",...data}` — which is what a log shipper, a
 * `findstr` and a human reading a console window can all work with. Anything below `level` is
 * dropped at construction time, so a suppressed `debug` costs nothing but a call.
 *
 * `out` receives the finished line; it is how tests capture output and how a caller sends every
 * level to one stream or to a file.
 */
export function createJsonLogger(level: LogLevel, out?: (line: string) => void): Logger {
  const min = ORDER.indexOf(level)
  const at = (lvl: LogLevel): Logger['info'] => {
    if (ORDER.indexOf(lvl) < min) return () => {}
    const write = out ?? CONSOLE[lvl]
    return (msg, data) => write(JSON.stringify({ level: lvl, time: new Date().toISOString(), msg, ...(data ?? {}) }))
  }
  return { debug: at('debug'), info: at('info'), warn: at('warn'), error: at('error') }
}
