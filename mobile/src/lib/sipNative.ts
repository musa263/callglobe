import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { bindCallUi, type CallUiEventSource, type NativeCallUi } from '../voice/callUi';
import { SipEventBus, SipStackBridge } from '../voice/sipBridge';
import { SipVoiceClient } from '../voice/sipCallEngine';

/**
 * The React Native binding for Vocivo's own voice stack.
 *
 * This file is the only place that touches `NativeModules`. SIP signalling and
 * media live in JavaScript (`../voice/sipStackSipJs`) and talk to Vocivo's own
 * Kamailio and RTPEngine; the native `VocivoSip` module supplies only the
 * system call UI and the VoIP-push wake-up, which cannot be done from JS.
 */

export type VocivoSipModule = NativeCallUi;

export function vocivoSipModule(): VocivoSipModule | null {
  const native = NativeModules.VocivoSip as VocivoSipModule | undefined;
  return native || null;
}

function requireModule(): VocivoSipModule {
  const native = vocivoSipModule();
  if (!native) {
    throw new Error(Platform.OS === 'ios'
      ? 'Vocivo CallKit is not linked in this build. Telnyx remains the voice client.'
      : 'Vocivo call handling is not available on this platform.');
  }
  return native;
}

let bus: SipEventBus | null = null;
let bridge: SipStackBridge | null = null;
let client: SipVoiceClient | null = null;
let binding: { remove: () => void } | null = null;

function ensureBridge() {
  if (bridge && bus) return { bridge, bus };
  const native = vocivoSipModule();
  const events = new SipEventBus();
  const created = new SipStackBridge({
    events,
    createStack: async (config) => {
      // Imported here rather than at the top of the file: this pulls in SIP.js
      // and react-native-webrtc, and a build still running on the carrier edge
      // should never load them — react-native-webrtc cannot even be imported
      // where the native module is absent.
      const { createSipJsStack } = await import('../voice/sipStackSipJs');
      return createSipJsStack(config, {
        // Routing to the loudspeaker is an audio-session change, so it stays
        // with the platform module even though the rest of this is JavaScript.
        setSpeaker: native ? (on: boolean) => native.setSpeaker(on) : undefined,
      });
    },
  });
  bus = events;
  bridge = created;
  return { bridge: created, bus: events };
}

export async function registerVocivoSip(config: {
  username: string;
  password: string;
  domain: string;
  wsUri?: string;
  displayName?: string;
}) {
  await ensureBridge().bridge.register(config);
}

export async function unregisterVocivoSip() {
  if (!bridge) return;
  await bridge.unregister();
}

export async function inviteVocivoSip(target: string, headers?: Array<{ name: string; value: string }>) {
  return ensureBridge().bridge.invite(target, headers);
}

export async function hangupVocivoSip(callId?: string) {
  if (!bridge) return;
  await bridge.hangup(callId);
}

export async function setVocivoSipSpeaker(on: boolean) {
  await ensureBridge().bridge.setSpeaker(on);
  // Keep the system call screen's own speaker button in step when it is there.
  await vocivoSipModule()?.setSpeaker(on).catch(() => undefined);
}

/**
 * Flips the audio route and reports where it ended up.
 *
 * The bridge is the one that knows the current route, because the native
 * module's own speaker state is only meaningful while a call is up.
 */
export async function toggleVocivoSipSpeaker() {
  const next = !ensureBridge().bridge.speakerOn;
  await setVocivoSipSpeaker(next);
  return next;
}

/** Takes a call off the system call screen when the engine no longer can. */
export async function endVocivoSipCallUi(callId: string) {
  await vocivoSipModule()?.reportCallEnded({ callId, reason: 'ended' }).catch(() => undefined);
}

/** True when this build can show a native incoming-call screen. */
export async function callUiAvailable() {
  const native = vocivoSipModule();
  if (!native) return false;
  return native.isCallUiAvailable().catch(() => false);
}

/**
 * Builds the voice client that replaces the Telnyx one when the edge is `sip`.
 *
 * Returns a client whether or not the native module is linked: the SIP stack
 * itself is pure JavaScript, so calls work in the foreground on any build. What
 * the native module adds is the OS call screen and the ability to ring a phone
 * whose app has been killed.
 */
export function createSipVoiceClient(): SipVoiceClient {
  if (client) return client;
  const { bridge: sipBridge, bus: events } = ensureBridge();
  const native = vocivoSipModule();
  if (native) {
    binding?.remove();
    binding = bindCallUi({
      events,
      bridge: sipBridge,
      native,
      ui: new NativeEventEmitter(NativeModules.VocivoSip) as unknown as CallUiEventSource,
    });
  }
  client = new SipVoiceClient({ bridge: sipBridge, events });
  return client;
}

/** Drops the client and its listeners. Used on sign-out and in tests. */
export function disposeSipVoiceClient() {
  binding?.remove();
  binding = null;
  client = null;
  bridge = null;
  bus = null;
}

export { requireModule as requireVocivoSipModule };
