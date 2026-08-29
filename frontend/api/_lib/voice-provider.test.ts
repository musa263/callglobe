import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { voiceIceServers, voiceProvider } from './voice-provider.js';

const keys = ['TELNYX_ICE_SERVERS_JSON'] as const;

function withEnvironment(values: Partial<Record<(typeof keys)[number], string>>, run: () => void) {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    keys.forEach((key) => delete process.env[key]);
    Object.assign(process.env, values);
    run();
  } finally {
    keys.forEach((key) => {
      const value = previous[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
}

test('publishes authenticated Telnyx ICE servers to calling clients', () => {
  withEnvironment({
    TELNYX_ICE_SERVERS_JSON: JSON.stringify([
      { urls: 'stun:stun.telnyx.com:3478' },
      { urls: ['turn:turn.telnyx.example:3478', 'turns:turn.telnyx.example:443'], username: 'ephemeral-user', credential: 'ephemeral-secret' },
    ]),
  }, () => {
    const servers = voiceIceServers('tenant:user');
    assert.deepEqual(servers[0], { urls: 'stun:stun.telnyx.com:3478' });
    assert.deepEqual(servers[1], {
      urls: ['turn:turn.telnyx.example:3478', 'turns:turn.telnyx.example:443'],
      username: 'ephemeral-user',
      credential: 'ephemeral-secret',
    });
  });
});

test('uses Telnyx as the only voice provider', () => {
  withEnvironment({}, () => {
    assert.equal(voiceProvider(defaultPbxConfig()), 'telnyx');
  });
});

test('delegates to Telnyx SDK defaults and rejects unauthenticated TURN servers', () => {
  withEnvironment({}, () => {
    assert.deepEqual(voiceIceServers(), []);
  });
  withEnvironment({ TELNYX_ICE_SERVERS_JSON: JSON.stringify([{ urls: 'turn:turn.telnyx.example:3478' }]) }, () => {
    assert.throws(() => voiceIceServers(), /require a username and credential/i);
  });
});
