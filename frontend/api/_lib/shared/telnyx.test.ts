import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { TelnyxApiError, TelnyxCarrierUnavailableError, createTelnyxVoiceReadiness, inboundConnectionId, telnyx, telnyxCarrierHasCredit, telnyxCredentialConnectionPath, telnyxPstnConnectionId, telnyxPstnConnectionPath } from './telnyx.js';

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.TELNYX_API_KEY;
const originalTimeout = process.env.TELNYX_REQUEST_TIMEOUT_MS;
const originalPstnConnectionId = process.env.TELNYX_PSTN_CONNECTION_ID;
const originalCallControlAppId = process.env.TELNYX_CALL_CONTROL_APP_ID;
const originalConnectionId = process.env.TELNYX_CONNECTION_ID;
const originalSipInbound = process.env.VOCIVO_SIP_INBOUND;
const originalSipConnectionId = process.env.TELNYX_SIP_CONNECTION_ID;

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
  if (originalSipInbound === undefined) delete process.env.VOCIVO_SIP_INBOUND;
  else process.env.VOCIVO_SIP_INBOUND = originalSipInbound;
  if (originalSipConnectionId === undefined) delete process.env.TELNYX_SIP_CONNECTION_ID;
  else process.env.TELNYX_SIP_CONNECTION_ID = originalSipConnectionId;
});

test('numbers are kept on the connection that delivers inbound to Vocivo', () => {
  process.env.TELNYX_CALL_CONTROL_APP_ID = 'managed-call-control';
  delete process.env.VOCIVO_SIP_INBOUND;
  assert.equal(inboundConnectionId(), 'managed-call-control', 'the Call Control application answers inbound before the cut-over');

  process.env.VOCIVO_SIP_INBOUND = '1';
  process.env.TELNYX_SIP_CONNECTION_ID = 'sip-edge-ip-connection';
  assert.equal(inboundConnectionId(), 'sip-edge-ip-connection', 'the SIP edge answers inbound after it');

  // Without the edge connection id, moving numbers anywhere would undo the
  // cut-over — so nothing is moved.
  delete process.env.TELNYX_SIP_CONNECTION_ID;
  assert.equal(inboundConnectionId(), null);
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

test('concurrent call setup shares balance work and never caches a failed read as credit', async () => {
  let now = 0, requests = 0, balance = '10';
  const ready = createTelnyxVoiceReadiness(async () => { requests++; await Promise.resolve(); return { data: { balance } }; }, () => now);
  await Promise.all(Array.from({ length: 20 }, () => ready()));
  assert.equal(requests, 1);
  now = 16000; balance = '0';
  const results = await Promise.allSettled([ready(), ready()]);
  assert.equal(requests, 2);
  assert.ok(results.every(result => result.status === 'rejected' && result.reason instanceof TelnyxCarrierUnavailableError));
  let fail = true;
  const recovery = createTelnyxVoiceReadiness(async () => { if (fail) throw new Error('offline'); return { data: { balance: '1' } }; });
  await assert.rejects(recovery(), /offline/);
  fail = false; await recovery();
});

test('an exhausted shared request deadline is not retried', async () => {
  process.env.TELNYX_API_KEY = 'fixture';
  const controller = new AbortController(); let requests = 0;
  globalThis.fetch = async () => { requests++; controller.abort(); throw new DOMException('expired', 'AbortError'); };
  await assert.rejects(telnyx('/balance', { signal: controller.signal }), /did not respond/);
  assert.equal(requests, 1);
});
