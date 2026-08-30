import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { TelnyxApiError, telnyx, telnyxCarrierHasCredit, telnyxCredentialConnectionPath, telnyxPstnConnectionId, telnyxPstnConnectionPath } from './telnyx.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TELNYX_API_KEY;
const originalTimeout = process.env.TELNYX_REQUEST_TIMEOUT_MS;
const originalPstnConnectionId = process.env.TELNYX_PSTN_CONNECTION_ID;
const originalCallControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
const originalConnectionId = process.env.TELNYX_CONNECTION_ID;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) delete process.env.TELNYX_API_KEY;
  else process.env.TELNYX_API_KEY = originalApiKey;
  if (originalTimeout === undefined) delete process.env.TELNYX_REQUEST_TIMEOUT_MS;
  else process.env.TELNYX_REQUEST_TIMEOUT_MS = originalTimeout;
  if (originalPstnConnectionId === undefined) delete process.env.TELNYX_PSTN_CONNECTION_ID;
  else process.env.TELNYX_PSTN_CONNECTION_ID = originalPstnConnectionId;
  if (originalCallControlAppId === undefined) delete process.env.TELNYX_CALL_CONTROL_APP_ID;
  else process.env.TELNYX_CALL_CONTROL_APP_ID = originalCallControlAppId;
  if (originalConnectionId === undefined) delete process.env.TELNYX_CONNECTION_ID;
  else process.env.TELNYX_CONNECTION_ID = originalConnectionId;
});

test('always routes managed PSTN calls through the Telnyx Call Control application', () => {
  process.env.TELNYX_PSTN_CONNECTION_ID = 'ip-connection';
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'managed-call-control';
  process.env.TELNYX_CONNECTION_ID = 'legacy-credential';
  assert.equal(telnyxPstnConnectionId(), 'managed-call-control');
  assert.equal(telnyxPstnConnectionPath(), '/call_control_applications/managed-call-control');
  assert.equal(telnyxCredentialConnectionPath(), '/credential_connections/legacy-credential');
});

test('retries one transient Telnyx GET failure', async () => {
  process.env.TELNYX_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(calls === 1 ? 'busy' : '{}', { status: calls === 1 ? 503 : 200 });
  };

  const response = await telnyx('/phone_numbers');
  assert.equal(response.status, 200);
  assert.equal(calls, 2);
});

test('does not replay Telnyx write requests', async () => {
  process.env.TELNYX_API_KEY = 'test-key';
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ errors: [{ detail: 'busy' }] }), { status: 503 });
  };

  await assert.rejects(() => telnyx('/calls', { method: 'POST', body: '{}' }), (error: unknown) => {
    assert.ok(error instanceof TelnyxApiError);
    assert.equal(error.status, 503);
    return true;
  });
  assert.equal(calls, 1);
});

test('turns an unreachable carrier into a bounded gateway timeout', async () => {
  process.env.TELNYX_API_KEY = 'test-key';
  globalThis.fetch = async () => { throw new DOMException('Timed out', 'TimeoutError'); };

  await assert.rejects(() => telnyx('/phone_numbers', { method: 'POST' }), (error: unknown) => {
    assert.ok(error instanceof TelnyxApiError);
    assert.equal(error.status, 504);
    assert.match(error.message, /did not respond/i);
    return true;
  });
});

test('requires positive platform carrier credit before placing calls', () => {
  assert.equal(telnyxCarrierHasCredit({ data: { balance: '-0.07', available_credit: '-0.07' } }), false);
  assert.equal(telnyxCarrierHasCredit({ data: { balance: '10.00', available_credit: '10.00' } }), true);
  assert.equal(telnyxCarrierHasCredit({ data: {} }), false);
});
