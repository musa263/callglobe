import assert from 'node:assert/strict';
import test from 'node:test';
import { terminationDeadline } from './terminationDeadline';
import { waitForBidirectionalMedia, VoiceMediaRecoveryCoordinator } from '../media/voiceRecovery';

test('a missing SIP termination acknowledgment is bounded and a late rejection is observed', async () => {
  let reject!: (error: Error) => void;
  const signaling = new Promise<void>((_, fail) => { reject = fail; });
  await assert.rejects(terminationDeadline(signaling, 5), /timed out/);
  reject(new Error('socket finally failed'));
  await new Promise(resolve => setImmediate(resolve));
});

test('disposal aborts RTP polling even while native getStats is unresolved', async () => {
  const abort = new AbortController();
  const pending = waitForBidirectionalMedia({ callId: 'a', peerConnection: { getStats: () => new Promise(() => {}) } }, 8000, abort.signal);
  abort.abort();
  assert.equal(await terminationDeadline(pending, 100), false);
});

test('disposal cancels an outstanding recovery and does not start another ICE attempt', async () => {
  let restarts = 0;
  const errors: unknown[] = [];
  const recovery = new VoiceMediaRecoveryCoordinator((_, error) => errors.push(error));
  const pending = recovery.recover({ callId: 'a', peerConnection: { restartIce() {} }, restartMedia: () => { restarts++; return new Promise(() => {}); } }, 'socket-drop');
  recovery.cancel('a');
  await terminationDeadline(pending, 100);
  assert.equal(restarts, 1);
  assert.deepEqual(errors, []);
});
