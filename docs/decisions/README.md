# Technical decision records

ADRs record material TECHNICAL DECISIONS made by Rahrow Lead or the responsible specialist within the approved product contract. This directory initially contains guidance and a template only; no technical choice has been resolved by creating it.

## When an ADR is required

Use an ADR for a choice with meaningful consequences for architecture, domain ownership, cross-module/API contracts, persistence or migration strategy, security, reliability, provider replaceability, or operational recovery. Consider the cost of reversing the choice and whether future agents need the rationale to avoid incompatible implementations.

Examples include material graph/version persistence decisions, financial transaction/idempotency strategy, cross-module entitlement ownership, security-sensitive delivery design, and production topology. These are topics for assessment, not decisions already made.

Do not create an ADR for:

- Product Owner decisions already recorded in `../open-questions.md`. Reference them from an ADR only when a separate material engineering choice depends on them.
- Trivial, reversible implementation details such as helper names, local form composition, fixture naming, or test-file layout.
- A restatement of an already-settled PRD requirement with no material implementation choice.

Pending technical work belongs in `../project-state.md` until an ADR is warranted. An unresolved technical topic does not automatically require Ali's decision or block the entire milestone.

## Decision workflow

1. Verify the relevant approved PRD text is available. A section reference alone is not evidence that the author received the requirement.
2. Identify the exact technical choice, responsible owner, affected scope, alternatives, and material consequences.
3. If the choice introduces a product tradeoff, new authority/privacy expectation, or materially irreversible constraint, isolate that issue for Ali. Do not decide it indirectly through an ADR.
4. Create a sequential file such as `ADR-0001-short-title.md` from `ADR-template.md` when material. Use `Proposed` while unresolved and `Accepted` only after the responsible engineering owner has actually decided. A proposal is not authorization to implement its outcome.
5. Keep the decision within the product contract; link applicable product-question IDs and related ADRs in Context. Record the source section in Related PRD requirement without reproducing private source documents.
6. Preserve history. Mark a replaced record `Superseded`, point to its replacement, and explain the relationship in the new record. Do not silently rewrite an accepted decision's meaning.
7. Update project state, then implement and verify only within the authorized task. Production and secrets approval gates remain separate from ADR acceptance.

Suggested ADR status values are `Proposed`, `Accepted`, `Rejected`, and `Superseded`. Use an actual ISO date (`YYYY-MM-DD`); leave unresolved decisions visibly pending. Never invent approval, a decision, or a date.

## Source and availability

The approved Rahrow MVP PRD & Technical Architecture v1.0, dated 27 Sep 2026, remains the primary product contract. It is not in this public repository. Request missing relevant requirements from Rahrow Lead and stop only dependent coding/review. Root `../../AGENTS.md` defines the full availability and classification rules.
