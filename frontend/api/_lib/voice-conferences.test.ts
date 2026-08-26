import assert from 'node:assert/strict';
import test from 'node:test';
import { requestedConferenceParticipants } from './routes/voice-conferences.js';

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
