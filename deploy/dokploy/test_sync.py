"""Tests for the Dokploy CD agent's pure planning logic (no Docker, no network)."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import sync  # noqa: E402

OLD = "ghcr.io/skyhong2002/urtube.observe.tw@sha256:" + "a" * 64
NEW = "ghcr.io/skyhong2002/urtube.observe.tw@sha256:" + "b" * 64
COMPUTE_OLD = "ghcr.io/skyhong2002/urtube-matching-compute:sm-cutover-1"
COMPUTE_NEW = "ghcr.io/skyhong2002/urtube-matching-compute@sha256:" + "c" * 64

COMPOSE = f"""# synthetic stack
services:
  app:
    image: {OLD}
    labels:
      - traefik.enable=true
    environment:
      image: not-a-service-image
  worker:
    image: ghcr.io/skyhong2002/urtube.observe.tw:sm-cutover-1
  matching-compute:
    image: {COMPUTE_OLD}
volumes:
  data:
    image: ignored-outside-services
"""


def manifest(**images):
    return {"services": {"tunnel": {"environment": {"TUNNEL_REGION": "us"}},
                         **{name: {"image": image, "environment": {"AI_MODEL": "sky-quality"}} for name, image in images.items()}}}


class PlanTest(unittest.TestCase):
    def test_reads_only_service_images(self):
        self.assertEqual(sync.compose_images(COMPOSE), {
            "app": OLD, "worker": "ghcr.io/skyhong2002/urtube.observe.tw:sm-cutover-1", "matching-compute": COMPUTE_OLD})

    def test_plans_only_changed_services_and_ignores_the_tunnel(self):
        result = sync.plan(manifest(app=OLD, worker=NEW, **{"matching-compute": COMPUTE_NEW}), COMPOSE)
        self.assertEqual(set(result.changes), {"worker", "matching-compute"})
        self.assertEqual(result.changes["worker"][1], NEW)

    def test_nothing_to_do_when_images_match(self):
        self.assertEqual(sync.plan(manifest(app=OLD), COMPOSE).changes, {})

    def test_rejects_unknown_services_and_unpinned_images(self):
        with self.assertRaises(sync.SyncError):
            sync.plan(manifest(api=NEW), COMPOSE)
        with self.assertRaises(sync.SyncError):
            sync.plan(manifest(app="ghcr.io/skyhong2002/urtube.observe.tw:latest"), COMPOSE)
        with self.assertRaises(sync.SyncError):
            sync.plan(manifest(app="docker.io/evil/urtube@sha256:" + "d" * 64), COMPOSE)

    def test_rewrite_changes_only_the_target_image_lines(self):
        changes = sync.plan(manifest(app=NEW, worker=NEW), COMPOSE).changes
        out = sync.rewrite(COMPOSE, changes)
        self.assertEqual(sync.compose_images(out)["app"], NEW)
        self.assertEqual(sync.compose_images(out)["worker"], NEW)
        self.assertEqual(sync.compose_images(out)["matching-compute"], COMPUTE_OLD)
        # Nested keys named "image" and blocks outside services are untouched.
        self.assertIn("      image: not-a-service-image", out)
        self.assertIn("    image: ignored-outside-services", out)
        self.assertEqual(len(out.splitlines()), len(COMPOSE.splitlines()))

    def test_rewrite_refuses_when_the_file_changed_underneath(self):
        with self.assertRaises(sync.SyncError):
            sync.rewrite(COMPOSE, {"app": ("ghcr.io/other@sha256:" + "e" * 64, NEW)})


class EnvTest(unittest.TestCase):
    def test_parse_env_ignores_comments_and_quotes(self):
        self.assertEqual(sync.parse_env("# c\nA=1\nB='two'\n\nC=\"x=y\"\n"), {"A": "1", "B": "two", "C": "x=y"})

    def test_reports_only_key_names_of_mismatched_values(self):
        files = {"app": {"AI_MODEL": "sky-quality"}, "worker": {"AI_MODEL": "secret-other-value"}}
        problems = sync.env_mismatches(manifest(app=OLD, worker=OLD), files)
        self.assertEqual(problems, ["worker.AI_MODEL"])
        self.assertNotIn("secret-other-value", " ".join(problems))

    def test_missing_env_file_is_a_mismatch_and_the_tunnel_is_ignored(self):
        self.assertEqual(sync.env_mismatches(manifest(app=OLD), {}), ["app.AI_MODEL"])


if __name__ == "__main__":
    unittest.main()
