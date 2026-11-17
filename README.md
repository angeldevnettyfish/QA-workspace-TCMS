# Docpanel QA

A self-hosted QA test management system for a small team. Stack: React/TypeScript, FastAPI, SQLAlchemy, PostgreSQL, Alembic, Docker Compose and Caddy.

## Requirements
- Windows 10/11 with Docker Desktop + WSL2, or Linux with Docker Engine and Compose V2.
- Docker access to pull the PostgreSQL, Python, Node and Caddy images on first build.

## Quick start (Windows PowerShell)
```powershell
Copy-Item .env.example .env
notepad .env
# Replace the example DB_PASSWORD, JWT_SECRET and ADMIN_PASSWORD values.
# Set COOKIE_SECURE=true only when HTTPS terminates in front of the app.
docker compose up --build -d
docker compose ps
```

Open http://localhost:8080. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The backend applies its Alembic schema migration at startup. PostgreSQL and uploaded evidence persist in Docker volumes.

For the end-to-end project, test-case, plan, cycle, execution, and report workflow, see the [user manual](./USER-MANUAL.md).

To trigger automation on a separate Bitbucket runner PC and receive JUnit reports here, see [Bitbucket automation setup](./docs/BITBUCKET-AUTOMATION.md).

## Development without Docker
Backend requires Python 3.12. From `backend/`, install `requirements-dev.txt` and run:
```powershell
uvicorn app.main:app --env-file ..\.env --host 0.0.0.0 --port 8002 --reload
```

Configure PostgreSQL in the root `.env` using `DB_HOST` (IP or hostname), `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Restart the backend after editing these values. The password is used as entered; URL encoding is handled automatically. Docker Compose uses the same database name, user, and password, with its internal `db` hostname and port 5432. These settings connect to an existing PostgreSQL database; they do not install a database or move existing data. Changing the Compose database name/user/password does not update an existing PostgreSQL volume.

An optional `DATABASE_URL` overrides the separate fields for existing deployments. Leave it unset when using the separate fields. If neither `DATABASE_URL` nor `DB_HOST` is supplied, local development uses `sqlite:///./dev.db`. The initial administrator is seeded once from `.env`; changing the environment variable later does not change the existing account.

User accounts support multiple global roles: Admin, QA Lead, Test Lead, Tester and Viewer. QA Lead and Test Lead have the same lead permissions. Project memberships continue to provide project-specific access for accounts without a global admin or lead role.

Frontend requires Node 22+: from `frontend/`, run `npm install` then `npm run dev`. Vite listens on port 8080 and proxies `/api` to `http://localhost:8002`. Interactive API documentation is at http://localhost:8002/docs.

Run backend tests with `python -m pytest tests` from `backend/`. Build/type-check the UI with `npm run build` from `frontend/`.

## Implemented SRS workflows
- FR-001–003: login/logout, expiring HttpOnly SameSite cookies, disabled-account rejection and server-side project membership/role checks.
- FR-004–008: unique project keys and archiving; project folders; case search/filter/bulk archive; structured steps; immutable revisions; test metadata, author and timestamps.
- FR-009–012: release/scope plans with case selection; scheduled cycles and assignments; separate execution attempts and per-step results.
- FR-013–018: defect assignment/status/severity and multi-execution links; JUnit mappings/imports with checksum duplicate detection and unmatched review; filtered dashboard; execution/defect CSV reports.
- FR-019–022: private size/type-validated evidence storage; Excel case import/export; privileged-change audit events; single-project scoped CI tokens stored as hashes.
- FR-023–025: assignment/defect notifications; requirement-to-case traceability/coverage; project custom-field definitions and validated case values.

API endpoints are served under `/api/v1/...`; `/api/...` remains as a compatibility alias. Test steps store the overall result separately from step results; a cycle item with no attempts is Not Run.

## Backups and restore
The database and evidence volume both need backups. On the Linux host, schedule `scripts/backup.sh` daily from the project root and copy the generated SQL and attachment archives to protected off-host storage. Configure alerts for failures and set retention according to company policy.

For a restore drill, use an isolated Compose project/VM and representative backups. After confirming the maintenance window and files, run:
```sh
CONFIRM_RESTORE=YES scripts/restore.sh ./backups/qamanager-<timestamp>.sql ./backups/attachments-<timestamp>.tar.gz
```
Restore replaces the active PostgreSQL `public` schema and evidence volume. Verify `/api/health`, login, sample project/cycle history and evidence. Do not use `docker compose down -v` as a backup or restore method.

## Deployment and security
Do not expose port 8080 over plain HTTP to the company network. Terminate TLS at a company-managed reverse proxy/VPN ingress, set `COOKIE_SECURE=true`, configure firewall allowlists, and keep PostgreSQL internal to Docker. Rotate secrets and restrict integration tokens to the intended project.

Passwords use salted PBKDF2-HMAC-SHA256; browser sessions are HttpOnly cookies; API token values are shown once and only their hashes are stored. Evidence is limited to PNG/JPEG/WEBP/TXT/LOG and a configurable upload-size cap, and uses private storage keys.

No automatic retention purge is enabled: execution and audit history remain available until the organization approves a retention/deletion policy. Availability goals, backup retention and recovery objectives must be agreed with IT before production.

The SRS's 10-user pilot, representative-data performance test, security review and restore drill still need to be completed on the target Linux host before production approval. Explicitly out-of-scope items remain SSO, native mobile, test-script execution, AI test design, Jira integration, advanced workflow design and complex requirement management. The case editor currently accepts steps as JSON.
