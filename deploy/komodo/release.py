"""Publish immutable images and the explicitly approved matching rollout limit."""
import json
import os
from pathlib import Path
import re


def rollout_limit():
    policy = json.loads(Path(__file__).with_name("matching-rollout.json").read_text())
    if set(policy) != {"backfillVideoLimit"}:
        raise ValueError("Unexpected matching rollout settings")
    limit = policy["backfillVideoLimit"]
    if type(limit) is not int or not 1 <= limit <= 1000000:
        raise ValueError("Invalid matching backfill limit")
    return limit


def manifest(app, compute):
    if not all(re.fullmatch(r"sha256:[0-9a-f]{64}", digest) for digest in (app, compute)):
        raise ValueError("Both images must have immutable SHA-256 digests")
    limit = rollout_limit()
    return {"services": {
        **{name: {"image": "ghcr.io/skyhong2002/urtube.observe.tw@" + app,
                  "environment": {"MATCHING_V3_BACKFILL_VIDEO_LIMIT": str(limit)}} for name in ("app", "ingest", "worker", "backup", "matching-worker")},
        **{name: {"image": "ghcr.io/skyhong2002/urtube-matching-compute@" + compute} for name in ("matching-compute", "matching-compare")},
    }}


if __name__ == "__main__":
    Path(__file__).with_name("images.json").write_text(json.dumps(manifest(os.environ["APP_DIGEST"], os.environ["COMPUTE_DIGEST"]), indent=2) + "\n")
