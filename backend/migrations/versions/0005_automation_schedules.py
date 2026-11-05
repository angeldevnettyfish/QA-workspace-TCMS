"""Persist project automation schedules across backend restarts."""
from alembic import op
from app.models import AutomationSchedule

revision = '0005_automation_schedules'
down_revision = '0004_automation_html_reports'
branch_labels = None
depends_on = None


def upgrade():
    AutomationSchedule.__table__.create(op.get_bind(), checkfirst=True)


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
