import assert from 'node:assert/strict';
import test from 'node:test';
import { attachSipMedia } from './sipSession.js';

test('SIP media resolves the mounted element at answer, adds late tracks, and tears down', () => {
  const savedDocument = globalThis.document;
  const savedStream = globalThis.MediaStream;
  const listeners = new Set();
  const trackListeners = new Set();
  const audio = { kind: 'audio' };
  let mounted = false;
  let tracks = [];
  let plays = 0;
  let pauses = 0;
  const element = { srcObject: null, play: () => { plays++; return Promise.resolve(); }, pause: () => { pauses++; } };
  globalThis.document = { getElementById: () => mounted ? element : null };
  globalThis.MediaStream = class {
    tracks = [];
    addTrack(track) { this.tracks.push(track); }
    getTracks() { return this.tracks; }
  };
  try {
    const session = {
      state: 'Initial',
      stateChange: { addListener: f => listeners.add(f), removeListener: f => listeners.delete(f) },
      sessionDescriptionHandler: { peerConnection: {
        getReceivers: () => tracks.map(track => ({ track })),
        addEventListener: (_event, f) => trackListeners.add(f),
        removeEventListener: (_event, f) => trackListeners.delete(f),
      } },
    };
    const dispose = attachSipMedia(session, 'remoteMedia', (error) => { throw error; });
    mounted = true;
    session.state = 'Established';
    listeners.forEach(f => f(session.state));
    tracks = [audio];
    trackListeners.forEach(f => f());
    assert.deepEqual(element.srcObject.getTracks(), [audio]);
    trackListeners.forEach(f => f());
    assert.equal(element.srcObject.getTracks().length, 1);
    assert.equal(plays, 3);
    dispose();
    assert.equal(element.srcObject, null);
    assert.equal(pauses, 1);
    assert.equal(listeners.size, 0);
    assert.equal(trackListeners.size, 0);
  } finally {
    globalThis.document = savedDocument;
    globalThis.MediaStream = savedStream;
  }
});
