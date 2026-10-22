"""Synthetic capacity check; no database, network, or provider inputs.

Default preserves the original 52k x 768 clustered benchmark. For review:
  python benchmark_capacity.py --points 10000 --dimensions 128 --shape star
Use a separate process per case for meaningful peak RSS. Host timing is not
an assertion about the production container's capacity or latency.
"""
import argparse
import json
import resource
import struct
import tempfile
import time
import numpy as np
from compute import cluster_stream

parser = argparse.ArgumentParser()
parser.add_argument('--points', type=int, default=52000)
parser.add_argument('--dimensions', type=int, default=768)
parser.add_argument('--shape', choices=['clustered', 'sparse', 'dense', 'star'], default='clustered')
args = parser.parse_args()
n, dimensions = args.points, args.dimensions
if not 1 <= n <= 52000 or not 2 <= dimensions <= 768:
    parser.error('points must be 1..52000 and dimensions 2..768')
weights = [3 if args.shape == 'star' and i % 3 == 0 else 1 for i in range(n)]
metadata = json.dumps(dict(algorithm='compact-medoid-v1', compactDistance=.2,
                          minSamples=5, dimensions=dimensions,
                          points=[dict(text=f'tag-{i:06}', count=weights[i]) for i in range(n)])).encode()
rng = np.random.default_rng(772)
centers = rng.normal(size=((n + 2) // 3 if args.shape == 'star' else 12, dimensions))
centers /= np.linalg.norm(centers, axis=1)[:, None]
if args.shape == 'star':
    # Each isolated three-point star has support 5 at its center, but either
    # compatible pair weighs only 4. This exercises discarded candidates.
    tangents = rng.normal(size=centers.shape)
    tangents -= (tangents * centers).sum(axis=1)[:, None] * centers
    tangents /= np.linalg.norm(tangents, axis=1)[:, None]
with tempfile.TemporaryFile() as stream:
    stream.write(struct.pack('<I', len(metadata)))
    stream.write(metadata)
    for start in range(0, n, 128):
        indices = np.arange(start, min(start+128, n))
        if args.shape == 'sparse':
            vectors = rng.normal(size=(len(indices), dimensions))
        elif args.shape == 'dense':
            vectors = np.repeat(centers[:1], len(indices), axis=0)
        elif args.shape == 'star':
            angles = np.choose(indices % 3, [0., -.6, .6])
            vectors = centers[indices // 3] * np.cos(angles)[:, None] + tangents[indices // 3] * np.sin(angles)[:, None]
        else:
            vectors = centers[indices % len(centers)] + rng.normal(scale=.01, size=(len(indices), dimensions))
        stream.write(vectors.astype('<f8').tobytes())
    size = stream.tell()
    stream.seek(0)
    started = time.monotonic()
    result = cluster_stream(stream, size)
    assert result['totalMass'] == sum(weights)
    assert len(result['clusters']) <= 10
    if args.shape == 'clustered' and n == 52000:
        assert len(result['clusters']) == 10
        assert all(group['memberCount'] > 4000 for group in result['clusters'])
    print(json.dumps(dict(points=n, dimensions=dimensions, shape=args.shape, seed=772, payloadMiB=size/1024**2,
                          seconds=time.monotonic()-started, peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
                          clusters=len(result['clusters']), coverage=result['retainedCoverage'])), flush=True)
