import assert from 'node:assert/strict';
import test from 'node:test';
import { workspaceApi } from './workspace-api.js';

test('every workspace request captures its own tab and preserves other query parameters', async () => {
  const paths = [];
  const request = async (path, options) => { paths.push([path, options]); return {}; };
  const a = workspaceApi(request, 'company-a');
  const b = workspaceApi(request, 'company-b');
  for (const path of ['/api/admin/pbx', '/api/admin/ai', '/api/admin/extensions', '/api/admin/overview', '/api/admin/events', '/api/admin/api-keys', '/api/admin/numbers', '/api/admin/trunks', '/api/admin/background', '/api/voice/settings']) {
    await a(`${path}?id=123`, { method: 'PUT', body: { greeting: 'A' } });
    await b(path);
    assert.equal(new URL(paths.at(-2)[0], 'https://local').searchParams.get('organizationId'), 'company-a');
    assert.equal(new URL(paths.at(-2)[0], 'https://local').searchParams.get('id'), '123');
    assert.equal(new URL(paths.at(-1)[0], 'https://local').searchParams.get('organizationId'), 'company-b');
  }
  await a('/api/admin/wallets', { method: 'PUT', body: { organizationId: 'company-b' } });
  assert.equal(paths.at(-1)[0], '/api/admin/wallets', 'platform operations retain their explicit target');
});

test('stale callbacks neither submit old forms nor publish delayed responses', async () => {
  let current = true, complete, calls = 0;
  const api = workspaceApi(() => { calls++; return new Promise(resolve => { complete = resolve; }); }, 'a', () => current);
  const pending = api('/api/voice/settings');
  current = false;
  complete({ config: { companyName: 'A' } });
  await assert.rejects(pending, /workspace changed/);
  await assert.rejects(api('/api/admin/ai', { method: 'PUT' }), /workspace changed/);
  assert.equal(calls, 1);
  await assert.rejects(workspaceApi(() => assert.fail('must not send'), '')('/api/admin/pbx'), /workspace changed/);
});
