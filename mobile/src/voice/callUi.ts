import type { SipEventBus } from './sipBridge';
import type { NativeSipBridge, SipEventSource, VoiceCallState } from './voiceEngine';

/**
 * The system call UI — CallKit on iOS, ConnectionService on Android.
 *
 * This is all the native `VocivoSip` module does now. SIP itself runs in
 * JavaScript against Vocivo's own edge; native code exists for the two things
 * JavaScript cannot do: draw the incoming-call screen the operating system
 * owns, and be alive before JavaScript is, when a VoIP push arrives at a phone
 * whose app has been killed.
 */
export type NativeCallUi = {
  /**
   * Tell the OS a call is ringing. On iOS this MUST also have happened inside
   * the PushKit delegate before it returned, or iOS kills the app; the module
   * does that itself and replays the event here once JavaScript is running.
   */
  reportIncomingCall(input: { callId: string; callerName?: string; callerNumber?: string }): Promise<void>;
  reportOutgoingCall(input: { callId: string; handle: string }): Promise<void>;
  reportCallConnected(callId: string): Promise<void>;
  /** `reason` is one of the SIP-ish endings the UI can explain: ended, failed, declined, unanswered. */
  reportCallEnded(input: { callId: string; reason: 'ended' | 'failed' | 'declined' | 'unanswered' }): Promise<void>;
  reportMuted(input: { callId: string; muted: boolean }): Promise<void>;
  reportHeld(input: { callId: string; held: boolean }): Promise<void>;
  setSpeaker(on: boolean): Promise<void>;
  /** Whether this build has PushKit/ConnectionService wired at all. */
  isCallUiAvailable(): Promise<boolean>;
};

/** What the user did on the system call screen, rather than in the app. */
export type CallUiEventMap = {
  callUiAnswer: { callId: string };
  callUiEnd: { callId: string };
  callUiMute: { callId: string; muted: boolean };
  callUiHold: { callId: string; held: boolean };
  callUiDtmf: { callId: string; digit: string };
  /**
   * A VoIP push arrived and the module has already put a call on screen. The
   * SIP stack has to get registered fast enough to receive the INVITE the
   * server is holding.
   */
  callUiPushWake: { callId: string; callerName?: string; callerNumber?: string };
};

export type CallUiEventName = keyof CallUiEventMap;

export type CallUiEventSource = {
  addListener<K extends CallUiEventName>(event: K, listener: (payload: CallUiEventMap[K]) => void): { remove: () => void };
};

const endingFor: Record<Extract<VoiceCallState, 'ENDED' | 'FAILED' | 'DROPPED'>, 'ended' | 'failed'> = {
  ENDED: 'ended',
  FAILED: 'failed',
  DROPPED: 'failed',
};

export type CallUiBinding = { remove: () => void };

/**
 * Keeps the system call screen and the SIP engine in step, in both directions.
 *
 * Without this the two drift apart in ways users notice immediately: the call
 * ends but the green banner stays, or they press the CallKit answer button and
 * nothing happens.
 */
export function bindCallUi(options: {
  events: SipEventBus;
  bridge: NativeSipBridge;
  native: NativeCallUi;
  ui: CallUiEventSource;
  onPushWake?: (payload: CallUiEventMap['callUiPushWake']) => void;
}): CallUiBinding {
  const { events, bridge, native, ui, onPushWake } = options;
  const subscriptions: Array<{ remove: () => void }> = [];
  const reported = new Set<string>();
  // Calls the person answered on the system screen before the INVITE reached
  // the stack. After a VoIP push the socket is being brought back while
  // CallKit is already ringing; an answer that arrives first used to throw
  // "Unknown Vocivo SIP call" into a swallowed error, and the caller heard
  // silence. It is applied the moment the call appears instead.
  const answeredEarly = new Set<string>();

  const swallow = (what: string) => (error: unknown) => {
    // Never let a call-UI hiccup take the call down with it.
    console.warn(`Vocivo call UI: ${what} failed`, error instanceof Error ? error.message : error);
  };

  // Engine -> system call screen.
  subscriptions.push(events.addListener('incoming', (payload) => {
    if (answeredEarly.delete(payload.callId)) {
      bridge.answer(payload.callId).catch(swallow('answer a call accepted before its INVITE arrived'));
    }
    if (reported.has(payload.callId)) return;
    reported.add(payload.callId);
    native.reportIncomingCall({
      callId: payload.callId,
      callerName: payload.callerName,
      callerNumber: payload.callerNumber,
    }).catch(swallow('report incoming'));
  }));

  // Outbound calls were never reported: no in-call status bar, nothing in
  // Recents, Bluetooth and CarPlay buttons dead, and the voice-chat audio
  // session — configured on the incoming path — never applied to a dialled
  // call, so headset routing was whatever WebRTC happened to pick.
  subscriptions.push(events.addListener('outgoing', (payload) => {
    if (reported.has(payload.callId)) return;
    reported.add(payload.callId);
    const handle = payload.target.replace(/^sips?:/i, '').split('@')[0] || payload.target;
    native.reportOutgoingCall({ callId: payload.callId, handle }).catch(swallow('report outgoing'));
  }));

  subscriptions.push(events.addListener('callState', (payload) => {
    if (payload.state === 'ACTIVE') {
      native.reportCallConnected(payload.callId).catch(swallow('report connected'));
      return;
    }
    if (payload.state === 'ENDED' || payload.state === 'FAILED' || payload.state === 'DROPPED') {
      reported.delete(payload.callId);
      native.reportCallEnded({ callId: payload.callId, reason: endingFor[payload.state] }).catch(swallow('report ended'));
    }
  }));

  subscriptions.push(events.addListener('mediaState', (payload) => {
    if (!payload.callId) return;
    if (typeof payload.muted === 'boolean') native.reportMuted({ callId: payload.callId, muted: payload.muted }).catch(swallow('report mute'));
    if (typeof payload.onHold === 'boolean') native.reportHeld({ callId: payload.callId, held: payload.onHold }).catch(swallow('report hold'));
  }));

  // System call screen -> engine.
  subscriptions.push(ui.addListener('callUiAnswer', (payload) => {
    bridge.answer(payload.callId).catch((error: unknown) => {
      if (error instanceof Error && /unknown/i.test(error.message)) {
        answeredEarly.add(payload.callId);
        return;
      }
      swallow('answer from call UI')(error);
    });
  }));

  subscriptions.push(ui.addListener('callUiEnd', (payload) => {
    answeredEarly.delete(payload.callId);
    bridge.hangup(payload.callId).catch(swallow('hang up from call UI'));
  }));

  subscriptions.push(ui.addListener('callUiMute', (payload) => {
    bridge.mute(payload.callId, payload.muted).catch(swallow('mute from call UI'));
  }));

  subscriptions.push(ui.addListener('callUiHold', (payload) => {
    bridge.hold(payload.callId, payload.held).catch(swallow('hold from call UI'));
  }));

  subscriptions.push(ui.addListener('callUiDtmf', (payload) => {
    bridge.sendDtmf(payload.callId, payload.digit).catch(swallow('DTMF from call UI'));
  }));

  subscriptions.push(ui.addListener('callUiPushWake', (payload) => {
    // The module has already drawn the call. Remember it so the INVITE that
    // follows does not draw a second one on top.
    reported.add(payload.callId);
    onPushWake?.(payload);
  }));

  return {
    remove: () => {
      subscriptions.forEach((subscription) => subscription.remove());
      subscriptions.length = 0;
      reported.clear();
      answeredEarly.clear();
    },
  };
}

/** Narrow view of the native module, so tests never need React Native. */
export type SipEventSourceLike = SipEventSource;
