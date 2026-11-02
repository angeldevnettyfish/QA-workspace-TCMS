"""Store an HTML report for each automation run."""
from alembic import op
from app.models import AutomationHtmlReport

revision = '0004_automation_html_reports'
down_revision = '0003_bitbucket_runs'
branch_labels = None
depends_on = None

def upgrade():
    AutomationHtmlReport.__table__.create(op.get_bind(), checkfirst=True)

def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
