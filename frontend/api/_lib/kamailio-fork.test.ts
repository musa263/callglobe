import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const cfg = fs.readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../services/sip/kamailio/kamailio.cfg'),
  'utf8',
);

test('Kamailio wakes the phone then forks live contacts without blocking WebSocket REGISTER', () => {
  assert.match(cfg, /append_branches", 1/);
  assert.match(cfg, /async", "workers", 16/);
  assert.match(cfg, /cors_mode", 2/);
  assert.match(cfg, /\$Rp != 8080 && \$fU =~ "\^\[0-9\]\{1,8\}\$"/);
  assert.match(cfg, /\$rU =~ "\^\[0-9\]\{1,8\}\$"/);
  assert.match(cfg, /WAKEUP_NOW/);
  assert.match(cfg, /if \(lookup\("location"\)\)/);
  assert.doesNotMatch(cfg, /async_route\("WAIT_REGISTER", "1200"\)/);
  assert.doesNotMatch(cfg, /async_route\("WAIT_REGISTER", "1000"\)/);
  assert.match(cfg, /async_route\("WAIT_REGISTER", "1"\)/);
  assert.match(cfg, /autodrop", 0/);
  assert.match(cfg, /\$Rp != 8080 && !sanity_check/);
  assert.match(cfg, /REGISTER challenge \$fU/);
  assert.match(cfg, /REGISTER ok \$fU/);
  assert.match(cfg, /route\(REFER\)/);
  assert.match(cfg, /\$rU =~ "\^conf-"/);
});
