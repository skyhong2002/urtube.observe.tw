"""Internal, stateless numeric service. Receives tag vectors, never raw histories."""
import json
import math
import os
import hmac
import tempfile
import struct
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
from scipy.optimize import linprog
from sklearn.cluster import DBSCAN


def unit_rows(values):
    matrix = np.asarray(values, dtype=float)
    if matrix.ndim != 2 or not 1 <= matrix.shape[1] <= 3072 or not np.isfinite(matrix).all():
        raise ValueError("Invalid vectors")
    lengths = np.linalg.norm(matrix, axis=1)
    if np.any(lengths <= 1e-12):
        raise ValueError("Zero vector")
    return matrix / lengths[:, None]


def compact_cluster(data, vectors=None):
    """Disjoint, diameter-bounded groups; compare actual tags, not broad means."""
    points = data["points"] if vectors is not None else sorted(data["points"], key=lambda p: p["text"])
    if not points:
        return {"clusters": [], "totalMass": 0, "retainedCoverage": 0}
    if len(points) > 250000 or len({p["text"] for p in points}) != len(points):
        raise ValueError("Too many or duplicate tag points")
    x = vectors if vectors is not None else unit_rows([p["vector"] for p in points])
    w = np.asarray([p["count"] for p in points], dtype=float)
    if not np.isfinite(w).all() or np.any(w < 1) or np.any(w != np.floor(w)):
        raise ValueError("Invalid counts")
    radius = float(data.get("compactDistance", .2))
    minimum = int(data["minSamples"])
    if not 0 < radius < 1 or not 1 <= minimum <= 1000:
        raise ValueError("Invalid compact settings")
    # Bit-packed rows use one eighth of a boolean matrix. Spill to a temporary
    # file and scan bounded blocks so large graphs do not require resident N²
    # storage. The exact cosine threshold and deterministic ordering are intact.
    with tempfile.TemporaryFile() as graph_file:
        width = (len(x) + 7) // 8
        graph_file.truncate(len(x) * width)
        neighbors = np.memmap(graph_file, dtype=np.uint8, mode="r+", shape=(len(x), width))
        try:
            for start in range(0, len(x), 128):
                mask = x[start:start+128] @ x.T >= 1-radius-1e-12
                neighbors[start:start+128] = np.packbits(mask, axis=1, bitorder="little")
            return compact_groups(points, x, w, neighbors, minimum)
        finally:
            neighbors._mmap.close()


def compact_groups(points, x, w, neighbors, minimum):
    active = np.ones(len(x), dtype=bool)
    groups = []
    total = float(w.sum())
    while active.any() and len(groups) < 10:
        support = np.empty(len(x))
        for start in range(0, len(x), 128):
            rows = np.unpackbits(neighbors[start:start+128], axis=1, count=len(x), bitorder="little")
            support[start:start+128] = rows @ (w * active)
        support[~active] = -1
        anchor = int(np.argmax(support))
        if support[anchor] < minimum:
            break
        allowed = neighbors[anchor].copy()
        candidates = np.where(active & np.unpackbits(allowed, count=len(x), bitorder="little").astype(bool))[0]
        ordered = sorted(candidates, key=lambda i: (-w[i], points[i]["text"]))
        members = [anchor]
        for i in ordered:
            if i != anchor and allowed[i // 8] & (1 << (i % 8)):
                members.append(i)
                # Intersection implements the same all-members diameter check.
                allowed &= neighbors[i]
        ids = np.asarray(members)
        active[ids] = False
        mass = float(w[ids].sum())
        if mass < minimum:
            continue
        mean = np.zeros(x.shape[1])
        for start in range(0, len(ids), 128):
            batch = ids[start:start+128]
            mean += (x[batch] * w[batch, None]).sum(axis=0)
        mean /= mass
        # Weighted cosine medoid: a real member nearest the weighted mean.
        similarities = np.empty(len(ids))
        for start in range(0, len(ids), 128):
            similarities[start:start+128] = x[ids[start:start+128]] @ mean
        representative = int(ids[np.argmax(similarities)])
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


def cluster(data):
    if data.get("algorithm") == "compact-medoid-v1":
        return compact_cluster(data)
    points = data["points"]
    if not points:
        return {"clusters": [], "totalMass": 0, "retainedCoverage": 0}
    if len(points) > 10000 or len({p["text"] for p in points}) != len(points):
        raise ValueError("Too many or duplicate tag points")
    vectors = unit_rows([p["vector"] for p in points])
    weights = np.asarray([p["count"] for p in points], dtype=float)
    if not np.isfinite(weights).all() or np.any(weights < 1) or np.any(weights != np.floor(weights)):
        raise ValueError("Invalid distinct video counts")
    eps, minimum, min_share = float(data["eps"]), int(data["minSamples"]), float(data["minShare"])
    if not 0 < eps <= 1 or not 1 <= minimum <= 1000 or not 0 <= min_share <= 1:
        raise ValueError("Invalid clustering settings")
    labels = DBSCAN(eps=eps, min_samples=minimum, metric="cosine", algorithm="brute").fit_predict(vectors, sample_weight=weights)
    total = float(weights.sum())
    groups = []
    for label in sorted(set(labels) - {-1}):
        indices = np.where(labels == label)[0]
        mass = float(weights[indices].sum())
        if mass / total < min_share:
            continue
        centroid = np.average(vectors[indices], axis=0, weights=weights[indices])
        norm = float(np.linalg.norm(centroid))
        if norm <= 1e-12:
            continue
        tags = sorted(({
            "text": points[i]["text"], "count": int(weights[i]),
            "generatedCount": int(points[i].get("generatedCount", 0)),
        } for i in indices), key=lambda t: (-t["count"], t["text"]))[:5]
        groups.append({"centroid": (centroid / norm).tolist(), "mass": mass, "tags": tags})
    groups.sort(key=lambda g: (-g["mass"], g["tags"][0]["text"]))
    groups = groups[:10]
    retained = sum(g["mass"] for g in groups)
    for group in groups:
        group["share"] = group["mass"] / retained
    return {"clusters": groups, "totalMass": total, "retainedCoverage": retained / total}


def compare(data):
    left, right = data["left"], data["right"]
    if not left or not right:
        return {"score": 0, "transport": []}
    if len(left) > 10 or len(right) > 10:
        raise ValueError("Maximum ten clusters per genre")
    a, b = unit_rows([c.get("representative", c["centroid"]) for c in left]), unit_rows([c.get("representative", c["centroid"]) for c in right])
    floor = float(data["similarityFloor"])
    if not 0 <= floor < 1:
        raise ValueError("Invalid similarity floor")
    kernel = np.clip((a @ b.T - floor) / (1 - floor), 0, 1)
    wa, wb = np.asarray([c["share"] for c in left]), np.asarray([c["share"] for c in right])
    if not np.isfinite(wa).all() or not np.isfinite(wb).all() or np.any(wa <= 0) or np.any(wb <= 0):
        raise ValueError("Invalid shares")
    if not math.isclose(float(wa.sum()), 1, abs_tol=1e-6) or not math.isclose(float(wb.sum()), 1, abs_tol=1e-6):
        raise ValueError("Shares must sum to one")
    real_n, real_m = len(left), len(right)
    if data.get("algorithm") == "compact-medoid-v1":
        ca, cb = float(data["leftCoverage"]), float(data["rightCoverage"])
        if not 0 <= ca <= 1 or not 0 <= cb <= 1:
            raise ValueError("Invalid coverage")
        # Missing/noise mass has no similarity, even to other missing mass.
        wa, wb = np.r_[wa * ca, 1-ca], np.r_[wb * cb, 1-cb]
        kernel = np.pad(kernel, ((0, 1), (0, 1)))
    n, m = len(wa), len(wb)
    constraints = np.zeros((n + m, n * m))
    for i in range(n):
        constraints[i, i*m:(i+1)*m] = 1
    for j in range(m):
        constraints[n+j, j::m] = 1
    result = linprog((1-kernel).ravel(), A_eq=constraints, b_eq=np.r_[wa, wb], bounds=(0, None), method="highs")
    if not result.success:
        raise ValueError("Transport solver failed")
    flow = result.x.reshape(n, m)
    transport = [{"left": i, "right": j, "mass": float(flow[i,j]),
                  "similarity": float(kernel[i,j]), "contribution": float(flow[i,j]*kernel[i,j])}
                 for i in range(real_n) for j in range(real_m) if flow[i,j] > 1e-9]
    transport.sort(key=lambda t: (-t["contribution"], t["left"], t["right"]))
    return {"score": float(np.clip(np.sum(flow*kernel), 0, 1)), "transport": transport}


def read_exact(stream, size):
    value = stream.read(size)
    if len(value) != size:
        raise ValueError("Truncated compute request")
    return value


def cluster_stream(stream, size):
    """Length-prefixed JSON metadata followed by little-endian float64 rows."""
    if size < 4:
        raise ValueError("Invalid metadata length")
    header_size = struct.unpack("<I", read_exact(stream, 4))[0]
    if not 0 < header_size <= min(64 * 1024 * 1024, size - 4):
        raise ValueError("Invalid metadata length")
    data = json.loads(read_exact(stream, header_size))
    points, dimensions = data["points"], data["dimensions"]
    n = len(points)
    if not 1 <= n <= 250000 or not isinstance(dimensions, int) or not 1 <= dimensions <= 3072:
        raise ValueError("Invalid vector shape")
    if data.get("algorithm") != "compact-medoid-v1" or size != 4 + header_size + n * dimensions * 8:
        raise ValueError("Invalid vector payload")
    # The sender sorts metadata and corresponding vectors together. Reject
    # unsorted/duplicate input rather than silently misaligning vector rows.
    if any(points[i-1]["text"] >= points[i]["text"] for i in range(1, n)):
        raise ValueError("Unsorted tag points")
    with tempfile.TemporaryFile() as vector_file:
        vector_file.truncate(n * dimensions * 8)
        vectors = np.memmap(vector_file, dtype="<f8", mode="r+", shape=(n, dimensions))
        try:
            for start in range(0, n, 128):
                count = min(128, n-start)
                rows = np.frombuffer(read_exact(stream, count * dimensions * 8), dtype="<f8").reshape(count, dimensions)
                vectors[start:start+count] = unit_rows(rows)
            return compact_cluster(data, vectors)
        finally:
            vectors._mmap.close()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        token = os.environ.get("MATCHING_V3_COMPUTE_TOKEN", "")
        if not token or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
            self.send_error(401)
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            binary = self.path == "/cluster" and self.headers.get("Content-Type") == "application/x-urtube-vectors"
            if not 0 < size <= (6 * 1024**3 if binary else 256 * 1024**2):
                raise ValueError("Invalid body length")
            self.connection.settimeout(1800)
            data = None if binary else json.loads(read_exact(self.rfile, size))
            operation = {"/cluster": cluster, "/compare": compare}.get(self.path)
            if operation is None:
                self.send_error(404)
                return
            body = json.dumps(cluster_stream(self.rfile, size) if binary else operation(data), allow_nan=False).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, KeyError, TypeError):
            self.send_error(400, "Invalid compute request")

    def log_message(self, *_args):
        pass  # Do not log tag inputs or authorization headers.


if __name__ == "__main__":
    if len(os.environ.get("MATCHING_V3_COMPUTE_TOKEN", "")) < 32:
        raise RuntimeError("MATCHING_V3_COMPUTE_TOKEN must contain at least 32 characters")
    HTTPServer(("0.0.0.0", 8090), Handler).serve_forever()
