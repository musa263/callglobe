import assert from 'node:assert/strict';
import test from 'node:test';
import { carrierFallbackVoice, defaultVocivoVoice, isVocivoVoice, promptVoice, vocivoVoices } from './voice-catalog.js';

test('publishes balanced in-house voice choices with carrier fallbacks', () => {
  assert.equal(vocivoVoices.length, 37);
  assert.equal(vocivoVoices.filter((voice) => voice.gender === 'female').length, 19);
  assert.equal(vocivoVoices.filter((voice) => voice.gender === 'male').length, 18);
  assert.deepEqual(new Set(vocivoVoices.map((voice) => voice.language)), new Set(['English', 'Spanish', 'French', 'Italian', 'Portuguese']));
  for (const voice of vocivoVoices) {
    assert.equal(isVocivoVoice(voice.id), true);
    assert.equal(carrierFallbackVoice(voice.id), `Telnyx.KokoroTTS.${voice.sourceVoice}`);
  }
});

test('preserves an existing carrier voice', () => {
  assert.equal(carrierFallbackVoice('AWS.Polly.Joanna-Neural'), 'AWS.Polly.Joanna-Neural');
});

test('a SIP prompt keeps a Vocivo voice as chosen', () => {
  assert.equal(promptVoice('Vocivo.Kokoro.AmAdam', true), 'Vocivo.Kokoro.AmAdam');
});

test('a SIP prompt speaks a carrier voice id with Vocivo\'s default voice once the service is configured', () => {
  // The tenant picked this before the switch to self-hosted speech; leaving it
  // would send every SIP prompt to the carrier's synthesis.
  assert.equal(promptVoice('AWS.Polly.Joanna-Neural', true), defaultVocivoVoice);
  assert.equal(promptVoice('AWS.Polly.Joanna-Neural', false), 'AWS.Polly.Joanna-Neural');
});
