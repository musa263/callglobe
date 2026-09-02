import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { SipVoiceClient } from '../voice/sipCallEngine';
import type { NativeSipBridge, SipEventSource } from '../voice/voiceEngine';

/**
 * The React Native binding for Vocivo's own SIP stack.
 *
 * This file is the only place that touches `NativeModules`; the call logic
 * lives in `../voice/sipCallEngine`, which takes the bridge as an argument so
 * it can be tested without a device.
 */

export type VocivoSipModule = NativeSipBridge;

export function vocivoSipModule(): VocivoSipModule | null {
  const native = NativeModules.VocivoSip as VocivoSipModule | undefined;
  return native || null;
}

function requireModule(): VocivoSipModule {
  const native = vocivoSipModule();
  if (!native) {
    throw new Error(Platform.OS === 'ios'
      ? 'Vocivo SIP CallKit is not linked in this build. Telnyx remains the voice client.'
      : 'Vocivo SIP is not available on this platform.');
  }
  return native;
}

export async function registerVocivoSip(config: Parameters<VocivoSipModule['register']>[0]) {
  await requireModule().register(config);
}

export async function unregisterVocivoSip() {
  await requireModule().unregister();
}

export async function inviteVocivoSip(target: string, headers?: Parameters<VocivoSipModule['invite']>[1]) {
  return requireModule().invite(target, headers);
}

export async function hangupVocivoSip(callId?: string) {
  await requireModule().hangup(callId);
}

export async function setVocivoSipSpeaker(on: boolean) {
  await requireModule().setSpeaker(on);
}

/**
 * Builds the voice client that replaces the Telnyx one when the edge is `sip`.
 * Returns null when the native module is not linked, so the caller can fall
 * back rather than crash a build that has not shipped the module yet.
 */
export function createSipVoiceClient(): SipVoiceClient | null {
  const native = vocivoSipModule();
  if (!native) return null;
  const events = new NativeEventEmitter(NativeModules.VocivoSip) as unknown as SipEventSource;
  return new SipVoiceClient({ bridge: native, events });
}
