import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { forwardingTargetForCause, isUnansweredAgentCause, userNoAnswerSeconds, userVoicemailEnabled } from './user-call-routing.js';

function profile(patch: Partial<ReturnType<typeof defaultPbxConfig>['userProfiles'][string]> = {}) {
  return {
    outboundCallerId: '', did: '', twoFactorEnabled: false, noAnswerSeconds: 25,
    forwardBusy: '', forwardNoAnswer: '', forwardUnavailable: '', simultaneousRing: '',
    voicemailEnabled: true, voicemailEmail: true, voicemailTranscription: false,
    schedule: 'Use office hours',
    permissions: { international: true, transfer: true, video: true, recording: false, reports: false },
    ...patch,
  };
}

test('uses and bounds each extension no-answer timeout', () => {
  assert.equal(userNoAnswerSeconds(profile({ noAnswerSeconds: 31 }), 45), 31);
  assert.equal(userNoAnswerSeconds(profile({ noAnswerSeconds: 1 }), 45), 10);
  assert.equal(userNoAnswerSeconds(profile({ noAnswerSeconds: 999 }), 45), 120);
  assert.equal(userNoAnswerSeconds(undefined, 28), 28);
});

test('requires both company and extension voicemail to be enabled', () => {
  assert.equal(userVoicemailEnabled(profile(), true), true);
  assert.equal(userVoicemailEnabled(profile({ voicemailEnabled: false }), true), false);
  assert.equal(userVoicemailEnabled(profile(), false), false);
  assert.equal(userVoicemailEnabled(undefined, true), true);
});

test('selects the forwarding destination for each unanswered cause', () => {
  const value = profile({ forwardBusy: '2002', forwardNoAnswer: '2003', forwardUnavailable: 'Voicemail' });
  assert.equal(forwardingTargetForCause(value, 'user_busy'), '2002');
  assert.equal(forwardingTargetForCause(value, 'timeout'), '2003');
  assert.equal(forwardingTargetForCause(value, 'network_out_of_order'), 'Voicemail');
  assert.equal(isUnansweredAgentCause('call_rejected'), true);
  assert.equal(isUnansweredAgentCause('normal_clearing'), false);
});
