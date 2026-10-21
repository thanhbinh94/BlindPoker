import { defineConfig, devices } from '@playwright/test'

/**
 * The operation-test pack: `docs/operation-test-plan.md`'s cases that a browser can play without a person, each
 * test named after its case id (`S-05`, `E-03`…). It is not part of `pnpm e2e:normal` — it plays whole hands
 * with two and three browsers, waits out timers and grace periods, and takes minutes. Run it with
 * `pnpm --filter @bp/normal-web e2e:ops` after `pnpm build:normal`.
 *
 * Same server as the e2e suite — the production `buildApp` on a throwaway PGlite — on its own port, so the two
 * can never share a database or a rate-limit bucket.
 */
const PORT = 8093
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: '.',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: './test-results/ops-report.json' }]],
  timeout: 600_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: BASE_URL,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: 'node ../normal-server/scripts/e2e-server.mjs',
    cwd: '../..',
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile|@landscape/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'mobile',
      grep: /@mobile/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, hasTouch: true, deviceScaleFactor: 2 },
    },
    {
      // Plan 26 (B8): a phone held sideways — 915 × 412 (a Galaxy-class Android in landscape), touch, the room's
      // landscape frame (`(orientation: landscape) and (max-height: 500px) and (min-width: 700px)`).
      name: 'landscape',
      grep: /@landscape/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 915, height: 412 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2.6 },
    },
  ],
})
