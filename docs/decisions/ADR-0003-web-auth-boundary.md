# ADR-0003: Same-origin web authentication and permitted return routing

## Status and date

Accepted technical design within Ali's approved AUTH-03 plan, 2026-10-05. Local implementation and verification do not authorize publication or deployment. See [AUTH-03](../auth-03.md) for acceptance status and [ADR-0002](ADR-0002-mobile-otp-http-sessions.md) for the unchanged backend boundary.

## Context

The supplied AUTH-03 requirements authorize a unified ordinary-user mobile authentication UI, cookie-only session transport, a minimal protected dashboard and safe return to an originally intended permitted internal destination. Profile completeness does not gate authentication or this destination. The backend remains authoritative for challenge independence, expiry, admission, sessions and capability authorization.

## Decision

Use five exact same-origin Next route-handler operations against one server-configured API origin. Require the browser's original custom header and exact configured web Origin for mutations; never manufacture a missing browser safeguard. Preserve cookie ambiguity and relevant Fetch Metadata, reject unsupported operations, bound request/response bodies and upstream timeouts, reject redirects, validate response shapes, and retain HttpOnly Set-Cookie flags. Do not forward Authorization or proxy-routing headers. Responses and private pages are no-store.

Server-rendered protected and authentication pages resolve sessions directly against the fixed API origin with the raw incoming cookie header and the required custom header. Do not loop through the public Next route handler. Pass only session expiry/state to client components, never bearer material or unnecessary private account fields. Invalid/expired sessions are guests; failed or malformed resolution is temporarily unavailable. GET never renews, and no periodic rotation is added. A valid POST `AUTH_UNAVAILABLE` envelope is conservatively treated as an uncertain mutation outcome, including a proxy failure after possible upstream commit; verification and rotation re-resolve the session instead of blindly replaying the mutation.

Use canonical route keys instead of general URL normalization for return destinations. A shared strict parser rejects encodings, whitespace, schemes, query/fragment ambiguity and traversal. The server permission registry contains only `/dashboard`, with session presence checked at the destination and again at `/auth/complete`. Future protected destinations require explicit permission predicates and independent authorization at their own page/data boundary. Unknown, unauthorized, malformed and auth-loop targets safely fall back to `/dashboard`.

Browser acceptance owns a Nest test instance and its existing Fake delivery provider in the same process. Only that test harness retrieves a code directly from the provider. There is no code-reveal HTTP endpoint, persistent OTP file or product UI flag. Live acceptance uses the existing proven-owned disposable PostgreSQL scope; a separate local contract-store mode is explicitly not persistence/concurrency acceptance.

## Alternatives and consequences

- A general reverse proxy or caller-selected upstream would expand SSRF and header-trust boundaries; rejected in favor of a small allowlist.
- Client-only route protection and general same-origin return URLs do not prove destination authorization; rejected.
- Middleware-only session enforcement may miss protected data/page boundaries; the protected page resolves its session directly.
- Browser-readable bearer persistence introduces another credential authority; excluded by the approved cookie-only model.
- Normalization of arbitrary URL encodings creates parser disagreements; canonical known route keys avoid that ambiguity. `/dashboard` is the only product destination authorized in this milestone.
- Hard replacement after authentication/logout reduces stale client routing-cache exposure. Focus/restoration revalidation handles existing tabs without broadcasting account data.

AUTH-02 intentionally uses the socket IP and does not trust forwarded headers. Therefore Next forwarding conservatively shares API IP rate-admission budgets across the proxy connection. No trust-proxy setting, limit or backend guard is changed. Production topology and per-client attribution remain a separate deployment dependency, not an implicit authorization to relax rate limits.

## Affected scope and exclusions

Next authentication pages/state/forwarding, minimal dashboard routing, development/test harness and browser CI. No backend domain behavior, schema/migration, real SMS, admin authentication, profile gate, permission matrix, full dashboard/landing or production deployment. Product decisions and the preserved OQ-07/OQ-14A/OQ-14D boundaries are recorded separately in [open questions](../open-questions.md).
