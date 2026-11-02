#!/usr/bin/env sh
set -eu

if [ "$#" -ne 2 ]; then
  printf 'Usage: scripts/restore.sh <database.sql> <attachments.tar.gz>\n' >&2
  exit 2
fi

if [ "${CONFIRM_RESTORE:-}" != "YES" ]; then
  printf 'Restore overwrites the live database. Set CONFIRM_RESTORE=YES after verifying the backup and maintenance window.\n' >&2
  exit 2
fi

database_backup="$1"
attachment_backup="$2"
test -s "$database_backup"
test -s "$attachment_backup"
docker compose stop backend
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
docker compose exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$database_backup"
docker compose run --rm -T --no-deps backend sh -c 'mkdir -p /app/uploads && find /app/uploads -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +' 
docker compose run --rm -T --no-deps backend sh -c 'tar -C /app/uploads -xzf -' < "$attachment_backup"
docker compose start backend
docker compose exec -T backend python -c "from app.main import SessionLocal; s=SessionLocal(); s.execute(__import__('sqlalchemy').text('SELECT 1')); s.close()"
printf 'Restore completed and database connection verified.\n'
