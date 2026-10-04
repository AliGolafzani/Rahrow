# Product open questions

This is the canonical register for PRODUCT OPEN QUESTIONS. Ali is Product Owner and decides these questions. The register now has 25 OPEN and 1 DECIDED entries. AUTH-02 records Ali’s 2026-10-03 email decision and the settled authentication/Dashboard invariant without resolving remaining capability/profile gates.

Use exactly `OPEN`, `DECIDED`, or `SUPERSEDED` for Status. Keep IDs stable. Record Ali’s actual decision, its date, and source when decided; preserve history and reference a replacement when superseded. Do not infer an answer from examples, planned architecture, an ADR, or silence.

Only the listed affected scope is blocked by each unresolved question, once implementation is authorized. Independent authorized work can continue. The governance-only task does not authorize implementation.

## Sources and coverage

“PRD” means the approved Rahrow MVP PRD & Technical Architecture v1.0, dated 27 Sep 2026. It is not stored in this public repository; request relevant text from Rahrow Lead before dependent coding or review. Section references below are traceability, not substitutes for the source text. “Accepted requirement-classification report” refers to the accepted product/technical/detail reclassification, whose product subquestion IDs are retained here.

The six product topics explicitly listed in PRD §20 map as follows:

- Rating/Review eligibility (original OQ-03) → OQ-16B
- Forum/Q&A moderation and permissions (original OQ-04) → OQ-16A
- Initial Gamification formula and event-to-point mapping (original OQ-05) → OQ-16C
- Preview-to-Purchase and Blog-to-Purchase attribution windows → OQ-06
- Onboarding email requirement → OQ-07
- Step reset/reopen policy → OQ-08

The first three are consolidated with their expanded product questions from the accepted report so one decision does not have competing records. The report supplies 22 product subquestions; the three other explicit PRD topics bring the total to 25.

PRD §20 also lists payment-provider/callback/settlement, object-storage/SMS-provider contracts, and production hosting/topology. These are TECHNICAL DECISIONS, tracked in `project-state.md` and documented in ADRs only when material. They are intentionally absent from this product register. IMPLEMENTATION DETAILS belong in neither register. Escalate only an actual product tradeoff rather than relabeling an entire technical topic.

## Register

### OQ-06 Attribution windows

- **ID:** OQ-06
- **Area:** Attribution windows
- **Question:** What are the exact Preview-to-Purchase and Blog-to-Purchase attribution windows?
- **Affected scope:** Only the affected attribution configuration, conversion calculations, and their acceptance tests.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §20 (attribution windows), §10.1 and §11.1.

### OQ-07 Onboarding email

- **ID:** OQ-07
- **Area:** Onboarding email
- **Question:** Is email mandatory during onboarding, or requested later during profile completion without blocking onboarding?
- **Affected scope:** Email is requested later during profile completion. Initial OTP onboarding/authentication has no email requirement. Email verification and uniqueness behavior are not defined by this decision.
- **Owner:** Ali (Product Owner)
- **Status:** DECIDED
- **Decision:** Email is requested later during profile completion and is not mandatory for initial OTP onboarding/authentication.
- **Decision date:** 2026-10-03.
- **Source:** Ali’s AUTH-02 product decisions and reviewed implementation plan, 2026-10-03; PRD §20 and §6. Related: OQ-14A.
- **History:** Previously OPEN from PRD §20 because profile email collection was required but onboarding UX obligation was unresolved. This decision resolves that timing/requirement only.

### OQ-08 Step reset and reopen

- **ID:** OQ-08
- **Area:** Step reset and reopen
- **Question:** When may a user or admin reset or reopen a Step, and what approved transition and product effects should that action have?
- **Affected scope:** Only reset/reopen permissions, transition behavior, and dependent effects. Ordinary progress persistence remains in scope under the settled contract.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §20 (reset/reopen), §4.2 and §16. Related: OQ-10B, OQ-16C.

### OQ-10A Roadmap execution rules

- **ID:** OQ-10A
- **Area:** Roadmap execution rules
- **Question:** Which branches are required or optional, what prerequisite gating applies, may Steps be skipped, and are roadmap cycles permitted?
- **Affected scope:** Only the corresponding graph validation rules, navigation restrictions, and completion eligibility.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-10A; PRD §§4–5 and §17.

### OQ-10B Step and repeat completion

- **ID:** OQ-10B
- **Area:** Step and repeat completion
- **Question:** What counts as performing or completing a Step, and may a user earn another completion for the same Path?
- **Affected scope:** Only completion-trigger behavior and repeat-completion outcomes.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-10B; PRD §§4.2–4.3 and §16.

### OQ-11A Published changes and existing learners

- **ID:** OQ-11A
- **Area:** Published changes and existing learners
- **Question:** Do current learners follow a pinned Path version or the latest Path, and how do additions, deletions, reordering, or content changes affect saved progress?
- **Affected scope:** Only applying published-content changes to existing learners and the associated product rules for progress migration.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-11A; PRD §§4.1–4.3, §5 and §14.

### OQ-11B Archive and unpublish access

- **ID:** OQ-11B
- **Area:** Archive and unpublish access
- **Question:** What access do purchasers and the public retain after archive or unpublish, and which restore or republication transitions are permitted?
- **Affected scope:** Only archive/unpublish/restore behavior and its access effects. Preserve the settled purchase and historical-completion requirements while the specific interaction is resolved.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-11B; PRD §§4.1–4.3, §5 and §16.

### OQ-11C QC and publication authority

- **ID:** OQ-11C
- **Area:** QC and publication authority
- **Question:** Who may perform QC, approve publication, and publish, and must those responsibilities be separated?
- **Affected scope:** Only these permission assignments and publication-approval transitions. Internal QC and validation before publish are already required.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-11C; PRD §§3 and 5. Related: OQ-14A.

### OQ-12B Late and multiple payments

- **ID:** OQ-12B
- **Area:** Late and multiple payments
- **Question:** Is a late verified payment accepted after a failed attempt, and how do multiple successful attempts affect the customer’s order, money, and access?
- **Affected scope:** Only late-success and multiple-payment-attempt business outcomes. Verified-only unlock and prevention of duplicate entitlement remain settled invariants.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-12B; PRD §§8.1–8.2, §15 and §16.

### OQ-12D Refund eligibility and effects

- **ID:** OQ-12D
- **Area:** Refund eligibility and effects
- **Question:** How does approval relate to confirmed reimbursement; is access retained or revoked; what happens to progress, completion, rewards, and repurchase; and does eligibility use purchase-time or current refund policy?
- **Affected scope:** Only the listed refund eligibility and post-decision effects. Manual admin review and immutable refund history are already required.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-12D; PRD §8.4 and §16. Related: OQ-16C.

### OQ-12F Free Path participation

- **ID:** OQ-12F
- **Area:** Free Path participation
- **Question:** Does a free Path require explicit enrollment, or does participation begin with the first saved activity?
- **Affected scope:** Only free-Path enrollment/start behavior and enrollment-dependent metrics; not public free-content rendering or other already-defined access behavior.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-12F; PRD §§4.1–4.2, §8.1 and §10.1. Related: OQ-17A.

### OQ-13A Currency and monetary calculations

- **ID:** OQ-13A
- **Area:** Currency and monetary calculations
- **Question:** What currency/unit and financially observable rounding apply, how are discounts allocated across items, and how is the minimum eligible basket calculated?
- **Affected scope:** Only exact checkout totals, item receipts, and refund calculations.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-13A; PRD §§8.1, 8.3–8.4 and §14.

### OQ-13B Discount redemption outcomes

- **ID:** OQ-13B
- **Area:** Discount redemption outcomes
- **Question:** May discounts stack; when is usage reserved, consumed, or released; and what customer outcome applies when concurrent checkouts compete for the final permitted redemption?
- **Affected scope:** Only these discount eligibility, reservation, and redemption outcomes. Enforcement of the approved limits is an engineering obligation.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-13B; PRD §8.3 and §17.

### OQ-13C Cart and checkout edge cases

- **ID:** OQ-13C
- **Area:** Cart and checkout edge cases
- **Question:** How should already-owned, duplicate, or free items be handled; what happens at zero total; and what happens if a price changes between cart and payment?
- **Affected scope:** Only the corresponding cart and checkout cases.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-13C; PRD §§8.1–8.3.

### OQ-14A Capability assignments and profile gates

- **ID:** OQ-14A
- **Area:** Capability assignments and profile gates
- **Question:** Which unresolved capabilities are assigned to each actor, and which profile fields must be complete before specific user actions?
- **Affected scope:** Remaining capability assignments and action-specific profile-completion gates only. Authentication, account/session creation and Dashboard access are not profile-gated. Capability-based RBAC and admin password plus TOTP remain required.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Partial settled invariant: incomplete profiles must not block mobile OTP authentication, account/session creation or Dashboard access. Remaining capabilities and action-specific requirements are not decided.
- **Decision date:** Authentication/Dashboard invariant approved 2026-10-03 by Ali in AUTH-02; remaining question stays OPEN.
- **History:** Previously wholly OPEN; AUTH-02 settled only the named invariant and does not implement profile-completion UX or the permission matrix.
- **Source:** Accepted requirement-classification report, OQ-14A; PRD §§3, 6 and 12. Related: OQ-07, OQ-11C, OQ-16A, OQ-16B.

### OQ-15B Additional public exposure and search semantics

- **ID:** OQ-15B
- **Area:** Additional public exposure and search semantics
- **Question:** What additional information, beyond the already-defined public fields, may be exposed; and may protected Step body text influence public search matching/ranking without appearing in results?
- **Affected scope:** Only additional exposure and protected-text search semantics. Premium snippets/payload for unauthorized users are already prohibited and are not an option to approve.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-15B; PRD §§4.1–4.2, 6, 11.2–11.3 and 12.

### OQ-15D Completion sharing privacy

- **ID:** OQ-15D
- **Area:** Completion sharing privacy
- **Question:** Who can view a shared completion, which identity and completion details are visible, and what are the default visibility, opt-in, and revocation rules?
- **Affected scope:** Only public completion-sharing behavior. The existence of a shareable completion page and preserved historical completion records are already required.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-15D; PRD §4.3 and §14.

### OQ-16A Forum and Q&A rules

- **ID:** OQ-16A
- **Area:** Forum and Q&A rules
- **Question:** What discussion visibility and placement, reporting rights, editing/deletion powers, permission assignments, and moderation transitions apply?
- **Affected scope:** Only the corresponding community operations, visibility, and permissions. Login for writing and admin reporting/removal capabilities remain settled requirements.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §20 (Forum/Q&A moderation and permissions), §7.2, §3 and §16; accepted requirement-classification report, OQ-16A.

### OQ-16B Rating and review rules

- **ID:** OQ-16B
- **Area:** Rating and review rules
- **Question:** Who is eligible to review (for example, purchasers, activated users, or completers), and what rating scale, uniqueness, editing, publication, and moderation rules apply?
- **Affected scope:** Only review submission/mutation/publication and aggregate-score semantics. Public ratings must still derive from real data.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §20 (Rating/Review eligibility), §7.3 and §16; accepted requirement-classification report, OQ-16B.

### OQ-16C Gamification rules

- **ID:** OQ-16C
- **Area:** Gamification rules
- **Question:** What initial reward formula and event-to-point mapping apply; what happens on repeat completion, reset, or refund; and do rule changes have retroactive effects?
- **Affected scope:** Only reward issuance, reversal, and recalculation for these cases. Admin-configurable rules and no hard-coded UI scoring are already required.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §20 (initial Gamification formula), §7.4; accepted requirement-classification report, OQ-16C. Related: OQ-08, OQ-10B, OQ-12D.

### OQ-17A KPI and cohort meaning

- **ID:** OQ-17A
- **Area:** KPI and cohort meaning
- **Question:** Which accounts count as valid users; how are refunded sales, enrollment, free-Path activation, completion denominators, timing baselines, and branch funnels treated; and what precisely counts as stuck?
- **Affected scope:** Only each affected KPI calculation, cohort filter, and dashboard interpretation. Show the selected completion denominator explicitly once decided.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-17A; PRD §§9–10. Related: OQ-12F.

### OQ-17B Attribution and business-event counting

- **ID:** OQ-17B
- **Area:** Attribution and business-event counting
- **Question:** How are sessions attributed to accounts and conversions credited, and which repeated actions count as separate business events?
- **Affected scope:** Only the affected attribution and business-counting semantics; not deduplication of repeated delivery of the same event.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-17B; PRD §§10.1–10.2 and 11.1. Related: OQ-06.

### OQ-17E Analytics privacy and retention policy

- **ID:** OQ-17E
- **Area:** Analytics privacy and retention policy
- **Question:** What retention or identity-linking policy is approved where the choice materially changes privacy expectations or the available reporting window?
- **Affected scope:** Only the affected collection, linking, and retention policy. Physical retention enforcement remains engineering-owned after the policy is known.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-17E; PRD §§10.2 and 12.

### OQ-18A Outreach recipients and consent

- **ID:** OQ-18A
- **Area:** Outreach recipients and consent
- **Question:** Who may receive which messages, what consent/opt-out rules apply, and is the audience fixed at confirmation or reevaluated before delivery?
- **Affected scope:** Only recipient selection and sending under these rules. Reliable delivery mechanisms do not decide audience or consent policy.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-18A; PRD §9 and §12.

### OQ-18D Emergency Banner behavior

- **ID:** OQ-18D
- **Area:** Emergency Banner behavior
- **Question:** What are the Emergency Banner audience, duration, dismissal/reappearance rules, and guest read-state expectations?
- **Affected scope:** Only the corresponding banner visibility and persistence behaviors.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** Accepted requirement-classification report, OQ-18D; PRD §9 and §17.

### OQ-14D User account status lifecycle

- **ID:** OQ-14D
- **Area:** User account status
- **Question:** What does User.status mean, which values and transitions are valid, who may perform them, and what account-access effects follow?
- **Affected scope:** Only the status column/lifecycle and dependent access behavior. AUTH-01 intentionally omits the column, any default and status-dependent behavior; unrelated Auth/User/RBAC foundations continue. The PRD requires the concept eventually.
- **Owner:** Ali (Product Owner)
- **Status:** OPEN
- **Decision:** Not decided.
- **Decision date:** Not set.
- **Source:** PRD §14; Ali's AUTH-01 plan approval and binding refinement 1, 2026-10-03. Related: OQ-14A.
