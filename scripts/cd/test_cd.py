"""Synthetic CI gate checks. Never connects to a database or production host."""
import importlib.util
from pathlib import Path

spec = importlib.util.spec_from_file_location("cd", Path(__file__).with_name("urtube-cd.py"))
cd = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cd)
sha = "a" * 40
run = dict(head_sha=sha, head_branch="main", event="push", path=".github/workflows/check.yml", status="completed", conclusion="success")
assert cd.passed(sha, run)
for field, value in (("head_sha", "b" * 40), ("head_branch", "feature"), ("event", "pull_request"), ("path", ".github/workflows/other.yml"), ("status", "in_progress"), ("conclusion", "failure"), ("conclusion", "cancelled"), ("conclusion", None)):
    assert not cd.passed(sha, {**run, field: value}), (field, value)
assert not cd.passed("main", {**run, "head_sha": "main"})
assert not cd.passed(sha, {})
print("CD gate checks passed")

# Exercise persistent failure handling without invoking SSH, sudo, or the network.
import tempfile
from unittest.mock import patch
with tempfile.TemporaryDirectory() as directory:
    cd.STATE = Path(directory)
    cd.save({"deployed": "b" * 40})
    with patch("sys.argv", ["urtube-cd.py", "--deploy"]), patch.object(cd, "candidate", return_value=sha), patch.object(cd, "get_json", return_value={"object": {"sha": sha}}), patch.object(cd, "healthy"), patch.object(cd, "verify_source"), patch.object(cd.subprocess, "run", side_effect=RuntimeError("synthetic deployment failure")) as deploy:
        for _ in range(2):
            try:
                cd.main()
                raise AssertionError("failed deployment must block")
            except RuntimeError:
                pass
        assert deploy.call_count == 1
        assert cd.json.loads((cd.STATE / "state.json").read_text())["attempted"] == sha
    cd.save({"deployed": "b" * 40})
    with patch("sys.argv", ["urtube-cd.py", "--deploy"]), patch.object(cd, "candidate", return_value=sha), patch.object(cd, "get_json", return_value={"object": {"sha": sha}}), patch.object(cd, "healthy"), patch.object(cd, "verify_source"), patch.object(cd.subprocess, "run") as deploy:
        cd.main()
        cd.main()
        assert deploy.call_count == 3
        assert deploy.call_args_list[1].args[0][1:] == ["image", "prune", "--force", "--filter", "until=168h"]
        assert deploy.call_args_list[2].args[0][1:] == ["builder", "prune", "--force", "--filter", "until=168h", "--reserved-space", "2GB"]
        assert cd.json.loads((cd.STATE / "state.json").read_text()) == {"deployed": sha}
print("CD success and failure-state checks passed")

# Archive comparison detects changed or additional application code.
def archive_bytes(files):
    stream = cd.io.BytesIO()
    with cd.tarfile.open(fileobj=stream, mode="w") as archive:
        for name, content in files.items():
            member = cd.tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, cd.io.BytesIO(content))
    return stream.getvalue()
expected = cd.source_hashes(archive_bytes({"repo-sha/src/index.ts": b"safe"}), strip_root=True)
assert expected == cd.source_hashes(archive_bytes({"src/index.ts": b"safe"}))
assert expected != cd.source_hashes(archive_bytes({"src/index.ts": b"changed"}))
assert expected != cd.source_hashes(archive_bytes({"src/index.ts": b"safe", "src/extra.ts": b"extra"}))
with tempfile.TemporaryDirectory() as directory:
    cd.STATE = Path(directory)
    cd.save({"deployed": "b" * 40})
    with patch("sys.argv", ["urtube-cd.py", "--deploy"]), patch.object(cd, "candidate", return_value=sha), patch.object(cd, "get_json", return_value={"object": {"sha": sha}}), patch.object(cd, "healthy"), patch.object(cd, "verify_source", side_effect=RuntimeError("concurrent deployment")), patch.object(cd.subprocess, "run") as deploy:
        try:
            cd.main()
            raise AssertionError("source mismatch must block success and pruning")
        except RuntimeError:
            pass
        assert deploy.call_count == 1
        assert cd.json.loads((cd.STATE / "state.json").read_text())["attempted"] == sha
print("Source mismatch blocks deployment success and cache pruning")
