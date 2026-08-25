import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeTrunkPolicy } from './trunk-policy-store.js';

test('normalizes trunk directions, codecs and operational limits', () => {
  const policy = normalizeTrunkPolicy('trunk-1', { inboundEnabled: false, outboundEnabled: true, channelLimit: 50000, priority: 0, codecs: ['PCMU', 'BAD', 'OPUS'], inboundDids: [' +18447161777 ', ''] });
  assert.equal(policy.inboundEnabled, false);
  assert.equal(policy.outboundEnabled, true);
  assert.equal(policy.channelLimit, 10000);
  assert.equal(policy.priority, 1);
  assert.deepEqual(policy.codecs, ['PCMU', 'OPUS']);
  assert.deepEqual(policy.inboundDids, ['+18447161777']);
});

test('allows an operator to clear optional routing fields', () => {
  const current = normalizeTrunkPolicy('trunk-1', { defaultDestination: '2000', outboundPrefix: '9', failoverTrunkId: 'backup', notes: 'legacy' });
  const updated = normalizeTrunkPolicy('trunk-1', { defaultDestination: '', outboundPrefix: '', failoverTrunkId: '', notes: '' }, current);
  assert.equal(updated.defaultDestination, '');
  assert.equal(updated.outboundPrefix, '');
  assert.equal(updated.failoverTrunkId, '');
  assert.equal(updated.notes, '');
});
