import assert from 'node:assert/strict';
import test from 'node:test';
import { LAUNCH_CALLING_CREDIT_MINOR, launchCallingCreditKey, outboundPstnChargeMinor, outboundWalletBlockReason, retailRateFromWholesale, walletBalanceAfter } from './wallet-store.js';

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

test('outbound PSTN charges whole billed minutes only', () => {
  assert.equal(outboundPstnChargeMinor(1, 25), 25);
  assert.equal(outboundPstnChargeMinor(60, 25), 25);
  assert.equal(outboundPstnChargeMinor(61, 25), 50);
  assert.equal(outboundPstnChargeMinor(0, 25), 0);
});

test('wallet cannot be debited below zero', () => {
  assert.throws(() => walletBalanceAfter(5_00, 'debit', 5_01), /exceeds/i);
});

test('wallet rejects fractional minor units', () => {
  assert.throws(() => walletBalanceAfter(5_00, 'credit', 1.25), /invalid/i);
});

test('blocks outbound calling on frozen or empty tenant wallets', () => {
  const base = {
    organizationId: 'primary', currency: 'USD', reservedMinor: 0, lowBalanceMinor: 0,
    autoRechargeEnabled: false, autoRechargeThresholdMinor: 0, autoRechargeAmountMinor: 0,
    version: 1, updatedAt: new Date().toISOString(),
  };
  assert.equal(outboundWalletBlockReason({ ...base, status: 'active', availableMinor: 500 }), '');
  assert.match(outboundWalletBlockReason({ ...base, status: 'frozen', availableMinor: 500 }) || '', /frozen/i);
  assert.match(outboundWalletBlockReason({ ...base, status: 'active', availableMinor: 0 }) || '', /credit/i);
  assert.equal(LAUNCH_CALLING_CREDIT_MINOR, 2500);
  assert.equal(launchCallingCreditKey('primary'), 'launch-calling-credit:primary');
});
