# Personal taxonomy v2

Personal topics describe one archive's viewing mix. They never feed the shared
matching taxonomy.

## How it works

- New archives wait for at least 98% metadata coverage and 24 available watched
  videos. Migrated v1 archives remain on v1 until their signed-in owner starts
  a v2 candidate from `/account/taxonomy`; deployment never silently launches a
  full legacy-archive rebuild.
- A deterministic sample spans months and watch frequency. One channel may
  supply at most 5% of the 480-video sample.
- The upper structure is fixed at 12 broad subjects plus `Other` and `Unknown`.
- The model receives public title, channel, tags, and description only. It must
  return one primary topic and evidence copied from those fields.
- Confidence below 0.65 or missing evidence becomes `Unknown`. It is excluded
  from known-topic totals.
- A run needs 95% processed coverage, no more than 40% Unknown, no more than 30%
  low-confidence or ambiguous results, and at least 75% mean accepted confidence.

Model, prompt, taxonomy definition, and metadata hashes are part of freshness.
A change queues new classification instead of silently reusing old output.

## Review and rollback

Runs and assignments are retained. A passed candidate appears at
`/account/taxonomy`, where the owner can compare broad distributions, quality,
and at most two evidence videos per topic. Activation is one transaction and
requires explicit review. A previously active run can be restored from the same
page.

Database migration 11 adds run records, evidence, decision fields, and an
activation ledger. Existing taxonomy versions become `personal-generated-v1`.
The newest v1 stays active, so deploy rollback does not require data rollback.
Restarting the worker resumes the open candidate from stored assignments.
Each worker pass remains batch-limited. A candidate that became ready is
rechecked under the activation transaction, so later imports or metadata
changes reopen catch-up instead of activating stale quality results.

Public Insights shows processed, effective, and Unknown coverage. Topic ranking
stays hidden below 80% effective coverage. Trend charts follow the selected
range and let the reader switch between raw and smoothed shares.
