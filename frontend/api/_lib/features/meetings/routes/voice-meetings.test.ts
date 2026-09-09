import assert from 'node:assert/strict';
import test from 'node:test';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { VocivoSession } from '../../auth/auth.js';
import { createMeetingsHandler } from './voice-meetings.js';
import { defaultPbxConfig } from '../../organizations/pbx-config-store.js';
function fixture() {
  const writes: unknown[] = [];
  const session: VocivoSession = { sub: 'employee', organizationId: 'primary', accountType: 'business', extension: '2001' };
  let roomOrg = 'primary'; let feature = true;
  const config = defaultPbxConfig(); config.organizations[0]!.internalCallingEnabled = true;
  const handler = createMeetingsHandler({
    requireSession: async () => session, readPbxConfig: async () => config,
    accessForSession: (async () => ({})) as any,
    requireFeature: (async () => { if (!feature) throw new Error('Feature not enabled'); return {}; }) as any,
    listExtensions: (async () => [{ extension: '2000', status: 'active' }]) as any,
    readVideoRoom: (async () => ({ organizationId: roomOrg })) as any,
    meetingStore: { list: async scope => { writes.push(scope); return []; }, save: async (scope, value) => { writes.push(scope); return { ...value, version: 1, updatedAt: '' }; }, remove: async scope => { writes.push(scope); } },
  });
  return { session, writes, foreign() { roomOrg = 'other'; }, disabled() { feature = false; }, async send(method: string, body?: unknown) {
    let status = 200; const res = { setHeader() {}, status(value: number) { status = value; return res; }, json() { return res; } } as unknown as VercelResponse;
    await handler({ method, body, query: {}, headers: {} } as VercelRequest, res); return status;
  } };
}
const body = () => ({ id: '826dfdd5-86d0-4ab1-97ac-07dfe9656033', title: 'Meeting', kind: 'call', startsAt: new Date(Date.now() + 3600_000).toISOString(), durationMinutes: 30, timeZone: 'Asia/Dubai', destination: '2000', notes: '' });
test('meeting queries and writes derive scope only from the authenticated account', async () => {
  const f = fixture();
  assert.equal(await f.send('POST', { ...body(), organizationId: 'victim', ownerId: 'victim' }), 201);
  assert.deepEqual(f.writes[0], { organizationId: 'primary', ownerId: 'employee' });
  assert.equal(await f.send('PATCH', body()), 400);
  assert.equal(await f.send('POST', { ...body(), destination: '9999' }), 400);
  assert.equal(await f.send('POST', { ...body(), destination: '2001' }), 400);
  delete f.session.organizationId; assert.equal(await f.send('GET'), 403);
});
test('video room ownership, feature denial and platform accounts fail closed', async () => {
  const f = fixture(); const video = { ...body(), kind: 'video', roomId: body().id };
  f.foreign(); assert.equal(await f.send('POST', video), 404);
  f.disabled(); assert.equal(await f.send('POST', video), 403);
  f.session.accountType = 'platform'; assert.equal(await f.send('GET'), 403);
  assert.equal(f.writes.length, 0);
});
