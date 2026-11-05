"""Cross-database data normalization needed by the offline migration helper."""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import Table, MetaData, Column, Integer, ForeignKey

spec = importlib.util.spec_from_file_location('sqlite_migration', Path(__file__).resolve().parents[2] / 'scripts/migrate_sqlite_to_postgres.py')
migration = importlib.util.module_from_spec(spec)
spec.loader.exec_module(migration)


def test_timestamp_checks_preserve_utc_across_database_timezones():
    source = {'created_at': datetime(2026, 11, 5, 10, 0)}
    destination = {'created_at': datetime(2026, 11, 5, 15, 30, tzinfo=timezone(timedelta(hours=5, minutes=30)))}
    assert migration.row_digest(source) == migration.row_digest(destination)
    changed = {'created_at': datetime(2026, 11, 5, 10, 0, tzinfo=timezone(timedelta(hours=5, minutes=30)))}
    assert migration.row_digest(source) != migration.row_digest(changed)


def test_json_and_report_verification_checks_values_not_mapping_order():
    source = {'data':{'a':1,'b':['Passed',None]}, 'content': b'<html>report</html>'}
    destination = {'content': memoryview(b'<html>report</html>'), 'data':{'b':['Passed',None], 'a':1}}
    assert migration.row_digest(source) == migration.row_digest(destination)
    destination['content'] = b'<html>different report</html>'
    assert migration.row_digest(source) != migration.row_digest(destination)


def test_reparented_folders_are_inserted_after_their_parent():
    folders = Table('folders', MetaData(), Column('id',Integer,primary_key=True), Column('parent_id',Integer,ForeignKey('folders.id')))
    rows = [{'id':1,'parent_id':3},{'id':2,'parent_id':1},{'id':3,'parent_id':None}]
    assert [row['id'] for row in migration.order_self_references(folders,rows)] == [3,1,2]
    with pytest.raises(RuntimeError,match='Cyclic'):
        migration.order_self_references(folders,[{'id':1,'parent_id':2},{'id':2,'parent_id':1}])
