# Docpanel QA

A self-hosted QA test management system for a small team. Stack: React/TypeScript, FastAPI, SQLAlchemy and PostgreSQL with Alembic migrations. The local development workflow connects directly to PostgreSQL on the host at `127.0.0.1:5432`; it does not need Docker.

## Local quick start (PostgreSQL on this machine)

Requirements: Python 3.12, Node 22+, and a local PostgreSQL 16 server. This workspace has a user-owned PostgreSQL cluster under `.local/` and a helper to start it.

1. Configure `.env` with the local PostgreSQL host, port, database, user and password. For this workspace use `DB_HOST=127.0.0.1` and `DB_PORT=5432`.
2. Start the local PostgreSQL server:

   ```sh
   bash scripts/local_postgres.sh start
   bash scripts/local_postgres.sh status
   ```

3. Start the backend from `backend/`:

   ```sh
   ../.venv/bin/python -m uvicorn app.main:app --env-file ../.env --host 127.0.0.1 --port 8002 --reload
   ```

4. In a second terminal, start the frontend from `frontend/`:

   ```sh
   npm install
   npm run dev
   ```

Open http://localhost:8080. Sign in with `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`. The backend applies its Alembic schema migration at startup. PostgreSQL data stays in the local `.local/postgres` directory; uploaded evidence stays in the backend's local upload directory.

The local PostgreSQL server is not configured to start automatically after reboot. Run `bash scripts/local_postgres.sh start` before starting the backend.

## Optional Docker deployment

`docker compose up --build -d` runs the complete app stack with its own PostgreSQL container and Docker volume. Use the local quick start above when the database must run on the host instead of in Docker.

For the end-to-end project, test-case, plan, cycle, execution, and report workflow, see the [user manual](./USER-MANUAL.md).

To trigger automation on a separate Bitbucket runner PC and receive JUnit reports here, see [Bitbucket automation setup](./docs/BITBUCKET-AUTOMATION.md).

## Database configuration

Configure PostgreSQL in the root `.env` using `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. Restart the backend after editing these values. The password is used as entered; URL encoding is handled automatically. The local workflow uses these settings to connect directly to the host PostgreSQL server. Docker Compose overrides them to use its separate `db` container. These settings connect to an existing PostgreSQL database; they do not install a database or move existing data. Changing the Compose database name/user/password does not update an existing PostgreSQL volume.

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
Do not expose port 8080 over plain HTTP to the company network. Terminate TLS at a company-managed reverse proxy/VPN ingress, set `COOKIE_SECURE=true`, and configure firewall allowlists. If using the optional Docker deployment, keep its PostgreSQL service private and do not publish its port. Rotate secrets and restrict integration tokens to the intended project.

Passwords use salted PBKDF2-HMAC-SHA256; browser sessions are HttpOnly cookies; API token values are shown once and only their hashes are stored. Evidence is limited to PNG/JPEG/WEBP/TXT/LOG and a configurable upload-size cap, and uses private storage keys.

No automatic retention purge is enabled: execution and audit history remain available until the organization approves a retention/deletion policy. Availability goals, backup retention and recovery objectives must be agreed with IT before production.

The SRS's 10-user pilot, representative-data performance test, security review and restore drill still need to be completed on the target Linux host before production approval. Explicitly out-of-scope items remain SSO, native mobile, test-script execution, AI test design, Jira integration, advanced workflow design and complex requirement management. The case editor currently accepts steps as JSON.
