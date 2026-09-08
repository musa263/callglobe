import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createPresenceHandler } from './voice-presence.js';
import { defaultPbxConfig } from '../../organizations/pbx-config-store.js';
import type { VocivoSession } from '../../auth/auth.js';

function fixture() {
  const writes: unknown[][] = [];
  const session: VocivoSession = { sub: 'employee', organizationId: 'primary', extensionId: 'employee', role: 'user', iat: 1 };
  let extensionOrg = 'primary';
  const handler = createPresenceHandler({
    requireSession: async () => session,
    readPbxConfig: async () => defaultPbxConfig(),
    getExtension: (async () => ({ id: 'employee', organizationId: extensionOrg, status: 'active' })) as any,
    requireFeature: async () => ({ superadmin: false }) as any,
    presenceStore: { read: async () => new Map(), update: async (...args) => { writes.push(args); } },
  });
  return { writes, session, foreign() { extensionOrg = 'other'; }, async send(body: unknown) {
    let status = 200;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json() { return res; } } as unknown as VercelResponse;
    await handler({ method: 'POST', body, query: {} } as VercelRequest, res);
    return status;
  } };
}
const body = { instanceId: '7a7cc8fc-195d-487a-825a-968715ace811', sequence: 1, state: 'online' };
test('availability writes use only the signed extension and tenant', async () => {
  const f = fixture();
  assert.equal(await f.send(body), 200);
  assert.deepEqual(f.writes[0].slice(0, 2), ['primary', 'employee']);
  for (const extra of [{ organizationId: 'other' }, { extensionId: 'victim' }, { sequence: NaN }, { state: 'active' }]) {
    assert.equal(await f.send({ ...body, ...extra }), 400);
  }
  assert.equal(f.writes.length, 1);
});
test('removed tenant binding and accounts without extensions cannot publish', async () => {
  const f = fixture();
  f.foreign();
  assert.equal(await f.send(body), 403);
  delete f.session.extensionId;
  assert.equal(await f.send(body), 403);
  assert.equal(f.writes.length, 0);
});
