# Resource Management

Open **Resource Management** above Admin in the sidebar. Global Admin, QA Lead,
and Test Lead accounts can use this team-wide tracker. It is independent of the
project selected elsewhere in the application.

Create a sprint or import a UTF-8 Sprint Testing Tracker CSV. The importer reads
the sprint title, blank separator and these 17 headers:

Item ID, Start Date, Sprint Item / Task, Test Activity, Tester, Priority, Est. Hrs,
Actual Hrs, Completion %, End Date, Status, Impediment, Release, Unplanned Hrs,
Test Cases, Defects, Comment.

CSV imports append tasks. By default the title selects or creates a sprint;
check **Import into selected sprint** to choose the destination yourself. The
same file cannot be imported twice into the same sprint. Blank rows and a
comment-only footer are ignored. Validation errors identify the CSV row and
leave the sprint unchanged. Maximum file size is 2 MB.

Duplicate Item IDs are preserved as distinct tasks. Blank numbers remain blank.
Completion is entered independently rather than calculated from hours; values
above 100% are allowed. Tester names are free text, so importing a name does not
create an account. Test Cases and Defects are sprint tracker counts and do not
create repository cases or defects.

The summary and workload cards use all active tasks in the sprint. Estimated,
actual and unplanned hours are separate totals; unplanned hours are not added to
actual hours. Completed and Closed tasks count as done. The workload bar shows
actual hours relative to estimated hours, with overruns highlighted. Click a
workload card to filter the tracker by tester. Search, status, priority and
activity filters affect the task table.

Use Add task or Edit to maintain all 17 fields. Archive hides a task from active
totals; Show archived exposes its Restore action. Export CSV downloads all active
tasks in the selected sprint, regardless of table filters. Text that could be
interpreted as a spreadsheet formula is prefixed with an apostrophe on export.

Data is stored in resource_sprints, resource_items and resource_imports. Migration
0008 creates the tables. Create, edit, archive, restore and import actions are
recorded in the audit log. Imported CSV contents are not embedded in migrations.

## Daily email summary

On the Resource Management overview, an Admin or QA/Test Lead can set the
recipient, daily send time (India Standard Time), and enable/disable the summary.
The email includes active task details for all sprints, employee workload totals,
and timesheets started that day. **Send summary now** sends an immediate preview
to the configured recipient.

Gmail delivery requires a Gmail App Password configured only on the backend:

```dotenv
RESOURCE_SMTP_HOST=smtp.gmail.com
RESOURCE_SMTP_PORT=587
RESOURCE_SMTP_USERNAME=sender@gmail.com
RESOURCE_SMTP_PASSWORD=your-gmail-app-password
RESOURCE_SMTP_FROM=sender@gmail.com
RESOURCE_REPORT_RECIPIENT=kavaskar.docpanel@gmail.com
```

Never put the Gmail App Password in the browser or chat. Recreate the backend
after updating `.env`. The scheduler runs in the backend process, uses Asia/Kolkata
time, and records the last send date or delivery error in the Resource Management
email panel.
