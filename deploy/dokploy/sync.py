#!/usr/bin/env python3
"""Continuous deployment of urtube onto the Dokploy stack on the production host.

GitHub Actions builds the images and commits their digests to
deploy/komodo/images.json on the `codex/production-images` branch (see
deploy/komodo/README.md). This agent runs from a systemd timer on the host:

1. Reads the branch head with `git ls-remote`; nothing to do if it is the one
   already deployed.
2. Downloads images.json pinned to that commit.
3. Refuses to continue if any environment value in the manifest differs from
   the stack's env files, so CD never changes configuration silently.
4. Backs up the compose file, rewrites only the `image:` lines of services
   whose image changed, pulls them, and recreates only those services with
   `docker compose up -d --no-deps --no-build --wait`.
5. Checks that every changed container runs the new image and is healthy and
   that the public /healthz answers 200. On any failure it restores the backup
   compose file, recreates the same services on their previous images and
   exits non-zero.

It never builds images, never touches volumes, env files or other stacks, and
skips a cycle while the host is overloaded. Python standard library only.
"""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

REPO_URL = "https://github.com/skyhong2002/urtube.observe.tw"
BRANCH = "codex/production-images"
MANIFEST_PATH = "deploy/komodo/images.json"
RAW_URL = "https://raw.githubusercontent.com/skyhong2002/urtube.observe.tw/{sha}/" + MANIFEST_PATH
STACK_DIR = Path("/etc/dokploy/compose/urtube-yeccgu")
PROJECT = "urtube-yeccgu"
STATE_DIR = Path("/var/lib/urtube-cd")
HEALTH_URL = "https://urtube.observe.tw/healthz"
# Manifest services that are not part of the Dokploy stack (the tunnel runs as
# a host service there).
IGNORED_SERVICES = {"tunnel"}
MAX_LOAD1 = 20.0
KEEP_BACKUPS = 10


class SyncError(RuntimeError):
    pass


@dataclass(frozen=True)
class Plan:
    changes: dict[str, tuple[str, str]]  # service -> (old image, new image)


def log(message: str) -> None:
    print(f"[urtube-cd {datetime.now(timezone.utc).strftime('%H:%M:%S')}] {message}", flush=True)


# ---------------------------------------------------------------- pure logic

def compose_images(compose_text: str) -> dict[str, str]:
    """Image of each service in a compose file (top-level `services:` block)."""
    images: dict[str, str] = {}
    service = None
    in_services = False
    for line in compose_text.splitlines():
        if re.match(r"^services:\s*$", line):
            in_services = True
            continue
        if in_services and re.match(r"^\S", line):
            in_services = False
        if not in_services:
            continue
        name = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line)
        if name:
            service = name.group(1)
            continue
        image = re.match(r"^    image:\s*(\S+)\s*$", line)
        if image and service:
            images[service] = image.group(1).strip("'\"")
    return images


def plan(manifest: dict, compose_text: str) -> Plan:
    current = compose_images(compose_text)
    changes: dict[str, tuple[str, str]] = {}
    for service, spec in sorted(manifest.get("services", {}).items()):
        if service in IGNORED_SERVICES:
            continue
        if service not in current:
            raise SyncError(f"manifest service {service!r} is not in the Dokploy stack")
        new = spec.get("image")
        if not new:
            continue
        if not re.fullmatch(r"ghcr\.io/skyhong2002/[a-z0-9._-]+@sha256:[0-9a-f]{64}", new):
            raise SyncError(f"refusing unpinned or foreign image for {service}: {new}")
        if current[service] != new:
            changes[service] = (current[service], new)
    return Plan(changes)


def parse_env(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def env_mismatches(manifest: dict, env_files: dict[str, dict[str, str]]) -> list[str]:
    """Manifest environment values that the stack's env files do not already hold.

    Only key names are reported, never values.
    """
    problems = []
    for service, spec in sorted(manifest.get("services", {}).items()):
        if service in IGNORED_SERVICES:
            continue
        env = env_files.get(service, {})
        for key, value in sorted((spec.get("environment") or {}).items()):
            if env.get(key) != str(value):
                problems.append(f"{service}.{key}")
    return problems


def rewrite(compose_text: str, changes: dict[str, tuple[str, str]]) -> str:
    """Replace only the image line of each changed service."""
    out = []
    service = None
    in_services = False
    done = set()
    for line in compose_text.splitlines(keepends=True):
        if re.match(r"^services:\s*$", line):
            in_services = True
        elif in_services and re.match(r"^\S", line):
            in_services = False
        name = re.match(r"^  ([A-Za-z0-9_.-]+):\s*$", line) if in_services else None
        if name:
            service = name.group(1)
        image = re.match(r"^(    image:\s*)(\S+)(\s*)$", line) if in_services else None
        if image and service in changes:
            old, new = changes[service]
            if image.group(2).strip("'\"") != old:
                raise SyncError(f"compose changed underneath for {service}")
            line = f"{image.group(1)}{new}{image.group(3)}"
            done.add(service)
        out.append(line)
    missing = set(changes) - done
    if missing:
        raise SyncError(f"could not rewrite image for {sorted(missing)}")
    return "".join(out)


# ------------------------------------------------------------- side effects

def run(args: list[str], *, check: bool = True, timeout: int = 900) -> subprocess.CompletedProcess:
    return subprocess.run(args, check=check, timeout=timeout, text=True, capture_output=True)


def compose_cmd(*args: str) -> list[str]:
    code = STACK_DIR / "code"
    return ["docker", "compose", "-p", PROJECT, "-f", str(code / "docker-compose.yml"),
            "--env-file", str(code / ".env"), *args]


def remote_head() -> str:
    out = run(["git", "ls-remote", REPO_URL, f"refs/heads/{BRANCH}"], timeout=60).stdout.split()
    if not out or not re.fullmatch(r"[0-9a-f]{40}", out[0]):
        raise SyncError("could not read the production-images branch head")
    return out[0]


def fetch_manifest(sha: str) -> dict:
    with urllib.request.urlopen(RAW_URL.format(sha=sha), timeout=30) as response:
        return json.loads(response.read().decode())


def read_env_files() -> dict[str, dict[str, str]]:
    files = {}
    for path in (STACK_DIR / "env").glob("*.env"):
        files[path.stem] = parse_env(path.read_text())
    return files


def container_state(service: str) -> tuple[str, str]:
    ids = run(compose_cmd("ps", "-q", service)).stdout.split()
    if not ids:
        return "", "missing"
    out = run(["docker", "inspect", "--format",
               "{{.Config.Image}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
               ids[0]]).stdout.strip()
    image, _, status = out.partition("|")
    return image, status


def public_health_ok(attempts: int = 30) -> bool:
    for _ in range(attempts):
        try:
            with urllib.request.urlopen(HEALTH_URL, timeout=10) as response:
                if response.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(3)
    return False


def recreate(services: list[str]) -> None:
    run(compose_cmd("up", "-d", "--no-deps", "--no-build", "--wait", "--wait-timeout", "300", *services), timeout=600)


def verify(changes: dict[str, tuple[str, str]]) -> list[str]:
    problems = []
    for service, (_, new) in changes.items():
        image, status = container_state(service)
        if image != new:
            problems.append(f"{service} runs {image or 'nothing'}")
        elif status not in ("healthy", "running"):
            problems.append(f"{service} is {status}")
    if not public_health_ok():
        problems.append("public /healthz did not answer 200")
    return problems


def prune_backups(code: Path) -> None:
    backups = sorted(code.glob("docker-compose.yml.cd-backup-*"))
    for old in backups[:-KEEP_BACKUPS]:
        old.unlink()


def write_state(state: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STATE_DIR / "state.json.tmp"
    tmp.write_text(json.dumps(state, indent=2) + "\n")
    tmp.replace(STATE_DIR / "state.json")


def read_state() -> dict:
    try:
        return json.loads((STATE_DIR / "state.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def sync(dry_run: bool = False, force: bool = False) -> int:
    load1 = os.getloadavg()[0]
    if load1 > MAX_LOAD1 and not force:
        log(f"host load {load1:.1f} > {MAX_LOAD1}; skipping this cycle")
        return 0
    state = read_state()
    head = remote_head()
    if head == state.get("deployedManifestCommit") and not force:
        return 0
    manifest = fetch_manifest(head)
    mismatches = env_mismatches(manifest, read_env_files())
    if mismatches:
        write_state({**state, "lastCheckedManifestCommit": head, "result": "blocked-env", "detail": mismatches,
                     "at": datetime.now(timezone.utc).isoformat()})
        raise SyncError(f"manifest environment differs from the stack env files: {', '.join(mismatches)}")
    code = STACK_DIR / "code"
    compose_path = code / "docker-compose.yml"
    original = compose_path.read_text()
    change_plan = plan(manifest, original)
    if not change_plan.changes:
        log(f"manifest {head[:7]} already deployed")
        write_state({"deployedManifestCommit": head, "result": "unchanged", "at": datetime.now(timezone.utc).isoformat()})
        return 0
    for service, (old, new) in change_plan.changes.items():
        log(f"{service}: {old} -> {new}")
    if dry_run:
        return 0
    services = sorted(change_plan.changes)
    backup = code / f"docker-compose.yml.cd-backup-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')}"
    shutil.copy2(compose_path, backup)
    try:
        for image in sorted({new for _, new in change_plan.changes.values()}):
            run(["docker", "pull", "-q", image], timeout=900)
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as error:
        backup.unlink(missing_ok=True)
        raise SyncError(f"image pull failed, nothing changed: {error}") from error
    compose_path.write_text(rewrite(original, change_plan.changes))
    problems: list[str]
    try:
        recreate(services)
        problems = verify(change_plan.changes)
    except Exception as error:  # noqa: BLE001 - any failure rolls back
        problems = [f"recreate failed: {error}"]
    if problems:
        log("deploy failed: " + "; ".join(problems) + " — rolling back")
        shutil.copy2(backup, compose_path)
        try:
            recreate(services)
        except Exception as error:  # noqa: BLE001
            problems.append(f"rollback recreate failed: {error}")
        write_state({**state, "lastCheckedManifestCommit": head, "result": "rolled-back", "detail": problems,
                     "at": datetime.now(timezone.utc).isoformat()})
        return 1
    prune_backups(code)
    write_state({"deployedManifestCommit": head, "result": "deployed", "services": services,
                 "previous": {s: old for s, (old, _) in change_plan.changes.items()},
                 "at": datetime.now(timezone.utc).isoformat()})
    log(f"deployed manifest {head[:7]} to {', '.join(services)}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="show the plan without changing anything")
    parser.add_argument("--force", action="store_true", help="ignore the load guard and the deployed-commit cache")
    args = parser.parse_args()
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    with open(STATE_DIR / "lock", "w") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            log("another sync is running")
            return 0
        try:
            return sync(dry_run=args.dry_run, force=args.force)
        except SyncError as error:
            log(f"refused: {error}")
            return 2


if __name__ == "__main__":
    sys.exit(main())
