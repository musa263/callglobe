import { UserAgent, Registerer, RegistererState, RequestPendingError, Inviter, SessionState } from 'sip.js';
import { createRegistrationKeeper } from './sipRegistrationKeeper';

/**
 * Brings up the browser phone against Vocivo's own edge and keeps it there.
 *
 * `input.onRegistration(state, reason)` reports `Registered`, `Reconnecting`
 * (the socket dropped and is being brought back — a call in progress stays
 * up, its media does not depend on the socket) and `Unregistered` (the
 * registrar refused us, or a REGISTER could not be sent). The returned
 * `refresh()` is for the moments a browser gives us — the tab became visible,
 * the network came back — when waiting for the back-off timer would be silly.
 */
export async function connectSipUserAgent(input) {
  const uri = UserAgent.makeURI(`sip:${input.username}@${input.domain}`);
  if (!uri) throw new Error('The SIP address for this extension is invalid.');
  const notify = (state, reason) => input.onRegistration?.(state, reason);
  let keeper = null;
  const userAgent = new UserAgent({
    uri,
    authorizationUsername: input.username,
    authorizationPassword: input.password,
    displayName: input.displayName || input.username,
    transportOptions: {
      server: input.wsUri,
      keepAliveInterval: 30,
    },
    sessionDescriptionHandlerFactoryOptions: {
      iceCheckingTimeout: 5000,
      peerConnectionConfiguration: {
        iceServers: Array.isArray(input.iceServers) ? input.iceServers : [],
      },
    },
    delegate: {
      onInvite: (invitation) => input.onInvite?.(invitation),
      onConnect: () => keeper?.onConnect(),
      onDisconnect: (error) => keeper?.onDisconnect(error),
    },
  });
  const registerer = new Registerer(userAgent, { expires: 600 });
  registerer.stateChange.addListener((state) => {
    if (state === RegistererState.Registered) return notify('Registered');
    if (state === RegistererState.Unregistered) {
      // A REGISTER that failed because the socket was down comes back as a
      // synthetic 503: while the keeper is reconnecting that is not "signed out".
      if (keeper?.wanted && !userAgent.isConnected()) return notify('Reconnecting', 'registration lapsed while the connection was down');
      return notify('Unregistered', 'registration ended');
    }
    return undefined;
  });
  keeper = createRegistrationKeeper({
    isConnected: () => userAgent.isConnected(),
    reconnect: () => userAgent.reconnect(),
    isRegistered: () => registerer.state === RegistererState.Registered,
    isPending: (error) => error instanceof RequestPendingError,
    notify,
    schedule: input.schedule,
    register: () => registerer.register({
      requestDelegate: {
        onReject: (response) => {
          if (!userAgent.isConnected()) return;
          notify('Unregistered', `${response?.message?.statusCode ?? ''} ${response?.message?.reasonPhrase ?? ''}`.trim());
        },
      },
    }).then(() => undefined),
  });
  await userAgent.start();
  await keeper.start();
  return {
    userAgent,
    registerer,
    refresh: () => keeper.refresh(),
    stop: async () => {
      keeper.stop();
      try { await registerer.unregister(); } catch { /* the socket may already be gone */ }
      await userAgent.stop();
    },
  };
}

export async function inviteSipTarget(userAgent, targetUri, extraHeaders = [], handlers = {}) {
  const target = UserAgent.makeURI(targetUri);
  if (!target) throw new Error('The SIP destination is invalid.');
  const inviter = new Inviter(userAgent, target, {
    extraHeaders,
    earlyMedia: false,
    sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
  });
  // The rejection is the one thing the person needs to see: without it a
  // refused call just ended, with no word on why.
  const sending = inviter.invite({
    requestDelegate: {
      onReject: (response) => handlers.onReject?.(response?.message?.statusCode, response?.message?.reasonPhrase),
    },
  });
  sending.catch((failure) => handlers.onError?.(failure));
  return inviter;
}

export function attachSipMedia(session, elementId = 'remoteMedia') {
  const element = document.getElementById(elementId);
  session.stateChange.addListener((state) => {
    if (state !== SessionState.Established) return;
    const pc = session.sessionDescriptionHandler?.peerConnection;
    const remote = new MediaStream();
    pc?.getReceivers().forEach((receiver) => {
      if (receiver.track) remote.addTrack(receiver.track);
    });
    if (element && 'srcObject' in element) element.srcObject = remote;
    element?.play?.().catch(() => undefined);
  });
}

export function sipSessionId(session) {
  return session?.id || session?.request?.callId || '';
}
