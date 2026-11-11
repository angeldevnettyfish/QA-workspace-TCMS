"""Bitbucket Cloud dispatch and per-run JUnit callbacks."""
import base64
import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Literal
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from .scheduling import next_occurrence, process_due_schedules, utc
from .models import AutomationSchedule, AutomationRun, AutomationHtmlReport, AutomationTestResults, BitbucketConfig, ImportLog, Project, User, now

SCHEDULER_POLL_SECONDS = 15
LOCAL_RUNNER_ONLINE_SECONDS = 45
MAX_HTML_REPORT_BYTES = 100_000_000
local_runner_last_seen = 0.0


class ConfigIn(BaseModel):
    workspace: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    repository: str = Field(pattern=r'^[A-Za-z0-9_.-]{1,100}$')
    branch: str = Field(min_length=1, max_length=200)
    pipeline: str = Field(min_length=1, max_length=200)


class RunIn(BaseModel):
    cycle_id: int


class LocalRunIn(BaseModel):
    model_config = ConfigDict(extra='forbid')
    cycle_id: int
    script: str = Field(min_length=4, max_length=120, pattern=r'^[A-Za-z0-9][A-Za-z0-9_. -]{0,115}\.sh$')


class LocalHeartbeat(BaseModel):
    scripts: list[str] = Field(default_factory=list, max_length=100)

    @field_validator('scripts')
    @classmethod
    def validate_script_names(cls, scripts):
        if len(set(scripts)) != len(scripts) or any(
            not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_. -]{0,115}\.sh', script)
            for script in scripts
        ):
            raise ValueError('Runner script names must be unique .sh filenames')
        return scripts


class ScheduleIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    cycle_id: int
    frequency: Literal['once', 'daily', 'weekly']
    timezone: Literal['Asia/Kolkata', 'UTC'] = 'Asia/Kolkata'
    start_local: datetime
    enabled: bool = True


class ScheduleEnabled(BaseModel):
    enabled: bool


class LocalRunFinished(BaseModel):
    result: Literal['SUCCESSFUL', 'FAILED']
    error: str | None = Field(default=None, max_length=1000)


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def bitbucket_request(workspace, repository, method='GET', suffix='', payload=None):
    token = os.getenv('BITBUCKET_API_TOKEN', '').strip()
    email = os.getenv('BITBUCKET_EMAIL', '').strip()
    if not token:
        raise HTTPException(503, 'Set BITBUCKET_API_TOKEN on the backend first')
    authorization = ('Basic ' + base64.b64encode(f'{email}:{token}'.encode()).decode()
                     if email else 'Bearer ' + token)
    url = f'https://api.bitbucket.org/2.0/repositories/{quote(workspace, safe="")}/{quote(repository, safe="")}/pipelines/' + suffix
    request = Request(url, method=method, headers={
        'Authorization': authorization, 'Accept': 'application/json', 'Content-Type': 'application/json',
    }, data=json.dumps(payload).encode() if payload is not None else None)
    try:
        with build_opener(NoRedirects()).open(request, timeout=20) as response:
            return json.load(response)
    except HTTPError as exc:
        raise HTTPException(502, f'Bitbucket returned HTTP {exc.code}; check credentials, pipeline permissions and repository settings') from None
    except (URLError, TimeoutError, OSError, ValueError):
        raise HTTPException(502, 'Could not confirm the Bitbucket response; check Bitbucket before retrying the run') from None


def callback_base():
    value = os.getenv('QA_PUBLIC_URL', '').rstrip('/')
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(503, 'Set QA_PUBLIC_URL to the application URL reachable from the runner PC')
    return value


def create_bitbucket_router(db, user, accessible, require_project_role, obj, project_for_cycle, audit, import_junit_content, session_factory):
    local_runner_last_seen = 0.0
    local_runner_scripts = []
    runner_bearer = HTTPBearer(auto_error=False)

    def require_local_runner(credentials: HTTPAuthorizationCredentials | None = Depends(runner_bearer)):
        expected = os.getenv('LOCAL_RUNNER_TOKEN', '').strip()
        if not expected:
            raise HTTPException(503, 'Local runner is not configured')
        if not credentials or not hmac.compare_digest(credentials.credentials, expected):
            raise HTTPException(401, 'Local runner authentication failed')

    @asynccontextmanager
    async def scheduler_lifespan(app):
        stop = asyncio.Event()
        async def worker():
            while not stop.is_set():
                try:
                    await asyncio.wait_for(stop.wait(), timeout=SCHEDULER_POLL_SECONDS)
                except asyncio.TimeoutError:
                    try:
                        await asyncio.to_thread(run_due_schedules)
                    except Exception:
                        logging.getLogger(__name__).exception('Automation scheduler tick failed')
        task = asyncio.create_task(worker()) if os.getenv('AUTOMATION_SCHEDULER_ENABLED', 'true').lower() == 'true' else None
        try:
            yield
        finally:
            stop.set()
            if task:
                await task

    router = APIRouter(prefix='/api/automation', lifespan=scheduler_lifespan)

    def public_run(run, session):
        log = session.get(ImportLog, run.import_id) if run.import_id else None
        results = session.get(AutomationTestResults, run.id)
        return {'test_results': results.tests if results else None, **{key: getattr(run, key) for key in (
            'id', 'project_id', 'cycle_id', 'branch', 'pipeline', 'source', 'local_script', 'build_number',
            'state', 'result', 'error', 'import_id', 'created_at')},
            'url': f'https://bitbucket.org/{quote(run.workspace, safe="")}/{quote(run.repository, safe="")}/pipelines/results/{run.build_number}' if run.build_number else None,
            'html_report_url': f'/api/automation/runs/{run.id}/html' if session.scalar(select(AutomationHtmlReport.run_id).where(AutomationHtmlReport.run_id == run.id)) else None,
            'report': {'imported': log.imported, 'unmatched': log.unmatched, 'errors': log.errors} if log else None}

    def apply_state(run, response):
        state = response.get('state') or {}
        run.state = state.get('name', 'UNKNOWN')
        run.result = (state.get('result') or {}).get('name')

    @router.get('/bitbucket')
    def config(project_id: int, s: Session = Depends(db), u: User = Depends(user)):
        accessible(s, u, project_id)
        value = s.get(BitbucketConfig, project_id)
        return {'config': {key: getattr(value, key) for key in ('workspace', 'repository', 'branch', 'pipeline')} if value else None,
                'credentials_configured': bool(os.getenv('BITBUCKET_API_TOKEN', '').strip()),
                'callback_configured': bool(os.getenv('QA_PUBLIC_URL', '').strip())}

    @router.put('/bitbucket')
    def save_config(project_id: int, body: ConfigIn, s: Session = Depends(db), u: User = Depends(user)):
        obj(s, Project, project_id)
        accessible(s, u, project_id)
        require_project_role(s, u, project_id, ('admin', 'lead'))
        value = s.get(BitbucketConfig, project_id)
        if not value:
            value = BitbucketConfig(project_id=project_id)
            s.add(value)
        for key, item in body.model_dump().items():
            if not item.strip():
                raise HTTPException(422, 'Branch and pipeline must not be blank')
            setattr(value, key, item.strip())
        audit(s, u.id, 'configure', 'bitbucket', project_id, project_id, after=body.model_dump())
        s.commit()
        return {'ok': True}

    def dispatch(cycle_id, s, u):
        pid = project_for_cycle(s, cycle_id)
        accessible(s, u, pid)
        require_project_role(s, u, pid, ('admin', 'lead'))
        if obj(s, Project, pid).archived:
            raise HTTPException(400, 'Project is archived')
        cfg = s.get(BitbucketConfig, pid)
        if not cfg:
            raise HTTPException(400, 'Save the project Bitbucket settings first')
        base = callback_base()
        if not os.getenv('BITBUCKET_API_TOKEN', '').strip():
            raise HTTPException(503, 'Set BITBUCKET_API_TOKEN on the backend first')
        secret = secrets.token_urlsafe(32)
        run = AutomationRun(project_id=pid, cycle_id=cycle_id, user_id=u.id,
                            workspace=cfg.workspace, repository=cfg.repository, branch=cfg.branch, pipeline=cfg.pipeline,
                            callback_hash=hashlib.sha256(secret.encode()).hexdigest(), expires_at=now()+timedelta(hours=24))
        s.add(run)
        s.flush()
        audit(s, u.id, 'trigger', 'automation_run', run.id, pid)
        s.commit()
        payload = {'target': {'type': 'pipeline_ref_target', 'ref_type': 'branch', 'ref_name': run.branch,
                              'selector': {'type': 'custom', 'pattern': run.pipeline}},
                   'variables': [{'key': key, 'value': value, 'secured': secured} for key, value, secured in (
                       ('QA_RUN_ID', str(run.id), False),
                       ('QA_CALLBACK_URL', f'{base}/api/v1/automation/runs/{run.id}/report', False),
                       ('QA_CALLBACK_TOKEN', secret, True))]}
        try:
            response = bitbucket_request(run.workspace, run.repository, 'POST', payload=payload)
            run.pipeline_uuid = response.get('uuid')
            run.build_number = response.get('build_number')
            apply_state(run, response)
        except HTTPException as exc:
            run.state = 'DISPATCH_UNCONFIRMED'
            run.error = str(exc.detail)
        s.commit()
        return run

    def run_due_schedules(at=None):
        process_due_schedules(session_factory, dispatch, at)

    # Expose the same dispatcher for deterministic tests without running timers.
    router.run_due_schedules = run_due_schedules

    @router.post('/runs')
    def trigger(body: RunIn, s: Session = Depends(db), u: User = Depends(user)):
        return public_run(dispatch(body.cycle_id, s, u), s)

    @router.get('/local/status')
    def local_status(project_id: int, s: Session = Depends(db), u: User = Depends(user)):
        accessible(s, u, project_id)
        configured = bool(os.getenv('LOCAL_RUNNER_TOKEN', '').strip())
        online = configured and time.monotonic() - local_runner_last_seen < LOCAL_RUNNER_ONLINE_SECONDS
        return {
            'configured': configured,
            'online': online,
            'runner': '88 PC',
            'scripts': local_runner_scripts if online else [],
        }

    @router.post('/runs/local')
    def trigger_local(body: LocalRunIn, s: Session = Depends(db), u: User = Depends(user)):
        nonlocal local_runner_last_seen
        pid = project_for_cycle(s, body.cycle_id)
        accessible(s, u, pid)
        require_project_role(s, u, pid, ('admin', 'lead'))
        if obj(s, Project, pid).archived:
            raise HTTPException(400, 'Project is archived')
        if not os.getenv('LOCAL_RUNNER_TOKEN', '').strip():
            raise HTTPException(503, 'Local runner is not configured on the backend')
        if time.monotonic() - local_runner_last_seen >= LOCAL_RUNNER_ONLINE_SECONDS:
            raise HTTPException(503, 'Local runner on the 88 PC is offline')
        if body.script not in local_runner_scripts:
            raise HTTPException(422, 'Select an available local .sh script')
        active_run = s.scalar(select(AutomationRun.id).where(
            AutomationRun.source == 'local',
            AutomationRun.state.in_(('PENDING', 'IN_PROGRESS')),
        ).limit(1))
        if active_run:
            raise HTTPException(409, 'A local automation run is already queued or running')
        secret = secrets.token_urlsafe(32)
        run = AutomationRun(
            project_id=pid, cycle_id=body.cycle_id, user_id=u.id,
            workspace='local', repository='88-pc', branch='local', pipeline='local',
            source='local', local_script=body.script, state='PENDING',
            callback_hash=hashlib.sha256(secret.encode()).hexdigest(),
            expires_at=now()+timedelta(hours=24))
        s.add(run)
        s.flush()
        audit(s, u.id, 'trigger', 'automation_run', run.id, pid, after={
            'source': 'local', 'script': body.script,
        })
        s.commit()
        return public_run(run, s)

    @router.post('/local/heartbeat')
    def local_heartbeat(body: LocalHeartbeat = LocalHeartbeat(), _: None = Depends(require_local_runner)):
        nonlocal local_runner_last_seen, local_runner_scripts
        local_runner_last_seen = time.monotonic()
        local_runner_scripts = body.scripts
        return {'ok': True}

    @router.post('/local/claim')
    def local_claim(_: None = Depends(require_local_runner), s: Session = Depends(db)):
        nonlocal local_runner_last_seen
        local_runner_last_seen = time.monotonic()
        run = s.scalar(select(AutomationRun).where(
            AutomationRun.source == 'local',
            AutomationRun.state == 'PENDING',
        ).order_by(AutomationRun.id).with_for_update(skip_locked=True))
        if not run:
            return None
        secret = secrets.token_urlsafe(32)
        run.callback_hash = hashlib.sha256(secret.encode()).hexdigest()
        run.expires_at = now()+timedelta(hours=24)
        run.state = 'IN_PROGRESS'
        s.commit()
        return {
            'run_id': run.id,
            'script': run.local_script,
            'callback_url': f'http://127.0.0.1:8080/api/v1/automation/runs/{run.id}/report',
            'callback_token': secret,
        }

    @router.post('/local/runs/{run_id}/finish')
    def local_finish(run_id: int, body: LocalRunFinished, _: None = Depends(require_local_runner), s: Session = Depends(db)):
        run = s.scalar(select(AutomationRun).where(
            AutomationRun.id == run_id,
            AutomationRun.source == 'local',
        ).with_for_update())
        if not run:
            raise HTTPException(404, 'Local automation run not found')
        if run.state != 'IN_PROGRESS':
            raise HTTPException(409, 'Local automation run is not in progress')
        run.state = 'COMPLETED'
        run.result = body.result
        run.error = body.error
        s.commit()
        return public_run(run, s)

    def public_schedule(value):
        result = {key: getattr(value, key) for key in (
            'id', 'project_id', 'cycle_id', 'name', 'frequency', 'timezone',
            'enabled', 'last_run_id', 'last_error')}
        for key in ('start_at', 'next_run_at', 'created_at'):
            result[key] = utc(getattr(value, key)).isoformat()
        return result

    def schedule_values(body, s, u, project_id):
        accessible(s, u, project_id)
        require_project_role(s, u, project_id, ('admin', 'lead'))
        if project_for_cycle(s, body.cycle_id) != project_id:
            raise HTTPException(400, 'Cycle belongs to another project')
        if obj(s, Project, project_id).archived:
            raise HTTPException(400, 'Project is archived')
        if not s.get(BitbucketConfig, project_id):
            raise HTTPException(400, 'Save the project Bitbucket settings first')
        if not body.name.strip():
            raise HTTPException(422, 'Schedule name must not be blank')
        if body.start_local.tzinfo is not None:
            raise HTTPException(422, 'Use a local date/time without an offset and select its timezone')
        start = body.start_local.replace(tzinfo=ZoneInfo(body.timezone)).astimezone(timezone.utc)
        following = next_occurrence(start, body.frequency, body.timezone, now())
        if following is None:
            raise HTTPException(422, 'Choose a future date/time for a one-time schedule')
        if body.enabled:
            callback_base()
            if not os.getenv('BITBUCKET_API_TOKEN', '').strip():
                raise HTTPException(503, 'Set BITBUCKET_API_TOKEN on the backend first')
        return dict(name=body.name.strip(), cycle_id=body.cycle_id,
                    frequency=body.frequency, timezone=body.timezone,
                    start_at=start, next_run_at=following, enabled=body.enabled,
                    last_error=None)

    @router.get('/schedules')
    def schedules(project_id: int, s: Session = Depends(db), u: User = Depends(user)):
        accessible(s, u, project_id)
        return [public_schedule(value) for value in s.scalars(select(AutomationSchedule).where(
            AutomationSchedule.project_id == project_id).order_by(AutomationSchedule.id.desc()))]

    @router.post('/schedules')
    def create_schedule(project_id: int, body: ScheduleIn, s: Session = Depends(db), u: User = Depends(user)):
        value = AutomationSchedule(project_id=project_id, user_id=u.id, **schedule_values(body, s, u, project_id))
        s.add(value)
        s.flush()
        audit(s, u.id, 'create', 'automation_schedule', value.id, project_id, after=public_schedule(value))
        s.commit()
        return public_schedule(value)

    @router.put('/schedules/{schedule_id}')
    def edit_schedule(schedule_id: int, body: ScheduleIn, s: Session = Depends(db), u: User = Depends(user)):
        value = obj(s, AutomationSchedule, schedule_id)
        updates = schedule_values(body, s, u, value.project_id)
        for key, item in updates.items():
            setattr(value, key, item)
        value.user_id = u.id
        audit(s, u.id, 'update', 'automation_schedule', value.id, value.project_id)
        s.commit()
        return public_schedule(value)

    @router.patch('/schedules/{schedule_id}')
    def toggle_schedule(schedule_id: int, body: ScheduleEnabled, s: Session = Depends(db), u: User = Depends(user)):
        value = obj(s, AutomationSchedule, schedule_id)
        accessible(s, u, value.project_id)
        require_project_role(s, u, value.project_id, ('admin', 'lead'))
        if body.enabled:
            local = utc(value.start_at).astimezone(ZoneInfo(value.timezone)).replace(tzinfo=None)
            updates = schedule_values(ScheduleIn(name=value.name, cycle_id=value.cycle_id,
                frequency=value.frequency, timezone=value.timezone, start_local=local, enabled=True), s, u, value.project_id)
            value.next_run_at = updates['next_run_at']
            value.last_error = None
            value.user_id = u.id
        value.enabled = body.enabled
        audit(s, u.id, 'enable' if body.enabled else 'disable', 'automation_schedule', value.id, value.project_id)
        s.commit()
        return public_schedule(value)

    @router.get('/runs')
    def runs(project_id: int, s: Session = Depends(db), u: User = Depends(user)):
        accessible(s, u, project_id)
        return [public_run(run, s) for run in s.scalars(select(AutomationRun).where(
            AutomationRun.project_id == project_id).order_by(AutomationRun.id.desc()).limit(50))]

    @router.post('/runs/{run_id}/refresh')
    def refresh(run_id: int, s: Session = Depends(db), u: User = Depends(user)):
        run = obj(s, AutomationRun, run_id)
        accessible(s, u, run.project_id)
        require_project_role(s, u, run.project_id, ('admin', 'lead'))
        if run.pipeline_uuid:
            response = bitbucket_request(run.workspace, run.repository, suffix=quote(run.pipeline_uuid, safe=''))
            apply_state(run, response)
            run.error = None
            s.commit()
        return public_run(run, s)

    @router.get('/runs/{run_id}/html')
    def html_report(run_id: int, s: Session = Depends(db), u: User = Depends(user)):
        run = obj(s, AutomationRun, run_id)
        accessible(s, u, run.project_id)
        report = obj(s, AutomationHtmlReport, run_id)
        return Response(content=report.content, media_type='text/html', headers={
            'Content-Disposition': f'inline; filename="automation-run-{run_id}.html"',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            # Reports contain JS for pytest's filters. Give them an isolated origin
            # and no network access, even when opened directly outside the iframe.
            'Content-Security-Policy': "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline' data:; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
        })

    @router.post('/runs/{run_id}/report')
    async def report(run_id: int, file: UploadFile = File(...), html_report: UploadFile | None = File(None), credentials: HTTPAuthorizationCredentials = Depends(HTTPBearer()), s: Session = Depends(db)):
        # The capability authorizes only this run/cycle, never an arbitrary project.
        run = s.scalar(select(AutomationRun).where(AutomationRun.id == run_id).with_for_update())
        digest = hashlib.sha256(credentials.credentials.encode()).hexdigest()
        if not run or not hmac.compare_digest(run.callback_hash, digest):
            raise HTTPException(401, 'Invalid run token')
        expiry = run.expires_at.replace(tzinfo=timezone.utc) if run.expires_at.tzinfo is None else run.expires_at
        if expiry <= now():
            raise HTTPException(401, 'Run token expired')
        actor = obj(s, User, run.user_id)
        if not actor.active:
            raise HTTPException(403, 'Run initiator is inactive')
        require_project_role(s, actor, run.project_id, ('admin', 'lead'))
        html_content = None
        if html_report is not None:
            if not (html_report.filename or '').lower().endswith(('.html', '.htm')):
                raise HTTPException(415, 'Upload a .html report')
            html_content = await html_report.read(MAX_HTML_REPORT_BYTES + 1)
            if len(html_content) > MAX_HTML_REPORT_BYTES:
                raise HTTPException(413, 'HTML report exceeds the 100 MB limit')
            if not html_content.strip():
                raise HTTPException(400, 'HTML report is empty')
        if run.import_id:
            # An older XML-only upload can be retried with its HTML report attached.
            if html_content is not None and s.get(AutomationHtmlReport, run.id) is None:
                s.add(AutomationHtmlReport(run_id=run.id, content=html_content))
                s.commit()
            return public_run(run, s)
        if not (file.filename or '').lower().endswith('.xml'):
            raise HTTPException(415, 'Upload a .xml JUnit report')
        raw = await file.read(5_000_001)
        if len(raw) > 5_000_000:
            raise HTTPException(413, 'XML file too large')
        # Scope duplicate detection to the run so identical results on later runs remain separate attempts.
        result = import_junit_content(run.cycle_id, file.filename, raw, s, actor, run.project_id, commit=False, run_id=run.id)
        run.import_id = result['import_id']
        if html_content is not None:
            s.add(AutomationHtmlReport(run_id=run.id, content=html_content))
        s.commit()
        return public_run(run, s)

    return router
