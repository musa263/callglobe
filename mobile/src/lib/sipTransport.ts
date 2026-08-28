import { RegistererState, Web, type Registerer } from 'sip.js';

// TLS terminates at Caddy, so FreeSWITCH receives SIP over plain WebSocket.
// The Via transport must describe the hop seen by Sofia or it drops requests.
export class ProxyAwareSipTransport extends Web.Transport {
  get protocol() { return 'WS'; }
}

export type SipTransportFailure = {
  type: 'close' | 'error' | 'heartbeat';
  code?: number;
  reason: string;
};

type SocketEvent = { code?: number; reason?: string; data?: unknown };
type ManagedSocket = {
  addEventListener?: (event: string, listener: (event: SocketEvent) => void) => void;
  removeEventListener?: (event: string, listener: (event: SocketEvent) => void) => void;
};
type ManagedTransport = {
  ws?: ManagedSocket;
  isConnected: () => boolean;
  send: (message: string) => Promise<void>;
  stateChange: {
    addListener: (listener: (state: unknown) => void) => void;
    removeListener: (listener: (state: unknown) => void) => void;
  };
};

export function installTransportSafety(
  transport: ManagedTransport,
  callbacks: {
    onFatalDisconnect: (failure: SipTransportFailure) => void | Promise<void>;
    onHeartbeatFailure: (failure: SipTransportFailure) => void | Promise<void>;
    onCallbackError?: (operation: string, error: unknown) => void;
  },
  options: { heartbeatIntervalMs?: number; maximumMisses?: number } = {},
) {
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 15_000;
  const maximumMisses = options.maximumMisses ?? 2;
  let socket: ManagedSocket | undefined;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let awaitingPong = false;
  let missedPongs = 0;
  let fatalReported = false;
  let recoveryRunning = false;
  let disposed = false;
  const reportCallbackError = callbacks.onCallbackError
    || ((operation: string, error: unknown) => console.error('[VocivoVoice]', { operation, error }));

  const runHeartbeatRecovery = (reason: string) => {
    if (disposed || recoveryRunning) return;
    recoveryRunning = true;
    awaitingPong = false;
    missedPongs = 0;
    Promise.resolve(callbacks.onHeartbeatFailure({ type: 'heartbeat', reason }))
      .catch((error) => reportCallbackError('heartbeat-recovery-callback', error))
      .finally(() => { recoveryRunning = false; });
  };
  const recordMiss = (reason: string) => {
    missedPongs += 1;
    if (missedPongs >= maximumMisses) runHeartbeatRecovery(reason);
  };
  const onMessage = (event: SocketEvent) => {
    if (typeof event.data === 'string' && /^(\r\n)+$/.test(event.data)) {
      awaitingPong = false;
      missedPongs = 0;
    }
  };
  const reportFatal = (failure: SipTransportFailure) => {
    if (disposed || fatalReported) return;
    fatalReported = true;
    Promise.resolve(callbacks.onFatalDisconnect(failure))
      .catch((error) => reportCallbackError('fatal-disconnect-callback', error));
  };
  const onClose = (event: SocketEvent) => {
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
    void transport.send('\r\n\r\n').catch(() => {
      awaitingPong = false;
      recordMiss('The SIP WebSocket heartbeat could not be sent twice.');
    });
  };
  const startHeartbeat = () => {
    if (heartbeatTimer || disposed) return;
    heartbeatTimer = setInterval(heartbeat, heartbeatIntervalMs);
  };
  const onTransportState = (state: unknown) => {
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
  const resolveRegistration = () => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    resolvePending();
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
        onAccept: resolveRegistration,
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
