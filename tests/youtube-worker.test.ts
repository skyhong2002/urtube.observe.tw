import assert from 'node:assert/strict';
import test from 'node:test';
import type { Repository } from '../src/data/database.js';
import { UserRegistry, type User } from '../src/users.js';
import {
  runYoutubeWorkerCycle, youtubeRetryDelay, youtubeWorkerMadeProgress, youtubeWorkerShouldContinue, youtubeWorkPending,
  type YoutubeWorkerSteps,
} from '../src/youtube-worker.js';
import { classifyYoutubeVideosForMatching } from '../src/youtube/matching.js';

test('YouTube worker enriches every user while keeping portability owner-only', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const owner = registry.renameUser(registry.ensureDefaultUser().handle, 'renamed-owner');
    const alice = registry.createUser('alice', 'Alice');
    const bob = registry.createUser('bob', 'Bob');
    const calls: string[] = [];
    const step = (name: string) => async (_repository: Repository, user: User) => {
      calls.push(`${name}:${user.handle}`);
      return 1;
    };
    const steps: YoutubeWorkerSteps = {
      portability: async (_repository, user) => {
        calls.push(`portability:${user.handle}`);
        return 'idle';
      },
      metadata: step('metadata'),
      channelMetadata: step('channels'),
      matchingClassification: step('matching'),
      classification: step('classification'),
    };

    const results = await runYoutubeWorkerCycle(registry, steps);

    assert.deepEqual(results.map((result) => result.user), [owner.handle, alice.handle, bob.handle]);
    assert.deepEqual(calls.filter((call) => call.startsWith('portability:')), [`portability:${owner.handle}`]);
    for (const user of [owner.handle, alice.handle, bob.handle]) {
      assert.deepEqual(calls.filter((call) => call.endsWith(`:${user}`)), [
        ...(user === owner.handle ? [`portability:${user}`] : []),
        `metadata:${user}`,
        `channels:${user}`,
        `matching:${user}`,
        `classification:${user}`,
      ]);
    }
    assert.ok(results.every((result) => result.portability === (result.user === owner.handle ? 'idle' : 'not_applicable')));
  } finally {
    registry.close();
  }
});

test('YouTube worker starts independent user archives concurrently', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.ensureDefaultUser();
    registry.createUser('alice', 'Alice');
    registry.createUser('bob', 'Bob');
    let active = 0;
    let peak = 0;
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle',
      metadata: async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active--;
        return 1;
      },
      channelMetadata: async () => 0,
      matchingClassification: async () => 0,
      classification: async () => 0,
    };

    const results = await runYoutubeWorkerCycle(registry, steps);

    assert.equal(peak, 3);
    assert.deepEqual(results.map((result) => result.user), ['sky', 'alice', 'bob']);
    assert.equal(youtubeWorkerMadeProgress(results), true);
    assert.equal(youtubeWorkerMadeProgress(results.map((result) => ({ ...result, metadata: 0 }))), false);
    assert.equal(youtubeWorkerShouldContinue(results, true), true);
    assert.equal(youtubeWorkerShouldContinue(results, false), false);
  } finally {
    registry.close();
  }
});

test('one user failure is recorded without preventing later users from running', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    registry.ensureDefaultUser();
    const alice = registry.createUser('alice', 'Alice');
    const bob = registry.createUser('bob', 'Bob');
    const classified: string[] = [];
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle',
      metadata: async (_repository, user) => {
        if (user.handle === alice.handle) throw new Error('alice metadata failed');
        return 0;
      },
      channelMetadata: async () => 0,
      matchingClassification: async () => 0,
      classification: async (_repository, user) => {
        classified.push(user.handle);
        return user.handle === bob.handle ? 1 : 0;
      },
    };

    const results = await runYoutubeWorkerCycle(registry, steps);

    assert.match(results.find((result) => result.user === alice.handle)?.error ?? '', /alice metadata failed/);
    assert.ok(classified.includes(bob.handle));
    assert.equal(youtubeWorkerShouldContinue(results, true), true);
    assert.match(registry.repositoryFor(alice).youtubeSyncState('last_error') ?? '', /alice metadata failed/);
    assert.equal(registry.repositoryFor(bob).youtubeSyncState('last_error'), '');
  } finally {
    registry.close();
  }
});

test('canonical matching catch-up remains actionable when private AI topics are disabled', () => {
  const registry = new UserRegistry(':memory:');
  try {
    const user = registry.createUser('matching', 'Matching');
    const repository = registry.repositoryFor(user);
    repository.upsertYoutubeVideoMetadata([{
      videoId: 'MATCHWORK01', title: 'Public fixture', channelId: null, channelTitle: null,
      description: '', tags: [], thumbnailUrl: '', durationSeconds: 60,
      publishedAt: null, categoryId: '27', availability: 'available', metadataHash: 'v1',
    }]);
    assert.equal(youtubeWorkPending(registry, { metadata: false, topics: false }), true);
    assert.equal(classifyYoutubeVideosForMatching(repository), 1);
    assert.equal(youtubeWorkPending(registry, { metadata: false, topics: false }), false);
  } finally {
    registry.close();
  }
});


test('failed accounts retry after their own backoff while another account is still running', async () => {
  const registry = new UserRegistry(':memory:');
  let release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  try {
    const a = registry.createUser('retry-a','Retry A');
    const b = registry.createUser('retry-b','Retry B');
    const activeUsers = new Set<number>();
    let attempts = 0;
    const steps: YoutubeWorkerSteps = {
      portability: async () => 'idle', metadata: async () => 0, channelMetadata: async () => 0,
      matchingClassification: async () => 0,
      classification: async (_repo, user) => {
        if (user.id === b.id) { await slow; return 0; }
        if (++attempts === 1) throw new Error('Invalid model output');
        return 1;
      },
    };
    const first = runYoutubeWorkerCycle(registry, steps, () => new Date(100000), {activeUsers});
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(activeUsers.has(b.id), true);
    assert.equal(registry.repositoryFor(a).youtubeSyncState('worker_retry_at'), '130000');
    await runYoutubeWorkerCycle(registry, steps, () => new Date(129999), {userIds:[a.id],activeUsers});
    assert.equal(attempts, 1);
    const result = await runYoutubeWorkerCycle(registry, steps, () => new Date(130000), {userIds:[a.id,b.id],activeUsers});
    assert.equal(result.find(r => r.user === a.handle)?.classified, 1);
    assert.equal(activeUsers.has(b.id), true, 'no duplicate run or wait for the slow account');
    assert.equal(registry.repositoryFor(a).youtubeSyncState('worker_retry_at'), '0');
    assert.equal(youtubeRetryDelay(30), 3600000);
    release(); await first;
  } finally { release(); registry.close(); }
});
