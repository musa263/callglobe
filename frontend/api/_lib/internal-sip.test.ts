import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from './pbx-config-store.js';
import { activeOrganizationExtensionTargets, canonicalVoiceDestination, clientExtensionSipUri, destinationSipUrisForInternalDial, extensionSipUsernames, isAllowedInternalSipDestination, organizationExtensionSipUri, parseInternalSipUser, voiceDestinationsMatch } from './internal-sip.js';

test('Telnyx SIP URIs are recognized as internal destinations', () => {
  assert.equal(parseInternalSipUser('sip:2000@sip.telnyx.com'), '2000');
  assert.equal(isAllowedInternalSipDestination('sip:employee@sip.telnyx.com'), true);
});

test('Vocivo SIP URIs are recognized as internal destinations on the SIP edge', () => {
  const previousEdge = process.env.VOCIVO_VOICE_EDGE;
  const previousDomain = process.env.VOCIVO_SIP_DOMAIN;
  process.env.VOCIVO_VOICE_EDGE = 'sip';
  process.env.VOCIVO_SIP_DOMAIN = 'sip.vocivo.app';
  try {
    assert.equal(parseInternalSipUser('sip:employee@sip.vocivo.app'), 'employee');
    assert.equal(parseInternalSipUser('sip:employee@sip.telnyx.com'), 'employee');
    assert.equal(organizationExtensionSipUri(defaultPbxConfig(), 'primary', '2000'), 'sip:2000@sip.vocivo.app');
    assert.equal(clientExtensionSipUri('2000'), 'sip:2000@sip.vocivo.app');
  } finally {
    if (previousEdge === undefined) delete process.env.VOCIVO_VOICE_EDGE;
    else process.env.VOCIVO_VOICE_EDGE = previousEdge;
    if (previousDomain === undefined) delete process.env.VOCIVO_SIP_DOMAIN;
    else process.env.VOCIVO_SIP_DOMAIN = previousDomain;
  }
});

test('organization extension routing follows the active voice edge', () => {
  assert.equal(
    organizationExtensionSipUri(defaultPbxConfig(), 'primary', '2000'),
    'sip:2000@sip.telnyx.com',
  );
});

test('rejects untrusted SIP hosts', () => {
  assert.equal(parseInternalSipUser('sip:2000@untrusted.invalid'), null);
  assert.equal(isAllowedInternalSipDestination('sip:2000@evil.example.com'), false);
});

test('matches a Telnyx webhook address after the carrier strips its SIP scheme', () => {
  assert.equal(canonicalVoiceDestination('device-user@sip.telnyx.com'), 'sip:device-user@sip.telnyx.com');
  assert.equal(voiceDestinationsMatch('sip:device-user@sip.telnyx.com', 'device-user@sip.telnyx.com'), true);
  assert.equal(voiceDestinationsMatch('sip:device-user@sip.telnyx.com', 'other-user@sip.telnyx.com'), false);
});

test('internal dial never includes the caller extension SIP aliases', () => {
  assert.deepEqual(destinationSipUrisForInternalDial(
    ['callee-user', 'caller-user'],
    ['caller-user'],
    'sip:callee-user@sip.telnyx.com',
  ), ['sip:callee-user@sip.telnyx.com']);
  assert.deepEqual(destinationSipUrisForInternalDial(
    ['caller-user'],
    ['caller-user'],
    'sip:callee-user@sip.telnyx.com',
  ), ['sip:callee-user@sip.telnyx.com']);
});

test('fans out an extension to every active credential alias in the same tenant', () => {
  const target = { organizationId: 'primary', extension: '2001', status: 'active', sipUsername: 'current-user' };
  assert.deepEqual(extensionSipUsernames(target, [
    target,
    { organizationId: 'primary', extension: '2001', status: 'active', sipUsername: 'legacy-user' },
    { organizationId: 'primary', extension: '2001', status: 'expired', sipUsername: 'expired-user' },
    { organizationId: 'primary', extension: '2000', status: 'active', sipUsername: 'other-extension' },
    { organizationId: 'other', extension: '2001', status: 'active', sipUsername: 'other-tenant' },
  ]), ['current-user', 'legacy-user']);
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
