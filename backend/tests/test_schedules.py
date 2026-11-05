from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from app import bitbucket, main
from app.models import AutomationSchedule, AutomationRun, Project, User
from test_srs_workflows import client
from test_bitbucket import configured, XML

CURRENT = datetime(2030, 1, 1, tzinfo=timezone.utc)
DUE = datetime(2030, 1, 2, 3, 30, tzinfo=timezone.utc)

@pytest.fixture
def setup_schedule(client, configured, monkeypatch):
    monkeypatch.setattr(bitbucket, 'now', lambda: CURRENT)
    project, cycle, calls = configured
    body = dict(name='Morning onboarding', cycle_id=cycle['id'], frequency='once', timezone='Asia/Kolkata', start_local='2030-01-02T09:00', enabled=True)
    return project, cycle, calls, body

def create(client, project, body):
    response = client.post(f"/api/automation/schedules?project_id={project['id']}", json=body)
    assert response.status_code == 200, response.text
    return response.json()

def test_create_edit_toggle_and_ist_conversion(client, setup_schedule):
    project, _, calls, body = setup_schedule
    value = create(client, project, body)
    assert value['next_run_at'] == DUE.isoformat()
    url = f"/api/automation/schedules/{value['id']}"
    assert client.patch(url, json={'enabled': False}).json()['enabled'] is False
    main.automation_router.run_due_schedules(DUE)
    assert calls == []
    changed = client.put(url, json={**body, 'frequency': 'weekly', 'start_local': '2030-01-03T10:15', 'enabled': False})
    assert changed.status_code == 200
    assert changed.json()['next_run_at'] == '2030-01-03T04:45:00+00:00'
    assert client.patch(url, json={'enabled': True}).json()['enabled'] is True

def test_once_dispatch_callback_and_no_duplicate(client, setup_schedule):
    project, _, calls, body = setup_schedule
    create(client, project, body)
    main.automation_router.run_due_schedules(DUE-timedelta(seconds=1))
    assert calls == []
    main.automation_router.run_due_schedules(DUE)
    main.automation_router.run_due_schedules(DUE)
    assert len(calls) == 1
    payload = calls[0][4]
    variables = {v['key']: v['value'] for v in payload['variables']}
    assert variables['QA_CALLBACK_URL'].endswith(f"/{variables['QA_RUN_ID']}/report")
    assert payload['target']['selector']['pattern'] == 'qa-automation'
    assert next(v for v in payload['variables'] if v['key'] == 'QA_CALLBACK_TOKEN')['secured'] is True
    schedules = client.get(f"/api/automation/schedules?project_id={project['id']}").json()
    assert schedules[0]['enabled'] is False
    assert schedules[0]['last_run_id'] == int(variables['QA_RUN_ID'])
    response = client.post(f"/api/automation/runs/{variables['QA_RUN_ID']}/report", headers={'Authorization': 'Bearer '+variables['QA_CALLBACK_TOKEN']}, files={'file': ('results.xml', XML, 'application/xml')})
    assert response.status_code == 200
    assert response.json()['report']['imported'] == 1
    assert variables['QA_CALLBACK_TOKEN'] not in str(schedules)

@pytest.mark.parametrize('frequency,expected', [('daily', '2030-01-06T03:30:00+00:00'), ('weekly', '2030-01-09T03:30:00+00:00')])
def test_recurrence_coalesces_missed_runs(client, setup_schedule, frequency, expected):
    project, _, calls, body = setup_schedule
    create(client, project, {**body, 'frequency': frequency})
    overdue = datetime(2030, 1, 5, 12, tzinfo=timezone.utc)
    main.automation_router.run_due_schedules(overdue)
    main.automation_router.run_due_schedules(overdue)
    assert len(calls) == 1
    value = client.get(f"/api/automation/schedules?project_id={project['id']}").json()[0]
    assert value['enabled'] is True
    assert value['next_run_at'] == expected

def test_multiple_workers_claim_one_occurrence(client, setup_schedule):
    project, _, calls, body = setup_schedule
    create(client, project, body)
    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(main.automation_router.run_due_schedules, [DUE, DUE]))
    assert len(calls) == 1
    with main.SessionLocal() as session:
        assert len(session.scalars(select(AutomationRun)).all()) == 1

def test_uncertain_dispatch_not_retried(client, setup_schedule, monkeypatch):
    project, _, _, body = setup_schedule
    create(client, project, body)
    calls = []
    def fail(*args, **kwargs):
        from fastapi import HTTPException
        calls.append(True)
        raise HTTPException(502, 'Dispatch response uncertain')
    monkeypatch.setattr(bitbucket, 'bitbucket_request', fail)
    main.automation_router.run_due_schedules(DUE)
    main.automation_router.run_due_schedules(DUE)
    assert len(calls) == 1
    value = client.get(f"/api/automation/schedules?project_id={project['id']}").json()[0]
    assert value['last_error'] == 'Dispatch response uncertain'
    assert value['last_run_id'] is not None

@pytest.mark.parametrize('problem', ['inactive-owner', 'archived-project', 'permission-revoked'])
def test_permissions_rechecked_when_due(client, setup_schedule, problem):
    from app.models import Membership
    project, _, calls, body = setup_schedule
    value = create(client, project, body)
    with main.SessionLocal() as session:
        schedule = session.get(AutomationSchedule, value['id'])
        actor = session.get(User, schedule.user_id)
        if problem == 'inactive-owner': actor.active = False
        elif problem == 'archived-project': session.get(Project, project['id']).archived = True
        else:
            actor.role = 'viewer'; actor.roles = ['viewer']
            member = session.scalar(select(Membership).where(Membership.user_id == actor.id, Membership.project_id == project['id']))
            member.role = 'viewer'
        session.commit()
    main.automation_router.run_due_schedules(DUE)
    assert calls == []
    with main.SessionLocal() as session:
        assert session.get(AutomationSchedule, value['id']).last_error

def test_validation_and_project_access(client, setup_schedule):
    project, _, _, body = setup_schedule
    for updates in ({'start_local': '2029-01-01T09:00'}, {'name': ' '}, {'timezone': 'Invalid/Zone'}, {'frequency': 'hourly'}, {'start_local': '2030-01-02T09:00+05:30'}):
        assert client.post(f"/api/automation/schedules?project_id={project['id']}", json={**body, **updates}).status_code == 422
    other = client.post('/api/projects', json={'key': 'OTHER', 'name': 'Other project'}).json()
    assert client.post(f"/api/automation/schedules?project_id={other['id']}", json=body).status_code == 400
    value = create(client, project, body)
    viewer = client.post('/api/users', json={'email': 'schedule-viewer@test.local', 'name': 'Viewer', 'password': 'viewer-password-2026', 'role': 'viewer'}).json()
    client.post(f"/api/projects/{project['id']}/members", json={'user_id': viewer['id'], 'role': 'viewer'})
    client.post('/api/auth/logout')
    client.post('/api/auth/login', json={'email': 'schedule-viewer@test.local', 'password': 'viewer-password-2026'})
    assert client.get(f"/api/automation/schedules?project_id={project['id']}").status_code == 200
    assert client.get(f"/api/automation/schedules?project_id={other['id']}").status_code == 403
    assert client.post(f"/api/automation/schedules?project_id={project['id']}", json=body).status_code == 403
    assert client.put(f"/api/automation/schedules/{value['id']}", json=body).status_code == 403
    assert client.patch(f"/api/automation/schedules/{value['id']}", json={'enabled': False}).status_code == 403

def test_reenable_finished_once_requires_future_time(client, setup_schedule, monkeypatch):
    project, _, _, body = setup_schedule
    value = create(client, project, body)
    main.automation_router.run_due_schedules(DUE)
    monkeypatch.setattr(bitbucket, 'now', lambda: DUE+timedelta(seconds=1))
    assert client.patch(f"/api/automation/schedules/{value['id']}", json={'enabled': True}).status_code == 422

def test_application_lifespan_dispatches_due_schedule_without_manual_tick(client, setup_schedule, monkeypatch):
    from threading import Event
    from fastapi.testclient import TestClient
    from app.models import now
    project, _, calls, body = setup_schedule
    value = create(client, project, body)
    completed = Event()
    request = bitbucket.bitbucket_request
    def dispatch(*args, **kwargs):
        result = request(*args, **kwargs)
        completed.set()
        return result
    monkeypatch.setattr(bitbucket, 'bitbucket_request', dispatch)
    monkeypatch.setattr(bitbucket, 'SCHEDULER_POLL_SECONDS', 0.02)
    with main.SessionLocal() as session:
        value = session.get(AutomationSchedule, value['id'])
        value.start_at = now()-timedelta(seconds=1)
        value.next_run_at = value.start_at
        session.commit()
    with TestClient(main.app):
        assert completed.wait(3), 'Background scheduler did not dispatch the due run'
    assert len(calls) == 1
