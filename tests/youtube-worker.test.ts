import assert from 'node:assert/strict';
import test from 'node:test';
import type { Repository } from '../src/data/database.js';
import { UserRegistry, type User } from '../src/users.js';
import { runYoutubeWorkerCycle, type YoutubeWorkerSteps } from '../src/youtube-worker.js';

test('YouTube worker enriches every user while keeping portability owner-only', async () => {
  const registry = new UserRegistry(':memory:');
  try {
    const owner = registry.ensureDefaultUser();
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
      classification: step('classification'),
    };

    const results = await runYoutubeWorkerCycle(registry, steps);

    assert.deepEqual(results.map((result) => result.user), [owner.handle, alice.handle, bob.handle]);
    assert.deepEqual(calls, [
      `portability:${owner.handle}`,
      `metadata:${owner.handle}`,
      `channels:${owner.handle}`,
      `classification:${owner.handle}`,
      'metadata:alice',
      'channels:alice',
      'classification:alice',
      'metadata:bob',
      'channels:bob',
      'classification:bob',
    ]);
    assert.ok(results.every((result) => result.portability === (result.user === owner.handle ? 'idle' : 'not_applicable')));
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
      classification: async (_repository, user) => {
        classified.push(user.handle);
        return 0;
      },
    };

    const results = await runYoutubeWorkerCycle(registry, steps);

    assert.match(results.find((result) => result.user === alice.handle)?.error ?? '', /alice metadata failed/);
    assert.deepEqual(classified.at(-1), bob.handle);
    assert.match(registry.repositoryFor(alice).youtubeSyncState('last_error') ?? '', /alice metadata failed/);
    assert.equal(registry.repositoryFor(bob).youtubeSyncState('last_error'), '');
  } finally {
    registry.close();
  }
});
