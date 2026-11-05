"""Persistent automation schedules; atomically claim a due occurrence once."""
from datetime import timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import select, update

from .models import AutomationSchedule, User, now


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def next_occurrence(start_at, frequency, zone, after):
    """Keep local wall-clock time; coalesce missed daily/weekly runs into one."""
    start = utc(start_at)
    after = utc(after)
    if start > after:
        return start
    if frequency == 'once':
        return None
    local_start = start.astimezone(ZoneInfo(zone))
    local_after = after.astimezone(ZoneInfo(zone))
    days = 1 if frequency == 'daily' else 7
    intervals = max(0, (local_after.date() - local_start.date()).days // days)
    candidate = local_start + timedelta(days=intervals * days)
    if candidate <= local_after:
        candidate += timedelta(days=days)
    return candidate.astimezone(timezone.utc)


def process_due_schedules(session_factory, dispatch, at=None):
    current = utc(at or now())
    with session_factory() as session:
        due = session.scalars(select(AutomationSchedule).where(
            AutomationSchedule.enabled == True,
            AutomationSchedule.next_run_at <= current,
        ).order_by(AutomationSchedule.next_run_at, AutomationSchedule.id).limit(100)).all()
        for schedule in due:
            schedule_id, cycle_id, user_id = schedule.id, schedule.cycle_id, schedule.user_id
            following = next_occurrence(schedule.start_at, schedule.frequency, schedule.timezone, current)
            # Commit the claim before contacting Bitbucket. Other workers/restarts
            # cannot resend this occurrence, even if dispatch times out.
            claimed = session.execute(update(AutomationSchedule).where(
                AutomationSchedule.id == schedule_id,
                AutomationSchedule.enabled == True,
                AutomationSchedule.next_run_at == schedule.next_run_at,
                AutomationSchedule.next_run_at <= current,
            ).values(next_run_at=following or schedule.next_run_at,
                     enabled=following is not None, last_error='Dispatch started; outcome not yet confirmed.'),
                execution_options={'synchronize_session': False}).rowcount
            session.commit()
            if not claimed:
                continue
            run_id, error = None, None
            try:
                actor = session.get(User, user_id)
                if not actor or not actor.active:
                    raise HTTPException(403, 'Schedule owner is inactive')
                run = dispatch(cycle_id, session, actor)
                run_id, error = run.id, run.error
            except HTTPException as exc:
                session.rollback()
                error = str(exc.detail)
            except Exception:
                session.rollback()
                # The outcome may be uncertain; never automatically retry a claim.
                error = 'Scheduled dispatch could not be confirmed. Check run history and Bitbucket before retrying.'
            session.execute(update(AutomationSchedule).where(AutomationSchedule.id == schedule_id).values(
                last_run_id=run_id, last_error=error))
            session.commit()
