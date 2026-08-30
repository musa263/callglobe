import assert from 'node:assert/strict';
import test from 'node:test';
import type { Call } from '@telnyx/react-voice-commons-sdk';
import { inviteHeader } from '../voice/callIdentity';

test('invite header lookup does not throw on nameless headers', () => {
  const call = {
    inviteCustomHeaders: [
      { value: 'ignore-me' },
      { name: 'X-Vocivo-Caller-Name', value: 'Musa' },
    ],
  } as unknown as Call;
  assert.equal(inviteHeader(call, 'X-Vocivo-Caller-Name'), 'Musa');
});
