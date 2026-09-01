import assert from 'node:assert/strict';
import test from 'node:test';
import { describeIncoming, describeRemote, getCallId } from './callIdentity.js';

test('uses signed internal-call headers instead of exposing a SIP address', () => {
  const call = {
    id: 'call-1',
    options: {
      remoteCallerName: 'Fallback name',
      remoteCallerNumber: 'sip:generated-user@sip.telnyx.com',
      customHeaders: [
        { name: 'X-Vocivo-Call-Type', value: 'internal' },
        { name: 'X-Vocivo-Caller-Name', value: 'Mousa Usman' },
        { name: 'X-Vocivo-Caller-Extension', value: '2000' },
      ],
    },
  };

  assert.equal(getCallId(call), 'call-1');
  assert.deepEqual(describeRemote(call), {
    name: 'Mousa Usman',
    number: 'Extension 2000',
    internal: true,
    photoUrl: '',
  });
});

test('incoming SIP invitations do not expose the registrar URI', () => {
  assert.deepEqual(describeIncoming({
    remoteIdentity: { displayName: 'Mousa - Extension 2000', uri: 'sip:gencredabc@sip.vocivo.app' },
  }), {
    name: 'Mousa - Extension 2000',
    number: 'Extension 2000',
    internal: true,
    photoUrl: '',
  });
});

test('normalizes an unlabelled SIP caller without leaking protocol details', () => {
  assert.deepEqual(describeRemote({
    callId: 'call-2',
    options: { remoteCallerNumber: 'sip:user@sip.telnyx.com' },
  }), {
    name: 'Phone call',
    number: 'Internal call',
    internal: false,
    photoUrl: '',
  });
});
