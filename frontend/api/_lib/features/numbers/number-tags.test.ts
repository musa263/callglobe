import assert from 'node:assert/strict';
import test from 'node:test';
import { isInternalNumberTag, nextNumberTags, tenantVisibleNumberTags } from './number-config.js';

const ownerHashTag = 'vopwd_JDJhJDEyJHNvbWVoYXNo';
const legacyConfigTag = 'vocfg_0_eyJlbmFibGVkIjp0cnVlfQ';

test('Vocivo’s own tags are not the tenant’s to see', () => {
  assert.equal(isInternalNumberTag(ownerHashTag), true);
  assert.equal(isInternalNumberTag(legacyConfigTag), true);
  assert.equal(isInternalNumberTag('Reception'), false);
  assert.deepEqual(tenantVisibleNumberTags([ownerHashTag, 'Reception', legacyConfigTag, 'Sales']), ['Reception', 'Sales']);
  assert.deepEqual(tenantVisibleNumberTags(undefined), []);
});

test('a save keeps Vocivo’s tags whether or not the request mentions them', () => {
  // The attack this closes: the numbers screen saved the tag list as sent, so
  // a company administrator could drop the tag holding the platform owner's
  // password hash and fall the login back to the deployment default.
  assert.deepEqual(nextNumberTags([ownerHashTag, 'Reception'], ['Sales']), [ownerHashTag, 'Sales']);
  assert.deepEqual(nextNumberTags([ownerHashTag, legacyConfigTag], []), [ownerHashTag, legacyConfigTag]);
});

test('a save cannot invent one either', () => {
  // The other half: writing vopwd_<a hash they chose> set the owner's password.
  assert.deepEqual(nextNumberTags(['Reception'], ['vopwd_bXluZXdoYXNo', 'Support']), ['Support']);
  assert.deepEqual(nextNumberTags([ownerHashTag], ['vopwd_bXluZXdoYXNo']), [ownerHashTag]);
});

test('tenant tags are trimmed, de-duplicated and capped', () => {
  assert.deepEqual(nextNumberTags([], ['  Sales  ', 'Sales', 42, '']), ['Sales']);
  assert.equal(nextNumberTags([], Array.from({ length: 40 }, (_, index) => `tag-${index}`)).length, 20);
  assert.equal(nextNumberTags([], ['x'.repeat(90)])[0].length, 50);
});
