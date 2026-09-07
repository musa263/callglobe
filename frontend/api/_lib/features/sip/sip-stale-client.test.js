import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { UserAgentClient } from 'sip.js/lib/core/user-agents/user-agent-client.js';
import { IncomingResponseMessage } from 'sip.js/lib/core/messages/incoming-response-message.js';

// Exercise installed SIP.js authentication control flow and header parsing.
// Transport and password hashing are isolated; the API tests verify Digest.
test('the edge stale challenge permits exactly one SIP.js authentication retry', () => {
  const config = readFileSync(new URL('../../../../../services/sip/kamailio/kamailio.cfg', import.meta.url), 'utf8');
  const raw = config.split('\n').find(line => line.includes('WWW-Authenticate:') && line.includes('stale=true'));
  assert.ok(raw);
  const header = raw.slice(raw.indexOf('Digest '), raw.lastIndexOf('\\r\\n'))
    .replaceAll('\\"', '"').replace('$env(VOCIVO_SIP_REALM)', 'sip.example').replace('$var(nonce)', 'fresh-nonce');
  const response = new IncomingResponseMessage();
  response.statusCode = 401;
  response.addHeader('WWW-Authenticate', header);
  assert.equal(response.parseHeader('www-authenticate').stale, true);
  let retries = 0;
  const client = Object.assign(Object.create(UserAgentClient.prototype), {
    challenged: true, stale: false,
    logger: { warn() {} },
    credentials: { authenticate: () => true, toString: () => 'Digest test' },
    message: { cseq: 2, method: 'REGISTER', setHeader() {} },
    init: () => { retries++; },
  });
  assert.equal(client.authenticationGuard(response), false, 'fresh challenge retried');
  assert.equal(client.message.cseq, 3);
  assert.equal(client.authenticationGuard(response), true, 'repeated stale challenge stops');
  assert.equal(retries, 1);
});
