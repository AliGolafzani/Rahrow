# Local PostgreSQL boundary

The Foundation local-only Docker boundary is retained. AUTH-01 adds explicit versioned migration and exact-schema verification; no staging/production topology, provider or deployment is authorized.

## Prerequisites and configuration

- Use the repository's Node 24/npm 11 toolchain and run `npm ci` at the root.
- Install Docker Desktop or Docker Engine **28+** with the Compose plugin (**2.20+**, or v5). The engine must be local and running. The lifecycle wrapper permits Unix sockets and local Windows named pipes, and rejects TCP/SSH endpoints. No host-security changes or privileged containers are needed.
- Copy root `.env.example` to root `.env`. Its credentials are public, disposable development examples. Never put real credentials here or commit `.env`.
- `POSTGRES_USER`/`POSTGRES_DB` use `rahrow_local` with an optional lowercase/alphanumeric/underscore suffix, and `POSTGRES_PORT` is 1024–65535. `DATABASE_URL` must match these values and use host `127.0.0.1`.
- Shell variables override `.env`. Never carry staging/production values into these commands.

Run commands from the repository root. The wrapper fixes the Compose file and default project `rahrow-local`. Arbitrary project overrides are rejected. No `container_name` or global volume name is imposed, so isolated QA projects can coexist.

| Command | Effect |
| --- | --- |
| `npm run db:config` | Validate Compose quietly; no daemon or database connection required |
| `npm run db:up` | Start PostgreSQL and wait up to 90 seconds for health |
| `npm run db:status` | Show container state, including stopped containers |
| `npm run prisma:validate` | Validate the authorized Auth Prisma schema/configuration |
| `npm run prisma:generate` | Generate the ignored generated client without touching a database |
| `npm run db:check:empty` | Prove zero non-system relations before the first migration |
| `npm run db:migrate` | Apply committed versioned migrations; never db push |
| `npm run db:check` | Read-only connectivity, exact Auth schema and migration-history verification |
| `npm run db:down` | Remove this local container/network; keep data |
| `node scripts/db-local.mjs reset --confirm-local-reset` | **Destructive, local-only:** stop this project and delete only its correctly labeled PostgreSQL volume |

The direct Node command above is the canonical destructive reset command. Windows/npm 11.9.0 was observed consuming the confirmation flag in `npm run db:reset -- --confirm-local-reset`; do not rely on npm forwarding for this action. Bare `npm run db:reset` remains fail-closed and prints the supported command. Confirmation is never supplied automatically by a package script, environment variable or npm config.

Reset does not restart PostgreSQL, prune volumes, or run migrations. It refuses volumes with missing/mismatched Compose project, volume, environment, or component labels. Use it only when that project's local data is disposable. `db:up` then creates a new empty database. Never use `docker volume prune` or broad `down --volumes` as a cleanup shortcut.

The named volume is `<project>_postgres-data`. Normal shutdown retains it across container recreation. Official-image initialization settings apply only to an empty data directory: editing `.env` does not change credentials or database names in an existing volume. Preserve valuable data through a separately authorized plan; do not reset it.

## Clean-state verification

Use a new project and free port so QA never deletes another developer's data. On a POSIX shell, after copying `.env.example` to `.env`:

```sh
docker info
# Choose a unique suffix and keep the same shell throughout this run.
export RAHROW_LOCAL_PROJECT="rahrow-local-qa-$(date +%s)"
export POSTGRES_PORT=55432
export DATABASE_URL='postgresql://rahrow_local:rahrow_local_dev_only@127.0.0.1:55432/rahrow_local?schema=public'

# Must print no matching volume. If it prints one, choose a new suffix.
docker volume ls --format '{{.Name}}' | grep "^${RAHROW_LOCAL_PROJECT}_postgres-data$" || true
npm ci
npm run db:config
npm run db:up
npm run db:status
npm run prisma:validate
npm run prisma:generate
npm run db:check:empty
npm run db:migrate
npm run db:check
npm run db:migrate # safe replay
npm run db:check
npm run check
npm audit --omit=dev
npm audit
npm run db:down

# Only after confirming this run's data is disposable:
node scripts/db-local.mjs reset --confirm-local-reset
# Verify no container or volume for this exact project remains.
docker ps -a --filter "label=com.docker.compose.project=${RAHROW_LOCAL_PROJECT}"
docker volume ls --filter "label=com.docker.compose.project=${RAHROW_LOCAL_PROJECT}"
```

A no-match grep status is expected; a Docker failure is not proof of clean state. Stop on any failed prerequisite, startup, or connectivity check and record the failure. Audit findings are separate from database runtime results; still clean up only this run's disposable resources. On PowerShell, set variables with `$env:NAME = 'value'` and choose a unique suffix manually. The Node lifecycle commands are cross-platform.

Record image/server versions, healthy state, empty preflight, successful migration, exact Auth table/bookkeeping allowlist, safe replay, same-volume/cluster down/up recheck and scoped cleanup. Check .env and apps/api/src/generated/prisma remain ignored. See [Auth verification](../docs/auth-foundation.md#migration-and-verification). Offline guards do not prove live database behavior.

Only fresh resources created for this QA run may be destroyed automatically. Existing developer data is not disposable by assumption. Runtime verification remains incomplete until Docker-based startup, connection, and cleanup actually succeed; native PostgreSQL or mocks are not substitutes.

## Historical FOUNDATION-02 Windows remediation acceptance

The following preserves the already-accepted Foundation procedure for its historical remediation commit. It is not the current AUTH-01 zero-schema expectation; use the migration sequence above for AUTH-01. Capture output without rendering credentials.

1. Record `git rev-parse HEAD`, `git status --short`, `node --version`, `npm --version`, `docker version` and `docker compose version`. Use Node 24.19.0/npm 11.9.0 and a running local Docker Engine 28+.
2. Set `$env:RAHROW_LOCAL_PROJECT = "rahrow-local-qa-$(Get-Date -Format yyyyMMddHHmmss)"`. Set `$env:POSTGRES_PORT = '55432'` (or a free port) and matching local-only `DATABASE_URL`, following `.env.example`. Keep the same shell and project throughout.
3. Verify the exact `<project>_postgres-data` volume is absent using `docker volume ls --format '{{.Name}}'`; also check container/network lists filtered by `label=com.docker.compose.project=$env:RAHROW_LOCAL_PROJECT`. All Docker listing commands must succeed and show no matching QA resources. If any exist, choose a new suffix; never delete pre-existing data to satisfy this preflight.
4. Run `npm ci` and `npm run db:config`; both must exit 0. Do not print raw Compose configuration with secrets.
5. Run `npm run db:up` and `npm run db:status`. Inspect the selected QA container to record HEALTHY, `postgres:18.6-bookworm`, loopback-only `127.0.0.1:<selected-port> -> 5432`, and the exact named volume. Record its Compose project/volume and Rahrow local/component labels. Through that exact container, record `SHOW server_version` and the read-only `SELECT system_identifier FROM pg_control_system()` result.
6. Run `npm run prisma:validate`, `npm run prisma:generate` and `npm run db:check`. Require the real Prisma `SELECT 1`, read-only session and zero non-system relations result; do not create models, migrations or test tables.
7. Run `npm run check`. Require lint, all typechecks/builds, 2/2 application smoke tests, 8/8 lifecycle tests and 2/2 Prisma baseline tests. Run both audit commands separately; retain the full audit's known failure evidence rather than fixing/suppressing it during this task.
8. Run bare `npm run db:reset`; expect refusal/nonzero exit and the direct Node command in its message. Verify the QA container and owned volume still exist. This expected refusal is not a successful reset.
9. Run `npm run db:down`; verify the QA container/network are gone and the same owned volume remains. Restart with `npm run db:up` and rerun `npm run db:check` to confirm the retained volume remains usable without creating product data. Recheck `pg_control_system().system_identifier` and require the same value to prove the same database cluster survived.
10. Confirm only this run's QA data is disposable, then run `node scripts/db-local.mjs reset --confirm-local-reset`. Require exit 0. Verify the exact QA volume and project-filtered containers, volumes and networks are absent; do not use broad prune/volume deletion.
11. Preserve the commit-specific output and report deviations. Fresh runtime acceptance is pending until these checks pass; advancing `main` needs separate approval.

## Technical choices and troubleshooting

- PostgreSQL **18.6** is the supported stable patch selected by `postgres:18.6-bookworm`. This reversible local choice needs no architectural ADR. Tags can be rebuilt; no immutable digest is claimed.
- PostgreSQL 18 mounts `/var/lib/postgresql`, with version-specific `PGDATA` underneath. Do not copy the pre-18 `/var/lib/postgresql/data` mount.
- `127.0.0.1:<port>:5432` is host-local on supported engines. Health uses `pg_isready`; Prisma separately proves authenticated connectivity. The image-created role is a local database superuser, not production least-privilege role design.
- For a port conflict, update both port and URL. For an image-pull failure, check normal Docker Hub access; do not change host security or use an untrusted mirror.
- Missing CLI, unavailable daemon/image, incompatible engine, and unhealthy database are real blockers. Use normal local Docker setup; never infer runtime success from configuration.
- Raw Compose `config` without `--quiet` renders environment values. Do not paste it in shared logs. The wrapper validates quietly and suppresses captured context/engine error details.
- AUTH-01 imports the generated Prisma client through lazy infrastructure; skeleton startup does not connect. Database use requires external runtime configuration. No application-startup migrations are performed.

Sources checked 2026-10-03: [PostgreSQL support](https://www.postgresql.org/support/versioning/), [official PostgreSQL image](https://hub.docker.com/_/postgres), [Docker PostgreSQL guide](https://docs.docker.com/guides/postgresql/), [port-publishing security](https://docs.docker.com/engine/network/port-publishing/), [Compose health checks](https://docs.docker.com/compose/how-tos/startup-order/), and [Prisma documentation](https://www.prisma.io/docs/orm).
