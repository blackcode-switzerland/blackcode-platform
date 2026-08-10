#!/usr/bin/env bash
# backup.sh — thin wrapper around the full-database pg_dump described in
# SAFETY.md. Not a substitute for the Neon branch (see SAFETY.md) — this is
# the "survives losing the Neon account" half.
#
# Usage:
#   ./backup.sh <connection-url> <destination-path>
#
# Refuses to run without an explicit destination, and refuses to report
# success if pg_dump wrote nothing useful — CLAUDE.md findings #7 and #15 are
# both "psql/pg_dump exited 0 having produced garbage or nothing."
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-db.sh
source "$SCRIPT_DIR/lib-db.sh"

if [ $# -lt 2 ] || [ -z "${2:-}" ]; then
  echo "usage: $0 <connection-url> <destination-path>" >&2
  echo "  destination-path is required — see SAFETY.md for where it should live" >&2
  echo "  (outside the repo, e.g. ~/Documents/BAK/blackcode-platform-backups/)." >&2
  exit 1
fi

URL="$1"
DEST="$2"

db_resolve_mode "$URL"
db_check_connection "$URL"

DEST_DIR="$(dirname "$DEST")"
mkdir -p "$DEST_DIR"

echo "dumping $(db_describe_target "$URL") -> $DEST" >&2

if [ "$DB_MODE" = "native" ]; then
  pg_dump "$URL" --format=custom --file="$DEST"
else
  # the container can't see the host filesystem: dump inside it, copy out.
  TMP_IN_CONTAINER="/tmp/$(basename "$DEST").$$"
  docker exec "$DB_DOCKER_CONTAINER" pg_dump "$URL" --format=custom --file="$TMP_IN_CONTAINER"
  docker cp "$DB_DOCKER_CONTAINER:$TMP_IN_CONTAINER" "$DEST"
  docker exec "$DB_DOCKER_CONTAINER" rm -f "$TMP_IN_CONTAINER"
fi

if [ ! -s "$DEST" ]; then
  echo "ERROR: pg_dump exited 0 but $DEST is empty or missing. Treat this as a FAILED backup." >&2
  exit 1
fi

SIZE=$(wc -c < "$DEST" | tr -d ' ')
if [ "$SIZE" -lt 1024 ]; then
  echo "ERROR: $DEST is only $SIZE bytes — too small to be a real dump of this database. Treat this as a FAILED backup." >&2
  exit 1
fi

# A custom-format dump that pg_restore can't list its own contents from is
# not a backup, whatever its size and exit code say.
if [ "$DB_MODE" = "native" ] && command -v pg_restore >/dev/null 2>&1; then
  if ! pg_restore --list "$DEST" >/dev/null 2>&1; then
    echo "ERROR: $DEST is not a valid pg_dump custom-format archive (pg_restore --list failed). Treat this as a FAILED backup." >&2
    exit 1
  fi
elif [ "$DB_MODE" = "docker" ]; then
  TMP_CHECK="/tmp/$(basename "$DEST").check.$$"
  docker cp "$DEST" "$DB_DOCKER_CONTAINER:$TMP_CHECK"
  if ! docker exec "$DB_DOCKER_CONTAINER" pg_restore --list "$TMP_CHECK" >/dev/null 2>&1; then
    docker exec "$DB_DOCKER_CONTAINER" rm -f "$TMP_CHECK"
    echo "ERROR: $DEST is not a valid pg_dump custom-format archive (pg_restore --list failed). Treat this as a FAILED backup." >&2
    exit 1
  fi
  docker exec "$DB_DOCKER_CONTAINER" rm -f "$TMP_CHECK"
fi

echo "OK: wrote $DEST ($SIZE bytes), verified non-empty and pg_restore-listable" >&2
