#!/usr/bin/env bash
#
# A consistent dump of the Normal edition's database, taken from the running stack.
#
#     cd deploy/normal && ./backup.sh
#
# Run it from *this* directory (it uses the compose file beside it) on the host running the stack.
# It does not stop anything: `pg_dump` runs inside a single transaction, so the dump is a snapshot
# of one instant even while people are playing.
#
# Restore is the other half and lives in restore.md — read it before you need it, not after.
#
# Cron, daily at 03:15, keeping the output where you can see it:
#     15 3 * * * cd /srv/bind-poker/deploy/normal && ./backup.sh >> backup.log 2>&1

set -euo pipefail

cd "$(dirname "$0")"

# The custom format (`-Fc`): compressed, and `pg_restore` can read it selectively — a plain SQL
# dump can only ever be replayed whole.
BACKUP_DIR="${BACKUP_DIR:-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%F-%H%M)"
TARGET="${BACKUP_DIR}/bp-${STAMP}.dump"

mkdir -p "$BACKUP_DIR"

# `-T`: no TTY. Without it the dump arriving on stdout goes through a pseudo-terminal, which
# corrupts a binary stream. This is the single most important flag on this line.
docker compose exec -T db pg_dump -U postgres -Fc bind_poker > "$TARGET"

# A zero-byte file is what a failed dump leaves behind when the redirect succeeded and the command
# did not. Refusing to keep it means the retention sweep below can never leave you with nothing but
# empty files.
if [ ! -s "$TARGET" ]; then
  rm -f "$TARGET"
  echo "backup failed: $TARGET was empty" >&2
  exit 1
fi

echo "wrote $TARGET ($(du -h "$TARGET" | cut -f1))"

# Retention. Only files this script's own naming produced are ever considered.
deleted=$(find "$BACKUP_DIR" -maxdepth 1 -name 'bp-*.dump' -type f -mtime "+${RETENTION_DAYS}" -print -delete | wc -l)
echo "pruned ${deleted} backup(s) older than ${RETENTION_DAYS} days"
