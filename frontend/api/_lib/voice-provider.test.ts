import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { voiceIceServers } from './voice-provider.js';

const keys = ['VOCIVO_STUN_URLS', 'VOCIVO_TURN_URLS', 'VOCIVO_TURN_SECRET', 'VOCIVO_TURN_TTL_SECONDS'] as const;

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

test('publishes STUN and authenticated TURN servers to calling clients', () => {
  withEnvironment({
    VOCIVO_STUN_URLS: 'stun:stun1.example.com, stun:stun2.example.com',
    VOCIVO_TURN_URLS: 'turn:turn.example.com:3478?transport=udp, turns:turn.example.com:443?transport=tcp',
    VOCIVO_TURN_SECRET: 'a-secure-turn-rest-secret-with-32-chars',
    VOCIVO_TURN_TTL_SECONDS: '600',
  }, () => {
    const servers = voiceIceServers('tenant:user');
    assert.deepEqual(servers[0], { urls: ['stun:stun1.example.com', 'stun:stun2.example.com'] });
    const turn = servers[1];
    assert.deepEqual(turn.urls, ['turn:turn.example.com:3478?transport=udp', 'turns:turn.example.com:443?transport=tcp']);
    assert.match(turn.username || '', /^\d{10}:[a-f0-9]{24}$/);
    assert.equal(turn.credential, createHmac('sha1', 'a-secure-turn-rest-secret-with-32-chars').update(turn.username || '').digest('base64'));
  });
});

test('does not publish an unauthenticated TURN server', () => {
  withEnvironment({ VOCIVO_TURN_URLS: 'turn:turn.example.com:3478' }, () => {
    assert.deepEqual(voiceIceServers(), [{ urls: 'stun:stun.cloudflare.com:3478' }]);
  });
});
