import assert from 'node:assert/strict';
import test from 'node:test';
import { wakeupSipDestinations } from './sip-ring-devices.js';

test('SIP destination wakeup is a no-op on the Telnyx edge', async () => {
  const previous = process.env.VOCIVO_VOICE_EDGE;
  delete process.env.VOCIVO_VOICE_EDGE;
  try {
    assert.deepEqual(await wakeupSipDestinations({
      destinations: ['sip:employee@sip.vocivo.app'],
      callId: 'cc-1',
      callerName: 'Office',
      from: '+15551212',
    }), []);
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_VOICE_EDGE;
    else process.env.VOCIVO_VOICE_EDGE = previous;
  }
});
