"""Preserve all JUnit test results for run history comparisons."""
from alembic import op
from app.models import AutomationTestResults

revision = '0006_automation_test_results'
down_revision = '0005_automation_schedules'
branch_labels = None
depends_on = None


def upgrade():
    AutomationTestResults.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
