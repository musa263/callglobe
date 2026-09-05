import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { prerenderPrompts, receptionistPrerenderItems, splitSpokenSentences } from './prompt-prerender.js';
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

test('a receptionist renders its greeting and every fixed phrase in its own voice, in spoken pieces', () => {
  const ai = { ...defaultPbxConfig().ai, enabled: true, greeting: 'Thanks for calling Acme. How can I help?', voice: 'Vocivo.Kokoro.AfBella' };
  const items = receptionistPrerenderItems(ai);
  assert.deepEqual(items.slice(0, 2).map((item) => item.input), ['Thanks for calling Acme.', 'How can I help?']);
  assert.ok(items.every((item) => item.voice === 'af_bella'), 'the catalog id is translated to the engine voice');
  for (const phrase of receptionistPhrases) {
    for (const piece of splitSpokenSentences(phrase)) assert.ok(items.some((item) => item.input === piece), piece);
  }
  assert.deepEqual(receptionistPrerenderItems({ ...ai, enabled: false }), [], 'a disabled receptionist renders nothing');
});

test('sentences are split the way the receptionist speaks them', () => {
  // The same cases as services/receptionist/tests (SentenceSplitting): the two
  // implementations must agree or the pre-rendered cache is never hit.
  assert.deepEqual(splitSpokenSentences('We close at five. Thanks for calling! Anything else?'), ['We close at five.', 'Thanks for calling!', 'Anything else?']);
  assert.deepEqual(splitSpokenSentences('Yes. We are open until nine tonight.'), ['Yes. We are open until nine tonight.']);
  assert.deepEqual(splitSpokenSentences('   '), []);
  assert.deepEqual(splitSpokenSentences('No punctuation at all'), ['No punctuation at all']);
  assert.deepEqual(splitSpokenSentences('Hello\n\n  there.   Bye now.'), ['Hello there. Bye now.']);
  const many = Array.from({ length: 20 }, (_, index) => `Sentence number ${index} is here.`).join(' ');
  const parts = splitSpokenSentences(many);
  assert.equal(parts.length, 8);
  assert.ok(parts[parts.length - 1].endsWith('Sentence number 19 is here.'));
});
