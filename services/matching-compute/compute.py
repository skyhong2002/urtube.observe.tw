"""Internal, stateless numeric service. Receives tag vectors, never raw histories."""
import json
import math
import os
import hmac
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


def cluster(data):
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
    a, b = unit_rows([c["centroid"] for c in left]), unit_rows([c["centroid"] for c in right])
    floor = float(data["similarityFloor"])
    if not 0 <= floor < 1:
        raise ValueError("Invalid similarity floor")
    kernel = np.clip((a @ b.T - floor) / (1 - floor), 0, 1)
    wa, wb = np.asarray([c["share"] for c in left]), np.asarray([c["share"] for c in right])
    if not np.isfinite(wa).all() or not np.isfinite(wb).all() or np.any(wa <= 0) or np.any(wb <= 0):
        raise ValueError("Invalid shares")
    if not math.isclose(float(wa.sum()), 1, abs_tol=1e-6) or not math.isclose(float(wb.sum()), 1, abs_tol=1e-6):
        raise ValueError("Shares must sum to one")
    n, m = len(left), len(right)
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
                 for i in range(n) for j in range(m) if flow[i,j] > 1e-9]
    transport.sort(key=lambda t: (-t["contribution"], t["left"], t["right"]))
    return {"score": float(np.clip(np.sum(flow*kernel), 0, 1)), "transport": transport}


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        token = os.environ.get("MATCHING_V3_COMPUTE_TOKEN", "")
        if not token or not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
            self.send_error(401)
            return
        try:
            size = int(self.headers.get("Content-Length", 0))
            if not 0 < size <= 256 * 1024 * 1024:
                raise ValueError("Invalid body length")
            data = json.loads(self.rfile.read(size))
            operation = {"/cluster": cluster, "/compare": compare}.get(self.path)
            if operation is None:
                self.send_error(404)
                return
            body = json.dumps(operation(data), allow_nan=False).encode()
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
