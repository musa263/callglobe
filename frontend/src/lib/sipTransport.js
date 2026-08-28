import { RegistererState, Web } from 'sip.js';

// TLS terminates at Caddy, so FreeSWITCH receives SIP over plain WebSocket.
// The Via transport must describe the hop seen by Sofia or it drops requests.
export class ProxyAwareSipTransport extends Web.Transport {
  get protocol() { return 'WS'; }
}

export function installTransportSafety(transport, callbacks, options = {}) {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  const maximumMisses = options.maximumMisses ?? 2;
  let socket;
  let heartbeatTimer;
  let awaitingPong = false;
  let missedPongs = 0;
  let fatalReported = false;
  let recoveryRunning = false;
  let disposed = false;
  const reportCallbackError = callbacks.onCallbackError
    || ((operation, error) => console.error('[VocivoVoice]', { operation, error }));

  const runHeartbeatRecovery = (reason) => {
    if (disposed || recoveryRunning) return;
    recoveryRunning = true;
    awaitingPong = false;
    missedPongs = 0;
    Promise.resolve(callbacks.onHeartbeatFailure({ type: 'heartbeat', reason }))
      .catch((error) => reportCallbackError('heartbeat-recovery-callback', error))
      .finally(() => { recoveryRunning = false; });
  };
  const recordMiss = (reason) => {
    missedPongs += 1;
    if (missedPongs >= maximumMisses) runHeartbeatRecovery(reason);
  };
  const onMessage = (event) => {
    if (typeof event.data === 'string' && /^(\r\n)+$/.test(event.data)) {
      awaitingPong = false;
      missedPongs = 0;
    }
  };
  const reportFatal = (failure) => {
    if (disposed || fatalReported) return;
    fatalReported = true;
    Promise.resolve(callbacks.onFatalDisconnect(failure))
      .catch((error) => reportCallbackError('fatal-disconnect-callback', error));
  };
  const onClose = (event) => {
    stopHeartbeat();
    if (event.code === 1000) return;
    reportFatal({
      type: 'close',
      code: event.code,
      reason: event.reason || `WebSocket closed abnormally${event.code ? ` (${event.code})` : ''}.`,
    });
  };
  const onError = () => reportFatal({ type: 'error', reason: 'WebSocket transport error.' });
  const detachSocket = () => {
    const current = socket;
    socket = undefined;
    if (!current?.removeEventListener) return;
    current.removeEventListener('message', onMessage);
    current.removeEventListener('close', onClose);
    current.removeEventListener('error', onError);
  };
  const attachSocket = () => {
    const next = transport.ws;
    if (!next || next === socket) return;
    detachSocket();
    socket = next;
    fatalReported = false;
    socket.addEventListener?.('message', onMessage);
    socket.addEventListener?.('close', onClose);
    socket.addEventListener?.('error', onError);
  };
  function stopHeartbeat() {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
    awaitingPong = false;
    missedPongs = 0;
  }
  const heartbeat = () => {
    if (disposed || !transport.isConnected()) return;
    attachSocket();
    if (awaitingPong) recordMiss('The SIP WebSocket missed two heartbeat responses.');
    awaitingPong = true;
    transport.send('\r\n\r\n').catch(() => {
      awaitingPong = false;
      recordMiss('The SIP WebSocket heartbeat could not be sent twice.');
    });
  };
  const startHeartbeat = () => {
    if (heartbeatTimer || disposed) return;
    heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
  };
  const onTransportState = (state) => {
    if (String(state) === 'Connected') {
      attachSocket();
      startHeartbeat();
      return;
    }
    stopHeartbeat();
  };

  transport.stateChange.addListener(onTransportState);
  if (transport.isConnected()) {
    attachSocket();
    startHeartbeat();
  }

  return () => {
    if (disposed) return;
    disposed = true;
    stopHeartbeat();
    detachSocket();
    transport.stateChange.removeListener(onTransportState);
  };
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
