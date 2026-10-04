# Rahrow

Foundation and the AUTH-01 persistence foundation are preserved. AUTH-02 adds backend mobile OTP orchestration and five cookie-based authentication endpoints with explicit Fake/local delivery only. Frontend flows remain excluded. See [project state](docs/project-state.md) for verification status; configuration and tooling checks alone do not prove database runtime readiness.

Read [AGENTS.md](AGENTS.md) and [project state](docs/project-state.md) before contributing. The private PRD is not distributed in this repository; obtain the relevant requirements before dependent work. [Product questions](docs/open-questions.md) retain their minimum blocked scope; OQ-07 is decided and other profile/capability/status questions remain open.

## Workspace layout

- `apps/web`: Next.js 16 + TypeScript; one neutral placeholder page
- `apps/api`: NestJS + TypeScript; Auth/User/RBAC/Audit modules, lazy Prisma infrastructure and guarded database tooling
- `packages/contracts`: independently compiled, type-only public-profile and authentication contract package
- `packages/ui`: independently compiled, intentionally empty shared-UI package
- `packages/config`: shared TypeScript presets and root-consumed ESLint configuration
- `infra`: local-only PostgreSQL Compose configuration and lifecycle documentation
- `docs`: existing governance and verified project state
- `scripts`: built-application smoke checks and guarded local database lifecycle commands

All packages are private npm workspaces. One root lockfile pins the dependency graph. There is no task orchestrator or sibling-app build dependency. The API consumes type-only public-profile and authentication contracts; both shared packages still have no runtime exports.

## Prerequisites and installation

The tested toolchain is Node.js **24.19.0** and npm **11.9.0**. `.nvmrc` pins Node and `packageManager` records npm; engines permit later compatible patches within Node 24/npm 11. Package-manager selection is explicit; Node distributions may bundle a different npm version.

From the repository root:

```sh
npm ci
```

Use `npm install` only for intentional dependency updates and review the resulting `package-lock.json`. Direct versions are exact. If your environment's home directory is unwritable, set `npm_config_cache` to a writable directory outside the repository.

Selected application versions: Next.js 16.3.8, React/React DOM 19.3.0, NestJS 12.1.2, Nest CLI 12.0.8, TypeScript 6.0.3, and ESLint 9.39.5. TypeScript 6 and ESLint 9 satisfy the current framework/lint peer ranges; using unrelated latest majors is not equivalent.

## Development

Use two terminals from the root:

```sh
npm run dev:web
npm run dev:api
```

Web listens at `http://127.0.0.1:3000`; API defaults to `http://127.0.0.1:3001`. API `HOST` and `PORT` can be provided through the shell. `GET /` on the API intentionally returns the NestJS default 404; it is not a missing product endpoint or a readiness API.

Both development servers watch their own source. Next.js agent-rule generation is disabled so development startup preserves the explicitly approved `AGENTS.md`. The application skeleton's startup, build, and existing smoke checks still require no database, search service, object storage, provider account, Docker daemon, or running sibling app. Database tooling is an explicit, separate command path.

## Local PostgreSQL and Prisma

For the database path, install Docker Engine **28 or newer** with a current Docker Compose plugin (Compose **2.20 or newer**, including v5). Use a local Docker Desktop or Unix-socket context. TCP/SSH Docker endpoints are rejected by the lifecycle wrapper. Engine 28+ avoids the historical localhost-published-port exposure to other hosts on the same L2 segment.

From the root, after `npm ci`:

```sh
cp .env.example .env
npm run db:config
npm run db:up
npm run db:status
npm run prisma:validate
npm run prisma:generate
npm run db:check:empty # first migration only
npm run db:migrate
npm run db:check
npm run db:down
```

The example credentials are public, development-only values. Never reuse them for another environment. Actual `.env` files are ignored. If port 5432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL`. Keep URL credentials and database consistent with the `POSTGRES_*` fields; URL-encode special characters in credentials. Shell variables take precedence over `.env`.

- `db:config` validates Compose quietly; it does not check a running database.
- `db:up` starts only PostgreSQL and waits up to 90 seconds for health. `db:status` shows container state.
- `prisma:validate` and `prisma:generate` validate/generate the authorized ten-model schema offline. Generated code is ignored.
- `db:check:empty` proves the retained empty Foundation or fresh database before its first migration. `db:migrate` deploys committed versioned migrations. `db:check` checks connectivity, the exact AUTH-01 table allowlist and applied migration checksum read-only. They accept only the configured loopback development database.
- `db:down` removes the local container/network but **retains the named PostgreSQL volume**.
- **Destructive, local-only reset:** run `node scripts/db-local.mjs reset --confirm-local-reset` only when the selected project’s data is disposable. This direct Node command is canonical; Windows/npm 11.9.0 was observed consuming the flag through npm forwarding. Bare `npm run db:reset` intentionally refuses. The explicit confirmation and volume ownership/label checks remain required.

The official `postgres:18.6-bookworm` image is patch/distribution pinned. PostgreSQL 18 stores data beneath `/var/lib/postgresql/18/docker`, so the named volume mounts `/var/lib/postgresql`. PostgreSQL is published only at `127.0.0.1`, with SCRAM host authentication. These are local development boundaries, not production topology or credential-management decisions. Docker tags can receive rebuilt layers; this is not an immutable digest pin.

The authorized ten-table schema and first migration are documented in [Auth foundation](docs/auth-foundation.md). Prisma configuration uses v7 prisma.config.ts. Tooling loads the root environment explicitly; runtime database configuration is supplied externally and the Nest client is lazy. No migrations run on startup and no seed is installed.

See [local infrastructure instructions](infra/README.md) for clean-state QA, local-only data removal, troubleshooting, and version references.

## Local mobile OTP authentication

See [AUTH-02](docs/auth-02.md) for the five endpoint contracts, strict Origin/custom-header rules, local activation, private Fake harness, fixed session expiry, independent challenges/session families and error/rate-limit behavior. Default Auth is unconfigured and returns 503 without needing a database/key; root 404 and the web skeleton remain unchanged. Explicit local activation requires nonproduction loopback binding and origins; no real SMS provider or reveal endpoint exists. [ADR-0002](docs/decisions/ADR-0002-mobile-otp-http-sessions.md) explains transport and transaction boundaries.

`npm run openapi:generate` regenerates the API specification from the real controllers/DTOs; `npm run openapi:check` verifies freshness. No public Swagger endpoint is exposed. Shared contracts still export no runtime values.

## Builds and checks

After the root install, either application builds independently:

```sh
npm run build:web
npm run build:api
```

All repository checks:

```sh
npm run lint
npm run typecheck
npm run build
npm test
# Equivalent aggregate gate:
npm run check
```

- `lint`: direct ESLint CLI with zero warnings allowed; Next.js rules apply to the web app. Next 16 does not provide `next lint`.
- `typecheck`: both shared packages and both applications. Web first runs `next typegen` so generated route declarations exist on a clean checkout.
- `build`: compiles both shared packages, then builds both independent applications.
- `test`: requires build outputs. Node's built-in test runner verifies database-tooling safety guards and empty workspace exports, starts the actual built API and web separately on ephemeral loopback ports, checks their expected HTTP responses, and stops the child processes. Offline tests do not substitute for `db:up`/`db:check` against Docker PostgreSQL.
- `check`: lint, type checks, all builds, and smoke tests in that order.

Smoke tests preserve no-config startup and root 404. AUTH-01/AUTH-02 add negative-heavy security/privacy/RBAC, HTTP and provider tests; the [CI workflow](docs/ci.md) separately exercises actual migration, constraints and concurrent state transitions in disposable PostgreSQL. Offline checks do not establish real database flow acceptance or release readiness.

Optional dependency inspection:

```sh
npm ls --all
npm audit --omit=dev
npm audit
```

See [project state](docs/project-state.md#latest-test-status) for the latest runtime/full audit results and [known risks](docs/project-state.md#known-risks) for affected dependency paths, fix availability, and follow-up. A clean runtime audit does not mean the full dependency tree is clean.

Next may update generated `next-env.d.ts` during type generation/build. Build directories, dependencies, TypeScript build-info files, and local environment files are ignored. This placeholder uses system fonts and local CSS with no remote asset fetches during builds.

## Deferred scope

Real SMS delivery, admin Password+TOTP login/enrollment/recovery, frontend auth, status lifecycle, profile-completion UX, logout-all-devices and the final permission matrix are deferred. Meilisearch, S3-compatible storage, other product modules and staging/production actions need separate authorization. AUTH-01 does not resolve product questions or grant production approval.

Tooling references: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js ESLint](https://nextjs.org/docs/app/api-reference/config/eslint), [NestJS migration requirements](https://docs.nestjs.com/migration-guide), [TypeScript 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).
