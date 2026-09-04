# The Normal edition's runtime image.
#
# Build from the *repository root*, because a workspace package cannot be installed without its
# workspace:
#
#     docker build -f apps/normal-server/Dockerfile -t bind-poker-normal .
#
# (`deploy/normal/docker-compose.yml` does exactly that: `context: ../..`.)
#
# Two stages. The builder holds pnpm, the TypeScript sources of every workspace package, and a C
# toolchain for `argon2`; the runtime holds `dist/`, its production `node_modules`, and the two
# directories the server reads from disk. Nothing else crosses.

# ---------------------------------------------------------------------------- builder

FROM node:22-alpine AS builder

# corepack is not enabled on this image and `corepack enable` has needed a network signature check
# since npm 10.9 — installing the pinned pnpm directly is one fewer thing to go wrong offline.
RUN npm i -g pnpm@9

# Belt and braces, not load-bearing: argon2 0.45.1 ships `prebuilds/linux-x64/argon2.musl.node` and
# its `node-gyp-build` install step picks that on Alpine x64. These are here so that a version bump
# or a new Node ABI, which would silently fall back to compiling from source, is a slower build
# rather than a failed one. Builder only — none of it reaches the runtime image.
RUN apk add --no-cache python3 make g++

WORKDIR /build

# The manifests first, so a source-only change reuses the install layer. *Every* workspace project's
# manifest has to be here, `apps/lite` included: `--frozen-lockfile` compares the lockfile's
# importers against the projects it can see, and a missing one reads as an out-of-date lockfile.
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/http-kit/package.json packages/http-kit/
COPY packages/server-kit/package.json packages/server-kit/
COPY packages/ui-kit/package.json packages/ui-kit/
COPY apps/lite/package.json apps/lite/
COPY apps/normal-server/package.json apps/normal-server/

# `--filter @bp/normal-server...` (with the trailing dots) is this package *and its workspace
# dependencies* — the Lite app, its React toolchain and Playwright are never installed.
RUN pnpm install --frozen-lockfile --filter @bp/normal-server...

# Now the sources the install layer does not depend on.
COPY tsconfig.base.json ./
COPY tooling/ tooling/
COPY packages/core/ packages/core/
COPY packages/http-kit/ packages/http-kit/
COPY packages/server-kit/ packages/server-kit/
COPY apps/normal-server/ apps/normal-server/

# tsc over what ships, then esbuild: `dist/main.js` and `dist/migrate-cli.js` with the three
# workspace packages inlined and every third-party dependency left as a run-time import.
RUN pnpm --filter @bp/normal-server build

# `pnpm deploy` writes a self-contained package: the manifest, the package's own files (`dist/`,
# `drizzle/`, `data/`) and a `node_modules` whose symlinks all point inside `/out`, which is what
# makes it safe to `COPY` into a stage that has no store behind it. `--prod` drops the devDeps —
# PGlite, drizzle-kit, esbuild, TypeScript — so nothing that only the tests and the build need is in
# the shipped image.
#
# pnpm 9 semantics: no `--legacy` flag exists here and none is needed. Verified on pnpm 9.15.9 —
# the output boots standalone, and its `node_modules` holds the six production dependencies and no
# devDependency at all.
#
# Two things break on pnpm 10, which is why the pin above is a pin and not a default: `deploy`
# refuses to run unless the workspace sets `inject-workspace-packages=true` (and then wants
# `--legacy`), and dependency install scripts no longer run by default (`onlyBuiltDependencies`),
# which silently skips argon2's `node-gyp-build` step. Moving to 10 means addressing both.
RUN pnpm --filter @bp/normal-server deploy --prod /out

# ---------------------------------------------------------------------------- runtime

FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# The image's own `node` user (uid 1000). Nothing here is ever written to: the database holds the
# state, and a read-only application directory is one less thing an exploit can use.
COPY --from=builder --chown=node:node /out /app

USER node
EXPOSE 8080

# `/health` answers 503 when the database is unreachable, so this is a real dependency check and not
# just "the process is alive". No curl in the image — Node's own fetch is already here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# The migrate job overrides this with `node dist/migrate-cli.js`; the server itself starts here.
# No init process and no shell: `main.ts` handles SIGTERM, and being PID 1 is how it receives one.
CMD ["node", "dist/main.js"]
