import assert from 'node:assert/strict';
import test from 'node:test';
import { monitorSipCall, restartSipMedia } from './sipCallHealth.js';

function fixture() {
  let now = 0;
  const timers = new Map();
  const listeners = new Set();
  const pc = new EventTarget();
  pc.iceConnectionState = 'connected'; pc.connectionState = 'connected';
  const session = { state: 'Established', sessionDescriptionHandler: { peerConnection: pc }, stateChange: {
    addListener: (fn) => listeners.add(fn), removeListener: (fn) => listeners.delete(fn),
  } };
  const failures = []; const restarts = []; const errors = [];
  const monitor = monitorSipCall(session, {
    isConnected: () => true, now: () => now, graceMs: 12_000,
    schedule: (fn, delay) => { const id = {}; timers.set(id, { fn, at: now + delay }); return () => timers.delete(id); },
    restart: async () => { restarts.push(1); }, onFailure: (reason) => failures.push(reason), onError: (error) => errors.push(error),
  });
  const advance = (ms) => {
    const end = now + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > end) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = end;
  };
  const ice = (state) => { pc.iceConnectionState = state; pc.dispatchEvent(new Event('iceconnectionstatechange')); };
  return { session, monitor, advance, ice, failures, restarts, listeners, timers, errors };
}

test('a 1006-style transport loss cannot retain the active screen indefinitely', () => {
  const h = fixture(); h.monitor.transport(false); h.advance(11_999);
  assert.equal(h.failures.length, 0); h.advance(1);
  assert.equal(h.failures.length, 1); assert.equal(h.timers.size, 0); assert.equal(h.listeners.size, 0);
  h.monitor.transport(true); h.advance(60_000); assert.equal(h.failures.length, 1);
});
test('a recovered transport clears its deadline without ending healthy media', () => {
  const h = fixture(); h.monitor.transport(false); h.advance(8000); h.monitor.transport(true); h.advance(20_000);
  assert.equal(h.failures.length, 0); h.monitor.stop(); assert.equal(h.timers.size, 0);
});
test('ICE failure requests one renegotiation and terminates if media never returns', async () => {
  const h = fixture(); h.ice('failed'); h.ice('failed'); await Promise.resolve();
  assert.equal(h.restarts.length, 1); h.advance(12_000); assert.equal(h.failures.length, 1);
});
test('media recovery cancels the timeout; teardown removes peer listeners', async () => {
  const h = fixture(); h.ice('disconnected'); await Promise.resolve(); h.advance(6000); h.ice('connected'); h.advance(20_000);
  assert.equal(h.failures.length, 0); h.monitor.stop(); h.ice('failed'); await Promise.resolve();
  assert.equal(h.restarts.length, 1); assert.equal(h.timers.size, 0);
});
test('media restart sends an ICE-restart offer inside the established dialog', async () => {
  const h = fixture(); let offer; let restartCount = 0;
  h.session.sessionDescriptionHandler.peerConnection.restartIce = () => { restartCount++; };
  h.session.invite = async (options) => { offer = options; options.requestDelegate.onAccept(); };
  await restartSipMedia(h.session);
  assert.equal(restartCount, 1); assert.equal(offer.sessionDescriptionHandlerOptions.offerOptions.iceRestart, true);
  assert.equal(h.listeners.size, 1); h.monitor.stop();
});
