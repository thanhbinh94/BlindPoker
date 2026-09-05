/**
 * Build-time constants Vite substitutes into the bundle (`define` in `vite.config.ts`).
 *
 * Vitest runs the same sources without that config's `define`, so every one of these has to be read through a
 * `typeof` guard rather than used directly — `typeof` on an identifier that was never declared is the one
 * lookup JavaScript does not throw on, and esbuild folds the whole expression away in the real build.
 */
declare const __NORMAL_VERSION__: string
