import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'
import { FORBIDDEN_GLOBALS, NODE_BUILTINS } from './tooling/arch/node-builtins.js'

const CORE_PURITY = '@bp/core must be pure: no @bp packages, no Node built-ins, no host globals'
const WEB_ONLY = '@bp/normal-web may only depend on @bp/core and @bp/ui-kit, and runs in a browser'

const forbid = (patterns, message) => ({
  'no-restricted-imports': ['error', { patterns: patterns.map((group) => ({ group: [group], message })) }],
})

export default tseslint.config(
  // `.e2e/` is `scripts/e2e-server.mjs`'s esbuild output — a build artefact like `dist/`, and linting a
  // bundle only ever reports on the bundler's own bookkeeping.
  { ignores: ['**/dist/**', '**/release/**', '**/node_modules/**', '**/playground/dist/**', '**/.e2e/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['packages/ui-kit/**/*.{ts,tsx}', 'apps/**/*.{ts,tsx}'],
    plugins: { react },
    settings: { react: { version: '18.3' } },
    rules: {
      'react/jsx-no-literals': ['error', { noStrings: true, ignoreProps: true, allowedStrings: ['•', '·', '—', '–', '/', ':', '%', '(', ')', '×', '+', '−', '#'] }],
      'react/jsx-key': 'error',
    },
  },
  {
    // Test fixtures render throwaway markup, and the playground's control bar is a dev harness that never ships;
    // hoisting either one's literals into i18n keys would only obscure them.
    files: ['packages/ui-kit/**/*.test.tsx', 'apps/**/*.test.tsx', 'packages/ui-kit/playground/**/*.tsx'],
    rules: { 'react/jsx-no-literals': 'off' },
  },
  {
    /**
     * The Rules of Hooks, over every file that may contain a component or a hook — the shared
     * `ui-kit` and both editions' web apps. Exactly two of the plugin's rules are enabled rather
     * than its `recommended` preset: v7 ships two dozen React-Compiler lints whose verdicts this
     * codebase has never been held to, and turning them all on at once would bury the two that
     * catch real defects.
     *
     * `rules-of-hooks` is an error because every one of its reports is a bug that only shows up as
     * a corrupted hook order at runtime. `exhaustive-deps` is a warning because a *deliberately*
     * omitted dependency is a legitimate pattern (a mount-only effect, a ref-stable callback), and
     * the honest way to record one is an inline disable that says why — of which this tree has
     * four, each carrying its reason.
     */
    files: ['packages/ui-kit/**/*.{ts,tsx}', 'apps/lite/web/**/*.{ts,tsx}', 'apps/normal-web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
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
    // `@bp/http-kit` is the HTTP plumbing both editions share. Node built-ins are its business, but it
    // knows nothing about the game, the UI or either edition — so it imports no workspace package at all.
    files: ['packages/http-kit/**/*.ts'],
    rules: forbid(['@bp/*', 'react', '**/apps/**', '**/packages/core/**', '**/packages/server-kit/**', '**/packages/ui-kit/**'], '@bp/http-kit must not depend on any workspace package'),
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
  {
    // The Normal server is headless: it may reach for Node built-ins and for @bp/core, @bp/server-kit
    // and @bp/http-kit, but nothing that draws a screen and no other app. (This block replaces the
    // `apps/normal-*` one above for these files, so it repeats the no-lite rule.)
    files: ['apps/normal-server/**/*.ts'],
    rules: forbid(['@bp/ui-kit', 'react', 'react-dom', '@bp/lite', '@bp/normal-web', '**/apps/**'], '@bp/normal-server may only depend on @bp/core, @bp/server-kit and @bp/http-kit'),
  },
  {
    // The Normal web app is a browser bundle: @bp/core and @bp/ui-kit, and nothing else in the workspace —
    // no server package, no other app, and no Node built-in, which would not survive the bundle anyway.
    // (This block replaces the `apps/normal-*` one above for these files, so it repeats the no-lite rule.)
    files: ['apps/normal-web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: NODE_BUILTINS.filter((m) => !m.endsWith('*')).map((name) => ({ name, message: WEB_ONLY })),
        patterns: [
          // Package specifiers, and the relative ones that climb out of this app into another. The relative
          // half matters: `**/apps/**` alone never fires on `'../../../normal-server/…'`, which is how a
          // browser bundle would quietly acquire a dependency on a Postgres server.
          { group: ['@bp/server-kit', '@bp/http-kit', '@bp/lite', '@bp/normal-server', '**/apps/**', '**/normal-server/**', '**/lite/**'], message: WEB_ONLY },
          { group: NODE_BUILTINS.filter((m) => m.endsWith('*')), message: WEB_ONLY },
        ],
      }],
    },
  },
  {
    // The single exception, and it is a narrow one: a *test* may read the server's catalogue JSON, so that a
    // new item or achievement cannot ship as a raw key on a wardrobe tile. Only `data/` is opened up —
    // `**/normal-server/src/**` stays shut, so this can never become a door into the server's code, and
    // nothing that ships in the bundle is covered by it at all.
    files: ['apps/normal-web/**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: NODE_BUILTINS.filter((m) => !m.endsWith('*')).map((name) => ({ name, message: WEB_ONLY })),
        patterns: [
          { group: ['@bp/server-kit', '@bp/http-kit', '@bp/lite', '@bp/normal-server', '**/apps/**', '**/normal-server/src/**', '**/lite/**'], message: WEB_ONLY },
          { group: NODE_BUILTINS.filter((m) => m.endsWith('*')), message: WEB_ONLY },
        ],
      }],
    },
  },
  {
    // …and `vite.config.ts` / `vitest.config.ts`, which Node runs rather than the browser.
    files: ['apps/normal-web/*.config.ts'],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    // …and the two directories outside `src/` that Node runs too: `test/` measures the emitted bundle on
    // disk and `e2e/` drives a browser from outside it. Neither ships, and both need `node:` built-ins.
    // (Listed after the `*.test.{ts,tsx}` block above, which would otherwise still catch `test/*.test.ts`.)
    //
    // Only the Node-builtin half is lifted. Flat config is last-match-wins, so a bare
    // `'no-restricted-imports': 'off'` here would also cancel the *dependency-direction* guard these files
    // inherit — and an e2e helper could then reach into `../../normal-server/src/app.js` and start the
    // server in-process instead of driving the one under test. Nothing else would catch that:
    // `tooling/arch/boundaries.test.ts` reads the `package.json` graph, where a relative climb is invisible.
    files: ['apps/normal-web/test/**/*.ts', 'apps/normal-web/e2e/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@bp/server-kit', '@bp/http-kit', '@bp/lite', '@bp/normal-server', '**/apps/**', '**/normal-server/src/**', '**/lite/**'], message: WEB_ONLY },
        ],
      }],
    },
  },
)
