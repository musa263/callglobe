import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanDialInput, defaultDialRegion, dialRegion, resolveCallDestination, resolveDialNumber } from './dialNumber';

test('does not assume Saudi Arabia when device region is missing', () => {
  assert.equal(defaultDialRegion(null, null), undefined);
  assert.equal(resolveDialNumber('0501234567').valid, false);
});
test('local numbers use device region and strip the national trunk prefix', () => {
  assert.equal(defaultDialRegion('AE', '+966501234567'), 'AE');
  assert.equal(resolveDialNumber('050 123 4567', 'AE').number, '+971501234567');
  assert.equal(resolveDialNumber('0501234567', 'SA').number, '+966501234567');
  assert.equal(resolveDialNumber('020 7946 0018', 'GB').number, '+442079460018');
});
test('international contacts override the selected or device region', () => {
  assert.equal(resolveDialNumber('+44 20 7946 0018', 'SA').number, '+442079460018');
  assert.equal(resolveDialNumber('0044 20 7946 0018', 'AE').number, '+442079460018');
  assert.equal(resolveDialNumber('+966501234567', 'AE').number, '+966501234567');
});
test('contact country metadata can interpret national numbers', () => {
  assert.equal(dialRegion('gb'), 'GB');
  assert.equal(resolveDialNumber('02079460018', dialRegion('gb')).number, '+442079460018');
  assert.equal(dialRegion('XX'), undefined);
});
test('NANP destinations are resolved by number, not first shared +1 rate', () => {
  const result = resolveDialNumber('+14165550123', 'SA', [
    { id: 'us', country_code: 'US', country_name: 'United States', dial_code: '+1', flag: null, rate_per_min: 0.02 },
    { id: 'ca', country_code: 'CA', country_name: 'Canada', dial_code: '+1', flag: null, rate_per_min: 0.03 },
  ]);
  assert.equal(result.country, 'CA');
  assert.equal(result.rate.id, 'ca');
});
test('short extensions never become external international calls', () => {
  assert.equal(resolveDialNumber('2001', 'SA').valid, false);
  assert.equal(resolveDialNumber('+966', 'SA').number, '');
});
test('supports Arabic digits and retains an editable plus prefix', () => {
  assert.equal(cleanDialInput('+٩٦٦ ٥٠١٢٣٤٥٦٧'), '+966501234567');
  assert.equal(cleanDialInput('+۹۶۶ ۵۰۱۲۳۴۵۶۷'), '+966501234567');
  assert.equal(resolveDialNumber('+٩٦٦ ٥٠١٢٣٤٥٦٧').number, '+966501234567');
});
test('explicit number can be resolved without rates or a device region', () => {
  const result = resolveDialNumber('+442079460018');
  assert.equal(result.valid, true);
  assert.equal(result.rate.rate_per_min, null);
  assert.equal(result.country, 'GB');
});

const routing = { business: true, ownExtension: '2000', directory: [{ id: 'member', extension: '2001', name: 'Jamie' }], region: 'AE' as const };
test('automatic routing only recognizes exact company extension matches', () => {
  assert.equal(resolveCallDestination('2001', routing).kind, 'internal');
  assert.equal(resolveCallDestination('200', routing).kind, 'unknown-extension');
  assert.equal(resolveCallDestination('2000', routing).kind, 'self');
  assert.equal(resolveCallDestination('20011', routing).kind, 'unknown-extension');
  assert.equal(resolveCallDestination('+2001', routing).kind, 'incomplete');
  assert.equal(resolveCallDestination('002001', routing).kind, 'incomplete');
});
test('personal accounts and ambiguous duplicate extensions never select an internal route', () => {
  assert.equal(resolveCallDestination('2001', { ...routing, business: false }).kind, 'incomplete');
  assert.equal(resolveCallDestination('2001', { ...routing, directory: [...routing.directory, { id: 'duplicate', extension: '2001', name: 'Other' }] }).kind, 'unknown-extension');
});
test('full numbers become external without a mode change or directory request', () => {
  for (const value of ['0501234567', '+971501234567', '00971501234567']) {
    const result = resolveCallDestination(value, { ...routing, directory: [] });
    assert.equal(result.kind, 'external');
    assert.equal(result.destination.number, '+971501234567');
  }
});
test('legacy SIP identifiers never become an accidental external phone number', () => {
  for (const value of ['sip:0501234567@edge.invalid', 'Jamie <sips:2001@edge.invalid>']) {
    assert.equal(cleanDialInput(value), '');
    assert.equal(resolveCallDestination(value, routing).kind, 'incomplete');
  }
});
