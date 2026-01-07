#!/usr/bin/env bash
set -euo pipefail

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required but not installed. Please install the PostgreSQL client tools." >&2
  exit 127
fi

if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
  echo "SUPABASE_DB_PASSWORD is required to connect." >&2
  exit 1
fi

export PGPASSWORD="${SUPABASE_DB_PASSWORD}"
psql "postgresql://postgres:${SUPABASE_DB_PASSWORD}@db.kpcdcpnwvemeqedtvnsd.supabase.co:5432/postgres"
