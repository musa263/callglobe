import assert from 'node:assert/strict';
import test from 'node:test';
import { bindCallUi, type CallUiEventMap, type CallUiEventName, type CallUiEventSource, type NativeCallUi } from './callUi';
import { SipEventBus } from './sipBridge';
import type { NativeSipBridge } from './voiceEngine';

function fakeUi() {
  const listeners = new Map<CallUiEventName, Set<(payload: never) => void>>();
  const source: CallUiEventSource = {
    addListener(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (payload: never) => void);
      listeners.set(event, set);
      return { remove: () => { set.delete(listener as (payload: never) => void); } };
    },
  };
  const press = <K extends CallUiEventName>(event: K, payload: CallUiEventMap[K]) => {
    [...(listeners.get(event) ?? [])].forEach((listener) => (listener as (value: CallUiEventMap[K]) => void)(payload));
  };
  return { source, press };
}

function fakeNative() {
  const seen: string[] = [];
  const native: NativeCallUi = {
    reportIncomingCall: async ({ callId, callerName }) => { seen.push(`incoming:${callId}:${callerName ?? ''}`); },
    reportOutgoingCall: async ({ callId }) => { seen.push(`outgoing:${callId}`); },
    reportCallConnected: async (callId) => { seen.push(`connected:${callId}`); },
    reportCallEnded: async ({ callId, reason }) => { seen.push(`ended:${callId}:${reason}`); },
    reportMuted: async ({ callId, muted }) => { seen.push(`muted:${callId}:${muted}`); },
    reportHeld: async ({ callId, held }) => { seen.push(`held:${callId}:${held}`); },
    setSpeaker: async (on) => { seen.push(`speaker:${on}`); },
    isCallUiAvailable: async () => true,
  };
  return { native, seen };
}

function fakeBridge() {
  const seen: string[] = [];
  const bridge = {
    register: async () => {},
    unregister: async () => {},
    invite: async () => 'x',
    answer: async (id: string) => { seen.push(`answer:${id}`); },
    hangup: async (id?: string) => { seen.push(`hangup:${id}`); },
    hold: async (id: string, on: boolean) => { seen.push(`hold:${id}:${on}`); },
    mute: async (id: string, on: boolean) => { seen.push(`mute:${id}:${on}`); },
    sendDtmf: async (id: string, digit: string) => { seen.push(`dtmf:${id}:${digit}`); },
    setSpeaker: async () => {},
  } satisfies NativeSipBridge;
  return { bridge, seen };
}

function harness() {
  const events = new SipEventBus();
  const ui = fakeUi();
  const { native, seen: nativeSeen } = fakeNative();
  const { bridge, seen: bridgeSeen } = fakeBridge();
  const wakes: CallUiEventMap['callUiPushWake'][] = [];
  const binding = bindCallUi({ events, bridge, native, ui: ui.source, onPushWake: (payload) => wakes.push(payload) });
  return { events, ui, native, nativeSeen, bridge, bridgeSeen, wakes, binding };
}

test('an incoming call is put on the system call screen once', async () => {
  const { events, nativeSeen } = harness();
  events.emit('incoming', { callId: 'c1', callerName: 'Sam', callerNumber: '+15551230000' });
  events.emit('incoming', { callId: 'c1', callerName: 'Sam' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, ['incoming:c1:Sam']);
});

test('a call that was drawn from a push is not drawn again by the INVITE', async () => {
  const { events, ui, nativeSeen, wakes } = harness();
  ui.press('callUiPushWake', { callId: 'c1', callerName: 'Sam' });
  events.emit('incoming', { callId: 'c1', callerName: 'Sam' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, []);
  assert.deepEqual(wakes, [{ callId: 'c1', callerName: 'Sam' }]);
});

test('connecting and ending are mirrored to the OS', async () => {
  const { events, nativeSeen } = harness();
  events.emit('callState', { callId: 'c1', state: 'ACTIVE' });
  events.emit('callState', { callId: 'c1', state: 'ENDED' });
  events.emit('callState', { callId: 'c2', state: 'FAILED' });
  events.emit('callState', { callId: 'c3', state: 'DROPPED' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, ['connected:c1', 'ended:c1:ended', 'ended:c2:failed', 'ended:c3:failed']);
});

test('a second call with the same id can ring again after the first ended', async () => {
  const { events, nativeSeen } = harness();
  events.emit('incoming', { callId: 'c1' });
  events.emit('callState', { callId: 'c1', state: 'ENDED' });
  events.emit('incoming', { callId: 'c1' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen.filter((entry) => entry.startsWith('incoming')), ['incoming:c1:', 'incoming:c1:']);
});

test('ringing and intermediate states are not reported as endings', async () => {
  const { events, nativeSeen } = harness();
  events.emit('callState', { callId: 'c1', state: 'RINGING' });
  events.emit('callState', { callId: 'c1', state: 'CONNECTING' });
  events.emit('callState', { callId: 'c1', state: 'HELD' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, []);
});

test('media changes are mirrored, and the speaker event without a call is ignored', async () => {
  const { events, nativeSeen } = harness();
  events.emit('mediaState', { callId: 'c1', muted: true });
  events.emit('mediaState', { callId: 'c1', onHold: true });
  events.emit('mediaState', { callId: '', speaker: true });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, ['muted:c1:true', 'held:c1:true']);
});

test('buttons on the system call screen drive the engine', async () => {
  const { ui, bridgeSeen } = harness();
  ui.press('callUiAnswer', { callId: 'c1' });
  ui.press('callUiMute', { callId: 'c1', muted: true });
  ui.press('callUiHold', { callId: 'c1', held: true });
  ui.press('callUiDtmf', { callId: 'c1', digit: '7' });
  ui.press('callUiEnd', { callId: 'c1' });
  await Promise.resolve();
  assert.deepEqual(bridgeSeen, ['answer:c1', 'mute:c1:true', 'hold:c1:true', 'dtmf:c1:7', 'hangup:c1']);
});

test('a native call that rejects does not take the call down', async () => {
  const events = new SipEventBus();
  const ui = fakeUi();
  const { bridge } = fakeBridge();
  const native = { ...fakeNative().native, reportIncomingCall: async () => { throw new Error('CallKit refused'); } };
  bindCallUi({ events, bridge, native, ui: ui.source });
  events.emit('incoming', { callId: 'c1' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  // Reaching here without an unhandled rejection is the assertion.
  assert.ok(true);
});

test('removing the binding stops both directions', async () => {
  const { events, ui, binding, nativeSeen, bridgeSeen } = harness();
  binding.remove();
  events.emit('incoming', { callId: 'c1' });
  ui.press('callUiAnswer', { callId: 'c1' });
  await Promise.resolve();
  assert.deepEqual(nativeSeen, []);
  assert.deepEqual(bridgeSeen, []);
});
