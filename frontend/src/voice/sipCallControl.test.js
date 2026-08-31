import assert from 'node:assert/strict';
import test from 'node:test';
import { conferenceSipUri, setSipMuted } from './sipCallControl.js';

test('SIP mute disables only the local sender track', () => {
  const local = { kind: 'audio', enabled: true };
  const remote = { kind: 'audio', enabled: true };
  const session = {
    sessionDescriptionHandler: {
      peerConnection: {
        getSenders: () => [{ track: local }],
        getReceivers: () => [{ track: remote }],
      },
    },
  };
  setSipMuted(session, true);
  assert.equal(local.enabled, false);
  assert.equal(remote.enabled, true);
  setSipMuted(session, false);
  assert.equal(local.enabled, true);
  assert.equal(remote.enabled, true);
});

test('SIP merge targets a Vocivo conference AOR, not Telnyx Call Control', () => {
  assert.equal(conferenceSipUri('abc_123', 'sip.vocivo.app'), 'sip:conf-abc_123@sip.vocivo.app');
  assert.throws(() => conferenceSipUri('', 'sip.vocivo.app'), /conference/i);
});
