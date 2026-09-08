import assert from 'node:assert/strict';
import test from 'node:test';
import { createCipheriv, createHash } from 'node:crypto';
import { updateExtensionDirectory } from './extension-store.js';
import { isExtensionSessionRevoked } from './extension-session-store.js';
import type { transactObject } from '../../shared/object-store.js';

test('directory corruption or unknown versions cannot overwrite the stored bytes', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'directory-integrity-fixture';
  try {
    const iv = Buffer.alloc(12, 1);
    const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(`${process.env.AUTH_SECRET}:extension-store:v1`).digest(), iv);
    const body = Buffer.concat([cipher.update(JSON.stringify({version:99,extensions:[]})),cipher.final()]);
    for (const stored of [Buffer.from('corrupt'), Buffer.concat([iv,cipher.getAuthTag(),body])]) {
      let commits = 0;
      const transaction = (async (_path, update) => { const next = await update(stored); commits++; return {body:next}; }) as typeof transactObject;
      await assert.rejects(updateExtensionDirectory(() => { assert.fail('mutation must not run'); },transaction));
      assert.equal(commits,0);
    }
  } finally { if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous; }
});

test('expired authorization cache cannot authorize during revocation-store failure', async () => {
  const original = Date.now;
  let now = 10_000;
  Date.now = () => now;
  try {
    assert.equal(await isExtensionSessionRevoked('fixture-extension',1,{},async () => Buffer.from('0')), false);
    now += 6_000;
    assert.equal(await isExtensionSessionRevoked('fixture-extension',1,{},async () => {throw new Error('fixture read failure');}), true);
  } finally { Date.now = original; }
});
