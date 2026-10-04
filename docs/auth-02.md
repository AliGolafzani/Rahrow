# AUTH-02: Mobile OTP authentication orchestration

Scope approved by Ali on **2026-10-03**, from main `0f7675ea1dae20dbfd679a42f32ffd9ba3b3b00d`. Backend only; the existing ten models and applied migration are unchanged. [ADR-0002](decisions/ADR-0002-mobile-otp-http-sessions.md) records the technical transport and concurrency decisions. This document contains product decision summaries, not the private PRD or conversation.

## Approved product decisions

- One mobile login/sign-up flow. Only successful OTP proof may find or create a User. New users contain canonical mobile and technical identity/timestamps; all profile fields remain null, with no roles, permissions or status assigned.
- Incomplete profiles never block authentication, account/session creation or Dashboard access. AUTH-02 implements no Dashboard or profile UX.
- [OQ-07](open-questions.md#oq-07-onboarding-email) is DECIDED: email is requested later during profile completion. No email verification or uniqueness rule is introduced.
- OQ-14A remains OPEN for remaining capability assignments/action-specific gates; OQ-14D remains OPEN for status lifecycle/access effects.
- Independent challenges each have a unique ID, independently generated code, expiry, counters and consumed state. Request-again never invalidates older challenges. The active cap rejects new requests only. Independent six-digit random generation does not guarantee different numerical code values; the MAC binds every code to its challenge ID and target.
- Concurrent multi-device sessions are allowed. Every successful login creates an independent family. New login never revokes other families. Ordinary logout revokes only the presented session's family; logout-all-devices is excluded.

Decision owner/source: Ali's AUTH-02 task decisions, independent-challenge clarification and final plan/multi-device approval, 2026-10-03. These override the earlier unresolved email/onboarding scope while preserving unrelated open questions.

## API

All routes are under `/api/v1/auth`. The generated specification comes from real controller and DTO metadata via `npm run openapi:generate`; no documentation HTTP route is served.

| Method/path | Exact JSON input | Success |
| --- | --- | --- |
| POST `/otp/request` | `{ mobile }` | 202 `{ challengeId, expiresAt, retryAfterSeconds }` |
| POST `/otp/verify` | `{ challengeId, mobile, code }` | 200 `{ user, session: { expiresAt } }` and session cookie |
| GET `/session` | None | 200 same private self/session representation; no renewal |
| POST `/session/rotate` | `{}` | 200 `{ session: { expiresAt } }` and replacement cookie |
| POST `/logout` | `{}` | 204 and cleared cookie after successful family revocation |

Input is bounded and non-coercing; unexpected fields, arrays, invalid JSON and bodies over 4 KiB are rejected. Mobile is exactly `+` followed by a nonzero digit and digits, at most 15 digits. No trimming, default country or locale conversion. Code is exactly six ASCII digits, retaining leading zeroes. A challenge ID is a canonical UUID.

Public profile remains only `displayName` and `avatar`. Authenticated self explicitly selects `id`, `mobile`, `email`, `firstName`, `lastName`, `birthDate`, `displayName`, `avatar`; nullable fields remain null and birthDate is date-only `YYYY-MM-DD`. Server-only principal contains user ID, session ID and MOBILE_OTP assurance. No roles, permissions, status, credentials, digests, new-user flag, profile gate or redirect is returned. Shared contracts remain type-only.

Errors have `{ error: { code, message, correlationId, retryAfterSeconds? } }`. Codes are `AUTH_INVALID_INPUT` (400), `AUTH_REQUEST_FORBIDDEN` (403), `AUTH_THROTTLED` (429), `AUTH_OTP_INVALID/EXPIRED/EXHAUSTED/CONSUMED` (401), `AUTH_SESSION_INVALID/EXPIRED` (401), `AUTH_DELIVERY_UNAVAILABLE` or `AUTH_UNAVAILABLE` (503). Detailed OTP states require the correct challenge/target pairing. Unknown or mismatched targets receive generic invalid-OTP; request does not query account existence. Correlation IDs are server generated. SQL/provider diagnostics and inputs never enter the error envelope.

## HTTP security

Every POST requires JSON, `X-Rahrow-Auth: 1`, and an exact configured Origin, including login. Missing, null, malformed, duplicate or unapproved origins fail closed. GET requires the custom header, rejects disallowed supplied Origin and cross-site Fetch Metadata, while allowing absent Origin on same-origin fetches. Explicit CORS permits credentials and only configured origins, GET/POST and the required headers. No wildcard origin. Proxy trust is false; admission uses socket remoteAddress, never forwarded headers.

Auth responses and errors are private/no-store. A shared trusted cookie resolver serves ordinary and capability guards; Authorization headers and request-user claims cannot override persisted identity. Ambiguous duplicate session cookies are rejected.

Normal cookie: `__Host-rahrow_session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain. Bearers are never returned in JSON, URLs, request bodies or storage APIs. Internal result objects keep bearer values private/non-enumerable. Explicit local-cookie mode uses a separate `rahrow_local_session` without Secure and is rejected outside nonproduction loopback configuration.

Default session lifetime is a fixed 12 hours. Rotation revokes the previous session, issues one successor with unchanged expiry and MOBILE_OTP assurance, and only then sends a replacement cookie after commit. GET does not rotate. Failed rotation never clears a possibly newer cookie. Logout accepts known stale ancestors and revokes all their descendants under the same root lock. Either logout/rotation lock order leaves no valid successor. A delayed response may reinsert a revoked cookie in the browser; persisted authorization rejects it. Other independent login families are unaffected. Absent/unknown bearer logout is idempotent; database failure is 503 and never falsely acknowledged as success.

## Configuration and local harness

Default `AUTH_MODE=unconfigured` keeps no-database/no-key skeleton startup and root 404 intact. Auth calls fail closed with AUTH_UNAVAILABLE. Fake is never a fallback. Explicit `AUTH_MODE=local` or `test` requires nonproduction `NODE_ENV`, loopback `HOST` (`127.0.0.1`, `::1`, `localhost`) and `AUTH_ALLOWED_ORIGINS` containing exact loopback browser origins. Production Fake activation or unsafe local-cookie configuration fails startup with a sanitized error.

Set `AUTH_COOKIE_MODE=local` only for explicit loopback HTTP development; otherwise the cookie stays Secure. Runtime variables must be supplied externally; the Nest runtime does not automatically load the repository `.env`.

`AuthConfig` creates an ephemeral in-memory MAC key only on explicit local/test activation. It is never logged or persisted. Tests inject a runtime-generated shared key when proving shared multi-instance counters. Local restart invalidates outstanding OTPs and changes keyed rate namespaces; persisted session digests remain valid only until their own expiry/revocation. This is not production key management.

The Fake provider has a bounded private in-process recorder, accessible only through `FakeOtpDeliveryProvider.getDelivery(challengeId)` in a local harness/test. Its returned record exposes code/target getters intentionally to that harness but omits them from JSON and ordinary inspection. No OTP-reveal route, normal logging or code file exists. Codes remain random. Expired records are discarded; a full recorder rejects further delivery. Do not log or persist harness getters.

| Configuration | Default | Bounds |
| --- | --- | --- |
| `AUTH_OTP_LIFETIME_MS` | 300000 | 100–3600000 |
| `AUTH_OTP_ATTEMPT_LIMIT` | 5 | 1–20 |
| `AUTH_OTP_COOLDOWN_MS` | 60000 | 0–3600000 (zero only useful for isolated tests) |
| `AUTH_OTP_MAX_ACTIVE_CHALLENGES` | 5 | 1–100 |
| `AUTH_SESSION_LIFETIME_MS` | 43200000 | 100–604800000 |
| `AUTH_DELIVERY_TIMEOUT_MS` | 2000 | 1–10000 |

These are engineering limits, not additional product eligibility rules. Never reuse the Fake/local setup for a remotely accessible or production service.

## Transactions, admission and audit

OTP request takes a target-scoped PostgreSQL transaction lock, checks cooldown and active cap, stores only target digest and challenge-bound code MAC, invokes Fake delivery once within a bounded timeout, appends bounded audit and commits metadata. Active means unconsumed, unexpired and below failed-attempt limit. Cooldown still applies after consumption. Admission counters commit separately and are not refunded by provider, audit or business failure.

Verification locks the specified challenge, checks time after the lock, and only increments failed attempts for a matching target. Wrong-attempt counter/audit commit before the service throws its HTTP error. Successful consume, conflict-safe User insert/select, MOBILE_OTP session and audits share one transaction. Time is rechecked after uniqueness wait and before successful transaction return. Any persistence/audit/expiry failure rolls back all tentative success effects. No prior challenge or independent session is revoked by login.

| Boundary | Default keyed budgets |
| --- | --- |
| Request/re-request | target 3/15 min and 10/hour; IP 30/15 min and 100/hour |
| Verify | challenge 10/min; target 15/15 min; IP 100/15 min; plus five failed attempts/challenge |
| Self | session 120/min; IP 300/min |
| Rotate | stable family 6/min; IP 30/min |
| Logout | separate IP 60/min |

`AUTH_RATE_LIMITS` optionally supplies a JSON object with keys `requestTarget`, `requestIp`, `verifyChallenge`, `verifyTarget`, `verifyIp`, `selfSession`, `selfIp`, `rotateFamily`, `rotateIp`, `logoutIp`. Each maps to 1–4 `{limit, windowMs}` entries; limits are 1–10000 and windows 1000–86400000 ms. Omitted dimensions keep defaults. Configuration is copied/frozen; request input never selects limits. Defaults deliberately throttle target requests before the five-active cap is reached; the cap remains defense in depth for configured budgets and races. Bucket identifiers use domain-separated keyed digests, never raw mobile/IP. Backend limiter failure is 503; denial is 429 plus Retry-After. No admission is refunded.

Closed audit actions cover OTP requested/failed/consumed, User created and session issued/rotated/revoked, retaining existing role-assignment/removal actions. Only entity IDs, bounded counts/booleans, method/outcome and optional correlation ID are admitted. Pre-auth actor may be null. No arbitrary snapshots, raw mobile/IP, code, token or digest.

Delivery failure/timeout rolls back challenge and audit. Delivery success followed by commit failure can produce an unusable orphan code. There is no automatic delivery retry, exactly-once external-delivery claim or outbox/schema expansion. Real SMS needs a later reliability design.

## Verification and exclusions

`npm run check` preserves Foundation/AUTH-01 and adds HTTP/config/provider/orchestration regressions. `npm run test:auth:flow:db` is a deliberately guarded disposable-CI-only PostgreSQL runner alongside `test:auth:db`; it covers atomicity, failed attempts, shared counters, independent OTP/session families, expiry across lock/uniqueness waits, rollback, lineage races and restart state. [CI](ci.md) preserves fresh/retained-empty migration paths, exact schema/enum/migration snapshots, replay, same-cluster persistence and scoped always-cleanup. Offline tests do not prove those live database gates; see [project state](project-state.md) for observed outcomes.

The one AUTH-01 enumerable rotation-token fixture is narrowly changed to assert a token getter and no token in JSON/normal inspection, preserving rotation/assurance checks. Capability guard fixtures now use the shared cookie resolver. No security test is removed or skipped.

Excluded: real SMS, external account/credentials, frontend auth, profile UX, email verification/uniqueness, status lifecycle, permission matrix, admin Password+TOTP login/enrollment/recovery, logout-all, production key management/deployment, AUTH-03 and unrelated modules. Runtime audit remains a strict zero-finding gate; development advisories remain visible, never suppressed.
