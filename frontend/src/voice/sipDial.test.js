import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCallRejection, sipTargetUri, sipUserFromUri } from './sipDial.js';

test('SIP edge dials E.164 through the Vocivo domain, not Telnyx park', () => {
  assert.equal(sipTargetUri('+15551234567', 'sip.vocivo.local'), 'sip:+15551234567@sip.vocivo.local');
  assert.equal(sipTargetUri('2003-user', 'sip.vocivo.local'), 'sip:2003-user@sip.vocivo.local');
});

test('internal routes rewrite Telnyx SIP URIs onto the Vocivo registrar', () => {
  assert.equal(sipUserFromUri('sip:ext-2003@sip.telnyx.com'), 'ext-2003');
  assert.equal(sipTargetUri('sip:ext-2003@sip.telnyx.com', 'sip.vocivo.app'), 'sip:ext-2003@sip.vocivo.app');
});

test('a refused call is described by its SIP status, which is the fact that helps', () => {
  assert.equal(describeCallRejection(480, 'Temporarily Unavailable'), 'No one was available to take the call (480 Temporarily Unavailable).');
  assert.equal(describeCallRejection(403, 'Forbidden'), 'The call was not allowed (403 Forbidden).');
  assert.equal(describeCallRejection(486, 'Busy Here'), 'The line is busy (486 Busy Here).');
  assert.equal(describeCallRejection(503, 'Service Unavailable'), 'The calling service could not place the call (503 Service Unavailable).');
  assert.equal(describeCallRejection(undefined, ''), 'The call could not be completed.');
});
