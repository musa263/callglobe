import { RegistererState, Web, type Registerer } from 'sip.js';

// TLS terminates at Caddy, so FreeSWITCH receives SIP over plain WebSocket.
// The Via transport must describe the hop seen by Sofia or it drops requests.
export class ProxyAwareSipTransport extends Web.Transport {
  get protocol() { return 'WS'; }
}

function registrationError(response: { message?: { statusCode?: number } }) {
  const status = Number(response?.message?.statusCode || 0);
  if (status === 401 || status === 403) return new Error('The PBX rejected this extension credential.');
  return new Error(status ? `The PBX rejected registration (${status}).` : 'The PBX rejected extension registration.');
}

export async function registerAndWait(registerer: Registerer, timeoutMs = 15_000) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;
  let resolvePending!: () => void;
  let rejectPending!: (error: Error) => void;
  const listener = (state: RegistererState) => {
    if (state === RegistererState.Registered && !settled) {
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePending();
    }
  };
  const pending = new Promise<void>((resolve, reject) => {
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
        onReject: (response) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          rejectPending(registrationError(response));
        },
      },
    });
    await Promise.all([request, pending]);
  } finally {
    if (timer) clearTimeout(timer);
    registerer.stateChange.removeListener(listener);
  }
}
