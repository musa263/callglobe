import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { prerenderPrompts, receptionistPrerenderItems } from './prompt-prerender.js';
import { receptionistPhrases } from './receptionist.js';

const originalUrl = process.env.TTS_SERVICE_URL;
const originalSecret = process.env.TTS_SERVICE_SECRET;

afterEach(() => {
  if (originalUrl === undefined) delete process.env.TTS_SERVICE_URL;
  else process.env.TTS_SERVICE_URL = originalUrl;
  if (originalSecret === undefined) delete process.env.TTS_SERVICE_SECRET;
  else process.env.TTS_SERVICE_SECRET = originalSecret;
});

test('prompts are queued at the voice engine with the shared secret, trimmed and bounded', async () => {
  process.env.TTS_SERVICE_URL = 'https://sip.vocivo.app/tts/';
  process.env.TTS_SERVICE_SECRET = 'engine-secret';
  const seen: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init || {} });
    return new Response(JSON.stringify({ queued: 2, cached: 1 }), { status: 202, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  const result = await prerenderPrompts([
    { input: '  Welcome to Acme. ', voice: 'af_heart' },
    { input: '', voice: 'af_heart' },
    { input: 'Please hold.', voice: 'am_adam' },
  ], fetchImpl);

  assert.deepEqual(result, { queued: 2, cached: 1 });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://sip.vocivo.app/tts/v1/audio/prerender');
  assert.equal((seen[0].init.headers as Record<string, string>).Authorization, 'Bearer engine-secret');
  assert.deepEqual(JSON.parse(String(seen[0].init.body)), {
    items: [{ input: 'Welcome to Acme.', voice: 'af_heart' }, { input: 'Please hold.', voice: 'am_adam' }],
  });
});

test('an engine that is down or unconfigured costs the save nothing', async () => {
  delete process.env.TTS_SERVICE_URL;
  assert.equal(await prerenderPrompts([{ input: 'Hello', voice: 'af_heart' }], async () => { throw new Error('must not be called'); }), null);

  process.env.TTS_SERVICE_URL = 'https://sip.vocivo.app/tts';
  const failing = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
  assert.equal(await prerenderPrompts([{ input: 'Hello', voice: 'af_heart' }], failing), null);
  const refused = (async () => new Response('nope', { status: 503 })) as typeof fetch;
  assert.equal(await prerenderPrompts([{ input: 'Hello', voice: 'af_heart' }], refused), null);
});

test('a receptionist renders its greeting and every fixed phrase in its own voice', () => {
  const ai = { ...defaultPbxConfig().ai, enabled: true, greeting: 'Thanks for calling Acme, how can I help?', voice: 'Vocivo.Kokoro.AmAdam' };
  const items = receptionistPrerenderItems(ai);
  assert.equal(items[0].input, 'Thanks for calling Acme, how can I help?');
  assert.ok(items.every((item) => item.voice === 'am_adam'), 'the catalog id is translated to the engine voice');
  for (const phrase of receptionistPhrases) assert.ok(items.some((item) => item.input === phrase), phrase);
  assert.deepEqual(receptionistPrerenderItems({ ...ai, enabled: false }), [], 'a disabled receptionist renders nothing');
});
