# Foundation CI

FOUNDATION-03 adds only GitHub Actions repository and local-database verification. It does not deploy, change branch protection, resolve product questions, or authorize a later Foundation task.

## Triggers and checks

`.github/workflows/ci.yml` runs on `pull_request` targeting `main` (including draft PRs) and on `push` to `main`; `workflow_dispatch` also supports an explicitly requested manual run. There are no path filters. Expected check names are **repository-quality** and **local-database**.

Both jobs run on `ubuntu-24.04`, with a 20-minute timeout, Node **24.19.0** and npm **11.9.0**, and a clean `npm ci`. Actions are immutable commit pins: checkout `3d3c42e5aac5ba805825da76410c181273ba90b1` and setup-node `820762786026740c76f36085b0efc47a31fe5020`. Changes to these pins require review.

- **repository-quality:** verifies the installed dependency tree with `npm ls --all`, validates and generates Prisma, then runs the existing aggregate `npm run check` (lint, typechecks, builds, smoke and database-baseline tests), requires `npm audit --omit=dev` to succeed with exactly zero vulnerabilities, and checks tracked checkout hygiene.
- **local-database:** validates Compose and Prisma, generates the zero-model client, verifies a fresh QA namespace, starts the existing PostgreSQL Compose service, checks health/loopback exposure/volume ownership, runs the real read-only Prisma `SELECT 1` and empty-catalog check, verifies unconfirmed reset refusal, and proves down/up persistence using the exact volume creation time and PostgreSQL cluster system identifier. It always attempts the canonical scoped reset after an eligible startup, then verifies no matching resources remain.

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

Docker/PostgreSQL/Prisma source tooling, package files and lockfile remain unchanged. No product model, migration, seed, provider, Meilisearch service or deployment is included.

## Acceptance and completion sequence

1. Implement and independently review only the approved CI/docs scope on `foundation-03-ci-basics`; perform available offline checks.
2. Publish the branch and open a **draft** PR to `main`. Capture real `pull_request` workflow run URL/ID, tested SHA and both job results. Local YAML lint and shell checks do not prove GitHub service execution.
3. Even after both PR checks pass, FOUNDATION-03 remains **PARTIAL**. Report merge readiness and stop for Ali’s separate merge approval.
4. Only after an approved merge, verify the automatic `push`-to-`main` run and both jobs on the actual merged main SHA.
5. After that run passes, make a separate minimal project-state completion documentation commit preserving the actual PR and main run URLs/IDs/tested SHAs. Do not change workflow logic in that commit.
6. Verify both jobs also pass on the final documentation commit’s automatic main run. Final main must itself be green before FOUNDATION-03 is closed. Do not amend the documentation repeatedly merely to add its own resulting SHA; the final run is independently verifiable through GitHub and the completion report.
7. No merge or FOUNDATION-04 is authorized by successful checks.

For local parity, run `npm ci`, `npm run check`, `npm audit --omit=dev`, `npm run prisma:validate`, `npm run prisma:generate`, and `git diff --check`. In an authorized Docker environment, follow [the local database guide](../infra/README.md). The CI workflow itself is the exact automation contract.
