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
