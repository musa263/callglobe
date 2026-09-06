import assert from 'node:assert/strict';
import test from 'node:test';
import { canRedialHistory, normalizeHistoryIdentity } from './historyIdentity';
import type { CallLog } from '../../../shared/types';

const username = 'gencredkzOCCkVFTcouFTsLExmx8bpsPjDgrXS4npsOQTTRnF';
const call: CallLog = { id: 'one', destination_number: username, destination_name: 'Mousa', duration_seconds: 31, total_cost: 0, status: 'completed', started_at: '2026-09-07T00:16:00Z' };
const directory = [{ extension: '2000', name: 'Mousa', sipUsername: username }];

for (const address of [username, `sip:${username}@sip.example`, `sips:${username}@sip.example;transport=tls`, `"Mousa" <sip:${username}@sip.example>`]) {
  test(`resolves ${address.startsWith('gencred') ? 'bare credentials' : 'SIP address'} to a tenant colleague`, () => {
    const result = normalizeHistoryIdentity({ ...call, destination_number: address }, directory);
    assert.equal(result.destination_number, '2000');
    assert.equal(result.destination_name, 'Mousa');
    assert.equal(result.internal, true);
    assert.equal(canRedialHistory(result), true);
    assert.ok(!JSON.stringify(result).includes(username));
    assert.deepEqual(normalizeHistoryIdentity(result), result);
  });
}

test('unresolved credential names remain readable and cannot be redialed as random digits', () => {
  const result = normalizeHistoryIdentity(call, [{ extension: '9999', name: 'Another user', sipUsername: 'unrelated' }]);
  assert.equal(result.destination_name, 'Mousa');
  assert.equal(result.destination_number, '');
  assert.equal(canRedialHistory(result), false);
  assert.ok(!JSON.stringify(result).includes(username));
  assert.equal(normalizeHistoryIdentity({ ...call, destination_name: username }).destination_name, 'Company extension');
});

test('keeps public phone numbers and known extension numbers dialable', () => {
  const external = normalizeHistoryIdentity({ ...call, destination_number: '+966535548337', destination_name: null, destination_country: 'Saudi Arabia' });
  assert.equal(external.destination_number, '+966535548337');
  assert.equal(external.internal, undefined);
  assert.equal(canRedialHistory(external), true);
  assert.equal(normalizeHistoryIdentity({ ...call, destination_number: '2000', internal: true }).destination_number, '2000');
});
