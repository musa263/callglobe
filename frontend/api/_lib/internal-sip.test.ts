import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { organizationSipDomain } from './voice-provider.js';
import { isAllowedInternalSipDestination, organizationExtensionSipUri, parseInternalSipUser } from './internal-sip.js';

test('legacy Telnyx SIP URIs are recognized as internal destinations', () => {
  assert.equal(parseInternalSipUser('sip:2000@sip.telnyx.com'), '2000');
  assert.equal(isAllowedInternalSipDestination('sip:employee@sip.telnyx.com'), true);
});

test('FreeSWITCH organization SIP URIs are recognized as internal destinations', () => {
  const config = defaultPbxConfig();
  config.platform = {
    ...config.platform,
    mediaPlane: 'vocivo',
    pbxEngine: 'freeswitch',
    sipDomain: 'sip.68.183.244.215.nip.io',
    websocketUrl: 'wss://sip-wss.68.183.244.215.nip.io',
  };
  const host = organizationSipDomain(config, 'primary');
  const destination = `sip:2000@${host}`;
  assert.match(host, /sip\.68\.183\.244\.215\.nip\.io$/);
  assert.equal(parseInternalSipUser(destination, host), '2000');
  assert.equal(isAllowedInternalSipDestination(destination, host), true);
  assert.equal(organizationExtensionSipUri(config, 'primary', '2000', 'freeswitch'), destination);
});

test('rejects SIP hosts that do not belong to the organization', () => {
  const host = organizationSipDomain(defaultPbxConfig(), 'primary');
  assert.equal(parseInternalSipUser('sip:2000@other-tenant.sip.example.com', host), null);
  assert.equal(isAllowedInternalSipDestination('sip:2000@evil.example.com', host), false);
});
