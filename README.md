# Rahrow

FOUNDATION-01 is the published repository and application skeleton for the approved API-first modular-monolith architecture. FOUNDATION-02 adds a local-only PostgreSQL and zero-model Prisma tooling baseline. The neutral Next.js page and empty NestJS application still implement no product behavior. See [project state](docs/project-state.md) for verification status; configuration and tooling checks alone do not prove database runtime readiness.

Read [AGENTS.md](AGENTS.md) and [project state](docs/project-state.md) before contributing. The private PRD is not distributed in this repository; obtain the relevant requirements before dependent work. [Product questions](docs/open-questions.md) remain unresolved.

## Workspace layout

- `apps/web`: Next.js 16 + TypeScript; one neutral placeholder page
- `apps/api`: NestJS + TypeScript; empty application module plus separate, zero-model Prisma tooling
- `packages/contracts`: independently compiled, intentionally empty shared-contract package
- `packages/ui`: independently compiled, intentionally empty shared-UI package
- `packages/config`: shared TypeScript presets and root-consumed ESLint configuration
- `infra`: local-only PostgreSQL Compose configuration and lifecycle documentation
- `docs`: existing governance and verified project state
- `scripts`: built-application smoke checks and guarded local database lifecycle commands

All packages are private npm workspaces. One root lockfile pins the dependency graph. There is no task orchestrator or sibling-app build dependency. The applications do not yet consume contracts or UI exports because those packages intentionally export nothing.

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
npm run db:check
npm run db:down
```

The example credentials are public, development-only values. Never reuse them for another environment. Actual `.env` files are ignored. If port 5432 is occupied, change both `POSTGRES_PORT` and the port in `DATABASE_URL`. Keep URL credentials and database consistent with the `POSTGRES_*` fields; URL-encode special characters in credentials. Shell variables take precedence over `.env`.

- `db:config` validates Compose quietly; it does not check a running database.
- `db:up` starts only PostgreSQL and waits up to 90 seconds for health. `db:status` shows container state.
- `prisma:validate` and `prisma:generate` validate/generate the empty schema offline. Prisma **7.10.0** supports zero-model generation by default; do not add a fake entity or pass the removed `--allow-no-models` flag.
- `db:check` generates the client and uses Prisma's PostgreSQL adapter for a real, read-only `SELECT 1` and catalog check that no non-system relations exist. It accepts only the configured loopback database and creates no tables or migrations.
- `db:down` removes the local container/network but **retains the named PostgreSQL volume**.

The official `postgres:18.6-bookworm` image is patch/distribution pinned. PostgreSQL 18 stores data beneath `/var/lib/postgresql/18/docker`, so the named volume mounts `/var/lib/postgresql`. PostgreSQL is published only at `127.0.0.1`, with SCRAM host authentication. These are local development boundaries, not production topology or credential-management decisions. Docker tags can receive rebuilt layers; this is not an immutable digest pin.

No model, product table, migration, seed, domain service, or application database connection is introduced. Prisma configuration uses v7 `prisma.config.ts` for the datasource URL and the `prisma-client` generator with explicit ignored output. Tooling loads the root environment explicitly. The generated client is neither committed nor connected to the NestJS app.

See [local infrastructure instructions](infra/README.md) for clean-state QA, local-only data removal, troubleshooting, and version references.

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
- `typecheck`: both empty shared packages and both applications. Web first runs `next typegen` so generated route declarations exist on a clean checkout.
- `build`: compiles both shared packages, then builds both independent applications.
- `test`: requires build outputs. Node's built-in test runner verifies database-tooling safety guards and empty workspace exports, starts the actual built API and web separately on ephemeral loopback ports, checks their expected HTTP responses, and stops the child processes. Offline tests do not substitute for `db:up`/`db:check` against Docker PostgreSQL.
- `check`: lint, type checks, all builds, and smoke tests in that order.

The smoke tests establish skeleton startup only. There are no product unit/integration, authorization, payment, concurrency, migration, accessibility-matrix, or release-readiness results yet. No CI workflow is configured in this task.

Optional dependency inspection:

```sh
npm ls --all
npm audit --omit=dev
npm audit
```

See [project state](docs/project-state.md#latest-test-status) for the latest runtime/full audit results and [known risks](docs/project-state.md#known-risks) for affected dependency paths, fix availability, and follow-up. A clean runtime audit does not mean the full dependency tree is clean.

Next may update generated `next-env.d.ts` during type generation/build. Build directories, dependencies, TypeScript build-info files, and local environment files are ignored. This placeholder uses system fonts and local CSS with no remote asset fetches during builds.

## Deferred scope

Meilisearch, S3-compatible storage, provider integration, staging/production infrastructure, CI, product models/migrations/seeds, and all product modules need separately bounded authorization. The local PostgreSQL/Prisma baseline does not resolve product questions, define product schemas, grant production approval, or claim completion of the Foundation milestone.

Tooling references: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js ESLint](https://nextjs.org/docs/app/api-reference/config/eslint), [NestJS migration requirements](https://docs.nestjs.com/migration-guide), [TypeScript 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).
