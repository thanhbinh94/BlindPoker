/**
 * Helpers for *testing* an assembled Fastify app, kept out of `@bp/http-kit`'s main entry point so
 * that importing them into something that ships has to be a deliberate act — `@bp/http-kit/testing`
 * is a subpath somebody has to type. Same arrangement as `@bp/server-kit/testing`, and the same
 * caveat: it is a convention, not a rule an ESLint block or an arch test enforces yet.
 */
export * from './routes.js'
