# FRONTEND instructions

Scope: `apps/web/` and its frontend implementation. Inherit the root `AGENTS.md`, including the PRD availability rule, classification model, minimum-affected-scope rule, approval gates, and test-before-DONE requirement. These instructions do not authorize creating the application or resolving missing product rules.

## Responsibilities and boundaries

- Implement the Next.js public, user, and admin surfaces against approved API contracts. Use the PRD's Next.js 16 and TypeScript baseline unless an authorized change supersedes it.
- Build the Visual Path Builder within its approved graph, branch/merge, preview, content, QC, and publication rules. Local validation supports usability; server validation and authorization remain mandatory. Missing graph or publication policy blocks only the dependent behavior.
- Use shared UI primitives where appropriate without duplicating business rules. Reuse existing design and component conventions when they exist; do not create an application or shared package merely because this instruction mentions it.
- Deliver responsive, mobile-first behavior with keyboard navigation, visible focus, semantic HTML, appropriate contrast, and meaningful alternative text. Test affected flows on the agreed device/browser baseline.
- Render public Path/Step/Blog metadata for the approved SEO/indexing contract, including relevant metadata, canonical URLs, sitemap, and structured data when in scope. Keep account/admin/private surfaces non-public or non-indexable as required.
- Consume versioned REST contracts through the API. Do not connect the browser directly to Meilisearch or providers for protected business operations. Surface backend outcomes accurately; do not infer success from a redirect or stale client state.
- Prevent premium/private data from entering unauthorized HTML, client bundles, serialized props, caches, search snippets, or error output. Client hiding is never an adequate security boundary.

## The client is not authoritative

The client is not authoritative for entitlement, payment verification, permission checks, or premium-data protection. Server decisions remain mandatory even when the UI hides an action, displays a role, caches access, validates a form, or returns from a provider.

Do not hard-code unresolved product rules, reward formulas, permissions, refund eligibility, completion policy, or attribution meaning in UI code. Request missing requirements through Rahrow Lead and block only affected behavior. Do not silently reinterpret the PRD or expand scope.

## Verification and reporting

Test loading, empty, error, unauthorized, and relevant interrupted/repeated navigation states; verify affected mobile/desktop, accessibility, SEO, and API-contract behavior. Include server-rendered/client-visible payload checks when premium protection is affected. Do not bypass failing tests or imply a client test proves server authorization. Report files/surfaces changed, sources used, exact test outcomes, and remaining scoped dependencies; update project state with verified facts.

Source boundaries: PRD §§2–7, 9, 11–13, 15, 17–18 and 22. These references do not substitute for the relevant PRD text in the task context.
