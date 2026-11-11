"""Configure the daily Resource Management email digest."""
from alembic import op
import sqlalchemy as sa

revision = '0012_resource_email_digest'
down_revision = '0011_local_run_script'
branch_labels = None
depends_on = None


def upgrade():
    if 'resource_email_settings' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'resource_email_settings',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('recipient', sa.String(length=320), nullable=False),
            sa.Column('send_time', sa.String(length=5), nullable=False, server_default='09:00'),
            sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column('last_attempt_on', sa.Date(), nullable=True),
            sa.Column('last_sent_on', sa.Date(), nullable=True),
            sa.Column('last_error', sa.Text(), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
