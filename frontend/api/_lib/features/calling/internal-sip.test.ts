import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultPbxConfig } from '../organizations/pbx-config-store.js';
import { activeOrganizationExtensionTargets, canonicalVoiceDestination, destinationSipUrisForInternalDial, extensionSipUri, extensionSipUsernames, isAllowedInternalSipDestination, organizationExtensionSipUri, parseInternalSipUser, voiceDestinationsMatch } from './internal-sip.js';

test('Telnyx SIP URIs are recognized as internal destinations', () => {
  assert.equal(parseInternalSipUser('sip:2000@sip.telnyx.com'), '2000');
  assert.equal(parseInternalSipUser('sip:2000@sip.telnyx.com:5060'), '2000');
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

test('on the SIP edge an extension is dialled where it is registered, and either host is recognised', () => {
  const previous = { edge: process.env.VOCIVO_VOICE_EDGE, domain: process.env.VOCIVO_SIP_DOMAIN };
  process.env.VOCIVO_VOICE_EDGE = 'sip';
  process.env.VOCIVO_SIP_DOMAIN = 'sip.vocivo.app';
  try {
    assert.equal(extensionSipUri('sam-1001'), 'sip:sam-1001@sip.vocivo.app');
    assert.equal(parseInternalSipUser('sip:sam-1001@sip.vocivo.app'), 'sam-1001');
    // The web client still names the carrier host when it asks for a route.
    assert.equal(parseInternalSipUser('sip:sam-1001@sip.telnyx.com'), 'sam-1001');
    assert.equal(parseInternalSipUser('sip:sam-1001@untrusted.invalid'), null);
  } finally {
    if (previous.edge === undefined) delete process.env.VOCIVO_VOICE_EDGE; else process.env.VOCIVO_VOICE_EDGE = previous.edge;
    if (previous.domain === undefined) delete process.env.VOCIVO_SIP_DOMAIN; else process.env.VOCIVO_SIP_DOMAIN = previous.domain;
  }
});
