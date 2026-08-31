import assert from 'node:assert/strict';
import test from 'node:test';
import { sipTargetUri } from './sipDial.js';

test('SIP edge dials E.164 through the Vocivo domain, not Telnyx park', () => {
  assert.equal(sipTargetUri('+15551234567', 'sip.vocivo.local'), 'sip:+15551234567@sip.vocivo.local');
  assert.equal(sipTargetUri('2003-user', 'sip.vocivo.local'), 'sip:2003-user@sip.vocivo.local');
});
