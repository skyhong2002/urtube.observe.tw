# Personal taxonomy v2 design

## Boundary

Personal Insights gets one governed taxonomy path. The shared matching taxonomy
remains separate. Legacy personal runs and assignments stay readable for audit
and rollback, but new work uses only the v2 contract.

## Responsibilities

- `personal-taxonomy.ts` owns readiness, deterministic sampling, fixed topics,
  classification decisions, and quality gates.
- `Repository` owns run records, assignments, evidence, activation, and rollback
  transactions.
- `ai.ts` sends public metadata and saves one primary result or `Unknown`.
- The normal Insights page shows broad results and honest range coverage.
- The signed-in account audit page shows run facts, bounded evidence, comparison,
  and explicit activate or rollback actions.

## Invariants

- No v2 run starts before the metadata readiness gate passes.
- Sampling spans time and frequency strata and caps each channel.
- Model, prompt, taxonomy, or metadata changes make an assignment stale.
- Low-confidence and insufficient results never enter known-topic totals.
- Activation is atomic and requires passed automatic gates plus owner review.
- Restarting the worker continues the same candidate run without duplicate rows.
