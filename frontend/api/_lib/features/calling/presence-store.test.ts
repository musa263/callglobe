import assert from 'node:assert/strict';
import test from 'node:test';
import { createPresenceStore, presenceLeaseMs } from './presence-store.js';

function fixture() {
  const rows = new Map<string, Buffer>();
  let time = 1_000_000;
  let lock = Promise.resolve();
  const store = createPresenceStore({
    readObjects: async paths => new Map(paths.filter(path => rows.has(path)).map(path => [path, rows.get(path)!])),
    transactObject: (async (path: string, update: (current: Buffer | null) => Buffer | Promise<Buffer>) => {
      const task = lock.then(async () => { rows.set(path, await update(rows.get(path) || null)); });
      lock = task.catch(() => {}); await task;
    }) as any,
  }, () => time);
  return { store, rows, advance(ms: number) { time += ms; } };
}
test('concurrent devices aggregate busy and one disconnect cannot clear another device', async () => {
  const f = fixture();
  await Promise.all([f.store.update('a', 'employee', 'web', 1, 'online'), f.store.update('a', 'employee', 'ios', 1, 'busy')]);
  assert.equal((await f.store.read('a', ['employee'])).get('employee'), 'busy');
  await f.store.update('a', 'employee', 'web', 2, 'offline');
  assert.equal((await f.store.read('a', ['employee'])).get('employee'), 'busy');
  await f.store.update('a', 'employee', 'ios', 2, 'online');
  assert.equal((await f.store.read('a', ['employee'])).get('employee'), 'online');
});
test('out-of-order updates and retries do not resurrect offline or renew an expired lease', async () => {
  const f = fixture();
  await f.store.update('a', 'employee', 'web', 2, 'offline');
  await f.store.update('a', 'employee', 'web', 1, 'online');
  assert.equal((await f.store.read('a', ['employee'])).get('employee'), 'offline');
  await f.store.update('a', 'employee', 'web', 3, 'online');
  f.advance(presenceLeaseMs + 1);
  await f.store.update('a', 'employee', 'web', 3, 'online');
  assert.equal((await f.store.read('a', ['employee'])).get('employee'), 'offline');
});
test('tenant rows and identical extension IDs remain isolated; moved rows fail closed', async () => {
  const f = fixture();
  await f.store.update('a', 'employee', 'web', 1, 'online');
  await f.store.update('b', 'employee', 'web', 1, 'offline');
  assert.equal((await f.store.read('b', ['employee'])).get('employee'), 'offline');
  const [a, b] = [...f.rows.keys()];
  f.rows.set(b, f.rows.get(a)!);
  await assert.rejects(f.store.read('b', ['employee']), /ownership/);
});
