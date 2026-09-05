import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import { sipInboundEnabled, sipRealm, voiceEdge, voiceIceServers, voiceProvider, voiceRouteNeedsTelnyxCredit } from './voice-provider.js';

const keys = ['TELNYX_ICE_SERVERS_JSON', 'VOCIVO_VOICE_EDGE', 'VOCIVO_SIP_REALM', 'VOCIVO_SIP_INBOUND'] as const;

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

test('defaults the voice edge to Telnyx so TestFlight stays on CallKit', () => {
  withEnvironment({}, () => {
    assert.equal(voiceProvider(defaultPbxConfig()), 'telnyx');
    assert.equal(voiceEdge(), 'telnyx');
    assert.equal(sipInboundEnabled(), false);
  });
});

test('enables the self-hosted SIP edge only when explicitly requested', () => {
  withEnvironment({ VOCIVO_VOICE_EDGE: 'sip', VOCIVO_SIP_REALM: 'sip.example.test', VOCIVO_SIP_INBOUND: '1' }, () => {
    assert.equal(voiceEdge(), 'sip');
    assert.equal(sipRealm(), 'sip.example.test');
    assert.equal(sipInboundEnabled(), true);
    assert.equal(voiceRouteNeedsTelnyxCredit('internal'), false);
    assert.equal(voiceRouteNeedsTelnyxCredit('outbound'), true);
  });
});

test('Telnyx park still checks carrier credit for internal calls', () => {
  withEnvironment({}, () => {
    assert.equal(voiceRouteNeedsTelnyxCredit('internal'), true);
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
