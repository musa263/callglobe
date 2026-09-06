import test from 'node:test';
import assert from 'node:assert/strict';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import handler from './auth-phone.js';

function response() {
  const value = { code: 200, body: null as unknown, headers: {} as Record<string, unknown>, setHeader(key: string, data: unknown) { this.headers[key] = data; return this; }, status(code: number) { this.code = code; return this; }, json(body: unknown) { this.body = body; return this; } };
  return value;
}
test('unconfigured phone signup cannot send SMS, access a database, or create a session', async () => {
  const before = process.env.VOCIVO_PHONE_SIGNUP_ENABLED;
  const fetchBefore = globalThis.fetch;
  delete process.env.VOCIVO_PHONE_SIGNUP_ENABLED;
  globalThis.fetch = async () => { throw new Error('Must not contact provider.'); };
  try {
    const res = response();
    await handler({ method: 'POST', headers: { 'content-type': 'application/json' }, body: { step: 'start', phone: '+12025550123', name: 'Alex Morgan', accountType: 'business', role: 'superadmin', organizationId: 'victim' } } as VercelRequest, res as unknown as VercelResponse);
    assert.equal(res.code, 503);
    assert.equal(res.headers['Cache-Control'], 'no-store');
    assert.equal(res.headers['Set-Cookie'], undefined);
    assert.equal(JSON.stringify(res.body).includes('token'), false);
  } finally {
    globalThis.fetch = fetchBefore;
    if (before === undefined) delete process.env.VOCIVO_PHONE_SIGNUP_ENABLED; else process.env.VOCIVO_PHONE_SIGNUP_ENABLED = before;
  }
});
test('phone authentication rejects cross-site form-style requests', async () => {
  const res = response();
  await handler({ method: 'POST', headers: { 'content-type': 'text/plain' }, body: {} } as VercelRequest, res as unknown as VercelResponse);
  assert.equal(res.code, 415);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
