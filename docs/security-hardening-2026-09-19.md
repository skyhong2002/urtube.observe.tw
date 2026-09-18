# Login, request and privacy hardening — 2026-09-19

This PR follows the audit with server-side changes on an isolated branch. It does not deploy, restart workers, read production archives, change provider concurrency/budgets, or invalidate classification caches.

## Changes

- Bind Google authorization callbacks to a ten-minute HttpOnly, SameSite=Lax browser cookie. HTTPS uses the host-only `__Host-` cookie prefix. Validate before consuming state or exchanging a code; clear matched flows on completion, cancellation and failure. The latest login started in a browser supersedes earlier tabs; an older tab must restart sign-in.
- Validate Google's issuer, client audience, authorized party when relevant, expiry and subject. Tokens are accepted only directly from Google's fixed HTTPS token endpoint, with redirects disabled. Exchange timeout is ten seconds; upstream error bodies are not echoed. Existing avatar fallback remains bounded separately.
- Normalize login continuation paths and reject redirects that would leave the site.
- Require exact Origin on browser writes, falling back only to same-origin Referer or `Sec-Fetch-Site: same-origin` when Origin is absent. Missing or opaque proof fails closed. The separately authenticated Bearer ingest API remains independent. Non-browser scripts targeting session endpoints must send the configured public Origin.
- Count upload bytes while reading, cancel over-limit streams and return 413 before parsing. Limits remain 100 MiB for ZIP, an additional 1 MiB multipart allowance, 16/96/256 KiB for capture/progress/history or backfill, 32 KiB for matching JSON, and 100,000 bytes for other browser writes. Declared Content-Length is never the sole protection.
- Prevent caching of personalized responses, authentication pages and errors/redirects. Explicitly covers pending signup identities and extension setup.
- Require the owner's session for `/status`. `/healthz` now returns only status/service; `/readyz` retains status and boolean checks, omitting archive counts, errors and detailed operational timestamps. Health probes keep 200/503 semantics.
- Replace archive aggregation in health probes with a small core-table read, retaining every user's readiness check and existing worker/backup freshness rules. This is a readability probe, not a full database integrity scan.
- Update Hono from 4.13.2 to 4.13.8, including the published fixes. Production npm audit reports zero known vulnerabilities at verification time.

## Validation

- TypeScript and 417 Node tests passed with an isolated local numerical service; none skipped.
- Added ten regression tests covering stream cancellation, false/missing lengths, unauthorized ingest, cross-origin and missing-origin writes, OAuth binding/replay/cancellation/expiry/multiple tabs, token claims and timeout, redirect normalization, private cache policy and operational-data disclosure.
- Existing browser route tests now explicitly model the Origin header sent by same-origin forms. Security tests use the raw app and exercise absent/foreign headers directly.
- Existing import, extension provisioning, session ownership, profile CSRF, private History/Recap, export, deletion and matching tests pass.
- Secret scanning and production dependency audit pass. No real user data or production Google credentials were used.

The callback cookie changes in-flight sign-ins: a login started before deployment must be restarted. Real Google login and a browser extension end-to-end test remain deployment smoke checks. Aggregate upload memory, concurrent requests and synchronous ZIP decompression still require separate capacity planning; byte limits alone do not eliminate those risks.
