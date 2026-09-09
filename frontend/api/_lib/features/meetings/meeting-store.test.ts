import assert from 'node:assert/strict';
import test from 'node:test';
import { createMeetingStore, validateMeeting } from './meeting-store.js';
const scope = { organizationId: 'company-a', ownerId: 'employee' };
const draft = () => validateMeeting({ id: '826dfdd5-86d0-4ab1-97ac-07dfe9656033', title: 'Customer check-in', kind: 'call', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMinutes: 30, timeZone: 'Asia/Dubai', destination: '2000', notes: '' });
function fixture() {
  process.env.AUTH_SECRET = 'local-meeting-test-key-not-a-production-secret';
  const rows = new Map<string, Buffer>(); let lock = Promise.resolve();
  const store = createMeetingStore({
    readObject: async path => rows.has(path) ? Buffer.from(rows.get(path)!) : null,
    transactObject: (async (path: string, update: (current: Buffer | null) => Buffer | Promise<Buffer>) => {
      const task = lock.then(async () => { const body = await update(rows.get(path) || null); rows.set(path, body); return { body }; });
      lock = task.then(() => undefined, () => undefined); return task;
    }) as any,
  });
  return { rows, store };
}
test('user/tenant keys and authenticated encryption prevent copied-row disclosure', async () => {
  const { store, rows } = fixture();
  await store.save(scope, draft());
  assert.deepEqual(await store.list({ ...scope, ownerId: 'other' }), []);
  assert.deepEqual(await store.list({ ...scope, organizationId: 'company-b' }), []);
  await store.save({ ...scope, organizationId: 'company-b' }, draft());
  const [a, b] = [...rows.keys()]; rows.set(b!, rows.get(a!)!);
  await assert.rejects(store.list({ ...scope, organizationId: 'company-b' }));
  await assert.rejects(store.list({ ...scope, organizationId: '' }), /Unauthorized/);
  assert.ok(!rows.get(a!)!.toString().includes('Customer check-in'));
});
test('simultaneous edits claim one version and retries do not duplicate a meeting', async () => {
  const { store } = fixture(); const value = draft();
  const initial = await store.save(scope, value);
  assert.deepEqual(await store.save(scope, value), initial);
  const result = await Promise.allSettled([store.save(scope, { ...value, title: 'One' }, 1), store.save(scope, { ...value, title: 'Two' }, 1)]);
  assert.equal(result.filter(item => item.status === 'fulfilled').length, 1);
  const meetings = await store.list(scope); assert.equal(meetings.length, 1); assert.equal(meetings[0]?.version, 2);
  await assert.rejects(store.remove(scope, value.id, 1), /another window/);
  await store.remove(scope, value.id, 2); await store.remove(scope, value.id, 2);
  assert.deepEqual(await store.list(scope), []);
});
test('invalid numbers, time zones, timezone-free timestamps and past dates fail validation', () => {
  for (const patch of [{ destination: 'gencred7616' }, { destination: 'sip:2000@example.test' }, { timeZone: 'Moon/Base' }, { startsAt: '2027-01-01T12:30' }, { startsAt: '2020-01-01T12:30:00Z' }, { durationMinutes: 0 }, { notes: '\u0000' }, { kind: 'video', roomId: 'secret' }]) {
    assert.throws(() => validateMeeting({ ...draft(), ...patch }));
  }
});
