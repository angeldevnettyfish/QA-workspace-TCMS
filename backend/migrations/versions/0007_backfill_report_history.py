"""Recover test history from existing pytest-html reports."""
from alembic import op
from sqlalchemy.orm import Session
from app.report_history import backfill_report_history

revision = '0007_backfill_report_history'
down_revision = '0006_automation_test_results'
branch_labels = None
depends_on = None


def upgrade():
    with Session(bind=op.get_bind()) as session:
        backfill_report_history(session)
        session.commit()


def downgrade():
    raise RuntimeError('This application migration is intentionally forward-only.')
