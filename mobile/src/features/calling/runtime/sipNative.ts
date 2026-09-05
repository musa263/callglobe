import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from '../../../shared/api';
import type { SipStackConfig } from '../engine/sipStack';
import { bindCallUi, type CallUiEventSource, type NativeCallUi } from '../engine/callUi';
import { SipEventBus, SipStackBridge } from '../engine/sipBridge';
import { SipVoiceClient } from '../engine/sipCallEngine';

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
let registrationRequest: Promise<number> | null = null;
let registeredConfig: SipStackConfig | null = null;
let registrationEpoch = 0;
const sipSessionKey = 'vocivo.secure.sip-session.v1';

/** Shared by foreground registration and a native killed-state wake. */
export function ensureSipRegistration(forceRenew = false): Promise<number> {
  if (registrationRequest) return registrationRequest;
  const epoch = registrationEpoch;
  registrationRequest = (async () => {
    const sessionToken = await api.getSessionToken();
    if (!sessionToken) throw new Error('Sign in before receiving calls.');
    const raw = await SecureStore.getItemAsync(sipSessionKey);
    let cached: { sessionToken: string; config: SipStackConfig; expiresAt: number } | null = null;
    try { cached = raw ? JSON.parse(raw) : null; }
    catch { console.warn('[Vocivo SIP] Ignoring invalid secure session cache'); }
    if (forceRenew || cached?.sessionToken !== sessionToken || !cached?.config?.password || !Number.isFinite(cached?.expiresAt) || Date.now() >= cached!.expiresAt - 30_000) cached = null;
    if (!cached) {
      const sip = await api.post<{ username: string; password: string; domain: string; wsUri: string; expires_in: number; ice_servers?: SipStackConfig['iceServers'] }>('/api/voice/sip-credentials', { client: 'mobile' });
      if (!sip.username || !sip.password || !sip.wsUri || !(sip.expires_in > 0)) throw new Error('Incomplete SIP credentials.');
      cached = { sessionToken, expiresAt: Date.now() + sip.expires_in * 1000, config: {
        username: sip.username, password: sip.password, domain: sip.domain, wsUri: sip.wsUri, iceServers: sip.ice_servers,
      } };
    }
    if (epoch !== registrationEpoch || await api.getSessionToken() !== sessionToken) throw new Error('Calling session changed.');
    await SecureStore.setItemAsync(sipSessionKey, JSON.stringify(cached), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
    if (epoch !== registrationEpoch) {
      await SecureStore.deleteItemAsync(sipSessionKey);
      throw new Error('Calling session changed.');
    }
    await registerVocivoSip(cached.config);
    if (epoch !== registrationEpoch) throw new Error('Calling session changed.');
    return Math.max(0, (cached.expiresAt - Date.now()) / 1000);
  })().finally(() => { registrationRequest = null; });
  return registrationRequest;
}

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
      const { createSipJsStack } = await import('../engine/sipStackSipJs');
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
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
}) {
  if (registeredConfig && registeredConfig.username === config.username && registeredConfig.password === config.password && registeredConfig.domain === config.domain) {
    await ensureBridge().bridge.refresh();
    return;
  }
  await ensureBridge().bridge.register(config);
  registeredConfig = config;
}

export async function unregisterVocivoSip() {
  registrationEpoch += 1;
  registeredConfig = null;
  // Invalidate first, then drain a boot already in flight before the final stop.
  const pending = registrationRequest;
  if (bridge) await bridge.unregister();
  if (pending) await pending.catch((error) => console.warn('[Vocivo SIP] Canceled registration', error));
  if (bridge) await bridge.unregister();
  registeredConfig = null;
  await SecureStore.deleteItemAsync(sipSessionKey);
}

/** Reconnects and re-registers if the app was away or the network moved. */
export async function refreshVocivoSip() {
  if (!bridge) return;
  await bridge.refresh();
}

/**
 * After a VoIP push: get registered again, quickly, trying a few times —
 * the radio may still be coming up when the first attempt is made.
 */
async function wakeRegistration() {
  const epoch = registrationEpoch;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (epoch !== registrationEpoch) throw new Error('Calling session changed.');
    try {
      await ensureSipRegistration();
      return;
    } catch (error) {
      console.warn('Vocivo SIP: re-registration after push failed', error instanceof Error ? error.message : error);
      if (attempt === 3 || epoch !== registrationEpoch) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
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
  client = new SipVoiceClient({ bridge: sipBridge, events, unregister: unregisterVocivoSip });
  const native = vocivoSipModule();
  if (native) {
    binding?.remove();
    binding = bindCallUi({
      events,
      bridge: sipBridge,
      native,
      ui: new NativeEventEmitter(NativeModules.VocivoSip) as unknown as CallUiEventSource,
      onPushWake: async () => {
        // The native signed-in gate already ran; the API/cache is still bound
        // to this device's current authenticated session, never to push fields.
        const { voice } = await import('../engine/voiceClientFacade');
        const { sipEngine } = await import('../engine/engines');
        const engine = sipEngine();
        voice.use(engine.name, engine.client, engine.platform);
        await wakeRegistration();
      },
    });
  }
  return client;
}

/** Drops the client and its listeners. Used on sign-out and in tests. */
export function disposeSipVoiceClient() {
  registrationEpoch += 1;
  registeredConfig = null;
  binding?.remove();
  binding = null;
  client?.dispose();
  bridge?.unregister().catch((error) => console.warn('[Vocivo SIP] Disposed client cleanup failed', error));
  client = null;
  bridge = null;
  bus = null;
}

export { requireModule as requireVocivoSipModule };
