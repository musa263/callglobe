import assert from 'node:assert/strict';
import test from 'node:test';
import { carrierFallbackVoice, isVocivoVoice, vocivoVoices } from './voice-catalog.js';

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
