# Rahrow

FOUNDATION-01 is the minimal repository and application skeleton for the approved API-first modular-monolith architecture. It contains a neutral Next.js page and an empty NestJS application. It does not implement product behavior.

Read [AGENTS.md](AGENTS.md) and [project state](docs/project-state.md) before contributing. The private PRD is not distributed in this repository; obtain the relevant requirements before dependent work. [Product questions](docs/open-questions.md) remain unresolved.

## Workspace layout

- `apps/web`: Next.js 16 + TypeScript; one neutral placeholder page
- `apps/api`: NestJS + TypeScript; bootstraps an empty module, with no application routes
- `packages/contracts`: independently compiled, intentionally empty shared-contract package
- `packages/ui`: independently compiled, intentionally empty shared-UI package
- `packages/config`: shared TypeScript presets and root-consumed ESLint configuration
- `infra`: approved instructions and a boundary note; no infrastructure configuration
- `docs`: existing governance and verified project state
- `scripts`: built-application smoke checks

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

Both development servers watch their own source. Next.js agent-rule generation is disabled so development startup preserves the explicitly approved `AGENTS.md`. No database, search service, object storage, provider account, credentials, Docker daemon, or running sibling app is required.

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
- `test`: requires build outputs. Node's built-in test runner verifies empty workspace exports, starts the actual built API and web separately on ephemeral loopback ports, checks their expected HTTP responses, and stops the child processes.
- `check`: lint, type checks, all builds, and smoke tests in that order.

The smoke tests establish skeleton startup only. There are no product unit/integration, authorization, payment, concurrency, migration, accessibility-matrix, or release-readiness results yet. No CI workflow is configured in this task.

Optional dependency inspection:

```sh
npm ls --all
npm audit --omit=dev
npm audit
```

The runtime-only audit currently reports zero findings; the full audit reports a known development-only advisory, and the compatible ESLint version has an upstream support warning. See [known risks](docs/project-state.md#known-risks) for the affected dependency path, fix availability, and follow-up. A clean runtime audit does not mean the full dependency tree is clean.

Next may update generated `next-env.d.ts` during type generation/build. Build directories, dependencies, TypeScript build-info files, and local environment files are ignored. This placeholder uses system fonts and local CSS with no remote asset fetches during builds.

## Deferred scope

PostgreSQL, Prisma, Meilisearch, S3-compatible storage, Docker, provider integration, production infrastructure, and all product modules need separately bounded authorization. This skeleton does not resolve product questions, define product schemas, grant production approval, or claim completion of the Foundation milestone.

Tooling references: [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces/), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Next.js ESLint](https://nextjs.org/docs/app/api-reference/config/eslint), [NestJS migration requirements](https://docs.nestjs.com/migration-guide), [TypeScript 6](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html).
