import { Inviter, Registerer, SessionState, UserAgent, type Invitation, type Session } from 'sip.js';
import { registerGlobals } from 'react-native-webrtc';

registerGlobals();

type SipCredentials = {
  username: string;
  password: string;
  domain: string;
  wsUri?: string;
  displayName?: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

type IncomingHandler = (invitation: Invitation) => void;

let userAgent: UserAgent | null = null;
let registerer: Registerer | null = null;
let credentials: SipCredentials | null = null;
let incomingHandler: IncomingHandler | null = null;
const readyListeners = new Set<(ready: boolean) => void>();

function emitReady(ready: boolean) {
  readyListeners.forEach((listener) => listener(ready));
}

export function sipUserAgentReady() {
  return Boolean(userAgent);
}

export function sipDomain() {
  return credentials?.domain || '';
}

export function onSipReady(listener: (ready: boolean) => void) {
  readyListeners.add(listener);
  listener(sipUserAgentReady());
  return () => { readyListeners.delete(listener); };
}

export function setSipIncomingHandler(handler: IncomingHandler | null) {
  incomingHandler = handler;
}

export async function startSipUserAgent(input: SipCredentials) {
  await stopSipUserAgent();
  if (!input.wsUri) throw new Error('VOCIVO_SIP_WSS_URI is not configured.');
  const uri = UserAgent.makeURI(`sip:${input.username}@${input.domain}`);
  if (!uri) throw new Error('The SIP address for this extension is invalid.');
  const agent = new UserAgent({
    uri,
    authorizationUsername: input.username,
    authorizationPassword: input.password,
    displayName: input.displayName || input.username,
    transportOptions: { server: input.wsUri },
    sessionDescriptionHandlerFactoryOptions: {
      iceCheckingTimeout: 5000,
      peerConnectionConfiguration: {
        iceServers: Array.isArray(input.iceServers) ? input.iceServers : [],
      },
    },
    delegate: {
      onInvite: (invitation) => incomingHandler?.(invitation),
    },
  });
  await agent.start();
  const nextRegisterer = new Registerer(agent);
  await nextRegisterer.register();
  userAgent = agent;
  registerer = nextRegisterer;
  credentials = input;
  emitReady(true);
}

export async function stopSipUserAgent() {
  const currentRegisterer = registerer;
  const currentAgent = userAgent;
  registerer = null;
  userAgent = null;
  credentials = null;
  emitReady(false);
  try { await currentRegisterer?.unregister(); } catch { /* already gone */ }
  try { await currentAgent?.stop(); } catch { /* already gone */ }
}

export async function sipInvite(targetUri: string, extraHeaders: Array<{ name: string; value: string }> = []) {
  if (!userAgent) throw new Error('The SIP phone is not registered yet.');
  const target = UserAgent.makeURI(targetUri);
  if (!target) throw new Error('The SIP destination is invalid.');
  const inviter = new Inviter(userAgent, target, {
    extraHeaders: extraHeaders.map((header) => `${header.name}: ${header.value}`),
    earlyMedia: false,
    sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } },
  });
  const sending = inviter.invite();
  sending.catch(() => undefined);
  return inviter;
}

export async function hangupSipSession(session?: Session | null) {
  try { await session?.cancel?.(); } catch { /* ringing outbound */ }
  try { await session?.reject?.(); } catch { /* incoming */ }
  try { await session?.bye?.(); } catch { /* established */ }
}

export function sipSessionId(session?: Session | null) {
  return session?.id || session?.request?.callId || '';
}

export { SessionState };
