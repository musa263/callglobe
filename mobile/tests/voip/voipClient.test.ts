import assert from 'node:assert/strict';
import test from 'node:test';
import type { Call } from '@telnyx/react-voice-commons-sdk';
import { CallLifecycleRegistry, transactCallWaiting } from '../../src/lib/callLifecycle';
import { attachIceFailureListener, hasConfirmedBidirectionalMedia, isBidirectionalMediaReady, isTransportNetworkMigration, isVoiceSessionFresh, waitForBidirectionalMedia, VoiceMediaRecoveryCoordinator } from '../../src/lib/voiceRecovery';

class MockPeerConnection {
  connectionState = 'connected';
  iceConnectionState = 'connected';
  restartCount = 0;
  offerCount = 0;
  getStats?: () => Promise<unknown>;
  listeners = new Set<() => void>();
  restartIce() { this.restartCount += 1; }
  async createOffer() { this.offerCount += 1; return { type: 'offer', sdp: 'fresh-ice' }; }
  async setLocalDescription() { return undefined; }
  getSenders() { return [{ track: { kind: 'audio', enabled: true, readyState: 'live' } }]; }
  getReceivers() { return [{ track: { kind: 'audio', readyState: 'live' } }]; }
  addEventListener(_event: 'iceconnectionstatechange', listener: () => void) { this.listeners.add(listener); }
  removeEventListener(_event: 'iceconnectionstatechange', listener: () => void) { this.listeners.delete(listener); }
  transition(state: string) {
    this.iceConnectionState = state;
    this.listeners.forEach((listener) => listener());
  }
}

function mockTelnyxCall(peer: MockPeerConnection) {
  let restartCount = 0;
  return {
    callId: 'call-1',
    telnyxCall: {
      peer: { getPeerConnection: () => peer },
      restartMedia: async () => { restartCount += 1; peer.restartIce(); },
    },
    get restartCount() { return restartCount; },
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

test('a rejected BYE releases the lifecycle lock and permits a verified retry', async () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-retry', 'ACTIVE');
  let attempts = 0;
  await assert.rejects(calls.terminate('call-retry', async () => {
    attempts += 1;
    throw new Error('signaling timeout');
  }), /signaling timeout/);
  assert.equal(calls.isTerminating('call-retry'), false);
  assert.equal(calls.state('call-retry'), 'ACTIVE');
  await calls.terminate('call-retry', async () => { attempts += 1; });
  assert.equal(attempts, 2);
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

test('call waiting rolls back the answered leg when holding the current call fails', async () => {
  const events: string[] = [];
  await assert.rejects(transactCallWaiting({
    answerIncoming: async () => { events.push('answer-b'); },
    isIncomingAcknowledged: () => true,
    holdCurrent: async () => { events.push('hold-a'); throw new Error('hold rejected'); },
    activateIncoming: () => { events.push('activate-b'); },
    rollbackIncoming: async () => { events.push('hangup-b'); },
    restoreCurrent: () => { events.push('restore-a'); },
  }), /hold rejected/);
  assert.deepEqual(events, ['answer-b', 'hold-a', 'hangup-b', 'restore-a']);
});

test('Telnyx DROPPED state remains recoverable during a network handoff', () => {
  const calls = new CallLifecycleRegistry();
  calls.transition('call-3', 'ACTIVE');
  assert.equal(calls.transition('call-3', 'DROPPED'), true);
  assert.equal(calls.transition('call-3', 'ACTIVE'), true);
});

test('Wi-Fi to cellular recovery restarts ICE without replacing the live signaling session', async () => {
  const peer = new MockPeerConnection();
  const coordinator = new VoiceMediaRecoveryCoordinator(() => undefined, 0);
  const call = mockTelnyxCall(peer);
  await Promise.all([coordinator.recover(call, 'network-wifi-to-cellular'), coordinator.recover(call, 'ice-failed')]);
  // A stale connected flag must not suppress network-migration renegotiation.
  assert.equal(peer.restartCount, 1);
});

test('media readiness requires live inbound and outbound audio tracks', async () => {
  const peer = new MockPeerConnection();
  const call = mockTelnyxCall(peer);
  assert.equal(isBidirectionalMediaReady(call), true);
  assert.equal(await hasConfirmedBidirectionalMedia(call), false);
  assert.equal(await waitForBidirectionalMedia(call, 250), false);
  peer.getReceivers = () => [];
  assert.equal(isBidirectionalMediaReady(call), false);
});

test('devices without getStats wait for stable tracks before starting the timer', async () => {
  const peer = new MockPeerConnection();
  const call = mockTelnyxCall(peer);
  const started = Date.now();
  assert.equal(await waitForBidirectionalMedia(call, 2_000), true);
  assert.ok(Date.now() - started >= 1_000, 'tracks-only media must not start the timer at SIP ACTIVE');
});

test('RTP confirmation waits for packets in both directions before starting the timer', async () => {
  const peer = new MockPeerConnection();
  let packets = false;
  peer.getStats = async () => new Map([
    ['out', { type: 'outbound-rtp', kind: 'audio', packetsSent: packets ? 2 : 0 }],
    ['in', { type: 'inbound-rtp', kind: 'audio', packetsReceived: packets ? 2 : 0 }],
  ]);
  const call = mockTelnyxCall(peer);
  assert.equal(await hasConfirmedBidirectionalMedia(call), false);
  setTimeout(() => { packets = true; }, 120);
  assert.equal(await waitForBidirectionalMedia(call, 500), true);
});

test('network recovery ignores NetInfo initialization and only handles Wi-Fi/cellular migrations', () => {
  assert.equal(isTransportNetworkMigration(null, 'wifi'), false);
  assert.equal(isTransportNetworkMigration('unknown', 'wifi'), false);
  assert.equal(isTransportNetworkMigration('wifi', 'wifi'), false);
  assert.equal(isTransportNetworkMigration('wifi', 'cellular'), true);
  assert.equal(isTransportNetworkMigration('cellular', 'wifi'), true);
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
