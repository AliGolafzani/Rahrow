# AUTH-03 — User web authentication experience

## Scope and status

Current 2026-10-06 correction status is recorded in [project state](project-state.md#current-milestone). The initial implementation/publication and asset-availability statements below are historical; the approved mobile-entry contract in this document supersedes the original canonical-only UI rule.

**PARTIAL: local implementation and author offline/HTTP checks passed; independent review, browser/live/visual acceptance and publication remain gated.** Baseline is exact accepted main `f767de2ac08ed8e09ced3961c1c256a305858960`, verified before creating local branch `auth-03-web-auth-experience`. No AUTH-03 remote branch, PR, GitHub CI or production execution is implied by these local files.

Ali approved the implementation plan and active-challenge resend behavior on 2026-10-05. One Persian RTL mobile → OTP flow authenticates ordinary MOBILE_OTP users without distinguishing existing/new accounts. Profile completeness/email do not block authentication, sessions or `/dashboard`. OQ-07 remains DECIDED; OQ-14A/OQ-14D remain OPEN.

## Routes and trust boundaries

- `/` preserves the landing skeleton, adding only account navigation.
- `/login` resolves session before showing the unified form; an authenticated session goes to the permitted destination.
- `/auth/complete` re-resolves the actual cookie session and validates return routing server-side.
- `/dashboard` is only a minimal authenticated shell. Its own server boundary resolves session; unavailable service does not render authenticated content.
- `/api/v1/auth/[...operation]` allows only the five existing AUTH-02 operations/methods. It is not a general proxy.

Return targets must be single canonical internal route keys. This milestone registers only `/dashboard`. External/protocol-relative URLs, encoded or malformed values, duplicate parameters, queries/fragments, unknown/privileged destinations, auth pages and APIs fall back to `/dashboard`. Future routes require explicit server permission policies and destination-side authorization. A successful login alone grants no future privileged capability.

See [ADR-0003](decisions/ADR-0003-web-auth-boundary.md) for fixed-origin forwarding, direct server session reads, no-store and proxy-IP consequences. Backend [AUTH-02](auth-02.md) remains unchanged.

## Active challenge and retry behavior

Each successful request returns an independent challenge. The current page selects the newly returned challenge only after successful resend; it offers no previous-challenge selector or “use previous code” action. Failed resend preserves the current challenge and input. Older unexpired challenges are neither invalidated nor consumed by the frontend and can still succeed from another tab/device retaining their context.

Ali's approved 2026-10-06 mobile-entry correction allows exactly 11 ASCII digits beginning with `09`: `09121234567` becomes `+989121234567` before API submission. A separate frontend `normalizeMobileInput` helper trims surrounding whitespace only and otherwise accepts the unchanged canonical E.164 ASCII invariant, including non-Iranian numbers. Internal spaces, hyphens/parentheses, wrong local lengths/prefixes and Persian/Arabic digits are rejected without conversion. No other country inference is introduced. The 64-character input limit accommodates ordinary surrounding whitespace even around maximum-length canonical input. Label `شماره همراه`, placeholder `09121234567` and local-example help/error copy no longer require an Iranian user to type `+98`. Requests and `ActiveChallenge.mobile`, including resend and verification, carry only the accepted canonical value. Backend validation and all independent-challenge semantics remain unchanged. See the [approved product decision](open-questions.md#auth-03-approved-mobile-entry-correction). OTP input is a single labeled six-ASCII-digit field preserving leading zeroes. Values/challenge context are ephemeral and reset on guest refresh or mobile change; no local/session storage persistence. Countdown deadlines come from validated backend retry metadata and are presentation only. Expiry/admission/attempt outcome remains backend-authoritative.

Uncertain verification first re-resolves the session rather than automatically retrying a possibly committed mutation. A valid `AUTH_UNAVAILABLE` response to a POST is also uncertain: the forwarding layer may have lost an upstream response after commit. Verification and rotation therefore perform an authoritative session read before any further attempt. Logout becomes guest only after a confirmed successful response or later authoritative session resolution. Bootstrap distinguishes unknown, guest, authenticated, signing-out and temporarily-unavailable states. No background session renewal or periodic rotation is introduced.

## Local configuration and testing

Pass server-only `RAHROW_API_ORIGIN` and `RAHROW_WEB_ORIGIN` to the Next process. See `.env.example` for loopback examples. The exact web origin must also be allowed by AUTH-02; configuration failure is closed/unavailable. Do not prefix these settings with `NEXT_PUBLIC_`, derive them from Host headers, or use production credentials.

The ordinary backend remains unconfigured by default. Local Fake requires AUTH-02's existing explicit nonproduction loopback configuration. It has no production reveal endpoint or product OTP display. Browser automation owns the real Fake instance and retrieves deliveries directly in process; automatic traces, videos and OTP screenshots are disabled.

Commands:

- `npm run check`: existing aggregate plus focused web tests.
- `npm run test:web`: pure validators/state/routing and forwarding boundary tests.
- `npm run test:web:e2e:local`: local in-memory contract-store browser checks; not PostgreSQL acceptance.
- `npm run test:web:e2e`: browser acceptance with guarded disposable PostgreSQL, as placed in CI after AUTH-02 restart snapshot verification and before retained-empty reset.

Web typecheck/build/dev explicitly prepare the shared contract declarations, so a clean source checkout does not depend on prior API builds. Build the API/web and install the pinned browser runtime before browser checks. Real PostgreSQL acceptance must retain existing migration/replay/reset ownership checks and cleanup. No Docker installation or host-security alteration is authorized by this task.

## Visual and accessibility scope

Approved final board palette: Navy `#0E3556`, Orange `#F26722`, Cream `#FBF6EB`. Persian RTL editorial wayfinding layout uses restrained paper surfaces, hierarchy and directional/numbered cues, with a single-column mobile form and bounded desktop rail. Functional controls use measured accessible contrast rather than assuming orange/cream is sufficient.

The canonical corridor-perspective logo is not supplied as an isolated authorized production asset. Exact logo integration/visual acceptance remains blocked; no reconstructed mark or full private brand board is included. A reserved text placement does not claim logo completion.

Keyboard flow, focus visibility/transition, explicit labels/error association, status announcements, practical touch targets, reduced motion and mobile/tablet/desktop reflow are acceptance requirements. Automated browser checks supplement, not replace, manual visual and assistive-technology review.

## Deferred and acceptance limits

Real SMS, production deployment/keys, admin Password+TOTP, profile completion/email verification, User.status, permission matrix, logout-all-devices, full dashboard/landing and other product modules are excluded. Prisma schema/migrations and backend guards/rate limits remain unchanged. Existing development audit debt is not suppressed or represented as fixed.

The final local report must list executed results separately from blocked/not-run live PostgreSQL, independent review, exact logo and assistive-technology gates. Publication requires a separate approval after review.

## Author verification — 2026-10-05

- PASS: clean npm installation/dependency tree, Prisma validation/generation, full aggregate lint/typechecks/builds/OpenAPI freshness/tests. All 81 baseline tests plus 60 new web/fixture/actual-HTTP tests pass (141 total, zero failures/skips). `CI=true npm run test:web` also passes all 60.
- PASS: exact backend runtime/shared-contract/schema/migration source preservation, whitespace and relative documentation links, workflow YAML and 31 embedded Bash syntax checks. No GitHub run has executed for this local tree.
- PASS: runtime audit zero. Full audit remains non-gating FAIL with the unchanged 9 high development findings; no suppression or unrelated upgrade.
- PASS: final browser suite compiles and lists 27 scenarios. This is test-source verification only.
- BLOCKED: actual browser interaction, responsive visual/keyboard/reduced-motion observation and assistive-technology review. Installed Chromium stops on socket EPERM; official pinned headless-shell download fails on truncated non-ZIP data; the managed cloud browser explicitly blocks the loopback page. No restriction bypass was attempted.
- BLOCKED: live PostgreSQL browser acceptance and fresh 15 AUTH-01/21 AUTH-02 database checks in this executor. CI retains these gates; the in-memory contract store does not replace them.
- BLOCKED: canonical isolated logo integration. The board is not published or reconstructed.
- PENDING: independent frozen-snapshot review and Ali's later publication approval. No commit/remote branch/PR/merge/deployment is claimed.

Measured text contrasts: Navy/Cream 11.72:1; dark primary-button text/Orange 5.14:1; muted/Cream 5.67:1; error/Cream 7.07:1. Input placeholder uses the darker muted token. Disabled-control exemptions do not establish usability; browser visual verification is still required.

### Independent review corrections

The first local tree passed author checks with existing generated build outputs, but independent review exposed a cold-check declaration prerequisite: web typechecking consumed shared contract declarations before they had been built. Web build/typecheck/dev now explicitly prepare those declarations; the replacement code passed a fresh source-only clean install, Prisma validation/generation and full aggregate with no prior generated outputs. Independent replacement-tree signoff remains pending.

Independent security review also identified that a valid proxy `AUTH_UNAVAILABLE` envelope could hide a lost, possibly committed upstream mutation. The client now conservatively classifies that POST outcome as uncertain. Cross-layer regressions exercise the real client and forwarding boundary, the form recovery decision, and an authoritative session read without replaying verification/rotation. Browser source coverage additionally checks computed reduced-motion behavior and keyboard Tab order. These corrections do not change AUTH-02 contracts or prove blocked browser/live acceptance.
