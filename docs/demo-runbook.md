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

The command prints separate Alice and Bob login URLs. Open each URL in a
different browser profile or private context so their `HttpOnly` session
cookies remain independent. Restarting the command creates new access URLs and
resets every request and connection. Set `DEMO_PORT` if port 4317 is occupied.

## Recording sequence

1. Open Alice's URL and show the candidate directory.
2. Open Bob's VS page from Alice's candidate card. Before consent, show the
   rounded match/topic/channel percentages and broad topic ranks; do not show
   any single video, absolute count, or exact timestamp.
3. Select **Want to meet** as Alice. Reload the page and show that it says
   Alice wants to meet without unlocking the deeper comparison.
4. Open Bob's URL in the other browser context, open Alice's comparison, and
   select **Want to meet too**.
5. Reload both sides. Show the mutually unlocked comparison, then disconnect
   from either side and confirm it returns to the bounded state.

## Record the privacy proof

Restart the demo first so no earlier relationship affects the clip. Keep
Alice's candidate directory open, then use Bob's **Account** page to turn
matching off. Reload Alice: Bob disappears immediately. A bookmarked Bob VS
address also returns to the safe not-found page, and any earlier action token
is invalidated server-side. This is the recommended 8–10 second trust clip.

Account deletion can be rehearsed in the same disposable environment: delete
Bob by retyping `bob-demo`, then confirm the Bob session no longer opens the
account page. Restart `npm run demo:matching` to recreate both users.

The automated counterpart is the test named `candidate directory keeps every
relationship in one comparison-first flow` in
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
