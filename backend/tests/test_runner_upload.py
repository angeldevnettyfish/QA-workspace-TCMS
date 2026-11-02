import importlib.util
from pathlib import Path
import xml.etree.ElementTree as ET
import pytest
from email.parser import BytesParser
from email.policy import default


@pytest.mark.parametrize('include_html', [False, True])
def test_runner_merges_reports_and_posts_multipart_without_logging_secret(tmp_path, monkeypatch, capsys, include_html):
    spec = importlib.util.spec_from_file_location('upload_junit', Path(__file__).resolve().parents[2]/'scripts/upload_junit.py')
    uploader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(uploader)
    (tmp_path/'one.xml').write_text('<testsuite><testcase classname="one" name="pass"/></testsuite>')
    (tmp_path/'two.xml').write_text('<testsuites><testsuite><testcase classname="two" name="fail"><failure/></testcase></testsuite></testsuites>')
    argv = ['upload_junit.py', str(tmp_path/'*.xml')]
    if include_html:
        (tmp_path/'report.html').write_text('<html><body>Onboarding results</body></html>')
        argv.extend(['--html', str(tmp_path/'report.html')])
    monkeypatch.setattr(uploader.sys, 'argv', argv)
    monkeypatch.setenv('QA_CALLBACK_URL', 'https://qa.example.test/api/v1/automation/runs/42/report')
    monkeypatch.setenv('QA_CALLBACK_TOKEN', 'private-run-token')
    monkeypatch.setenv('QA_RUN_ID', '42')
    requests = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *args): pass

    class Opener:
        def open(self, request, timeout):
            requests.append(request)
            return Response()

    monkeypatch.setattr(uploader.urllib.request, 'build_opener', lambda *args: Opener())
    uploader.main()
    request = requests[0]
    assert request.get_header('Authorization') == 'Bearer private-run-token'
    assert request.full_url.endswith('/42/report')
    message = BytesParser(policy=default).parsebytes(('Content-Type: '+request.get_header('Content-type')+'\r\n\r\n').encode()+request.data)
    parts = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True) for part in message.iter_parts()}
    xml = parts['file']
    assert ('html_report' in parts) is include_html
    if include_html:
        assert b'Onboarding results' in parts['html_report']
    root = ET.fromstring(xml)
    assert len(root.findall('.//testcase')) == 2
    assert root.find('.//failure') is not None
    output = capsys.readouterr().out
    assert '42' in output
    assert 'private-run-token' not in output
