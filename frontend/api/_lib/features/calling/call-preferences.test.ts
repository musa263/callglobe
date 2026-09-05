import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCallPreferences, callPreferencesFrom, defaultUserProfile } from './call-preferences.js';

test('a person with no profile yet sees sensible defaults', () => {
  assert.deepEqual(callPreferencesFrom(undefined), {
    voicemailEnabled: true, noAnswerSeconds: 25, schedule: 'Always available', simultaneousRing: '', forwardUnavailable: '',
  });
});

test('their own choices are saved, and only the fields that are theirs', () => {
  const admin = { ...defaultUserProfile(), outboundCallerId: '+18447161777', permissions: { international: true, transfer: true, video: false, recording: false, reports: false } };
  const saved = applyCallPreferences(admin, {
    voicemailEnabled: false, noAnswerSeconds: 40, schedule: 'Use office hours', simultaneousRing: '+1 (212) 555-0142', forwardUnavailable: '2001',
    // Not theirs to change, and quietly ignored.
    outboundCallerId: '+15550000000', permissions: { international: false },
  });
  assert.equal(saved.voicemailEnabled, false);
  assert.equal(saved.noAnswerSeconds, 40);
  assert.equal(saved.schedule, 'Use office hours');
  assert.equal(saved.simultaneousRing, '+12125550142');
  assert.equal(saved.forwardUnavailable, '2001');
  assert.equal(saved.outboundCallerId, '+18447161777', 'the caller ID stays the administrator’s');
  assert.equal(saved.permissions.international, true, 'permissions stay the administrator’s');
});

test('nonsense is refused with a reason a person can act on', () => {
  assert.throws(() => applyCallPreferences(undefined, { noAnswerSeconds: 3 }), /between 10 and 120/);
  assert.throws(() => applyCallPreferences(undefined, { schedule: 'Whenever' }), /Always available/);
  assert.throws(() => applyCallPreferences(undefined, { forwardUnavailable: 'sip:evil@example.com' }), /Forwarding destinations/);
});

test('a field left out of the request is left alone', () => {
  const current = { ...defaultUserProfile(), noAnswerSeconds: 60, simultaneousRing: '2002' };
  const saved = applyCallPreferences(current, { voicemailEnabled: true });
  assert.equal(saved.noAnswerSeconds, 60);
  assert.equal(saved.simultaneousRing, '2002');
});
