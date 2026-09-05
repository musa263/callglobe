import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Structural regression guard only; deployment still needs Kamailio's parser
// and wire-level tests with an untrusted source and an allowlisted carrier.
test('public SIP extension lookup and push require an allowlisted trunk source', () => {
  const config = readFileSync(new URL('../../../../../services/sip/kamailio/kamailio.cfg', import.meta.url), 'utf8');
  const start = config.indexOf('if ($Rp != 8080 && $si != "127.0.0.1")');
  const end = config.indexOf('# Wake the iPhone, then fork', start);
  assert.ok(start > -1 && end > start);
  const publicIngress = config.slice(start, end);
  assert.match(publicIngress, /route\(TRUNK_SOURCE\);\s*if \(\$var\(from_trunk\) != 1\) \{\s*sl_send_reply\("403", "Forbidden"\);\s*exit;\s*\}/);
  const guard = publicIngress.indexOf('route(TRUNK_SOURCE)');
  assert.ok(guard < publicIngress.indexOf('route(DELIVER_EXTENSION)'));
});

test('late REGISTER appends to a bounded transaction, never an eight-second poll', () => {
  const config = readFileSync(new URL('../../../../../services/sip/kamailio/kamailio.cfg', import.meta.url), 'utf8');
  assert.match(config, /ts_append_by_contact\("location", "\$tu"\)/);
  const delivery = config.slice(config.indexOf('route[DELIVER_EXTENSION]'), config.indexOf('route[CDR_ENQUEUE]'));
  assert.ok(delivery.indexOf('ts_store(') < delivery.indexOf('ts_append('));
  assert.match(delivery, /t_set_max_lifetime\(45000, 45000\)/);
  assert.match(delivery, /if \(!t_suspend\(\)\) \{\s*rtpengine_delete\(\);/);
  assert.doesNotMatch(config, /WAIT_REGISTER|async_route\("WAKEUP",\s*"8"\)/);
});

test('known dialog routing precedes initial INVITE and conferences fail closed', () => {
  const config = readFileSync(new URL('../../../../../services/sip/kamailio/kamailio.cfg', import.meta.url), 'utf8');
  assert.ok(config.indexOf('if (has_totag())') < config.indexOf('route(INVITE)'));
  assert.match(config, /!loose_route\(\) \|\| !is_known_dlg\(\)/);
  assert.match(config, /sl_send_reply\("403", "Conference admission required"\)/);
  const xml = readFileSync(new URL('../../../../../services/sip/freeswitch/dialplan/public.xml', import.meta.url), 'utf8');
  assert.doesNotMatch(xml, /application="conference"/);
});
