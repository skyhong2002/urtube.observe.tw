import unittest
import numpy as np
from compute import cluster, compare


def build(points):
    return cluster(dict(points=points, algorithm='compact-medoid-v1', compactDistance=.12, minSamples=5))


def match(a,b):
    return compare(dict(left=a['clusters'],right=b['clusters'],algorithm='compact-medoid-v1',
                        leftCoverage=a['retainedCoverage'],rightCoverage=b['retainedCoverage'],similarityFloor=.7))


class CompactTests(unittest.TestCase):
    def test_chain_cannot_merge_distant_endpoints(self):
        pts=[dict(text=str(i),vector=[np.cos(t),np.sin(t)],count=5) for i,t in enumerate([0,.4,.8])]
        r=build(pts)
        self.assertEqual(len(r['clusters']),2)
        for g in r['clusters']:
            ids=[int(t['text']) for t in g['tags']]
            for i in ids:
                for j in ids:
                    self.assertGreaterEqual(np.dot(pts[i]['vector'],pts[j]['vector']),.88-1e-12)

    def test_unknown_mass_never_matches_or_renormalizes(self):
        r=build([dict(text=str(i),vector=v.tolist(),count=5) for i,v in enumerate(np.eye(15))])
        self.assertEqual(len(r['clusters']),10)
        self.assertAlmostEqual(r['retainedCoverage'],2/3)
        self.assertAlmostEqual(match(r,r)['score'],2/3)
        self.assertAlmostEqual(sum(t['mass'] for t in match(r,r)['transport']),2/3)

    def test_actual_representatives_override_identical_centroids(self):
        def profile(rep):return dict(clusters=[dict(centroid=[1,0],representative=rep,share=1)],retainedCoverage=1)
        a,b=profile([1,0]),profile([0,1])
        self.assertEqual(match(a,b)['score'],0)
        self.assertAlmostEqual(match(a,a)['score'],1)

    def test_distribution_and_order_invariance(self):
        vectors=[[1,.01,0],[1,.1,0],[1,-.1,0],[0,0,1]]
        def make(weights):return [dict(text=str(i),vector=v,count=w) for i,(v,w) in enumerate(zip(vectors,weights))]
        a,b=build(make([3,2,5,9])),build(make([1,2,1,100]))
        self.assertEqual(len(a['clusters']),2)
        self.assertEqual(len(b['clusters']),1)
        self.assertAlmostEqual(match(a,b)['score'],9/19)
        self.assertAlmostEqual(match(a,b)['score'],match(b,a)['score'])
        self.assertEqual(a,build(list(reversed(make([3,2,5,9])))))

    def test_empty_and_invalid(self):
        self.assertEqual(build([])['clusters'],[])
        with self.assertRaises(ValueError):build([dict(text='x',vector=[1,0],count=0)])

if __name__=='__main__':unittest.main()
