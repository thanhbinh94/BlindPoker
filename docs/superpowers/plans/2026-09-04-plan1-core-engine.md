# Bind Poker — Plan 1: Monorepo Scaffold + Core Game Engine (M1–M3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pnpm monorepo skeleton and the complete, edition-agnostic poker core (`@bp/core`): cards, RNG, hand evaluator, pot math, No-Limit Hold'em hand engine, Blind Poker hand engine (2/3 hole cards, mode A/B), bot strategies, protocol types + validators, with a full Vitest suite and architecture-boundary checks.

**Architecture:** `@bp/core` is a pure TypeScript library with zero runtime dependencies and no I/O. The hand engine is a pure reducer: `createHand()` and `applyCommand(state, cmd, rng)` return `{ state, events }`. Timers and reveal pacing are external commands (`TIMEOUT`, `ADVANCE`) so every scenario is a deterministic list of commands. Hold'em and Blind share cards, evaluator, pots and events; they differ only in their betting module.

**Tech Stack:** Node 22.13 LTS, pnpm 9, TypeScript 5.6 (strict, ESM, `moduleResolution: bundler`), Vitest 2, ESLint 9 flat config.

**Spec:** `docs/superpowers/specs/2026-09-04-bind-poker-design.md` (sections 7, 8, 9, 17, 20, 22 drive this plan).

## Global Constraints

- Node `>=22.13`, pnpm `9.x`. If `pnpm` is not on PATH in a shell: `export PATH="$PATH:$(npm prefix -g)"`.
- `packages/core` has **no** `dependencies` (only devDependencies). It never imports from `@bp/server-kit`, `@bp/ui-kit`, or `apps/*`, and never imports Node built-ins.
- No `edition`, `normal`, `lite` identifiers anywhere in `packages/core/src`.
- Cards are integers `0..51`: `rank = card % 13` (0 = "2" … 12 = "A"), `suit = Math.floor(card / 13)` (0 = c, 1 = d, 2 = h, 3 = s).
- Chip amounts are integers. Reducer never produces negative stacks.
- All engine functions are pure: they `structuredClone` the input state before mutating; the caller's object is never changed.
- Money invariant checked in every hand test: `Σ stackBefore + carryOverIn = Σ stackAfter + fee + carryOverOut`.
- Every commit message ends with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Package names: `@bp/core`, `@bp/server-kit`, `@bp/ui-kit`, `@bp/normal-server`, `@bp/normal-web`, `@bp/lite`. Only `@bp/core` is created in this plan.
- Test files are colocated: `src/**/*.test.ts`. Imports inside core use explicit `.js` extensions.

## File Structure (this plan)

```text
package.json                      root: workspace scripts (test, lint, typecheck, build:normal, build:lite)
pnpm-workspace.yaml
.npmrc
tsconfig.base.json                strict ESM base
vitest.workspace.ts               picks up every package/app vitest config
eslint.config.js                  boundary rules (no-restricted-imports per folder)
tooling/vitest.config.ts
tooling/arch/boundaries.test.ts   reads every package.json and asserts the dependency graph
packages/core/package.json        @bp/core — zero deps
packages/core/tsconfig.json
packages/core/vitest.config.ts
packages/core/src/index.ts        public barrel
packages/core/src/cards/cards.ts          Card helpers, deck, parse/format
packages/core/src/cards/rng.ts            Rng interface, seededRng (mulberry32)
packages/core/src/cards/shuffle.ts        Fisher–Yates with injected Rng
packages/core/src/evaluator/combinations.ts
packages/core/src/evaluator/evaluator.ts  evaluate5, evaluate (5–8 cards), categories, encoding
packages/core/src/betting/pots.ts         computePots, distributePots, tableFee
packages/core/src/hand/types.ts           Ruleset, SeatInput, HandPlayer, HandState, PlayerAction, HandCommand, LegalActions, GameEvent, HandResult
packages/core/src/hand/common.ts          seat helpers, clone, settlement shared by both modes
packages/core/src/hand/holdem.ts          createHoldemHand, holdemLegalActions, applyHoldemCommand
packages/core/src/hand/blind.ts           createBlindHand, blindLegalActions, applyBlindCommand
packages/core/src/hand/engine.ts          createHand / applyCommand / legalActions dispatch, nextButton
packages/core/src/hand/view.ts            HandView + playerView(state, viewerSeat)
packages/core/src/hand/simulate.ts        harness: plays whole hands with a policy, asserts invariants
packages/core/src/bot/chen.ts             chenScore for 2 and 3 cards
packages/core/src/bot/strategy.ts         BotStrategy, createBotStrategy
packages/core/src/constants/economy.ts    tiers, startingBalance, fee, daily table (points)
packages/core/src/protocol/messages.ts    ClientMessage / ServerMessage / RoomConfig / error codes
packages/core/src/protocol/validate.ts    parseClientMessage, validateRoomConfig
```

---

### Task 1: Monorepo scaffold and `@bp/core` skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `tsconfig.base.json`, `vitest.workspace.ts`, `eslint.config.js`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Interfaces:**
- Produces: workspace commands `pnpm test`, `pnpm typecheck`, `pnpm lint`; package `@bp/core` importable as `@bp/core` by later packages.

- [ ] **Step 1: Write root workspace files**

`package.json`:
```json
{
  "name": "bind-poker",
  "private": true,
  "version": "0.1.0",
  "packageManager": "pnpm@9.15.9",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "pnpm -r exec tsc --noEmit -p tsconfig.json",
    "lint": "eslint .",
    "build:normal": "pnpm --filter @bp/normal-server --filter @bp/normal-web run build",
    "build:lite": "pnpm --filter @bp/lite run build"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "typescript": "^5.6.3",
    "typescript-eslint": "^8.18.0",
    "vitest": "^2.1.8"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`.npmrc`:
```ini
auto-install-peers=true
strict-peer-dependencies=false
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "types": ["node"]
  }
}
```

`vitest.workspace.ts`:
```ts
export default ['packages/*/vitest.config.ts', 'apps/*/vitest.config.ts', 'tooling/vitest.config.ts']
```

`tooling/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'tooling', include: ['arch/**/*.test.ts'] } })
```

`eslint.config.js`:
```js
import tseslint from 'typescript-eslint'

const forbid = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
})

export default tseslint.config(
  { ignores: ['**/dist/**', '**/release/**', '**/node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: forbid(
      ['@bp/*', '**/server-kit/**', '**/ui-kit/**', '**/apps/**', 'node:*', 'fs', 'net', 'http', 'crypto'],
      '@bp/core must be pure: no @bp packages, no Node built-ins',
    ),
  },
  {
    files: ['packages/server-kit/**/*.ts'],
    rules: forbid(['@bp/ui-kit', '@bp/normal-*', '@bp/lite', '**/apps/**', 'react'], '@bp/server-kit may only depend on @bp/core'),
  },
  {
    files: ['packages/ui-kit/**/*.{ts,tsx}'],
    rules: forbid(['@bp/server-kit', '@bp/normal-*', '@bp/lite', '**/apps/**'], '@bp/ui-kit may only depend on @bp/core'),
  },
  { files: ['apps/normal-*/**/*.{ts,tsx}'], rules: forbid(['@bp/lite', '**/apps/lite/**'], 'normal must not depend on lite') },
  { files: ['apps/lite/**/*.{ts,tsx}'], rules: forbid(['@bp/normal-*', '**/apps/normal-*/**'], 'lite must not depend on normal') },
)
```

- [ ] **Step 2: Write `@bp/core` package files**

`packages/core/package.json`:
```json
{
  "name": "@bp/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": { "test": "vitest run", "typecheck": "tsc --noEmit -p tsconfig.json" },
  "devDependencies": { "typescript": "^5.6.3", "vitest": "^2.1.8" }
}
```

`packages/core/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

`packages/core/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'core', include: ['src/**/*.test.ts'] } })
```

`packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0'
```

`packages/core/src/index.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { CORE_VERSION } from './index.js'

describe('core package', () => {
  it('exports a version', () => {
    expect(CORE_VERSION).toBe('0.1.0')
  })
})
```

- [ ] **Step 3: Install and run**

Run: `pnpm install && pnpm test && pnpm typecheck && pnpm lint`
Expected: install succeeds; 1 test passes; typecheck and lint exit 0. (`tooling` project has no tests yet — vitest reports "no test files" for it, which is fine as long as overall exit code is 0; if vitest fails on the empty project, add `passWithNoTests: true` to `tooling/vitest.config.ts`.)

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold pnpm monorepo and @bp/core skeleton

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Cards, RNG, shuffle

**Files:**
- Create: `packages/core/src/cards/cards.ts`, `packages/core/src/cards/rng.ts`, `packages/core/src/cards/shuffle.ts`, `packages/core/src/cards/cards.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `type Card = number`; `rankOf(c): number` (0..12); `suitOf(c): number` (0..3); `makeCard(rank, suit): Card`
  - `cardToString(c): string` e.g. `"As"`, `"Td"`; `parseCard("As"): Card`; `parseCards("As Kd 2c"): Card[]`
  - `createDeck(): Card[]` (0..51 in order)
  - `interface Rng { int(maxExclusive: number): number }`; `seededRng(seed: number): Rng`
  - `shuffle(deck: readonly Card[], rng: Rng): Card[]` (returns a new array)
  - `RANK_CHARS`, `SUIT_CHARS` constant tuples

- [ ] **Step 1: Write failing tests**

`packages/core/src/cards/cards.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { cardToString, createDeck, makeCard, parseCard, parseCards, rankOf, suitOf } from './cards.js'
import { seededRng } from './rng.js'
import { shuffle } from './shuffle.js'

describe('cards', () => {
  it('encodes rank and suit', () => {
    const c = makeCard(12, 3) // As
    expect(rankOf(c)).toBe(12)
    expect(suitOf(c)).toBe(3)
    expect(cardToString(c)).toBe('As')
  })
  it('parses and formats round-trip for all 52 cards', () => {
    for (const c of createDeck()) expect(parseCard(cardToString(c))).toBe(c)
  })
  it('parses a space separated list', () => {
    expect(parseCards('2c Td As')).toEqual([makeCard(0, 0), makeCard(8, 1), makeCard(12, 3)])
  })
  it('rejects bad cards', () => {
    expect(() => parseCard('Xz')).toThrow()
  })
  it('creates 52 unique cards', () => {
    const d = createDeck()
    expect(d).toHaveLength(52)
    expect(new Set(d).size).toBe(52)
  })
})

describe('shuffle', () => {
  it('is deterministic for a seed and keeps all cards', () => {
    const a = shuffle(createDeck(), seededRng(42))
    const b = shuffle(createDeck(), seededRng(42))
    expect(a).toEqual(b)
    expect([...a].sort((x, y) => x - y)).toEqual(createDeck())
    expect(a).not.toEqual(createDeck())
  })
  it('does not mutate the input', () => {
    const d = createDeck()
    shuffle(d, seededRng(1))
    expect(d).toEqual(createDeck())
  })
  it('spreads the first card roughly uniformly', () => {
    const counts = new Array<number>(52).fill(0)
    const rng = seededRng(7)
    for (let i = 0; i < 5200; i++) counts[shuffle(createDeck(), rng)[0]!]!++
    for (const n of counts) expect(n).toBeGreaterThan(50) // expected 100 each
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/cards/cards.ts`:
```ts
export type Card = number

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
export const SUIT_CHARS = ['c', 'd', 'h', 's'] as const

export const rankOf = (c: Card): number => c % 13
export const suitOf = (c: Card): number => Math.floor(c / 13)
export const makeCard = (rank: number, suit: number): Card => suit * 13 + rank

export function cardToString(c: Card): string {
  return `${RANK_CHARS[rankOf(c)]}${SUIT_CHARS[suitOf(c)]}`
}

export function parseCard(s: string): Card {
  const rank = RANK_CHARS.indexOf(s[0] as (typeof RANK_CHARS)[number])
  const suit = SUIT_CHARS.indexOf(s[1] as (typeof SUIT_CHARS)[number])
  if (s.length !== 2 || rank < 0 || suit < 0) throw new Error(`Invalid card: ${s}`)
  return makeCard(rank, suit)
}

export function parseCards(s: string): Card[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard)
}

export function createDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i)
}
```

`packages/core/src/cards/rng.ts`:
```ts
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number
}

/** Deterministic mulberry32 generator for tests and replays. */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0
  return {
    int(maxExclusive: number): number {
      if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) throw new Error('maxExclusive must be a positive integer')
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296
      return Math.floor(r * maxExclusive)
    },
  }
}
```

`packages/core/src/cards/shuffle.ts`:
```ts
import type { Card } from './cards.js'
import type { Rng } from './rng.js'

/** Fisher–Yates; returns a new array, input untouched. */
export function shuffle(deck: readonly Card[], rng: Rng): Card[] {
  const d = deck.slice()
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1)
    const tmp = d[i]!
    d[i] = d[j]!
    d[j] = tmp
  }
  return d
}
```

Update `packages/core/src/index.ts`:
```ts
export const CORE_VERSION = '0.1.0'
export * from './cards/cards.js'
export * from './cards/rng.js'
export * from './cards/shuffle.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): cards, seeded rng, shuffle

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 3: Hand evaluator (5–8 cards)

**Files:**
- Create: `packages/core/src/evaluator/combinations.ts`, `packages/core/src/evaluator/evaluator.ts`, `packages/core/src/evaluator/evaluator.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `enum-like const HandCategory` = `{ HIGH_CARD:0, PAIR:1, TWO_PAIR:2, TRIPS:3, STRAIGHT:4, FLUSH:5, FULL_HOUSE:6, QUADS:7, STRAIGHT_FLUSH:8, ROYAL_FLUSH:9 }` and `type HandCategory = 0|1|...|9`
  - `HAND_CATEGORY_KEYS: readonly string[]` — i18n keys `hand.highCard` … `hand.royalFlush` indexed by category
  - `evaluate5(cards: readonly Card[]): number` — rank integer, higher is better
  - `evaluate(cards: readonly Card[]): HandEvaluation` where `interface HandEvaluation { rank: number; category: HandCategory; best: Card[] }`; accepts 5..8 cards
  - `categoryOf(rank: number): HandCategory`
  - `combinations<T>(items: readonly T[], k: number): T[][]`

- [ ] **Step 1: Write failing tests**

`packages/core/src/evaluator/evaluator.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { createDeck, parseCards } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { combinations } from './combinations.js'
import { HandCategory, categoryOf, evaluate, evaluate5 } from './evaluator.js'

const cat = (s: string) => evaluate(parseCards(s)).category
const rank = (s: string) => evaluate(parseCards(s)).rank

describe('combinations', () => {
  it('C(7,5) = 21 and C(8,5) = 56', () => {
    expect(combinations([1, 2, 3, 4, 5, 6, 7], 5)).toHaveLength(21)
    expect(combinations([1, 2, 3, 4, 5, 6, 7, 8], 5)).toHaveLength(56)
    expect(combinations([1, 2, 3], 3)).toEqual([[1, 2, 3]])
  })
})

describe('categories', () => {
  it.each([
    ['As Ks Qs Js Ts', HandCategory.ROYAL_FLUSH],
    ['9h 8h 7h 6h 5h', HandCategory.STRAIGHT_FLUSH],
    ['Ah 2h 3h 4h 5h', HandCategory.STRAIGHT_FLUSH],
    ['Kc Kd Kh Ks 2d', HandCategory.QUADS],
    ['Qc Qd Qh 5s 5d', HandCategory.FULL_HOUSE],
    ['2c 7c 9c Jc Kc', HandCategory.FLUSH],
    ['Ac 2d 3h 4s 5c', HandCategory.STRAIGHT],
    ['Tc Jd Qh Ks Ac', HandCategory.STRAIGHT],
    ['7c 7d 7h 2s 9d', HandCategory.TRIPS],
    ['7c 7d 9h 9s 2d', HandCategory.TWO_PAIR],
    ['7c 7d 3h 9s 2d', HandCategory.PAIR],
    ['2c 5d 8h Js Kd', HandCategory.HIGH_CARD],
  ])('%s is category %i', (hand, expected) => {
    expect(cat(hand)).toBe(expected)
  })

  it('does not wrap around K-A-2-3-4', () => {
    expect(cat('Kc Ad 2h 3s 4c')).toBe(HandCategory.HIGH_CARD)
  })
})

describe('ordering and kickers', () => {
  it('orders categories', () => {
    const hands = [
      '2c 5d 8h Js Kd', '7c 7d 3h 9s 2d', '7c 7d 9h 9s 2d', '7c 7d 7h 2s 9d', 'Ac 2d 3h 4s 5c',
      '2c 7c 9c Jc Kc', 'Qc Qd Qh 5s 5d', 'Kc Kd Kh Ks 2d', '9h 8h 7h 6h 5h', 'As Ks Qs Js Ts',
    ]
    for (let i = 1; i < hands.length; i++) expect(rank(hands[i]!)).toBeGreaterThan(rank(hands[i - 1]!))
  })
  it('wheel is the lowest straight', () => {
    expect(rank('Ac 2d 3h 4s 5c')).toBeLessThan(rank('2c 3d 4h 5s 6c'))
    expect(rank('Tc Jd Qh Ks Ac')).toBeGreaterThan(rank('9c Td Jh Qs Kc'))
  })
  it('compares pairs by pair rank then kickers', () => {
    expect(rank('9c 9d Ah 3s 2d')).toBeGreaterThan(rank('8c 8d Ah Ks Qd'))
    expect(rank('9c 9d Ah 3s 2d')).toBeGreaterThan(rank('9h 9s Kh 3c 2c'))
    expect(rank('9c 9d Ah 3s 2d')).toBe(rank('9h 9s Ad 3c 2c'))
  })
  it('two pair: high pair, low pair, kicker', () => {
    expect(rank('Ac Ad 2h 2s 3d')).toBeGreaterThan(rank('Kc Kd Qh Qs Jd'))
    expect(rank('Kc Kd Qh Qs Jd')).toBeGreaterThan(rank('Kh Ks Jh Js Ad'))
    expect(rank('Kc Kd Qh Qs Ad')).toBeGreaterThan(rank('Kh Ks Jh Js Ad'))
  })
  it('flush compares all five cards', () => {
    expect(rank('Ac Kc 9c 5c 2c')).toBeGreaterThan(rank('Ad Kd 8d 7d 6d'))
  })
  it('full house compares trips first', () => {
    expect(rank('3c 3d 3h As Ad')).toBeGreaterThan(rank('2c 2d 2h Ks Kd'))
  })
  it('quads compare quad rank then kicker', () => {
    expect(rank('5c 5d 5h 5s Ad')).toBeGreaterThan(rank('5c 5d 5h 5s Kd'))
  })
})

describe('evaluate with 7 and 8 cards', () => {
  it('picks the best 5 of 7', () => {
    const r = evaluate(parseCards('Ah Kh 2c 3d Qh Jh Th'))
    expect(r.category).toBe(HandCategory.ROYAL_FLUSH)
    expect(r.best).toHaveLength(5)
  })
  it('picks the best 5 of 8', () => {
    const r = evaluate(parseCards('2c 2d 2h 9s 9d 4c 7h Kd'))
    expect(r.category).toBe(HandCategory.FULL_HOUSE)
  })
  it('rejects fewer than 5 or more than 8 cards', () => {
    expect(() => evaluate(parseCards('Ah Kh 2c 3d'))).toThrow()
    expect(() => evaluate(parseCards('Ah Kh 2c 3d 4d 5d 6d 7d 8d'))).toThrow()
  })
  it('matches brute-force maximum over all 5-card subsets for random 7 and 8 card hands', () => {
    const rng = seededRng(99)
    for (let i = 0; i < 2000; i++) {
      const deck = shuffle(createDeck(), rng)
      for (const n of [7, 8]) {
        const cards = deck.slice(0, n)
        const brute = Math.max(...combinations(cards, 5).map(evaluate5))
        const r = evaluate(cards)
        expect(r.rank).toBe(brute)
        expect(categoryOf(r.rank)).toBe(r.category)
        expect(evaluate5(r.best)).toBe(r.rank)
      }
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/evaluator/combinations.ts`:
```ts
export function combinations<T>(items: readonly T[], k: number): T[][] {
  const out: T[][] = []
  const pick: T[] = []
  const walk = (start: number): void => {
    if (pick.length === k) {
      out.push(pick.slice())
      return
    }
    for (let i = start; i <= items.length - (k - pick.length); i++) {
      pick.push(items[i]!)
      walk(i + 1)
      pick.pop()
    }
  }
  walk(0)
  return out
}
```

`packages/core/src/evaluator/evaluator.ts`:
```ts
import { rankOf, suitOf, type Card } from '../cards/cards.js'
import { combinations } from './combinations.js'

export const HandCategory = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
  ROYAL_FLUSH: 9,
} as const
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory]

export const HAND_CATEGORY_KEYS = [
  'hand.highCard', 'hand.pair', 'hand.twoPair', 'hand.trips', 'hand.straight',
  'hand.flush', 'hand.fullHouse', 'hand.quads', 'hand.straightFlush', 'hand.royalFlush',
] as const

export interface HandEvaluation {
  rank: number
  category: HandCategory
  best: Card[]
}

const CATEGORY_BASE = 16 ** 5

function encode(category: HandCategory, kickers: number[]): number {
  let r = category
  for (let i = 0; i < 5; i++) r = r * 16 + (kickers[i] ?? 0)
  return r
}

export function categoryOf(rank: number): HandCategory {
  return Math.floor(rank / CATEGORY_BASE) as HandCategory
}

/** Rank of exactly five cards. Higher is better; equal means a tie. */
export function evaluate5(cards: readonly Card[]): number {
  if (cards.length !== 5) throw new Error('evaluate5 needs exactly 5 cards')
  const ranks = cards.map(rankOf).sort((a, b) => b - a)
  const isFlush = cards.every((c) => suitOf(c) === suitOf(cards[0]!))
  const counts = new Map<number, number>()
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1)
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])
  const uniq = [...counts.keys()].sort((a, b) => b - a)

  let straightHigh = -1
  if (uniq.length === 5) {
    if (uniq[0]! - uniq[4]! === 4) straightHigh = uniq[0]!
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[4] === 0) straightHigh = 3 // A-2-3-4-5, five high
  }

  const g = (i: number) => groups[i]![0]
  if (straightHigh >= 0 && isFlush) return encode(straightHigh === 12 ? HandCategory.ROYAL_FLUSH : HandCategory.STRAIGHT_FLUSH, [straightHigh])
  if (groups[0]![1] === 4) return encode(HandCategory.QUADS, [g(0), g(1)])
  if (groups[0]![1] === 3 && groups[1]![1] === 2) return encode(HandCategory.FULL_HOUSE, [g(0), g(1)])
  if (isFlush) return encode(HandCategory.FLUSH, ranks)
  if (straightHigh >= 0) return encode(HandCategory.STRAIGHT, [straightHigh])
  if (groups[0]![1] === 3) return encode(HandCategory.TRIPS, [g(0), g(1), g(2)])
  if (groups[0]![1] === 2 && groups[1]![1] === 2) return encode(HandCategory.TWO_PAIR, [g(0), g(1), g(2)])
  if (groups[0]![1] === 2) return encode(HandCategory.PAIR, [g(0), g(1), g(2), g(3)])
  return encode(HandCategory.HIGH_CARD, ranks)
}

/** Best five-card hand from 5..8 cards. */
export function evaluate(cards: readonly Card[]): HandEvaluation {
  if (cards.length < 5 || cards.length > 8) throw new Error(`evaluate needs 5..8 cards, got ${cards.length}`)
  let bestRank = -1
  let best: Card[] = []
  for (const combo of combinations(cards, 5)) {
    const r = evaluate5(combo)
    if (r > bestRank) {
      bestRank = r
      best = combo
    }
  }
  return { rank: bestRank, category: categoryOf(bestRank), best }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './evaluator/combinations.js'
export * from './evaluator/evaluator.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test`
Expected: all pass (the brute-force test runs 4000 evaluations; should finish in < 5 s).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): poker hand evaluator for 5-8 cards

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Pot computation, distribution, table fee

**Files:**
- Create: `packages/core/src/betting/pots.ts`, `packages/core/src/betting/pots.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `interface PotContributor { seat: number; totalCommitted: number; folded: boolean }`
  - `interface Pot { amount: number; eligibleSeats: number[] }`
  - `computePots(players: readonly PotContributor[]): Pot[]` — layered side pots, adjacent pots with identical eligible sets merged
  - `interface PotResult { amount: number; eligibleSeats: number[]; winners: { seat: number; amount: number }[] }`
  - `distributePots(pots: readonly Pot[], rankBySeat: ReadonlyMap<number, number>, seatOrder: readonly number[], button: number): PotResult[]` — split ties evenly; odd chips go one each to winners in clockwise order starting from the first seat after `button`
  - `tableFee(totalPot: number, rate: number, cap?: number): number` = `min(floor(totalPot × rate), cap ?? ∞)`
  - `clockwiseFrom(seatOrder: readonly number[], afterSeat: number): number[]` — seats in clockwise order starting with the seat after `afterSeat`

- [ ] **Step 1: Write failing tests**

`packages/core/src/betting/pots.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { clockwiseFrom, computePots, distributePots, tableFee } from './pots.js'

describe('computePots', () => {
  it('single pot when everyone committed equally', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 100, folded: false },
      { seat: 1, totalCommitted: 100, folded: false },
      { seat: 2, totalCommitted: 100, folded: true },
    ])
    expect(pots).toEqual([{ amount: 300, eligibleSeats: [0, 1] }])
  })
  it('creates side pots for uneven all-ins', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 50, folded: false },   // short all-in
      { seat: 1, totalCommitted: 200, folded: false },
      { seat: 2, totalCommitted: 200, folded: false },
      { seat: 3, totalCommitted: 120, folded: true },   // folded after committing 120
    ])
    expect(pots).toEqual([
      { amount: 200, eligibleSeats: [0, 1, 2] },           // 50 × 4
      { amount: 370, eligibleSeats: [1, 2] },              // (120-50)×3 + (200-120)×2 = 210 + 160, merged (same eligible set)
    ])
  })
  it('ignores zero contributions', () => {
    expect(computePots([{ seat: 0, totalCommitted: 0, folded: false }])).toEqual([])
  })
  it('falls back to all unfolded seats when a layer has no eligible player', () => {
    const pots = computePots([
      { seat: 0, totalCommitted: 100, folded: false },
      { seat: 1, totalCommitted: 300, folded: true },
    ])
    expect(pots).toEqual([{ amount: 400, eligibleSeats: [0] }])
  })
})

describe('distributePots', () => {
  const ranks = new Map<number, number>([[0, 10], [1, 20], [2, 20], [3, 5]])
  it('gives the pot to the single best eligible seat', () => {
    const res = distributePots([{ amount: 300, eligibleSeats: [0, 3] }], ranks, [0, 1, 2, 3], 3)
    expect(res[0]!.winners).toEqual([{ seat: 0, amount: 300 }])
  })
  it('splits ties and hands odd chips clockwise from the button', () => {
    const res = distributePots([{ amount: 301, eligibleSeats: [0, 1, 2] }], ranks, [0, 1, 2, 3], 1)
    // winners 1 and 2 tie; first seat after button(1) is 2 → gets the odd chip
    expect(res[0]!.winners).toEqual([{ seat: 2, amount: 151 }, { seat: 1, amount: 150 }])
  })
  it('handles several pots with different eligibility', () => {
    const res = distributePots(
      [{ amount: 200, eligibleSeats: [0, 1, 2] }, { amount: 370, eligibleSeats: [1, 2] }],
      new Map([[0, 99], [1, 20], [2, 20]]), [0, 1, 2, 3], 0)
    expect(res[0]!.winners).toEqual([{ seat: 0, amount: 200 }])
    expect(res[1]!.winners).toEqual([{ seat: 1, amount: 185 }, { seat: 2, amount: 185 }])
  })
})

describe('tableFee', () => {
  it('rounds down and applies the cap', () => {
    expect(tableFee(15000, 0.02)).toBe(300)
    expect(tableFee(15001, 0.02)).toBe(300)
    expect(tableFee(15000, 0.02, 200)).toBe(200)
    expect(tableFee(10, 0.02)).toBe(0)
  })
})

describe('clockwiseFrom', () => {
  it('starts after the given seat and wraps', () => {
    expect(clockwiseFrom([0, 2, 5, 7], 5)).toEqual([7, 0, 2, 5])
    expect(clockwiseFrom([0, 2, 5, 7], 7)).toEqual([0, 2, 5, 7])
    expect(clockwiseFrom([0, 2, 5, 7], 3)).toEqual([5, 7, 0, 2]) // afterSeat not present: next higher seat
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`packages/core/src/betting/pots.ts`:
```ts
export interface PotContributor {
  seat: number
  totalCommitted: number
  folded: boolean
}

export interface Pot {
  amount: number
  eligibleSeats: number[]
}

export interface PotResult extends Pot {
  winners: { seat: number; amount: number }[]
}

const sameSet = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** Seats in clockwise order beginning with the first seat strictly after `afterSeat` (wrapping). */
export function clockwiseFrom(seatOrder: readonly number[], afterSeat: number): number[] {
  const sorted = [...seatOrder].sort((a, b) => a - b)
  const idx = sorted.findIndex((s) => s > afterSeat)
  if (idx < 0) return sorted
  return [...sorted.slice(idx), ...sorted.slice(0, idx)]
}

/** Layered main/side pots. Folded players' chips stay in the pots they reached. */
export function computePots(players: readonly PotContributor[]): Pot[] {
  const levels = [...new Set(players.filter((p) => p.totalCommitted > 0).map((p) => p.totalCommitted))].sort((a, b) => a - b)
  const unfolded = players.filter((p) => !p.folded).map((p) => p.seat).sort((a, b) => a - b)
  const pots: Pot[] = []
  let prev = 0
  for (const level of levels) {
    let amount = 0
    const eligible: number[] = []
    for (const p of players) {
      amount += Math.max(0, Math.min(p.totalCommitted, level) - Math.min(p.totalCommitted, prev))
      if (!p.folded && p.totalCommitted >= level) eligible.push(p.seat)
    }
    eligible.sort((a, b) => a - b)
    const elig = eligible.length > 0 ? eligible : unfolded
    if (amount > 0) {
      const last = pots[pots.length - 1]
      if (last && sameSet(last.eligibleSeats, elig)) last.amount += amount
      else pots.push({ amount, eligibleSeats: elig })
    }
    prev = level
  }
  return pots
}

/** Splits each pot among its best-ranked eligible seats; odd chips clockwise from the button. */
export function distributePots(
  pots: readonly Pot[],
  rankBySeat: ReadonlyMap<number, number>,
  seatOrder: readonly number[],
  button: number,
): PotResult[] {
  const order = clockwiseFrom(seatOrder, button)
  return pots.map((pot) => {
    const ranked = pot.eligibleSeats.filter((s) => rankBySeat.has(s))
    const bestRank = Math.max(...ranked.map((s) => rankBySeat.get(s)!))
    const winnersInOrder = order.filter((s) => ranked.includes(s) && rankBySeat.get(s) === bestRank)
    const share = Math.floor(pot.amount / winnersInOrder.length)
    let remainder = pot.amount - share * winnersInOrder.length
    const winners = winnersInOrder.map((seat) => {
      const extra = remainder > 0 ? 1 : 0
      remainder -= extra
      return { seat, amount: share + extra }
    })
    return { amount: pot.amount, eligibleSeats: [...pot.eligibleSeats], winners }
  })
}

export function tableFee(totalPot: number, rate: number, cap?: number): number {
  const fee = Math.floor(totalPot * rate)
  return cap === undefined ? fee : Math.min(fee, cap)
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './betting/pots.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test`
Expected: all pass. Note the tie test: winners are listed in clockwise order from the button, so `[{seat:2,151},{seat:1,150}]`.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): side pots, distribution and table fee

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 5: Hand engine types and shared helpers

**Files:**
- Create: `packages/core/src/hand/types.ts`, `packages/core/src/hand/common.ts`, `packages/core/src/hand/common.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces (used verbatim by Tasks 6–10): everything in `types.ts` below, plus helpers in `common.ts`:
  - `clone<T>(s: T): T`
  - `getPlayer(state, seat): HandPlayer` (throws `EngineError('NOT_IN_HAND')`)
  - `canAct(p: HandPlayer): boolean` = `!p.folded && !p.allIn`
  - `unfolded(state): HandPlayer[]`
  - `seatsClockwiseFrom(state, afterSeat): HandPlayer[]`
  - `commit(state, p, amount): number` — moves `min(amount, p.stack)` from stack to `betThisStreet`/`totalCommitted`/`state.pot`, sets `allIn` when stack reaches 0, returns actual amount
  - `dealCards(state, n): Card[]`
  - `revealNext(state, events): void` — pops `revealQueue`, deals 3/1/1 to `community`, sets `street`, emits `COMMUNITY_REVEALED`
  - `settle(state, events, opts: { showdown: boolean; feeCap?: number }): void` — computes pots (adds `carryOverIn` to the main pot), fee, ranks, distribution; writes `state.result`, updates stacks, sets `phase = 'COMPLETE'`, emits `SHOWDOWN?`, `SETTLEMENT`, `HAND_COMPLETE`
  - `carryOverAll(state, events): void` — Blind mode B with zero players: whole pot becomes `carryOverOut`, no fee

- [ ] **Step 1: Write `types.ts`**

`packages/core/src/hand/types.ts`:
```ts
import type { Card } from '../cards/cards.js'
import type { PotResult } from '../betting/pots.js'
import type { HandCategory } from '../evaluator/evaluator.js'

export interface HoldemRules {
  mode: 'holdem'
  smallBlind: number
  bigBlind: number
  tableFeeRate: number
  /** Fee cap expressed in big blinds. */
  tableFeeCapBB: number
}

export interface BlindRules {
  mode: 'blind'
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  tableFeeRate: number
}

export type Ruleset = HoldemRules | BlindRules
export type GameMode = Ruleset['mode']

export interface SeatInput {
  seat: number
  playerId: string
  stack: number
  isBot: boolean
}

export type Street = 'PREFLOP' | 'FLOP' | 'TURN' | 'RIVER'
export type HandPhase = 'BETTING' | 'DECISION' | 'REVEAL' | 'COMPLETE'
export type Decision = 'play' | 'fold'

export interface HandPlayer {
  seat: number
  playerId: string
  isBot: boolean
  stack: number
  holeCards: Card[]
  betThisStreet: number
  totalCommitted: number
  folded: boolean
  allIn: boolean
  /** Has acted in the current betting street (reset on every full raise / new street). */
  hasActed: boolean
  /** Set when a short all-in raise happened after this player already acted: may call/fold only. */
  cannotRaise: boolean
  /** Blind mode B decision, hidden from others until DECISIONS_REVEALED. */
  decision: Decision | null
}

export type ActionKind = 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'allIn' | 'play'
export type PlayerAction = { kind: 'fold' | 'check' | 'call' | 'allIn' | 'play' } | { kind: 'bet' | 'raise'; amount: number }

export interface LegalActions {
  seat: number
  kinds: ActionKind[]
  /** Chips required to call (already capped at the player's stack). */
  callAmount: number
  /** Valid totals for `bet` (amount put in this street). */
  minBet: number
  maxBet: number
  /** Valid totals for `raise` ("raise to" amount this street). */
  minRaiseTo: number
  maxRaiseTo: number
}

export type HandCommand =
  | { type: 'ACTION'; seat: number; action: PlayerAction }
  | { type: 'TIMEOUT'; seat: number }
  | { type: 'ADVANCE' }

export interface ShowdownHand {
  seat: number
  cards: Card[]
  rank: number
  category: HandCategory
  best: Card[]
}

export interface HandResult {
  pots: PotResult[]
  fee: number
  payouts: { seat: number; amount: number }[]
  stacks: { seat: number; stack: number }[]
  showdown: ShowdownHand[] | null
  carryOverOut: number
}

export interface HandState {
  handId: string
  rules: Ruleset
  phase: HandPhase
  /** Sorted by seat. */
  players: HandPlayer[]
  deck: Card[]
  deckIndex: number
  community: Card[]
  button: number
  street: Street
  actingSeat: number | null
  /** Increments on every TURN_CHANGED / DECISION_PHASE; timers must carry it. */
  turnSeq: number
  currentBet: number
  minRaise: number
  pot: number
  carryOverIn: number
  revealQueue: Street[]
  result: HandResult | null
}

export type GameEvent =
  | { type: 'HAND_STARTED'; handId: string; mode: GameMode; button: number; seats: number[]; carryOverIn: number }
  | { type: 'BLINDS_POSTED'; posts: { seat: number; amount: number; kind: 'SB' | 'BB' | 'ANTE' }[] }
  | { type: 'CARDS_DEALT'; seat: number; cards: Card[] }
  | { type: 'TURN_CHANGED'; seat: number; turnSeq: number; legal: LegalActions }
  | { type: 'PLAYER_ACTED'; seat: number; action: PlayerAction; amount: number; stack: number; allIn: boolean; timedOut: boolean }
  | { type: 'DECISION_PHASE'; seats: number[]; turnSeq: number }
  | { type: 'DECISION_MADE'; seat: number }
  | { type: 'DECISIONS_REVEALED'; decisions: { seat: number; decision: Decision }[] }
  | { type: 'COMMUNITY_REVEALED'; street: Street; cards: Card[]; community: Card[] }
  | { type: 'POT_UPDATED'; pot: number }
  | { type: 'SHOWDOWN'; hands: ShowdownHand[] }
  | { type: 'SETTLEMENT'; payouts: { seat: number; amount: number }[]; fee: number; pots: PotResult[]; carryOverOut: number; stacks: { seat: number; stack: number }[] }
  | { type: 'HAND_COMPLETE' }

export interface EngineResult {
  state: HandState
  events: GameEvent[]
}

export type EngineErrorCode = 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION' | 'INVALID_AMOUNT' | 'NOT_IN_HAND' | 'HAND_COMPLETE' | 'INVALID_COMMAND' | 'INVALID_SETUP'

export class EngineError extends Error {
  constructor(
    public readonly code: EngineErrorCode,
    message?: string,
  ) {
    super(message === undefined ? code : `${code}: ${message}`)
    this.name = 'EngineError'
  }
}
```

- [ ] **Step 2: Write failing tests for `common.ts`**

`packages/core/src/hand/common.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseCards } from '../cards/cards.js'
import { HandCategory } from '../evaluator/evaluator.js'
import { canAct, carryOverAll, commit, dealCards, revealNext, seatsClockwiseFrom, settle } from './common.js'
import type { GameEvent, HandPlayer, HandState } from './types.js'

function player(seat: number, stack: number, extra: Partial<HandPlayer> = {}): HandPlayer {
  return {
    seat, playerId: `p${seat}`, isBot: false, stack, holeCards: [], betThisStreet: 0, totalCommitted: 0,
    folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null, ...extra,
  }
}

function baseState(players: HandPlayer[], extra: Partial<HandState> = {}): HandState {
  return {
    handId: 'h1', rules: { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 },
    phase: 'BETTING', players, deck: parseCards('2c 3c 4c 5c 6c 7c 8c 9c Tc Jc Qc Kc Ac 2d 3d'), deckIndex: 0,
    community: [], button: 0, street: 'PREFLOP', actingSeat: null, turnSeq: 0, currentBet: 0, minRaise: 100,
    pot: 0, carryOverIn: 0, revealQueue: [], result: null, ...extra,
  }
}

describe('commit', () => {
  it('moves chips and flags all-in', () => {
    const p = player(0, 100)
    const s = baseState([p])
    expect(commit(s, p, 30)).toBe(30)
    expect(p.stack).toBe(70)
    expect(p.betThisStreet).toBe(30)
    expect(p.totalCommitted).toBe(30)
    expect(s.pot).toBe(30)
    expect(commit(s, p, 500)).toBe(70)
    expect(p.allIn).toBe(true)
    expect(canAct(p)).toBe(false)
  })
})

describe('dealCards / revealNext', () => {
  it('deals from deckIndex and reveals streets in order', () => {
    const s = baseState([player(0, 100)], { revealQueue: ['FLOP', 'TURN', 'RIVER'], phase: 'REVEAL' })
    expect(dealCards(s, 2)).toEqual(parseCards('2c 3c'))
    const events: GameEvent[] = []
    revealNext(s, events)
    expect(s.community).toEqual(parseCards('4c 5c 6c'))
    expect(s.street).toBe('FLOP')
    revealNext(s, events)
    revealNext(s, events)
    expect(s.community).toHaveLength(5)
    expect(s.street).toBe('RIVER')
    expect(s.revealQueue).toEqual([])
    expect(events.map((e) => e.type)).toEqual(['COMMUNITY_REVEALED', 'COMMUNITY_REVEALED', 'COMMUNITY_REVEALED'])
  })
})

describe('seatsClockwiseFrom', () => {
  it('wraps around the table', () => {
    const s = baseState([player(1, 1), player(4, 1), player(7, 1)])
    expect(seatsClockwiseFrom(s, 4).map((p) => p.seat)).toEqual([7, 1, 4])
  })
})

describe('settle', () => {
  it('pays the single unfolded player without showdown and takes the fee', () => {
    const a = player(0, 900, { totalCommitted: 100 })
    const b = player(1, 800, { totalCommitted: 200, folded: true })
    const s = baseState([a, b], { pot: 300 })
    const events: GameEvent[] = []
    settle(s, events, { showdown: false, feeCap: 100 })
    expect(s.phase).toBe('COMPLETE')
    expect(s.result!.fee).toBe(6)
    expect(a.stack).toBe(900 + 294)
    expect(s.result!.showdown).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['SETTLEMENT', 'HAND_COMPLETE'])
  })
  it('runs a showdown, splits ties, and includes carry-over in the main pot', () => {
    const a = player(0, 0, { totalCommitted: 100, holeCards: parseCards('Ah Kh') })
    const b = player(1, 0, { totalCommitted: 100, holeCards: parseCards('Ad Kd') })
    const c = player(2, 0, { totalCommitted: 100, holeCards: parseCards('2h 3d') })
    const s = baseState([a, b, c], { pot: 300 + 100, carryOverIn: 100, community: parseCards('Qc Jc 7s 8d 9s') })
    s.rules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 100, tableFeeRate: 0.02 }
    const events: GameEvent[] = []
    settle(s, events, { showdown: true })
    // total 400, fee 8, 392 split between a and b: 196 each
    expect(s.result!.fee).toBe(8)
    expect(a.stack).toBe(196)
    expect(b.stack).toBe(196)
    expect(c.stack).toBe(0)
    expect(s.result!.showdown!.map((h) => h.category)).toEqual([HandCategory.HIGH_CARD, HandCategory.HIGH_CARD, HandCategory.HIGH_CARD])
    expect(events.map((e) => e.type)).toEqual(['SHOWDOWN', 'SETTLEMENT', 'HAND_COMPLETE'])
  })
})

describe('carryOverAll', () => {
  it('moves the whole pot to carryOverOut with no fee', () => {
    const a = player(0, 900, { totalCommitted: 100 })
    const s = baseState([a], { pot: 250, carryOverIn: 150 })
    const events: GameEvent[] = []
    carryOverAll(s, events)
    expect(s.result!.carryOverOut).toBe(250)
    expect(s.result!.fee).toBe(0)
    expect(a.stack).toBe(900)
    expect(s.phase).toBe('COMPLETE')
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — `./common.js` not found.

- [ ] **Step 4: Implement `common.ts`**

`packages/core/src/hand/common.ts`:
```ts
import type { Card } from '../cards/cards.js'
import { computePots, distributePots, tableFee } from '../betting/pots.js'
import { evaluate } from '../evaluator/evaluator.js'
import { EngineError, type GameEvent, type HandPlayer, type HandState, type ShowdownHand, type Street } from './types.js'

export function clone<T>(s: T): T {
  return structuredClone(s)
}

export function getPlayer(state: HandState, seat: number): HandPlayer {
  const p = state.players.find((x) => x.seat === seat)
  if (!p) throw new EngineError('NOT_IN_HAND', `seat ${seat} is not in this hand`)
  return p
}

export const canAct = (p: HandPlayer): boolean => !p.folded && !p.allIn

export const unfolded = (state: HandState): HandPlayer[] => state.players.filter((p) => !p.folded)

/** Players in clockwise order starting with the first seat strictly after `afterSeat`. */
export function seatsClockwiseFrom(state: HandState, afterSeat: number): HandPlayer[] {
  const idx = state.players.findIndex((p) => p.seat > afterSeat)
  if (idx < 0) return state.players.slice()
  return [...state.players.slice(idx), ...state.players.slice(0, idx)]
}

export function commit(state: HandState, p: HandPlayer, amount: number): number {
  const actual = Math.min(amount, p.stack)
  p.stack -= actual
  p.betThisStreet += actual
  p.totalCommitted += actual
  state.pot += actual
  if (p.stack === 0) p.allIn = true
  return actual
}

export function dealCards(state: HandState, n: number): Card[] {
  const cards = state.deck.slice(state.deckIndex, state.deckIndex + n)
  if (cards.length !== n) throw new EngineError('INVALID_SETUP', 'deck exhausted')
  state.deckIndex += n
  return cards
}

const STREET_CARDS: Record<Street, number> = { PREFLOP: 0, FLOP: 3, TURN: 1, RIVER: 1 }

export function revealNext(state: HandState, events: GameEvent[]): void {
  const street = state.revealQueue.shift()
  if (!street) throw new EngineError('INVALID_COMMAND', 'nothing to reveal')
  const cards = dealCards(state, STREET_CARDS[street])
  state.community.push(...cards)
  state.street = street
  events.push({ type: 'COMMUNITY_REVEALED', street, cards, community: state.community.slice() })
}

export function settle(state: HandState, events: GameEvent[], opts: { showdown: boolean; feeCap?: number }): void {
  const pots = computePots(state.players.map((p) => ({ seat: p.seat, totalCommitted: p.totalCommitted, folded: p.folded })))
  if (pots.length === 0) throw new EngineError('INVALID_SETUP', 'no pot to settle')
  pots[0]!.amount += state.carryOverIn

  const total = pots.reduce((a, p) => a + p.amount, 0)
  const fee = Math.min(tableFee(total, state.rules.tableFeeRate, opts.feeCap), pots[0]!.amount)
  pots[0]!.amount -= fee

  const live = unfolded(state)
  const rankBySeat = new Map<number, number>()
  let showdown: ShowdownHand[] | null = null
  if (opts.showdown && live.length > 1) {
    showdown = live.map((p) => {
      const cards = [...p.holeCards, ...state.community]
      const ev = evaluate(cards)
      rankBySeat.set(p.seat, ev.rank)
      return { seat: p.seat, cards: p.holeCards.slice(), rank: ev.rank, category: ev.category, best: ev.best }
    })
  } else {
    for (const p of live) rankBySeat.set(p.seat, 1)
  }

  const results = distributePots(pots.filter((p) => p.amount > 0), rankBySeat, state.players.map((p) => p.seat), state.button)
  const payoutBySeat = new Map<number, number>()
  for (const r of results) for (const w of r.winners) payoutBySeat.set(w.seat, (payoutBySeat.get(w.seat) ?? 0) + w.amount)
  for (const [seat, amount] of payoutBySeat) getPlayer(state, seat).stack += amount

  const payouts = [...payoutBySeat].map(([seat, amount]) => ({ seat, amount })).sort((a, b) => a.seat - b.seat)
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: results, fee, payouts, stacks, showdown, carryOverOut: 0 }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  if (showdown) events.push({ type: 'SHOWDOWN', hands: showdown })
  events.push({ type: 'SETTLEMENT', payouts, fee, pots: results, carryOverOut: 0, stacks })
  events.push({ type: 'HAND_COMPLETE' })
}

export function carryOverAll(state: HandState, events: GameEvent[]): void {
  const stacks = state.players.map((p) => ({ seat: p.seat, stack: p.stack }))
  state.result = { pots: [], fee: 0, payouts: [], stacks, showdown: null, carryOverOut: state.pot }
  state.phase = 'COMPLETE'
  state.actingSeat = null
  events.push({ type: 'SETTLEMENT', payouts: [], fee: 0, pots: [], carryOverOut: state.pot, stacks })
  events.push({ type: 'HAND_COMPLETE' })
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './hand/types.js'
```
(`common.ts` stays internal.)

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck`
Expected: pass. Note `structuredClone` is a global in Node 22 — no import.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): hand engine types and shared settlement helpers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: No-Limit Hold'em hand engine

**Files:**
- Create: `packages/core/src/hand/holdem.ts`, `packages/core/src/hand/holdem.test.ts`

**Interfaces:**
- Consumes: Task 5 types and helpers; Task 2 `shuffle`, `createDeck`, `Rng`.
- Produces:
  - `interface CreateHoldemInput { handId: string; rules: HoldemRules; seats: SeatInput[]; button: number }`
  - `createHoldemHand(input: CreateHoldemInput, rng: Rng): EngineResult`
  - `holdemLegalActions(state: HandState, seat: number): LegalActions`
  - `applyHoldemCommand(state: HandState, cmd: HandCommand, rng: Rng): EngineResult` (pure; throws `EngineError`)

Rules implemented (spec §7): blinds (heads-up button = SB), dealing clockwise from button, min-bet = BB, min-raise = last full raise increment, short all-in raise does not reopen action for players who already acted (`cannotRaise`), BB option, fold-to-one ends the hand without showdown, run-out (`REVEAL` + `ADVANCE`) when ≤ 1 player can still act, showdown best-5-of-7, fee = `min(floor(total × rate), tableFeeCapBB × BB)`, timeout = check if legal else fold.

- [ ] **Step 1: Write failing tests**

`packages/core/src/hand/holdem.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Rng } from '../cards/rng.js'
import { seededRng } from '../cards/rng.js'
import { applyHoldemCommand, createHoldemHand, holdemLegalActions } from './holdem.js'
import { EngineError, type GameEvent, type HandState, type HoldemRules, type PlayerAction } from './types.js'

const RULES: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
/** Fisher–Yates with j = i is the identity: deck stays 2c 3c 4c … so showdowns are predictable. */
const identityRng: Rng = { int: (n) => n - 1 }

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly startStacks: number
  constructor(stacks: number[], button = 0, rng: Rng = seededRng(1)) {
    const seats = stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
    const r = createHoldemHand({ handId: 'h1', rules: RULES, seats, button }, rng)
    this.state = r.state
    this.events.push(...r.events)
    this.startStacks = stacks.reduce((a, b) => a + b, 0)
  }
  act(seat: number, kind: PlayerAction['kind'], amount?: number) {
    const action = (amount === undefined ? { kind } : { kind, amount }) as PlayerAction
    const r = applyHoldemCommand(this.state, { type: 'ACTION', seat, action }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  timeout(seat: number) {
    const r = applyHoldemCommand(this.state, { type: 'TIMEOUT', seat }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  advance() {
    const r = applyHoldemCommand(this.state, { type: 'ADVANCE' }, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  legal(seat: number) {
    return holdemLegalActions(this.state, seat)
  }
  stack(seat: number) {
    return this.state.players.find((p) => p.seat === seat)!.stack
  }
  assertMoney() {
    const after = this.state.players.reduce((a, p) => a + p.stack, 0)
    expect(after + (this.state.result?.fee ?? 0) + this.state.pot * (this.state.phase === 'COMPLETE' ? 0 : 1)).toBe(this.startStacks)
  }
  types() {
    return this.events.map((e) => e.type)
  }
}

describe('createHoldemHand', () => {
  it('posts blinds, deals two cards each, and gives action to the seat after the BB', () => {
    const t = new Table([1000, 1000, 1000], 0)
    expect(t.state.players.every((p) => p.holeCards.length === 2)).toBe(true)
    expect(t.stack(1)).toBe(950)
    expect(t.stack(2)).toBe(900)
    expect(t.state.pot).toBe(150)
    expect(t.state.currentBet).toBe(100)
    expect(t.state.actingSeat).toBe(0)
    expect(t.types()).toEqual(['HAND_STARTED', 'CARDS_DEALT', 'CARDS_DEALT', 'CARDS_DEALT', 'BLINDS_POSTED', 'POT_UPDATED', 'TURN_CHANGED'])
  })
  it('heads-up: button posts SB and acts first preflop', () => {
    const t = new Table([1000, 1000], 1)
    expect(t.stack(1)).toBe(950)
    expect(t.stack(0)).toBe(900)
    expect(t.state.actingSeat).toBe(1)
    t.act(1, 'call')
    t.act(0, 'check')
    expect(t.state.street).toBe('FLOP')
    expect(t.state.actingSeat).toBe(0) // non-button acts first postflop
  })
  it('does not mutate the caller state', () => {
    const t = new Table([1000, 1000, 1000])
    const before = structuredClone(t.state)
    applyHoldemCommand(t.state, { type: 'ACTION', seat: 0, action: { kind: 'fold' } }, identityRng)
    expect(t.state).toEqual(before)
  })
  it('rejects fewer than two players or empty stacks', () => {
    expect(() => new Table([1000])).toThrow(EngineError)
    expect(() => new Table([1000, 0])).toThrow(EngineError)
  })
})

describe('legal actions', () => {
  it('offers call/raise/allIn/fold when facing a bet, check/bet when not', () => {
    const t = new Table([1000, 1000, 1000])
    expect(t.legal(0)).toEqual({ seat: 0, kinds: ['fold', 'call', 'raise', 'allIn'], callAmount: 100, minBet: 0, maxBet: 0, minRaiseTo: 200, maxRaiseTo: 1000 })
    t.act(0, 'call')
    t.act(1, 'call')
    expect(t.legal(2).kinds).toEqual(['fold', 'check', 'raise', 'allIn']) // BB option: raise, not bet
    t.act(2, 'check')
    expect(t.legal(1)).toEqual({ seat: 1, kinds: ['fold', 'check', 'bet', 'allIn'], callAmount: 0, minBet: 100, maxBet: 900, minRaiseTo: 0, maxRaiseTo: 0 })
  })
})

describe('betting rules', () => {
  it('everyone folds to the BB: BB wins without showdown, fee taken', () => {
    const t = new Table([1000, 1000, 1000])
    t.act(0, 'fold')
    t.act(1, 'fold')
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.showdown).toBeNull()
    expect(t.state.result!.fee).toBe(3)
    expect(t.stack(2)).toBe(1047)
    t.assertMoney()
  })
  it('enforces min-raise = last raise increment and rejects smaller raises', () => {
    const t = new Table([5000, 5000, 5000])
    t.act(0, 'raise', 300)
    expect(t.legal(1).minRaiseTo).toBe(500)
    expect(() => t.act(1, 'raise', 450)).toThrow(/INVALID_AMOUNT/)
    t.act(1, 'raise', 800) // increment 500
    expect(t.legal(2).minRaiseTo).toBe(1300)
    expect(t.state.minRaise).toBe(500)
  })
  it('a short all-in raise does not reopen raising for players who already acted', () => {
    const t = new Table([1000, 1000, 400])
    t.act(0, 'raise', 300)
    t.act(1, 'call')
    t.act(2, 'allIn') // total 400: increment 100 < min raise 300
    expect(t.state.currentBet).toBe(400)
    expect(t.state.actingSeat).toBe(0)
    expect(t.legal(0).kinds).toEqual(['fold', 'call'])
    t.act(0, 'call')
    expect(t.legal(1).kinds).toEqual(['fold', 'call'])
    t.act(1, 'call')
    expect(t.state.street).toBe('FLOP')
    expect(t.state.phase).toBe('BETTING') // seats 0 and 1 can still bet
    expect(t.legal(1).kinds).toContain('bet') // seat 1 (first after the button) opens the flop
  })
  it('a full raise reopens action for everyone', () => {
    const t = new Table([5000, 5000, 5000])
    t.act(0, 'raise', 300)
    t.act(1, 'call')
    t.act(2, 'raise', 900)
    expect(t.legal(0).kinds).toContain('raise')
    expect(t.state.actingSeat).toBe(0)
  })
  it('rejects out-of-turn and illegal actions', () => {
    const t = new Table([1000, 1000, 1000])
    expect(() => t.act(1, 'call')).toThrow(/NOT_YOUR_TURN/)
    expect(() => t.act(0, 'check')).toThrow(/ILLEGAL_ACTION/)
    expect(() => t.act(0, 'bet', 300)).toThrow(/ILLEGAL_ACTION/)
    expect(() => t.act(0, 'raise', 5000)).toThrow(/INVALID_AMOUNT/)
    expect(() => t.advance()).toThrow(/INVALID_COMMAND/)
  })
  it('timeout checks when possible, otherwise folds', () => {
    const t = new Table([1000, 1000, 1000])
    t.timeout(0)
    expect(t.state.players[0]!.folded).toBe(true)
    t.act(1, 'call')
    const ev = t.timeout(2)
    expect(ev[0]).toMatchObject({ type: 'PLAYER_ACTED', seat: 2, action: { kind: 'check' }, timedOut: true })
    expect(t.state.street).toBe('FLOP')
  })
})

describe('streets, run-out and showdown', () => {
  it('check-around reaches showdown through all streets', () => {
    const t = new Table([1000, 1000, 1000])
    t.act(0, 'call'); t.act(1, 'call'); t.act(2, 'check')
    for (const street of ['FLOP', 'TURN', 'RIVER']) {
      expect(t.state.street).toBe(street)
      t.act(1, 'check'); t.act(2, 'check'); t.act(0, 'check')
    }
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.showdown).toHaveLength(3)
    expect(t.types().filter((x) => x === 'COMMUNITY_REVEALED')).toHaveLength(3)
    expect(t.types().slice(-3)).toEqual(['SHOWDOWN', 'SETTLEMENT', 'HAND_COMPLETE'])
    t.assertMoney()
  })
  it('all-in preflop and called → REVEAL phase driven by ADVANCE', () => {
    const t = new Table([1000, 1000], 0)
    t.act(0, 'allIn')
    t.act(1, 'call')
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.revealQueue).toEqual(['FLOP', 'TURN', 'RIVER'])
    t.advance(); t.advance()
    expect(t.state.phase).toBe('REVEAL')
    t.advance()
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(5)
    t.assertMoney()
  })
  it('side pots: short all-in, ties split with odd chip after the button', () => {
    // identity deck: seat1 gets 2c 5c, seat2 3c 6c, seat0 4c 7c; board 8c 9c Tc Jc Qc → everyone plays the board straight flush
    const t = new Table([1000, 1000, 400], 0, identityRng)
    t.act(0, 'raise', 300); t.act(1, 'call'); t.act(2, 'allIn'); t.act(0, 'call'); t.act(1, 'call')
    t.act(1, 'bet', 200); t.act(0, 'call') // flop
    t.act(1, 'check'); t.act(0, 'check')   // turn
    t.act(1, 'check'); t.act(0, 'check')   // river
    const r = t.state.result!
    expect(r.pots.map((p) => [p.amount, p.eligibleSeats])).toEqual([[1200 - 32, [0, 1, 2]], [400, [0, 1]]])
    expect(r.fee).toBe(32)
    // main 1168 / 3 = 389 r1 → odd chip to seat 1 (first after button 0); side 400 / 2 = 200
    expect(t.stack(1)).toBe(1000 - 600 + 390 + 200)
    expect(t.stack(0)).toBe(1000 - 600 + 389 + 200)
    expect(t.stack(2)).toBe(389)
    t.assertMoney()
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — `./holdem.js` not found.

- [ ] **Step 3: Implement**

`packages/core/src/hand/holdem.ts`:
```ts
import { createDeck } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { canAct, clone, commit, dealCards, getPlayer, revealNext, seatsClockwiseFrom, settle, unfolded } from './common.js'
import {
  EngineError,
  type ActionKind, type EngineResult, type GameEvent, type HandCommand, type HandPlayer, type HandState,
  type HoldemRules, type LegalActions, type PlayerAction, type SeatInput, type Street,
} from './types.js'

export interface CreateHoldemInput {
  handId: string
  rules: HoldemRules
  seats: SeatInput[]
  button: number
}

const NEXT_STREET: Record<Street, Street | null> = { PREFLOP: 'FLOP', FLOP: 'TURN', TURN: 'RIVER', RIVER: null }

const rulesOf = (state: HandState): HoldemRules => {
  if (state.rules.mode !== 'holdem') throw new EngineError('INVALID_COMMAND', 'not a holdem hand')
  return state.rules
}
const feeCap = (state: HandState): number => rulesOf(state).tableFeeCapBB * rulesOf(state).bigBlind
const needsAction = (state: HandState, p: HandPlayer): boolean => canAct(p) && (!p.hasActed || p.betThisStreet < state.currentBet)

export function createHoldemHand(input: CreateHoldemInput, rng: Rng): EngineResult {
  const seats = [...input.seats].sort((a, b) => a.seat - b.seat)
  if (seats.length < 2) throw new EngineError('INVALID_SETUP', 'need at least 2 players')
  if (seats.some((s) => s.stack <= 0)) throw new EngineError('INVALID_SETUP', 'every player needs chips')
  if (!seats.some((s) => s.seat === input.button)) throw new EngineError('INVALID_SETUP', 'button must be a seated player')

  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: 'BETTING',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null,
    })),
    deck: shuffle(createDeck(), rng),
    deckIndex: 0,
    community: [],
    button: input.button,
    street: 'PREFLOP',
    actingSeat: null,
    turnSeq: 0,
    currentBet: 0,
    minRaise: input.rules.bigBlind,
    pot: 0,
    carryOverIn: 0,
    revealQueue: [],
    result: null,
  }
  const events: GameEvent[] = [
    { type: 'HAND_STARTED', handId: state.handId, mode: 'holdem', button: state.button, seats: state.players.map((p) => p.seat), carryOverIn: 0 },
  ]

  const order = seatsClockwiseFrom(state, state.button)
  for (let round = 0; round < 2; round++) for (const p of order) p.holeCards.push(...dealCards(state, 1))
  for (const p of state.players) events.push({ type: 'CARDS_DEALT', seat: p.seat, cards: p.holeCards.slice() })

  const headsUp = state.players.length === 2
  const sb = headsUp ? getPlayer(state, state.button) : order[0]!
  const bb = headsUp ? order[0]! : order[1]!
  events.push({
    type: 'BLINDS_POSTED',
    posts: [
      { seat: sb.seat, amount: commit(state, sb, input.rules.smallBlind), kind: 'SB' },
      { seat: bb.seat, amount: commit(state, bb, input.rules.bigBlind), kind: 'BB' },
    ],
  })
  state.currentBet = input.rules.bigBlind
  events.push({ type: 'POT_UPDATED', pot: state.pot })
  advance(state, events, bb.seat)
  return { state, events }
}

export function holdemLegalActions(state: HandState, seat: number): LegalActions {
  const p = getPlayer(state, seat)
  const bb = rulesOf(state).bigBlind
  const toCall = Math.max(0, state.currentBet - p.betThisStreet)
  const kinds: ActionKind[] = ['fold']
  let minBet = 0, maxBet = 0, minRaiseTo = 0, maxRaiseTo = 0
  kinds.push(toCall === 0 ? 'check' : 'call')
  if (state.currentBet === 0 && p.stack > 0) {
    kinds.push('bet')
    minBet = Math.min(bb, p.stack)
    maxBet = p.stack
  } else if (state.currentBet > 0 && !p.cannotRaise && p.stack > toCall) {
    kinds.push('raise')
    maxRaiseTo = p.betThisStreet + p.stack
    minRaiseTo = Math.min(state.currentBet + state.minRaise, maxRaiseTo)
  }
  if (p.stack > 0 && !(p.cannotRaise && p.stack > toCall)) kinds.push('allIn')
  return { seat, kinds, callAmount: Math.min(toCall, p.stack), minBet, maxBet, minRaiseTo, maxRaiseTo }
}

export function applyHoldemCommand(input: HandState, cmd: HandCommand, _rng: Rng): EngineResult {
  const state = clone(input)
  const events: GameEvent[] = []
  if (state.phase === 'COMPLETE') throw new EngineError('HAND_COMPLETE')
  switch (cmd.type) {
    case 'ADVANCE': {
      if (state.phase !== 'REVEAL') throw new EngineError('INVALID_COMMAND', 'ADVANCE only during REVEAL')
      revealNext(state, events)
      if (state.revealQueue.length === 0) settle(state, events, { showdown: true, feeCap: feeCap(state) })
      return { state, events }
    }
    case 'TIMEOUT': {
      assertTurn(state, cmd.seat)
      const legal = holdemLegalActions(state, cmd.seat)
      applyAction(state, events, cmd.seat, legal.kinds.includes('check') ? { kind: 'check' } : { kind: 'fold' }, true)
      return { state, events }
    }
    case 'ACTION': {
      assertTurn(state, cmd.seat)
      applyAction(state, events, cmd.seat, cmd.action, false)
      return { state, events }
    }
  }
}

function assertTurn(state: HandState, seat: number): void {
  if (state.phase !== 'BETTING' || state.actingSeat !== seat) throw new EngineError('NOT_YOUR_TURN', `seat ${seat} is not acting`)
}

function applyAction(state: HandState, events: GameEvent[], seat: number, action: PlayerAction, timedOut: boolean): void {
  const p = getPlayer(state, seat)
  const legal = holdemLegalActions(state, seat)
  if (!legal.kinds.includes(action.kind)) throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not legal for seat ${seat}`)
  const toCall = Math.max(0, state.currentBet - p.betThisStreet)
  let amount = 0
  switch (action.kind) {
    case 'fold':
      p.folded = true
      p.hasActed = true
      break
    case 'check':
      p.hasActed = true
      break
    case 'call':
      amount = commit(state, p, toCall)
      p.hasActed = true
      break
    case 'bet': {
      const total = action.amount
      if (!Number.isInteger(total) || total <= 0 || total > legal.maxBet || (total < legal.minBet && total !== p.stack))
        throw new EngineError('INVALID_AMOUNT', `bet must be between ${legal.minBet} and ${legal.maxBet}`)
      amount = commit(state, p, total)
      openBet(state, p, total)
      break
    }
    case 'raise': {
      const raiseTo = action.amount
      if (!Number.isInteger(raiseTo) || raiseTo <= state.currentBet || raiseTo > legal.maxRaiseTo || (raiseTo < legal.minRaiseTo && raiseTo !== legal.maxRaiseTo))
        throw new EngineError('INVALID_AMOUNT', `raise must be between ${legal.minRaiseTo} and ${legal.maxRaiseTo}`)
      amount = commit(state, p, raiseTo - p.betThisStreet)
      raise(state, p, raiseTo)
      break
    }
    case 'allIn': {
      const total = p.betThisStreet + p.stack
      amount = commit(state, p, p.stack)
      if (total > state.currentBet) {
        if (state.currentBet === 0) openBet(state, p, total)
        else raise(state, p, total)
      } else p.hasActed = true
      break
    }
    default:
      throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not a holdem action`)
  }
  events.push({ type: 'PLAYER_ACTED', seat, action, amount, stack: p.stack, allIn: p.allIn, timedOut })
  if (amount > 0) events.push({ type: 'POT_UPDATED', pot: state.pot })
  advance(state, events, seat)
}

/** First bet of a street. A bet below the minimum (short all-in) does not reopen raising for players who already acted. */
function openBet(state: HandState, p: HandPlayer, total: number): void {
  const full = total >= state.minRaise
  state.currentBet = total
  p.hasActed = true
  if (full) state.minRaise = total
  for (const o of state.players) {
    if (o === p) continue
    if (full) o.cannotRaise = false
    else if (o.hasActed) o.cannotRaise = true
    o.hasActed = false
  }
}

function raise(state: HandState, p: HandPlayer, raiseTo: number): void {
  const increment = raiseTo - state.currentBet
  const full = increment >= state.minRaise
  state.currentBet = raiseTo
  p.hasActed = true
  if (full) state.minRaise = increment
  for (const o of state.players) {
    if (o === p) continue
    if (full) o.cannotRaise = false
    else if (o.hasActed) o.cannotRaise = true
    o.hasActed = false
  }
}

function setTurn(state: HandState, events: GameEvent[], seat: number): void {
  state.actingSeat = seat
  state.turnSeq += 1
  events.push({ type: 'TURN_CHANGED', seat, turnSeq: state.turnSeq, legal: holdemLegalActions(state, seat) })
}

/** Called after every action: next actor, next street, run-out, or settlement. */
function advance(state: HandState, events: GameEvent[], fromSeat: number): void {
  if (unfolded(state).length === 1) {
    settle(state, events, { showdown: false, feeCap: feeCap(state) })
    return
  }
  const next = seatsClockwiseFrom(state, fromSeat).find((p) => needsAction(state, p))
  if (next) {
    setTurn(state, events, next.seat)
    return
  }
  const nextStreet = NEXT_STREET[state.street]
  if (nextStreet === null) {
    settle(state, events, { showdown: true, feeCap: feeCap(state) })
    return
  }
  const remaining: Street[] = []
  for (let s: Street | null = nextStreet; s !== null; s = NEXT_STREET[s]) remaining.push(s)
  if (state.players.filter(canAct).length <= 1) {
    state.phase = 'REVEAL'
    state.actingSeat = null
    state.revealQueue = remaining
    return
  }
  for (const p of state.players) {
    p.betThisStreet = 0
    p.hasActed = false
    p.cannotRaise = false
  }
  state.currentBet = 0
  state.minRaise = rulesOf(state).bigBlind
  state.revealQueue = [nextStreet]
  revealNext(state, events)
  const first = seatsClockwiseFrom(state, state.button).find(canAct)!
  setTurn(state, events, first.seat)
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck`
Expected: all pass. If the side-pot test's expected stacks differ, recompute from the printed `result` rather than changing the engine: main pot = 3 × 400 = 1200; side = 2 × 200 = 400; total 1600; fee = min(32, 100) = 32 taken from main → 1168; all three tie on the board straight flush (8c–Qc) → 389 each, 1 odd chip to seat 1; side pot 200 each to seats 0 and 1.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): no-limit hold'em hand engine

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 7: Blind Poker hand engine (2/3 hole cards, mode A/B)

**Files:**
- Create: `packages/core/src/hand/blind.ts`, `packages/core/src/hand/blind.test.ts`

**Interfaces:**
- Consumes: Task 5 types/helpers, Task 2 shuffle.
- Produces:
  - `interface CreateBlindInput { handId: string; rules: BlindRules; seats: SeatInput[]; button: number; carryOverIn: number }`
  - `blindRequiredStack(rules: BlindRules): number` = `fixedWager` (mode `none`) or `2 × fixedWager` (mode `playOrFold`)
  - `createBlindHand(input: CreateBlindInput, rng: Rng): EngineResult`
  - `blindLegalActions(state: HandState, seat: number): LegalActions` — during `DECISION` for an undecided seat: `kinds: ['play','fold']`, `callAmount: fixedWager`; otherwise `kinds: []`
  - `applyBlindCommand(state: HandState, cmd: HandCommand, rng: Rng): EngineResult`

Rules implemented (spec §8): every seat antes `W` (stack must be ≥ required, else `INVALID_SETUP`), `carryOverIn` added to the pot, `holeCards` dealt clockwise from the button; mode A goes straight to `REVEAL` (FLOP, TURN, RIVER via `ADVANCE`); mode B enters `DECISION` where every seat chooses `play` (+W) or `fold` simultaneously, `TIMEOUT{seat}` = fold; when all decided: 0 players → whole pot carries over (no fee); 1 player → wins without reveal; ≥ 2 → `REVEAL` then showdown best-5-of-(holeCards+5). Fee = `floor(total × rate)` (no cap).

- [ ] **Step 1: Write failing tests**

`packages/core/src/hand/blind.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { Rng } from '../cards/rng.js'
import { seededRng } from '../cards/rng.js'
import { applyBlindCommand, blindLegalActions, blindRequiredStack, createBlindHand } from './blind.js'
import { EngineError, type BlindRules, type GameEvent, type HandState } from './types.js'

const identityRng: Rng = { int: (n) => n - 1 }
const rules = (over: Partial<BlindRules> = {}): BlindRules => ({ mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02, ...over })

class Table {
  state: HandState
  events: GameEvent[] = []
  readonly startTotal: number
  constructor(r: BlindRules, stacks: number[], carryOverIn = 0, button = 0, rng: Rng = seededRng(3)) {
    const seats = stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
    const res = createBlindHand({ handId: 'b1', rules: r, seats, button, carryOverIn }, rng)
    this.state = res.state
    this.events.push(...res.events)
    this.startTotal = stacks.reduce((a, b) => a + b, 0) + carryOverIn
  }
  apply(cmd: Parameters<typeof applyBlindCommand>[1]) {
    const r = applyBlindCommand(this.state, cmd, identityRng)
    this.state = r.state
    this.events.push(...r.events)
    return r.events
  }
  play(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'play' } }) }
  fold(seat: number) { return this.apply({ type: 'ACTION', seat, action: { kind: 'fold' } }) }
  advanceAll() { while (this.state.phase === 'REVEAL') this.apply({ type: 'ADVANCE' }) }
  stack(seat: number) { return this.state.players.find((p) => p.seat === seat)!.stack }
  assertMoney() {
    const r = this.state.result!
    const after = this.state.players.reduce((a, p) => a + p.stack, 0)
    expect(after + r.fee + r.carryOverOut).toBe(this.startTotal)
  }
  types() { return this.events.map((e) => e.type) }
}

describe('setup', () => {
  it('required stack depends on decision mode', () => {
    expect(blindRequiredStack(rules({ decisionMode: 'none' }))).toBe(1000)
    expect(blindRequiredStack(rules({ decisionMode: 'playOrFold' }))).toBe(2000)
  })
  it('antes every seat, deals the configured hole cards, adds carry-over', () => {
    const t = new Table(rules({ holeCards: 3 }), [5000, 5000, 5000], 700)
    expect(t.state.players.every((p) => p.holeCards.length === 3 && p.stack === 4000)).toBe(true)
    expect(t.state.pot).toBe(3700)
    expect(t.state.carryOverIn).toBe(700)
    expect(t.state.phase).toBe('DECISION')
    expect(t.types()).toEqual(['HAND_STARTED', 'BLINDS_POSTED', 'POT_UPDATED', 'CARDS_DEALT', 'CARDS_DEALT', 'CARDS_DEALT', 'DECISION_PHASE'])
  })
  it('rejects a seat that cannot afford the required stack', () => {
    expect(() => new Table(rules(), [5000, 1500])).toThrow(EngineError)
    expect(() => new Table(rules({ decisionMode: 'none' }), [5000, 1500])).not.toThrow()
  })
})

describe('mode A (no decision)', () => {
  it('goes straight to REVEAL and settles after three ADVANCEs with a fee', () => {
    const t = new Table(rules({ decisionMode: 'none' }), [5000, 5000], 0, 0, identityRng)
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.revealQueue).toEqual(['FLOP', 'TURN', 'RIVER'])
    t.advanceAll()
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(5)
    expect(t.state.result!.fee).toBe(40) // 2% of 2000
    expect(t.state.result!.showdown).toHaveLength(2)
    t.assertMoney()
  })
})

describe('mode B (play or fold)', () => {
  it('offers play/fold only to undecided seats and hides decisions until all decided', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    expect(blindLegalActions(t.state, 0)).toMatchObject({ kinds: ['play', 'fold'], callAmount: 1000 })
    const ev = t.play(0)
    expect(ev.map((e) => e.type)).toEqual(['PLAYER_ACTED', 'DECISION_MADE', 'POT_UPDATED'])
    expect(blindLegalActions(t.state, 0).kinds).toEqual([])
    expect(() => t.play(0)).toThrow(/NOT_YOUR_TURN/)
    expect(t.stack(0)).toBe(3000)
    expect(t.state.phase).toBe('DECISION')
  })
  it('one player plays → wins the pot immediately without reveal', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(1); t.fold(0); t.fold(2)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.community).toHaveLength(0)
    expect(t.state.result!.showdown).toBeNull()
    // pot 3000 + 1000 = 4000, fee 80 → 3920 to seat 1 who put in 2000
    expect(t.stack(1)).toBe(5000 - 2000 + 3920)
    expect(t.types().slice(-3)).toEqual(['DECISIONS_REVEALED', 'SETTLEMENT', 'HAND_COMPLETE'])
    t.assertMoney()
  })
  it('everyone folds → pot carries over, no fee', () => {
    const t = new Table(rules(), [5000, 5000], 500)
    t.fold(0); t.fold(1)
    expect(t.state.phase).toBe('COMPLETE')
    expect(t.state.result!.carryOverOut).toBe(2500)
    expect(t.state.result!.fee).toBe(0)
    expect(t.stack(0)).toBe(4000)
    t.assertMoney()
  })
  it('timeout counts as fold', () => {
    const t = new Table(rules(), [5000, 5000, 5000])
    t.play(0); t.play(1)
    const ev = t.apply({ type: 'TIMEOUT', seat: 2 })
    expect(ev[0]).toMatchObject({ type: 'PLAYER_ACTED', seat: 2, action: { kind: 'fold' }, timedOut: true })
    expect(t.state.phase).toBe('REVEAL')
    expect(t.state.players[2]!.folded).toBe(true)
  })
  it('two or more players → reveal and showdown among players only', () => {
    const t = new Table(rules({ holeCards: 3 }), [5000, 5000, 5000], 0, 0, identityRng)
    t.play(0); t.play(2); t.fold(1)
    expect(t.state.phase).toBe('REVEAL')
    t.advanceAll()
    const r = t.state.result!
    expect(r.showdown!.map((h) => h.seat)).toEqual([0, 2])
    expect(r.showdown![0]!.cards).toHaveLength(3)
    expect(r.fee).toBe(100) // pot 3000 + 2000 = 5000
    expect(r.pots.map((p) => p.eligibleSeats)).toEqual([[0, 2]])
    t.assertMoney()
  })
  it('rejects ADVANCE during DECISION and actions after completion', () => {
    const t = new Table(rules(), [5000, 5000])
    expect(() => t.apply({ type: 'ADVANCE' })).toThrow(/INVALID_COMMAND/)
    expect(() => t.apply({ type: 'ACTION', seat: 0, action: { kind: 'call' } })).toThrow(/ILLEGAL_ACTION/)
    t.fold(0); t.fold(1)
    expect(() => t.fold(0)).toThrow(/HAND_COMPLETE/)
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — `./blind.js` not found.

- [ ] **Step 3: Implement**

`packages/core/src/hand/blind.ts`:
```ts
import { createDeck } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { shuffle } from '../cards/shuffle.js'
import { carryOverAll, clone, commit, dealCards, getPlayer, revealNext, seatsClockwiseFrom, settle } from './common.js'
import {
  EngineError,
  type BlindRules, type EngineResult, type GameEvent, type HandCommand, type HandState, type LegalActions, type PlayerAction, type SeatInput,
} from './types.js'

export interface CreateBlindInput {
  handId: string
  rules: BlindRules
  seats: SeatInput[]
  button: number
  carryOverIn: number
}

export function blindRequiredStack(rules: BlindRules): number {
  return rules.decisionMode === 'playOrFold' ? rules.fixedWager * 2 : rules.fixedWager
}

const rulesOf = (state: HandState): BlindRules => {
  if (state.rules.mode !== 'blind') throw new EngineError('INVALID_COMMAND', 'not a blind hand')
  return state.rules
}

export function createBlindHand(input: CreateBlindInput, rng: Rng): EngineResult {
  const seats = [...input.seats].sort((a, b) => a.seat - b.seat)
  const required = blindRequiredStack(input.rules)
  if (seats.length < 2) throw new EngineError('INVALID_SETUP', 'need at least 2 players')
  if (seats.some((s) => s.stack < required)) throw new EngineError('INVALID_SETUP', `every player needs at least ${required}`)
  if (!seats.some((s) => s.seat === input.button)) throw new EngineError('INVALID_SETUP', 'button must be a seated player')
  if (input.carryOverIn < 0) throw new EngineError('INVALID_SETUP', 'carryOverIn must be >= 0')

  const state: HandState = {
    handId: input.handId,
    rules: input.rules,
    phase: input.rules.decisionMode === 'playOrFold' ? 'DECISION' : 'REVEAL',
    players: seats.map((s) => ({
      seat: s.seat, playerId: s.playerId, isBot: s.isBot, stack: s.stack, holeCards: [], betThisStreet: 0,
      totalCommitted: 0, folded: false, allIn: false, hasActed: false, cannotRaise: false, decision: null,
    })),
    deck: shuffle(createDeck(), rng),
    deckIndex: 0,
    community: [],
    button: input.button,
    street: 'PREFLOP',
    actingSeat: null,
    turnSeq: 0,
    currentBet: 0,
    minRaise: 0,
    pot: input.carryOverIn,
    carryOverIn: input.carryOverIn,
    revealQueue: ['FLOP', 'TURN', 'RIVER'],
    result: null,
  }
  const events: GameEvent[] = [
    { type: 'HAND_STARTED', handId: state.handId, mode: 'blind', button: state.button, seats: state.players.map((p) => p.seat), carryOverIn: input.carryOverIn },
  ]
  const posts = state.players.map((p) => ({ seat: p.seat, amount: commit(state, p, input.rules.fixedWager), kind: 'ANTE' as const }))
  events.push({ type: 'BLINDS_POSTED', posts })
  events.push({ type: 'POT_UPDATED', pot: state.pot })

  const order = seatsClockwiseFrom(state, state.button)
  for (let round = 0; round < input.rules.holeCards; round++) for (const p of order) p.holeCards.push(...dealCards(state, 1))
  for (const p of state.players) events.push({ type: 'CARDS_DEALT', seat: p.seat, cards: p.holeCards.slice() })

  if (state.phase === 'DECISION') {
    state.turnSeq += 1
    events.push({ type: 'DECISION_PHASE', seats: state.players.map((p) => p.seat), turnSeq: state.turnSeq })
  }
  return { state, events }
}

export function blindLegalActions(state: HandState, seat: number): LegalActions {
  const p = getPlayer(state, seat)
  const none: LegalActions = { seat, kinds: [], callAmount: 0, minBet: 0, maxBet: 0, minRaiseTo: 0, maxRaiseTo: 0 }
  if (state.phase !== 'DECISION' || p.decision !== null) return none
  return { ...none, kinds: ['play', 'fold'], callAmount: rulesOf(state).fixedWager }
}

export function applyBlindCommand(input: HandState, cmd: HandCommand, _rng: Rng): EngineResult {
  const state = clone(input)
  const events: GameEvent[] = []
  if (state.phase === 'COMPLETE') throw new EngineError('HAND_COMPLETE')
  switch (cmd.type) {
    case 'ADVANCE': {
      if (state.phase !== 'REVEAL') throw new EngineError('INVALID_COMMAND', 'ADVANCE only during REVEAL')
      revealNext(state, events)
      if (state.revealQueue.length === 0) settle(state, events, { showdown: true })
      return { state, events }
    }
    case 'TIMEOUT': {
      decide(state, events, cmd.seat, { kind: 'fold' }, true)
      return { state, events }
    }
    case 'ACTION': {
      decide(state, events, cmd.seat, cmd.action, false)
      return { state, events }
    }
  }
}

function decide(state: HandState, events: GameEvent[], seat: number, action: PlayerAction, timedOut: boolean): void {
  const p = getPlayer(state, seat)
  const legal = blindLegalActions(state, seat)
  if (legal.kinds.length === 0) throw new EngineError('NOT_YOUR_TURN', `seat ${seat} has nothing to decide`)
  if (!legal.kinds.includes(action.kind)) throw new EngineError('ILLEGAL_ACTION', `${action.kind} is not legal in blind poker`)
  let amount = 0
  if (action.kind === 'play') {
    amount = commit(state, p, rulesOf(state).fixedWager)
    p.decision = 'play'
  } else {
    p.decision = 'fold'
  }
  p.hasActed = true
  events.push({ type: 'PLAYER_ACTED', seat, action, amount, stack: p.stack, allIn: p.allIn, timedOut })
  events.push({ type: 'DECISION_MADE', seat })
  if (amount > 0) events.push({ type: 'POT_UPDATED', pot: state.pot })

  if (state.players.some((x) => x.decision === null)) return

  for (const x of state.players) if (x.decision === 'fold') x.folded = true
  events.push({ type: 'DECISIONS_REVEALED', decisions: state.players.map((x) => ({ seat: x.seat, decision: x.decision! })) })
  const playing = state.players.filter((x) => !x.folded).length
  if (playing === 0) carryOverAll(state, events)
  else if (playing === 1) settle(state, events, { showdown: false })
  else state.phase = 'REVEAL'
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck`
Expected: all pass. Mode A fee: pot 2000 × 0.02 = 40. One-player-plays: 3 antes + 1 play = 4000, fee 80, seat 1 gets 3920.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): blind poker hand engine (2/3 cards, modes A/B)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: Engine facade, player view, simulation harness

**Files:**
- Create: `packages/core/src/hand/engine.ts`, `packages/core/src/hand/view.ts`, `packages/core/src/hand/simulate.ts`, `packages/core/src/hand/engine.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Tasks 5–7.
- Produces:
  - `type CreateHandInput = { handId: string; rules: Ruleset; seats: SeatInput[]; button: number; carryOverIn?: number }`
  - `createHand(input: CreateHandInput, rng: Rng): EngineResult` — dispatches on `rules.mode`
  - `applyCommand(state: HandState, cmd: HandCommand, rng: Rng): EngineResult`
  - `legalActions(state: HandState, seat: number): LegalActions`
  - `nextButton(prevButton: number | null, activeSeats: readonly number[], rng: Rng): number` — random seat first hand, else next clockwise
  - `interface SeatView { seat; playerId; isBot; stack; betThisStreet; totalCommitted; folded; allIn; cardCount: number; holeCards: Card[] | null; hasDecided: boolean; decision: Decision | null }`
  - `interface HandView { handId; mode; phase; street; community: Card[]; pot; carryOverIn; currentBet; minRaise; button; actingSeat; turnSeq; seats: SeatView[]; mySeat: number | null; result: HandResult | null }`
  - `playerView(state: HandState, viewerSeat: number | null): HandView` — hides other players' hole cards (except showdown hands after completion) and hidden decisions during `DECISION`
  - `type Policy = (view: HandView, legal: LegalActions, rng: Rng) => PlayerAction`
  - `simulateHand(input: CreateHandInput, policy: Policy, rng: Rng): { state: HandState; events: GameEvent[] }` — drives a full hand (ADVANCE for REVEAL, per-seat decisions, actions) and asserts the money invariant, throwing on violation
  - `randomPolicy: Policy` — uniformly random legal action with random valid amounts

- [ ] **Step 1: Write failing tests**

`packages/core/src/hand/engine.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { seededRng } from '../cards/rng.js'
import { applyCommand, createHand, legalActions, nextButton } from './engine.js'
import { randomPolicy, simulateHand, type Policy } from './simulate.js'
import type { BlindRules, HoldemRules } from './types.js'
import { playerView } from './view.js'

const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
const BLIND_B: BlindRules = { mode: 'blind', holeCards: 2, decisionMode: 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
const seats = (stacks: number[]) => stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: false }))
/** Checks when possible, otherwise calls: both players check down to a showdown. */
const passive: Policy = (_v, legal) => ({ kind: legal.kinds.includes('check') ? 'check' : 'call' })

describe('facade', () => {
  it('dispatches by mode', () => {
    const h = createHand({ handId: 'a', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, seededRng(1))
    expect(h.state.phase).toBe('BETTING')
    const b = createHand({ handId: 'b', rules: BLIND_B, seats: seats([5000, 5000]), button: 0 }, seededRng(1))
    expect(b.state.phase).toBe('DECISION')
    expect(legalActions(b.state, 0).kinds).toEqual(['play', 'fold'])
    const b2 = applyCommand(b.state, { type: 'ACTION', seat: 0, action: { kind: 'play' } }, seededRng(1))
    expect(b2.state.players[0]!.decision).toBe('play')
  })
  it('nextButton picks randomly first, then the next clockwise active seat', () => {
    expect([0, 3, 5]).toContain(nextButton(null, [0, 3, 5], seededRng(9)))
    expect(nextButton(3, [0, 3, 5], seededRng(9))).toBe(5)
    expect(nextButton(5, [0, 3, 5], seededRng(9))).toBe(0)
    expect(nextButton(4, [0, 3, 5], seededRng(9))).toBe(5) // previous button seat left the table
  })
})

describe('playerView', () => {
  it('hides other hole cards and decisions but shows my own', () => {
    let { state } = createHand({ handId: 'b', rules: BLIND_B, seats: seats([5000, 5000, 5000]), button: 0 }, seededRng(2))
    state = applyCommand(state, { type: 'ACTION', seat: 1, action: { kind: 'play' } }, seededRng(1)).state
    const v = playerView(state, 0)
    expect(v.mySeat).toBe(0)
    expect(v.seats[0]!.holeCards).toHaveLength(2)
    expect(v.seats[1]!.holeCards).toBeNull()
    expect(v.seats[1]!.cardCount).toBe(2)
    expect(v.seats[1]!.hasDecided).toBe(true)
    expect(v.seats[1]!.decision).toBeNull()
    const spectator = playerView(state, null)
    expect(spectator.mySeat).toBeNull()
    expect(spectator.seats.every((s) => s.holeCards === null)).toBe(true)
    expect(v.seats[0]!.decision).toBeNull() // not decided yet myself
  })
  it('reveals showdown hands after completion', () => {
    const { state } = simulateHand({ handId: 'x', rules: HOLDEM, seats: seats([1000, 1000]), button: 0 }, passive, seededRng(5))
    const v = playerView(state, null)
    expect(v.result?.showdown).not.toBeNull()
    expect(v.seats.filter((s) => s.holeCards !== null)).toHaveLength(2)
  })
})

describe('simulation invariants', () => {
  it('random hold’em hands never break money conservation or produce illegal states', () => {
    const rng = seededRng(2024)
    for (let i = 0; i < 300; i++) {
      const n = 2 + rng.int(8)
      const stacks = Array.from({ length: n }, () => 100 + rng.int(5000))
      const { state } = simulateHand({ handId: `h${i}`, rules: HOLDEM, seats: seats(stacks), button: rng.int(n) }, randomPolicy, rng)
      expect(state.phase).toBe('COMPLETE')
      expect(state.players.every((p) => p.stack >= 0)).toBe(true)
    }
  })
  it('random blind hands (2/3 cards, modes A/B) conserve money', () => {
    const rng = seededRng(77)
    for (let i = 0; i < 300; i++) {
      const n = 2 + rng.int(7)
      const rules: BlindRules = { ...BLIND_B, holeCards: rng.int(2) === 0 ? 2 : 3, decisionMode: rng.int(2) === 0 ? 'none' : 'playOrFold' }
      const stacks = Array.from({ length: n }, () => 2000 + rng.int(10000))
      const { state } = simulateHand({ handId: `b${i}`, rules, seats: seats(stacks), button: rng.int(n), carryOverIn: rng.int(3) === 0 ? 1500 : 0 }, randomPolicy, rng)
      expect(state.phase).toBe('COMPLETE')
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/hand/engine.ts`:
```ts
import type { Rng } from '../cards/rng.js'
import { clockwiseFrom } from '../betting/pots.js'
import { applyBlindCommand, blindLegalActions, createBlindHand } from './blind.js'
import { applyHoldemCommand, createHoldemHand, holdemLegalActions } from './holdem.js'
import { EngineError, type EngineResult, type HandCommand, type HandState, type LegalActions, type Ruleset, type SeatInput } from './types.js'

export interface CreateHandInput {
  handId: string
  rules: Ruleset
  seats: SeatInput[]
  button: number
  carryOverIn?: number
}

export function createHand(input: CreateHandInput, rng: Rng): EngineResult {
  if (input.rules.mode === 'holdem') return createHoldemHand({ handId: input.handId, rules: input.rules, seats: input.seats, button: input.button }, rng)
  return createBlindHand({ handId: input.handId, rules: input.rules, seats: input.seats, button: input.button, carryOverIn: input.carryOverIn ?? 0 }, rng)
}

export function applyCommand(state: HandState, cmd: HandCommand, rng: Rng): EngineResult {
  return state.rules.mode === 'holdem' ? applyHoldemCommand(state, cmd, rng) : applyBlindCommand(state, cmd, rng)
}

export function legalActions(state: HandState, seat: number): LegalActions {
  return state.rules.mode === 'holdem' ? holdemLegalActions(state, seat) : blindLegalActions(state, seat)
}

/** Dealer button rotation: random among active seats for the first hand, then the next active seat clockwise. */
export function nextButton(prevButton: number | null, activeSeats: readonly number[], rng: Rng): number {
  if (activeSeats.length === 0) throw new EngineError('INVALID_SETUP', 'no active seats')
  const sorted = [...activeSeats].sort((a, b) => a - b)
  if (prevButton === null) return sorted[rng.int(sorted.length)]!
  return clockwiseFrom(sorted, prevButton)[0]!
}
```

`packages/core/src/hand/view.ts`:
```ts
import type { Card } from '../cards/cards.js'
import type { Decision, GameMode, HandPhase, HandResult, HandState, Street } from './types.js'

export interface SeatView {
  seat: number
  playerId: string
  isBot: boolean
  stack: number
  betThisStreet: number
  totalCommitted: number
  folded: boolean
  allIn: boolean
  cardCount: number
  holeCards: Card[] | null
  hasDecided: boolean
  decision: Decision | null
}

export interface HandView {
  handId: string
  mode: GameMode
  phase: HandPhase
  street: Street
  community: Card[]
  pot: number
  carryOverIn: number
  currentBet: number
  minRaise: number
  button: number
  actingSeat: number | null
  turnSeq: number
  seats: SeatView[]
  mySeat: number | null
  result: HandResult | null
}

export function playerView(state: HandState, viewerSeat: number | null): HandView {
  const shownAtShowdown = new Set(state.result?.showdown?.map((h) => h.seat) ?? [])
  const decisionsPublic = state.phase !== 'DECISION'
  return {
    handId: state.handId,
    mode: state.rules.mode,
    phase: state.phase,
    street: state.street,
    community: state.community.slice(),
    pot: state.pot,
    carryOverIn: state.carryOverIn,
    currentBet: state.currentBet,
    minRaise: state.minRaise,
    button: state.button,
    actingSeat: state.actingSeat,
    turnSeq: state.turnSeq,
    mySeat: viewerSeat,
    result: state.result ? structuredClone(state.result) : null,
    seats: state.players.map((p) => {
      const mine = p.seat === viewerSeat
      return {
        seat: p.seat,
        playerId: p.playerId,
        isBot: p.isBot,
        stack: p.stack,
        betThisStreet: p.betThisStreet,
        totalCommitted: p.totalCommitted,
        folded: p.folded,
        allIn: p.allIn,
        cardCount: p.holeCards.length,
        holeCards: mine || shownAtShowdown.has(p.seat) ? p.holeCards.slice() : null,
        hasDecided: p.decision !== null,
        decision: mine || decisionsPublic ? p.decision : null,
      }
    }),
  }
}
```

`packages/core/src/hand/simulate.ts`:
```ts
import type { Rng } from '../cards/rng.js'
import { applyCommand, createHand, legalActions, type CreateHandInput } from './engine.js'
import type { GameEvent, HandState, LegalActions, PlayerAction } from './types.js'
import { playerView, type HandView } from './view.js'

export type Policy = (view: HandView, legal: LegalActions, rng: Rng) => PlayerAction

const between = (rng: Rng, lo: number, hi: number) => lo + rng.int(hi - lo + 1)

/** Uniformly random legal action; bet/raise amounts uniform in their valid range. */
export const randomPolicy: Policy = (_view, legal, rng) => {
  const kind = legal.kinds[rng.int(legal.kinds.length)]!
  if (kind === 'bet') return { kind, amount: between(rng, legal.minBet, legal.maxBet) }
  if (kind === 'raise') return { kind, amount: between(rng, legal.minRaiseTo, legal.maxRaiseTo) }
  return { kind }
}

/** Plays one full hand with the given policy for every seat; enforces the money invariant. */
export function simulateHand(input: CreateHandInput, policy: Policy, rng: Rng): { state: HandState; events: GameEvent[] } {
  const startTotal = input.seats.reduce((a, s) => a + s.stack, 0) + (input.carryOverIn ?? 0)
  let { state, events } = createHand(input, rng)
  const all = [...events]
  let guard = 0
  while (state.phase !== 'COMPLETE') {
    if (++guard > 10_000) throw new Error('simulateHand: hand did not finish')
    if (state.phase === 'REVEAL') {
      ;({ state, events } = applyCommand(state, { type: 'ADVANCE' }, rng))
    } else if (state.phase === 'DECISION') {
      const seat = state.players.find((p) => p.decision === null)!.seat
      const action = policy(playerView(state, seat), legalActions(state, seat), rng)
      ;({ state, events } = applyCommand(state, { type: 'ACTION', seat, action }, rng))
    } else {
      const seat = state.actingSeat
      if (seat === null) throw new Error('simulateHand: BETTING with no acting seat')
      const action = policy(playerView(state, seat), legalActions(state, seat), rng)
      ;({ state, events } = applyCommand(state, { type: 'ACTION', seat, action }, rng))
    }
    all.push(...events)
  }
  const r = state.result!
  const endTotal = state.players.reduce((a, p) => a + p.stack, 0) + r.fee + r.carryOverOut
  if (endTotal !== startTotal) throw new Error(`money invariant broken: start ${startTotal} end ${endTotal}`)
  return { state, events: all }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './hand/engine.js'
export * from './hand/view.js'
export * from './hand/simulate.js'
export { blindRequiredStack } from './hand/blind.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck`
Expected: all pass (600 simulated hands; < 10 s).

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): engine facade, player view and simulation harness

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Bot strategies (Chen score, Blind B, Hold'em)

**Files:**
- Create: `packages/core/src/bot/chen.ts`, `packages/core/src/bot/strategy.ts`, `packages/core/src/bot/bot.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Consumes: Task 8 `HandView`, `LegalActions`, `simulateHand`; Task 3 `evaluate`, `HandCategory`.
- Produces:
  - `chenScore(cards: readonly Card[]): number` — 2 cards: Chen formula; 3 cards: best pair score + 2 (pair) / + 5 (trips) / + 1 (three suited)
  - `interface BotStrategy { decide(view: HandView, legal: LegalActions, rng: Rng): PlayerAction }`
  - `createBotStrategy(): BotStrategy` — dispatches on `view.mode`
  - `gaussian(rng: Rng, mean: number, sd: number): number`

- [ ] **Step 1: Write failing tests**

`packages/core/src/bot/bot.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseCards } from '../cards/cards.js'
import { seededRng } from '../cards/rng.js'
import { simulateHand } from '../hand/simulate.js'
import type { BlindRules, HoldemRules } from '../hand/types.js'
import { chenScore } from './chen.js'
import { createBotStrategy } from './strategy.js'

describe('chenScore', () => {
  it.each([
    ['As Ah', 20], ['Ks Kh', 16], ['2s 2h', 5], ['As Ks', 12], ['As Kh', 10], ['Ts 9s', 8], ['7s 2h', -1], ['Js Ts', 9], ['Qs Jh', 7],
  ])('%s → %i', (hand, expected) => {
    expect(chenScore(parseCards(hand))).toBe(expected)
  })
  it('scores three cards using the best pair plus bonuses', () => {
    expect(chenScore(parseCards('As Ah 2c'))).toBe(22)      // pair of aces + 2
    expect(chenScore(parseCards('7s 7h 7c'))).toBe(14)     // pair of 7s = 3.5 × 2 = 7, + 2 (pair) + 5 (trips)
  })
})

describe('bot never makes illegal moves', () => {
  const HOLDEM: HoldemRules = { mode: 'holdem', smallBlind: 50, bigBlind: 100, tableFeeRate: 0.02, tableFeeCapBB: 1 }
  const seats = (stacks: number[]) => stacks.map((stack, seat) => ({ seat, playerId: `p${seat}`, stack, isBot: true }))
  it('plays 2000 blind hands of every variant', () => {
    const bot = createBotStrategy()
    const rng = seededRng(11)
    let plays = 0, decisions = 0
    for (let i = 0; i < 2000; i++) {
      const rules: BlindRules = { mode: 'blind', holeCards: i % 2 === 0 ? 2 : 3, decisionMode: i % 4 < 2 ? 'none' : 'playOrFold', fixedWager: 1000, tableFeeRate: 0.02 }
      const n = 2 + rng.int(7)
      const { state } = simulateHand({ handId: `b${i}`, rules, seats: seats(Array(n).fill(20000)), button: 0 }, (v, l, r) => {
        const a = bot.decide(v, l, r)
        if (rules.decisionMode === 'playOrFold') { decisions++; if (a.kind === 'play') plays++ }
        return a
      }, rng)
      expect(state.phase).toBe('COMPLETE')
    }
    const rate = plays / decisions
    expect(rate).toBeGreaterThan(0.3)
    expect(rate).toBeLessThan(0.8)
  })
  it('plays 1000 hold’em hands with 2–6 bots', () => {
    const bot = createBotStrategy()
    const rng = seededRng(12)
    for (let i = 0; i < 1000; i++) {
      const n = 2 + rng.int(5)
      const { state } = simulateHand({ handId: `h${i}`, rules: HOLDEM, seats: seats(Array.from({ length: n }, () => 2000 + rng.int(8000))), button: rng.int(n) }, bot.decide, rng)
      expect(state.phase).toBe('COMPLETE')
    }
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/bot/chen.ts`:
```ts
import { rankOf, suitOf, type Card } from '../cards/cards.js'
import { combinations } from '../evaluator/combinations.js'

const HIGH_CARD_POINTS: Record<number, number> = { 12: 10, 11: 8, 10: 7, 9: 6 }
const cardPoints = (rank: number): number => HIGH_CARD_POINTS[rank] ?? (rank + 2) / 2

function chen2(a: Card, b: Card): number {
  const ra = rankOf(a), rb = rankOf(b)
  const high = Math.max(ra, rb), low = Math.min(ra, rb)
  let score = cardPoints(high)
  if (ra === rb) return Math.max(5, score * 2)
  if (suitOf(a) === suitOf(b)) score += 2
  const gap = high - low - 1
  if (gap === 1) score -= 1
  else if (gap === 2) score -= 2
  else if (gap === 3) score -= 4
  else if (gap >= 4) score -= 5
  if (gap <= 1 && high < 10) score += 1 // both below Q, connected or one-gap
  return Math.round(score)
}

/** Chen formula for two cards; extended heuristic for three. */
export function chenScore(cards: readonly Card[]): number {
  if (cards.length === 2) return chen2(cards[0]!, cards[1]!)
  if (cards.length !== 3) throw new Error('chenScore supports 2 or 3 cards')
  let best = -Infinity
  for (const [a, b] of combinations(cards, 2)) best = Math.max(best, chen2(a!, b!))
  const ranks = cards.map(rankOf)
  const distinct = new Set(ranks).size
  if (distinct === 1) best += 7 // pair (+2) and trips (+5)
  else if (distinct === 2) best += 2
  if (new Set(cards.map(suitOf)).size === 1) best += 1
  return best
}
```

Vector check against this code: `As Ah` = 10 × 2 = 20; `2s 2h` = max(5, 2) = 5; `As Ks` = 10 + 2 (suited) = 12; `Ts 9s` = 5 + 2 + 1 (connected, both below Q) = 8; `7s 2h` = 3.5 − 5 = −1.5 → `Math.round` = −1; `Qs Jh` = 7 (Q is not below Q, no +1). Three cards: `As Ah 2c` = 20 + 2 = 22; `7s 7h 7c` = 7 + 7 = 14.

`packages/core/src/bot/strategy.ts`:
```ts
import { rankOf, suitOf, type Card } from '../cards/cards.js'
import type { Rng } from '../cards/rng.js'
import { HandCategory, evaluate } from '../evaluator/evaluator.js'
import type { LegalActions, PlayerAction } from '../hand/types.js'
import type { HandView } from '../hand/view.js'
import { chenScore } from './chen.js'

export interface BotStrategy {
  decide(view: HandView, legal: LegalActions, rng: Rng): PlayerAction
}

/** Box–Muller normal sample. */
export function gaussian(rng: Rng, mean: number, sd: number): number {
  const u = (rng.int(1_000_000) + 1) / 1_000_001
  const v = (rng.int(1_000_000) + 1) / 1_000_001
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function decideBlind(view: HandView, legal: LegalActions, rng: Rng): PlayerAction {
  const me = view.seats.find((s) => s.seat === view.mySeat)
  if (!me?.holeCards || !legal.kinds.includes('play')) return { kind: legal.kinds[0] ?? 'fold' }
  const opponents = view.seats.filter((s) => s.seat !== view.mySeat && !s.folded).length
  let threshold = 6 + 0.8 * (opponents - 1)
  if (view.carryOverIn > 4 * legal.callAmount) threshold -= 1.5
  const score = chenScore(me.holeCards) + gaussian(rng, 0, 1.5)
  return { kind: score >= threshold ? 'play' : 'fold' }
}

/** Rough made-hand strength in [0,1] plus draw bonus, from my cards and the board. */
function handStrength(hole: Card[], community: Card[]): number {
  if (community.length === 0) return clamp((chenScore(hole) + 2) / 22, 0, 1)
  const ev = evaluate([...hole, ...community])
  const base: Record<number, number> = {
    [HandCategory.HIGH_CARD]: 0.15, [HandCategory.PAIR]: 0.45, [HandCategory.TWO_PAIR]: 0.65, [HandCategory.TRIPS]: 0.75,
    [HandCategory.STRAIGHT]: 0.85, [HandCategory.FLUSH]: 0.9, [HandCategory.FULL_HOUSE]: 0.97, [HandCategory.QUADS]: 0.99,
    [HandCategory.STRAIGHT_FLUSH]: 1, [HandCategory.ROYAL_FLUSH]: 1,
  }
  let s = base[ev.category] ?? 0.15
  if (ev.category === HandCategory.HIGH_CARD && hole.some((c) => rankOf(c) >= 11)) s = 0.25
  if (community.length < 5) {
    const all = [...hole, ...community]
    const suits = new Map<number, number>()
    for (const c of all) suits.set(suitOf(c), (suits.get(suitOf(c)) ?? 0) + 1)
    if ([...suits.values()].some((n) => n === 4) && ev.category < HandCategory.FLUSH) s += 0.2
    const ranks = [...new Set(all.map(rankOf))].sort((a, b) => a - b)
    for (let i = 0; i + 3 < ranks.length; i++) if (ranks[i + 3]! - ranks[i]! === 3 && ev.category < HandCategory.STRAIGHT) s += 0.15
  }
  return clamp(s, 0, 1)
}

function decideHoldem(view: HandView, legal: LegalActions, rng: Rng): PlayerAction {
  const me = view.seats.find((s) => s.seat === view.mySeat)
  if (!me?.holeCards) return { kind: legal.kinds.includes('check') ? 'check' : 'fold' }
  const toCall = legal.callAmount
  const potOdds = toCall > 0 ? toCall / (view.pot + toCall) : 0
  const strength = clamp(handStrength(me.holeCards, view.community) + gaussian(rng, 0, 0.05), 0, 1)
  const opponents = view.seats.filter((s) => s.seat !== view.mySeat && !s.folded).length
  const can = (k: PlayerAction['kind']) => legal.kinds.includes(k)

  const sizeBet = (): PlayerAction => {
    const target = Math.round(view.pot * (0.5 + rng.int(26) / 100)) // ½–¾ pot
    if (can('bet')) return { kind: 'bet', amount: clamp(Math.max(target, legal.minBet), legal.minBet, legal.maxBet) }
    if (can('raise')) return { kind: 'raise', amount: clamp(Math.max(view.currentBet + target, legal.minRaiseTo), legal.minRaiseTo, legal.maxRaiseTo) }
    if (can('call')) return { kind: 'call' }
    return { kind: can('check') ? 'check' : 'fold' }
  }

  if (strength >= 0.7) return strength >= 0.95 && can('allIn') && rng.int(4) === 0 ? { kind: 'allIn' } : sizeBet()
  if (toCall === 0) {
    if (opponents <= 2 && rng.int(100) < 8 && (can('bet') || can('raise'))) return sizeBet() // bluff
    return { kind: can('check') ? 'check' : 'fold' }
  }
  if (strength >= potOdds + 0.05 && can('call')) return { kind: 'call' }
  if (can('allIn') && !can('call') && strength >= 0.5) return { kind: 'allIn' }
  return { kind: 'fold' }
}

export function createBotStrategy(): BotStrategy {
  return {
    decide(view, legal, rng) {
      const action = view.mode === 'blind' ? decideBlind(view, legal, rng) : decideHoldem(view, legal, rng)
      if (legal.kinds.includes(action.kind)) return action
      return { kind: legal.kinds.includes('check') ? 'check' : legal.kinds.includes('fold') ? 'fold' : legal.kinds[0]! }
    },
  }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './bot/chen.js'
export * from './bot/strategy.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck`
Expected: pass. If the blind play-rate assertion fails, print the rate and adjust `threshold` constants in `decideBlind` until the rate is in 0.3–0.8 across 2–8 players; do not loosen the test bounds.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): rule-based bot strategies for blind poker and hold'em

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 10: Economy constants, protocol types and validators

**Files:**
- Create: `packages/core/src/constants/economy.ts`, `packages/core/src/constants/economy.test.ts`, `packages/core/src/protocol/messages.ts`, `packages/core/src/protocol/validate.ts`, `packages/core/src/protocol/validate.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**
- Produces:
  - `ECONOMY` constant object (values from spec §12.2 / §11.2) and `dailyRewardPoints(streakDay: number): number` (spec §13.2, points column)
  - Protocol types: `ErrorCode`, `RoomConfig`, `HoldemRoomConfig`, `BlindRoomConfig`, `RoomSummary`, `RoomPlayerView`, `RoomView`, `RoomEvent`, `ClientMessage`, `ServerMessage`, `PlayerIdentity`
  - `type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string }`
  - `parseClientMessage(raw: unknown): ParseResult<ClientMessage>`
  - `validateRoomConfig(raw: unknown): ParseResult<RoomConfig>` — applies defaults, checks tiers and ranges
  - `roomConfigToRuleset(config: RoomConfig): Ruleset` — the engine rules derived from a room config (fee values from `ECONOMY`)

- [ ] **Step 1: Write failing tests**

`packages/core/src/constants/economy.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DAILY_REWARD_POINTS, ECONOMY, dailyRewardPoints } from './economy.js'

describe('economy constants', () => {
  it('matches the spec daily table', () => {
    expect(dailyRewardPoints(1)).toBe(5000)
    expect(dailyRewardPoints(7)).toBe(15000)
    expect(dailyRewardPoints(8)).toBe(10000)
    expect(dailyRewardPoints(14)).toBe(20000)
    expect(dailyRewardPoints(21)).toBe(25000)
    expect(dailyRewardPoints(28)).toBe(40000)
    expect(dailyRewardPoints(29)).toBe(12000)
    expect(dailyRewardPoints(31)).toBe(12000)
    expect(dailyRewardPoints(45)).toBe(12000)
    expect(dailyRewardPoints(0)).toBe(5000)
    expect(DAILY_REWARD_POINTS.reduce((a, b) => a + b, 0)).toBe(376000)
  })
  it('exposes tiers', () => {
    expect(ECONOMY.startingBalance).toBe(100000)
    expect(ECONOMY.blindWagerTiers).toEqual([1000, 2000, 5000, 10000, 20000, 50000])
    expect(ECONOMY.holdemBlindTiers.map((t) => t.bigBlind)).toEqual([200, 500, 1000, 2000, 5000])
  })
})
```

`packages/core/src/protocol/validate.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseClientMessage, roomConfigToRuleset, validateRoomConfig } from './validate.js'

const holdem = { name: 'Table 1', mode: 'holdem', maxPlayers: 6, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { smallBlind: 100, bigBlind: 200, minBuyInBB: 50, maxBuyInBB: 200 } }
const blind = { name: 'Blind', mode: 'blind', maxPlayers: 4, isPrivate: true, password: 'abcd', turnTimerSec: 15, autoStart: true, blind: { holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, botCount: 2 } }

describe('validateRoomConfig', () => {
  it('accepts a valid holdem config', () => {
    const r = validateRoomConfig(holdem)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.holdem).toEqual(holdem.holdem)
  })
  it('accepts a valid blind config and derives the ruleset', () => {
    const r = validateRoomConfig(blind)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(roomConfigToRuleset(r.value)).toEqual({ mode: 'blind', holeCards: 3, decisionMode: 'playOrFold', fixedWager: 5000, tableFeeRate: 0.02 })
    const h = validateRoomConfig(holdem)
    if (h.ok) expect(roomConfigToRuleset(h.value)).toEqual({ mode: 'holdem', smallBlind: 100, bigBlind: 200, tableFeeRate: 0.02, tableFeeCapBB: 1 })
  })
  it('applies defaults for optional fields', () => {
    const r = validateRoomConfig({ name: 'x', mode: 'holdem', holdem: { smallBlind: 50, bigBlind: 100 } })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toMatchObject({ maxPlayers: 6, isPrivate: false, turnTimerSec: 30, autoStart: false, holdem: { minBuyInBB: 50, maxBuyInBB: 200 } })
  })
  it.each([
    [{ ...holdem, holdem: { ...holdem.holdem, smallBlind: 123 } }, /blind tier/],
    [{ ...holdem, maxPlayers: 10 }, /maxPlayers/],
    [{ ...holdem, turnTimerSec: 20 }, /turnTimer/],
    [{ ...holdem, name: '' }, /name/],
    [{ ...holdem, password: 'ab' }, /password/],
    [{ ...blind, blind: { ...blind.blind, fixedWager: 1234 } }, /wager/],
    [{ ...blind, blind: { ...blind.blind, botCount: 4 } }, /botCount/],
    [{ ...blind, blind: { ...blind.blind, holeCards: 4 } }, /holeCards/],
    [{ ...blind, maxPlayers: 9 }, /maxPlayers/],
    [{ ...holdem, mode: 'omaha' }, /mode/],
    [{ ...holdem, holdem: undefined }, /holdem/],
    ['nope', /object/],
  ])('rejects %j', (input, message) => {
    const r = validateRoomConfig(input)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('INVALID_ROOM_CONFIG')
      expect(r.message).toMatch(message)
    }
  })
})

describe('parseClientMessage', () => {
  it('parses an ACTION with reqId and baseSeq', () => {
    const r = parseClientMessage({ t: 'ACTION', reqId: 'r1', baseSeq: 12, action: { kind: 'raise', amount: 300 } })
    expect(r).toEqual({ ok: true, value: { t: 'ACTION', reqId: 'r1', baseSeq: 12, action: { kind: 'raise', amount: 300 } } })
  })
  it('parses room messages', () => {
    expect(parseClientMessage({ t: 'JOIN_ROOM', code: 'ABC123' }).ok).toBe(true)
    expect(parseClientMessage({ t: 'SIT_DOWN', seat: 2, buyIn: 10000 }).ok).toBe(true)
    expect(parseClientMessage({ t: 'READY', ready: true }).ok).toBe(true)
    expect(parseClientMessage({ t: 'CREATE_ROOM', config: holdem }).ok).toBe(true)
    expect(parseClientMessage({ t: 'PONG' }).ok).toBe(true)
  })
  it.each([
    [null], ['ACTION'], [{ t: 'NOPE' }], [{ t: 'ACTION', action: { kind: 'fold' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet' } }],
    [{ t: 'ACTION', reqId: 'r', baseSeq: 1, action: { kind: 'bet', amount: 1.5 } }],
    [{ t: 'SIT_DOWN', seat: 'x' }], [{ t: 'READY' }], [{ t: 'JOIN_ROOM' }], [{ t: 'HELLO' }],
  ])('rejects %j with INVALID_MESSAGE', (input) => {
    const r = parseClientMessage(input)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_MESSAGE')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @bp/core test`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`packages/core/src/constants/economy.ts`:
```ts
export const ECONOMY = {
  startingBalance: 100_000,
  tableFeeRate: 0.02,
  tableFeeCapBB: 1,
  reliefThreshold: 5_000,
  reliefTarget: 5_000,
  reliefCooldownHours: 24,
  blindWagerTiers: [1_000, 2_000, 5_000, 10_000, 20_000, 50_000],
  holdemBlindTiers: [
    { smallBlind: 100, bigBlind: 200 },
    { smallBlind: 250, bigBlind: 500 },
    { smallBlind: 500, bigBlind: 1_000 },
    { smallBlind: 1_000, bigBlind: 2_000 },
    { smallBlind: 2_500, bigBlind: 5_000 },
  ],
  holdemTurnTimers: [15, 30, 45, 60],
  blindTurnTimers: [10, 15, 30],
  maxPlayersHoldem: 9,
  maxPlayersBlind: 8,
  buyInBBRange: { min: 20, max: 500 },
  defaultMinBuyInBB: 50,
  defaultMaxBuyInBB: 200,
  defaultMaxPlayers: 6,
  handIntervalSec: 5,
  reconnectWindowSec: 90,
  consecutiveTimeoutsToStand: 3,
} as const

/** Index 0 = streak day 1 … index 28 = day 29; days beyond use the last entry. */
export const DAILY_REWARD_POINTS: readonly number[] = [
  5_000, 6_000, 7_000, 8_000, 10_000, 12_000, 15_000,          // 1–7
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,               // 8–13
  20_000,                                                       // 14
  10_000, 10_000, 10_000, 10_000, 10_000, 10_000,               // 15–20
  25_000,                                                       // 21
  12_000, 12_000, 12_000, 12_000, 12_000, 12_000,               // 22–27
  40_000,                                                       // 28
  12_000, 12_000, 12_000,                                       // 29–31
]

export function dailyRewardPoints(streakDay: number): number {
  const idx = Math.min(Math.max(streakDay, 1), DAILY_REWARD_POINTS.length) - 1
  return DAILY_REWARD_POINTS[idx]!
}
```

`packages/core/src/protocol/messages.ts`:
```ts
import type { GameEvent, PlayerAction } from '../hand/types.js'
import type { HandView } from '../hand/view.js'

export type ErrorCode =
  | 'UNAUTHENTICATED' | 'INVALID_MESSAGE' | 'RATE_LIMITED' | 'ROOM_NOT_FOUND' | 'ROOM_FULL' | 'WRONG_PASSWORD'
  | 'INVALID_ROOM_CONFIG' | 'NOT_HOST' | 'SEAT_TAKEN' | 'INSUFFICIENT_BALANCE' | 'NOT_YOUR_TURN' | 'ILLEGAL_ACTION'
  | 'INVALID_AMOUNT' | 'STALE_STATE' | 'DUPLICATE_REQUEST' | 'NOT_IN_HAND' | 'NOT_IN_ROOM' | 'ALREADY_IN_ROOM'
  | 'NOT_SEATED' | 'GAME_IN_PROGRESS' | 'NOT_ENOUGH_PLAYERS' | 'DISPLAY_NAME_TAKEN' | 'SERVER_SHUTDOWN' | 'INTERNAL'

export interface PlayerIdentity {
  playerId: string
  displayName: string
  isBot: boolean
}

export interface HoldemRoomConfig {
  smallBlind: number
  bigBlind: number
  minBuyInBB: number
  maxBuyInBB: number
}

export interface BlindRoomConfig {
  holeCards: 2 | 3
  decisionMode: 'none' | 'playOrFold'
  fixedWager: number
  botCount: number
}

export interface RoomConfig {
  name: string
  mode: 'holdem' | 'blind'
  maxPlayers: number
  isPrivate: boolean
  password?: string
  turnTimerSec: number
  autoStart: boolean
  holdem?: HoldemRoomConfig
  blind?: BlindRoomConfig
}

export type SeatStatus = 'SEATED' | 'READY' | 'IN_HAND' | 'SITTING_OUT' | 'DISCONNECTED'

export interface RoomPlayerView {
  playerId: string
  displayName: string
  isBot: boolean
  isHost: boolean
  connected: boolean
  seat: number | null
  status: SeatStatus | null
  stack: number
  ready: boolean
  /** Opaque, edition-specific cosmetics (e.g. avatar config); core never interprets it. */
  cosmetics?: unknown
}

export interface RoomSummary {
  roomId: string
  code: string
  name: string
  mode: 'holdem' | 'blind'
  config: Omit<RoomConfig, 'password'> & { hasPassword: boolean }
  playerCount: number
  maxPlayers: number
  status: 'OPEN' | 'IN_GAME'
}

export interface RoomView extends RoomSummary {
  hostPlayerId: string
  players: RoomPlayerView[]
  carryOverPot: number
  nextHandAt: number | null
}

export type RoomEvent =
  | { type: 'PLAYER_JOINED'; player: RoomPlayerView }
  | { type: 'PLAYER_LEFT'; playerId: string }
  | { type: 'PLAYER_SAT'; playerId: string; seat: number; stack: number }
  | { type: 'PLAYER_STOOD'; playerId: string; seat: number }
  | { type: 'PLAYER_READY'; playerId: string; ready: boolean }
  | { type: 'HOST_CHANGED'; hostPlayerId: string }
  | { type: 'PLAYER_DISCONNECTED'; playerId: string; deadline: number }
  | { type: 'PLAYER_RECONNECTED'; playerId: string }
  | { type: 'ROOM_STATUS'; status: 'OPEN' | 'IN_GAME'; nextHandAt: number | null }
  | { type: 'ROOM_CLOSED'; reason: string }

export type ClientMessage =
  | { t: 'HELLO'; sessionToken: string }
  | { t: 'LIST_ROOMS' }
  | { t: 'CREATE_ROOM'; reqId?: string; config: RoomConfig }
  | { t: 'JOIN_ROOM'; reqId?: string; roomId?: string; code?: string; password?: string }
  | { t: 'LEAVE_ROOM' }
  | { t: 'SIT_DOWN'; reqId?: string; seat: number; buyIn?: number }
  | { t: 'STAND_UP' }
  | { t: 'READY'; ready: boolean }
  | { t: 'START_GAME' }
  | { t: 'KICK'; playerId: string }
  | { t: 'ACTION'; reqId: string; baseSeq: number; action: PlayerAction }
  | { t: 'RESYNC' }
  | { t: 'PONG' }

export type ServerMessage =
  | { t: 'WELCOME'; playerId: string; displayName: string; balance: number; serverTime: number }
  | { t: 'ROOM_LIST'; rooms: RoomSummary[] }
  | { t: 'ROOM_SNAPSHOT'; seq: number; room: RoomView; hand: HandView | null }
  | { t: 'GAME_EVENT'; seq: number; event: GameEvent & { deadlineAt?: number } }
  | { t: 'ROOM_EVENT'; seq: number; event: RoomEvent }
  | { t: 'BALANCE'; balance: number }
  | { t: 'NOTIFICATION'; kind: string; payload: unknown }
  | { t: 'ACK'; reqId: string }
  | { t: 'ERROR'; reqId?: string; code: ErrorCode; message: string }
  | { t: 'SESSION_REPLACED' }
  | { t: 'PING' }

export type ClientMessageType = ClientMessage['t']
export type ServerMessageType = ServerMessage['t']
```

`packages/core/src/protocol/validate.ts`:
```ts
import { ECONOMY } from '../constants/economy.js'
import type { PlayerAction, Ruleset } from '../hand/types.js'
import type { BlindRoomConfig, ClientMessage, ErrorCode, HoldemRoomConfig, RoomConfig } from './messages.js'

export type ParseResult<T> = { ok: true; value: T } | { ok: false; code: ErrorCode; message: string }

const fail = <T>(code: ErrorCode, message: string): ParseResult<T> => ({ ok: false, code, message })
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)
const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)
const isStr = (x: unknown): x is string => typeof x === 'string'
const isBool = (x: unknown): x is boolean => typeof x === 'boolean'

const ACTION_KINDS = new Set(['fold', 'check', 'call', 'bet', 'raise', 'allIn', 'play'])

function parseAction(raw: unknown): PlayerAction | null {
  if (!isObj(raw) || !isStr(raw.kind) || !ACTION_KINDS.has(raw.kind)) return null
  if (raw.kind === 'bet' || raw.kind === 'raise') {
    if (!isInt(raw.amount) || raw.amount <= 0) return null
    return { kind: raw.kind, amount: raw.amount }
  }
  return { kind: raw.kind as Exclude<PlayerAction['kind'], 'bet' | 'raise'> }
}

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  if (!isObj(raw) || !isStr(raw.t)) return fail('INVALID_MESSAGE', 'message must be an object with a string t')
  const reqId = isStr(raw.reqId) ? raw.reqId : undefined
  const withReq = <T extends object>(m: T): T & { reqId?: string } => (reqId === undefined ? m : { ...m, reqId })
  switch (raw.t) {
    case 'HELLO':
      return isStr(raw.sessionToken) && raw.sessionToken.length > 0 ? { ok: true, value: { t: 'HELLO', sessionToken: raw.sessionToken } } : fail('INVALID_MESSAGE', 'HELLO needs sessionToken')
    case 'LIST_ROOMS': case 'LEAVE_ROOM': case 'STAND_UP': case 'START_GAME': case 'RESYNC': case 'PONG':
      return { ok: true, value: { t: raw.t } }
    case 'CREATE_ROOM': {
      const cfg = validateRoomConfig(raw.config)
      return cfg.ok ? { ok: true, value: withReq({ t: 'CREATE_ROOM', config: cfg.value }) } : fail('INVALID_MESSAGE', cfg.message)
    }
    case 'JOIN_ROOM': {
      if (!isStr(raw.roomId) && !isStr(raw.code)) return fail('INVALID_MESSAGE', 'JOIN_ROOM needs roomId or code')
      const m: Extract<ClientMessage, { t: 'JOIN_ROOM' }> = { t: 'JOIN_ROOM' }
      if (isStr(raw.roomId)) m.roomId = raw.roomId
      if (isStr(raw.code)) m.code = raw.code.toUpperCase()
      if (isStr(raw.password)) m.password = raw.password
      return { ok: true, value: withReq(m) }
    }
    case 'SIT_DOWN': {
      if (!isInt(raw.seat) || raw.seat < 0) return fail('INVALID_MESSAGE', 'SIT_DOWN needs an integer seat')
      const m: Extract<ClientMessage, { t: 'SIT_DOWN' }> = { t: 'SIT_DOWN', seat: raw.seat }
      if (raw.buyIn !== undefined) {
        if (!isInt(raw.buyIn) || raw.buyIn <= 0) return fail('INVALID_MESSAGE', 'buyIn must be a positive integer')
        m.buyIn = raw.buyIn
      }
      return { ok: true, value: withReq(m) }
    }
    case 'READY':
      return isBool(raw.ready) ? { ok: true, value: { t: 'READY', ready: raw.ready } } : fail('INVALID_MESSAGE', 'READY needs boolean ready')
    case 'KICK':
      return isStr(raw.playerId) ? { ok: true, value: { t: 'KICK', playerId: raw.playerId } } : fail('INVALID_MESSAGE', 'KICK needs playerId')
    case 'ACTION': {
      const action = parseAction(raw.action)
      if (!isStr(raw.reqId) || !isInt(raw.baseSeq) || !action) return fail('INVALID_MESSAGE', 'ACTION needs reqId, baseSeq and a valid action')
      return { ok: true, value: { t: 'ACTION', reqId: raw.reqId, baseSeq: raw.baseSeq, action } }
    }
    default:
      return fail('INVALID_MESSAGE', `unknown message type ${raw.t}`)
  }
}

export function validateRoomConfig(raw: unknown): ParseResult<RoomConfig> {
  const bad = (m: string) => fail<RoomConfig>('INVALID_ROOM_CONFIG', m)
  if (!isObj(raw)) return bad('config must be an object')
  const name = isStr(raw.name) ? raw.name.trim() : ''
  if (name.length < 1 || name.length > 30) return bad('name must be 1–30 characters')
  if (raw.mode !== 'holdem' && raw.mode !== 'blind') return bad('mode must be holdem or blind')
  const mode = raw.mode
  const maxAllowed = mode === 'holdem' ? ECONOMY.maxPlayersHoldem : ECONOMY.maxPlayersBlind
  const maxPlayers = raw.maxPlayers === undefined ? Math.min(ECONOMY.defaultMaxPlayers, maxAllowed) : raw.maxPlayers
  if (!isInt(maxPlayers) || maxPlayers < 2 || maxPlayers > maxAllowed) return bad(`maxPlayers must be 2–${maxAllowed}`)
  const isPrivate = raw.isPrivate === undefined ? false : raw.isPrivate
  if (!isBool(isPrivate)) return bad('isPrivate must be boolean')
  const autoStart = raw.autoStart === undefined ? false : raw.autoStart
  if (!isBool(autoStart)) return bad('autoStart must be boolean')
  const timers: readonly number[] = mode === 'holdem' ? ECONOMY.holdemTurnTimers : ECONOMY.blindTurnTimers
  const turnTimerSec = raw.turnTimerSec === undefined ? (mode === 'holdem' ? 30 : 15) : raw.turnTimerSec
  if (!isInt(turnTimerSec) || !timers.includes(turnTimerSec)) return bad(`turnTimerSec must be one of ${timers.join(', ')}`)
  let password: string | undefined
  if (raw.password !== undefined && raw.password !== '') {
    if (!isStr(raw.password) || raw.password.length < 4 || raw.password.length > 20) return bad('password must be 4–20 characters')
    password = raw.password
  }
  const config: RoomConfig = { name, mode, maxPlayers, isPrivate, turnTimerSec, autoStart }
  if (password !== undefined) config.password = password

  if (mode === 'holdem') {
    const h = raw.holdem
    if (!isObj(h)) return bad('holdem settings are required')
    const tier = ECONOMY.holdemBlindTiers.find((t) => t.smallBlind === h.smallBlind && t.bigBlind === h.bigBlind)
    if (!tier) return bad('blinds must match a blind tier')
    const minBuyInBB = h.minBuyInBB === undefined ? ECONOMY.defaultMinBuyInBB : h.minBuyInBB
    const maxBuyInBB = h.maxBuyInBB === undefined ? ECONOMY.defaultMaxBuyInBB : h.maxBuyInBB
    const { min, max } = ECONOMY.buyInBBRange
    if (!isInt(minBuyInBB) || !isInt(maxBuyInBB) || minBuyInBB < min || maxBuyInBB > max || minBuyInBB > maxBuyInBB) return bad(`buy-in must be ${min}–${max} BB with min ≤ max`)
    const holdem: HoldemRoomConfig = { smallBlind: tier.smallBlind, bigBlind: tier.bigBlind, minBuyInBB, maxBuyInBB }
    config.holdem = holdem
  } else {
    const b = raw.blind
    if (!isObj(b)) return bad('blind settings are required')
    if (b.holeCards !== 2 && b.holeCards !== 3) return bad('holeCards must be 2 or 3')
    const decisionMode = b.decisionMode === undefined ? 'playOrFold' : b.decisionMode
    if (decisionMode !== 'none' && decisionMode !== 'playOrFold') return bad('decisionMode must be none or playOrFold')
    if (!isInt(b.fixedWager) || !(ECONOMY.blindWagerTiers as readonly number[]).includes(b.fixedWager)) return bad('fixedWager must match a wager tier')
    const botCount = b.botCount === undefined ? 0 : b.botCount
    if (!isInt(botCount) || botCount < 0 || botCount > maxPlayers - 1) return bad('botCount must be 0..maxPlayers-1')
    const blind: BlindRoomConfig = { holeCards: b.holeCards, decisionMode, fixedWager: b.fixedWager, botCount }
    config.blind = blind
  }
  return { ok: true, value: config }
}

export function roomConfigToRuleset(config: RoomConfig): Ruleset {
  if (config.mode === 'holdem') {
    const h = config.holdem!
    return { mode: 'holdem', smallBlind: h.smallBlind, bigBlind: h.bigBlind, tableFeeRate: ECONOMY.tableFeeRate, tableFeeCapBB: ECONOMY.tableFeeCapBB }
  }
  const b = config.blind!
  return { mode: 'blind', holeCards: b.holeCards, decisionMode: b.decisionMode, fixedWager: b.fixedWager, tableFeeRate: ECONOMY.tableFeeRate }
}
```

Append to `packages/core/src/index.ts`:
```ts
export * from './constants/economy.js'
export * from './protocol/messages.js'
export * from './protocol/validate.js'
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @bp/core test && pnpm --filter @bp/core typecheck && pnpm lint`
Expected: pass. The `it.each` rejection messages must match: "blind tier", "maxPlayers", "turnTimer", "name", "password", "wager", "botCount", "holeCards", "mode", "holdem", "object" — all present in the implementation strings above.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): economy constants, protocol types and message validators

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Architecture boundary test, README, final verification

**Files:**
- Create: `tooling/arch/boundaries.test.ts`, `README.md`
- Modify: `tooling/vitest.config.ts` (add `passWithNoTests` if not already)

**Interfaces:**
- Produces: a test that later plans extend when `server-kit`, `ui-kit`, and apps are added. `ALLOWED` map is the single source of truth for the dependency graph (spec §22.2).

- [ ] **Step 1: Write the boundary test**

`tooling/arch/boundaries.test.ts`:
```ts
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Allowed workspace dependencies per package (spec §22.2). Extend when packages are added. */
const ALLOWED: Record<string, string[]> = {
  '@bp/core': [],
  '@bp/server-kit': ['@bp/core'],
  '@bp/ui-kit': ['@bp/core'],
  '@bp/normal-server': ['@bp/core', '@bp/server-kit'],
  '@bp/normal-web': ['@bp/core', '@bp/ui-kit'],
  '@bp/lite': ['@bp/core', '@bp/server-kit', '@bp/ui-kit'],
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
    for (const file of listFiles(join(core.dir, 'src'))) {
      const src = readFileSync(file, 'utf8')
      expect(src, file).not.toMatch(/\bedition\b/i)
      expect(src, file).not.toMatch(/from ['"]@bp\//)
      expect(src, file).not.toMatch(/from ['"]node:/)
    }
  })
})
```

`tooling/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { name: 'tooling', include: ['arch/**/*.test.ts'], passWithNoTests: true } })
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Bind Poker

Real-time multiplayer poker (No-Limit Texas Hold'em + Blind Poker) with virtual points only.
Two editions from one codebase: **Normal** (public, PostgreSQL) and **Lite** (single Windows exe, SQLite).

Design: `docs/superpowers/specs/2026-09-04-bind-poker-design.md`.

## Development

```bash
pnpm install
pnpm test        # all workspaces
pnpm typecheck
pnpm lint
```

## Layout

- `packages/core` — pure game engine, bot, protocol (no I/O)
- `packages/server-kit` — rooms, WebSocket gateway, timers (planned)
- `packages/ui-kit` — shared React components, i18n (planned)
- `apps/normal-server`, `apps/normal-web`, `apps/lite` (planned)
```

- [ ] **Step 3: Run everything**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: all green — core suites (cards, evaluator, pots, common, holdem, blind, engine, bot, economy, validate) and the tooling boundary test.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test(arch): workspace boundary checks; add README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review notes (done while writing)

- Spec coverage for M1–M3: §7 (Task 6), §8 (Task 7), §9 (Task 9), §17 (Tasks 5–8), §20 types + §11.2 config validation (Task 10), §12.2/§13.2 constants (Task 10), §22.1–22.2 scaffold and boundaries (Tasks 1, 11). Room lifecycle, timers, reconnect, persistence are **Plan 2** (server-kit + Lite).
- Type consistency: `EngineError` messages are `"<CODE>: <detail>"` so tests can match `/CODE/`; `LegalActions` shape is identical in `holdemLegalActions` and `blindLegalActions`; `HandView` is the only thing bots see.
- Known simplifications recorded in spec §32: no dead button, simultaneous showdown reveal, a short all-in *bet* is treated like a short raise for reopening purposes.
