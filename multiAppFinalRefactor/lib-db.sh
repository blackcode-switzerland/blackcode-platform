#!/usr/bin/env bash
# lib-db.sh — shared psql plumbing for capture-baseline.sh, verify.sh, backup.sh.
#
# Sourced, not executed. Resolves whether to run psql natively or through the
# local dev container (this dev machine has no native psql — see README.md).
# Override the container name with DB_DOCKER_CONTAINER if yours differs.

DB_DOCKER_CONTAINER="${DB_DOCKER_CONTAINER:-blackcode-postgres}"
DB_MODE=""   # set by db_resolve_mode: "native" | "docker"

db_resolve_mode() {
  if command -v psql >/dev/null 2>&1; then
    DB_MODE="native"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$DB_DOCKER_CONTAINER"; then
    DB_MODE="docker"
    return
  fi
  echo "ERROR: no native psql found, and no running docker container named '$DB_DOCKER_CONTAINER'." >&2
  echo "       install psql, start the container (docker compose up -d), or set DB_DOCKER_CONTAINER." >&2
  exit 1
}

# Prints a connection URL with credentials masked, for log lines.
db_describe_target() {
  local url="$1"
  printf '%s\n' "$url" | sed -E 's#(://)[^:@/]+(:[^@/]*)?@#\1***@#'
}

# Runs a SQL script piped in on stdin against $1; prints tab-separated rows
# (-t -A -F <tab>), no header/footer. Requires db_resolve_mode to have run.
db_run() {
  local url="$1"
  if [ -z "$DB_MODE" ]; then
    echo "ERROR: db_run called before db_resolve_mode" >&2
    exit 1
  fi
  if [ "$DB_MODE" = "native" ]; then
    psql -X -q -v ON_ERROR_STOP=1 -t -A -F "$(printf '\t')" "$url"
  else
    docker exec -i "$DB_DOCKER_CONTAINER" psql -X -q -v ON_ERROR_STOP=1 -t -A -F "$(printf '\t')" "$url"
  fi
}

# Case (f): connection failed, or psql returned nothing. Exits non-zero with
# the psql output attached — never lets a silent failure look like a pass.
db_check_connection() {
  local url="$1"
  local out rc
  set +e
  out="$(printf '%s\n' "SELECT 1;" | db_run "$url" 2>&1)"
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ "$(printf '%s' "$out" | tr -d '[:space:]')" != "1" ]; then
    echo "ERROR: could not connect to, or query, $(db_describe_target "$url")" >&2
    echo "  psql said:" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    exit 1
  fi
}

db_current_database() {
  local url="$1" out rc
  set +e
  out="$(printf '%s\n' "SELECT current_database();" | db_run "$url" 2>&1)"
  rc=$?
  set -e
  if [ $rc -ne 0 ] || [ -z "$out" ]; then
    echo "ERROR: could not determine current_database() from $(db_describe_target "$url")" >&2
    printf '%s\n' "$out" | sed 's/^/    /' >&2
    exit 1
  fi
  printf '%s\n' "$out"
}

# Emits one line per base table in schemas platform/issues/sales:
#   schema.table<TAB>count<TAB>min_id<TAB>max_id
# min_id/max_id are the literal string NULL when the table is empty, or NOID
# when the table has no integer `id` column (recorded, never silently skipped).
db_capture_stats() {
  local url="$1"
  local tables id_tables sql t schema table has_id rc

  set +e
  tables="$(printf '%s\n' "
    SELECT table_schema || '.' || table_name
    FROM information_schema.tables
    WHERE table_schema IN ('platform','issues','sales') AND table_type = 'BASE TABLE'
    ORDER BY 1;
  " | db_run "$url" 2>&1)"
  rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "ERROR: table listing query failed against $(db_describe_target "$url")" >&2
    printf '%s\n' "$tables" | sed 's/^/    /' >&2
    exit 1
  fi

  if [ -z "$tables" ]; then
    return 0
  fi

  set +e
  id_tables="$(printf '%s\n' "
    SELECT table_schema || '.' || table_name
    FROM information_schema.columns
    WHERE table_schema IN ('platform','issues','sales')
      AND column_name = 'id'
      AND data_type IN ('integer','bigint','smallint')
    ORDER BY 1;
  " | db_run "$url" 2>&1)"
  rc=$?
  set -e
  if [ $rc -ne 0 ]; then
    echo "ERROR: id-column query failed against $(db_describe_target "$url")" >&2
    printf '%s\n' "$id_tables" | sed 's/^/    /' >&2
    exit 1
  fi

  sql=""
  while IFS= read -r t; do
    [ -z "$t" ] && continue
    schema="${t%%.*}"
    table="${t#*.}"
    if printf '%s\n' "$id_tables" | grep -qx "$t"; then
      has_id=1
    else
      has_id=0
    fi
    if [ -n "$sql" ]; then
      sql="${sql}
UNION ALL
"
    fi
    if [ "$has_id" -eq 1 ]; then
      sql="${sql}SELECT '${t}'::text, count(*)::text, min(id)::text, max(id)::text FROM \"${schema}\".\"${table}\""
    else
      sql="${sql}SELECT '${t}'::text, count(*)::text, 'NOID'::text, 'NOID'::text FROM \"${schema}\".\"${table}\""
    fi
  done <<< "$tables"

  printf '%s\n' "${sql};" | db_run "$url" | awk -F'\t' 'BEGIN{OFS="\t"} {
    min = $3; max = $4
    if (min == "") min = "NULL"
    if (max == "") max = "NULL"
    print $1, $2, min, max
  }'
}
