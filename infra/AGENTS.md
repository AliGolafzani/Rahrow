# INFRA-SECURITY instructions

Scope: `infra/` and authorized infrastructure/security work. Inherit the root `AGENTS.md`, including the PRD availability rule, classification model, minimum-affected-scope rule, approval gates, and test-before-DONE requirement. These instructions do not authorize creating infrastructure, connecting services, or operating production.

## Responsibilities and boundaries

- Maintain Docker-based reproducible environments when Foundation is authorized. Separate local, staging, and production configuration and keep seed/demo data separate from production data.
- Build CI gates for the repository's actual supported checks. Report absent or unavailable tooling honestly; never fabricate a pass or weaken a failing gate merely to advance a task.
- Keep configuration explicit and provider choices replaceable. Production hosting/topology remains an unresolved technical decision and separate production approval gate; it does not block independent local/staging development.
- Keep secrets in environment/secret-management facilities, out of source control, images, logs, and client bundles. Use least privilege and separation between environments; do not create, rotate, reveal, or change secrets without explicit human approval.
- Provide structured logging, error-tracking hooks, and health checks as scoped by the PRD. Minimize personal information and prevent sensitive output from observability systems.
- Design PostgreSQL backups and a documented recovery procedure, and verify restore in staging before production. Choose reasonable reliability mechanics as engineering work; escalate material privacy/residency, cost, irreversible, or data-loss/service tradeoffs to Ali.
- Support deployment, TLS/reverse-proxy configuration, secure runtime/network boundaries, and safe artifact/asset delivery within the approved architecture. Do not make essential assets or in-app notifications depend on an unapproved mandatory external CDN contrary to the PRD's network-resilience requirements.
- Coordinate server authorization, protected storage delivery, cache partitioning/invalidation, rate limits, session safeguards, and TOTP recovery with BACKEND/FRONTEND. Do not introduce new recovery privileges or permissions as a technical shortcut.

## Explicit approval gates

Production deployment, production database mutation, and secrets changes require explicit human approval for the specific action and target. A local/staging task, accepted ADR, passing CI, or this file is not approval. Manual production database mutation remains prohibited; use only the approved versioned process. Never begin a production operation while approval is missing.

## Verification and reporting

Validate affected environment/configuration changes without exposing secrets; test relevant security boundaries and deployment/recovery procedures in an approved safe environment. Record backup/restore evidence and failures accurately. Do not claim production readiness from configuration alone. Report files/settings changed, environment, requirement sources, actual checks/results, required approvals, and minimum blocked scope; update project state with verified facts.

Source boundaries: PRD §§12–13, 15 and 18–22. These references do not substitute for the relevant PRD text in the task context.
