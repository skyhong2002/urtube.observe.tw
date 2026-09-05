# Watched-video popularity distributions (#50)

Assigned to TakalaWang and claimed before implementation. Work starts from current main independently of #44–#49, now assigned to Buffett111. #54–#55 belong to JacobLinCool; #3 has an existing claim. Remaining self-assigned scope is #33, #40, #41, #42, #50 and #51.

1. Reuse current public channel statistics and strict count parsing. Add video view-count snapshots, independent of the semantic metadata hash. Refresh watched IDs in batches of 50 with the existing limiter, at most once per 24 hours after successful refresh.
2. Add a separate worker statistics stage so refresh failures do not block classification. Align channel worker refresh with its existing daily page freshness.
3. Aggregate each identified watched video once in the selected range. Use five exact count buckets, retain unknown/hidden values in the denominator, and count unidentifiable events separately. Report coverage and snapshot dates.
4. Add two accessible horizontal distributions to Insights using the existing page style, with Traditional Chinese/English labels and honest empty/unknown states. No matching inputs or existing duration/Shorts calculations change.
5. Verify counts and boundaries, repeat-watch deduplication, hash stability, batched refresh, schema upgrade and stage isolation. Run full checks, browser desktop/mobile/keyboard QA and independent review, then open a PR.
