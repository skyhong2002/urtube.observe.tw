# Profile editing

Signed-in owners can open `/account/profile` from their account page or their
profile. This replaces the previous display-name-only form. The editor follows
the existing English / Traditional Chinese language selection and dark theme.
It supports an independent display name (1–80 Unicode code points), a handle,
a plain-text multiline bio (300 code points), and up to five ordered links.
Link names allow 1–40 code points; URLs allow up to 2048 characters and must be
absolute HTTP(S) URLs without credentials. Emoji sequences containing multiple
code points count as multiple characters; both client and server use this rule.

## Migration and deployment

`UserRegistry` automatically adds `bio` (empty), `social_links` (`[]`), and
`storage_name` to existing registry databases and creates `handle_aliases`.
Existing filenames are copied from the current handle into `storage_name`;
no user database files move. Existing `key_seed`, user IDs, Google identities,
sessions and token hashes stay unchanged. No manual data conversion is needed.
The backup script now uses `storage_name` and can still read older registries.

Back up the registry and user databases before deployment. Deploy the web,
ingest, worker and backup processes together and restart them: older binaries
still derive filenames from handles and must not run once handle editing is
available. Rolling back to older binaries after a rename requires restoring a
matching pre-deployment backup or adapting those binaries to `storage_name`.

## Handle changes and privacy

Handles use the existing 2–32 character lowercase letter/digit/dot/dash format,
starting with a letter or digit. Application routes and service names are
reserved in `src/profile.ts`. Signup and editing share the same reservation
rules. Pre-existing reserved handles may be retained when editing other fields;
reserved application routes always take precedence over historical aliases.

Profile writes require a signed-in session and its form CSRF token. The server
chooses the user ID from the session, validates the complete form and commits
all changes and aliases in one SQLite immediate transaction. Account creation
also takes an immediate transaction so it cannot claim an alias concurrently.
Only a changed handle requires explicit URL-change acknowledgment.

Old profile URLs, their Insights/History/Recap/Tags subpages and `/u/` JSON URLs
resolve via the immutable user ID and redirect directly to the latest handle
with a non-cacheable 302. Valid dashboard keys are exchanged for an ID-based
HttpOnly cookie before redirection; old handle-based cookies remain accepted.
Aliases cannot be claimed by another account. Owners can reclaim their own old
handles; historical aliases remain reserved even if the account is deleted.

Profiles remain behind the existing dashboard public/private access checks.
Public visitors still receive aggregates only, with no additional history or
search access. Display names, bios and link names are HTML-escaped; bios render
with preserved line breaks. Empty bios and link lists produce no empty blocks.
The editor's link addition/removal/reordering and live counter require JavaScript,
as do the site's other interactive controls; the server validates every save.

## Validation

`npm run check` covers TypeScript and the complete test suite, including profile
ownership, CSRF, reserved/invalid/conflicting handles, atomic failed writes,
Unicode limits, unsafe links, ordered storage, escaping, private access,
redirects, tokens/sessions, migration/reopen, owner renames and renamed-user
backup/restore. Browser checks cover adding/reordering/removing links, cancel,
rename confirmation and save feedback in Chinese, English rendering, and mobile
and desktop layouts.

## Local interactive preview

Run `npm run dev:profile` and open
`http://127.0.0.1:4317/account/profile?lang=zh` on the same computer.
This loopback-only entrypoint signs requests in as an isolated test account;
it does not use Google login or the production account database. Changes persist
under the git-ignored `data/profile-preview/` directory, including handle edits.
Keep the command running while testing. This preview entrypoint must never be
used for deployment. To test with a real Google account locally, configure a
separate OAuth client/allowed localhost callback and run the ordinary app instead.

Integration with the current main branch preserves matching and friend access:
old Overview/Insights URLs honor friendship permissions, while History/Recap
still require owner/key access. The matching admin allowlist uses the frozen
`storage_name` identity so a profile rename cannot transfer or remove privileges.
Existing allowlist entries need no changes; keep their pre-rename identifiers.
