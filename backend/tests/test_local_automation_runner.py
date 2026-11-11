"""Exercise the shell runner without dispatching real automation or HTTP calls."""
import importlib.util
from pathlib import Path
import subprocess
import sys

import pytest

spec = importlib.util.spec_from_file_location(
    'local_worker', Path(__file__).resolve().parents[2] / 'scripts/local_automation_runner.py')
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


@pytest.mark.parametrize('exit_code,produce_report,result', [
    (0, True, 'SUCCESSFUL'), (7, True, 'FAILED'), (0, False, 'FAILED'),
])
def test_generic_shell_project_reports_success_and_failure(tmp_path, monkeypatch, exit_code, produce_report, result):
    project = tmp_path / 'project with spaces'
    scripts = project / 'scripts'
    scripts.mkdir(parents=True)
    script = scripts / 'run smoke.sh'
    script.write_text('''#!/bin/bash
set -eu
test -z "${LOCAL_RUNNER_TOKEN:-}"
test "$PWD" = "$EXPECTED_PROJECT"
'''+('printf \'<testsuite/>\' > "$QA_JUNIT_XML"\nprintf \'<html>Report</html>\' > "$QA_HTML_REPORT"\n' if produce_report else '')+f'exit {exit_code}\n')
    monkeypatch.setattr(worker, 'AUTOMATION_DIR', project)
    monkeypatch.setattr(worker, 'SCRIPT_DIR', scripts)
    monkeypatch.setattr(worker, 'REPORT_ROOT', tmp_path / 'reports')
    monkeypatch.setenv('EXPECTED_PROJECT', str(project))
    monkeypatch.setenv('LOCAL_RUNNER_TOKEN', 'worker-secret')
    monkeypatch.setenv('LOCAL_PYTHON', sys.executable)
    uploads, finished = [], []

    def run(command, cwd, env, timeout):
        if command[0] == '/bin/bash':
            assert command[1] == str(script)
            assert any(arg.startswith('--junitxml=') for arg in command)
            return subprocess.run(command, cwd=cwd, env=env, check=False).returncode
        uploads.append((command, env))
        assert Path(command[1]) == Path(worker.__file__).with_name('upload_junit.py')
        assert Path(command[2]).is_file()
        assert env['QA_CALLBACK_TOKEN'] == 'report-secret'
        return 0

    monkeypatch.setattr(worker, '_run', run)
    monkeypatch.setattr(worker, 'api_request', lambda *args: finished.append(args))
    worker.execute_run({'run_id':42, 'script':script.name, 'callback_url':'http://tcms/report',
                        'callback_token':'report-secret'}, 'worker-secret')
    assert len(uploads) == int(produce_report)
    assert finished[0][0] == 'local/runs/42/finish'
    assert finished[0][2]['result'] == result


def test_unapproved_script_is_rejected(tmp_path, monkeypatch):
    scripts = tmp_path / 'scripts'
    scripts.mkdir()
    outside = tmp_path / 'outside.sh'
    outside.write_text('exit 0')
    (scripts / 'link.sh').symlink_to(outside)
    monkeypatch.setattr(worker, 'SCRIPT_DIR', scripts)
    assert worker.available_scripts() == []
    for name in ('link.sh', '../outside.sh'):
        with pytest.raises(worker.RunnerError, match='no longer available'):
            worker.execute_run({'run_id':1, 'script':name}, 'worker-secret')
