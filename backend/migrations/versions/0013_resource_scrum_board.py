"""Store the shared Scrum / Planning board used by Resource Management."""
from alembic import op
import sqlalchemy as sa

revision = '0013_resource_scrum_board'
down_revision = '0012_resource_email_digest'
branch_labels = None
depends_on = None


def upgrade():
    if 'resource_scrum_board' not in sa.inspect(op.get_bind()).get_table_names():
        op.create_table(
            'resource_scrum_board',
            sa.Column('id', sa.Integer(), primary_key=True),
            sa.Column('data', sa.JSON(), nullable=False),
            sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        )


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
