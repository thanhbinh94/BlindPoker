# Bind Poker — Plan 9: free-tier deployment kits (Windows LAN test, Oracle Always Free public)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two runbooks + scripts so the Normal edition runs for free: F1 on a Windows machine in a LAN (Node 22 + Neon Postgres, no Docker, HTTP), and F2 on an Oracle Cloud Always Free ARM VM with the existing Docker Compose stack (HTTPS via Caddy, public DNS). No application code changes.

**Architecture:** `deploy/normal-windows/` holds PowerShell scripts that set env vars and spawn the built server (`apps/normal-server/dist/main.js`) with `PUBLIC_DIR` pointing at `apps/normal-web/dist`; `deploy/oracle/` holds an idempotent Ubuntu bootstrap and a Vietnamese runbook around the unchanged `deploy/normal/docker-compose.yml`. Docs cross-link.

**Tech Stack:** Windows PowerShell 5.1 (must work; `pwsh` optional), bash (Ubuntu 24.04 arm64), Docker Compose (unchanged), Vitest for a dry-run test of the PowerShell script.

**Spec:** `docs/superpowers/specs/2026-09-07-deployment-free-tiers-design.md` (§3 F1, §4 F2, §5 tests, Appendix decisions D1–D4); main spec §22.5, §28.1.

## Global Constraints
- No changes under `apps/`, `packages/` or `deploy/normal/` except additive comments; the Dockerfile/Compose stay as they are.
- Secrets never committed: `.env.example` files carry `CHANGE_ME` placeholders that `loadConfig` refuses; `.gitignore` covers `deploy/normal-windows/.env`, `deploy/normal-windows/normal.pid`, `deploy/normal-windows/*.log`.
- Runbooks are Vietnamese (operator-facing), scripts commented in English; every command in a runbook is copy-pasteable and was tried where the dev machine allows (PowerShell scripts run here; bash only syntax-checked).
- `main.ts` reads `.env` from the **current working directory** and env vars win — the Windows script must `Set-Location apps/normal-server` (or pass a cwd) and put every variable into `$env:` before spawning; `PUBLIC_DIR` relative paths resolve from that cwd, so the script converts it to an absolute path.
- Commits end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Consumed facts (verified)
```text
apps/normal-server/src/main.ts: env = { ...readDotenv('.env'), ...process.env }; AUTO_MIGRATE read there; required DATABASE_URL, SESSION_SECRET (≥32), ALLOWED_ORIGINS (absolute origins CSV); TRUST_PROXY false|uniquelocal|loopback|linklocal|CIDR list ('true' rejected); COOKIE_SECURE default true; PUBLIC_DIR relative → resolve(process.cwd(), …)
apps/normal-server/dist/{main.js,migrate-cli.js} + drizzle/ + data/ siblings (pnpm build:normal); migrate-cli exits non-zero on failure with a named error
Windows: powershell.exe 5.1 present, pwsh absent; shellcheck absent
deploy/normal/{docker-compose.yml,Caddyfile,.env.example,backup.sh,restore.md}; docs/deployment-normal.md (Vietnamese) §2 pre-flight already says the image was never built
```

## File Structure
```text
deploy/normal-windows/run.ps1, stop.ps1, .env.example, README.md      T1
deploy/normal-windows/run.test.ts (vitest, DryRun; skipIf no powershell)  T1
deploy/oracle/bootstrap.sh, README.md, backup-cron.example              T2
docs/deployment-normal.md (+ two pointers), README.md ("Chạy thử miễn phí"), docs/known-limitations.md, .gitignore, root vitest include if needed   T2
```

---

### Task 1: Windows LAN kit (F1)

**Files:** create `deploy/normal-windows/run.ps1`, `stop.ps1`, `.env.example`, `README.md`, `run.test.ts`; modify `.gitignore`, root `vitest.config.ts`/workspace so `deploy/**/*.test.ts` runs (check how `tooling/arch/*.test.ts` is picked up and mirror it).

**`run.ps1` contract:** parameters `-EnvFile` (default `.env` beside the script), `-DryRun`, `-NoMigrate`, `-Port` (override). Steps: (1) locate repo root from the script path; (2) require `node` ≥ 22.13 (`node -v`), `apps/normal-server/dist/main.js`, `apps/normal-server/dist/migrate-cli.js`, `apps/normal-web/dist/index.html` — print the exact `pnpm build:normal` hint if missing; (3) parse the env file: skip blanks and `#` lines, split on the first `=`, trim, strip matching quotes; refuse if `DATABASE_URL`/`SESSION_SECRET` missing or contain `CHANGE_ME`, if `SESSION_SECRET` < 32 chars; (4) detect the LAN IPv4 (`Get-NetIPAddress -AddressFamily IPv4` on Ethernet/Wi-Fi, non-loopback, non-APIPA; fallback `localhost`) and substitute `<IP-LAN>` in `ALLOWED_ORIGINS`; (5) make `PUBLIC_DIR` absolute (default `apps/normal-web/dist`); (6) set every variable into `$env:` (never write a `.env` into `apps/normal-server`); (7) unless `-NoMigrate`, run `node dist/migrate-cli.js` from `apps/normal-server` and stop on non-zero; (8) `-DryRun` prints the normalised config (secrets masked) and the two commands, then exits 0; else start `node dist/main.js` via `Start-Process` with `-PassThru`, write the pid to `normal.pid`, print `http://localhost:<port>` and `http://<IP-LAN>:<port>`, and the firewall command. `stop.ps1`: read the pid, `Stop-Process` if alive, remove the pid file, warn that this is a hard stop.

**`.env.example`:** the §3 variables with `CHANGE_ME` placeholders and Vietnamese comments (how to get Neon's URL, `openssl`/PowerShell one-liner for the secret).

**`README.md` (Vietnamese):** prerequisites, Neon sign-up steps (menu names), `.env`, run, firewall rule, LAN URL, optional Cloudflare tunnel section with the three env changes, stop semantics, troubleshooting (port busy, `CHANGE_ME`, Neon sleeping, `PUBLIC_DIR` missing).

- [ ] **Step 1: Test first** — `run.test.ts` spawns `powershell -NoProfile -ExecutionPolicy Bypass -File run.ps1 -DryRun -EnvFile <temp env>` and asserts: missing `DATABASE_URL` → non-zero + message; `CHANGE_ME` → non-zero; a good env → exit 0, output contains `PUBLIC_DIR=<absolute path>`, `ALLOWED_ORIGINS` with the substituted IP or localhost, masked secret, and the two commands; skip with a warning when `powershell` is absent (Linux CI).
- [ ] **Step 2: Implement** the scripts and docs; try `run.ps1` for real against the PGlite e2e server? Not possible (needs a Postgres URL) — instead run `-DryRun` and, with `-NoMigrate` and a fake `DATABASE_URL`, start `main.js` to confirm it fails fast with the connection error and the script surfaces it (documented in the report).
- [ ] **Step 3:** `pnpm test`, `pnpm lint`. Commit `feat(deploy): Windows LAN kit for the Normal edition`.

---

### Task 2: Oracle Always Free kit (F2) + docs

**Files:** create `deploy/oracle/bootstrap.sh`, `README.md`, `backup-cron.example`; modify `docs/deployment-normal.md` (two pointers), `README.md` (section "Chạy thử miễn phí" linking both kits), `docs/known-limitations.md` (Neon sleep, Oracle idle reclaim, ARM image unbuilt at dev), `.gitignore` if needed.

**`bootstrap.sh` contract:** `#!/usr/bin/env bash`, `set -euo pipefail`, must run as root (`sudo`), parameters `REPO_URL` (required) and `BRANCH` (default `master`), idempotent: iptables INPUT ACCEPT for tcp 80/443 inserted before Oracle's REJECT rule if absent + `netfilter-persistent save` (install `iptables-persistent` non-interactively); 2 GB swapfile if `swapon --show` is empty; Docker Engine + compose plugin from `download.docker.com` (arm64 or amd64 from `dpkg --print-architecture`); `usermod -aG docker ubuntu`; `unattended-upgrades` enabled; `git`; clone into `/opt/bind-poker` or `git pull` if present; `chown -R ubuntu`; print next steps (edit `.env`, `docker compose … up -d --build`, DNS). Every step prints what it did or skipped.

**`README.md` (Vietnamese):** account (card verification, PAYG note), create VM A1.Flex (shape, image, SSH key, "Out of capacity" retry), Security List ingress rules, SSH in, run bootstrap (`curl -fsSL … | sudo bash -s -- <repo>` or scp), `.env` with the §4 values, DNS A record or `sslip.io`, `up -d --build` with what to expect on the first (ARM) image build and where to look if it fails, `/health` check, backup cron install, update/rollback, pre-flight tests with `TEST_DATABASE_URL` (open 5432 temporarily or run on the VM), costs/limits.

- [ ] **Step 1:** write `bootstrap.sh`; `bash -n bootstrap.sh`; run shellcheck if available (it is not on this machine — record); add a Vitest `deploy/oracle/bootstrap.test.ts` that asserts `bash -n` passes and that the script contains the idempotency guards (grep for `swapon --show`, `dpkg --print-architecture`, `netfilter-persistent`) — skip if `bash` is absent.
- [ ] **Step 2:** README + cron example + docs pointers + root README + known-limitations.
- [ ] **Step 3:** `pnpm test`, `pnpm lint`. Commit `feat(deploy): Oracle Always Free kit and free-tier runbooks`.

---

## Self-review
- Spec coverage: §3 → T1; §4 → T2; §5 → T1 Step 1, T2 Step 1; S3 docs → T2.
- No app code changes; both tasks independent (different directories; docs only in T2).
