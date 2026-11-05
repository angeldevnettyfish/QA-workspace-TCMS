"""Sprint resource tracking and CSV import history."""
from alembic import op
from app.models import ResourceSprint, ResourceItem, ResourceImport

revision = '0008_resource_management'
down_revision = '0007_backfill_report_history'
branch_labels = None
depends_on = None


def upgrade():
    for model in (ResourceSprint, ResourceItem, ResourceImport):
        model.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
