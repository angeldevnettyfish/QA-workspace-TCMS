"""Bitbucket Cloud dispatch and per-run JUnit callbacks."""
import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AutomationRun, AutomationHtmlReport, BitbucketConfig, ImportLog, Project, User, now


class ConfigIn(BaseModel):
    workspace: str = Field(pattern=r'^[A-Za-z0-9_-]{1,100}$')
    repository: str = Field(pattern=r'^[A-Za-z0-9_.-]{1,100}$')
    branch: str = Field(min_length=1, max_length=200)
    pipeline: str = Field(min_length=1, max_length=200)


class RunIn(BaseModel):
    cycle_id: int


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


def create_bitbucket_router(db, user, accessible, require_project_role, obj, project_for_cycle, audit, import_junit_content):
    router = APIRouter(prefix='/api/automation')

    def public_run(run, session):
        log = session.get(ImportLog, run.import_id) if run.import_id else None
        return {**{key: getattr(run, key) for key in (
            'id', 'project_id', 'cycle_id', 'branch', 'pipeline', 'build_number',
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

    @router.post('/runs')
    def trigger(body: RunIn, s: Session = Depends(db), u: User = Depends(user)):
        pid = project_for_cycle(s, body.cycle_id)
        accessible(s, u, pid)
        require_project_role(s, u, pid, ('admin', 'lead'))
        cfg = s.get(BitbucketConfig, pid)
        if not cfg:
            raise HTTPException(400, 'Save the project Bitbucket settings first')
        base = callback_base()
        if not os.getenv('BITBUCKET_API_TOKEN', '').strip():
            raise HTTPException(503, 'Set BITBUCKET_API_TOKEN on the backend first')
        secret = secrets.token_urlsafe(32)
        run = AutomationRun(project_id=pid, cycle_id=body.cycle_id, user_id=u.id,
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
        return public_run(run, s)

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
            html_content = await html_report.read(10_000_001)
            if len(html_content) > 10_000_000:
                raise HTTPException(413, 'HTML report exceeds the 10 MB limit')
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
