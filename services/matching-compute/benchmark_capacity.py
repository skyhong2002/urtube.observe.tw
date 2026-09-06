"""Synthetic capacity check; no database, network, or provider inputs.

Run inside the numeric image with its production 2 GiB / 2 CPU limits.
"""
import json
import resource
import struct
import tempfile
import time
import numpy as np
from compute import cluster_stream

n, dimensions = 52000, 768
metadata = json.dumps(dict(algorithm='compact-medoid-v1', compactDistance=.2,
                          minSamples=5, dimensions=dimensions,
                          points=[dict(text=f'tag-{i:06}', count=1) for i in range(n)])).encode()
rng = np.random.default_rng(772)
centers = rng.normal(size=(12, dimensions))
centers /= np.linalg.norm(centers, axis=1)[:, None]
with tempfile.TemporaryFile() as stream:
    stream.write(struct.pack('<I', len(metadata)))
    stream.write(metadata)
    for start in range(0, n, 128):
        indices = np.arange(start, min(start+128, n))
        vectors = centers[indices % len(centers)] + rng.normal(scale=.01, size=(len(indices), dimensions))
        stream.write(vectors.astype('<f8').tobytes())
    size = stream.tell()
    stream.seek(0)
    started = time.monotonic()
    result = cluster_stream(stream, size)
    assert result['totalMass'] == n
    assert len(result['clusters']) == 10
    assert all(group['memberCount'] > 4000 for group in result['clusters'])
    print(json.dumps(dict(points=n, dimensions=dimensions, payloadMiB=size/1024**2,
                          seconds=time.monotonic()-started, peakRssMiB=resource.getrusage(resource.RUSAGE_SELF).ru_maxrss/1024,
                          clusters=len(result['clusters']), coverage=result['retainedCoverage'])), flush=True)
