#!/usr/bin/env bash
# capture-baseline.sh — snapshot row counts + id ranges for the platform,
# issues and sales schemas, into a file verify.sh can diff against later.
#
# Usage:
#   ./capture-baseline.sh <connection-url> <output-file>
#
# Example (local dev):
#   ./capture-baseline.sh \
#     "postgresql://blackcode:blackcode_dev@localhost:5434/blackcode_issues" \
#     baseline.local-example.txt
#
# Refuses to write a baseline if it finds zero tables in those three schemas —
# an empty baseline would make verify.sh compare nothing against nothing,
# forever, and report green. See CLAUDE.md finding #16.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-db.sh
source "$SCRIPT_DIR/lib-db.sh"

if [ $# -lt 2 ]; then
  echo "usage: $0 <connection-url> <output-file>" >&2
  exit 1
fi

URL="$1"
OUT="$2"

db_resolve_mode "$URL"
db_check_connection "$URL"

echo "capturing baseline from: $(db_describe_target "$URL")" >&2

set +e
STATS="$(db_capture_stats "$URL")"
STATS_RC=$?
set -e
if [ $STATS_RC -ne 0 ]; then
  echo "ERROR: failed capturing table stats from $(db_describe_target "$URL")" >&2
  exit 1
fi
TABLE_COUNT=0
if [ -n "$STATS" ]; then
  TABLE_COUNT="$(printf '%s\n' "$STATS" | grep -c . || true)"
fi

if [ "$TABLE_COUNT" -eq 0 ]; then
  echo "ERROR: found 0 tables in schemas platform/issues/sales at $(db_describe_target "$URL")." >&2
  echo "       Refusing to write an empty baseline — it would silently make every future" >&2
  echo "       verify.sh run vacuous. Check the connection URL and schema names." >&2
  exit 1
fi

DBNAME="$(db_current_database "$URL")"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

{
  echo "# baseline captured ${TS}"
  echo "# database: ${DBNAME}"
  echo "# tables: ${TABLE_COUNT}"
  echo "# NOID = table has no integer id column; only count is tracked, min/max read NOID"
  echo "# NULL  = table had zero rows at capture time"
  echo "#"
  echo "# Declare an expected decrease BEFORE running the delete that causes it, e.g.:"
  echo "#   # EXPECTED 2026-08-12 phase-3 agent4"
  echo "#   # platform.comments -8   sales rows, parent_type LIKE 'sales:%'"
  echo "# verify.sh sums declarations per table and requires the actual decrease to match exactly."
  echo "#"
  echo "# schema.table<TAB>count<TAB>min_id<TAB>max_id"
  printf '%s\n' "$STATS" | sort
} > "$OUT"

echo "wrote $OUT ($TABLE_COUNT tables)" >&2
