#!/usr/bin/env bash
# Manage the user-owned PostgreSQL cluster prepared for local development.
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PG_BIN="$PROJECT_ROOT/.local/postgresql-runtime/usr/lib/postgresql/16/bin"
PG_DATA="$PROJECT_ROOT/.local/postgres"
case "${1:-status}" in
  start) "$PG_BIN/pg_ctl" -D "$PG_DATA" -l "$PROJECT_ROOT/.local/postgres.log" start ;;
  stop) "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast stop ;;
  status) "$PG_BIN/pg_ctl" -D "$PG_DATA" status ;;
  *) echo 'Usage: bash scripts/local_postgres.sh {start|stop|status}' >&2; exit 2 ;;
esac
