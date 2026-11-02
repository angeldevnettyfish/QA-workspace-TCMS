#!/usr/bin/env sh
set -eu

backup_dir="${1:-./backups}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$backup_dir"

docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' > "$backup_dir/qamanager-$timestamp.sql"
docker compose exec -T backend tar -C /app/uploads -czf - . > "$backup_dir/attachments-$timestamp.tar.gz"

test -s "$backup_dir/qamanager-$timestamp.sql"
test -s "$backup_dir/attachments-$timestamp.tar.gz"
printf 'Backup created: %s\n' "$timestamp"
