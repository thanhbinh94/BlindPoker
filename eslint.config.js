import tseslint from 'typescript-eslint'
import { FORBIDDEN_GLOBALS, NODE_BUILTINS } from './tooling/arch/node-builtins.js'

const CORE_PURITY = '@bp/core must be pure: no @bp packages, no Node built-ins, no host globals'

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
    rules: {
      // Bare built-ins go through `paths` (exact specifiers): as `patterns` they would also match relative imports
      // that merely contain a segment of the same name, e.g. './constants/economy.js'.
      'no-restricted-imports': ['error', {
        paths: NODE_BUILTINS.filter((m) => !m.endsWith('*')).map((name) => ({ name, message: CORE_PURITY })),
        patterns: [
          { group: ['@bp/*', '**/server-kit/**', '**/ui-kit/**', '**/apps/**'], message: CORE_PURITY },
          { group: NODE_BUILTINS.filter((m) => m.endsWith('*')), message: CORE_PURITY },
        ],
      }],
      'no-restricted-globals': ['error', ...FORBIDDEN_GLOBALS],
    },
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
