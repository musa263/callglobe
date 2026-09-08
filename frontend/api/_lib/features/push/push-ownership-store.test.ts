import assert from 'node:assert/strict';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { createPushDeviceStore, type PushDevice } from './push-device-store.js';
import { createWebPushStore, type WebPushSubscriptionRecord } from './web-push-store.js';
import type { PushStorage } from './push-ownership-store.js';
import { tenantStorageKey } from '../../shared/tenant-storage.js';

function database() {
  const rows = new Map<string, Buffer>();
  let tail = Promise.resolve();
  const deps: PushStorage = {
    list: (async ({ prefix = '', cursor } = {}) => {
      const paths = [...rows.keys()].filter(path => path.startsWith(prefix) && (!cursor || path > cursor)).sort();
      // Small pages prove migration does not stop at the first page.
      const page = paths.slice(0, 2);
      return { blobs: page.map(pathname => ({ pathname })), hasMore: paths.length > 2, cursor: paths.length > 2 ? page[page.length - 1] : undefined };
    }) as PushStorage['list'],
    readObjects: async paths => new Map(paths.flatMap(path => rows.has(path) ? [[path, rows.get(path)!] as const] : [])),
    transactObjectGroup: ((_: string, paths: string[], update: Function) => {
      const result = tail.then(async () => {
        const current = new Map(paths.flatMap(path => rows.has(path) ? [[path, { body: rows.get(path)!, etag: 'fixture' }] as const] : []));
        const mutation = await update(current);
        for (const item of mutation.puts || []) rows.set(item.pathname, item.value);
        for (const path of mutation.deletes || []) rows.delete(path);
        return mutation.result;
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    }) as PushStorage['transactObjectGroup'],
  };
  return { rows, deps };
}

function seedLegacy(rows: Map<string, Buffer>, root: string, keySuffix: string, record: PushDevice | WebPushSubscriptionRecord) {
  const iv = randomBytes(12);
  const key = createHash('sha256').update(`${process.env.AUTH_SECRET}:${keySuffix}`).digest();
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  rows.set(`${root}${tenantStorageKey(record.organizationId)}/${record.extensionId}/${record.id}.bin`, Buffer.concat([iv, cipher.getAuthTag(), body]));
}

test('physical push destinations belong only to their latest extension, including legacy account switches', async () => {
  const previous = process.env.AUTH_SECRET;
  process.env.AUTH_SECRET = 'push-ownership-fixture';
  try {
    const now = Date.now();
    for (const platform of ['ios', 'android', 'web'] as const) {
      const db = database();
      const store = platform === 'web' ? createWebPushStore(db.deps) : createPushDeviceStore(db.deps);
      const record = (extension: string, device: string, at: number, organizationId = 'company') => ({
        id: `${extension}-${device}`, organizationId, extensionId: extension, extension,
        updatedAt: new Date(at).toISOString(), platform: platform === 'android' ? 'android' as const : 'ios' as const,
        environment: 'production' as const, token: device.repeat(40), bundleId: 'app.vocivo.mobile',
        endpoint: `https://push.example/${device}`, expirationTime: null, keys: { p256dh: 'fixture', auth: 'fixture' },
      });
      const old = record('2000', 'shared-device', now - 5000);
      const current = record('2003', 'shared-device', now - 1000);
      const receiver = record('2000', 'receiver-device', now - 3000);
      const root = platform === 'web' ? 'vocivo/web-push/v1/' : 'vocivo/push-devices/v1/';
      const suffix = platform === 'web' ? 'web-push' : 'push-devices';
      // These are the existing encrypted v1 rows. No re-login or app upgrade
      // should be necessary to prevent 2003 receiving 2000's incoming alert.
      for (const item of [old, current, receiver]) seedLegacy(db.rows, root, suffix, item);
      assert.deepEqual((await store.list('company', '2000')).map(item => item.id), [receiver.id], platform);
      assert.deepEqual((await store.list('company', '2003')).map(item => item.id), [current.id], platform);

      // Switching companies also moves the delivery address, not a second copy.
      const moved = record('2003', 'shared-device', now, 'other-company');
      await store.save(moved);
      assert.equal((await store.list('company', '2003')).length, 0);
      assert.equal((await store.list('other-company', '2003')).length, 1);
      await store.remove(current); // Late old-owner cleanup cannot remove the new owner.
      assert.equal((await store.list('other-company', '2003')).length, 1);
      await store.remove(moved);
      assert.equal((await store.list('other-company', '2003')).length, 0);
      assert.deepEqual((await store.list('company', '2000')).map(item => item.id), [receiver.id], 'deletion cannot resurrect an old account');

      const fresh = record('2003', 'shared-device', now + 1000);
      await Promise.all([store.save(fresh), store.save(old)]);
      assert.equal((await store.list('company', '2003')).length, 1, 'delayed older registration cannot reclaim delivery');
      assert.deepEqual((await store.list('company', '2000')).map(item => item.id), [receiver.id]);
      const refreshed = { ...fresh, updatedAt: new Date(now + 2000).toISOString() };
      await store.save(refreshed);
      await store.remove(fresh); // A provider error from an earlier generation.
      assert.equal((await store.list('company', '2003')).length, 1);
    }
  } finally {
    if (previous === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = previous;
  }
});
