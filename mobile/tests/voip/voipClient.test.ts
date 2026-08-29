import assert from 'node:assert/strict';
import test from 'node:test';
import { CallLifecycleRegistry, SerialTaskQueue } from '../../src/lib/callLifecycle';

test('CallKeep and SDK hangup races produce one signaling command', async () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-1', 'RINGING');
  let hangups = 0;
  const end = () => calls.terminate('call-1', async () => {
    hangups += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });

  await Promise.all([end(), end(), end()]);
  assert.equal(hangups, 1);
  assert.equal(calls.isTerminating('call-1'), true);
});

test('remote CANCEL wins an exact answer race without resurrecting the call', async () => {
  const calls = new CallLifecycleRegistry();
  assert.equal(calls.transition('call-2', 'RINGING'), true);
  const results = await Promise.all([
    Promise.resolve().then(() => calls.transition('call-2', 'ENDED')),
    Promise.resolve().then(() => calls.transition('call-2', 'ACTIVE')),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(calls.state('call-2'), 'ENDED');
  assert.equal(calls.transition('call-2', 'ACTIVE'), false);
});

test('local termination blocks delayed ringing and active callbacks', async () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-3', 'CONNECTING');
  const ending = calls.terminate('call-3', async () => {
    assert.equal(calls.transition('call-3', 'RINGING'), false);
    assert.equal(calls.transition('call-3', 'ACTIVE'), false);
  });
  await ending;
  assert.equal(calls.transition('call-3', 'ENDED'), true);
});

test('network recovery and call-control renegotiations stay serialized', async () => {
  const queue = new SerialTaskQueue();
  const operations: string[] = [];
  await Promise.all([
    queue.run(async () => { operations.push('wifi:lost'); await new Promise((resolve) => setTimeout(resolve, 5)); operations.push('ice:restarted'); }),
    queue.run(async () => { operations.push('hold'); }),
    queue.run(async () => { operations.push('cellular:ready'); }),
  ]);
  assert.deepEqual(operations, ['wifi:lost', 'ice:restarted', 'hold', 'cellular:ready']);
});

test('killed-state push and Android recovery can share one call identity', () => {
  const calls = new CallLifecycleRegistry();
  assert.equal(calls.transition('push-call', 'RINGING'), true);
  assert.equal(calls.transition('push-call', 'RINGING'), false);
  assert.equal(calls.transition('push-call', 'CONNECTING'), true);
  assert.equal(calls.transition('push-call', 'ACTIVE'), true);
});

test('separate calls retain independent lifecycle locks', async () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('first', 'ACTIVE');
  calls.transition('second', 'RINGING');
  await calls.terminate('first', async () => undefined);
  assert.equal(calls.transition('first', 'HELD'), false);
  assert.equal(calls.transition('second', 'ACTIVE'), true);
});
