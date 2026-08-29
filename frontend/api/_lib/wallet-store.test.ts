import assert from 'node:assert/strict';
import test from 'node:test';
import { retailRateFromWholesale, walletBalanceAfter } from './wallet-store.js';

test('retail pricing protects the configured gross margin', () => {
  assert.equal(retailRateFromWholesale({ wholesaleRateMicros: 10_000, grossMarginBps: 3000 }), 14_286);
});

test('retail pricing includes FX protection and fixed surcharge', () => {
  assert.equal(retailRateFromWholesale({
    wholesaleRateMicros: 20_000,
    grossMarginBps: 2500,
    fxBufferBps: 300,
    surchargeMicros: 1_000,
  }), 28_467);
});

test('wallet credits and debits produce exact integer balances', () => {
  assert.equal(walletBalanceAfter(10_00, 'credit', 25_00), 35_00);
  assert.equal(walletBalanceAfter(35_00, 'debit', 12_50), 22_50);
});

test('wallet cannot be debited below zero', () => {
  assert.throws(() => walletBalanceAfter(5_00, 'debit', 5_01), /exceeds/i);
});

test('wallet rejects fractional minor units', () => {
  assert.throws(() => walletBalanceAfter(5_00, 'credit', 1.25), /invalid/i);
});
