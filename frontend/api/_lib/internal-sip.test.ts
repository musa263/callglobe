import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { activeOrganizationExtensionTargets, isAllowedInternalSipDestination, organizationExtensionSipUri, parseInternalSipUser } from './internal-sip.js';

test('Telnyx SIP URIs are recognized as internal destinations', () => {
  assert.equal(parseInternalSipUser('sip:2000@sip.telnyx.com'), '2000');
  assert.equal(isAllowedInternalSipDestination('sip:employee@sip.telnyx.com'), true);
});

test('organization extension routing always produces a Telnyx SIP URI', () => {
  assert.equal(
    organizationExtensionSipUri(defaultPbxConfig(), 'primary', '2000'),
    'sip:2000@sip.telnyx.com',
  );
});

test('rejects untrusted SIP hosts', () => {
  assert.equal(parseInternalSipUser('sip:2000@untrusted.invalid'), null);
  assert.equal(isAllowedInternalSipDestination('sip:2000@evil.example.com'), false);
});

test('main-line fanout includes active extensions from only the owning tenant', () => {
  const config = defaultPbxConfig();
  config.organizations.push({
    id: 'other', name: 'Other Company', slug: 'other-company', accountType: 'business',
    ownerDisplayName: 'Other Owner', ownerEmail: 'owner@other.example', status: 'active',
    extensionStart: 3000, extensionEnd: 3010, internalCallingEnabled: true,
  });
  const targets = activeOrganizationExtensionTargets(config, 'primary', [
    { id: 'active-primary', organizationId: 'primary', status: 'active', sipUsername: 'primary-user' },
    { id: 'expired-primary', organizationId: 'primary', status: 'expired', sipUsername: 'old-user' },
    { id: 'active-other', organizationId: 'other', status: 'active', sipUsername: 'other-user' },
  ]);
  assert.deepEqual(targets, [
    { extensionId: 'active-primary', destination: 'sip:primary-user@sip.telnyx.com' },
  ]);
});
