# Release security audit

Last verified: 2026-09-05 (Asia/Taipei).

The release audit is intentionally repeatable and uses synthetic identities
only. Never paste a production credential, cookie, email, or viewing record
into an issue, test fixture, screenshot, or command output.

## Repository and dependencies

```sh
npm run security:audit
npm run check
```

`security:audit` checks every tracked file and the complete reachable git
history for high-confidence private-key and provider-token formats. It also
rejects tracked `.env`, SQLite, private-key, and certificate files, then runs
the npm production dependency audit at `high` severity. Failures print file
names and categories only, never matched values.

Provider-side secret scanning remains enabled independently. If any real
credential is found, revoke or rotate it first; deleting the latest copy does
not make a credential safe again.

## Authorization and deletion regressions

The automated suite includes these release boundaries:

- [`tests/privacy.test.ts`](../tests/privacy.test.ts): encrypted searches,
  private dashboards, cross-user token rejection, aggregate-only public APIs,
  and browser security headers.
- [`tests/match-requests.test.ts`](../tests/match-requests.test.ts): scoped and
  expiring action tokens, forged response rejection, and consent-gated output.
- [`tests/privacy-lifecycle.test.ts`](../tests/privacy-lifecycle.test.ts):
  immediate matching opt-out plus complete account/session/identity/archive and
  derived-record deletion.
- [`tests/ingest.test.ts`](../tests/ingest.test.ts): missing, malformed, wrong,
  and cross-user ingest credentials are rejected.
- [`tests/user-export.test.ts`](../tests/user-export.test.ts): only the signed-in
  owner can export, and the export excludes credentials and other users' data.

## Production smoke check

After every deployment:

1. `/healthz` and `/readyz` must return 200.
2. An ingest POST without authorization must return 401.
3. Public HTML must not contain any configured server-side secret.
4. Container logs must not contain authorization headers, bearer tokens,
   cookie headers, email addresses, or private search-query fields.
5. Demo video and screenshots must be inspected frame by frame and must use
   the synthetic environment from the [demo runbook](demo-runbook.md).

Production checks compare values in memory and print only a pass/fail result.
Do not print `.env`, response bodies containing private data, or matching log
lines during the audit.
