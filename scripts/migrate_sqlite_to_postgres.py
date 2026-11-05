#!/usr/bin/env python3
"""Copy a stopped app's SQLite snapshot to an empty PostgreSQL database.

The destination comes from DB_* fields in .env (DATABASE_URL is ignored here).
No existing target application data is overwritten. All inserts, schema creation
and version stamping use one transaction; every copied row is verified before
commit. Run with the backend stopped and retain a SQLite backup for rollback.
"""
import argparse
import hashlib
import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path

from dotenv import dotenv_values
from sqlalchemy import MetaData, Table, Column, String, create_engine, inspect, select, text

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'backend'))
from app.config import database_url
from app.models import Base


def normalized(value):
    if isinstance(value, datetime):
        return (value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)).isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, (bytes, bytearray, memoryview)):
        return {'binary_sha256': hashlib.sha256(bytes(value)).hexdigest()}
    raise TypeError(f'Unsupported value type: {type(value).__name__}')


def row_digest(row):
    raw = json.dumps(dict(row), default=normalized, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()


def order_self_references(table, rows):
    """Parents must precede children even if folders were reparented later."""
    columns = [fk.parent.name for fk in table.foreign_keys if fk.column.table is table]
    if not columns or not rows:
        return rows
    primary = list(table.primary_key.columns)
    if len(primary) != 1:
        raise RuntimeError(f'Unsupported self-reference key in {table.name}')
    key = primary[0].name
    pending = {row[key]: row for row in rows}
    ordered = []
    while pending:
        ready = [row for row in pending.values() if all(
            row[column] is None or row[column] == row[key] or row[column] not in pending
            for column in columns)]
        if not ready:
            raise RuntimeError(f'Cyclic parent references in {table.name}')
        for row in ready:
            ordered.append(row)
            del pending[row[key]]
    return ordered


def migrate(source_url, target_url):
    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url)
    if source_engine.dialect.name != 'sqlite' or target_engine.dialect.name != 'postgresql':
        raise RuntimeError('Expected a SQLite source and PostgreSQL destination')
    counts = {}
    version_table = Table('alembic_version', MetaData(), Column('version_num', String(32), primary_key=True))
    try:
        with source_engine.connect() as source, target_engine.begin() as target:
            # Serialize migration attempts on this database.
            target.execute(text('SELECT pg_advisory_xact_lock(712035116)'))
            source_tables = set(inspect(source).get_table_names())
            unknown = source_tables - set(Base.metadata.tables) - {'alembic_version'}
            if unknown:
                raise RuntimeError(f'Unrecognized source tables: {sorted(unknown)}')
            if 'alembic_version' not in source_tables:
                raise RuntimeError('SQLite source has no migration version')
            revisions = source.execute(select(version_table)).scalars().all()
            if len(revisions) != 1:
                raise RuntimeError('Expected one source migration revision')
            # Refuse any preexisting tables, including empty ones: use a fresh database.
            if inspect(target).get_table_names():
                raise RuntimeError('Destination is not empty; use a new database. Nothing was overwritten.')
            Base.metadata.create_all(target)
            version_table.create(target)
            for table in Base.metadata.sorted_tables:
                if table.name not in source_tables:
                    raise RuntimeError(f'Source missing table {table.name}; upgrade SQLite first')
                actual_columns = {col['name'] for col in inspect(source).get_columns(table.name)}
                model_columns = set(table.columns.keys())
                if actual_columns != model_columns:
                    raise RuntimeError(f'Schema mismatch in {table.name}; upgrade SQLite first')
                rows = [dict(row) for row in source.execute(select(table)).mappings()]
                # SQLite drops timezone offsets. App timestamps are UTC; bind them
                # explicitly so a local PostgreSQL timezone cannot shift history.
                rows = [{key: value.replace(tzinfo=timezone.utc)
                         if isinstance(value, datetime) and value.tzinfo is None else value
                         for key,value in row.items()} for row in rows]
                rows = order_self_references(table, rows)
                if rows:
                    target.execute(table.insert(), rows)
                counts[table.name] = len(rows)
                order = list(table.primary_key.columns)
                original = source.execute(select(table).order_by(*order)).mappings()
                copied = target.execute(select(table).order_by(*order)).mappings()
                original_hashes = [row_digest(row) for row in original]
                copied_hashes = [row_digest(row) for row in copied]
                if original_hashes != copied_hashes:
                    raise RuntimeError(f'Row verification failed for {table.name}; transaction rolled back')
                print(f'{table.name}: {len(rows)} rows verified')
            target.execute(version_table.insert(), [{'version_num': revision} for revision in revisions])
            for table in Base.metadata.sorted_tables:
                column = table.autoincrement_column
                if column is None:
                    continue
                sequence = target.execute(text('SELECT pg_get_serial_sequence(:table_name, :column_name)'),
                                          {'table_name': table.name, 'column_name': column.name}).scalar()
                if sequence:
                    max_id = target.execute(select(column).order_by(column.desc()).limit(1)).scalar()
                    target.execute(text('SELECT setval(CAST(:sequence AS regclass), :value, :has_rows)'),
                                   {'sequence':sequence, 'value':max_id if max_id is not None else 1, 'has_rows':max_id is not None})
        return counts
    finally:
        source_engine.dispose()
        target_engine.dispose()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True, help='SQLite backup file')
    args = parser.parse_args()
    if not args.source.is_file():
        parser.error('Source SQLite file does not exist')
    settings = dict(dotenv_values(ROOT / '.env'))
    settings.pop('DATABASE_URL', None)
    if not settings.get('DB_HOST'):
        parser.error('Set PostgreSQL DB_HOST, DB_PORT, DB_NAME, DB_USER and DB_PASSWORD in .env')
    try:
        counts = migrate(f'sqlite:///{args.source.resolve()}', database_url(settings))
    except Exception as exc:
        # Database drivers can include bound data in exceptions. Do not expose it.
        print(f'Migration failed ({type(exc).__name__}). Destination changes rolled back. Check schema, constraints and target availability.', file=sys.stderr)
        return 1
    print(f'Migration committed: {sum(counts.values())} rows across {len(counts)} application tables.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
