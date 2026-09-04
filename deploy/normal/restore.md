# Restoring the Normal edition's database

A restore replaces the live data. Read the whole page first; there is no undo past step 1.

The dumps `backup.sh` writes are PostgreSQL **custom format** (`pg_dump -Fc`) and are read back with
`pg_restore`, never with `psql`.

---

## ⚠️ Stop the app first

`app` holds a connection pool, and a restore that runs underneath it will either fail (the objects
it is dropping are in use) or leave the server holding stale, half-restored state.

```bash
cd deploy/normal
docker compose stop app
```

`db` stays up — the restore runs against it. Leave `caddy` alone: players get a 502 while the app is
down, which is the honest answer.

---

## 1. Take a dump of what is there now

Even if you believe the current data is worthless. It costs seconds and it is the only way back if
the dump you are about to restore turns out to be the wrong one.

```bash
./backup.sh
```

---

## 2. Restore

```bash
docker compose exec -T db pg_restore -U postgres -d bind_poker --clean --if-exists --no-owner \
  < backups/bp-2026-09-04-0315.dump
```

| Flag | Why |
| --- | --- |
| `-T` | No pseudo-terminal, so the binary dump on stdin arrives unmangled. As essential here as in `backup.sh`. |
| `--clean --if-exists` | Drop each object before recreating it, and do not complain about the ones that were not there. Without `--clean` the restore fails on every existing table; without `--if-exists` it prints an error per missing one. |
| `--no-owner` | Ignore the ownership recorded in the dump. Everything belongs to `postgres` in this deployment; carrying the old owner over is noise at best and a failure at worst. |

`pg_restore` prints warnings — dropped constraints that did not exist, `must be owner of extension
plpgsql` — and still exits 0. Read them, but a non-zero exit code is what a real failure looks like.

### Into an empty database instead

If `db` is a brand new volume, there is nothing to `--clean`:

```bash
docker compose exec -T db pg_restore -U postgres -d bind_poker --no-owner < backups/bp-….dump
```

The `bind_poker` database itself already exists — `POSTGRES_DB` in the compose file makes initdb
create it — so `--create` is not wanted.

---

## 3. Bring the schema up to the code, then start

The dump carries the schema as it was *when it was taken*. If the image has moved on since, it is
one migration run behind:

```bash
docker compose run --rm migrate
docker compose start app
docker compose logs -f app
```

`migrate` is idempotent: drizzle records what it has applied in the `drizzle.__drizzle_migrations`
table, which is part of the dump, so a dump that is already current makes this a no-op.

---

## 4. Check

```bash
curl -fsS https://$DOMAIN/health          # {"ok":true,…,"db":"ok"}
docker compose exec -T db psql -U postgres -d bind_poker -c 'select count(*) from users'
```

A `db":"down"` here means the app started before the restore finished; `docker compose restart app`.

---

## Restoring onto a different host

1. Copy the `.dump` file and your `.env` across.
2. `docker compose up -d db` and wait for it to report healthy (`docker compose ps`).
3. Restore into the empty database (step 2, second form).
4. `docker compose up -d` — `migrate` runs, then `app`, then `caddy`.

**`SESSION_SECRET` must come with you.** It is not in the database: it is the HMAC key the session
ids in `sessions` were signed with, so a new secret invalidates every row there and logs everyone
out. Passwords are unaffected — argon2 hashes carry their own salts.

---

## Rolling back a bad migration

There is no down-migration. The supported path is: restore the dump taken before the upgrade
(steps 1–2), then run the **old** image, not the new one:

```bash
docker compose stop app
docker compose exec -T db pg_restore -U postgres -d bind_poker --clean --if-exists --no-owner < backups/bp-before-upgrade.dump
git checkout <previous tag> && docker compose up -d --build
```

Which is the argument for taking a dump immediately before every upgrade — see
`../../docs/deployment-normal.md` §7.
