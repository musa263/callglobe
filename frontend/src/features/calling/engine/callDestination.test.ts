import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCallInput, resolveCallDestination } from './callDestination.js';
const company = { business: true, ownExtension: '2000', countryCode: 'SA', dialCode: '+966', directory: [{ id: 'user-3', extension: '2003', name: 'Colleague' }] };
test('detects company extensions, self calls and missing directory matches without carrier fallback', () => {
  assert.equal(resolveCallDestination('2003', company).kind, 'internal');
  assert.equal(resolveCallDestination('2000', company).kind, 'self');
  assert.equal(resolveCallDestination('2004', company).kind, 'unknown-extension');
  assert.equal(resolveCallDestination('2003', { ...company, directory: [] }).kind, 'unknown-extension');
  assert.equal(resolveCallDestination('2003', { ...company, directory: [...company.directory, ...company.directory] }).kind, 'unknown-extension');
  assert.notEqual(resolveCallDestination('2003', { ...company, business: false }).kind, 'internal');
});
test('normalizes public numbers and Arabic digits without interpreting international prefixes as extensions', () => {
  for (const value of ['0535548337', '+966535548337', '00966535548337', '966535548337', '٠٥٣٥٥٤٨٣٣٧']) {
    const route = resolveCallDestination(value, company);
    assert.equal(route.kind, 'external'); assert.equal(route.number, '+966535548337');
  }
  assert.equal(cleanCallInput('sip:2003@example.invalid'), '');
  assert.notEqual(resolveCallDestination('+2003', company).kind, 'internal');
  assert.notEqual(resolveCallDestination('002003', company).kind, 'internal');
});
