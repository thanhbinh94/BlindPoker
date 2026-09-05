/**
 * Helpers for *testing* an assembled Fastify app, kept out of `@bp/http-kit`'s main entry point so
 * nothing that ships can import them by accident. Same arrangement as `@bp/server-kit/testing`.
 */
export * from './routes.js'
