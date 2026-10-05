# Repository and Auth database CI

FOUNDATION-03 established GitHub Actions repository/local-database verification. AUTH-01 makes the explicitly approved first-product-schema transition below, preserving Foundation history and its Docker isolation/cleanup. Neither task deploys or changes branch protection.

## Triggers and checks

`.github/workflows/ci.yml` runs on `pull_request` targeting `main` (including draft PRs) and on `push` to `main`; `workflow_dispatch` also supports an explicitly requested manual run. There are no path filters. Expected check names are **repository-quality** and **local-database**.

Both jobs run on `ubuntu-24.04`, with a 20-minute timeout, Node **24.19.0** and npm **11.9.0**, and a clean `npm ci`. Actions are immutable commit pins: checkout `3d3c42e5aac5ba805825da76410c181273ba90b1` and setup-node `820762786026740c76f36085b0efc47a31fe5020`. Changes to these pins require review.

- **repository-quality:** verifies the installed dependency tree with `npm ls --all`, validates and generates Prisma, then runs the existing aggregate `npm run check` (lint, typechecks, builds, smoke and database-baseline tests), requires `npm audit --omit=dev` to succeed with exactly zero vulnerabilities, and checks tracked checkout hygiene.
- **local-database:** validates Compose/Prisma, generates the AUTH-01 client, verifies a fresh QA namespace, starts existing PostgreSQL, checks health/loopback/volume ownership and the cluster identifier, then proves zero non-system relations with the read-only empty preflight. It deploys the committed migration with `prisma migrate deploy`, verifies the exact ten-table schema plus `_prisma_migrations`, snapshots columns/constraints/indexes/history, replays deploy and compares the snapshot unchanged. Actual compiled repositories are exercised through 15 disposable PostgreSQL invariant/concurrency checks. It retains reset refusal, exact-volume/cluster normal down/up persistence and post-restart schema/snapshot checks. It always attempts eligible scoped cleanup and fails if any matching resources remain. A second isolated cluster in the same proven-owned disposable namespace independently proves retained-empty down/up before migration, then deploy/replay/migrated-restart verification. The two check names remain unchanged. No `db push` is used.

Full development audit is not a CI gate and is not run as a separate CI step. It remains explicit debt in [project-state.md](project-state.md), including the braces, deepmerge-ts and mysql2 advisories and the differing historical cloud/Windows transitive counts. To inspect it locally, run `npm audit`; a nonzero result must be reported, not suppressed or automatically fixed. Runtime audit success is not a claim of complete dependency security.

## Isolation and cleanup

Each database run derives a bounded, lowercase hexadecimal `rahrow-local-qa-...` project from repository, Actions run ID, run attempt and job identity. Before startup it requires no project containers/networks and no exact expected volume. Only after that proof is cleanup marked eligible, and the marker is set before startup so a partially failed startup also reaches cleanup.

The job uses a verified local Unix Docker endpoint and requires Engine 28 or newer. It does not install or reconfigure a daemon. The example `.env` is copied locally and remains ignored; its contents and database URL are not printed. Only disposable example credentials are used; no repository secrets are needed.

Cleanup invokes `node scripts/db-local.mjs reset --confirm-local-reset`. Existing confirmation parsing, local-endpoint restrictions and exact name/ownership-label guards are unchanged. It never prunes global resources. Even if reset fails, leftover inspections are attempted and the job fails. No cleanup result is swallowed. The local-only data is disposable; never use production values.

Separate job-level concurrency groups are used:
- Quality: newer runs may cancel superseded quality work for the same PR. Main push runs have run-specific groups, so they do not cancel one another.
- Database: a distinct per-PR/per-main group has `cancel-in-progress: false`. Active database work can reach its `always()` cleanup; GitHub may replace a queued pending run with newer pending work. There is no workflow-level cancellation.

GitHub runner loss, hard job timeout, or manual force cancellation can still prevent cleanup from finishing. `always()` does not guarantee execution after infrastructure loss. The namespace and resources are disposable and confined to the hosted job runner; a failed or missing cleanup is not a pass.

## Security boundaries

The workflow has only `contents: read` token permission; checkout does not persist credentials. Setup-node package-manager caching is explicitly disabled. There are no repository secrets, deployment credentials, artifact uploads, writable repository token grants, `pull_request_target`, or branch-protection changes. PR source executes in a disposable hosted runner with the stated read-only token boundary. No untrusted PR title, body or branch name is interpolated into shell commands.

Docker/PostgreSQL lifecycle source, reset confirmation parsing, ownership guards, image and action pins remain unchanged. AUTH-01 adds only the authorized ten-model migration, internal services and checks. Prisma client/adapter/driver are runtime dependencies; the same CLI version is isolated with a development npm alias, documented in [ADR-0001](decisions/ADR-0001-auth-security-persistence.md). No seed, provider, Meilisearch or deployment is included.

## Preserved historical FOUNDATION-03 acceptance and completion sequence

1. Implement and independently review only the approved CI/docs scope on `foundation-03-ci-basics`; perform available offline checks.
2. Publish the branch and open a **draft** PR to `main`. Capture real `pull_request` workflow run URL/ID, tested SHA and both job results. Local YAML lint and shell checks do not prove GitHub service execution.
3. Even after both PR checks pass, FOUNDATION-03 remains **PARTIAL**. Report merge readiness and stop for Ali’s separate merge approval.
4. Only after an approved merge, verify the automatic `push`-to-`main` run and both jobs on the actual merged main SHA.
5. After that run passes, make a separate minimal project-state completion documentation commit preserving the actual PR and main run URLs/IDs/tested SHAs. Do not change workflow logic in that commit.
6. Verify both jobs also pass on the final documentation commit’s automatic main run. Final main must itself be green before FOUNDATION-03 is closed. Do not amend the documentation repeatedly merely to add its own resulting SHA; the final run is independently verifiable through GitHub and the completion report.
7. No merge or FOUNDATION-04 is authorized by successful checks.

For local parity, run `npm ci`, `npm run check`, `npm audit --omit=dev`, `npm run prisma:validate`, `npm run prisma:generate`, and `git diff --check`. In an authorized Docker environment, follow [the local database guide](../infra/README.md). The CI workflow itself is the exact automation contract.

## AUTH-01 acceptance

Foundation was accepted complete on main 58176c267d1fca2f5220df65dc37e25b53c560d4, run [37147650133](https://github.com/AliGolafzani/Rahrow/actions/runs/37147650133). Historical Foundation evidence above remains unchanged.

AUTH-01 requires local aggregate checks, independent review, and then actual PR-triggered repository-quality and local-database jobs on the published exact SHA. Docker-less authoring checks do not prove migration or concurrency. The PR remains draft; success is not merge authorization. The write-test runner additionally requires CI=true, GITHUB_ACTIONS=true, an exact isolated QA namespace and RAHROW_AUTH_DATABASE_TESTS=disposable-local-ci. Its fixtures remain confined to the newly owned database until canonical cleanup.

## AUTH-02 acceptance

AUTH-02 keeps both existing jobs and every Foundation/AUTH-01 gate. The aggregate also requires generated OpenAPI freshness and the offline HTTP/config/provider/orchestration regressions. The guarded disposable PostgreSQL runner additionally covers actual HTTP controllers wired to the real service/repositories/Fake, independent challenges and multi-device families, atomic User/session/audit mutations, committed wrong attempts, expiry across waits, target cap/cooldown, shared admission, commit/audit/provider rollback and lineage rotation/logout races. A secret-free projection of representative persisted Auth state is compared after same-cluster restart. Exact-schema checks now include AuthenticationMethod enum labels as well as the preserved ten tables, constraints, indexes and byte-identical applied migration.

`npm run test:auth:flow:db` is guarded like the AUTH-01 write runner; it must not be made runnable against an unverified developer or production database. Offline unit/service mocks do not establish this live evidence. Publication is an authorized draft PR only, after local/cloud checks and independent review. Actual exact-head CI must pass before acceptance is claimed; green checks do not authorize merge or deployment.

Swagger generation uses pinned Nest-compatible `@nestjs/swagger`. Its transitive install telemetry is explicitly disabled by root `scarfSettings.enabled=false`; no telemetry consent, runtime service or public documentation route is introduced. The zero-runtime-audit gate remains unchanged.

## AUTH-03 browser acceptance

The existing `repository-quality` and `local-database` job names, permissions, timeout,
Foundation lifecycle checks, 81 automated baseline tests, 15 AUTH-01 live invariants,
and 21 AUTH-02 live orchestration checks are preserved. Browser checks are additive.
The local-database job builds Next separately, installs the Chromium revision supplied
by exactly pinned `@playwright/test`, and runs `npm run test:web:e2e` **after** the
AUTH-02 same-cluster persisted-state comparison and **before** the retained-empty
Foundation reset. This ordering prevents the new fixture rows from changing the
previously established AUTH-02 checkpoint. Canonical eligible scoped cleanup still
runs with `always()` and retains all existing ownership and leftover checks.

The Playwright worker owns an in-process, loopback Nest test application with actual
AUTH-02 controllers, DTO validation, safeguards, `MobileOtpService`, real PostgreSQL
repositories, and `FakeOtpDeliveryProvider`. It applies the existing disposable CI
opt-in/namespace guard, validates the local-only database URL, and verifies the expected
database/user identity before using the database. Default rate budgets, cooldown,
attempt limit, lifetimes, Origin rules, session rules and schema are not weakened.
Tests can advance an injected clock or inject a bounded one-shot service failure
in their own process. A fresh per-test MAC key isolates rate namespaces without
resetting or deleting the existing acceptance evidence.

After a browser request returns its ordinary `challengeId`, the same worker retrieves
the exact delivery with its owned Fake provider's `getDelivery(challengeId)`. There
is no OTP-reveal HTTP route, file, log, browser API, static code, production switch,
or real SMS provider. The separately built Next server is started with server-only
`RAHROW_API_ORIGIN=http://127.0.0.1:3101` and
`RAHROW_WEB_ORIGIN=http://127.0.0.1:3100`. The browser uses the same-origin forwarding
routes and HttpOnly cookies; it never receives a bearer in JSON or storage.

Screenshots, video, traces, HTML reports, request/response dumps, and automatic
assertion diagnostics are disabled because they can contain OTPs, cookies or private
account data. The custom reporter emits only static test names, source line numbers,
status and totals. No browser artifacts are uploaded. Do not override the reporter
or enable Playwright debug/tracing while testing private auth data.

### Docker-less authoring checks

After `npm run build`, a local, explicitly separate contract-only browser check is:

```
RAHROW_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:web:e2e:local
```

Omit `RAHROW_CHROMIUM_EXECUTABLE` when the pinned Playwright Chromium is installed.
This mode keeps the same real Nest HTTP/service/Fake path but substitutes a test-only
in-memory contract store for persistence. The browser config refuses `CI=true` in
contract mode; explicitly labeled Node HTTP/fixture tests may still use that contract
store inside the repository-quality job. Contract checks do not prove
PostgreSQL transactions, locking, concurrency, migration, audit persistence or the
live browser gate. The default command requires the unchanged guarded disposable
GitHub database environment and never silently falls back to contract mode. Missing
Docker/DB is **BLOCKED** for live acceptance, not a reason to install a daemon,
relax the guard, skip the gate, or claim completion. Both commands require a separately
built Next app and compiled API; browser readiness never launches a development server.

The browser suite contains 27 explicit scenarios (including three viewport cases):
guest/unknown navigation, protected entry through OTP, established-session entry,
strict returns, exact mobile/OTP input, invalid/expired/exhausted/consumed outcomes,
newest-only resend and older-context success in another browser context, failed resend,
actual default target throttling, verification throttling, service/network failure,
duplicate submission, interrupted proof before and after commit, session bootstrap and
expiry, logout failure and retry, change-number/reload state reset, actual Back/Forward
history, semantic keyboard controls, responsive bounds and reduced-motion preference.
Test collection or HTTP contract success is not evidence these browser scenarios ran.

Six additional Node tests cover fixture construction/default safeguards, all five actual
Nest endpoints without reveal routes, built Next dispatch/SSR/redirect/no-store/cookie
boundaries against that fixture, and artifact privacy. These are contract/tooling checks
in the normal aggregate, separately reported from the guarded PostgreSQL browser suite.
