"""Read saved pytest-html data without executing report scripts."""
import json
import math
from html.parser import HTMLParser
from sqlalchemy import select
from .models import AutomationHtmlReport, AutomationTestResults, AutomationRun, AutomationMap


class ReportDataParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.data = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if attrs.get('id') == 'data-container' and 'data-jsonblob' in attrs:
            self.data = attrs['data-jsonblob']


def report_test_results(content):
    parser = ReportDataParser()
    try:
        parser.feed(content.decode('utf-8', errors='replace') if isinstance(content, bytes) else content)
        data = json.loads(parser.data) if parser.data else None
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict) or not isinstance(data.get('tests'), dict):
        return None
    tests = []
    for node_id, attempts in data['tests'].items():
        if not isinstance(attempts, list):
            continue
        for attempt in attempts:
            if not isinstance(attempt, dict):
                continue
            outcome = str(attempt.get('result', '')).lower()
            status = {'passed':'Passed', 'failed':'Failed', 'error':'Failed',
                      'skipped':'Skipped', 'xfailed':'Skipped', 'xpassed':'Failed'}.get(outcome)
            if status is None:
                continue
            test_id = str(attempt.get('testId') or node_id)
            parts = test_id.split('::')
            classname = parts[0].removesuffix('.py').replace('/', '.').replace('\\', '.')
            if len(parts)>2:
                classname += '.' + '.'.join(parts[1:-1])
            name = parts[-1] if len(parts)>1 else test_id
            duration = ''
            try:
                values = str(attempt.get('duration', '')).split(':')
                seconds = 0.0
                for value in values:
                    seconds = seconds*60 + float(value)
                if math.isfinite(seconds) and seconds >= 0:
                    duration = f'{seconds:g}'
            except ValueError:
                pass
            tests.append({'external_id':f'{classname}.{name}' if len(parts)>1 else test_id,
                          'name':name, 'classname':classname, 'case_id':None, 'status':status,
                          'duration':duration, 'message':str(attempt.get('log') or '')[:4000] if status=='Failed' else ''})
    return tests


def backfill_report_history(session):
    run_ids = session.scalars(select(AutomationHtmlReport.run_id).outerjoin(
        AutomationTestResults, AutomationHtmlReport.run_id == AutomationTestResults.run_id
    ).where(AutomationTestResults.run_id.is_(None))).all()
    restored = {}
    for run_id in run_ids:
        report = session.get(AutomationHtmlReport, run_id)
        tests = report_test_results(report.content)
        if tests is None:
            continue
        run = session.get(AutomationRun, run_id)
        mappings = dict(session.execute(select(AutomationMap.external_id, AutomationMap.case_id).where(
            AutomationMap.project_id == run.project_id)).all())
        for test in tests:
            test['case_id'] = mappings.get(test['external_id'])
        session.add(AutomationTestResults(run_id=run_id, tests=tests))
        restored[run_id] = len(tests)
    session.flush()
    return restored
