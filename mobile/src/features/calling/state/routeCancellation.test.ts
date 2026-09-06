import assert from 'node:assert/strict';
import test from 'node:test';
import { RouteCancellationOutbox, type PendingRouteCancellation } from './routeCancellation';

function harness() {
  let entries: PendingRouteCancellation[] = [];
  let session: string | null = 'session-a';
  let fail = false;
  const sent: Array<[string, string]> = [];
  const dependencies = {
    read: async () => structuredClone(entries),
    write: async (next: PendingRouteCancellation[]) => { entries = structuredClone(next); },
    session: async () => session,
    send: async (routeId: string, owner: string) => {
      assert.ok(entries.some(entry => entry.routeId === routeId && entry.session === owner), 'persist before any network attempt');
      sent.push([routeId, owner]);
      if (fail) throw new Error('offline');
      return { canceled: true };
    },
  };
  return { dependencies, queue: new RouteCancellationOutbox(dependencies), sent,
    entries: () => entries, fail: (next: boolean) => { fail = next; }, session: (next: string | null) => { session = next; } };
}

test('failed remote cancel persists through restart and is removed only after acknowledgment', async () => {
  const h = harness(); h.fail(true);
  await assert.rejects(h.queue.cancel('route-1'), /offline/);
  assert.equal(h.sent.length, 2);
  assert.deepEqual(h.entries(), [{ session: 'session-a', routeId: 'route-1' }]);
  h.fail(false);
  await new RouteCancellationOutbox(h.dependencies).flush();
  assert.deepEqual(h.entries(), []);
});

test('reconnect never replays a previous tenant login cancellation under another account', async () => {
  const h = harness(); h.fail(true);
  await assert.rejects(h.queue.cancel('route-a'));
  h.fail(false); h.session('session-b');
  await h.queue.flush();
  await h.queue.cancel('route-b');
  assert.deepEqual(h.sent, [['route-a', 'session-a'], ['route-a', 'session-a'], ['route-b', 'session-b']]);
  assert.deepEqual(h.entries(), [{ session: 'session-a', routeId: 'route-a' }]);
});

test('racing cancellations are single-flight per route and preserve other pending routes', async () => {
  const h = harness(); h.fail(true);
  await Promise.allSettled([h.queue.cancel('a'), h.queue.cancel('a'), h.queue.cancel('b')]);
  assert.equal(h.sent.filter(([id]) => id === 'a').length, 2);
  assert.equal(h.entries().length, 2);
  h.fail(false);
  await Promise.all([h.queue.flush(), h.queue.flush()]);
  assert.deepEqual(h.entries(), []);
});

test('a non-acknowledged response and secure storage failure never count as cancellation success', async () => {
  const h = harness();
  h.dependencies.send = async () => ({ canceled: false });
  await assert.rejects(h.queue.cancel('a'), /not acknowledged/);
  assert.equal(h.entries().length, 1);
  h.dependencies.write = async () => { throw new Error('keychain unavailable'); };
  await assert.rejects(h.queue.cancel('b'), /keychain unavailable/);
});

test('logout during retry does not send another request with the next session', async () => {
  const h = harness();
  let count = 0;
  h.dependencies.send = async () => { count += 1; h.session('session-b'); throw new Error('offline'); };
  await assert.rejects(h.queue.cancel('a'), /session changed/);
  assert.equal(count, 1);
  assert.equal(h.entries()[0]?.session, 'session-a');
});
