# Weighted personal interest groups (#46)

Implement the specified cosine weighted DBSCAN, not an algorithm comparison. Existing dependencies provide no weighted clustering; the reviewed JavaScript density-clustering API counts neighbors rather than sample weight. Keep the small deterministic weighted expansion in TypeScript instead of adding an unweighted dependency or another runtime.

1. Build bounded category samples from at most 2000 distinct recent videos. A video contributes one unit per category, divided among deduplicated labels. Keep at most 256 labels per category by support/key and expose dropped video/label/mass coverage.
2. Cluster with epsilon 0.2 and minimum weighted neighborhood support 3. Preserve core/border/noise, use fixed key ordering, require three distinct supporting videos, normalize weighted centroids and keep five groups by mass/key.
3. Store a versioned owner-only snapshot with exact input hash, coverage, model/tag/algorithm contracts and evidence. Query only 90-day current metadata/tag rows. Revalidate input on reads and recompute after expiration/import/deletion/version changes.
4. Run groups after embeddings, isolating partial failures from private classification. Keep all vectors and video evidence out of the registry until #47 defines the bounded public projection.
5. Verify separated/noise/weighted/repeated-video/multitag/core-border cases and deterministic caps. Test SQLite restart, invalidation and export. Run full checks and independent review before a stacked PR.
