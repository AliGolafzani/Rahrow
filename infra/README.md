# Local PostgreSQL boundary

FOUNDATION-02 adds only local Docker Compose PostgreSQL and backend database tooling. It does not define application, staging, or production topology. Search, storage, providers, CI, deployment, backup/restore design, and production operations remain outside this task.

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
| `npm run prisma:validate` | Validate the zero-model Prisma schema/configuration |
| `npm run prisma:generate` | Generate the ignored zero-model client without touching a database |
| `npm run db:check` | Run a real read-only local connectivity/catalog check through Prisma |
| `npm run db:down` | Remove this local container/network; keep data |
| `npm run db:reset -- --confirm-local-reset` | **Destructive, local-only:** stop this project and delete only its correctly labeled PostgreSQL volume |

`db:reset` does not restart PostgreSQL, prune volumes, or run migrations. It refuses volumes with missing/mismatched Compose project, volume, environment, or component labels. Use it only when that project's local data is disposable. `db:up` then creates a new empty database. Never use `docker volume prune` or broad `down --volumes` as a cleanup shortcut.

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
npm run db:check
npm run check
npm audit --omit=dev
npm audit
npm run db:down

# Only after confirming this run's data is disposable:
npm run db:reset -- --confirm-local-reset
# Verify no container or volume for this exact project remains.
docker ps -a --filter "label=com.docker.compose.project=${RAHROW_LOCAL_PROJECT}"
docker volume ls --filter "label=com.docker.compose.project=${RAHROW_LOCAL_PROJECT}"
```

A no-match grep status is expected; a Docker failure is not proof of clean state. Stop on any failed prerequisite, startup, or connectivity check and record the failure. Audit findings are separate from database runtime results; still clean up only this run's disposable resources. On PowerShell, set variables with `$env:NAME = 'value'` and choose a unique suffix manually. The Node lifecycle commands are cross-platform.

Record image/server versions, healthy state, real connection, zero user relations, shutdown, volume removal, and unchanged governance. Check `.env` and `apps/api/generated/prisma` remain ignored. `_prisma_migrations` is also disallowed for this empty baseline: no migration is needed. Offline guard tests and Compose parsing are not runtime verification.

Only fresh resources created for this QA run may be destroyed automatically. Existing developer data is not disposable by assumption. Runtime verification remains incomplete until Docker-based startup, connection, and cleanup actually succeed; native PostgreSQL or mocks are not substitutes.

## Technical choices and troubleshooting

- PostgreSQL **18.6** is the supported stable patch selected by `postgres:18.6-bookworm`. This reversible local choice needs no architectural ADR. Tags can be rebuilt; no immutable digest is claimed.
- PostgreSQL 18 mounts `/var/lib/postgresql`, with version-specific `PGDATA` underneath. Do not copy the pre-18 `/var/lib/postgresql/data` mount.
- `127.0.0.1:<port>:5432` is host-local on supported engines. Health uses `pg_isready`; Prisma separately proves authenticated connectivity. The image-created role is a local database superuser, not production least-privilege role design.
- For a port conflict, update both port and URL. For an image-pull failure, check normal Docker Hub access; do not change host security or use an untrusted mirror.
- Missing CLI, unavailable daemon/image, incompatible engine, and unhealthy database are real blockers. Use normal local Docker setup; never infer runtime success from configuration.
- Raw Compose `config` without `--quiet` renders environment values. Do not paste it in shared logs. The wrapper validates quietly and suppresses captured context/engine error details.
- The NestJS app does not import Prisma or contact PostgreSQL. Future database integration requires separately bounded scope.

Sources checked 2026-10-03: [PostgreSQL support](https://www.postgresql.org/support/versioning/), [official PostgreSQL image](https://hub.docker.com/_/postgres), [Docker PostgreSQL guide](https://docs.docker.com/guides/postgresql/), [port-publishing security](https://docs.docker.com/engine/network/port-publishing/), [Compose health checks](https://docs.docker.com/compose/how-tos/startup-order/), and [Prisma documentation](https://www.prisma.io/docs/orm).
