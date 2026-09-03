import type { VoiceInviteHeader } from './voiceEngine';

/**
 * The slice of SIP.js that Vocivo's bridge actually uses.
 *
 * The bridge is written against these interfaces rather than against SIP.js
 * itself for two reasons. It keeps the whole call path unit-testable with
 * fakes — none of the interesting logic needs a socket, a peer connection or a
 * device. And it keeps a single, reviewable list of everything the app depends
 * on in a third-party stack, so swapping the stack later is a change to one
 * factory rather than a change to the call engine.
 *
 * The real implementations live in `sipStackSipJs.ts`, which is the only file
 * that imports `sip.js`.
 */

/** SIP.js `SessionState`, as strings so nothing here imports the library. */
export type SipSessionState = 'Initial' | 'Establishing' | 'Established' | 'Terminating' | 'Terminated';

/** SIP.js `RegistererState`. */
export type SipRegistererState = 'Initial' | 'Registered' | 'Unregistered' | 'Terminated';

export type SipDisposition = {
  /** SIP status code of the response that ended the session, when there was one. */
  statusCode?: number;
  reason?: string;
};

export type SipSessionHandle = {
  /** Stable identifier; the bridge uses it as the Vocivo call id. */
  readonly id: string;
  readonly incoming: boolean;
  readonly remoteDisplayName: string;
  readonly remoteUser: string;
  readonly remoteTarget: string;
  /** Custom `X-` headers carried on the INVITE, already parsed. */
  readonly headers: VoiceInviteHeader[];

  onStateChange(listener: (state: SipSessionState) => void): void;
  /** Resolves with how the session ended once it reaches `Terminated`. */
  disposition(): SipDisposition;

  accept(): Promise<void>;
  /** Ends the session whatever stage it is at: CANCEL, 486 or BYE as appropriate. */
  terminate(): Promise<void>;
  setHold(on: boolean): Promise<void>;
  setMuted(on: boolean): Promise<void>;
  sendDtmf(digit: string): Promise<void>;
};

export type SipStack = {
  onRegistrationChange(listener: (state: SipRegistererState, reason?: string) => void): void;
  onInvitation(listener: (session: SipSessionHandle) => void): void;
  /** Brings up the transport and sends REGISTER. */
  start(): Promise<void>;
  /** Sends un-REGISTER and tears the transport down. Must not throw. */
  stop(): Promise<void>;
  invite(target: string, headers: VoiceInviteHeader[]): Promise<SipSessionHandle>;
  /** Audio route. Implemented by the platform module, not by SIP.js. */
  setSpeaker(on: boolean): Promise<void>;
};

export type SipStackConfig = {
  username: string;
  password: string;
  domain: string;
  /** `wss://sip.vocivo.app:7443` — Vocivo's own Kamailio, never a carrier. */
  wsUri?: string;
  displayName?: string;
};

/**
 * Builds a stack for one registration.
 *
 * Allowed to be asynchronous so the SIP and WebRTC implementation can be
 * imported only when a SIP registration actually happens — a build still on the
 * carrier edge should not be loading a second call stack at start-up, and the
 * WebRTC binding cannot even be imported off a device.
 */
export type SipStackFactory = (config: SipStackConfig) => SipStack | Promise<SipStack>;
