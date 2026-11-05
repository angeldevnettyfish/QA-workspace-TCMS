# Run automation on another PC with Bitbucket Cloud

Flow: Automation → Run automation → Bitbucket custom pipeline → self-hosted runner PC → JUnit upload → Automation run history, Execution, and CSV Reports.

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

For `docpanel/onboarding_pipeline_testscript` on branch `main`, use custom pipeline `daily-onboarding`. The supplied pytest pipeline already generates `$REPORT_DIR/results.xml`. Its tailored configuration is [onboarding-bitbucket-pipelines.yml](./onboarding-bitbucket-pipelines.yml): copy it to the automation repository as `bitbucket-pipelines.yml`, together with `scripts/upload_junit.py`. It retains the existing `self.hosted`, `linux.shell`, `kiwi` labels, resume logic, and HTML/Excel/screenshot artifacts. It uploads the current run's JUnit XML and HTML report before returning pytest's exit code; an upload failure also fails an otherwise successful test step. Manual Bitbucket runs without callback variables continue to generate artifacts and skip the app upload. The app imports JUnit execution results and stores the self-contained HTML report for viewing from Automation → View HTML report. HTML/Excel/screenshots also remain in the existing locations and Bitbucket artifacts.

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
