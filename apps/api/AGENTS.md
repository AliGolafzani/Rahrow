# BACKEND instructions

Scope: `apps/api/` and its backend implementation. Inherit the root `AGENTS.md`, including the PRD availability rule, classification model, minimum-affected-scope rule, approval gates, and test-before-DONE requirement. These instructions do not authorize creating the application or resolving missing product rules.

## Responsibilities and boundaries

- Implement the NestJS API as a modular monolith. Keep business rules in the responsible domain module, with explicit service boundaries and contract ownership. Do not turn unclear module ownership into an Ali decision unless there is a genuine product tradeoff.
- Use Prisma with PostgreSQL as the transactional Source of Truth. Propose schema and migration changes only within the authorized task and supplied requirements. Use versioned migrations; test supported migration paths when they exist.
- Maintain versioned REST contracts, consistent list/error conventions, OpenAPI documentation generated from the API, and DTO validation at trust boundaries. Coordinate shared API types with consumers instead of allowing frontend assumptions to define business behavior.
- Enforce server-side authorization and capability-based RBAC centrally for premium content and sensitive operations. Do not rely on frontend rendering, hidden controls, client flags, or provider state for authorization.
- Implement only approved state-machine transitions and guards. Preserve completion history and required timestamps. Do not infer reset, refund, archive, or repeat-completion outcomes from conventional patterns.
- Use appropriate transactions, constraints, and concurrency control to preserve invariants. Verify payments on the server; make financial mutations and callbacks idempotent, with no duplicate entitlement effects. Engineering owns the mechanics; Ali owns undefined customer outcomes.
- Keep payment, SMS, and object storage behind replaceable provider interfaces/adapters. PostgreSQL retains authoritative order, entitlement, message, and audit records; no provider is the Source of Truth.
- Make sensitive operations auditable, including the required actor, action, target, time, and relevant state-change information. Avoid secrets and unnecessary personal data in logs.
- Emit the required append-only, versioned analytics events for authorized business actions. Keep analytics and search as derived projections. Separate deduplication of one event's delivery from product decisions about counting distinct actions.

## Explicit prohibitions

- No frontend-dependent authorization or premium-data protection.
- No payment, SMS, storage, search, or analytics provider as transactional Source of Truth.
- No manual production database mutation. Production database operations require explicit human approval and the permitted versioned process.
- No invented product rules, silent PRD reinterpretation, or scope expansion.

## Verification and reporting

Test affected contracts, DTO rejection, RBAC, unauthorized payload non-disclosure, valid/invalid state transitions, transaction rollback, and repeated/concurrent requests. Test migration and provider adapter behavior where affected. Do not bypass failing tests. Report changed files/contracts, source requirements, decision dependencies, exact checks/results, and the minimum blocked scope; update project state with verified facts.

Source boundaries: PRD §§3–4, 8, 10.2, 12–16, 17 and 22–23. These references do not substitute for the relevant PRD text in the task context.
