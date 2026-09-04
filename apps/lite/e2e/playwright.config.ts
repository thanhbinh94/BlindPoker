import { defineConfig, devices } from '@playwright/test'

/**
 * The Lite end-to-end check. It is deliberately *not* part of `pnpm test`: it needs the built artefacts
 * (`apps/lite/dist/server.cjs` + `apps/lite/dist/public`, from `pnpm --filter @bp/lite build`) and a Chromium
 * download (`pnpm exec playwright install chromium`, ~150 MB). Run it with `pnpm --filter @bp/lite e2e`.
 *
 * The server under test is the real one — the same `dist/server.cjs` the SEA exe wraps — with an in-memory
 * database, so a run leaves nothing behind and never touches a developer's `bind-poker.sqlite`.
 */
const PORT = 8090
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  // One worker, one server, one SQLite file: the tests share an economy, so they must not race each other.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    // Vietnamese is the product's default language and every selector below is written in it; without an
    // explicit locale the browser would report `en-US` and `detectLanguage` would pick English.
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node dist/server.cjs',
    cwd: '..',
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SQLITE_PATH: ':memory:',
      // `dist/public` relative to the server's working directory (`apps/lite`), the same layout `pnpm start` uses.
      PUBLIC_DIR: 'dist/public',
      LOG_LEVEL: 'warn',
    },
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      grep: /@mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true, deviceScaleFactor: 2 },
    },
  ],
})
