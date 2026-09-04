import { readFileSync } from 'node:fs'

/**
 * The smallest `.env` reader that covers what an operator actually writes: `KEY=value` lines, `#`
 * comments, blank lines, and single- or double-quoted values (which may contain `#` and `=`). An
 * unquoted value loses everything from the first ` #`, so a trailing note is not part of the value.
 *
 * No interpolation, no multi-line values, no `export ` prefix: every one of those would be a way for
 * a config file to mean something other than what it says.
 */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    const quote = value[0]
    if (quote === '"' || quote === "'") {
      const close = value.indexOf(quote, 1)
      value = close > 0 ? value.slice(1, close) : value.slice(1)
    } else {
      const hash = value.indexOf(' #')
      if (hash >= 0) value = value.slice(0, hash).trim()
    }
    out[key] = value
  }
  return out
}

/**
 * `parseDotenv` over a file. A missing (or unreadable) file is not an error: the environment is the
 * primary source of configuration and the file is the optional convenience beside the executable.
 */
export function readDotenv(path: string): Record<string, string> {
  try {
    return parseDotenv(readFileSync(path, 'utf8'))
  } catch {
    return {}
  }
}
