import assert from 'node:assert/strict';
import test from 'node:test';
import type { Call } from '@telnyx/react-voice-commons-sdk';
import { CallLifecycleRegistry } from '../../src/lib/callLifecycle';
import { attachIceFailureListener, isVoiceSessionFresh, VoiceMediaRecoveryCoordinator } from '../../src/lib/voiceRecovery';

class MockPeerConnection {
  iceConnectionState = 'connected';
  restartCount = 0;
  listeners = new Set<() => void>();
  restartIce() { this.restartCount += 1; }
  addEventListener(_event: 'iceconnectionstatechange', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_event: 'iceconnectionstatechange', listener: () => void) { this.listeners.delete(listener); }
  transition(state: string) {
    this.iceConnectionState = state;
    this.listeners.forEach((listener) => listener());
  }
}

function mockTelnyxCall(peer: MockPeerConnection) {
  return {
    callId: 'call-1',
    telnyxCall: { peer: { getPeerConnection: () => peer } },
  } as unknown as Call;
}

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
});

test('remote CANCEL wins an exact answer race without resurrecting the call', async () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-2', 'RINGING');
  const results = await Promise.all([
    Promise.resolve().then(() => calls.transition('call-2', 'ENDED')),
    Promise.resolve().then(() => calls.transition('call-2', 'ACTIVE')),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(calls.state('call-2'), 'ENDED');
  assert.equal(calls.transition('call-2', 'ACTIVE'), false);
});

test('Telnyx DROPPED state remains recoverable during a network handoff', () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-3', 'ACTIVE');
  assert.equal(calls.transition('call-3', 'DROPPED'), true);
  assert.equal(calls.transition('call-3', 'ACTIVE'), true);
});

test('Wi-Fi to cellular recovery restarts ICE and serializes signaling reattach', async () => {
  const peer = new MockPeerConnection();
  peer.iceConnectionState = 'failed';
  let reattachments = 0;
  const coordinator = new VoiceMediaRecoveryCoordinator(async () => { reattachments += 1; return true; }, () => undefined, 0);
  const call = mockTelnyxCall(peer);
  await Promise.all([coordinator.recover(call, 'network-wifi-to-cellular'), coordinator.recover(call, 'ice-failed')]);
  assert.equal(peer.restartCount, 1);
  assert.equal(reattachments, 1);
});

test('ICE failure listener invokes recovery and is removed on call teardown', () => {
  const peer = new MockPeerConnection();
  const call = mockTelnyxCall(peer);
  let recoveries = 0;
  const teardown = attachIceFailureListener(call, () => { recoveries += 1; });
  assert.ok(teardown);
  peer.transition('failed');
  assert.equal(recoveries, 1);
  teardown();
  peer.transition('failed');
  assert.equal(recoveries, 1);
  assert.equal(peer.listeners.size, 0);
});

test('killed-state push refresh policy rejects expired and near-expiry tokens', () => {
  const now = Date.now();
  assert.equal(isVoiceSessionFresh({ token: 'fresh', expiresAt: now + 10 * 60_000 }), true);
  assert.equal(isVoiceSessionFresh({ token: 'near-expiry', expiresAt: now + 30_000 }), false);
  assert.equal(isVoiceSessionFresh({ token: 'expired', expiresAt: now - 1 }), false);
  assert.equal(isVoiceSessionFresh(null), false);
});
