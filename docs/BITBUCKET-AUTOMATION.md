# Run automation on another PC with Bitbucket Cloud

Flow: Automation → Run automation → Bitbucket custom pipeline → self-hosted runner PC → JUnit upload → Automation run history, Execution, and CSV Reports.

## Run locally on the 88 PC (without Bitbucket)

The Automation header has **Schedule**, **Local**, and **History** buttons. Bitbucket remains available through **Run on Bitbucket**. Click **Local**, choose a report cycle and one of the `.sh` files advertised by the 88 PC runner, then click **Run locally**. The runner executes that script from a dedicated folder and uploads its JUnit and HTML reports to the selected cycle. The browser cannot provide an arbitrary shell command or path.

On the 88 PC, configure the private runner token and approved script folder in `/opt/qa-manager/local-runner.env`:

```sh
cd /opt/qa-manager
umask 077
python3 -c 'import secrets; print("LOCAL_RUNNER_TOKEN=" + secrets.token_urlsafe(48))' > local-runner.env
printf '%s\n' \
  'AUTOMATION_DIR=/home/docpanel/Automation/onboarding_pipeline_testscript' \
  'LOCAL_RUN_SCRIPTS_DIR=/home/docpanel/Automation/onboarding_pipeline_testscript/tcms-scripts' >> local-runner.env
chmod 600 local-runner.env
mkdir -p /home/docpanel/Automation/onboarding_pipeline_testscript/tcms-scripts
docker compose up -d --force-recreate backend
mkdir -p ~/.config/systemd/user
install -m 644 scripts/qa-local-automation-runner.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now qa-local-automation-runner.service
```

Put one `.sh` file per selectable test run directly inside `tcms-scripts`. For example, `run-onboarding.sh` can contain:

```sh
#!/usr/bin/env bash
set -euo pipefail
cd /home/docpanel/Automation/onboarding_pipeline_testscript
source .venv/bin/activate
python -m pytest tests/ -v -s "$@"
```

The runner invokes the selected file with Bash and appends the HTML/JUnit output arguments. Forward `"$@"` to the single pytest command so the reports are written for TCMS; the runner uploads them automatically. Add a script file and it should appear in the Automation page within about 10 seconds. When changing `LOCAL_RUN_SCRIPTS_DIR`, restart the service with `systemctl --user restart qa-local-automation-runner.service`. Check it with `systemctl --user status qa-local-automation-runner.service`. To start the user service automatically at boot even when the account is logged out, an administrator must enable systemd lingering for `docpanel`.

Use `AUTOMATION_DIR` for the script's initial working directory and `LOCAL_RUN_SCRIPTS_DIR` for the folder of selectable scripts. Put project-specific paths, environment activation, resume commands and test arguments inside each `.sh` file. The runner does not require an onboarding-specific `tests.resume` module. Pytest HTML output requires `pytest-html` in the test project's environment. Other tools can ignore the appended pytest arguments and write reports to the supplied `QA_JUNIT_XML` and `QA_HTML_REPORT` paths instead.

Keep `scripts/upload_junit.py` alongside `scripts/local_automation_runner.py` in the TCMS deployment. The runner uses the test project's `.venv/bin/python` when present, otherwise its own Python interpreter, to upload reports. Optionally set `LOCAL_PYTHON` to an absolute Python executable path in `local-runner.env`.

Only project admins/leads can queue local runs. The runner executes the fixed test suite as the `docpanel` OS user. Keep access to this account and the local token restricted. This mode does not dispatch a Bitbucket pipeline.

## Backend setup

Set these values in the app's `.env`, then restart the backend:

```dotenv
BITBUCKET_EMAIL=your-atlassian-account-email
BITBUCKET_API_TOKEN=your-api-token
QA_PUBLIC_URL=https://your-qa-app.example.com
```

Use an Atlassian API token with pipeline read and write scopes (`read:pipeline:bitbucket`, `write:pipeline:bitbucket`) and access to the automation repository. Alternatively, use a repository/workspace access token with pipeline read/write permissions and leave `BITBUCKET_EMAIL` empty for Bearer authentication. Credentials stay on the backend and are never returned to the browser or sent to the runner.

`QA_PUBLIC_URL` is the app's base URL, without `/api`, reachable **from the other PC**. `localhost` on that PC refers to the runner itself. The current local server binds to `127.0.0.1`; use a company reverse proxy or VPN ingress with HTTPS forwarding to this PC's port 8080. Do not configure a public URL until you have verified it reaches this application. Set `COOKIE_SECURE=true` when using HTTPS for browser access. Do not publish PostgreSQL port 5432.

## Automation repository setup

For `docpanel/onboarding_pipeline_testscript` on branch `main`, use custom pipeline `daily-onboarding`. The supplied pytest pipeline already generates `$REPORT_DIR/results.xml`. Its tailored configuration is [onboarding-bitbucket-pipelines.yml](./onboarding-bitbucket-pipelines.yml): copy it to the automation repository as `bitbucket-pipelines.yml`, together with `scripts/upload_junit.py`. It retains the existing `self.hosted`, `linux.shell`, `kiwi` labels, resume logic, and HTML/Excel/screenshot artifacts. It uploads the current run's JUnit XML and HTML report before returning pytest's exit code; an upload failure also fails an otherwise successful test step. Manual Bitbucket runs without callback variables continue to generate artifacts and skip the app upload. The app imports JUnit execution results and stores self-contained HTML reports up to 100 MB for viewing from Automation → View HTML report. HTML/Excel/screenshots also remain in the existing locations and Bitbucket artifacts.

1. Copy `scripts/upload_junit.py` into the automation repository at the same path.
2. Merge `docs/bitbucket-pipelines.example.yml` into that repository's `bitbucket-pipelines.yml`. The example uses Playwright on a Linux Shell runner. Replace the test command/report path for your framework; keep JUnit XML output and the upload in `after-script` so failed tests also report results.
3. Match `runs-on` labels to the runner registered with Bitbucket. The runner executes the script; the web app does not SSH to the PC.
4. Commit the helper and pipeline to the branch you will run. This project's changes do not automatically modify your separate automation repository.

For a Windows runner, use labels `self.hosted`, `windows` and PowerShell syntax:

```yaml
script:
  - npm ci
  - $env:PLAYWRIGHT_JUNIT_OUTPUT_FILE = "test-results/junit.xml"
  - npx playwright test --reporter=junit
after-script:
  - python scripts/upload_junit.py test-results/junit.xml
```

The helper requires Python 3, merges multiple JUnit paths/globs into one upload (5 MB maximum), accepts `--html path/to/report.html` (10 MB maximum), and retries temporary failures. HTML must be self-contained, with embedded styles/scripts/images. External assets and network requests are blocked in the report viewer. For example: `python3 scripts/upload_junit.py results.xml --html report.html`. The existing XML-only invocation remains supported. Check the upload message in the runner log: Bitbucket can consider a step successful even when an `after-script` command fails. The app independently shows whether a report arrived.

## Use the app

1. Create a project, test cases, plan and cycle; add the cases to the cycle.
2. In Automation, save the workspace, repository **slug**, branch and custom pipeline name (`qa-automation` in the example). This integration supports Bitbucket Cloud.
3. Map each stable JUnit `classname.name` identifier to a project test case. Unmapped cases appear in the run report for review and do not create execution results.
4. Select the report cycle and click **Run automation**. Only project admins/leads can configure or trigger runs.
5. Run history shows incoming reports automatically every 10 seconds. **Refresh status** retrieves the current Bitbucket pipeline state; **Open Bitbucket** opens the pipeline logs. **View HTML report** opens the uploaded HTML inside the app; report access follows project membership permissions. Imported execution results are available under Execution and Reports for the selected cycle.

Each trigger passes `QA_RUN_ID`, `QA_CALLBACK_URL`, and a secured `QA_CALLBACK_TOKEN` to the pipeline. Do not override or log these variables. The callback token expires after 24 hours and only uploads to its own run/cycle. Retries of a received report do not create duplicate executions; identical results from a new run create a new attempt.

If dispatch is unconfirmed (for example, a network timeout), check Bitbucket before clicking Run again: the remote pipeline might have started. A completed pipeline without an uploaded report remains visibly marked **No report received**. No report is fabricated for runner/setup failures.

Official references: [Pipelines REST API](https://developer.atlassian.com/cloud/bitbucket/rest/api-group-pipelines/), [runner labels](https://support.atlassian.com/bitbucket-cloud/docs/configure-your-runner-in-bitbucket-pipelines-yml/).
