"""Identify local runner automation jobs."""
from alembic import op
import sqlalchemy as sa

revision = '0010_local_automation_runs'
down_revision = '0009_resource_time_entries'
branch_labels = None
depends_on = None


def upgrade():
    if 'source' not in {
        column['name'] for column in sa.inspect(op.get_bind()).get_columns('automation_runs')
    }:
        op.add_column('automation_runs', sa.Column(
            'source', sa.String(20), nullable=False, server_default='bitbucket'))


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
