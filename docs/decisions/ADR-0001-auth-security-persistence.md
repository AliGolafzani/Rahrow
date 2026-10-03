# ADR-0001: Transactional Auth security-state persistence

## Status

Accepted for bounded AUTH-01 by the responsible engineering owner under Ali's approved plan and binding refinements.

## Date

2026-10-03

## Context

The supplied approved PRD v1.0 (2026-09-27) requires mobile OTP for users, Password + TOTP for admin authentication, capability-based server authorization, secure sessions and audit of sensitive actions. PostgreSQL is authoritative. AUTH-01 is only the domain foundation: no login endpoints, SMS or admin flow. The actual relevant PRD text was supplied to implementation specialists, not inferred from repository references. [OQ-07, OQ-14A and OQ-14D](../open-questions.md) retain their minimum affected scope.

Rahrow Lead/BACKEND and INFRA-SECURITY own this material technical choice. It does not assign privileges, choose status meanings, settle onboarding or authorize deployment.

## Decision

Use explicit Auth, Users, RBAC and Audit modules and ten narrowly scoped Prisma tables. Persist opaque token digests, per-session authentication evidence, OTP verification MACs, rate-limit state and encrypted admin TOTP envelopes. No authentication method is inferred from roles or credential possession. Session issuance is unavailable in AUTH-01; admin resolution/rotation is also unavailable until both password and actual TOTP are verified in a later authorized task.

Use async bounded scrypt; domain-separated HKDF/HMAC for OTP/rate identifiers and code verification; AES-256-GCM for TOTP storage with random nonce, external versioned key lookup and user-bound AAD. Keys are never stored in the database/repository. Use PostgreSQL row locks, conditional updates and transactions for attempts/consumption, rotation, replay counters and limits. Sensitive assignment plus its bounded audit summary is one transaction. Keep public identity an explicit two-field allowlist.

Deploy the first schema by one committed versioned migration from empty state; retain exact-schema checks, replay no-op, same-cluster restart and scoped cleanup. Use forward repairs and reviewed recovery rather than speculative destructive down migrations.

Keep Prisma client/adapter/driver as genuine runtime dependencies. Use npm's supported development alias `prisma-cli: npm:prisma@7.10.0` for the identical CLI tarball, importing prisma-cli/config. Directly naming the development CLI prisma makes the client's optional peer pull its vulnerable tooling closure into npm's omit=dev production graph. The alias leaves that optional peer absent and physically omits CLI/config/deepmerge-ts/mysql2 from clean production installs. This is dependency classification, not advisory remediation: the full development audit still reports its findings, versions/tarball integrity stay unchanged, and `npm audit --omit=dev` is not weakened. TypeScript's optional peer can remain in the runtime tree.

Generate ignored Prisma source inside API src and use TypeScript rewriteRelativeImportExtensions, testing both native source tooling and compiled Nest code.

## Alternatives considered

- Stateless JWT-only authority: rejected because immediate revocation/current persisted assurance is required; adds unnecessary revocation complexity.
- Raw/unsalted OTP hashes or recoverable codes: rejected because small OTP spaces need a protected keyed verifier and no plaintext persistence.
- Unauthenticated TOTP encryption or embedded keys: rejected due to tampering/key-exposure risks.
- Role-name checks/super-admin shortcuts: conflict with capability-based authority and open assignments.
- Whole-object audit snapshots: rejected for secrets/PII and unbounded data exposure.
- Redis: unnecessary for the first bounded scope; PostgreSQL atomic state is sufficient.
- Suppressing audit findings or changing dependency versions to work around a peer artifact: rejected. The supported alias retains actual development advisories and separates genuinely absent runtime tooling without changing the security gate. A separate independently installed tooling project would be larger operational scope.

## Consequences

Benefits: current persisted authority, race-safe state changes, minimal privacy surface and no fabricated admin success. Costs: database round trips/locking, explicit external key lifecycle management and a later required auth orchestration boundary. scrypt memory requires bounded concurrent admission when admin login is built. Token/key rotation, cleanup/retention, recovery policies and production secret delivery need later scoped design.

Reversibility: fields and module internals can evolve through versioned migrations; no product policy is encoded by default. Production secrets/operations still require separate approval. Live PostgreSQL/CI evidence and independent QA are required before completion; unit tests alone do not prove database concurrency or migration acceptance.

See [Auth foundation](../auth-foundation.md) for field traceability, exact boundaries and verification commands. Technical sources: [npm package aliases](https://docs.npmjs.com/cli/v11/commands/npm-install/#description), [TypeScript import extension rewriting](https://www.typescriptlang.org/tsconfig/rewriteRelativeImportExtensions.html).

## Affected modules

Auth, Users, RBAC, Audit, shared public type, database infrastructure and their local/CI verification.

## Related PRD requirement

Supplied PRD §§3,6,12–16,20; approved AUTH-01 implementation plan and 2026-10-03 binding refinements. Private source documents are not distributed by this ADR.
