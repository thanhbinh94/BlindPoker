import { defineConfig, devices } from '@playwright/test'

/**
 * The Normal edition's end-to-end check. Like Lite's it is deliberately *not* part of `pnpm test`: it needs
 * the web build (`pnpm build:normal`) and a Chromium download (`pnpm exec playwright install chromium`,
 * ~150 MB). Run it with `pnpm e2e:normal`.
 *
 * What it drives is the real thing on both sides. `scripts/e2e-server.mjs` bundles `src/e2e-entry.ts` — the
 * production `buildApp`, its routes, its CSRF guard, its cookie session and its gateway — onto a throwaway
 * PGlite database, and serves `apps/normal-web/dist` from the same origin. So the browser here talks to the
 * same origin it will in production, over one cookie, with no proxy and no mock in between; a run leaves
 * nothing behind, because the database only ever existed inside the server process.
 */
const PORT = 8091
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: '.',
  // The operation-test pack (`ops/`, docs/operation-test-plan.md) runs on its own config and its own server:
  // it plays whole hands with several browsers and takes minutes, not seconds.
  testIgnore: ['ops/**'],
  outputDir: './test-results',
  // One worker, one server, one economy: these tests register accounts and move points, and a parallel run
  // would have them settling each other's hands.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE_URL,
    // Vietnamese is the product's default and every selector below is written in it; without an explicit
    // locale the browser would report `en-US` and the app would boot into English.
    locale: 'vi-VN',
    // The economy's day boundary is Asia/Ho_Chi_Minh (§10.3), and the daily test reads a calendar drawn
    // against it — a browser in another zone could disagree with the server about which day it is.
    timezoneId: 'Asia/Ho_Chi_Minh',
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    // `cwd` defaults to this directory; `..` is `apps/normal-web`, from which the sibling package's script
    // is one hop up — the same shape as the command a developer types at the repository root.
    command: 'node ../normal-server/scripts/e2e-server.mjs',
    cwd: '..',
    url: `${BASE_URL}/health`,
    // Never adopt a server that happens to be on this port: it might be a developer's own, against their own
    // database, and these tests would then spend real accounts and be unrepeatable.
    reuseExistingServer: false,
    // The first start also bundles the entry with esbuild and migrates a fresh PGlite.
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { E2E_PORT: String(PORT) },
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
