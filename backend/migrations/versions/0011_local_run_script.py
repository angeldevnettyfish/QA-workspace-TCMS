"""Store selected shell script for local automation runs."""
from alembic import op
import sqlalchemy as sa

revision = '0011_local_run_script'
down_revision = '0010_local_automation_runs'
branch_labels = None
depends_on = None


def upgrade():
    if 'local_script' not in {
        column['name'] for column in sa.inspect(op.get_bind()).get_columns('automation_runs')
    }:
        op.add_column('automation_runs', sa.Column('local_script', sa.String(120), nullable=True))


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
