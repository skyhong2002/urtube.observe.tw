import unittest
import numpy as np
from compute import cluster, compare


def points(weights):
    # Semantic fixture, not the illustrative arbitrary vectors in meeting notes.
    return [{"text": name, "vector": vector, "count": weight, "generatedCount": 0}
            for name, vector, weight in zip(["羽球", "籃球", "排球", "拳擊"],
                [[1, .01, 0], [1, .1, 0], [1, -.1, 0], [0, 0, 1]], weights)]


def build(weights):
    return cluster({"points": points(weights), "eps": .2, "minSamples": 5, "minShare": .05})


def score(a, b):
    return compare({"left": a["clusters"], "right": b["clusters"], "similarityFloor": .7})


class ComputeTests(unittest.TestCase):
    def test_distribution_not_max_similarity(self):
        a, b = build([3, 2, 5, 9]), build([1, 2, 1, 100])
        self.assertEqual(len(a["clusters"]), 2)
        self.assertEqual(len(b["clusters"]), 1)
        self.assertAlmostEqual(a["retainedCoverage"], 1)
        self.assertAlmostEqual(b["retainedCoverage"], 100/104)
        self.assertAlmostEqual(score(a, b)["score"], 9/19)
        self.assertAlmostEqual(score(a, b)["score"], score(b, a)["score"])
        self.assertAlmostEqual(score(a, a)["score"], 1)

    def test_transport_conserves_each_cluster_mass(self):
        a, b = build([3, 2, 5, 9]), build([10, 2, 1, 100])
        result = score(a, b)
        for side, profile in [("left", a), ("right", b)]:
            for i, group in enumerate(profile["clusters"]):
                self.assertAlmostEqual(sum(t["mass"] for t in result["transport"] if t[side] == i), group["share"])
        self.assertAlmostEqual(sum(t["contribution"] for t in result["transport"]), result["score"])

    def test_noise_and_single_repeated_tag(self):
        self.assertEqual(build([1, 1, 1, 1])["clusters"], [])
        result = cluster({"points": points([1, 1, 1, 5])[-1:], "eps": .2, "minSamples": 5, "minShare": .05})
        self.assertEqual(len(result["clusters"]), 1)

    def test_maximum_ten_and_coverage_not_renormalized_away(self):
        result = cluster({"points": [{"text": str(i), "vector": v.tolist(), "count": 5} for i, v in enumerate(np.eye(15))],
                          "eps": .2, "minSamples": 5, "minShare": 0})
        self.assertEqual(len(result["clusters"]), 10)
        self.assertAlmostEqual(result["retainedCoverage"], 10/15)
        self.assertAlmostEqual(sum(c["share"] for c in result["clusters"]), 1)

    def test_invalid_vectors_and_weights(self):
        for vector in [[0, 0], [float('nan'), 1]]:
            with self.assertRaises(ValueError):
                cluster({"points": [{"text": "x", "vector": vector, "count": 5}], "eps": .2, "minSamples": 5, "minShare": 0})
        with self.assertRaises(ValueError):
            compare({"left": [{"centroid": [1, 0], "share": .5}], "right": [{"centroid": [1, 0], "share": 1}], "similarityFloor": .7})

    def test_channel_histogram_intersection(self):
        def hist(weights):
            return {"clusters": [{"centroid": v.tolist(), "share": w} for v, w in zip(np.eye(2), weights)]}
        self.assertAlmostEqual(score(hist([.7, .3]), hist([.2, .8]))["score"], .5)


if __name__ == '__main__':
    unittest.main()
