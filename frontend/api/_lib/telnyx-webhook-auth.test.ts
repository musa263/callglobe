import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyTelnyxWebhook } from './telnyx-webhook-auth.js';

test('uses separate legacy secrets for voice and messaging webhooks', () => {
  const previous = {
    publicKey: process.env.TELNYX_PUBLIC_KEY,
    voice: process.env.VOICE_WEBHOOK_SECRET,
    messaging: process.env.MESSAGING_WEBHOOK_SECRET,
  };
  delete process.env.TELNYX_PUBLIC_KEY;
  process.env.VOICE_WEBHOOK_SECRET = 'voice-secret';
  process.env.MESSAGING_WEBHOOK_SECRET = 'message-secret';
  try {
    assert.equal(verifyTelnyxWebhook({ query: { token: 'voice-secret' }, headers: {}, body: {} } as never), true);
    assert.equal(verifyTelnyxWebhook({ query: { token: 'message-secret' }, headers: {}, body: {} } as never), false);
    assert.equal(verifyTelnyxWebhook({ query: { token: 'message-secret' }, headers: {}, body: {} } as never, 'MESSAGING_WEBHOOK_SECRET'), true);
    assert.equal(verifyTelnyxWebhook({ query: { token: 'voice-secret' }, headers: {}, body: {} } as never, 'MESSAGING_WEBHOOK_SECRET'), false);
  } finally {
    if (previous.publicKey === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous.publicKey;
    if (previous.voice === undefined) delete process.env.VOICE_WEBHOOK_SECRET; else process.env.VOICE_WEBHOOK_SECRET = previous.voice;
    if (previous.messaging === undefined) delete process.env.MESSAGING_WEBHOOK_SECRET; else process.env.MESSAGING_WEBHOOK_SECRET = previous.messaging;
  }
});

test('accepts the scoped webhook token when a public key is configured', () => {
  const previous = {
    publicKey: process.env.TELNYX_PUBLIC_KEY,
    voice: process.env.VOICE_WEBHOOK_SECRET,
  };
  process.env.TELNYX_PUBLIC_KEY = Buffer.alloc(32, 1).toString('base64');
  process.env.VOICE_WEBHOOK_SECRET = 'voice-secret';
  try {
    assert.equal(verifyTelnyxWebhook({ query: { token: 'voice-secret' }, headers: {}, body: { parsed: true } } as never), true);
    assert.equal(verifyTelnyxWebhook({ query: { token: 'wrong-secret' }, headers: {}, body: { parsed: true } } as never), false);
  } finally {
    if (previous.publicKey === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous.publicKey;
    if (previous.voice === undefined) delete process.env.VOICE_WEBHOOK_SECRET; else process.env.VOICE_WEBHOOK_SECRET = previous.voice;
  }
});
