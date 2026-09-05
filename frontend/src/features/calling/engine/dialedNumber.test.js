import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveDialedNumber } from './dialedNumber.js';

test('a local number gets the selected country in front of it', () => {
  assert.equal(resolveDialedNumber('0501234567', 'AE', '+971'), '+971501234567');
  assert.equal(resolveDialedNumber('501234567', 'AE', '+971'), '+971501234567');
  assert.equal(resolveDialedNumber('(212) 555-0142', 'US', '+1'), '+12125550142');
});

test('a number typed with its country code but no plus is not given the code twice', () => {
  // This is the one that produced "Use a complete international destination
  // beginning with +." — +971971501234567 is sixteen digits.
  assert.equal(resolveDialedNumber('971501234567', 'AE', '+971'), '+971501234567');
  assert.equal(resolveDialedNumber('12125550142', 'US', '+1'), '+12125550142');
});

test('a plus or a 00 prefix is taken as written', () => {
  assert.equal(resolveDialedNumber('+44 20 7946 0958', 'AE', '+971'), '+442079460958');
  assert.equal(resolveDialedNumber('0044 20 7946 0958', 'AE', '+971'), '+442079460958');
});

test('a local number that starts with the same digits as the country code stays local', () => {
  // Riyadh numbers begin with 11; the Saudi country code is 966 — no overlap
  // there, but a US number beginning with 1 must not be read as +1 twice.
  assert.equal(resolveDialedNumber('2125550142', 'US', '+1'), '+12125550142');
});

test('an unknown shape still goes out with the selected code, so the carrier can judge it', () => {
  assert.equal(resolveDialedNumber('12345', 'AE', '+971'), '+97112345');
  assert.equal(resolveDialedNumber('', 'AE', '+971'), '');
});
