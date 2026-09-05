# User's development instructions

- On 2026-09-05 the user approved implementing the discussed matching v3
  backend on the current branch: fixed genres, tag embeddings, weighted
  clusters/distribution matching, factual explanations, and generated tags
  for videos without tags. This authorizes those backend code changes.
  The implementation defaults off; do not infer authorization to start an
  unbounded full-site Gemini backfill merely from front-end preview work.

- The current work is frontend development. Changes to HTML templates, CSS,
  layout, copy, and browser UI interactions are within that scope.
- Before changing backend behavior, explain the concrete reason and proposed
  change to the user and wait for their decision. This includes API contracts,
  authentication/authorization, database schema, queries, ingestion, workers,
  and matching/statistics algorithms. Some frontend templates share files with
  backend routes; permission depends on the behavior changed, not the filename.
- The user explicitly authorized the local app and ingest to share and write
  the live production database. This deployment connection is already approved;
  it does not authorize future backend code changes without discussion.
- The active development deployment now uses compose.local.yml,
  compose.production-data.yml, compose.matching-v3.yml, and
  compose.matching-v3-production-data.yml (in that order). Its /data volume
  is urtube_urtube-data and has real, shared user data. The user explicitly
  requested activation after configuring the Gemini key. The dev matching
  worker is active with daily call limits; production owns legacy worker
  and backup services. Preserve all four overlays when recreating dev app.
- Do not use real user data as test fixtures or print credentials. Keep tests
  on their configured in-memory/temporary databases.

Original user instruction: 「只是之後撰寫前端時不要修改到後端，若有必要性需先告知理由讓我決定」

- Latest authorization (2026-09-05): precompute all nine genres for ALL existing
  users without waiting for selections. The user explicitly requested full-site
  backfill and clarified observed RPM=1 was NOT a requested throttle. The dev
  deployment retains DAILY_API_CALLS=200 after automatic approval rejected an
  uncapped restart; raising the ceiling needs explicit cost approval. It uses cache and
  provider rate-limit backoff. Selection still controls matching disclosure.

- User subsequently explicitly approved temporarily lifting the API ceiling.
  The active backfill may use DAILY_API_CALLS=0. A session-authenticated admin
  monitoring page is authorized; admin handles are deployment allowlisted.

- Latest user instruction: new/unprocessed videos return genres only. All
  original tags feed Gemini and every assigned genre; no generated tags.
  Do not migrate/clear/reclassify existing caches. Preserve completed work;
  document possible future restoration of generation/per-tag assignment.

- User explicitly supplied a new OpenAI key and requested concurrency ceiling
  1500 with no additional RPM/daily/per-cycle quota. Matching uses the official
  OpenAI endpoint, gpt-5.6-luna low; secrets stay only in ignored env files.
  Keep prior classification cache namespace to avoid redoing completed data.

- User subsequently set concurrency to 5000 and explicitly requested concurrent
  batches within each account, removing sequential per-user API scheduling.
  All accounts share the 5000 execution ceiling, with no RPM/day/cycle quota.
  Preserve successful caches and wait for dispatched siblings before lease release.

- Latest requested concurrency ceiling: 10000. Keep all pending account batches eligible immediately, without a fixed send interval or additional RPM quota. Concurrency is simultaneous requests, distinct from observed requests per minute. Preserve provider error backoff and completed caches.

- User explicitly requires Gemini to have its own queue with no local concurrency cap. Keep provider 429 cooldown/retry; GPT retains its configured cap.

- On 2026-09-06 the user explicitly authorized resolving PR #61, merging it,
  and deploying the integration. If v3 conflicts with the existing discussion,
  that discussion takes precedence: named profiles, scores for every member,
  visible friendship requests, public direct Blend, friend Overview/Insights,
  and restricted History/Recap. Keep /matches as the canonical integrated UI.
  This integration does not request restarting backfills or changing API budgets.
