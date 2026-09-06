import assert from 'node:assert/strict';
import test from 'node:test';
import { createConferenceHandler, requestedConferenceParticipants } from './routes/voice-conferences.js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';

test('conference endpoint blocks SIP hosts before directory provisioning, billing or carrier dial', async () => {
  const previous = process.env.VOCIVO_VOICE_EDGE;
  process.env.VOCIVO_VOICE_EDGE = 'sip';
  try {
    const handler = createConferenceHandler({
      requireSession: async () => ({ sub: 'vocivo-extension', extensionId: 'employee', organizationId: 'tenant-a', iat: 1234, exp: 9999999999 }),
      readPbxConfig: async () => defaultPbxConfig(),
    });
    let status = 0;
    let response: any;
    const res = { setHeader() {}, status(value: number) { status = value; return this; }, json(value: unknown) { response = value; return this; } } as unknown as VercelResponse;
    await handler({ method: 'POST', headers: {}, body: { participants: ['+12025550101', '+12025550102'] } } as VercelRequest, res);
    assert.equal(status, 409);
    assert.equal(response.code, 'conference_provider_unavailable');
  } finally {
    if (previous === undefined) delete process.env.VOCIVO_VOICE_EDGE; else process.env.VOCIVO_VOICE_EDGE = previous;
  }
});

test('accepts mixed international and internal conference participants', () => {
  assert.deepEqual(requestedConferenceParticipants([
    { type: 'external', number: '+1 (567) 386-0174' },
    { type: 'extension', extensionId: 'credential-2001' },
  ]), [
    { type: 'external', number: '+15673860174' },
    { type: 'extension', extensionId: 'credential-2001' },
  ]);
});

test('rejects incomplete conference entries instead of silently dropping them', () => {
  assert.throws(() => requestedConferenceParticipants([
    { type: 'external', number: '+15673860174' },
    { type: 'extension', extensionId: '' },
  ]), /valid conference participant/);
});

test('limits a conference to five invited participants', () => {
  assert.throws(() => requestedConferenceParticipants(Array.from({ length: 6 }, (_, index) => `+12025550${String(index).padStart(3, '0')}`)), /up to five/);
});
