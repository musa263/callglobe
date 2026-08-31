import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cfg = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../services/sip/kamailio/kamailio.cfg'),
  'utf8',
);

test('Kamailio forks equal-q contacts and wakes the phone even when web is registered', () => {
  assert.match(cfg, /append_branches", 1/);
  assert.match(cfg, /;q=0\.5/);
  assert.match(cfg, /Always VoIP-push the iPhone/);
  assert.match(cfg, /async_route\("WAIT_REGISTER", "1200"\)/);
  assert.match(cfg, /route\(REFER\)/);
  assert.match(cfg, /\$rU =~ "\^conf-"/);
});
