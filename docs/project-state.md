# Rahrow project state

Snapshot date: 2026-10-03. This document describes verified work and dependencies, not completion of requirements merely listed in the PRD.

## CURRENT MILESTONE

Governance and multi-agent coordination scaffold.

Foundation: **NOT STARTED**. Do not begin Foundation until Ali approves the governance scaffold and authorizes the next task.

## PROJECT PHASE

Governance scaffold prepared and reviewed; awaiting Ali's scaffold review. Product implementation has not started.

Repository baseline: Rahrow Lead inspected the public [AliGolafzani/Rahrow repository](https://github.com/AliGolafzani/Rahrow) on 2026-10-03 at approximately 10:45 UTC and found an empty repository with no branches, commits, or files. Default-branch metadata named `main`; that was not evidence of an existing branch. There were no existing governance files to preserve or replace.

The prepared repository content is limited to:

- `AGENTS.md`
- `docs/project-state.md`
- `docs/open-questions.md`
- `docs/decisions/README.md`
- `docs/decisions/ADR-template.md`

Initial root-instructions publication was verified at commit `4332646aa3e5c3a3de2781428d38205b38edeccd`. No implementation commit is claimed.

## COMPLETED

- Baseline inspection and conflict check for the governance-only scope.
- Preparation of the five governance files above, including the PRD availability rule and accepted requirement-classification model.
- Registration of 25 unresolved PRODUCT OPEN QUESTIONS with owners, source references, and minimum affected scopes. No product answers were supplied.
- Preparation of proposed BACKEND, FRONTEND, and INFRA-SECURITY instructions outside the repository. The corresponding scoped `AGENTS.md` files are deferred until `apps/api`, `apps/web`, and `infra` are created during an authorized Foundation task.
- Governance content/scope validation and independent review of the five files and three deferred scoped instructions.

No application, framework skeleton, database schema, migration, package setup, Docker setup, CI configuration, feature code, seed data, or application test suite has been created.

## IN PROGRESS

- Awaiting Ali's review and approval of the governance scaffold.
- No product implementation is in progress.

## BLOCKED

- Foundation is not authorized by this governance task. This is a scope gate, not a conclusion that all product questions block Foundation.
- The PRD is absent from the public repository. A specialist without the relevant text must request it from Rahrow Lead and stop only dependent coding/review. A document title or section reference does not establish that the specialist received the requirement.
- Each OPEN product question blocks only its recorded affected behavior when that work is authorized. Do not block an entire module or milestone by association.
- Pending technical choices block only their engineering dependencies. Engineering owns their resolution; only a genuine product tradeoff or materially irreversible choice requires escalation to Ali.
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

- Application tests, lint, type checks, builds, migrations, CI, security tests, payment sandbox tests, and restore tests: **NOT RUN**. No application or test/CI infrastructure exists in this governance-only baseline.
- Governance validation: **PASS** for the exact five-file inventory; absence of application/infra directories; required state and ADR sections; 25 unique OPEN product entries with all nine fields, source coverage, and original-question aliases; 22 scoped technical-pending topics; exact PRD availability rule; local document links; public-content/privacy checks; and three deferred scoped instructions kept outside the repository. Independent content review: **PASS**. These are document checks, not product verification.
- PRD release-candidate checks remain future requirements, not achieved results.

## KNOWN RISKS

- Future specialists could mistake PRD references or this summary for having received the primary contract. Apply the root PRD availability rule to every dependent task.
- Implementing unresolved product outcomes would silently invent behavior. Use the register's affected scopes and preserve settled invariants.
- Misclassifying ordinary engineering decisions as product questions can block unrelated work. Conversely, an ADR must not quietly decide user permissions, financial outcomes, privacy, or product scope.
- Authentication, premium protection, financial correctness, version history, backup/recovery, and all other implementation requirements are unverified because implementation has not started.
- The repository is public. Do not publish the PRD, private conversations, secrets, or other non-public source material without the required authorization.

## NEXT RECOMMENDED TASK

Ali reviews and approves the governance scaffold. Then request a separately authorized Foundation-only task with the relevant PRD text, exact scope, acceptance checks, and engineering decision owners. Create the deferred scoped `AGENTS.md` files when their directories are legitimately created during that task. Do not begin Foundation from this document alone.
