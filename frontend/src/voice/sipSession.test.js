import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const source = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), './sipSession.js'), 'utf8');

test('web SIP reconnects after an abnormal WebSocket close', () => {
  assert.match(source, /reconnectionAttempts: 12/);
  assert.match(source, /keepAliveInterval: 30/);
  assert.match(source, /await sending/);
});
