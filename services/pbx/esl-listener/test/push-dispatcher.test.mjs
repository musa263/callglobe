import assert from 'node:assert/strict';
import test from 'node:test';
import { ConcurrencyGate } from '../src/push-dispatcher.mjs';

test('APNs backpressure never exceeds the configured concurrency', async () => {
  const gate = new ConcurrencyGate(3);
  let active = 0;
  let maximum = 0;
  const results = await Promise.all(Array.from({ length: 20 }, (_, value) => gate.run(async () => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value;
  })));
  assert.equal(maximum, 3);
  assert.deepEqual(results, Array.from({ length: 20 }, (_, value) => value));
});

test('APNs backpressure rejects work beyond the bounded queue', async () => {
  const gate = new ConcurrencyGate(1, 1);
  let release;
  const first = gate.run(() => new Promise((resolve) => { release = resolve; }));
  const second = gate.run(async () => 'queued');
  await assert.rejects(() => gate.run(async () => 'overflow'), /queue is full/);
  release();
  assert.equal(await first, undefined);
  assert.equal(await second, 'queued');
});
