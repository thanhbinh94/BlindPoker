import { fileURLToPath } from 'node:url'
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
    // Every ops browser reads from the one loopback address, so the shipped 240 reads a minute overflowed (P-02 flake).
    // BP-41 (A-ops): the shipped chaos cards with Cá chép hóa rồng at 100 % energy and off by default, so the Thần case
    // (10-chaos.spec.ts, F-14) can force a Thần with a GM rule that turns it on; no other case can draw it.
    env: { E2E_PORT: String(PORT), E2E_READ_LIMIT: '2400', E2E_CHAOS_CARDS: fileURLToPath(new URL('./chaos-cards.ops.json', import.meta.url)) },
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile|@landscape|@s25p|@s25l/,
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
    {
      // BP-39: the Galaxy S25 held upright — 360 × 780 CSS px, touch — for the chaos table's toasts, result strip and bonus
      // hand (titles tagged `@s25p`). The stack layout, like `mobile`, but 15 px narrower and 32 px shorter.
      name: 's25p',
      grep: /@s25p/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
    },
    {
      // BP-39: the same phone on its side — 780 × 360, the landscape frame at its smallest common size (`@s25l`).
      name: 's25l',
      grep: /@s25l/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 780, height: 360 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 },
    },
  ],
})
