import io
import json
import struct
import unittest
import numpy as np
from compute import cluster, cluster_stream


def payload(points, dimensions):
    header = json.dumps(dict(algorithm='compact-medoid-v1', compactDistance=.2,
                            minSamples=5, dimensions=dimensions,
                            points=[{k: v for k, v in p.items() if k != 'vector'} for p in points])).encode()
    return struct.pack('<I', len(header)) + header + np.asarray([p['vector'] for p in points], dtype='<f8').tobytes()


class LargeClusterTests(unittest.TestCase):
    def test_stream_above_old_capacity_keeps_every_point_and_weight(self):
        points = [dict(text=f'tag-{i:05}', vector=[1., 0.], count=1) for i in range(10001)]
        body = payload(points, 2)
        result = cluster_stream(io.BytesIO(body), len(body))
        self.assertEqual(result['totalMass'], 10001)
        self.assertEqual(result['retainedCoverage'], 1)
        self.assertEqual(result['clusters'][0]['memberCount'], 10001)
        self.assertEqual(result['clusters'][0]['tags'][0]['text'], 'tag-00000')

    def test_binary_and_json_have_same_clusters_with_unicode_and_unequal_weights(self):
        rng = np.random.default_rng(432)
        points = [dict(text=f'{i:03}羽球', vector=rng.normal(size=8).tolist(), count=i % 7+1) for i in range(130)]
        body = payload(points, 8)
        binary = cluster_stream(io.BytesIO(body), len(body))
        ordinary = cluster(dict(points=points, algorithm='compact-medoid-v1', compactDistance=.2, minSamples=5))
        self.assertEqual(binary, ordinary)

    def test_stream_rejects_truncation_shape_duplicates_and_invalid_vectors(self):
        points = [dict(text='x', vector=[1., 0.], count=5)]
        body = payload(points, 2)
        for data, size in [(body[:-1], len(body)), (body, len(body)+8), (body[:3], 3)]:
            with self.assertRaises(ValueError):
                cluster_stream(io.BytesIO(data), size)
        for bad in [[points[0], points[0]], [dict(text='x', vector=[float('nan'), 0.], count=5)],
                    [dict(text='x', vector=[0., 0.], count=5)]]:
            data = payload(bad, 2)
            with self.assertRaises(ValueError):
                cluster_stream(io.BytesIO(data), len(data))
