# PR #93–#96 integration

The user delegated completing and closing the four pending September PRs after their remaining backend changes were explained. Integration starts from main `fba076a`, preserving subsequent privacy, login, worker and read-pool changes.

- **#93:** Form error recovery, in-page draft protection, upload feedback, accessible status/focus, reduced-motion support, settings return locations, navigation timeout and weekly dependency updates are integrated. The existing CI security audit is retained with a full-history checkout.
- **#94:** Same-origin session writes, actual streaming byte limits, private response caching, allowlisted administrator status, minimal public health responses and remaining login validation are integrated. The newer per-tab OAuth transaction and off-thread upload parser are retained. Current production dependencies pass the audit; the obsolete lockfile is not restored.
- **#95:** Main already has its scoped capture reconciliation and candidate-ID Set. The newer TEMP covering lookup supersedes the proposed permanent index. No redundant schema migration is added. The independent full estimation oracle and synthetic benchmark are retained, including progress/day precision and persisted-data preservation.
- **#96:** Private watch history gains archive-wide title/channel search, Taipei date bounds and bidirectional keyset pagination. Queries use the current read-only pool; session/key access is checked again after the asynchronous read. The former client filter over the latest 100 rows is superseded by this searchable, paginated route. Public visitors and friends still cannot read private history.

No matching algorithm, processing schedule, API budget, source limit, cache compatibility ID or stored consent is changed. No production archive is used as a test fixture. No schema migration or reclassification is introduced.

## Local verification

- Node 22: TypeScript checking and **577 tests passed, zero failures/skips**, including real HTTP calls to a loopback synthetic Python numerical service.
- Python numerical service: **16 tests passed**. Release-manifest checks passed.
- Secret/history scan and production dependency audit passed with **zero known vulnerabilities**.
- Chromium against an in-memory synthetic preview: search, forward/back pagination, language preservation, empty/error states, settings persistence and focus, invalid uploads, Unicode display-name validation and unsaved-draft warnings passed. Layouts at **320, 390 and 1280 pixels** showed no horizontal overflow or page script errors.
- Archive benchmark: eight normal and two edge scenarios retained exact output equivalence; see `archive-performance-2026-09-19.md` for costs and limits.

The T3 preview rendered the History page but later lost its automation connection during clicks, so the interaction checks used local Playwright. No real Google sign-in or production upload was performed. CI/CD results and the deployed image/source verification belong in the PR closure records, after push.

During predeployment observation the existing app temporarily timed out even on loopback, then recovered (loopback `/healthz` 200 in 0.142 s; public 200 in 0.629 s). This PR integration does not establish resolution of the separate historical intermittent availability incident.

Independent review found and resolved a streamed-upload revocation race: matching refreshes its session/consent after buffering, and ingest revalidates its capture/admin token after each bounded read before parsing or writing. Seven additional synthetic cases cover independent session/consent revocation and token rotation on all five upload routes.
