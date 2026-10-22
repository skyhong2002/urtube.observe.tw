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

The command prints separate Alice, Bob, Carol and newcomer login URLs. Open each URL in a
different browser profile or private context so their `HttpOnly` session
cookies remain independent. Restarting the command creates new access URLs and
resets every request and connection. Set `DEMO_PORT` if port 4317 is occupied.

## Show v3 topic matching without API keys

The demo builds v3 genre profiles through the real worker pipeline with a
deterministic stand-in classifier, stand-in embeddings and an in-process
stand-in for the compute service (compact-medoid groups; comparison uses a
greedy transport approximation, not the production LP solver). No API key is
read or needed. Scores demonstrate the flow, not a model run.

1. As Alice, open **Matches → My topics → Music & learning**. Bob ranks first
   with a complete score; Carol follows with a provisional score because her
   history sync never completed.
2. Open **News**. The status box explains that the news video was recognized
   but has no original tags, so the genre is not scored (genres only; tags
   are never generated).
3. Send Bob a friend request, accept it from Bob's context and open **Blend**
   to show per-genre scores and shared keywords.

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
