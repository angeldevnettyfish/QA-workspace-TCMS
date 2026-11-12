"""Team-wide sprint planning, workload tracking and spreadsheet interchange."""
import csv
import html
import base64
import binascii
import hashlib
import io
import json
import logging
import os
import re
import smtplib
import ssl
from datetime import date, datetime, time, timedelta, timezone
from email.message import EmailMessage
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from .models import ResourceSprint, ResourceItem, ResourceImport, ResourceTimeEntry, ResourceEmailSettings, ResourceScrumBoard

HEADERS = ['Item ID','Start Date','Sprint Item / Task','Test Activity','Tester','Priority',
           'Est. Hrs','Actual Hrs','Completion %','End Date','Status','Impediment',
           'Release','Unplanned Hrs','Test Cases','Defects','Comment']
FIELDS = ['item_id','start_date','task','activity','tester','priority','estimated_hours',
          'actual_hours','completion_percent','end_date','status','impediment','release',
          'unplanned_hours','test_cases','defects','comment']
Nonnegative = Annotated[float, Field(ge=0, allow_inf_nan=False)]
RESOURCE_REPORT_TIMEZONE = ZoneInfo('Asia/Kolkata')
logger = logging.getLogger(__name__)


def resource_mail_configured():
    return all(os.getenv(key, '').strip() for key in (
        'RESOURCE_SMTP_HOST', 'RESOURCE_SMTP_USERNAME', 'RESOURCE_SMTP_PASSWORD',
        'RESOURCE_SMTP_FROM',
    ))


AUTH_FAILED = ('Gmail rejected the login. The app password in the backend .env '
               '(RESOURCE_SMTP_PASSWORD) is invalid or was revoked: create a new Google App Password '
               'for the sending account, paste it without spaces, and restart the backend.')


def smtp_login(server, username, password):
    """Gmail answers a bad app password with 535 and then often drops the connection."""
    try:
        server.login(username, password)
    except (smtplib.SMTPAuthenticationError, smtplib.SMTPServerDisconnected):
        raise RuntimeError(AUTH_FAILED) from None


def mail_error_detail(exc):
    """A message that says what is wrong, without leaking anything sensitive."""
    if isinstance(exc, RuntimeError):
        return str(exc)
    if isinstance(exc, smtplib.SMTPAuthenticationError):
        return ('Gmail rejected the login (535). The app password in the backend .env '
                '(RESOURCE_SMTP_PASSWORD) is invalid or was revoked: create a new Google App Password '
                'for the sending account, paste it without spaces, and restart the backend.')
    if isinstance(exc, smtplib.SMTPRecipientsRefused):
        return 'Gmail refused one or more recipient addresses.'
    if isinstance(exc, smtplib.SMTPSenderRefused):
        return 'Gmail refused the sender address; RESOURCE_SMTP_FROM must be the Gmail account that signs in.'
    if isinstance(exc, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected)) or (
            isinstance(exc, OSError) and not isinstance(exc, smtplib.SMTPException)):
        return 'Could not reach the Gmail SMTP server; check the network and RESOURCE_SMTP_HOST/PORT.'
    return 'Gmail SMTP delivery failed; check backend logs.'


def smtp_send(message):
    host = os.getenv('RESOURCE_SMTP_HOST', '').strip()
    username = os.getenv('RESOURCE_SMTP_USERNAME', '').strip()
    password = os.getenv('RESOURCE_SMTP_PASSWORD', '').replace(' ', '')
    sender = os.getenv('RESOURCE_SMTP_FROM', '').strip()
    if not all((host, username, password, sender)):
        raise RuntimeError('Gmail SMTP is not configured on the backend')
    try:
        port = int(os.getenv('RESOURCE_SMTP_PORT', '587'))
    except ValueError:
        raise RuntimeError('RESOURCE_SMTP_PORT must be a valid port number') from None
    if not 1 <= port <= 65535:
        raise RuntimeError('RESOURCE_SMTP_PORT must be between 1 and 65535')
    message['From'] = sender
    if port == 465:
        with smtplib.SMTP_SSL(host, port, context=ssl.create_default_context(), timeout=30) as server:
            smtp_login(server, username, password)
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.ehlo()
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
            smtp_login(server, username, password)
            server.send_message(message)


def resource_digest_message(session, recipient, local_day):
    items = session.execute(
        select(ResourceItem, ResourceSprint.name)
        .join(ResourceSprint, ResourceSprint.id == ResourceItem.sprint_id)
        .where(ResourceItem.archived.is_(False))
        .order_by(ResourceSprint.name, ResourceItem.tester, ResourceItem.item_id, ResourceItem.id)
    ).all()
    day_start = datetime.combine(local_day, time.min, tzinfo=RESOURCE_REPORT_TIMEZONE).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)
    entries = session.execute(
        select(ResourceTimeEntry, ResourceItem.item_id, ResourceItem.task, ResourceSprint.name)
        .join(ResourceItem, ResourceItem.id == ResourceTimeEntry.item_id)
        .join(ResourceSprint, ResourceSprint.id == ResourceItem.sprint_id)
        .where(ResourceTimeEntry.start_at >= day_start, ResourceTimeEntry.start_at < day_end)
        .order_by(ResourceTimeEntry.start_at)
    ).all()
    total_estimated = sum(item.estimated_hours or 0 for item, _ in items)
    total_actual = sum(item.actual_hours or 0 for item, _ in items)
    people = {}
    for item, _ in items:
        person = item.tester or 'Unassigned'
        totals = people.setdefault(person, {'tasks': 0, 'estimated': 0.0, 'actual': 0.0})
        totals['tasks'] += 1
        totals['estimated'] += item.estimated_hours or 0
        totals['actual'] += item.actual_hours or 0
    esc = lambda value: html.escape(str(value if value is not None else '—'))
    task_rows = ''.join(
        '<tr>' + ''.join(f'<td>{esc(value)}</td>' for value in (
            sprint, item.item_id, item.task, item.tester or 'Unassigned', item.activity,
            item.priority, item.estimated_hours, item.actual_hours, item.completion_percent,
            item.status, item.start_date, item.end_date, item.impediment, item.release,
            item.unplanned_hours, item.test_cases, item.defects, item.comment,
        )) + '</tr>'
        for item, sprint in items
    ) or '<tr><td colspan="18">No active tasks.</td></tr>'
    people_rows = ''.join(
        f'<tr><td>{esc(name)}</td><td>{values["tasks"]}</td>'
        f'<td>{values["estimated"]:.2f}</td><td>{values["actual"]:.2f}</td></tr>'
        for name, values in sorted(people.items())
    ) or '<tr><td colspan="4">No active team assignments.</td></tr>'
    time_rows = ''.join(
        '<tr>' + ''.join(f'<td>{esc(value)}</td>' for value in (
            sprint, entry.member, item_id, task,
            utc(entry.start_at).astimezone(RESOURCE_REPORT_TIMEZONE).strftime('%H:%M'),
            utc(entry.end_at).astimezone(RESOURCE_REPORT_TIMEZONE).strftime('%H:%M') if entry.end_at else 'Running',
            f'{((utc(entry.end_at) if entry.end_at else datetime.now(timezone.utc))-utc(entry.start_at)).total_seconds()/3600:.2f}',
            entry.note,
        )) + '</tr>'
        for entry, item_id, task, sprint in entries
    ) or '<tr><td colspan="8">No time entries started today.</td></tr>'
    headers = ('Sprint', 'Item ID', 'Task', 'Employee', 'Activity', 'Priority',
               'Estimated hours', 'Actual hours', 'Completion %', 'Status', 'Start date',
               'End date', 'Impediment', 'Release', 'Unplanned hours', 'Test cases',
               'Defects', 'Comment')
    time_headers = ('Sprint', 'Employee', 'Item ID', 'Task', 'Start (IST)', 'End (IST)', 'Hours', 'Note')
    head = '<html><body style="font-family:Arial,sans-serif;color:#202633">'
    head += f'<h2>Daily Resource Management Summary — {local_day.isoformat()} (IST)</h2>'
    head += f'<p>Active tasks: {len(items)} · Employees: {len(people)} · Estimated hours: {total_estimated:.2f} · Actual hours: {total_actual:.2f}</p>'
    table_style = 'border-collapse:collapse;font-size:12px;width:100%'
    cell_style = 'border:1px solid #ccd2da;padding:6px;text-align:left;vertical-align:top'
    def table(headers, rows):
        th = ''.join(f'<th style="{cell_style};background:#edf1f6">{esc(value)}</th>' for value in headers)
        return f'<div style="overflow-x:auto"><table style="{table_style}"><thead><tr>{th}</tr></thead><tbody>{rows}</tbody></table></div>'
    task_rows = task_rows.replace('<td>', f'<td style="{cell_style}">')
    people_rows = people_rows.replace('<td>', f'<td style="{cell_style}">')
    time_rows = time_rows.replace('<td>', f'<td style="{cell_style}">')
    body = head + '<h3>Employee workload</h3>' + table(('Employee', 'Active tasks', 'Estimated hours', 'Actual hours'), people_rows)
    body += '<h3>Task details</h3>' + table(headers, task_rows)
    body += '<h3>Timesheets started today</h3>' + table(time_headers, time_rows) + '</body></html>'
    text_body = (
        f'Daily Resource Management Summary — {local_day.isoformat()} IST\n'
        f'Active tasks: {len(items)}; employees: {len(people)}; '
        f'estimated hours: {total_estimated:.2f}; actual hours: {total_actual:.2f}.\n'
        'Open this email in an HTML-capable mail client to view employee workload, task details, and today\'s timesheets.'
    )
    message = EmailMessage()
    message['To'] = recipient
    message['Subject'] = f'Daily Resource Management Summary — {local_day.isoformat()}'
    message.set_content(text_body)
    message.add_alternative(body, subtype='html')
    return message


def send_resource_digest(session_factory, recipient, local_day=None):
    local_day = local_day or datetime.now(RESOURCE_REPORT_TIMEZONE).date()
    with session_factory() as session:
        message = resource_digest_message(session, recipient, local_day)
    smtp_send(message)


def process_due_resource_email(session_factory, now_local=None):
    now_local = now_local or datetime.now(RESOURCE_REPORT_TIMEZONE)
    local_day = now_local.date()
    with session_factory() as session:
        settings = session.scalar(select(ResourceEmailSettings).where(
            ResourceEmailSettings.id == 1).with_for_update())
        if not settings or not settings.enabled or now_local.time().replace(tzinfo=None) < time.fromisoformat(settings.send_time):
            return
        if settings.last_attempt_on == local_day:
            return
        if not resource_mail_configured():
            error = 'Gmail SMTP is not configured on the backend.'
            if settings.last_error != error:
                settings.last_error = error
                session.commit()
            return
        recipient = settings.recipient
        settings.last_attempt_on = local_day
        session.commit()
    try:
        send_resource_digest(session_factory, recipient, local_day)
    except (OSError, smtplib.SMTPException, RuntimeError) as exc:
        logger.exception('Daily resource email delivery failed')
        error = mail_error_detail(exc)
        with session_factory() as session:
            settings = session.get(ResourceEmailSettings, 1)
            if settings:
                settings.last_error = error[:500]
                session.commit()
        return
    with session_factory() as session:
        settings = session.get(ResourceEmailSettings, 1)
        if settings:
            settings.last_sent_on = local_day
            settings.last_error = None
            session.commit()


class ScrumBoardIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    people: list[dict] = Field(default_factory=list, max_length=500)
    sprints: list[dict] = Field(default_factory=list, max_length=500)
    settings: dict = Field(default_factory=dict)


class InlineImageIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cid: str = Field(pattern=r'^[A-Za-z0-9_-]{1,40}$')
    data: str = Field(min_length=1, max_length=1_000_000)  # base64 PNG


class SummaryEmailIn(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    to: list[str] = Field(min_length=1, max_length=50)
    subject: str = Field(min_length=1, max_length=200)
    text: str = Field(min_length=1, max_length=100_000)
    html: str = Field(default='', max_length=300_000)
    images: list[InlineImageIn] = Field(default_factory=list, max_length=3)

    @field_validator('to')
    @classmethod
    def validate_to(cls, values):
        for value in values:
            if not re.fullmatch(r'[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+', value):
                raise ValueError(f'Invalid recipient address: {value[:80]}')
        return values

    @field_validator('subject')
    @classmethod
    def validate_subject(cls, value):
        if any(char in value for char in ('\n', '\r')):
            raise ValueError('Subject must be a single line')
        return value


class ResourceEmailSettingsIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    recipient: str = Field(min_length=5, max_length=2000)
    send_time: str = Field(pattern=r'^(?:[01]\d|2[0-3]):[0-5]\d$')
    enabled: bool

    @field_validator('recipient')
    @classmethod
    def validate_recipient(cls, value):
        # One or more addresses, separated by commas, semicolons or spaces.
        found = []
        for address in re.split(r'[\s,;]+', value):
            if not address:
                continue
            if not re.fullmatch(r'[^@\s]+@[^@\s]+\.[^@\s]+', address):
                raise ValueError(f'Enter valid recipient email addresses ({address[:60]} is not one)')
            if address.lower() not in [a.lower() for a in found]:
                found.append(address)
        if not found:
            raise ValueError('Enter at least one recipient email address')
        if len(found) > 20:
            raise ValueError('Use at most 20 recipients')
        return ', '.join(found)


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


class TimeEntryIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    member: str = Field(min_length=1, max_length=120)
    start_at: datetime
    end_at: datetime
    note: str = Field(default='', max_length=20000)

    @model_validator(mode='after')
    def check_interval(self):
        self.start_at, self.end_at = utc(self.start_at), utc(self.end_at)
        if self.end_at <= self.start_at:
            raise ValueError('End time must be after start time')
        if self.end_at > datetime.now(timezone.utc):
            raise ValueError('Logged time cannot be in the future')
        return self


class SprintIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)

    @field_validator('name')
    @classmethod
    def clean_name(cls, value):
        if not value.strip():
            raise ValueError('Sprint name is required')
        return value.strip()


class ItemIn(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra='forbid')
    item_id: str = Field(min_length=1, max_length=80)
    start_date: date | None = None
    task: str = Field(min_length=1, max_length=10000)
    activity: str = Field(default='', max_length=120)
    tester: str = Field(default='', max_length=120)
    priority: str = Field(default='Medium', max_length=30)
    estimated_hours: Nonnegative | None = None
    actual_hours: Nonnegative | None = None
    # The source sheet uses explicit percentages, including 200% and 375%.
    completion_percent: Nonnegative | None = None
    end_date: date | None = None
    status: str = Field(default='Not Started', min_length=1, max_length=60)
    impediment: str = Field(default='', max_length=200)
    release: str = Field(default='', max_length=200)
    unplanned_hours: Nonnegative | None = None
    test_cases: int | None = Field(default=None, ge=0)
    defects: int | None = Field(default=None, ge=0)
    comment: str = Field(default='', max_length=20000)

    @model_validator(mode='after')
    def check_dates(self):
        if self.start_date and self.end_date and self.end_date < self.start_date:
            raise ValueError('End date must be on or after start date')
        return self


def parse_tracker(raw):
    try:
        rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig')), strict=True))
    except (UnicodeDecodeError, csv.Error):
        raise HTTPException(400, 'Upload a UTF-8 CSV tracker') from None
    header_index = next((i for i,r in enumerate(rows) if [v.strip() for v in r] == HEADERS), None)
    if header_index is None:
        raise HTTPException(400, 'CSV must contain the 17 Sprint Testing Tracker column headers')
    title = next((r[0].strip() for r in rows[:header_index] if r and r[0].strip()), '')
    items = []
    for line, row in enumerate(rows[header_index+1:], header_index+2):
        if not any(cell.strip() for cell in row):
            continue
        # Ignore sheet footer notes, not partial task records.
        if len(row) == len(HEADERS) and not any(cell.strip() for cell in row[:16]):
            continue
        if len(row) != len(HEADERS):
            raise HTTPException(400, f'CSV row {line}: expected 17 columns')
        values = dict(zip(FIELDS, (value.strip() for value in row)))
        try:
            for key in ('start_date', 'end_date'):
                value = values[key]
                if not value:
                    values[key] = None
                else:
                    try:
                        values[key] = date.fromisoformat(value)
                    except ValueError:
                        values[key] = datetime.strptime(value, '%d %b %Y').date()
            for key in ('estimated_hours','actual_hours','unplanned_hours','test_cases','defects'):
                values[key] = values[key] or None
            values['completion_percent'] = values['completion_percent'].removesuffix('%') or None
            items.append(ItemIn.model_validate(values))
        except ValueError as exc:
            raise HTTPException(400, f'CSV row {line}: {exc}') from None
    if not items:
        raise HTTPException(400, 'CSV contains no task rows')
    return title, items


def import_tracker(session, raw, sprint_id=None):
    title, items = parse_tracker(raw)
    sprint = session.get(ResourceSprint, sprint_id) if sprint_id else session.scalar(
        select(ResourceSprint).where(ResourceSprint.name == title))
    if sprint_id and sprint is None:
        raise HTTPException(404, 'Sprint not found')
    if sprint is None:
        try:
            name = SprintIn(name=title or 'Imported sprint').name
        except ValueError:
            raise HTTPException(400, 'CSV sprint title must contain 1–120 characters') from None
        sprint = ResourceSprint(name=name)
        session.add(sprint)
        session.flush()
    checksum = hashlib.sha256(raw).hexdigest()
    if session.scalar(select(ResourceImport.id).where(ResourceImport.sprint_id==sprint.id, ResourceImport.checksum==checksum)):
        raise HTTPException(409, 'This CSV has already been imported into this sprint')
    for item in items:
        session.add(ResourceItem(sprint_id=sprint.id, **item.model_dump()))
    session.add(ResourceImport(sprint_id=sprint.id, checksum=checksum))
    session.flush()
    return {'sprint_id':sprint.id, 'sprint_name':sprint.name, 'imported':len(items)}


def create_resource_router(db, user, elevated, obj, data, audit):
    router = APIRouter(prefix='/api/resources', tags=['Resource management'])

    def manager(u=Depends(user)):
        elevated(u)
        return u

    def locked_item(s, item_id):
        item = s.scalar(select(ResourceItem).where(ResourceItem.id==item_id).with_for_update())
        if item is None:
            raise HTTPException(404, 'Task not found')
        return item

    def entry_data(entry):
        return {**data(entry), 'start_at':utc(entry.start_at),
                'end_at':utc(entry.end_at) if entry.end_at else None}

    def email_settings_data(settings):
        return {
            'recipient': settings.recipient if settings else '',
            'send_time': settings.send_time if settings else '09:00',
            'enabled': settings.enabled if settings else False,
            'mail_configured': resource_mail_configured(),
            'last_sent_on': settings.last_sent_on if settings else None,
            'last_error': settings.last_error if settings else None,
        }

    @router.get('/scrum')
    def get_scrum_board(s:Session=Depends(db), u=Depends(manager)):
        row = s.get(ResourceScrumBoard, 1)
        return row.data if row and row.data else {'people':[], 'sprints':[], 'settings':{}}

    @router.put('/scrum')
    def save_scrum_board(body:ScrumBoardIn, s:Session=Depends(db), u=Depends(manager)):
        payload = body.model_dump()
        if len(json.dumps(payload)) > 8_000_000:
            raise HTTPException(413, 'Scrum board is too large')
        row = s.get(ResourceScrumBoard, 1)
        if row is None:
            s.add(ResourceScrumBoard(id=1, data=payload))
        else:
            row.data = payload
        s.commit()
        return {'ok': True}

    @router.post('/email/summary')
    def send_summary_email(body:SummaryEmailIn, s:Session=Depends(db), u=Depends(manager)):
        if not resource_mail_configured():
            raise HTTPException(503, 'Configure Gmail SMTP on the backend before sending email')
        message = EmailMessage()
        message['To'] = ', '.join(body.to)
        message['Subject'] = body.subject
        message.set_content(body.text)
        if body.html:
            message.add_alternative(body.html, subtype='html')
            for image in body.images:
                try:
                    raw = base64.b64decode(image.data, validate=True)
                except (binascii.Error, ValueError):
                    raise HTTPException(400, 'An attached chart image is not valid base64') from None
                if not raw.startswith(b'\x89PNG\r\n\x1a\n'):
                    raise HTTPException(400, 'Only PNG images can be attached')
                message.get_payload()[1].add_related(
                    raw, maintype='image', subtype='png', cid=f'<{image.cid}>', disposition='inline')
        try:
            smtp_send(message)
        except (OSError, smtplib.SMTPException, RuntimeError) as exc:
            logger.exception('Summary email delivery failed')
            detail = mail_error_detail(exc)
            raise HTTPException(502, detail[:500]) from None
        audit(s,u.id,'send','resource_summary_email',1,after={'recipients':len(body.to),'subject':body.subject})
        s.commit()
        return {'sent':True,'recipients':len(body.to)}

    @router.get('/email-settings')
    def get_email_settings(s:Session=Depends(db), u=Depends(manager)):
        settings = s.get(ResourceEmailSettings, 1)
        return email_settings_data(settings)

    @router.put('/email-settings')
    def save_email_settings(body:ResourceEmailSettingsIn, s:Session=Depends(db), u=Depends(manager)):
        settings = s.get(ResourceEmailSettings, 1)
        before = email_settings_data(settings)
        if settings is None:
            settings = ResourceEmailSettings(id=1)
            s.add(settings)
        settings.recipient = body.recipient
        settings.send_time = body.send_time
        settings.enabled = body.enabled
        settings.last_error = None
        audit(s,u.id,'configure','resource_email_settings',1,before=before,after={
            'recipient':body.recipient, 'send_time':body.send_time, 'enabled':body.enabled,
        })
        s.commit()
        return email_settings_data(settings)

    @router.post('/email-settings/send-now')
    def send_email_now(s:Session=Depends(db), u=Depends(manager)):
        settings = s.get(ResourceEmailSettings, 1)
        recipient = settings.recipient if settings else ''
        if not recipient:
            raise HTTPException(400, 'Add a recipient and save the email schedule first')
        if not resource_mail_configured():
            raise HTTPException(503, 'Configure Gmail SMTP on the backend before sending the summary')
        try:
            smtp_send(resource_digest_message(
                s, recipient, datetime.now(RESOURCE_REPORT_TIMEZONE).date()))
        except (OSError, smtplib.SMTPException, RuntimeError) as exc:
            logger.exception('Manual resource email delivery failed')
            message = mail_error_detail(exc)
            raise HTTPException(502, message[:500]) from None
        audit(s,u.id,'send','resource_email_summary',1,after={'recipient':recipient})
        if settings:
            settings.last_error = None
            s.commit()
        return {'sent':True,'recipient':recipient}

    @router.get('/items/{item_id}/timesheets')
    def timesheets(item_id:int, s:Session=Depends(db), u=Depends(manager)):
        obj(s,ResourceItem,item_id)
        return [entry_data(row) for row in s.scalars(select(ResourceTimeEntry).where(
            ResourceTimeEntry.item_id==item_id).order_by(ResourceTimeEntry.start_at.desc()))]

    @router.post('/items/{item_id}/timesheets')
    def add_time(item_id:int, body:TimeEntryIn, s:Session=Depends(db), u=Depends(manager)):
        item = locked_item(s,item_id)
        if item.archived:
            raise HTTPException(409, 'Restore this task before logging time')
        entry = ResourceTimeEntry(item_id=item_id, **body.model_dump())
        s.add(entry)
        item.actual_hours = (item.actual_hours or 0)+(body.end_at-body.start_at).total_seconds()/3600
        s.flush()
        audit(s,u.id,'create','resource_time_entry',entry.id,after=entry_data(entry))
        s.commit()
        return entry_data(entry)

    @router.post('/items/{item_id}/timer/start')
    def start_timer(item_id:int, s:Session=Depends(db), u=Depends(manager)):
        item = locked_item(s,item_id)
        if item.archived:
            raise HTTPException(409, 'Restore this task before starting a timer')
        if s.scalar(select(ResourceTimeEntry.id).where(ResourceTimeEntry.item_id==item_id,ResourceTimeEntry.end_at.is_(None))):
            raise HTTPException(409, 'A timer is already running for this task')
        entry = ResourceTimeEntry(item_id=item_id, member=item.tester or u.name, start_at=datetime.now(timezone.utc))
        s.add(entry)
        s.flush()
        audit(s,u.id,'start','resource_time_entry',entry.id,after=entry_data(entry))
        s.commit()
        return entry_data(entry)

    @router.post('/items/{item_id}/timer/stop')
    def stop_timer(item_id:int, s:Session=Depends(db), u=Depends(manager)):
        item = locked_item(s,item_id)
        entry = s.scalar(select(ResourceTimeEntry).where(ResourceTimeEntry.item_id==item_id,ResourceTimeEntry.end_at.is_(None)))
        if entry is None:
            raise HTTPException(409, 'No timer is running for this task')
        entry.end_at = datetime.now(timezone.utc)
        item.actual_hours = (item.actual_hours or 0)+(entry.end_at-utc(entry.start_at)).total_seconds()/3600
        audit(s,u.id,'stop','resource_time_entry',entry.id,after=entry_data(entry))
        s.commit()
        return entry_data(entry)

    @router.delete('/items/{item_id}/timesheets/{entry_id}')
    def delete_time(item_id:int, entry_id:int, s:Session=Depends(db), u=Depends(manager)):
        item = locked_item(s,item_id)
        entry = obj(s,ResourceTimeEntry,entry_id)
        if entry.item_id != item_id:
            raise HTTPException(404, 'Timesheet not found')
        if entry.end_at is None:
            raise HTTPException(409, 'Stop the timer before deleting it')
        item.actual_hours = max(0,(item.actual_hours or 0)-(utc(entry.end_at)-utc(entry.start_at)).total_seconds()/3600)
        audit(s,u.id,'delete','resource_time_entry',entry.id,before=entry_data(entry))
        s.delete(entry)
        s.commit()
        return {'deleted':True}

    @router.get('/sprints')
    def sprints(s:Session=Depends(db), u=Depends(manager)):
        return [data(row) for row in s.scalars(select(ResourceSprint).order_by(ResourceSprint.id.desc()))]

    @router.post('/sprints')
    def create_sprint(body:SprintIn, s:Session=Depends(db), u=Depends(manager)):
        sprint = ResourceSprint(name=body.name)
        s.add(sprint)
        try:
            s.flush()
            audit(s,u.id,'create','resource_sprint',sprint.id,after={'name':sprint.name})
            s.commit()
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, 'A sprint with this name already exists') from None
        return data(sprint)

    @router.get('/sprints/{sprint_id}/items')
    def items(sprint_id:int, include_archived:bool=False, s:Session=Depends(db), u=Depends(manager)):
        obj(s,ResourceSprint,sprint_id)
        query = select(ResourceItem).where(ResourceItem.sprint_id==sprint_id)
        if not include_archived:
            query = query.where(ResourceItem.archived.is_(False))
        return [data(row) for row in s.scalars(query.order_by(ResourceItem.id))]

    @router.post('/sprints/{sprint_id}/items')
    def create_item(sprint_id:int, body:ItemIn, s:Session=Depends(db), u=Depends(manager)):
        obj(s,ResourceSprint,sprint_id)
        item = ResourceItem(sprint_id=sprint_id, **body.model_dump())
        s.add(item)
        s.flush()
        audit(s,u.id,'create','resource_item',item.id,after=data(item))
        s.commit()
        return data(item)

    @router.put('/items/{item_id}')
    def update_item(item_id:int, body:ItemIn, s:Session=Depends(db), u=Depends(manager)):
        item = obj(s,ResourceItem,item_id)
        before = data(item)
        for key,value in body.model_dump().items():
            setattr(item,key,value)
        s.flush()
        audit(s,u.id,'update','resource_item',item.id,before=before,after=data(item))
        s.commit()
        return data(item)

    @router.patch('/items/{item_id}/archive')
    def archive(item_id:int, archived:bool=True, s:Session=Depends(db), u=Depends(manager)):
        item = obj(s,ResourceItem,item_id)
        item.archived = archived
        audit(s,u.id,'archive' if archived else 'restore','resource_item',item.id)
        s.commit()
        return data(item)

    @router.post('/import')
    async def import_csv(sprint_id:int|None=None, file:UploadFile=File(...), s:Session=Depends(db), u=Depends(manager)):
        if not (file.filename or '').lower().endswith('.csv'):
            raise HTTPException(415, 'Upload a .csv file')
        raw = await file.read(2_000_001)
        if len(raw)>2_000_000:
            raise HTTPException(413, 'CSV exceeds the 2 MB limit')
        try:
            result = import_tracker(s,raw,sprint_id)
            audit(s,u.id,'import','resource_sprint',result['sprint_id'],after=result)
            s.commit()
        except IntegrityError:
            s.rollback()
            raise HTTPException(409, 'This sprint or CSV import already exists; reload and retry') from None
        return result

    @router.get('/sprints/{sprint_id}/export.csv')
    def export_csv(sprint_id:int, s:Session=Depends(db), u=Depends(manager)):
        sprint = obj(s,ResourceSprint,sprint_id)
        buf = io.StringIO()
        writer = csv.writer(buf)
        def cell(value):
            if isinstance(value,date):
                return value.strftime('%d %b %Y')
            if value is None:
                return ''
            if isinstance(value,str) and value.lstrip().startswith(('=','+','-','@')):
                return "'"+value
            return value
        writer.writerow([cell(sprint.name)]+['']*16)
        writer.writerow(['']*17)
        writer.writerow(HEADERS)
        for item in s.scalars(select(ResourceItem).where(ResourceItem.sprint_id==sprint_id, ResourceItem.archived.is_(False)).order_by(ResourceItem.id)):
            values = [cell(getattr(item,field)) for field in FIELDS]
            values[8] = f'{item.completion_percent:g}%' if item.completion_percent is not None else ''
            writer.writerow(values)
        return StreamingResponse(iter(['\ufeff'+buf.getvalue()]),media_type='text/csv',headers={
            'Content-Disposition':f'attachment; filename="sprint-{sprint_id}-tracker.csv"'})

    return router
