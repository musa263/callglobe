import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Structural regression guard only; deployment still needs Kamailio's parser
// and wire-level tests with an untrusted source and an allowlisted carrier.
test('public SIP extension lookup and push require an allowlisted trunk source', () => {
  const config = readFileSync(new URL('../../../services/sip/kamailio/kamailio.cfg', import.meta.url), 'utf8');
  const start = config.indexOf('if ($Rp != 8080 && $si != "127.0.0.1")');
  const end = config.indexOf('# Wake the iPhone, then fork', start);
  assert.ok(start > -1 && end > start);
  const publicIngress = config.slice(start, end);
  assert.match(publicIngress, /route\(TRUNK_SOURCE\);\s*if \(\$var\(from_trunk\) != 1\) \{\s*sl_send_reply\("403", "Forbidden"\);\s*exit;\s*\}/);
  const guard = publicIngress.indexOf('route(TRUNK_SOURCE)');
  assert.ok(guard < publicIngress.indexOf('lookup("location")'));
  assert.ok(guard < publicIngress.indexOf('route(WAKEUP_NOW)'));
});
