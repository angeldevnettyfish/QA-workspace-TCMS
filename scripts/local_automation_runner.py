#!/usr/bin/env python3
"""Poll TCMS for local automation jobs and run approved 88-PC shell scripts."""
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request


BASE_URL = os.getenv('TCMS_BASE_URL', 'http://127.0.0.1:8080').rstrip('/')
AUTOMATION_DIR = Path(os.getenv(
    'AUTOMATION_DIR', '/home/docpanel/Automation/onboarding_pipeline_testscript')).resolve()
SCRIPT_DIR = Path(os.getenv(
    'LOCAL_RUN_SCRIPTS_DIR', str(AUTOMATION_DIR / 'tcms-scripts'))).resolve()
REPORT_ROOT = Path(os.getenv(
    'REPORT_ROOT', '/home/docpanel/Automation_report/onboarding/tcms-local-runs'))
POLL_SECONDS = 5
REQUEST_TIMEOUT_SECONDS = 15
RUN_TIMEOUT_SECONDS = 4 * 60 * 60


class RunnerError(RuntimeError):
    pass


def api_request(path, token, payload=None):
    body = json.dumps(payload).encode() if payload is not None else b'{}'
    request = urllib.request.Request(
        f'{BASE_URL}/api/v1/automation/{path}',
        data=body,
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            raw = response.read()
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise RunnerError(f'TCMS request failed ({type(exc).__name__})') from None
    return json.loads(raw) if raw else None


def available_scripts():
    if not SCRIPT_DIR.is_dir():
        return []
    scripts = []
    for path in sorted(SCRIPT_DIR.iterdir(), key=lambda item: item.name.lower()):
        if path.suffix != '.sh' or path.is_symlink() or not path.is_file():
            continue
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_. -]{0,115}\.sh', path.name):
            raise RunnerError(f'Unsupported local script filename: {path.name}')
        scripts.append(path.name)
    if len(scripts) > 100:
        raise RunnerError('The local script directory may contain at most 100 .sh files')
    return scripts


def _run(command, cwd, env, timeout):
    process = subprocess.Popen(command, cwd=cwd, env=env, start_new_session=True)
    try:
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait()
        raise RunnerError('Automation exceeded the four-hour run limit') from None


def execute_run(run, token):
    run_id = run['run_id']
    script_name = run.get('script')
    if script_name not in available_scripts():
        raise RunnerError('The selected .sh script is no longer available on the 88 PC')
    script_path = SCRIPT_DIR / script_name
    if script_path.resolve().parent != SCRIPT_DIR or script_path.is_symlink():
        raise RunnerError('The selected .sh script must be a regular file in the configured script directory')
    venv_python = AUTOMATION_DIR / '.venv/bin/python'
    python = Path(os.getenv('LOCAL_PYTHON', str(venv_python if venv_python.is_file() else sys.executable)))
    upload = Path(__file__).resolve().with_name('upload_junit.py')
    if not python.is_file() or not upload.is_file():
        raise RunnerError('Runner Python or the TCMS report uploader is missing on the runner PC')

    report_dir = REPORT_ROOT / f'run-{run_id}'
    report_dir.mkdir(parents=True, exist_ok=False)
    env = os.environ.copy()
    env.pop('LOCAL_RUNNER_TOKEN', None)
    env.update({
        'FRESH_RUN': 'true',
        'PATH': f'{AUTOMATION_DIR / ".venv/bin"}:{env.get("PATH", "")}',
        'REPORT_BASE': str(report_dir),
        'PENDING_REPORT_BASE': str(report_dir / 'pending'),
    })

    xml_path = report_dir / 'results.xml'
    html_path = report_dir / 'report.html'
    env.update({
        'QA_JUNIT_XML': str(xml_path),
        'QA_HTML_REPORT': str(html_path),
    })
    test_status = _run(
        ['/bin/bash', str(script_path), f'--html={html_path}', '--self-contained-html', f'--junitxml={xml_path}'],
        AUTOMATION_DIR, env, RUN_TIMEOUT_SECONDS)
    uploaded = False
    upload_error = None
    if xml_path.is_file():
        upload_env = env | {
            'QA_RUN_ID': str(run_id),
            'QA_CALLBACK_URL': run['callback_url'],
            'QA_CALLBACK_TOKEN': run['callback_token'],
        }
        upload_command = [str(python), str(upload), str(xml_path)]
        if html_path.is_file():
            upload_command.extend(['--html', str(html_path)])
        uploaded = _run(upload_command, AUTOMATION_DIR, upload_env, 120) == 0
        if not uploaded:
            upload_error = 'JUnit/HTML report upload failed; check the local runner log'
    else:
        upload_error = 'Automation did not produce a JUnit report'

    result = 'SUCCESSFUL' if test_status == 0 and uploaded else 'FAILED'
    error = upload_error or (None if test_status == 0 else f'Automation exited with code {test_status}')
    api_request(f'local/runs/{run_id}/finish', token, {'result': result, 'error': error})


def run_forever():
    token = os.getenv('LOCAL_RUNNER_TOKEN', '').strip()
    if not token:
        raise SystemExit('LOCAL_RUNNER_TOKEN is required')
    if not AUTOMATION_DIR.is_dir():
        raise SystemExit('Automation directory is missing on the 88 PC')

    stop = threading.Event()

    def heartbeat():
        while not stop.is_set():
            try:
                api_request('local/heartbeat', token, {'scripts': available_scripts()})
            except RunnerError as exc:
                print(exc, flush=True)
            stop.wait(10)

    threading.Thread(target=heartbeat, daemon=True).start()
    print(f'Local automation runner watching {SCRIPT_DIR}', flush=True)
    try:
        while not stop.is_set():
            try:
                run = api_request('local/claim', token)
                if run:
                    print(f"Starting local automation run #{run['run_id']}", flush=True)
                    try:
                        execute_run(run, token)
                    except Exception as exc:
                        print(f'Local automation run failed ({type(exc).__name__})', flush=True)
                        try:
                            api_request(f"local/runs/{run['run_id']}/finish", token, {
                                'result': 'FAILED',
                                'error': str(exc)[:1000],
                            })
                        except RunnerError:
                            print('Could not report local automation failure to TCMS', flush=True)
                    else:
                        print(f"Local automation run #{run['run_id']} completed", flush=True)
                else:
                    stop.wait(POLL_SECONDS)
            except RunnerError as exc:
                print(exc, flush=True)
                stop.wait(POLL_SECONDS)
    except KeyboardInterrupt:
        stop.set()


if __name__ == '__main__':
    run_forever()
