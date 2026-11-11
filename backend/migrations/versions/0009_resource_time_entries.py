"""Persistent task timers and manual timesheets."""
from alembic import op
from app.models import ResourceTimeEntry

revision = '0009_resource_time_entries'
down_revision = '0008_resource_management'
branch_labels = None
depends_on = None


def upgrade():
    ResourceTimeEntry.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
