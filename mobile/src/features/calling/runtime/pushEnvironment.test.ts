import assert from 'node:assert/strict';
import test from 'node:test';
import { pushEnvironment } from './pushEnvironment';
test('APNs follows signing even when JavaScript build mode differs', () => {
  assert.equal(pushEnvironment('sandbox', false), 'sandbox');
  assert.equal(pushEnvironment('production', true), 'production');
  assert.equal(pushEnvironment(undefined, true), 'sandbox');
  assert.equal(pushEnvironment('invalid', false), 'production');
});
