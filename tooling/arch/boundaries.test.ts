import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { nodeBuiltinImportRegex } from './node-builtins.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Allowed workspace dependencies per package (spec §22.2). Extend when packages are added. */
const ALLOWED: Record<string, string[]> = {
  '@bp/core': [],
  '@bp/http-kit': [],
  '@bp/server-kit': ['@bp/core'],
  '@bp/ui-kit': ['@bp/core'],
  '@bp/normal-server': ['@bp/core', '@bp/server-kit', '@bp/http-kit'],
  '@bp/normal-web': ['@bp/core', '@bp/ui-kit'],
  '@bp/lite': ['@bp/core', '@bp/server-kit', '@bp/ui-kit', '@bp/http-kit'],
}

function workspacePackages(): { name: string; dir: string; json: Record<string, unknown> }[] {
  const out: { name: string; dir: string; json: Record<string, unknown> }[] = []
  for (const group of ['packages', 'apps']) {
    const base = join(ROOT, group)
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base)) {
      const dir = join(base, entry)
      const pkgPath = join(dir, 'package.json')
      if (statSync(dir).isDirectory() && existsSync(pkgPath)) {
        const json = JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
        out.push({ name: String(json.name), dir, json })
      }
    }
  }
  return out
}

const depsOf = (json: Record<string, unknown>, key: string) => Object.keys((json[key] as Record<string, string> | undefined) ?? {})

function listFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) listFiles(p, acc)
    else if (/\.(ts|tsx)$/.test(entry)) acc.push(p)
  }
  return acc
}

describe('workspace dependency graph', () => {
  const pkgs = workspacePackages()

  it('every workspace package is known', () => {
    for (const p of pkgs) expect(Object.keys(ALLOWED), `unknown package ${p.name}`).toContain(p.name)
  })

  it('packages only depend on allowed @bp packages', () => {
    for (const p of pkgs) {
      const bpDeps = [...depsOf(p.json, 'dependencies'), ...depsOf(p.json, 'devDependencies'), ...depsOf(p.json, 'peerDependencies')].filter((d) => d.startsWith('@bp/'))
      for (const d of bpDeps) expect(ALLOWED[p.name], `${p.name} must not depend on ${d}`).toContain(d)
    }
  })

  it('@bp/core has no runtime dependencies', () => {
    const core = pkgs.find((p) => p.name === '@bp/core')!
    expect(depsOf(core.json, 'dependencies')).toEqual([])
  })

  it('@bp/core source never mentions editions or imports other workspaces / node built-ins', () => {
    const core = pkgs.find((p) => p.name === '@bp/core')!
    const builtinImport = nodeBuiltinImportRegex()
    for (const file of listFiles(join(core.dir, 'src'))) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/\beditions?\b/i)
      // `import … from`, `import(…)` and `require(…)` of any @bp package or `node:` specifier
      expect(src, file).not.toMatch(/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:@bp\/|node:)/)
      // the same three import forms for every bare Node built-in the ESLint rule forbids
      expect(src, file).not.toMatch(builtinImport)
      // edition names as literals; prose such as "normal sample" in a comment is fine
      expect(src, file).not.toMatch(/['"](normal|lite)['"]/)
    }
  })
})
