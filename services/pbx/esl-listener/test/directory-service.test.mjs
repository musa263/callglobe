import assert from 'node:assert/strict';
import test from 'node:test';
import { renderDirectoryXml } from '../src/directory-service.mjs';

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
});

test('empty directory uses the FreeSWITCH not-found response', () => {
  assert.match(renderDirectoryXml([]), /result status="not found"/);
});
