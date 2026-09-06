import { mediaDevices, registerGlobals } from 'react-native-webrtc';
import {
  Invitation,
  Inviter,
  Registerer,
  RegistererState,
  RequestPendingError,
  SessionState,
  UserAgent,
  type Session,
} from 'sip.js';
import type { IncomingResponse } from 'sip.js/lib/core';
import {
  defaultSessionDescriptionHandlerFactory,
  type SessionDescriptionHandler,
  type SessionDescriptionHandlerOptions as WebSessionDescriptionHandlerOptions,
} from 'sip.js/lib/platform/web';
import { createRegistrationKeeper } from './sipRegistrationKeeper';
import { terminationDeadline } from '../state/terminationDeadline';
import type {
  SipDisposition,
  SipRegistererState,
  SipSessionHandle,
  SipSessionState,
  SipStack,
  SipStackConfig,
} from './sipStack';
import type { VoiceInviteHeader } from './voiceEngine';

/**
 * The one file that talks to SIP.js, and the one file that decides where calls
 * go: `wss://sip.vocivo.app` — Vocivo's own Kamailio, with media relayed by
 * Vocivo's own RTPEngine. No carrier SDK sits in the signalling or the media
 * path, so an internal extension-to-extension call costs nothing and never
 * leaves the tenant's own edge.
 *
 * The system call UI (CallKit on iOS, ConnectionService on Android) and the
 * audio route stay in native code, because they have to run before JavaScript
 * exists. Everything else is here.
 */

let globalsRegistered = false;

/** react-native-webrtc installs `RTCPeerConnection` and friends onto global. */
function ensureWebrtcGlobals() {
  if (globalsRegistered) return;
  registerGlobals();
  globalsRegistered = true;
}

/** Vocivo is voice-only: never ask for the camera, and never negotiate video. */
const audioOnly: MediaStreamConstraints = { audio: true, video: false };

const sdhFactory = defaultSessionDescriptionHandlerFactory(async () => {
  // Goes straight to react-native-webrtc rather than through the
  // `navigator.mediaDevices` shim, which is not present on every RN version.
  return mediaDevices.getUserMedia({ audio: true, video: false }) as unknown as MediaStream;
});

function toSipSessionState(state: SessionState): SipSessionState {
  switch (state) {
    case SessionState.Initial: return 'Initial';
    case SessionState.Establishing: return 'Establishing';
    case SessionState.Established: return 'Established';
    case SessionState.Terminating: return 'Terminating';
    default: return 'Terminated';
  }
}

function toSipRegistererState(state: RegistererState): SipRegistererState {
  switch (state) {
    case RegistererState.Initial: return 'Initial';
    case RegistererState.Registered: return 'Registered';
    case RegistererState.Unregistered: return 'Unregistered';
    default: return 'Terminated';
  }
}

/**
 * Pulls the `X-` headers off an INVITE.
 *
 * Vocivo's edge uses these to carry the call UUID and the tenant, which the
 * app needs in order to reconcile a ringing call with the record the API
 * created for it.
 */
function customHeaders(session: Session): VoiceInviteHeader[] {
  const request = (session as Invitation).request as { headers?: Record<string, Array<{ raw?: string }>> } | undefined;
  const raw = request?.headers;
  if (!raw) return [];
  const headers: VoiceInviteHeader[] = [];
  for (const [name, values] of Object.entries(raw)) {
    if (!name.toLowerCase().startsWith('x-')) continue;
    for (const value of values) {
      const text = value?.raw ?? '';
      const separator = text.indexOf(':');
      headers.push({ name, value: (separator >= 0 ? text.slice(separator + 1) : text).trim() });
    }
  }
  return headers;
}

class SipJsSession implements SipSessionHandle {
  readonly headers: VoiceInviteHeader[];
  readonly remoteDisplayName: string;
  readonly remoteUser: string;
  readonly remoteTarget: string;

  private listener: ((state: SipSessionState) => void) | null = null;
  private ended: SipDisposition = {};
  private held = false;
  private disposal?: Promise<void>;
  private readonly stateListener = (state: SessionState) => {
    try {
      this.listener?.(toSipSessionState(state));
    } finally {
      if (state === SessionState.Terminated) {
        this.session.stateChange.removeListener(this.stateListener);
        this.listener = null;
      }
    }
  };

  constructor(private readonly session: Session, readonly id: string, readonly incoming: boolean) {
    const identity = session.remoteIdentity;
    this.remoteDisplayName = identity?.displayName ?? '';
    this.remoteUser = identity?.uri?.user ?? '';
    this.remoteTarget = identity?.uri?.toString() ?? '';
    this.headers = incoming ? customHeaders(session) : [];

    // An ordinary hang-up leaves `ended` empty: no status code is precisely how
    // the bridge tells a BYE apart from a rejection.
    session.stateChange.addListener(this.stateListener);
  }

  /** Records why the far end refused, so the UI can tell busy from broken. */
  noteRejection(response: IncomingResponse) {
    this.ended = {
      statusCode: response.message.statusCode,
      reason: response.message.reasonPhrase,
    };
  }

  onStateChange(listener: (state: SipSessionState) => void) {
    this.listener = listener;
  }

  disposition() {
    return this.ended;
  }

  peerConnection() {
    return this.currentPeerConnection();
  }

  async accept() {
    if (!(this.session instanceof Invitation)) throw new Error('Only an incoming call can be answered.');
    await this.session.accept({ sessionDescriptionHandlerOptions: { constraints: audioOnly } });
  }

  async restartMedia() {
    if (this.session.state !== SessionState.Established) throw new Error('Cannot renegotiate a call that is not established.');
    const options: WebSessionDescriptionHandlerOptions = {
      constraints: audioOnly,
      hold: this.held,
      offerOptions: { iceRestart: true },
    };
    // SIP.js owns offer creation and local/remote SDP application. Setting
    // iceRestart here keeps the offer and re-INVITE in one SIP transaction.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('SIP media restart timed out.')), 10_000);
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      this.session.invite({
        sessionDescriptionHandlerOptions: options,
        requestDelegate: {
          onAccept: () => finish(),
          onReject: (response) => finish(new Error(`SIP media restart rejected (${response.message.statusCode}).`)),
        },
      }).catch(finish);
    });
  }

  async terminate() {
    switch (this.session.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        if (this.session instanceof Inviter) await this.session.cancel();
        else if (this.session instanceof Invitation) await this.session.reject();
        return;
      case SessionState.Established:
        await this.session.bye();
        return;
      default:
        // Already going away; nothing to send.
        return;
    }
  }

  dispose() {
    if (this.disposal) return this.disposal;
    this.listener = null;
    this.session.stateChange.removeListener(this.stateListener);
    // SIP.js closes media as part of disposal, but an early-dialog CANCEL can
    // fail before it reaches that step. Close media first, independently.
    this.session.sessionDescriptionHandler?.close();
    this.disposal = terminationDeadline(Promise.resolve().then(() => this.session.dispose()));
    return this.disposal;
  }

  async setHold(on: boolean) {
    if (this.held === on) return;
    this.held = on;
    // Applies to this re-INVITE and to every later one, so a hold survives a
    // subsequent renegotiation instead of silently un-holding the call.
    const holdOptions: WebSessionDescriptionHandlerOptions = { hold: on, constraints: audioOnly };
    this.session.sessionDescriptionHandlerOptionsReInvite = holdOptions;
    await this.session.invite({ sessionDescriptionHandlerOptions: holdOptions });
  }

  async setMuted(on: boolean) {
    // Mute is local only: stopping the track would renegotiate and the far end
    // would hear the line drop rather than silence.
    for (const sender of this.currentPeerConnection()?.getSenders() ?? []) {
      if (sender.track) sender.track.enabled = !on;
    }
  }

  async sendDtmf(digit: string) {
    const handler = this.session.sessionDescriptionHandler as SessionDescriptionHandler | undefined;
    if (handler?.sendDtmf(digit)) return;
    // RFC 2833 was unavailable — fall back to SIP INFO, which every softswitch
    // including FreeSWITCH still accepts.
    await this.session.info({
      requestOptions: {
        body: {
          contentDisposition: 'render',
          contentType: 'application/dtmf-relay',
          content: `Signal=${digit}\r\nDuration=160`,
        },
      },
    });
  }

  private currentPeerConnection() {
    const handler = this.session.sessionDescriptionHandler as SessionDescriptionHandler | undefined;
    return handler?.peerConnection;
  }
}

export type SipJsStackOptions = {
  /** Set the audio route. Implemented by the native call-UI module. */
  setSpeaker?: (on: boolean) => Promise<void>;
  /** STUN/TURN. Defaults to Vocivo's own coturn on the SIP edge. */
  iceServers?: RTCIceServer[];
  /** Injected by tests; defaults to setTimeout. */
  schedule?: (callback: () => void, delayMs: number) => unknown;
};

export function createSipJsStack(config: SipStackConfig, options: SipJsStackOptions = {}): SipStack {
  ensureWebrtcGlobals();

  const uri = UserAgent.makeURI(`sip:${config.username}@${config.domain}`);
  if (!uri) throw new Error(`Not a usable SIP address: ${config.username}@${config.domain}`);

  let onRegistration: ((state: SipRegistererState, reason?: string) => void) | null = null;
  let onInvitation: ((session: SipSessionHandle) => void) | null = null;
  let sequence = 0;
  const nextId = () => `vocivo-${Date.now().toString(36)}-${(sequence += 1)}`;

  const userAgent = new UserAgent({
    uri,
    displayName: config.displayName,
    authorizationUsername: config.username,
    authorizationPassword: config.password,
    transportOptions: {
      server: config.wsUri ?? `wss://${config.domain}/ws`,
      // A dropped socket on a moving phone is normal, not exceptional.
      keepAliveInterval: 30,
    },
    sessionDescriptionHandlerFactory: sdhFactory,
    sessionDescriptionHandlerFactoryOptions: {
      iceGatheringTimeout: 3000,
      peerConnectionConfiguration: {
        iceServers: config.iceServers ?? options.iceServers ?? [{ urls: `stun:${config.domain}:3478` }],
      },
    },
    logLevel: 'warn',
    delegate: {
      onInvite: (invitation) => {
        // Prefer the edge's own call UUID as the id. The VoIP push carries the
        // same value, so the call CallKit is already showing and the INVITE
        // that follows it are one call rather than two.
        const uuid = customHeaders(invitation).find((header) => header.name.toLowerCase() === 'x-vocivo-call-uuid')?.value;
        const handle = new SipJsSession(invitation, uuid || nextId(), true);
        onInvitation?.(handle);
      },
      // SIP.js itself never reconnects (reconnectionAttempts defaults to 0)
      // and never re-REGISTERs after a reconnect; the keeper does both.
      onConnect: () => keeper.onConnect(),
      onDisconnect: (error) => keeper.onDisconnect(error),
    },
  });

  const registerer = new Registerer(userAgent, { expires: 600 });
  const registrationListener = (state: RegistererState) => {
    if (state === RegistererState.Registered) keeper.onRegistered();
    if (state === RegistererState.Unregistered) keeper.onUnregistered();
    // A REGISTER that failed because the socket was down comes back as a
    // synthetic 503 and an Unregistered state. While the keeper is bringing
    // the socket back that is "reconnecting", not "signed out": the UI keeps
    // any call up instead of closing it over a blip.
    if (state === RegistererState.Unregistered && keeper.wanted && !userAgent.isConnected()) {
      onRegistration?.('Reconnecting', 'registration lapsed while the connection was down');
      return;
    }
    onRegistration?.(toSipRegistererState(state));
  };
  registerer.stateChange.addListener(registrationListener);

  const keeper = createRegistrationKeeper({
    isConnected: () => userAgent.isConnected(),
    reconnect: () => userAgent.reconnect(),
    isRegistered: () => registerer.state === RegistererState.Registered,
    isPending: (error) => error instanceof RequestPendingError,
    notify: (state, reason) => onRegistration?.(state, reason),
    schedule: options.schedule,
    register: () => registerer.register({
      requestDelegate: {
        onReject: (response) => {
          keeper.onUnregistered();
          if (!userAgent.isConnected()) return; // the state listener has already said "reconnecting"
          onRegistration?.('Unregistered', `${response.message.statusCode} ${response.message.reasonPhrase}`);
        },
      },
    }).then(() => undefined),
  });

  return {
    onRegistrationChange: (listener) => { onRegistration = listener; },
    onInvitation: (listener) => { onInvitation = listener; },

    start: async () => {
      await userAgent.start();
      await keeper.start();
    },

    stop: async () => {
      keeper.stop();
      registerer.stateChange.removeListener(registrationListener);
      try {
        await registerer.unregister();
      } catch (error) {
        console.warn('Vocivo SIP unregister failed', { message: error instanceof Error ? error.message : String(error) });
      } finally {
        onRegistration = null;
        onInvitation = null;
        await userAgent.stop();
      }
    },

    refresh: () => keeper.refresh(),

    invite: async (target, headers) => {
      const targetUri = UserAgent.makeURI(target.includes('@') ? `sip:${target.replace(/^sip:/, '')}` : `sip:${target}@${config.domain}`);
      if (!targetUri) throw new Error(`Not a usable call target: ${target}`);
      const inviter = new Inviter(userAgent, targetUri, {
        extraHeaders: headers.map((header) => `${header.name}: ${header.value}`),
        sessionDescriptionHandlerOptions: { constraints: audioOnly },
      });
      const handle = new SipJsSession(inviter, nextId(), false);
      await inviter.invite({
        requestDelegate: {
          onReject: (response) => handle.noteRejection(response),
        },
      });
      return handle;
    },

    setSpeaker: async (on) => {
      await options.setSpeaker?.(on);
    },
  };
}
