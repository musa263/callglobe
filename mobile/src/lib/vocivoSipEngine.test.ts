import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const enginePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../modules/vocivo-sip/ios/VocivoSipEngine.swift');

test('VocivoSipEngine keeps hangup after VoIP push handling', () => {
  const source = fs.readFileSync(enginePath, 'utf8');
  assert.match(source, /func handleVoipPush\(/);
  assert.match(source, /func hangup\(callId: String\?\)/);
  assert.match(source, /func answer\(callId: String\?\)/);
  const opens = (source.match(/\{/g) || []).length;
  const closes = (source.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'Swift braces must stay balanced');
});
