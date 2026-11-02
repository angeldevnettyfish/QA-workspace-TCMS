"""Project Bitbucket settings and tracked automation runs."""
from alembic import op
from app.models import BitbucketConfig, AutomationRun

revision = '0003_bitbucket_runs'
down_revision = '0002_case_import_metadata'
branch_labels = None
depends_on = None

def upgrade():
    BitbucketConfig.__table__.create(op.get_bind(), checkfirst=True)
    AutomationRun.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
