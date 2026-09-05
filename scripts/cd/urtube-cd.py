#!/usr/bin/env python3
"""Poll the public repository and deploy only a successful main push commit."""
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import time
import tarfile
from urllib.request import Request, urlopen

API = "https://api.github.com/repos/skyhong2002/urtube.observe.tw"
STATE = Path.home() / ".local/state/urtube-cd"


def get_json(url):
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "urtube-cd"})
    with urlopen(request, timeout=20) as response:
        return json.load(response)


def passed(sha, run):
    return bool(re.fullmatch(r"[0-9a-f]{40}", sha)) and all((
        run.get("head_sha") == sha,
        run.get("head_branch") == "main",
        run.get("event") == "push",
        run.get("path") == ".github/workflows/check.yml",
        run.get("status") == "completed",
        run.get("conclusion") == "success",
    ))


def candidate():
    sha = get_json(API + "/git/ref/heads/main")["object"]["sha"]
    runs = get_json(API + "/actions/workflows/check.yml/runs?branch=main&event=push&per_page=1")["workflow_runs"]
    return sha if runs and passed(sha, runs[0]) else None


def save(state):
    temporary = STATE / "state.tmp"
    temporary.write_text(json.dumps(state) + "\n")
    os.replace(temporary, STATE / "state.json")


def healthy():
    for attempt in range(12):
        try:
            for endpoint in ("healthz", "readyz"):
                with urlopen("https://urtube.observe.tw/" + endpoint, timeout=10) as response:
                    if response.status != 200:
                        raise RuntimeError("Unhealthy " + endpoint)
            return
        except Exception:
            if attempt == 11:
                raise
            time.sleep(10)


SOURCE_PATHS = ("src/", "scripts/", "public/landing/", "chrome-extension/")
SOURCE_FILES = {"package.json", "package-lock.json", "tsconfig.json", "favicon.svg", "og.png"}


def source_hashes(data, strip_root=False):
    with tarfile.open(fileobj=io.BytesIO(data)) as archive:
        hashes = {}
        for member in archive:
            name = member.name.partition("/")[2] if strip_root else member.name.removeprefix("./")
            if member.isfile() and (name in SOURCE_FILES or name.startswith(SOURCE_PATHS)):
                hashes[name] = hashlib.sha256(archive.extractfile(member).read()).hexdigest()
        if "src/index.ts" not in hashes:
            raise RuntimeError("Missing app source in archive")
        return hashes


def verify_source(sha):
    with urlopen("https://codeload.github.com/skyhong2002/urtube.observe.tw/tar.gz/" + sha, timeout=30) as response:
        expected = source_hashes(response.read(), strip_root=True)
    paths = [*SOURCE_PATHS, *sorted(SOURCE_FILES)]
    actual = subprocess.check_output([str(Path.home() / ".local/bin/docker"), "exec", "urtube-app", "tar", "-c", "-C", "/app", *paths], timeout=30)
    if source_hashes(actual) != expected:
        raise RuntimeError("Running app source differs from " + sha + "; possible concurrent deployment")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deploy", action="store_true", help="invoke the host deployment script; default is read-only")
    args = parser.parse_args()
    if not args.deploy:
        print("CI-approved main:", candidate() or "none")
        return
    STATE.mkdir(parents=True, exist_ok=True)
    with (STATE / "lock").open("w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        sha = candidate()
        if not sha:
            print("Current main has no completed successful Check push run; skipping.")
            return
        print("CI-approved main:", sha, flush=True)
        state = json.loads((STATE / "state.json").read_text())
        if not re.fullmatch(r"[0-9a-f]{40}", state.get("deployed", "")):
            raise RuntimeError("Initialize state with the verified running commit first")
        if state.get("attempted"):
            raise RuntimeError("Previous deployment needs operator inspection: " + state["attempted"])
        if state.get("deployed") == sha:
            return
        # Check main again immediately before dispatching the immutable SHA.
        if get_json(API + "/git/ref/heads/main")["object"]["sha"] != sha:
            print("Main advanced; waiting for the next tick.")
            return
        state["attempted"] = sha
        save(state)
        subprocess.run(["sudo", "-n", "-u", "deck", "/home/deck/urtube-ops/deploy.sh", sha], check=True, timeout=1800)
        healthy()
        verify_source(sha)
        save({"deployed": sha})
        print("Deployment command and public health checks succeeded:", sha, flush=True)
        docker = str(Path.home() / ".local/bin/docker")
        subprocess.run([docker, "image", "prune", "--force", "--filter", "until=168h"], check=True, timeout=300)
        subprocess.run([docker, "builder", "prune", "--force", "--filter", "until=168h", "--reserved-space", "2GB"], check=True, timeout=300)


if __name__ == "__main__":
    main()
