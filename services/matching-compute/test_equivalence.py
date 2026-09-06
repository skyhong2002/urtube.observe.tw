"""Small synthetic oracle: preserve the original dense algorithm for parity."""
import unittest
import numpy as np
from compute import compact_cluster, unit_rows

def dense_reference(data):
    """Disjoint, diameter-bounded groups; compare actual tags, not broad means."""
    points = sorted(data["points"], key=lambda p: p["text"])
    if not points:
        return {"clusters": [], "totalMass": 0, "retainedCoverage": 0}
    if len(points) > 10000 or len({p["text"] for p in points}) != len(points):
        raise ValueError("Too many or duplicate tag points")
    x = unit_rows([p["vector"] for p in points])
    w = np.asarray([p["count"] for p in points], dtype=float)
    if not np.isfinite(w).all() or np.any(w < 1) or np.any(w != np.floor(w)):
        raise ValueError("Invalid counts")
    radius = float(data.get("compactDistance", .2))
    minimum = int(data["minSamples"])
    if not 0 < radius < 1 or not 1 <= minimum <= 1000:
        raise ValueError("Invalid compact settings")
    # Blocked similarities avoid an NxN float matrix. Boolean neighborhoods
    # cost at most 100 MB at the existing 10,000-tag bound.
    neighbors = np.empty((len(x), len(x)), dtype=bool)
    for start in range(0, len(x), 256):
        neighbors[start:start+256] = x[start:start+256] @ x.T >= 1-radius-1e-12
    active = np.ones(len(x), dtype=bool)
    groups = []
    total = float(w.sum())
    while active.any() and len(groups) < 10:
        support = neighbors @ (w * active)
        support[~active] = -1
        anchor = int(np.argmax(support))
        if support[anchor] < minimum:
            break
        candidates = np.where(active & neighbors[anchor])[0]
        ordered = sorted(candidates, key=lambda i: (-w[i], points[i]["text"]))
        members = [anchor]
        for i in ordered:
            if i != anchor and neighbors[i, members].all():
                members.append(i)
        ids = np.asarray(members)
        active[ids] = False
        mass = float(w[ids].sum())
        if mass < minimum:
            continue
        mean = np.average(x[ids], axis=0, weights=w[ids])
        # Weighted cosine medoid: a real member nearest the weighted mean.
        representative = int(ids[np.argmax(x[ids] @ mean)])
        tag_ids = [representative] + [i for i in sorted(ids, key=lambda i: (-w[i], points[i]["text"])) if i != representative]
        groups.append({"centroid": (mean / np.linalg.norm(mean)).tolist(),
                       "representative": x[representative].tolist(),
                       "mass": mass, "memberCount": len(ids),
                       "tags": [{"text": points[i]["text"], "count": int(w[i]),
                                 "generatedCount": int(points[i].get("generatedCount", 0))} for i in tag_ids[:5]]})
    groups.sort(key=lambda g: (-g["mass"], g["tags"][0]["text"]))
    retained = sum(g["mass"] for g in groups)
    for g in groups:
        g["share"] = g["mass"] / retained
    return {"clusters": groups, "totalMass": total, "retainedCoverage": retained / total}


class EquivalenceTests(unittest.TestCase):
    def test_packed_graph_preserves_dense_grouping_and_scores(self):
        rng = np.random.default_rng(8921)
        for radius in [.12, .2, .5]:
            vectors = rng.normal(size=(147, 7))
            points = [dict(text=f'tag-{i:03}', vector=v.tolist(), count=i % 9+1) for i, v in enumerate(vectors)]
            data = dict(points=points, compactDistance=radius, minSamples=5)
            actual, expected = compact_cluster(data), dense_reference(data)
            self.assertEqual(actual['totalMass'], expected['totalMass'])
            self.assertEqual(actual['retainedCoverage'], expected['retainedCoverage'])
            self.assertEqual(len(actual['clusters']), len(expected['clusters']))
            for a, b in zip(actual['clusters'], expected['clusters']):
                for field in ['tags', 'mass', 'memberCount', 'share']:
                    self.assertEqual(a[field], b[field])
                np.testing.assert_allclose(a['representative'], b['representative'], atol=1e-12)
                np.testing.assert_allclose(a['centroid'], b['centroid'], atol=1e-12)
