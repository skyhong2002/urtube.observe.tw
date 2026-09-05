"""Generate the atomic, immutable Compose image override published by CI."""
import json
import os
from pathlib import Path
import re


def manifest(app, compute):
    if not all(re.fullmatch(r"sha256:[0-9a-f]{64}", digest) for digest in (app, compute)):
        raise ValueError("Both images must have immutable SHA-256 digests")
    return {"services": {
        **{name: {"image": "ghcr.io/skyhong2002/urtube.observe.tw@" + app} for name in ("app", "ingest", "worker", "backup", "matching-worker")},
        **{name: {"image": "ghcr.io/skyhong2002/urtube-matching-compute@" + compute} for name in ("matching-compute", "matching-compare")},
    }}


if __name__ == "__main__":
    Path(__file__).with_name("images.json").write_text(json.dumps(manifest(os.environ["APP_DIGEST"], os.environ["COMPUTE_DIGEST"]), indent=2) + "\n")
