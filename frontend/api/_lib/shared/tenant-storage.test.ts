import assert from 'node:assert/strict';
import test from 'node:test';
import { newestFirstTimestamp, tenantStorageKey } from './tenant-storage.js';

test('creates stable, isolated tenant storage prefixes', () => {
  assert.equal(tenantStorageKey('company-a'), tenantStorageKey('company-a'));
  assert.notEqual(tenantStorageKey('company-a'), tenantStorageKey('company-b'));
  assert.match(tenantStorageKey('company-a'), /^[a-f0-9]{24}$/);
  assert.throws(() => tenantStorageKey(''), /tenant organization/i);
});

test('sorts newer timestamps before older timestamps lexicographically', () => {
  const older = newestFirstTimestamp('2026-01-01T00:00:00.000Z');
  const newer = newestFirstTimestamp('2026-02-01T00:00:00.000Z');
  assert.ok(newer < older);
});
