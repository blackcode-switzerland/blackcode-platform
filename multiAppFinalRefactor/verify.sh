#!/usr/bin/env bash
# verify.sh — the "nothing lost" ledger. Re-measures platform/issues/sales and
# diffs against a baseline written by capture-baseline.sh. Exits non-zero on
# any unexplained decrease. This is the single check standing between this
# refactor and losing somebody's comments — see multiAppFinalRefactor/SAFETY.md.
#
# Usage:
#   ./verify.sh <connection-url> <baseline-file>
#
# Fails loudly (never silently passes) on all of:
#   (a) a count decreased without a matching EXPECTED declaration
#   (b) min(id) increased (oldest row gone), even if count is unchanged
#   (c) a table in the baseline is missing from the database
#   (d) a table in the database is missing from the baseline
#   (e) zero tables found, or the live table count differs from the baseline header
#   (f) the connection failed, or psql returned nothing
#
# Increases are printed as INFO, never as failures — people are using issues
# while this refactor happens.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-db.sh
source "$SCRIPT_DIR/lib-db.sh"

if [ $# -lt 2 ]; then
  echo "usage: $0 <connection-url> <baseline-file>" >&2
  exit 1
fi

URL="$1"
BASELINE="$2"

if [ ! -f "$BASELINE" ]; then
  echo "FAIL: baseline file not found: $BASELINE" >&2
  exit 1
fi

if [ ! -s "$BASELINE" ]; then
  echo "FAIL: baseline file is empty: $BASELINE" >&2
  exit 1
fi

# --- (e, header half): baseline must declare how many tables it covers -----
HEADER_COUNT="$(grep -m1 '^# tables:' "$BASELINE" | awk '{print $3}' || true)"
if ! [[ "$HEADER_COUNT" =~ ^[0-9]+$ ]] || [ "$HEADER_COUNT" -eq 0 ]; then
  echo "FAIL: baseline has no valid '# tables: N' header (got '${HEADER_COUNT}') — malformed or truncated baseline: $BASELINE" >&2
  exit 1
fi

# --- baseline data lines: must be well-formed, 4 tab-separated fields each -
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

BASE_DATA="$WORK_DIR/baseline-data.tsv"
grep -v '^#' "$BASELINE" | grep -v '^[[:space:]]*$' > "$BASE_DATA" || true

BAD_LINES="$(awk -F'\t' 'NF != 4 { print NR": "$0 }' "$BASE_DATA")"
if [ -n "$BAD_LINES" ]; then
  echo "FAIL: baseline has malformed data line(s) (expected 4 tab-separated fields):" >&2
  printf '%s\n' "$BAD_LINES" | sed 's/^/  /' >&2
  echo "Baseline is truncated or corrupt: $BASELINE" >&2
  exit 1
fi

BASE_TABLE_COUNT="$(wc -l < "$BASE_DATA" | tr -d ' ')"
if [ "$BASE_TABLE_COUNT" -eq 0 ]; then
  echo "FAIL: baseline declares ${HEADER_COUNT} tables but contains zero data rows: $BASELINE" >&2
  exit 1
fi

# --- declarations: parse "# EXPECTED ..." / "# schema.table delta reason" --
#
# `delta` is normally a signed row count (-8). It may also be the literal word
# DROPPED, which declares that the whole TABLE is expected to be gone — added
# 2026-08-10 for Phase 5, the only phase that drops tables.
#
# Without it a drop had no way to be declared at all: the diff engine's rule (c)
# fails a table that is in the baseline and absent from the database, and the
# delta arithmetic never runs because there is no live row to compare against. So
# the one phase whose whole job is dropping tables would have had to run against
# a guaranteed FAIL and re-capture afterwards — which is exactly the state where
# a real loss hides, because the operator is already expecting red.
DECL="$WORK_DIR/declarations.tsv"
awk '
  /^# EXPECTED / {
    meta = $0
    sub(/^# EXPECTED /, "", meta)
    if ((getline body) <= 0) { next }
    if (body !~ /^# /) { next }
    sub(/^# /, "", body)
    n = split(body, parts, /[ \t]+/)
    if (n < 2) { next }
    tbl = parts[1]; delta = parts[2]
    reason = ""
    for (i = 3; i <= n; i++) reason = reason (i > 3 ? " " : "") parts[i]
    print tbl "\t" delta "\t" reason " (declared " meta ")"
  }
' "$BASELINE" > "$DECL"

# --- (f): connection check, before anything else --------------------------
db_resolve_mode "$URL"
db_check_connection "$URL"

# --- live capture -----------------------------------------------------------
LIVE_DATA="$WORK_DIR/live-data.tsv"
set +e
db_capture_stats "$URL" > "$LIVE_DATA"
CAPTURE_RC=$?
set -e
if [ $CAPTURE_RC -ne 0 ]; then
  echo "ERROR: failed capturing live table stats from $(db_describe_target "$URL")" >&2
  exit 1
fi
LIVE_TABLE_COUNT="$(wc -l < "$LIVE_DATA" | tr -d ' ')"

# --- (e): zero live tables is always fatal, before any per-table diff ------
if [ "$LIVE_TABLE_COUNT" -eq 0 ]; then
  echo "FAIL: found 0 tables in schemas platform/issues/sales at $(db_describe_target "$URL")." >&2
  echo "      A connection that authenticates but sees no tables must never pass." >&2
  exit 1
fi

echo "verifying $(db_describe_target "$URL") against $BASELINE" >&2
echo "baseline: ${BASE_TABLE_COUNT} tables (header says ${HEADER_COUNT}) | live: ${LIVE_TABLE_COUNT} tables" >&2

if [ "$LIVE_TABLE_COUNT" != "$HEADER_COUNT" ]; then
  echo "NOTE: live table count differs from the baseline header — see the per-table FAIL lines below for which table(s)." >&2
fi

echo "" >&2

set +e
awk -v declfile="$DECL" -v basefile="$BASE_DATA" -v livefile="$LIVE_DATA" \
  -f "$SCRIPT_DIR/verify-diff.awk" "$DECL" "$BASE_DATA" "$LIVE_DATA"
RC=$?
set -e

exit $RC
