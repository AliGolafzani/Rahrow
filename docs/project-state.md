# Rahrow project state

Snapshot date: 2026-10-03. This document describes verified work and dependencies, not completion of requirements merely listed in the PRD.

## CURRENT MILESTONE

Foundation, bounded task **FOUNDATION-01 — Repository and Monorepo Skeleton: COMPLETE**.

Ali approved the governance scaffold and authorized this task on 2026-10-03. Only the repository/application skeleton is in scope. The complete Foundation milestone and product implementation are not authorized by that task.

## PROJECT PHASE

Governance approved. FOUNDATION-01 skeleton implemented and independently verified. No product behavior is implemented. The complete Foundation milestone is not complete; FOUNDATION-02 has not started.

Verified baseline for this task: `main` at `95f64b9aa92c1c179f6c3bad3096938432cc027c`, containing the five approved governance files. The repository had been empty at the earlier governance inspection. Initial root-instructions publication was verified at `4332646aa3e5c3a3de2781428d38205b38edeccd`.

The skeleton adds `apps/web`, `apps/api`, `packages/contracts`, `packages/ui`, `packages/config`, `infra`, root npm workspace tooling, documentation, and startup smoke checks. Root instructions, product questions, and ADR guidance/template are preserved. No implementation commit or PR is claimed in this snapshot.

## COMPLETED

- Governance baseline inspection, preparation, validation, and independent review of the original five files; all 25 product questions remain OPEN.
- Ali's approval of the governance and the three deferred scoped instruction files; bounded authorization of FOUNDATION-01.
- Creation of the approved `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, and `infra/AGENTS.md` with the exact deferred contents.
- Private npm workspaces with one root lockfile, shared TypeScript/ESLint configuration, exact direct dependency versions, root commands, and ignored generated/local files.
- Neutral Next.js 16 placeholder and empty NestJS application with no application routes. Contracts/UI entry points intentionally export nothing. Next.js `agentRules: false` prevents development startup from modifying the approved scoped instructions.
- Initial install and a clean `npm ci`, complete dependency-tree checks, lint, four workspace type checks, both library builds, independent web/API builds, and two built-application smoke tests passed. The aggregate check passed again after the clean install and after the final Next.js configuration change.
- Independent QA **PASS** on 2026-10-03: separate clean install and valid dependency tree; sibling-free builds; final aggregate checks; both root development scripts; approved-instruction preservation; scope/content review. No scope blocker found.

No product module, database schema/migration, Prisma/PostgreSQL/Meilisearch setup, Docker setup, CI configuration, provider integration, seed data, or production infrastructure has been created.

## IN PROGRESS

- No implementation is in progress. FOUNDATION-01 is complete and work stops at this task boundary.
- Repository publication status is reported separately by Rahrow Lead; no product implementation, later Foundation task, or production operation is in progress.

## BLOCKED

- The PRD is absent from the public repository. The architecture excerpt supplied for FOUNDATION-01 covers this skeleton; dependent future behavior still needs the relevant contract text from Rahrow Lead.
- Each OPEN product question blocks only its recorded affected behavior when that work is authorized. None was silently resolved by this skeleton.
- Later Foundation tasks and product features need separately bounded authorization; completing this skeleton does not authorize the next task.
- A development-toolchain advisory has no compatible published fix at the verified date; details are under KNOWN RISKS. It is not a product question or an application-runtime finding.
- Production deployment, production database mutation, and secrets changes require explicit human approval. Manual production database mutation remains prohibited. No production action is authorized here.

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

Verification date: 2026-10-03. Toolchain: Node 24.19.0; npm 11.9.0.

- `npm install` and final clean `npm ci`: **PASS**. `npm ls --all`: **PASS** after each, with valid workspace links and no missing/invalid dependencies.
- `npm run lint`: **PASS**, zero warnings. An initial missing `URL` import in the smoke script was fixed; the successful check includes the fix.
- `npm run typecheck`: **PASS** for contracts, UI, web (including `next typegen`), and API.
- `npm run build`: **PASS**, including both placeholder libraries, Next.js 16.3.8, and NestJS 12.1.2. The web and API builds do not require a running sibling app or external services.
- `npm test`: **PASS**, 2 tests, 0 failed, skipped, or cancelled. Checks cover empty workspace exports, built web HTTP 200/placeholder text, and built API startup/default HTTP 404; test children are stopped.
- Root `npm run dev:web` and `npm run dev:api`: **PASS** in a disposable source copy with local dependencies; expected HTTP responses and content-change watch behavior verified, approved web instructions confirmed unchanged, then process groups stopped and ports confirmed closed. Independent QA also verified both root development scripts and instruction-file preservation.
- `npm run check`: **PASS**, including repeats after clean `npm ci`, development-only dependency classification, and final `agentRules: false` configuration. Independent final aggregate run: **PASS**, exit 0, smoke tests 2/2.
- `npm audit --omit=dev`: **PASS**, 0 vulnerabilities after correct dependency classification. This is a runtime dependency audit, not proof of product security.
- Full `npm audit`: **FAIL**, 5 high-severity package findings arising from one development-only `braces` advisory. See KNOWN RISKS; no audit suppression, overrides, or incompatible framework downgrade applied.
- `npm dedupe --dry-run`: **PASS** as a diagnostic; proposed deduplication affects unrelated ESLint utilities and does not replace vulnerable `braces`.
- Governance validation of the original scaffold: **PASS** (historical), including 25 unique product questions and 22 scoped technical-pending topics. Final skeleton JSON/local-link/scope checks, exact deferred scoped instructions, preserved original governance, 25 OPEN questions, ignored generated artifacts, and `git diff --check`: **PASS**. Independent final content/scope/governance review: **PASS**.
- Product/security/authorization/payment/concurrency/migration tests, CI, deployment, and restore checks: **NOT RUN / NOT IMPLEMENTED** in this task. The PRD release-candidate checks remain future requirements.

## KNOWN RISKS

- Future specialists could mistake PRD references or this summary for having received the primary contract. Apply the root PRD availability rule to every dependent task.
- Unresolved product outcomes remain unknown; preserve the question register and settled invariants. This skeleton does not establish authentication, premium protection, financial correctness, version history, or production readiness.
- Development-only advisory [GHSA-vfj7-8cjw-p6xm / CVE-2026-93687](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): high-severity stack-exhaustion denial of service from deeply nested brace patterns. Dependency path: `eslint-config-next@16.3.8` → `@next/eslint-plugin-next@16.3.8` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. The latest published `braces` is 3.0.3 and the advisory lists no patched version. npm's suggested change is `eslint-config-next@14.2.35`, an incompatible major downgrade for the selected framework baseline; it was not applied. Rahrow Lead owns follow-up on a compatible upstream fix. Development lint patterns must remain trusted repository/tooling inputs.
- ESLint 9.39.5 is the compatible pin for the current Next.js lint-plugin peer ranges, but npm reports that ESLint 9 is no longer supported. ESLint 10 is outside the current React/import/accessibility lint-plugin peer ranges. Review a compatible upstream lint-stack update in a later bounded tooling task; no peer override or rule weakening was used.
- The repository is public. Do not publish the PRD, private conversations, secrets, or non-public source material without authorization.

## NEXT RECOMMENDED TASK

Report FOUNDATION-01 completion, exact verification results, remaining development-toolchain risks, and actual publication status. Stop at this task boundary. Rahrow Lead may propose FOUNDATION-02 as a separately bounded task for authorization; do not begin it, infrastructure setup, or product modules from this document alone.
