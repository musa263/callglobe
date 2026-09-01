import assert from 'node:assert/strict';
import test from 'node:test';
import { mapNetworkError } from './api.js';

test('maps browser Failed to fetch to a recoverable calling-service error', () => {
  const mapped = mapNetworkError(new TypeError('Failed to fetch'));
  assert.match(mapped.message, /could not reach the calling service/i);
});

test('maps aborted voice requests to a timeout instead of Failed to fetch', () => {
  const abort = new Error('The user aborted a request.');
  abort.name = 'AbortError';
  assert.match(mapNetworkError(abort).message, /took too long/i);
});

test('leaves API error messages intact', () => {
  assert.equal(mapNetworkError(new Error('That internal destination is not available to this account.')).message, 'That internal destination is not available to this account.');
});
