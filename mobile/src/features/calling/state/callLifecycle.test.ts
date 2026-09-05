import assert from 'node:assert/strict';
import test from 'node:test';
import { canTransitionCallState, isSettledLocalHangupError, SerialTaskQueue, SingleFlightTermination } from './callLifecycle';

test('already-ended SDK hangup errors are treated as settled', () => {
  assert.equal(isSettledLocalHangupError(new Error('The call has already ended')), true);
  assert.equal(isSettledLocalHangupError(new Error('call is no longer active')), true);
  assert.equal(isSettledLocalHangupError(new Error('network timeout')), false);
});

test('termination executes SIP signaling only once', async () => {
  const lock = new SingleFlightTermination();
  let executions = 0;
  const terminate = () => lock.run(async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
  await Promise.all([terminate(), terminate(), terminate()]);
  await terminate();
  assert.equal(executions, 1);
  assert.equal(lock.finished, true);
});

test('terminal and connected calls cannot regress to ringing', () => {
  assert.equal(canTransitionCallState('ACTIVE', 'RINGING'), false);
  assert.equal(canTransitionCallState('ENDED', 'ACTIVE'), false);
  assert.equal(canTransitionCallState('RINGING', 'ACTIVE'), true);
  assert.equal(canTransitionCallState('ACTIVE', 'ENDED', true), true);
  assert.equal(canTransitionCallState('ACTIVE', 'HELD', true), false);
});

test('re-INVITE operations stay serialized', async () => {
  const queue = new SerialTaskQueue();
  const order: string[] = [];
  await Promise.all([
    queue.run(async () => { order.push('hold:start'); await new Promise((resolve) => setTimeout(resolve, 5)); order.push('hold:end'); }),
    queue.run(async () => { order.push('ice:start'); order.push('ice:end'); }),
  ]);
  assert.deepEqual(order, ['hold:start', 'hold:end', 'ice:start', 'ice:end']);
});
