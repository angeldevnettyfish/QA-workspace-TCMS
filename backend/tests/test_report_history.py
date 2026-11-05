import json
from html import escape
from app.report_history import report_test_results, backfill_report_history
from test_bitbucket import client, configured, trigger
from app import main
from app.models import AutomationHtmlReport, AutomationTestResults


def html_report(tests):
    return ('<div id="data-container" data-jsonblob="'+escape(json.dumps({'tests':tests}), quote=True)+'"></div>').encode()


def test_extracts_report_results_without_executing_html():
    html = html_report({'tests/test_login.py::test_login':[
        {'result':'Passed','duration':'00:01:03'},
        {'result':'Error','duration':'0.25','log':'Expected <dashboard>'},
        {'result':'Skipped','duration':'invalid'},
    ]})
    tests = report_test_results(html)
    assert [t['status'] for t in tests] == ['Passed','Failed','Skipped']
    assert tests[0]['external_id'] == 'tests.test_login.test_login'
    assert tests[0]['duration'] == '63'
    assert tests[1]['duration'] == '0.25'
    assert tests[1]['message'] == 'Expected <dashboard>'
    assert tests[2]['duration'] == ''
    assert report_test_results(b'<script>throw "ignored";</script>') is None
    assert report_test_results(b'<div id="data-container" data-jsonblob="invalid"></div>') is None
    assert report_test_results(html_report({})) == []


def test_backfills_old_runs_and_keeps_existing_results(client, configured):
    project, cycle, calls = configured
    run, _ = trigger(client, cycle, calls)
    with main.SessionLocal() as session:
        session.add(AutomationHtmlReport(run_id=run['id'], content=html_report({
            'smoke.py::login':[{'result':'Failed','duration':'00:00:02','log':'Expected dashboard'}]})))
        session.commit()
        assert backfill_report_history(session) == {run['id']:1}
        session.commit()
        assert backfill_report_history(session) == {}
        assert session.get(AutomationTestResults, run['id']).tests[0]['case_id'] is not None
    history = client.get(f"/api/automation/runs?project_id={project['id']}").json()
    assert history[0]['test_results'][0]['status'] == 'Failed'
