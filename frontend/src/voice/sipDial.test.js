import assert from 'node:assert/strict';
import test from 'node:test';
import { describeCallRejection, isRoutineCallOutcome, sipTargetUri, sipUserFromUri } from './sipDial.js';

test('SIP edge dials E.164 through the Vocivo domain, not Telnyx park', () => {
  assert.equal(sipTargetUri('+15551234567', 'sip.vocivo.local'), 'sip:+15551234567@sip.vocivo.local');
  assert.equal(sipTargetUri('2003-user', 'sip.vocivo.local'), 'sip:2003-user@sip.vocivo.local');
});

test('internal routes rewrite Telnyx SIP URIs onto the Vocivo registrar', () => {
  assert.equal(sipUserFromUri('sip:ext-2003@sip.telnyx.com'), 'ext-2003');
  assert.equal(sipTargetUri('sip:ext-2003@sip.telnyx.com', 'sip.vocivo.app'), 'sip:ext-2003@sip.vocivo.app');
});

test('call outcomes are helpful without exposing carrier protocol text', () => {
  assert.equal(describeCallRejection(480, 'Temporarily Unavailable', 'Sam'), 'Sam is unavailable right now. Please try again later.');
  assert.equal(describeCallRejection(487, 'Request Terminated'), 'Call cancelled.');
  assert.equal(describeCallRejection(486, 'Busy Here'), 'The line is busy. Please try again later.');
  assert.doesNotMatch(describeCallRejection(503, 'sip:secret@host'), /503|sip:|secret/);
  assert.equal(isRoutineCallOutcome(480), true);
  assert.equal(isRoutineCallOutcome(503), false);
});
