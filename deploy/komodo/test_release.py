from release import manifest, rollout_limit

app, compute = "sha256:" + "a" * 64, "sha256:" + "b" * 64
services = manifest(app, compute)["services"]
assert len(services) == 7
assert all(services[name]["image"].endswith(app) for name in ("app", "ingest", "worker", "backup", "matching-worker"))
assert all(services[name]["image"].endswith(compute) for name in ("matching-compute", "matching-compare"))
assert rollout_limit() == 5000
for name in ("app", "ingest", "worker", "backup", "matching-worker"):
    assert services[name]["environment"] == {"MATCHING_V3_BACKFILL_VIDEO_LIMIT": "5000"}
for name in ("matching-compute", "matching-compare"):
    assert set(services[name]) == {"image"}
# The only rollout-managed setting is the source window; provider keys,
# concurrency, budgets, and cache namespaces remain host-owned.
assert all(set(value) <= {"image", "environment"} for value in services.values())
for bad in ("latest", "sha256:", "sha256:" + "x" * 64):
    try:
        manifest(app, bad)
        raise AssertionError("mutable or invalid image must fail")
    except ValueError:
        pass
print("Release manifest checks passed")
