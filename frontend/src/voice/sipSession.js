import { UserAgent, Registerer, Inviter, SessionState } from 'sip.js';

export async function connectSipUserAgent(input) {
  const uri = UserAgent.makeURI(`sip:${input.username}@${input.domain}`);
  if (!uri) throw new Error('The SIP address for this extension is invalid.');
  const userAgent = new UserAgent({
    uri,
    authorizationUsername: input.username,
    authorizationPassword: input.password,
    displayName: input.displayName || input.username,
    reconnectionAttempts: 12,
    reconnectionDelay: 2,
    transportOptions: {
      server: input.wsUri,
      connectionTimeout: 12,
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
    },
  });
  await userAgent.start();
  const registerer = new Registerer(userAgent);
  await registerer.register();
  return { userAgent, registerer };
}

export async function inviteSipTarget(userAgent, targetUri, extraHeaders = []) {
  const target = UserAgent.makeURI(targetUri);
  if (!target) throw new Error('The SIP destination is invalid.');
  const inviter = new Inviter(userAgent, target, {
    extraHeaders,
    earlyMedia: false,
      sessionDescriptionHandlerOptions: { constraints: { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false } },
  });
  const sending = inviter.invite();
  sending.catch(() => undefined);
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
