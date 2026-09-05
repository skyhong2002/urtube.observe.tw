# Matching demo runbook

This runbook creates a disposable Alice/Bob environment for recording the
complete comparison and mutual-consent flow. Every title, channel, event, and
identity is synthetic. It binds to localhost only, writes databases under the
operating system's temporary directory, and deletes them on a clean shutdown.
It is not a production login mechanism.

## Start and reset

```sh
npm ci
npm run demo:matching
```

The command prints separate Alice, Bob and newcomer login URLs. Open each URL in a
different browser profile or private context so their `HttpOnly` session
cookies remain independent. Restarting the command creates new access URLs and
resets every request and connection. Set `DEMO_PORT` if port 4317 is occupied.

## Show first value and empty states

1. Open Alice's **Dashboard** before **Matches**. Show the private channel and
   viewing-time summary and switch time ranges. These are useful without
   another person; this synthetic fixture demonstrates the interaction, not
   a measured real-user outcome or a completed model run.
2. Open the **New member (no history)** login URL in a separate browser
   context. **Matches** shows the existing insufficient-data/processing
   message and a path back to the dashboard. This account has no fabricated
   history or matching projection, so no match percentage is shown.
3. Keep Alice's **Matches** open. In Bob's context, open **Account**, turn
   matching off and save. Reload Alice: the existing no-candidate state
   appears. Alice still has her own insights; an empty pool is not a failed
   import and the newcomer is not promoted into a fake candidate.
4. Open Alice's **Dashboard** again. Explain the return use: revisit after a
   new week of learning and compare recent ranges/topic trends. The fixture
   does not claim a populated AI trend or measured retention.
5. Restart the process to restore the Alice/Bob matching demonstration.

The [product pitch](pitch.md#first-users-first-value-and-return-use) names the
initial audience and cold-start proposal. Keep synthetic demonstration,
proposed recruitment and observed user outcomes separate when presenting.

## Recording sequence

1. Open Alice's URL and show the candidate directory.
2. Open Bob's basic profile from Alice's candidate card. Before friendship,
   there is no Blend link or percentage. A direct comparison URL redirects
   back to this gated profile.
3. Select **Add friend** as Alice. Reload the page and show that it says
   the friend invitation is pending without unlocking Blend.
4. Open Bob's URL in the other browser context, open Alice's profile, and
   select **Accept friend request**.
5. Reload both sides. Open the newly available Blend and show its percentages
   and shared content, then disconnect and confirm it returns to the gated profile.

This sequence uses private demo accounts. Current main also allows signed-in
members to Blend directly with a public profile, independently of matching
opt-in. Accepted friends can see Overview and Insights; History and Recap
remain owner/key-only. Keep the demo profiles private when recording withdrawal:
switching matching off does not change the separate public visibility setting.

## Record the privacy proof

Restart the demo first so no earlier relationship affects the clip. Keep
Alice's candidate directory open, then use Bob's **Account** page to turn
matching off. Reload Alice: Bob disappears immediately. A bookmarked Bob VS
address also loses access to Blend and redirects to the profile gate; any
earlier action token is invalidated server-side. This is the recommended 8–10 second trust clip.

Account deletion can be rehearsed in the same disposable environment: delete
Bob by retyping `bob-demo`, then confirm the Bob session no longer opens the
account page. Restart `npm run demo:matching` to recreate both users.

The automated counterpart is the test named `private candidates become friends
before Overview, Insights and Blend are available` in
[`tests/match-requests.test.ts`](../tests/match-requests.test.ts). It asserts
the two independent cookies, locked one-sided state, mutual unlock, disclosure
allowlist, unforgeable actions, and replayable withdrawal flow.

The lifecycle regression in
[`tests/privacy-lifecycle.test.ts`](../tests/privacy-lifecycle.test.ts) drives
the account UI and then verifies the registry and isolated archive. It proves
that opt-out removes the candidate, withdraws relationships, invalidates old
tokens, and blocks the comparison immediately; deletion removes Google
identity, session, matching projections, relationships, tokens, and the
per-user database file.

## Privacy check before using a recording

- Browser chrome must show `127.0.0.1`, never a real account or production
  session.
- The recording must not include the terminal lines containing the temporary
  access URLs.
- Inspect every frame for email addresses, cookies, tokens, real viewing
  history, or unrelated notifications before uploading.
