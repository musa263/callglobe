import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebRouteCancellation } from './webRouteCancellation.ts';

test('offline cancellation survives reload, honors backoff and drains only for its owner', async () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
  let owner = 'a', now = 1000, complete = false, sends = 0;
  const options = { owner: 'a', currentOwner: () => owner, storage, now: () => now,
    send: async () => { sends++; if (!complete) throw Object.assign(new Error('pending'), { retryAfterMs: 2000 }); return { canceled: true }; } };
  const first = createWebRouteCancellation(options);
  await assert.rejects(first.cancel('route'), /pending/);
  const reloaded = createWebRouteCancellation(options);
  await reloaded.flush();
  assert.equal(sends, 1);
  owner = 'b'; now += 3000; complete = true;
  await reloaded.flush();
  assert.equal(sends, 1, 'another account cannot replay old work');
  owner = 'a';
  await Promise.all([reloaded.flush(), reloaded.flush()]);
  assert.equal(sends, 2);
  assert.equal([...data.values()][0], '[]');
});

test('a successful HTTP response without canceled:true does not erase pending work', async () => {
  let raw = '[]';
  const outbox = createWebRouteCancellation({ owner: 'a', currentOwner: () => 'a',
    storage: { getItem: () => raw, setItem: (_key, value) => { raw = value; } }, send: async () => ({ canceled: false }) });
  await assert.rejects(outbox.cancel('route'), /pending/);
  assert.equal(JSON.parse(raw).length, 1);
});
