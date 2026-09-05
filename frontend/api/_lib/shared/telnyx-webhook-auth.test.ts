import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import test from 'node:test';
import { verifyTelnyxWebhook } from './telnyx-webhook-auth.js';

function signedRequest(body: string, privateKey: KeyObject, timestamp = Math.floor(Date.now() / 1000).toString()): any {
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64');
  return {
    headers: { 'telnyx-signature-ed25519': signature, 'telnyx-timestamp': timestamp },
    query: {},
    rawBody: Buffer.from(body),
    body: undefined,
  };
}

test('accepts a current Telnyx Ed25519 signature and installs the verified JSON body', async () => {
  const previous = process.env.TELNYX_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    const request = signedRequest(JSON.stringify({ data: { id: 'event-1' } }), privateKey);
    assert.equal(await verifyTelnyxWebhook(request), true);
    assert.deepEqual(request.body, { data: { id: 'event-1' } });
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
  }
});

test('verifies the exact raw request stream used by the Vercel Node runtime', async () => {
  const previous = process.env.TELNYX_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = JSON.stringify({ data: { event_type: 'message.received' } });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const request = Readable.from([Buffer.from(body)]) as any;
  request.headers = {
    'telnyx-signature-ed25519': sign(null, Buffer.from(`${timestamp}|${body}`), privateKey).toString('base64'),
    'telnyx-timestamp': timestamp,
  };
  request.query = {};
  try {
    assert.equal(await verifyTelnyxWebhook(request), true);
    assert.deepEqual(request.body, { data: { event_type: 'message.received' } });
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
  }
});

test('verifies the true wire bytes replayed by the Vercel body helper, not a JSON.stringify reconstruction', async () => {
  const previous = process.env.TELNYX_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  // Wire bytes with whitespace JSON.stringify would never reproduce.
  const wire = '{ "data" : { "event_type" : "call.initiated" } }';
  const timestamp = Math.floor(Date.now() / 1000).toString();
  // Mimic @vercel/node's addHelpers: drain the stream, parse req.body, then restoreBody()
  // replays the raw bytes through overridden req.on('data'/'end') and req.read().
  const request = Readable.from([Buffer.from(wire)]) as any;
  const drained: Buffer[] = [];
  for await (const chunk of request) drained.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const raw = Buffer.concat(drained);
  const replica = new PassThrough();
  const replicaOn = replica.on.bind(replica);
  const originalOn = request.on.bind(request);
  request.read = replica.read.bind(replica);
  request.on = request.addListener = (name: string, cb: (...args: unknown[]) => void) =>
    name === 'data' || name === 'end' ? replicaOn(name, cb) : originalOn(name, cb);
  replica.write(raw);
  replica.end();
  request.headers = {
    'telnyx-signature-ed25519': sign(null, Buffer.from(`${timestamp}|${wire}`), privateKey).toString('base64'),
    'telnyx-timestamp': timestamp,
  };
  request.query = {};
  request.body = JSON.parse(wire);
  try {
    assert.equal(await verifyTelnyxWebhook(request), true);
    assert.deepEqual(request.body, { data: { event_type: 'call.initiated' } });
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
  }
});

test('verifies a body already parsed by the Vercel runtime', async () => {
  const previous = process.env.TELNYX_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const body = { data: { event_type: 'call.initiated', id: 'event-parsed' } };
  const serialized = JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const request = {
    headers: {
      'telnyx-signature-ed25519': sign(null, Buffer.from(`${timestamp}|${serialized}`), privateKey).toString('base64'),
      'telnyx-timestamp': timestamp,
    },
    query: {},
    body,
  } as any;
  try {
    assert.equal(await verifyTelnyxWebhook(request), true);
    assert.deepEqual(request.body, body);
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
  }
});

test('rejects query-string secrets, stale signatures, and tampered bodies', async () => {
  const previous = process.env.TELNYX_PUBLIC_KEY;
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  process.env.TELNYX_PUBLIC_KEY = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  try {
    assert.equal(await verifyTelnyxWebhook({ headers: {}, query: { token: 'legacy-secret' }, rawBody: Buffer.from('{}') } as never), false);
    assert.equal(await verifyTelnyxWebhook(signedRequest('{}', privateKey, String(Math.floor(Date.now() / 1000) - 301))), false);
    const tampered = signedRequest('{"safe":true}', privateKey) as { rawBody: Buffer };
    tampered.rawBody = Buffer.from('{"safe":false}');
    assert.equal(await verifyTelnyxWebhook(tampered as never), false);
  } finally {
    if (previous === undefined) delete process.env.TELNYX_PUBLIC_KEY; else process.env.TELNYX_PUBLIC_KEY = previous;
  }
});
