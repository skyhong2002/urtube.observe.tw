# User's development instructions

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
- The active deployment uses both compose.local.yml and
  compose.production-data.yml. Its /data volume is urtube_urtube-data and has
  real, shared user data. Production owns worker and backup services.
- Do not use real user data as test fixtures or print credentials. Keep tests
  on their configured in-memory/temporary databases.

Original user instruction: 「只是之後撰寫前端時不要修改到後端，若有必要性需先告知理由讓我決定」
