export interface Logger {
  debug(msg: string, data?: object): void
  info(msg: string, data?: object): void
  warn(msg: string, data?: object): void
  error(msg: string, data?: object): void
}

const line = (level: string, msg: string, data?: object) => JSON.stringify({ level, time: new Date().toISOString(), msg, ...(data ?? {}) })

export const consoleLogger: Logger = {
  debug: () => {},
  info: (msg, data) => console.log(line('info', msg, data)),
  warn: (msg, data) => console.warn(line('warn', msg, data)),
  error: (msg, data) => console.error(line('error', msg, data)),
}

export const silentLogger: Logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
