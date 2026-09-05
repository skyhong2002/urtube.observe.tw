from release import manifest

app, compute = "sha256:" + "a" * 64, "sha256:" + "b" * 64
services = manifest(app, compute)["services"]
assert len(services) == 7
assert all(services[name]["image"].endswith(app) for name in ("app", "ingest", "worker", "backup", "matching-worker"))
assert all(services[name]["image"].endswith(compute) for name in ("matching-compute", "matching-compare"))
for bad in ("latest", "sha256:", "sha256:" + "x" * 64):
    try:
        manifest(app, bad)
        raise AssertionError("mutable or invalid image must fail")
    except ValueError:
        pass
print("Release manifest checks passed")
