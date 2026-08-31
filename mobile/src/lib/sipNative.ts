import type { Session } from 'sip.js';

type NativeConfig = {
  username: string;
  password: string;
  domain: string;
  wsUri?: string;
  displayName?: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
};

type VocivoSipNative = {
  register(config: NativeConfig): Promise<void>;
  unregister(): Promise<void>;
  invite(target: string, headers?: Array<{ name: string; value: string }>): Promise<string>;
  hangup(callId?: string): Promise<void>;
  answer(callId?: string): Promise<void>;
};

type SipEventHandlers = {
  onIncomingCall?: (event: { callId?: string; from?: string; displayName?: string }) => void;
  onCallConnected?: (event: { callId?: string }) => void;
  onCallRinging?: (event: { callId?: string }) => void;
  onCallEnded?: (event: { callId?: string }) => void;
  onRegistered?: () => void;
};

let nativeRegistered = false;
let jsAgentReady = false;
let realm = '';
let nativeHangup: ((callId?: string) => Promise<void>) | null = null;
const readyListeners = new Set<(ready: boolean) => void>();

function emitReady(ready: boolean) {
  readyListeners.forEach((listener) => listener(ready));
}

async function sipJs() {
  return import('./sipJsClient');
}

function loadNativeModules(): { VocivoSip?: VocivoSipNative } {
  try {
    return (require('react-native') as typeof import('react-native')).NativeModules || {};
  } catch {
    return {};
  }
}

export function vocivoSipModule(): VocivoSipNative | null {
  const fromRn = loadNativeModules().VocivoSip;
  if (fromRn) return fromRn;
  try {
    const { requireOptionalNativeModule } = require('expo-modules-core') as typeof import('expo-modules-core');
    return requireOptionalNativeModule<VocivoSipNative>('VocivoSip');
  } catch {
    return null;
  }
}

export function sipClientReady() {
  return nativeRegistered || jsAgentReady;
}

export function sipDomain() {
  return realm;
}

export function onVocivoSipReady(listener: (ready: boolean) => void) {
  readyListeners.add(listener);
  listener(sipClientReady());
  return () => { readyListeners.delete(listener); };
}

export function subscribeVocivoSipEvents(handlers: SipEventHandlers) {
  const native = vocivoSipModule();
  if (!native) return () => undefined;
  type Emitter = { addListener: (event: string, listener: (payload: Record<string, string>) => void) => { remove: () => void } };
  let emitter: Emitter;
  try {
    const { EventEmitter } = require('expo-modules-core') as typeof import('expo-modules-core');
    emitter = new EventEmitter(native as never) as Emitter;
  } catch {
    try {
      const { NativeEventEmitter } = require('react-native') as typeof import('react-native');
      emitter = new NativeEventEmitter(native as never) as Emitter;
    } catch {
      return () => undefined;
    }
  }
  const subscriptions = [
    handlers.onIncomingCall ? emitter.addListener('onIncomingCall', (payload) => handlers.onIncomingCall?.(payload)) : null,
    handlers.onCallConnected ? emitter.addListener('onCallConnected', (payload) => handlers.onCallConnected?.(payload)) : null,
    handlers.onCallRinging ? emitter.addListener('onCallRinging', (payload) => handlers.onCallRinging?.(payload)) : null,
    handlers.onCallEnded ? emitter.addListener('onCallEnded', (payload) => handlers.onCallEnded?.(payload)) : null,
    handlers.onRegistered ? emitter.addListener('onRegistered', () => handlers.onRegistered?.()) : null,
  ].filter(Boolean) as Array<{ remove: () => void }>;
  return () => subscriptions.forEach((subscription) => subscription.remove());
}

export async function registerVocivoSip(config: NativeConfig) {
  realm = config.domain;
  const native = vocivoSipModule();
  if (native) {
    await native.register(config);
    nativeRegistered = true;
    jsAgentReady = false;
    nativeHangup = (callId) => native.hangup(callId);
    emitReady(true);
    const js = await sipJs();
    js.markExternalSipReady(config.domain, true);
    return;
  }
  const js = await sipJs();
  await js.startSipUserAgent(config);
  jsAgentReady = true;
  nativeRegistered = false;
  emitReady(true);
}

export async function unregisterVocivoSip() {
  const native = vocivoSipModule();
  nativeRegistered = false;
  jsAgentReady = false;
  nativeHangup = null;
  realm = '';
  emitReady(false);
  const js = await sipJs();
  js.markExternalSipReady('', false);
  if (native) {
    await native.unregister();
    return;
  }
  await js.stopSipUserAgent();
}

export async function inviteVocivoSip(target: string, headers: Array<{ name: string; value: string }> = []) {
  const native = vocivoSipModule();
  if (native && nativeRegistered) {
    const id = await native.invite(target, headers);
    return {
      id,
      native: true as const,
      hangup: async () => { await native.hangup(id); },
    };
  }
  const js = await sipJs();
  const session = await js.sipInvite(target, headers);
  return {
    id: js.sipSessionId(session),
    native: false as const,
    session,
    hangup: async () => { await js.hangupSipSession(session); },
  };
}

export async function hangupVocivoSip(session?: Session | null, callId?: string) {
  if (nativeRegistered && nativeHangup) {
    await nativeHangup(callId);
    return;
  }
  const js = await sipJs();
  await js.hangupSipSession(session);
}

export async function answerVocivoSip(callId?: string) {
  const native = vocivoSipModule();
  if (native && nativeRegistered) {
    await native.answer(callId);
  }
}
