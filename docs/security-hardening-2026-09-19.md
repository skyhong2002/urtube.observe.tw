# Login, request and privacy hardening

PR #94 was reviewed against current `main` on 2026-10-22. The integration keeps the newer login binding, privacy defaults, consent checks, off-thread archive imports, bounded ZIP inflation and responsive readiness probes. It does not change matching algorithms, models, completed caches, worker schedules or provider budgets.

## Remaining protections integrated

- Browser writes require the configured exact `Origin`. Only when it is absent may a same-origin `Referer` or `Sec-Fetch-Site: same-origin` establish provenance. Opaque, conflicting, foreign and missing evidence fails with 403. The separately authenticated Bearer ingest app is independent. Scripts using session endpoints must send the configured public origin.
- Body limits count bytes even when `Content-Length` is absent, invalid or understated. Oversized streams are cancelled without waiting for the peer to acknowledge cancellation. Ingest and matching authenticate before buffering and revalidate credentials/current consent after the body arrives, so a slow stream cannot retain revoked access. Existing limits and error responses remain: 100 MiB ZIP plus 1 MiB framing for browser multipart uploads, 100,000-byte profiles, 1 MiB general site forms, 32 KiB matching requests, and 16/96/256 KiB capture/progress/history-or-backfill requests.
- Authentication, signup, account, extension setup, matching and operational endpoints use `Cache-Control: private, no-store`, including redirects and errors. Requests carrying session, pending-signup or dashboard cookies receive the same protection.
- `/status` requires a session whose immutable storage identity is in `MATCHING_V3_ADMIN_HANDLES`. An empty allowlist denies access, including to the default account. A renamed administrator retains their existing allowlisted identity.
- `/healthz` exposes only `status` and `service`; `/readyz` exposes only `status` and boolean `checks`. Their 200/503 rules, lightweight database probes, worker/backup freshness, matching worker and numeric-service checks remain unchanged. Archive counts, raw errors, queue details and operational timestamps are not public.
- Login continuation validation rejects paths that normalize into protocol-relative redirects, plus backslashes and raw control/space characters. Malformed Google response objects and non-string issuers fail closed without echoing token-exchange details.

## Newer main behavior retained

The old PR's single browser login cookie would invalidate other tabs. Current per-flow, ten-minute HttpOnly/SameSite=Lax cookies remain, with Secure on HTTPS, alongside single-use server state, OIDC nonce and issued-at validation. Fixed Google endpoints, redirect rejection, bounded token/UserInfo fetches and Google-first avatar fallback remain. No login-cookie rename is introduced by this integration.

The PR's database `checkReadable()` addition is superseded by current `ping()` probes. Its direct archive parsing is superseded by off-thread import with actual inflation limits. Its 100,000-byte general site limit is not carried over; current per-route limits remain. Dependency versions are handled by the parent integration, rather than restoring the PR's historical lockfile.

## Verification

The focused security run passed 41 tests with no skips: request-security unit/integration, login binding, body limits, ingest, HTTPS redirects, origin health and matching readiness. TypeScript checking passed. All fixtures use synthetic identities and in-memory/temporary databases; no production data or provider calls are required.

The route-level tests cover rejected consent changes and logout, missing/foreign origin proof, actual stream limits and cancellation, malformed identity claims, redirect normalization, pending-signup cache policy, admin allowlisting and public operational-data minimization. Existing readiness tests retain worker liveness and failure semantics.

Real Google sign-in and extension end-to-end checks remain deployment smoke checks. Per-request byte limits do not impose an aggregate upload-memory or concurrent-request capacity limit. Health consumers requiring operational details must use authorized monitoring instead of relying on removed public fields.
