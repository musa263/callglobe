import assert from 'node:assert/strict';
import test from 'node:test';
import type { VoiceCall } from '../voice/voiceEngine';
import { inviteHeader } from '../voice/callIdentity';

test('invite header lookup does not throw on nameless headers', () => {
  const call = {
    inviteCustomHeaders: [
      { value: 'ignore-me' },
      { name: 'X-Vocivo-Caller-Name', value: 'Musa' },
    ],
  } as unknown as VoiceCall;
  assert.equal(inviteHeader(call, 'X-Vocivo-Caller-Name'), 'Musa');
});
