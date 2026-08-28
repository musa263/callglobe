import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDialplanTemplate, renderDialplanXml, renderDirectoryXml } from '../src/directory-service.mjs';

test('directory XML groups tenant extensions by SIP domain and escapes values', () => {
  const result = renderDirectoryXml([
    { id: 'a', username: '2000', extension: '2000', password: 'p&<"', domain: 'global-heritage.sip.example.com', name: 'Mousa & Co', organizationId: 'primary', organizationName: 'Global Heritage', outboundCallerId: '+18447161777', photoUrl: 'https://example.com/mousa.jpg' },
    { id: 'b', username: '2000', extension: '2000', password: 'second', domain: 'another.sip.example.com', name: 'Another User', organizationId: 'second' },
  ]);
  assert.match(result, /domain name="global-heritage\.sip\.example\.com"/);
  assert.match(result, /domain name="another\.sip\.example\.com"/);
  assert.match(result, /password" value="p&amp;&lt;&quot;"/);
  assert.match(result, /effective_caller_id_name" value="Mousa &amp; Co"/);
  assert.match(result, /outbound_caller_id_number" value="\+18447161777"/);
  assert.match(result, /vocivo_organization_name" value="Global Heritage"/);
  assert.match(result, /vocivo_caller_photo" value="https:\/\/example.com\/mousa.jpg"/);
  assert.match(result, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<document/);
});

test('empty directory uses the FreeSWITCH not-found response', () => {
  const result = renderDirectoryXml([]);
  assert.match(result, /result status="not found"/);
  assert.match(result, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<document/);
});

test('dialplan routes a DID only to targets from its owning tenant', () => {
  const result = renderDialplanXml([{
    did: '+15551234567',
    organizationId: 'tenant-a',
    organizationName: 'Tenant A',
    destinationType: 'extension',
    destinationId: 'user-a',
    targets: [{ extensionId: 'user-a', extension: '2001', username: 'sip-a', domain: 'tenant-a.sip.example.com' }],
  }], '<context name="vocivo-internal"></context>', 'public');
  assert.match(result, /destination_number" expression="\^\\\+\?15551234567\$"/);
  assert.match(result, /vocivo_organization_id=tenant-a/);
  assert.match(result, /user\/sip-a&#64;tenant-a\.sip\.example\.com/);
  assert.doesNotMatch(result, /primary|PBX_DEFAULT_EXTENSION/);
});

test('assigned DIDs with no active destination fail closed', () => {
  const result = renderDialplanXml([{
    did: '+15557654321', organizationId: 'tenant-b', organizationName: 'Tenant B',
    destinationType: 'extension', destinationId: 'missing', targets: [],
  }], '', 'public');
  assert.match(result, /503 Assigned route has no active destination/);
  assert.doesNotMatch(result, /application="bridge"/);
});

test('dialplan templates are rendered inside the ESL container', () => {
  const result = renderDialplanTemplate('ip=@@PBX_PUBLIC_IP@@ gateway=@@PSTN_GATEWAY_NAME@@', {
    PBX_PUBLIC_IP: '203.0.113.10', PSTN_GATEWAY_NAME: 'carrier-a',
  });
  assert.equal(result, 'ip=203.0.113.10 gateway=carrier-a');
  assert.throws(() => renderDialplanTemplate('@@MISSING@@', {}), /unresolved placeholders/);
});
