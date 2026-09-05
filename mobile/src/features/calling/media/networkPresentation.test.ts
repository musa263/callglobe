import assert from 'node:assert/strict';
import test from 'node:test';
import { networkPresentation } from './networkPresentation';

test('a connected voice socket overrides an inconclusive reachability probe', () => {
  assert.deepEqual(networkPresentation('wifi', { strength: 80 }, true, false, true), {
    bars: 4,
    label: 'Wi-Fi',
    status: 'Voice ready',
  });
});

test('unknown NetInfo initialization does not falsely report no connection', () => {
  assert.deepEqual(networkPresentation('unknown', null, null, null, false), {
    bars: 2,
    label: 'Checking network',
    status: 'Connecting voice',
  });
});

test('an explicit disconnected transport reports no connection', () => {
  assert.deepEqual(networkPresentation('none', null, false, false, false), {
    bars: 0,
    label: 'Offline',
    status: 'No connection',
  });
});
