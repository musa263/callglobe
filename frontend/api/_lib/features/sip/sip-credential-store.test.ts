import assert from 'node:assert/strict';
import test from 'node:test';
import { liveSipCredentials, mergeSipCredentials, type StoredSipCredential } from './sip-credential-store.js';
import { sipCredentialClient } from './sip-edge-auth.js';

const now = Date.UTC(2026, 8, 4, 12, 0, 0);
const credential = (over: Partial<StoredSipCredential> = {}): StoredSipCredential => ({
  username: 'employee_credential', extensionId: 'ext-1', organizationId: 'acme', realm: 'sip.vocivo.app',
  ha1: 'hash', expiresAt: new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(), ...over,
});

test('a browser and a handset each keep a password', () => {
  // A single stored credential meant whichever signed in last took the other
  // off the registrar, and its calls stopped arriving with nothing on screen.
  const web = credential({ client: 'web', ha1: 'web-hash' });
  const mobile = credential({ client: 'mobile', ha1: 'mobile-hash' });
  const stored = mergeSipCredentials(mergeSipCredentials([], web, now), mobile, now);
  assert.deepEqual(stored.map((item) => item.ha1), ['web-hash', 'mobile-hash']);
});

test('the same device replaces its own password rather than collecting them', () => {
  const first = mergeSipCredentials([], credential({ client: 'web', ha1: 'one' }), now);
  const second = mergeSipCredentials(first, credential({ client: 'web', ha1: 'two' }), now);
  assert.deepEqual(second.map((item) => item.ha1), ['two']);
});

test('expired passwords are dropped as new ones are stored', () => {
  const stale = credential({ client: 'old-laptop', ha1: 'stale', expiresAt: new Date(now - 1000).toISOString() });
  const stored = mergeSipCredentials([stale], credential({ client: 'web', ha1: 'fresh' }), now);
  assert.deepEqual(stored.map((item) => item.ha1), ['fresh']);
  assert.deepEqual(liveSipCredentials([stale], now), []);
});

test('a person with more devices than we keep passwords for loses the oldest', () => {
  let stored: StoredSipCredential[] = [];
  for (let index = 0; index < 8; index += 1) {
    stored = mergeSipCredentials(stored, credential({ client: `device-${index}`, ha1: `hash-${index}` }), now);
  }
  assert.equal(stored.length, 6);
  assert.equal(stored[0].ha1, 'hash-2');
  assert.equal(stored.at(-1)?.ha1, 'hash-7');
});

test('a device names its own slot, and the user agent decides when it does not', () => {
  assert.equal(sipCredentialClient({ body: { client: 'Mobile' }, headers: {} }), 'mobile');
  assert.equal(sipCredentialClient({ body: {}, headers: { 'user-agent': 'okhttp/4.9 vocivo' } }), 'mobile');
  assert.equal(sipCredentialClient({ body: {}, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh) Safari' } }), 'web');
  assert.equal(sipCredentialClient({ body: {}, headers: {} }), 'web');
  assert.equal(sipCredentialClient({ body: { client: '../../etc/passwd' }, headers: {} }), 'etcpasswd');
});
