from datetime import timedelta
import pytest
from fastapi import HTTPException

from app import bitbucket, main
from app.models import AutomationRun, now
from test_srs_workflows import client, make_project, make_case, make_cycle


@pytest.fixture
def configured(client, monkeypatch):
    monkeypatch.setenv('BITBUCKET_API_TOKEN', 'secret-api-token')
    monkeypatch.setenv('QA_PUBLIC_URL', 'https://qa.example.test')
    project = make_project(client)
    case = make_case(client, project['id'])
    cycle, _ = make_cycle(client, project, case)
    config = {'workspace': 'my-team', 'repository': 'automated-tests', 'branch': 'main', 'pipeline': 'qa-automation'}
    assert client.put(f"/api/automation/bitbucket?project_id={project['id']}", json=config).status_code == 200
    assert client.post('/api/automation/mappings', json={
        'project_id': project['id'], 'case_id': case['id'], 'external_id': 'smoke.login',
    }).status_code == 200
    calls = []

    def request(workspace, repository, method='GET', suffix='', payload=None):
        calls.append((workspace, repository, method, suffix, payload))
        return {'uuid': '{run-uuid}', 'build_number': len(calls), 'state': {'name': 'PENDING'} if method == 'POST' else {'name': 'COMPLETED', 'result': {'name': 'FAILED'}}}

    monkeypatch.setattr(bitbucket, 'bitbucket_request', request)
    return project, cycle, calls


def trigger(client, cycle, calls):
    response = client.post('/api/automation/runs', json={'cycle_id': cycle['id']})
    assert response.status_code == 200, response.text
    variables = {v['key']: v['value'] for v in calls[-1][4]['variables']}
    return response.json(), variables


XML = b'<testsuite><testcase classname="smoke" name="login"><failure message="Expected dashboard"/></testcase><testcase classname="other" name="unmapped"/></testsuite>'


def upload(client, run, token, xml=XML):
    return client.post(f"/api/v1/automation/runs/{run['id']}/report", headers={'Authorization': 'Bearer '+token}, files={'file': ('junit.xml', xml, 'application/xml')})


def test_dispatch_callback_retry_and_separate_attempts(client, configured):
    project, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    assert calls[0][:3] == ('my-team', 'automated-tests', 'POST')
    payload = calls[0][4]
    assert payload['target']['selector'] == {'type': 'custom', 'pattern': 'qa-automation'}
    assert next(v for v in payload['variables'] if v['key'] == 'QA_CALLBACK_TOKEN')['secured'] is True
    assert variables['QA_CALLBACK_URL'] == f"https://qa.example.test/api/v1/automation/runs/{run['id']}/report"
    assert variables['QA_CALLBACK_TOKEN'] not in str(run)
    assert upload(client, run, 'wrong-token').status_code == 401
    response = upload(client, run, variables['QA_CALLBACK_TOKEN'])
    assert response.status_code == 200, response.text
    assert response.json()['report'] == {'imported': 1, 'unmatched': ['other.unmapped'], 'errors': []}
    assert upload(client, run, variables['QA_CALLBACK_TOKEN']).status_code == 200
    attempts = client.get(f"/api/executions?cycle_id={cycle['id']}").json()
    assert len(attempts) == 1
    assert attempts[0]['status'] == 'Failed'
    assert attempts[0]['source'] == 'Automation'
    second, second_vars = trigger(client, cycle, calls)
    assert upload(client, second, variables['QA_CALLBACK_TOKEN']).status_code == 401
    assert upload(client, second, second_vars['QA_CALLBACK_TOKEN']).status_code == 200
    assert len(client.get(f"/api/executions?cycle_id={cycle['id']}").json()) == 2
    refreshed = client.post(f"/api/automation/runs/{run['id']}/refresh").json()
    assert refreshed['state'] == 'COMPLETED'
    assert refreshed['result'] == 'FAILED'
    assert refreshed['report']['imported'] == 1
    history = client.get(f"/api/automation/runs?project_id={project['id']}").json()
    assert len(history) == 2
    assert 'callback_hash' not in history[0]


def test_invalid_xml_expired_token_and_permission_checks(client, configured):
    project, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    assert upload(client, run, variables['QA_CALLBACK_TOKEN'], b'not xml').status_code == 400
    assert upload(client, run, variables['QA_CALLBACK_TOKEN'], b'<unrelated/>').status_code == 400
    assert upload(client, run, variables['QA_CALLBACK_TOKEN'], b'<!DOCTYPE x><testsuite/>').status_code == 400
    with main.SessionLocal() as s:
        stored = s.get(AutomationRun, run['id'])
        stored.expires_at = now()-timedelta(seconds=1)
        s.commit()
    assert upload(client, run, variables['QA_CALLBACK_TOKEN']).status_code == 401
    viewer = client.post('/api/users', json={'email': 'viewer@test.local', 'name': 'Viewer', 'password': 'viewer-password-2026', 'role': 'viewer'}).json()
    client.post(f"/api/projects/{project['id']}/members", json={'user_id': viewer['id'], 'role': 'viewer'})
    client.post('/api/auth/logout')
    client.post('/api/auth/login', json={'email': 'viewer@test.local', 'password': 'viewer-password-2026'})
    assert client.get(f"/api/automation/runs?project_id={project['id']}").status_code == 200
    assert client.post('/api/automation/runs', json={'cycle_id': cycle['id']}).status_code == 403
    assert client.put(f"/api/automation/bitbucket?project_id={project['id']}", json={'workspace': 'other', 'repository': 'repo', 'branch': 'main', 'pipeline': 'test'}).status_code == 403
    assert client.post(f"/api/automation/runs/{run['id']}/refresh").status_code == 403


def test_missing_setup_and_dispatch_failure_are_visible(client, configured, monkeypatch):
    project, cycle, calls = configured
    monkeypatch.delenv('BITBUCKET_API_TOKEN')
    assert client.post('/api/automation/runs', json={'cycle_id': cycle['id']}).status_code == 503
    monkeypatch.setenv('BITBUCKET_API_TOKEN', 'token')
    monkeypatch.setenv('QA_PUBLIC_URL', 'invalid-url')
    assert client.post('/api/automation/runs', json={'cycle_id': cycle['id']}).status_code == 503
    monkeypatch.setenv('QA_PUBLIC_URL', 'https://qa.example.test')

    def fail(*args, **kwargs):
        raise HTTPException(502, 'Bitbucket returned HTTP 403')
    monkeypatch.setattr(bitbucket, 'bitbucket_request', fail)
    response = client.post('/api/automation/runs', json={'cycle_id': cycle['id']})
    assert response.status_code == 200
    assert response.json()['state'] == 'DISPATCH_UNCONFIRMED'
    assert response.json()['error'] == 'Bitbucket returned HTTP 403'
    assert response.json()['report'] is None
    assert len(client.get(f"/api/automation/runs?project_id={project['id']}").json()) == 1


def test_html_report_upload_view_access_and_retry(client, configured):
    project, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    html = b'<html><body>Onboarding report<script>console.log("filters")</script></body></html>'
    headers = {'Authorization': 'Bearer '+variables['QA_CALLBACK_TOKEN']}
    files = {'file': ('results.xml', XML, 'application/xml'), 'html_report': ('report.html', html, 'text/html')}
    url = f"/api/automation/runs/{run['id']}/report"
    response = client.post(url, headers=headers, files=files)
    assert response.status_code == 200, response.text
    viewer_url = response.json()['html_report_url']
    assert viewer_url == f"/api/automation/runs/{run['id']}/html"
    report = client.get(viewer_url)
    assert report.status_code == 200
    assert report.content == html
    assert report.headers['content-type'].startswith('text/html')
    csp = report.headers['content-security-policy']
    assert 'sandbox allow-scripts;' in csp
    assert 'allow-same-origin' not in csp
    assert "connect-src 'none'" in csp
    assert report.headers['cache-control'] == 'no-store'
    assert client.post(url, headers=headers, files=files).status_code == 200
    assert len(client.get(f"/api/executions?cycle_id={cycle['id']}").json()) == 1
    assert client.get(f"/api/automation/runs?project_id={project['id']}").json()[0]['html_report_url'] == viewer_url
    client.post('/api/users', json={'email': 'outside@test.local', 'name': 'Outside', 'password': 'outside-password-2026', 'role': 'viewer'})
    client.post('/api/auth/logout')
    assert client.get(viewer_url).status_code == 401
    client.post('/api/auth/login', json={'email': 'outside@test.local', 'password': 'outside-password-2026'})
    assert client.get(viewer_url).status_code == 403


def test_html_can_be_attached_to_xml_only_run_without_duplicate_execution(client, configured):
    _, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    assert upload(client, run, variables['QA_CALLBACK_TOKEN']).json()['html_report_url'] is None
    response = client.post(f"/api/automation/runs/{run['id']}/report", headers={'Authorization': 'Bearer '+variables['QA_CALLBACK_TOKEN']}, files={
        'file': ('results.xml', XML, 'application/xml'), 'html_report': ('report.html', b'<html>Result</html>', 'text/html'),
    })
    assert response.status_code == 200
    assert response.json()['html_report_url']
    assert len(client.get(f"/api/executions?cycle_id={cycle['id']}").json()) == 1


@pytest.mark.parametrize('filename,content,status', [('report.txt', b'hello', 415), ('report.html', b' ', 400), ('report.html', b'x'*25_000_001, 413)], ids=['wrong-extension', 'empty-html', 'oversized-html'])
def test_rejected_html_does_not_partially_import_results(client, configured, filename, content, status):
    _, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    response = client.post(f"/api/automation/runs/{run['id']}/report", headers={'Authorization': 'Bearer '+variables['QA_CALLBACK_TOKEN']}, files={
        'file': ('results.xml', XML, 'application/xml'), 'html_report': (filename, content, 'text/html'),
    })
    assert response.status_code == status
    assert client.get(f"/api/executions?cycle_id={cycle['id']}").json() == []
    assert client.get(f"/api/automation/runs/{run['id']}/html").status_code == 404


def test_html_larger_than_old_limit_is_stored_and_viewable(client, configured):
    _, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    html = b'<html><body>' + b'x' * 10_000_001 + b'</body></html>'
    response = client.post(f"/api/automation/runs/{run['id']}/report", headers={'Authorization': 'Bearer '+variables['QA_CALLBACK_TOKEN']}, files={
        'file': ('results.xml', XML, 'application/xml'), 'html_report': ('report.html', html, 'text/html'),
    })
    assert response.status_code == 200
    assert client.get(response.json()['html_report_url']).content == html
    assert len(client.get(f"/api/executions?cycle_id={cycle['id']}").json()) == 1


def test_history_preserves_all_report_tests_and_per_run_results(client, configured):
    project, cycle, calls = configured
    run, variables = trigger(client, cycle, calls)
    xml = b'''<testsuites xmlns="urn:junit"><testsuite>
      <testcase classname="smoke" name="login" time="0.125"><failure message="Expected dashboard"/></testcase>
      <testcase classname="other" name="unmapped" time="1.2"/>
      <testcase classname="other" name="skipped"><skipped/></testcase>
      <testcase classname="other" name="broken"><error>Connection refused</error></testcase>
    </testsuite></testsuites>'''
    response = upload(client, run, variables['QA_CALLBACK_TOKEN'], xml)
    assert response.status_code == 200, response.text
    tests = response.json()['test_results']
    assert [test['status'] for test in tests] == ['Failed', 'Passed', 'Skipped', 'Failed']
    assert tests[0]['case_id'] is not None
    assert tests[0]['message'] == 'Expected dashboard'
    assert tests[0]['duration'] == '0.125'
    assert tests[1]['case_id'] is None
    assert tests[3]['message'] == 'Connection refused'
    assert upload(client, run, variables['QA_CALLBACK_TOKEN'], xml).json()['test_results'] == tests
    second, variables2 = trigger(client, cycle, calls)
    assert second['test_results'] is None
    assert upload(client, second, variables2['QA_CALLBACK_TOKEN'], b'<testsuite><testcase classname="smoke" name="login"/></testsuite>').status_code == 200
    history = client.get(f"/api/automation/runs?project_id={project['id']}").json()
    assert history[0]['test_results'][0]['status'] == 'Passed'
    assert history[1]['test_results'] == tests
