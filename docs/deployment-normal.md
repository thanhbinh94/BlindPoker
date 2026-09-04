# Deploying Bind Poker Normal

This is the operator's guide for the **Normal** edition: a Docker Compose stack on one host —
the app, PostgreSQL 16, and Caddy terminating TLS in front of them.

For the *other* edition, the single Windows executable meant for a LAN, see
[`deployment-lite.md`](deployment-lite.md). For the code behind this server — modules, events,
how to add an item — see [`normal-server.md`](normal-server.md).

Spec: §22.4 (build), §22.5 (env), §28.1 (deployment), §23 (security).

---

## 1. What you need

| | |
| --- | --- |
| **Host** | Linux, 2 vCPU / 2 GB RAM, ~10 GB disk. Docker Engine 24+ with the Compose v2 plugin. |
| **DNS** | An `A` (and `AAAA` if you have IPv6) record for your hostname pointing at the host, **already propagated**. Caddy asks Let's Encrypt for a certificate on its first start and that check happens over the public Internet. |
| **Ports** | 80 and 443 reachable from the Internet. Port 80 is not optional: it is how the ACME HTTP challenge works and how http→https redirects are served. |
| **Source** | A checkout of this repository on the host. The image is built there — there is no published image to pull. |

The database is *not* exposed and the app is *not* published on a host port. Caddy is the only
service with a port, by design.

---

## 2. First deployment

```bash
git clone <this repository> /srv/bind-poker
cd /srv/bind-poker/deploy/normal
cp .env.example .env
$EDITOR .env
```

Three values in `.env` have no default and must be set:

```bash
DOMAIN=poker.example.com

# openssl rand -base64 24
POSTGRES_PASSWORD=…

# node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
SESSION_SECRET=…
```

Check the file is understood before starting anything — this renders the whole stack with every
variable substituted, and fails loudly on a missing one:

```bash
docker compose config
```

Then:

```bash
docker compose up -d --build
docker compose ps
```

The first build takes several minutes (pnpm install, a TypeScript typecheck, and possibly compiling
`argon2` from source). Start-up order is enforced by the compose file, not by timing:

1. `db` starts and becomes healthy (`pg_isready -U postgres -d bind_poker`).
2. `migrate` runs `node dist/migrate-cli.js` against it and **exits 0**.
3. `app` starts.
4. `caddy` starts, obtains a certificate for `$DOMAIN`, and begins proxying.

```bash
curl -fsS https://$DOMAIN/health
# {"ok":true,"edition":"normal","version":"0.1.0","db":"ok","uptimeSec":…}
```

A `503` from that endpoint means the process is up but the database is not answering — which is
exactly what it is for, and what the container's own `HEALTHCHECK` uses.

### If the certificate does not appear

`docker compose logs caddy`. Almost always one of: DNS not pointing here yet, port 80 blocked by a
cloud firewall or already used by a host nginx, or a Let's Encrypt rate limit from repeated failed
attempts. Fix the cause and `docker compose restart caddy`.

---

## 3. The services

| Service | Image | Ports | Restart | Notes |
| --- | --- | --- | --- | --- |
| `db` | `postgres:16-alpine` | none | `unless-stopped` | Volume `pgdata`. Healthcheck names the database (`-d bind_poker`) so a still-initialising server is not called healthy. |
| `migrate` | built here | none | `no` | Applies the committed migrations and exits. A failure here stops `app` from starting — that is the point. |
| `app` | built here | none (8080 internal) | `unless-stopped` | `AUTO_MIGRATE=false`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`. |
| `caddy` | `caddy:2-alpine` | 80, 443, 443/udp | `unless-stopped` | Volumes `caddy_data` (ACME account + certificates) and `caddy_config`. |

**Why `migrate` is its own service and not a step in the app's entrypoint.** `app` restarts on
failure. A migration that ran at boot would run again on every restart of a crash loop, and again on
every replica the day you add one. As a separate service with `restart: "no"` it runs once, and
`depends_on: service_completed_successfully` makes "the schema is current" a precondition of the app
starting rather than a hope.

The app *can* migrate at boot — set `AUTO_MIGRATE=true` — and that is the right choice for a
single-container deployment somewhere else. It is the wrong choice here.

---

## 4. Environment reference

The compose file sets these; you only supply what `.env.example` lists. The server reads its
environment once at start-up, reports **every** problem at once, and refuses to start on any of
them — a bad value is never quietly replaced with a default.

| Variable | Set by | Default | Meaning |
| --- | --- | --- | --- |
| `DATABASE_URL` | compose, from `POSTGRES_PASSWORD` | required | `postgres://` or `postgresql://`. The scheme is checked at start-up. |
| `SESSION_SECRET` | `.env` | required | The HMAC key session ids are derived from; at least 32 characters. **Changing it logs everyone out.** Never appears in a log line. |
| `ALLOWED_ORIGINS` | compose, from `DOMAIN` | required | Comma-separated absolute origins (`https://host[:port]`, no path, no trailing slash). A WebSocket upgrade from anything else is refused. |
| `PORT` / `HOST` | — | `8080` / `0.0.0.0` | Inside the container. Changing them means changing the Caddyfile too. |
| `AUTO_MIGRATE` | compose | `true` | `false` here: `migrate` owns migrations. An unrecognised value stops the process rather than folding to the default. |
| `COOKIE_SECURE` | compose | `true` | `Secure` on the session cookie. Only ever `false` for a developer on plain `http://localhost`. |
| `TRUST_PROXY` | compose | `false` | `true` here, because Caddy sets `X-Forwarded-*`. See §9. |
| `ECONOMY_TIMEZONE` | `.env` | `Asia/Ho_Chi_Minh` | The IANA zone the daily check-in draws its day boundary in. |
| `LOG_LEVEL` | `.env` | `info` | `debug` \| `info` \| `warn` \| `error`. |
| `RECONNECT_WINDOW_SEC` | — | `90` | How long a disconnected seated player is held before the table folds for them (0–3600). |
| `PUBLIC_DIR` | — | *(unset)* | The built web bundle to serve at `/`. Unset means API-only, which is what this stack is until Plan 6 ships `normal-web`. |

`.env` is read from the app's working directory too, but **the real environment always wins** — a
deployment can set everything as container variables and ship no file at all.

---

## 5. Day-to-day

```bash
cd /srv/bind-poker/deploy/normal

docker compose ps                    # what is running, and health
docker compose logs -f app           # one JSON object per line, on stdout
docker compose logs --since 1h db
docker compose restart app           # config change in .env → restart, or `up -d` to recreate
docker compose exec -T db psql -U postgres -d bind_poker
```

`docker compose stop app` is graceful: the server catches `SIGTERM`, stops accepting connections,
cancels hands in progress and **refunds every wager and Hold'em stack through the ledger**, closes
sockets, then closes the pool. It gives itself 15 seconds before exiting non-zero. `docker compose
kill` skips all of that: recorded balances are safe (every entry is in a transaction) but stacks
sitting on tables are lost.

### Useful economy queries

```sql
-- The money invariant (spec §18.4): player balances plus sinks is constant.
select (select coalesce(sum(balance),0) from players) as balances,
       (select coalesce(sum(amount),0) from point_transactions where player_id is null) as sinks;

-- Where points flow.
select reason, count(*), sum(amount) from point_transactions group by reason order by 3;

-- How often the daily draw runs out of unowned cosmetics.
select count(*) from point_transactions where reason = 'daily_item_fallback';
```

---

## 6. Backup

```bash
cd /srv/bind-poker/deploy/normal
./backup.sh
```

Writes `backups/bp-<date>-<time>.dump` (`pg_dump -Fc`, a compressed custom-format dump), refuses to
keep a zero-byte file, and deletes dumps older than 14 days. It does not stop anything: `pg_dump`
runs in one transaction, so the dump is a snapshot of a single instant even mid-hand.

Daily, at 03:15:

```cron
15 3 * * * cd /srv/bind-poker/deploy/normal && ./backup.sh >> backup.log 2>&1
```

**A backup on the same host is not a backup.** Copy the dumps somewhere else — `rsync` to another
machine, an object store, anything that survives losing this host.

Two things are *not* in the dump and are needed to bring the data back up elsewhere:

- **`SESSION_SECRET`** — the key the session ids were signed with. Without it every session in the
  restored database is dead. (Passwords are fine: argon2 hashes carry their own salts.)
- **`caddy_data`** — the ACME account key and certificates. Losing it only costs a re-issue, but
  Let's Encrypt rate-limits those, so it is worth keeping.

Restoring is [`../deploy/normal/restore.md`](../deploy/normal/restore.md). Read it before you need
it.

---

## 7. Upgrading

```bash
cd /srv/bind-poker/deploy/normal
./backup.sh                          # 1. always, and immediately before
git -C /srv/bind-poker pull          # 2.
docker compose up -d --build         # 3. rebuild, rerun migrate, recreate app
docker compose logs -f app
```

`migrate` runs again as part of step 3, before `app` starts; drizzle records what it has applied, so
an unchanged schema makes it a no-op.

**Hands in progress do not survive the restart** (spec §32.8). They are cancelled and every wager
refunded, so nobody loses points — but people at a table will see a hand vanish. Upgrade when the
tables are empty if you can.

**There is no down-migration.** Rolling back means restoring the dump from step 1 and running the
previous image; the procedure is at the end of `restore.md`. This is why step 1 is not optional.

---

## 8. Changing the database password

`POSTGRES_PASSWORD` is read by `initdb` on the **first** start of the `pgdata` volume and never
again. Editing `.env` afterwards changes what the app connects *with*, not what the database
expects — the app then fails to authenticate. Change both, in this order:

```bash
docker compose exec -T db psql -U postgres -c "alter role postgres with password 'NEW'"
$EDITOR .env            # POSTGRES_PASSWORD=NEW
docker compose up -d    # recreates app and migrate with the new DATABASE_URL
```

---

## 9. Security notes

- **HTTPS only.** The session cookie is `HttpOnly; Secure; SameSite=Lax`, and `COOKIE_SECURE=true`
  means a browser will not send it over plain HTTP at all. There is no working HTTP deployment.
- **`TRUST_PROXY=true` is only correct behind Caddy.** It makes the server believe
  `X-Forwarded-For`. If anything can reach the app *around* the proxy, any caller can choose the
  address the rate limiters count against and pick a fresh one per request. This is why `app`
  publishes no host port — do not add one "for debugging".
- **Rate limits are per instance and in memory.** 10 registrations/min per IP, 5 logins/min per
  IP+email, mutating `/api/*` 60/min per session *and* 120/min per address, 240 reads/min per IP.
  They protect the process, not the account: with several replicas each gets its own counters.
  Password brute-forcing is contained by argon2id (m=64 MiB, t=3, p=1) more than by these numbers.
- **Secrets live in `.env` and nowhere else.** `chmod 600 .env`. Neither `DATABASE_URL` nor
  `SESSION_SECRET` is ever written to a log line, including the start-up line — check before pasting
  logs into an issue anyway.
- **The app runs as the `node` user**, not root, and writes nothing to its own filesystem.
- **`db` has no published port.** Reach it with `docker compose exec db psql`, or an SSH tunnel.
  Publishing 5432 to the Internet with a password-only superuser is how these hosts get owned.
- **There is no admin UI and no audit log.** Moderation is SQL against the database (spec §12.5).

---

## 10. Troubleshooting

| Symptom | What it is |
| --- | --- |
| `docker compose config` fails with `POSTGRES_PASSWORD is required` | No `.env` in `deploy/normal`, or the variable is empty. Compose refuses before anything starts, on purpose. |
| `migrate` exits non-zero, `app` never starts | `docker compose logs migrate`. Usually a wrong password (`password authentication failed`) or a migration that conflicts with data already in the database. `app` staying down is correct — a server on a half-applied schema is worse. |
| `app` logs `Invalid configuration:` and exits | The list under it names every problem at once. Fix them all, `docker compose up -d`. |
| App is up, `/health` says `"db":"down"` | The pool cannot reach `db`. Check `docker compose ps db` and its logs; the app recovers on its own once the database answers. |
| `502 Bad Gateway` from Caddy | `app` is not listening. `docker compose logs app` — a boot failure, or it is still starting. |
| Certificate never issues | See §2. DNS, port 80, or an ACME rate limit. |
| WebSocket connects then closes immediately | `ALLOWED_ORIGINS` does not contain the origin the page was served from. It is derived from `DOMAIN`; a browser at `https://www.example.com` needs that exact origin listed. |
| Everyone logged out after a deploy | `SESSION_SECRET` changed. It must be stable across deployments. |
| `docker compose down -v` | Deletes `pgdata` **and** `caddy_data`. That is the whole database. `down` without `-v` is what you meant. |
| Build fails compiling `argon2` | The builder stage installs `python3 make g++` for exactly this; if it still fails, the log line above the failure is the real error (usually out of memory on a small host). |
