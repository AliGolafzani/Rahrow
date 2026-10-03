# Rahrow project state

Snapshot date: 2026-10-03. This document describes verified work and dependencies, not completion of requirements merely listed in the PRD.

## CURRENT MILESTONE

Foundation, bounded task **FOUNDATION-02 — Local PostgreSQL + Prisma Baseline: PARTIAL**.

Ali approved FOUNDATION-01 and authorized this local-only task on 2026-10-03. Ali supplied successful Windows Docker/PostgreSQL evidence for the published baseline. The approved reset-documentation remediation is implemented and offline-verified; fresh-run acceptance remains pending; this cloud executor still has no Docker runtime. The complete Foundation milestone is not complete; FOUNDATION-03 is not authorized.

## PROJECT PHASE

Governance and FOUNDATION-01 are approved. FOUNDATION-01 is published on `main` at [96ca14d9f0ee3d0e0f5db1cd5b1a67d698c70319](https://github.com/AliGolafzani/Rahrow/commit/96ca14d9f0ee3d0e0f5db1cd5b1a67d698c70319), the verified baseline for this task. This supersedes the earlier wording that did not claim FOUNDATION-01 publication.

FOUNDATION-02 was published on `foundation-02-local-postgres-prisma` at [e45923c003def6fcb551aadca51ca9c6143a5caa](https://github.com/AliGolafzani/Rahrow/commit/e45923c003def6fcb551aadca51ca9c6143a5caa). The reset remediation remains on that branch while fresh-run acceptance is pending. Do not treat branch publication as task completion or authorization to advance `main`. The task adds only local Compose/PostgreSQL configuration, empty-model Prisma tooling, guarded lifecycle/connectivity checks, documentation and dependency changes. No product behavior or domain schema is implemented.

## COMPLETED

- Governance and FOUNDATION-01 implementation/verification are complete and approved; the skeleton is published on `main` at the baseline commit above.
- Existing root/scoped agent instructions, the 25 OPEN product questions, and ADR guidance/template remain unchanged.
- INFRA-SECURITY prepared one local `postgres:18.6-bookworm` service with loopback-only publishing, SCRAM host authentication, health check and a labeled named volume. The PostgreSQL 18 mount layout is used.
- Lifecycle commands fix the Compose file and local project namespace. Normal shutdown retains data; destructive reset requires explicit confirmation and exact project/volume/local-scope ownership checks. No global volume pruning is permitted.
- BACKEND prepared exact Prisma CLI/Client/PostgreSQL adapter version 7.10.0, an empty-model schema, Prisma 7 configuration, ignored generated output, and separately typechecked tooling. PostgreSQL driver resolves to `pg` 8.23.1. Plain `prisma generate` supports zero models in this installed version; the obsolete `--allow-no-models` flag is not used.
- A guarded read-only verifier is prepared for real `SELECT 1`, expected local database identity, read-only session state and zero non-system relations. Its source is not evidence that the database checks ran.
- Public development-only example values are documented in `.env.example`; actual `.env` and generated Prisma output remain ignored.
- Official Docker Compose v5.6.0 standalone client checksum and daemon-free configuration validation passed. No Docker daemon, container, database or volume was created by these checks.

No product model, migration, seed/demo data, runtime NestJS database provider, external provider integration, staging/production database, CI, deployment, Meilisearch setup, or product feature has been created.

## IN PROGRESS

- The approved minimal reset remediation documents `node scripts/db-local.mjs reset --confirm-local-reset` as the canonical destructive, local-only command. The refusal message now prints that exact command. Parser, explicit argv confirmation, local Docker endpoint restrictions, volume ownership/label checks, package scripts, dependencies and lockfile are unchanged.
- New subprocess regression tests exercise the real CLI entry point: unconfirmed and incorrect confirmation refuse before Docker; the documented confirmation passes consent and still hits the local-environment guard. A Docker-call tripwire verifies no Docker invocation in these isolated tests. Existing scope/ownership tests remain intact.
- This is an IMPLEMENTATION DETAIL/tooling correction, not a product question or material ADR. FOUNDATION-02 stays PARTIAL pending fresh Windows acceptance on the remediation commit. No later Foundation task is in progress.

## USER-SUPPLIED WINDOWS LIVE EVIDENCE

Ali reported the following results on 2026-10-03 for commit `e45923c003def6fcb551aadca51ca9c6143a5caa`. These are user-executed results, not a live run performed by this cloud executor:

- Windows: Docker Engine 28.1.1, Compose 2.35.1-desktop.1, Node 24.19.0, npm 11.9.0, Git 2.49.0.windows.1.
- Clean `npm ci` passed; QA project `rahrow-local-qa-20261003160726` reached HEALTHY, publishing only `127.0.0.1:55432 -> 5432`.
- Prisma reported: “PASS: Prisma SELECT 1, local read-only connection, zero models and zero non-system relations.”
- Full regression passed: lint, all typechecks, Next.js/NestJS builds, 2/2 application smoke tests, 5/5 lifecycle guard tests and 2/2 Prisma/database baseline tests.
- Cleanup removed the QA container, network and labeled volume; subsequent project-filtered container/volume/network listings showed no remaining QA resources.
- The documented npm-forwarded reset invocation emitted `Unknown cli config --confirm-local-reset`; the script correctly refused without argv confirmation. Direct `node scripts/db-local.mjs reset --confirm-local-reset` succeeded and removed only expected labeled QA resources. This is an observed Windows/npm forwarding issue, not a change to destructive consent semantics.

## BLOCKED / REMAINING ACCEPTANCE

- **Cloud runtime limit:** this executor has no Docker daemon/socket. No host/system/security changes were made to add Docker. Offline fixtures and standalone Compose parsing are not live runtime evidence.
- **Fresh remediation-commit run required on Windows:** record exact commit/tool versions; explicitly prove the uniquely named QA volume is absent before startup and quiet Compose configuration passes; start PostgreSQL and record HEALTHY plus loopback-only mapping; run Prisma validation/generation, real read-only `SELECT 1` and zero non-system relations check; rerun full FOUNDATION-01 regression and reset tests; verify unconfirmed npm reset refuses without deleting resources; record the running server version and read-only cluster system identifier; normal shutdown must retain the same owned volume and restart must preserve that identifier; use the canonical direct Node reset and verify only that QA container/network/volume are gone.
- Explicit empty-volume preflight, Compose validation and normal-shutdown retention evidence were not included in the supplied live summary. The previous run is preserved, but does not prove fresh acceptance of this remediation commit.
- Development-only dependency advisories remain unresolved; current evidence and exposure limits are under KNOWN RISKS. No audit suppression or dependency modification is part of this remediation.
- The PRD is absent from the public repository. Supplied Foundation requirements cover this bounded tooling task; future product behavior still requires the relevant text from Rahrow Lead.
- Product questions block only their recorded affected behavior. None was resolved or used to block unrelated tooling work.
- Production deployment, production database mutation and secrets changes require explicit human approval. Manual production database mutation remains prohibited. No production action is authorized here. `main` must remain at FOUNDATION-01 until required live verification and separate approval.

## PRODUCT OPEN QUESTIONS

Canonical register: [open-questions.md](open-questions.md).

25 OPEN; 0 DECIDED; 0 SUPERSEDED. The register includes all six explicit product topics from PRD §20 and the 22 accepted product subquestions, with three overlapping topics consolidated. Ali owns each decision. The register does not contain technical choices or implementation details.

The affected areas are attribution/email/reset policy; roadmap and completion; published changes and publication authority; financial outcomes and free-Path participation; currency/cart/discount outcomes; capabilities/profile gates; additional public exposure and completion privacy; community/reviews/rewards; KPI/attribution/retention meaning; and outreach/banner behavior.

## TECHNICAL DECISIONS PENDING

The following are unresolved engineering topics, not decisions already made and not requests for Ali to choose implementation mechanics. Rahrow Lead or the named specialist owns them. Record an ADR **only if the choice is materially important**, using [decisions/README.md](decisions/README.md). Routine reversible details do not belong here or in an ADR.

“Report” below refers to the accepted requirement-classification report. “PRD” means the approved v1.0 contract dated 27 Sep 2026. These references do not replace the requirement text.

| Pending technical topic | Owner | Minimum affected scope | Source |
| --- | --- | --- | --- |
| Payment gateway and final callback/settlement adapter contract | Rahrow Lead with BACKEND | Provider-specific integration and verification; preserve verified-only unlock and replaceability | PRD §§8.2, 13.2, 15, 20 |
| S3-compatible object-storage provider and adapter contract | Rahrow Lead with INFRA-SECURITY/BACKEND | Provider-specific storage/delivery integration | PRD §§13, 15, 20 |
| SMS provider and final adapter contract | Rahrow Lead with BACKEND | Provider-specific SMS integration and delivery-result mapping | PRD §§9, 13.2, 15, 20 |
| Production hosting and inside/outside-Iran topology | Rahrow Lead with INFRA-SECURITY | Production configuration/deployment; does not block local/staging development | PRD §§18–20 |
| Graph representation, traversal, validation algorithms, and atomic completion recording | BACKEND | Graph/progress/completion implementation after applicable product rules are settled | Report OQ-10C; PRD §§4–5, 14, 16 |
| PathVersion ownership, snapshot layout/timing, and transaction boundaries | Rahrow Lead | Version persistence and atomic publication/completion recording | Report OQ-11D; PRD §§4.3, 14 |
| Mapping Order PAID and Payment VERIFIED terminology across the contract | Rahrow Lead | Financial state vocabulary/API mapping without inventing a new transition | Report OQ-12A; PRD §§8.2, 16 |
| Financial idempotency keys, transactions, locking, callback deduplication, and bounded retry strategy | BACKEND | Reliable financial processing and exactly-once entitlement effects | Report OQ-12C; PRD §§8.2, 12, 15–16 |
| Entitlement ownership and persistence/service boundaries inside the monolith | Rahrow Lead | Entitlement implementation boundaries | Report OQ-12E; PRD §§13.1–13.2, 15 |
| Numeric persistence and atomic discount-limit enforcement | BACKEND | Financial representation and race-safe redemption under approved monetary rules | Report OQ-13D; PRD §§8.3, 14–15 |
| Reasonable OTP, session, rate-limit, and routine anti-abuse configuration/mechanics | INFRA-SECURITY | Authentication/security configuration and verification | Report OQ-14B; PRD §§6, 12 |
| Admin TOTP recovery procedure and controls | INFRA-SECURITY | Recovery procedure and security tests; any new recovery authority needs Ali's product decision | Report OQ-14C; PRD §§3, 12 |
| Server allowlists and DTO separation for already-defined public/private fields | BACKEND | Response serialization and authorization coverage | Report OQ-15A; PRD §§4.2, 6, 11.2, 12, 15 |
| Protected asset delivery, cache separation/invalidation, and crawler-safe rendering | INFRA-SECURITY with BACKEND/FRONTEND | Secure premium delivery across affected surfaces | Report OQ-15C; PRD §§4.2, 11.2, 12, 18 |
| Configurable reward-engine structure, score persistence, and concurrency/deduplication | BACKEND | Gamification implementation under decided reward rules | Report OQ-16D; PRD §7.4 |
| Event reliability, append-only persistence, metadata versioning, and projection design | BACKEND | Event reliability and analytics projections under approved counting semantics | Report OQ-17C; PRD §§10.2, 13.2, 14 |
| Additional Blog conversion instrumentation | BACKEND/FRONTEND | Instrumentation of already-required Blog conversion under approved attribution/privacy rules | Report OQ-17D; PRD §§10.2, 11.1 |
| Physical retention enforcement, partitioning, rollups, and purge implementation | BACKEND/INFRA-SECURITY | Data lifecycle under approved retention/privacy policy | Report OQ-17F; PRD §§10.2, 12 |
| Recipient snapshot persistence, delivery batching/queues, retry/backoff, and duplicate prevention | BACKEND | Reliable delivery within approved sending and audience semantics | Report OQ-18B; PRD §9 |
| Provider outcome mapping, internal send statuses, and partial-failure bookkeeping | BACKEND | Accurate delivery reporting and operational recovery | Report OQ-18C; PRD §9 |
| Performance/accessibility budgets, supported test matrix, load assumptions, and QA methodology | QA-REVIEW with Rahrow Lead | Those specific measurable QA gates | Report OQ-19A; PRD §§18, 22 |
| Backup frequency/retention, recovery targets/topology, and restore procedure | INFRA-SECURITY | Recovery design and required staging restore verification | Report OQ-19B; PRD §§12, 18–19, 22 |

No provider or hosting choice has been selected. Production hosting remains a separate approval gate. Escalate material cost commitments, privacy/residency changes, irreversible constraints, unacceptable data-loss/service tradeoffs, new recovery privileges, or changed user outcomes to Ali rather than silently resolving them as technical details. Ordinary secure defaults, delivery deduplication, and test organization do not automatically require Ali's decision.

## LATEST TEST STATUS

### Reset remediation checks (2026-10-03)

- Clean `npm ci`, `npm ls --all`, offline Prisma validation and full `npm run check`: **PASS**. Aggregate includes lint, all typechecks/builds, 2/2 application smoke tests, 8/8 lifecycle tests and 2/2 Prisma baseline tests. An initial lint failure from missing explicit Node imports in the new test fixture was corrected before the successful full rerun.
- Actual root `npm run db:reset`: **EXPECTED REFUSAL**, exit 1, showing the canonical direct Node command before environment loading or Docker access. Package scripts and `package-lock.json` are byte-for-byte unchanged from e45923c.
- Runtime audit: **PASS**, exit 0, 0 findings. Current full audit: **FAIL**, exit 1, **10 package entries: 9 high and 1 moderate**. The additional moderate entry is `@prisma/client` via `prisma`, with no separate direct advisory URL and `fixAvailable: false` in this audit output; the four direct advisories below persist. No dependency changes or suppression were made. This supersedes the numeric total of the preserved earlier audit below.
- Live fresh Windows checks on the remediation commit: **PENDING**, not executed by this Docker-less cloud environment.

### Preserved FOUNDATION-02 baseline evidence

- Author checks: dependency install/tree, offline Prisma validation and zero-model generation, local database-tooling guards, lint, tooling typecheck and independent API build: **PASS**.
- Independent clean `npm ci` and `npm ls --all`: **PASS**. An interrupted first attempt and an unwritable default npm cache were corrected; the clean install used a writable external cache without changing the repository dependency contract.
- Official Compose v5.6.0 checksum verification and daemon-free `config --quiet`: **PASS**. Normalized configuration checks cover one service, pinned image tag, loopback mapping, named-volume mount/labels, health check, SCRAM and no automatic restart.
- Lifecycle guard unit tests: **PASS**, 5/5. Additional independent stubbed orchestration safety cases: **PASS**, 8/8. These test guards only and are not database runtime evidence.
- Independent plain Prisma 7.10.0 validation and zero-model generation without a local `.env`: **PASS**. Independent `npm run check`: **PASS**, including lint, all workspace/tooling typechecks, shared/web/API builds, the original 2/2 startup smoke tests, and 7/7 database guard/model tests. No product behavior is covered or claimed.
- Runtime-only audit: **PASS**, exit 0 and 0 findings. Full audit: **FAIL**, exit 1 and 9 high-severity package entries across 4 advisories. Both results were independently reproduced from the clean snapshot; exact paths and fix constraints are below.
- Independent frozen-source comparison, preserved governance/scoped instructions, ignored environment/generated files, no model/migration/seed source, and secret/scope checks: **PASS**.
- Live PostgreSQL startup/health, real `SELECT 1`, zero non-system relations and scoped cleanup: **USER-REPORTED PASS for e45923c** as detailed above. **NOT RUN by this cloud executor; fresh remediation-commit acceptance remains pending.** Explicit preflight/Compose/retention evidence still needs capture.
- No product authorization/payment/concurrency tests, product migrations, staging/production checks, CI or deployment were performed. Full Foundation and release-candidate acceptance are not claimed.

## KNOWN RISKS

- Previous Windows runtime success is preserved as user-supplied evidence. Fresh acceptance must cover the remediation commit and the explicit missing gates; source review and offline fixtures cannot substitute for that run.
- Docker image `postgres:18.6-bookworm` is patch/distribution pinned, not digest pinned; rebuilt upstream image layers can change. The local-only example credentials must never be reused outside this disposable setup. Docker Engine 28+ is required by the local lifecycle guard; remote/TCP/SSH daemon endpoints are rejected.
- Existing development lint advisory [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): `eslint-config-next` → Next ESLint plugin → `fast-glob` → `micromatch` → `braces@3.0.3`. It accounts for 5 package findings; no patched braces version was available when checked. Repository lint patterns must remain trusted inputs.
- New development tooling advisory [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx): Prisma 7.10.0 → `@prisma/config@7.10.0` → pinned `deepmerge-ts@7.1.5`; fix is version 8.0.0, outside the upstream exact pin. Current Prisma configuration is trusted local source and does not accept externally supplied recursive object graphs. This exposure limit is not remediation.
- Prisma 7.10.0 also pins `mysql2@3.15.3`, affected by [authentication downgrade](https://github.com/advisories/GHSA-3f6p-5ww8-9rcr) and [compressed-protocol decompression exhaustion](https://github.com/advisories/GHSA-rgwj-5xj2-c3m3) advisories. A version satisfying both fixes is outside the exact upstream pin. This PostgreSQL-only tooling path does not open a MySQL connection; the dependency nevertheless remains in the development tree.
- The original Prisma/config/deepmerge/mysql2 paths added 4 package findings, for the original 9 high package entries across 4 direct advisories including braces. The remediation audit additionally reports one moderate `@prisma/client` transitive entry via `prisma`, making the current total 10; this is an audit-report change with an unchanged lockfile, not a newly introduced dependency. Runtime-only audit is separate; it does not establish overall security. No unsupported override, prerelease adoption, incompatible downgrade, audit suppression or weakened check was used. Rahrow Lead owns tracking compatible upstream fixes within a separately authorized task.
- ESLint 9.39.5 remains the compatible lint-stack pin but is unsupported upstream; the current plugin peer ranges exclude ESLint 10. This earlier risk remains open.
- Product requirements, security behavior, transactional correctness and production readiness remain unimplemented/unverified. Keep all 25 product questions open and follow the PRD availability rule.
- The repository is public. Never publish the private PRD, private conversations, real credentials, local `.env` or generated output without applicable authorization.

## NEXT RECOMMENDED TASK

Run the **fresh FOUNDATION-02 Windows acceptance checklist** in [infra/README.md](../infra/README.md) on the published remediation commit with a new isolated QA project and disposable volume. Capture all remaining gates, including the direct Node destructive command. Update verified evidence before considering FOUNDATION-02 completion. Advancing `main` still requires separate approval.

Stop at this boundary. Do not begin FOUNDATION-03, CI, Meilisearch, product schema, Auth, staging/production infrastructure or any unrelated feature automatically.
