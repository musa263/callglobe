import assert from 'node:assert/strict';
import test from 'node:test';
import { looksLikeWav, wavDurationSeconds } from './routes/voice-sip-voicemail.js';

function wav(seconds: number) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.write('WAVE', 8, 'ascii');
  return Buffer.concat([header, Buffer.alloc(seconds * 16000)]);
}

test('only accepts RIFF/WAVE payloads with audio after the header', () => {
  assert.equal(looksLikeWav(wav(3)), true);
  assert.equal(looksLikeWav(Buffer.alloc(44)), false, 'header-only file has no audio');
  assert.equal(looksLikeWav(Buffer.from('ID3' + 'x'.repeat(100))), false, 'mp3 is rejected');
  assert.equal(looksLikeWav(Buffer.from('<html>' + 'x'.repeat(100))), false);
});

test('estimates duration from the 8 kHz mono 16-bit byte rate the dialplan records at', () => {
  assert.equal(wavDurationSeconds(wav(12)), 12);
  assert.equal(wavDurationSeconds(wav(0)), 0);
  assert.equal(wavDurationSeconds(Buffer.alloc(10)), 0, 'never negative');
});
