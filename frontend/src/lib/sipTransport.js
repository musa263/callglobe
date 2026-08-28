import { RegistererState, Web } from 'sip.js';

// TLS terminates at Caddy, so FreeSWITCH receives SIP over plain WebSocket.
// The Via transport must describe the hop seen by Sofia or it drops requests.
export class ProxyAwareSipTransport extends Web.Transport {
  get protocol() { return 'WS'; }
}

function registrationError(response) {
  const status = Number(response?.message?.statusCode || 0);
  if (status === 401 || status === 403) return new Error('The PBX rejected this extension credential.');
  return new Error(status ? `The PBX rejected registration (${status}).` : 'The PBX rejected extension registration.');
}

export async function registerAndWait(registerer, timeoutMs = 15_000) {
  let timer;
  let settled = false;
  let rejectPending;
  const listener = (state) => {
    if (state === RegistererState.Registered && !settled) {
      settled = true;
      clearTimeout(timer);
      resolvePending();
    }
  };
  const resolveRegistration = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolvePending();
  };
  let resolvePending;
  const pending = new Promise((resolve, reject) => {
    resolvePending = resolve;
    rejectPending = reject;
    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('The PBX did not complete extension registration in time.'));
    }, timeoutMs);
  });
  registerer.stateChange.addListener(listener);
  try {
    const request = registerer.register({
      requestDelegate: {
        onAccept: resolveRegistration,
        onReject: (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          rejectPending(registrationError(response));
        },
      },
    });
    await Promise.all([request, pending]);
  } finally {
    clearTimeout(timer);
    registerer.stateChange.removeListener(listener);
  }
}
