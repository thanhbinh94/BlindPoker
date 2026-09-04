import { describe, expect, it } from 'vitest'
import { displayNameKey, normalizeDisplayName, validateDisplayName } from './display-name.js'

const NFC_BINH = 'Bình'.normalize('NFC')
/** The same name spelled decomposed — `i` followed by a combining grave, as some keyboards emit it. */
const NFD_BINH = NFC_BINH.normalize('NFD')

const accept = (raw: string) => {
  const verdict = validateDisplayName(raw)
  if (!verdict.ok) throw new Error(`expected ${JSON.stringify(raw)} to be accepted, got ${verdict.reason}`)
  return verdict
}
const refusal = (raw: string) => {
  const verdict = validateDisplayName(raw)
  return verdict.ok ? null : verdict.reason
}

describe('normalizeDisplayName', () => {
  it('composes to NFC so the two spellings of one Vietnamese name become one', () => {
    expect(NFD_BINH).not.toBe(NFC_BINH)
    expect(normalizeDisplayName(NFD_BINH)).toBe(NFC_BINH)
    expect(normalizeDisplayName(NFC_BINH)).toBe(NFC_BINH)
  })

  it('trims the edges and collapses every run of internal whitespace to one plain space', () => {
    expect(normalizeDisplayName('  Bình An  ')).toBe('Bình An')
    expect(normalizeDisplayName('Bình \tAn')).toBe('Bình An')
    expect(normalizeDisplayName('Bình   Văn   An')).toBe('Bình Văn An')
  })

  it('is idempotent', () => {
    const once = normalizeDisplayName(' Bình  An ')
    expect(normalizeDisplayName(once)).toBe(once)
  })
})

describe('displayNameKey', () => {
  it('folds case for Vietnamese, diacritics included', () => {
    expect(displayNameKey('Người')).toBe(displayNameKey('NGƯỜI'))
    expect(displayNameKey('người')).toBe(displayNameKey('NGƯỜI'))
  })

  it('keeps distinct names distinct — folding case is not stripping diacritics', () => {
    expect(displayNameKey('Bình')).not.toBe(displayNameKey('Binh'))
    expect(displayNameKey('Đông')).not.toBe(displayNameKey('Dong'))
  })

  it('returns a key that is itself NFC, even after case folding', () => {
    expect(displayNameKey('NGƯỜI')).toBe(displayNameKey('NGƯỜI').normalize('NFC'))
  })
})

describe('validateDisplayName', () => {
  it.each(['Alice', 'Bob_99', 'A.B-C', 'Nguyễn Văn A', 'Trần 12', 'ab', 'x'.repeat(20)])('accepts %s', (name) => {
    expect(accept(name).name).toBe(name)
  })

  it('returns the normalized name, not the raw input', () => {
    expect(accept('  Nguyễn   Văn  A  ').name).toBe('Nguyễn Văn A')
    expect(accept(NFD_BINH).name).toBe(NFC_BINH)
  })

  it('gives the same key to every case and composition of one name', () => {
    const keys = ['Người', 'NGƯỜI', 'người', ' Người ', 'Người'.normalize('NFD')].map((n) => accept(n).key)
    expect(new Set(keys).size).toBe(1)
  })

  it('measures length in code points, so diacritics and astral characters cost one each', () => {
    // Decomposed, `Bình` is 6 UTF-16 units but 4 characters; the NFC form it normalizes to is 4.
    expect(accept(NFD_BINH).name).toHaveLength(4)
    expect(refusal('ừ')).toBe('length') // one character, still too short
    expect(refusal('x'.repeat(21))).toBe('length')
    expect(refusal('')).toBe('length')
    expect(refusal('   ')).toBe('length')
    // 20 code points, 40 UTF-16 units: a UTF-16 length check would have refused this.
    expect(accept('𝔞'.repeat(20) as string).name).toHaveLength(40)
  })

  it('refuses anything outside letters, marks, digits, space, _ - and .', () => {
    for (const bad of ['<script>', 'a@b', 'Bình!', 'a/b', 'a\\b', '100%']) expect(refusal(bad), bad).toBe('chars')
  })

  it('refuses invisible characters — zero-width joins and bidi overrides (\\p{Cf})', () => {
    for (const bad of ['Bin​h', 'Bình‍', '‮Binh', 'Bi﻿nh', 'ab­cd']) {
      expect(refusal(bad), JSON.stringify(bad)).toBe('chars')
    }
  })

  it('refuses a leading or trailing separator, which is a near-duplicate nobody can see', () => {
    for (const bad of ['.Bình', 'Bình.', '_Alice', 'Alice_', '-Alice', 'Alice-']) expect(refusal(bad), bad).toBe('edges')
    // …but separators inside are fine.
    expect(accept('A.B-C_D').name).toBe('A.B-C_D')
  })

  it('normalizes whitespace rather than refusing it, so a trailing space is not a rejection', () => {
    expect(accept(' Alice ').name).toBe('Alice')
    expect(accept('Alice\n').name).toBe('Alice')
  })

  it('checks length before characters, so a long line of junk reports the length', () => {
    expect(refusal('<'.repeat(30))).toBe('length')
  })
})
