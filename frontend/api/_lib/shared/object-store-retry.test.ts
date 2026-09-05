import assert from 'node:assert/strict';
import test from 'node:test';
import { transientDatabaseError } from './object-store.js';

test('retries the connection timeout code emitted by postgres.js', () => {
  assert.equal(transientDatabaseError({ code: 'CONNECT_TIMEOUT', message: 'write CONNECT_TIMEOUT undefined:undefined' }), true);
});

test('does not retry permanent database errors', () => {
  assert.equal(transientDatabaseError({ code: '23505', message: 'duplicate key value violates unique constraint' }), false);
});
