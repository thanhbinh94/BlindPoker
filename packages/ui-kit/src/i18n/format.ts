import type { Language } from './index.js'

const LOCALE: Record<Language, string> = { vi: 'vi-VN', en: 'en-US' }

export function formatPoints(n: number, lang: Language): string {
  return new Intl.NumberFormat(LOCALE[lang], { maximumFractionDigits: 0 }).format(n)
}

export function formatCompactPoints(n: number, lang: Language): string {
  const abs = Math.abs(n)
  if (abs < 1000) return formatPoints(n, lang)
  const [value, suffix] = abs >= 1_000_000 ? [n / 1_000_000, 'M'] : [n / 1000, 'K']
  const digits = Number.isInteger(value) ? 0 : 1
  return `${new Intl.NumberFormat(LOCALE[lang], { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(value)}${suffix}`
}
