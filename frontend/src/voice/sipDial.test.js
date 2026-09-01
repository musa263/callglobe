import assert from 'node:assert/strict';
import test from 'node:test';
import { sipTargetUri, sipUserFromUri } from './sipDial.js';

test('SIP edge dials E.164 through the Vocivo domain, not Telnyx park', () => {
  assert.equal(sipTargetUri('+15551234567', 'sip.vocivo.local'), 'sip:+15551234567@sip.vocivo.local');
  assert.equal(sipTargetUri('2003-user', 'sip.vocivo.local'), 'sip:2003-user@sip.vocivo.local');
});

test('internal routes rewrite Telnyx SIP URIs onto the Vocivo registrar', () => {
  assert.equal(sipUserFromUri('sip:ext-2003@sip.telnyx.com'), 'ext-2003');
  assert.equal(sipTargetUri('sip:ext-2003@sip.telnyx.com', 'sip.vocivo.app'), 'sip:ext-2003@sip.vocivo.app');
});
