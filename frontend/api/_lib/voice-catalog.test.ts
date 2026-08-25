import assert from 'node:assert/strict';
import test from 'node:test';
import { carrierFallbackVoice, isVocivoVoice, vocivoVoices } from './voice-catalog.js';

test('publishes balanced in-house voice choices with carrier fallbacks', () => {
  assert.equal(vocivoVoices.filter((voice) => voice.gender === 'female').length, 2);
  assert.equal(vocivoVoices.filter((voice) => voice.gender === 'male').length, 2);
  for (const voice of vocivoVoices) {
    assert.equal(isVocivoVoice(voice.id), true);
    assert.match(carrierFallbackVoice(voice.id), /^(AWS\.Polly|Telnyx\.)/);
  }
});

test('preserves an existing carrier voice', () => {
  assert.equal(carrierFallbackVoice('AWS.Polly.Joanna-Neural'), 'AWS.Polly.Joanna-Neural');
});
