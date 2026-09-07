import assert from 'node:assert/strict';
import test from 'node:test';
import { UserAgent, Registerer, RegistererState } from 'sip.js';
import type { IncomingResponse } from 'sip.js/lib/core';
import { sipRegistrationRequestDelegate } from './sipRegistrationRequest';

function response(status: number, reason = 'test') {
  return { message: { statusCode: status, reasonPhrase: reason } } as IncomingResponse;
}

test('successful re-REGISTER clears reconnecting even when real SIP.js emits no state change', async () => {
  const ua = new UserAgent({ uri: UserAgent.makeURI('sip:employee@example.invalid'), transportOptions: { server: 'wss://example.invalid/ws' }, logLevel: 'error' });
  let contactMatches = true;
  ua.userAgentCore.register = ((request, delegate) => {
    const contact = { uri: contactMatches ? ua.contact.uri : UserAgent.makeURI('sip:someone-else@example.invalid'), getParam: () => '600', hasParam: () => false };
    queueMicrotask(() => delegate?.onAccept?.({ message: {
      statusCode: 200, hasHeader: () => false, getHeaders: () => ['fixture-contact'], parseHeader: () => contact,
    } } as unknown as IncomingResponse));
    return { message: request } as ReturnType<typeof ua.userAgentCore.register>;
  });
  const registrar = new Registerer(ua, { expires: 600 });
  let visible = 'Initial';
  const transitions: RegistererState[] = [];
  registrar.stateChange.addListener(state => { transitions.push(state); visible = state; });
  const requestDelegate = sipRegistrationRequestDelegate({
    wanted: () => true, current: () => true,
    ready: () => registrar.state === RegistererState.Registered,
    registered: () => { visible = 'Registered'; }, rejected: () => {},
  });
  try {
    await registrar.register({ requestDelegate });
    assert.equal(visible, 'Registered');
    visible = 'Reconnecting'; // Transport loss does not clear SIP.js's registration flag.
    await registrar.register({ requestDelegate });
    assert.deepEqual(transitions, [RegistererState.Registered], 'SIP.js does not repeat the state event');
    assert.equal(visible, 'Registered', 'the accepted request must restore the app state');
    contactMatches = false;
    await registrar.register({ requestDelegate });
    assert.equal(registrar.state, RegistererState.Unregistered, 'an unusable 200 response must not signal recovery');
    assert.notEqual(visible, 'Registered');
  } finally { await registrar.dispose(); }
});

test('rejection from an old password retries, but current refusal still fails closed', () => {
  let current = false;
  let wanted = true;
  const statuses: number[] = [];
  const delegate = sipRegistrationRequestDelegate({ wanted: () => wanted, current: () => current, ready: () => true, registered: () => {}, rejected: status => statuses.push(status) });
  delegate.onReject(response(403));
  current = true;
  delegate.onReject(response(403));
  wanted = false;
  delegate.onReject(response(401));
  assert.deepEqual(statuses, [503, 403]);
});

test('late, superseded, or unusable acceptance cannot report recovery', () => {
  let wanted = true;
  let current = true;
  let ready = true;
  let recovered = 0;
  const delegate = sipRegistrationRequestDelegate({
    wanted: () => wanted, current: () => current, ready: () => ready,
    registered: () => { recovered += 1; }, rejected: () => {},
  });
  wanted = false;
  delegate.onAccept();
  wanted = true;
  current = false;
  delegate.onAccept();
  current = true;
  ready = false; // Disconnected transport or an unregistered Contact.
  delegate.onAccept();
  assert.equal(recovered, 0);
  ready = true;
  delegate.onAccept();
  assert.equal(recovered, 1);
});
