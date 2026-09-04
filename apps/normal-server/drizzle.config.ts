import { defineConfig } from 'drizzle-kit'

// `pnpm --filter @bp/normal-server db:generate` writes SQL + journal into ./drizzle, which is
// committed: the runtime and the tests apply those files, they never generate them.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
})
