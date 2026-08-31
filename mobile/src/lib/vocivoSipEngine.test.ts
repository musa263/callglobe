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
  assert.match(source, /func swapHeld\(\)/);
  assert.match(source, /func merge\(to target: String/);
  assert.match(source, /replacingActive/);
  assert.match(source, /REGISTER", requestUri: "sip:\\(\(config\.domain\)"/);
  assert.match(source, /Via", "SIP\/2\.0\/WSS invalid;branch=/);
  assert.match(source, /@invalid;transport=ws>/);
  assert.match(source, /\("Content-Length", "\\\(body\.utf8\.count\)"\)/);
  assert.match(source, /uri: "sip:\\(\(config\?\.domain \?\? ""\)"/);
  const credentials = fs.readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../modules/vocivo-sip/ios/VocivoSipCredentials.swift'),
    'utf8',
  );
  assert.doesNotMatch(credentials, /urlStrings\?/, 'RTCIceServer.urlStrings is non-optional in react-native-webrtc');
  const opens = (source.match(/\{/g) || []).length;
  const closes = (source.match(/\}/g) || []).length;
  assert.equal(opens, closes, 'Swift braces must stay balanced');
});
