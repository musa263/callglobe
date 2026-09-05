import assert from 'node:assert/strict';
import test from 'node:test';
import { observeSipSession, terminateSipSession } from './sipCallLifecycle.js';

test('hangup chooses CANCEL for an outgoing early call, reject for incoming, BYE after answer', async () => {
  for (const [state, incoming, expected] of [['Initial', false, 'cancel'], ['Establishing', true, 'reject'], ['Established', false, 'bye']]) {
    const sent = [];
    const session = { state, bye: async () => sent.push('bye'), ...(incoming ? { reject: async () => sent.push('reject') } : { cancel: async () => sent.push('cancel') }) };
    await Promise.all([terminateSipSession(session), terminateSipSession(session)]);
    assert.deepEqual(sent, [expected]);
  }
});

test('failed signaling releases the termination lock for a retry', async () => {
  let attempts = 0;
  const session = { state: 'Established', bye: async () => { if (++attempts === 1) throw new Error('offline'); } };
  await assert.rejects(terminateSipSession(session), /offline/);
  await terminateSipSession(session);
  assert.equal(attempts, 2);
});

test('incoming CANCEL and remote BYE are observed and release their listener', () => {
  const listeners = new Set();
  const seen = [];
  const session = { state: 'Initial', stateChange: { addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn) } };
  const dispose = observeSipSession(session, (state) => seen.push(state));
  for (const fn of [...listeners]) fn('Terminated');
  assert.deepEqual(seen, ['Initial', 'Terminated']);
  assert.equal(listeners.size, 0);
  dispose();
});
