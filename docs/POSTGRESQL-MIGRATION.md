# Local SQLite to PostgreSQL migration

The local application now uses PostgreSQL 16 on 127.0.0.1:5432, database
`qamanager`, application role `qa`. Connection credentials remain in the root
`.env`. `DATABASE_URL` is empty so the separate `DB_*` settings take effect.
The original `backend/dev.db` is retained and is no longer written by the app.

This machine has PostgreSQL clients but requires a sudo password for system
installation. A user-owned PostgreSQL 16 runtime and persistent database cluster
were therefore prepared in `.local/` (excluded from Git). The server listens on
localhost only. Role `qa` owns the app database and has no superuser, role creation
or database creation privileges. Cluster administration uses the local OS user
through a private Unix socket.

## Start and stop

After reboot, start PostgreSQL before starting the backend:

```sh
bash scripts/local_postgres.sh start
bash scripts/local_postgres.sh status
```

Start the backend from `backend/` as usual:

```sh
../.venv/bin/python -m uvicorn app.main:app --env-file ../.env --host 0.0.0.0 --port 8002
```

To stop the database, stop the backend first, then run:

```sh
bash scripts/local_postgres.sh stop
```

The local database is not installed as an automatically starting system service.
This runtime is for this workspace; Docker Compose continues to use its own
PostgreSQL container and volumes.

## Data verification

The migration copied all 30 application tables and 226 rows, including 75 test
cases, 29 resource tasks, 2 users, 5 automation runs and 2 HTML reports. Every row
was compared using canonical digests, including decoded JSON, timestamps and
binary content. SQLite timestamps are interpreted as UTC, matching the app's
writes. ID sequences were advanced beyond the copied IDs. The Alembic revision
was preserved. Existing admin login, data APIs and stored HTML report bytes were
verified after switching the backend to PostgreSQL.

The migration tool refuses a destination containing any public tables. It creates
schema, copies rows and verifies them in one PostgreSQL transaction, rolling
back on any error. It never clears or overwrites an existing destination.

For another migration, stop the app, back up SQLite and configure an empty
PostgreSQL destination in `.env`, then run from the repository root:

```sh
.venv/bin/python scripts/migrate_sqlite_to_postgres.py --source /path/to/sqlite-backup.db
```

The tool deliberately ignores `DATABASE_URL` and uses the PostgreSQL `DB_*`
fields. It does not switch app configuration automatically.

## Backups and rollback

The actual backup location is recorded in `.local/migration-backup-path`.
It contains the consistent SQLite snapshot, pre-migration `.env.sqlite`, uploaded
files archive when present, and a PostgreSQL dump after migration. The backup
folder is private; the environment backup contains secrets.

The running PostgreSQL data directory is `.local/postgres`. Keep this directory
and uploaded evidence when moving this workspace. Use PostgreSQL logical backups
for ongoing protection. The existing `scripts/backup.sh` targets Docker Compose,
not this user-owned local cluster.

If rollback is necessary, stop the backend, copy the backed-up `.env.sqlite` over
`.env` and restore the backed-up database to `backend/dev.db`, then restart the
backend. Any writes made to PostgreSQL after migration must be reconciled before
rolling back. Preserve PostgreSQL and both backups until that reconciliation is
complete.
