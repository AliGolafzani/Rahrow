# Rahrow agent instructions

These rules apply to every agent and every directory in this repository. Read this file and `docs/project-state.md` before starting a task. Read any applicable scoped `AGENTS.md` when its directory exists. Scoped instructions supplement these rules; they cannot weaken the product contract, security boundaries, approval gates, or test requirements.

## Product authority

- Ali is Product Owner. Only Ali resolves PRODUCT OPEN QUESTIONS or approves product-contract changes.
- Rahrow Lead coordinates scope, dependencies, specialist assignments, and access to the approved requirements. Engineering owns technical choices within the approved contract.
- The approved PRD is the primary product contract. Repository governance documents organize work; they do not replace the PRD or authorize a new milestone.
- Follow explicit approved decisions and preserve their traceability. If sources conflict or a newer instruction appears to change the contract, stop only the conflicting scope and ask Rahrow Lead to establish the applicable requirement. Do not silently reinterpret the PRD.
- Do not expand scope, add features, or start the next milestone merely because it appears in the PRD or a proposed plan. Work within the authorized task.

## PRD AVAILABILITY RULE

The approved “Rahrow MVP PRD & Technical Architecture v1.0 — 27 Sep 2026” is the primary product contract.

However, the PRD is not currently stored in this public repository.

Therefore:

- Never assume product requirements from memory or convention.
- If a coding/review task depends on product behavior and the relevant PRD requirement is not available in the task context, stop only that affected scope.
- Request the relevant PRD requirement from Rahrow Lead.
- Do not invent or reconstruct missing product behavior.
- A repository file referencing the PRD does not prove that the PRD text itself was available to the specialist agent.

Do not add the PRD itself to the public repository without explicit approval from Ali.

## Classify before escalating

### PRODUCT OPEN QUESTION

A missing or conflicting rule changes user-visible behavior, eligibility, permissions, business outcomes, privacy expectations, or product meaning. Ali decides. Record it in `docs/open-questions.md`, with its source and the smallest affected scope. Do not invent a default while waiting.

### TECHNICAL DECISION

An engineering choice implements already-defined behavior: architecture, persistence, transactions, reliability, security mechanics, integration contracts, or test methodology. Rahrow Lead or the relevant specialist decides. Record an ADR in `docs/decisions/` only when the choice is materially important. Track unresolved technical dependencies in `docs/project-state.md`; never put them in the product-question register.

Escalate a genuine product tradeoff or materially irreversible choice to Ali. Separate that tradeoff from the engineering work instead of recategorizing the entire technical topic as a product question. Provider selection and production hosting are technical topics even though they appear in PRD §20; contractual commitments and production actions still require their applicable approvals.

### IMPLEMENTATION DETAIL

A routine, reversible implementation choice within the agreed behavior and architecture, such as helper names, local component extraction, or test-file organization. The specialist decides. Do not add it to the product-question register, the technical-pending list, or an ADR.

### Minimum affected scope

Only block the minimum affected scope. An unresolved question must not block unrelated work in the same milestone. State the exact behavior, contract, or operation that depends on the missing decision. Continue independent authorized work. A blocked feature does not make its entire module or milestone blocked.

Settled requirements remain obligations, including server-side premium protection, verified-only unlock, idempotent financial effects, preservation of historical completion, and admin TOTP. Do not reopen them as optional product choices.

## Shared architecture and invariants

- Use an API-first Modular Monolith with clear domain ownership. Do not introduce microservices or unapproved architecture changes.
- PostgreSQL is the transactional Source of Truth. Meilisearch is a rebuildable derived index. Analytics events/projections are derived reporting inputs, never the authority for progress, orders, payment, or entitlement.
- Enforce authorization and capability-based RBAC on the server. The client, cached UI state, search index, and external providers are not authorization authorities.
- Never send premium payload to an unauthorized client or crawler. Protect all delivery paths, including API responses, server-rendered output, assets, caches, search results, and logs. Public roadmap/metadata and preview behavior must follow the supplied PRD requirements.
- Keep payment, SMS, and object-storage integrations behind replaceable interfaces/adapters. Provider responses do not replace verified transactional state in PostgreSQL.
- Use versioned migrations only. Do not manually mutate production database schema or data. Preserve transactional consistency and auditable history.
- Keep secrets out of the repository and client bundles. Minimize personal information in logs and do not expose private profile fields.
- Respect state machines. Implement only approved states, transitions, guards, actors, and effects. Preserve required timestamps/history, test invalid transitions, and handle repeated/concurrent requests without duplicate business effects. An unspecified transition is not permission to invent one.

Sources: PRD §§3–4, 8, 10.2, 12–16, 23. Obtain the relevant text before dependent coding or review.

## Approval gates

- Production deployment, production database mutation, and secrets changes require explicit human approval for the specific action and target environment. Approval does not waive the ban on manual production database mutation or other security rules.
- Product-contract changes require explicit approval from Ali and an updated decision record before dependent implementation.
- A development task, local check, ADR, or successful test does not authorize production actions, publication of the PRD, or the next milestone.
- Do not put secrets, private conversations, or non-public source documents in public commits. Include only content authorized for the public repository.

## Test before DONE

- Identify acceptance criteria and applicable checks before implementation. Use the supplied PRD text and recorded decisions, not assumptions.
- Run relevant tests and other existing required checks against the final change before reporting DONE. Cover authorization, premium-data non-disclosure, state transitions, idempotency, and concurrency when affected.
- Never bypass failing tests by skipping, deleting, weakening, or disabling them merely to obtain a pass. Diagnose and fix the cause. If a test conflicts with an explicitly approved requirement, explain and review the justified test change.
- Report exact checks and results as passed, failed, blocked, or not run. A focused check is not a full-suite pass; absent test infrastructure is not a successful application test.
- Rerun affected checks after later edits. If required verification cannot run, report PARTIAL or BLOCKED for that scope, explain why, and do not claim it is DONE.
- Documentation-only changes require content, consistency, link, and scope checks. Do not invent application test results for a governance-only repository.

## Task and result reporting

Before work, inspect the actual repository, existing instructions, current state, and available tests. Do not overwrite useful files or concurrent work. Surface a governance-file conflict before replacing it.

Rahrow Lead's task handoff should identify the goal, authorized files/modules, relevant PRD text, applicable product decisions/ADRs, acceptance criteria, dependencies, and required approvals. A PRD title or section reference alone is insufficient when behavior is needed.

Each specialist result must report:

1. STATUS: DONE, PARTIAL, or BLOCKED, with the affected scope.
2. Changes made and files affected; separate proposed work from implemented work.
3. Requirements and recorded decisions used; identify any missing source text.
4. Tests/checks run and exact outcomes, including failed, blocked, and not-run checks.
5. New questions or decisions, classification, owner, source, and minimum affected scope.
6. Risks, deviations, remaining dependencies, and the next recommended task.
7. Commit/PR identifiers only if they actually exist and publication was authorized.

Update `docs/project-state.md` with verified progress, test status, and remaining dependencies. Keep product decisions in `docs/open-questions.md` and material technical decisions in ADRs. Never describe planned work, skeletons, schema, CI, tests, or releases as completed without evidence.
