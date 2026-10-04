# ADR-0002: Mobile OTP cookie transport and transactional session families

## Status and date

Accepted technical design within Ali's reviewed AUTH-02 plan, 2026-10-03. Implementation acceptance still requires independent QA and real CI evidence. [ADR-0001](ADR-0001-auth-security-persistence.md) remains the historical persistence decision.

## Context

The supplied PRD requires ordinary Mobile OTP, secure sessions/rotation/revocation/logout, abuse prevention, private account fields and PostgreSQL authority. Ali approved unified login/sign-up, profile-independent authentication/Dashboard access, independent OTP challenges and concurrent independent session families. AUTH-02 permits only Fake/local delivery and MOBILE_OTP issuance, with no schema expansion or production action.

## Decision

Use cookie-only persisted opaque tokens: Secure HttpOnly `__Host-rahrow_session`, SameSite=Lax, Path=/, no Domain. Require exact configured Origin, JSON and `X-Rahrow-Auth: 1` on all POSTs. GET self requires that header, validates supplied Origin and rejects cross-site Fetch Metadata. Explicit credentialed CORS has bounded methods/headers and no wildcard. Default proxy trust is false. Ordinary/capability guards share the cookie resolver, never Authorization-header fallback. All Auth responses are private/no-store. Explicit nonproduction loopback local mode may use the separate insecure local cookie.

Use fixed absolute session lifetime (default 12 hours), explicit rotation, no sliding GET renewal. Rotation and logout lock the immutable root of the existing rotatedFromId chain. Rotation revokes predecessor and creates one equal-expiry, equal-assurance successor. Logout from a known stale ancestor revokes every descendant in that family; either race order is safe. Independent logins create independent roots, with no global invalidation. A delayed response carrying an already revoked token cannot restore server authorization. Return cookies only after committed operations, never bearer JSON.

Use target advisory transaction locks for request cooldown/cap. Requests do not look up accounts or invalidate older challenges. Verify takes a challenge row lock and rechecks current time after waits. Wrong-attempt mutations commit before HTTP error; consume, conflict-safe find/create, session and audits commit atomically, with an expiry recheck after User uniqueness wait. Shared keyed rate admission commits separately and is not refunded. Bounded audits contain no raw PII or secrets.

Unconfigured is the default: no key/database startup requirement, auth503, root404 unchanged. Explicit local/test Fake requires nonproduction loopback binding/origins, uses an ephemeral private key and a bounded private in-process code recorder, and never reveals OTP through HTTP/logs/files. Test instances can inject one generated shared key. Restart invalidates local OTP MACs/rate namespaces; persisted sessions keep expiry/revocation semantics. Real provider configuration and production key lifecycle remain absent.

Delivery runs once within a bounded cancellation timeout inside request transaction. Delivery failure rolls back persistence; commit failure after delivery may leave an orphan unusable code. Do not automatically retry or claim exactly-once external SMS. A later real-provider task must review durable delivery/reliability; no outbox/migration is introduced now.

## Alternatives and consequences

- Browser-readable token storage/header transport increases bearer exposure and creates competing trusted sources; rejected for this cookie flow.
- SameSite alone does not provide the explicit login-CSRF boundary; combine Origin/custom-header enforcement with explicit CORS. See [OWASP custom-header CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi).
- Sliding refresh and remember-me would add lifetime semantics beyond the bounded task; omitted.
- Per-token logout can race with rotation and leave a valid child; common-root locking serializes both operations without a schema field.
- Single-device/global revocation conflicts with Ali's approved independent-family behavior; excluded.
- Account lookup before proof or new-user flags disclose unnecessary account state; omitted.

Costs include database transactions/locks, lineage traversal, fixed-window boundary bursts and intentionally nonproduction local key/delivery limitations. Atomic counters/cap/cooldown provide defense in depth; real PostgreSQL tests are required. PostgreSQL remains authoritative, the applied AUTH-01 migration stays byte-identical, and production deployment needs separate approval.

## Affected scope

Auth, bounded Users/Audit helpers, shared type-only API contracts, capability-guard transport, generated OpenAPI, local config and acceptance tests. See [AUTH-02](../auth-02.md) for exact endpoints/defaults and [open questions](../open-questions.md) for preserved minimum blocked product scopes.
