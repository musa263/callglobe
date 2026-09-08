import { ConnectionState, type VoiceConnectionState } from './voiceEngine';
import { getVoicePushToken } from '../runtime/voipClient';
import { refreshVocivoSip } from '../runtime/sipNative';
import { voice } from './voiceClientFacade';
import type { VoiceLoginConfig, VoiceTokenResponse } from './contracts';

export function voiceLoginConfig(response: VoiceTokenResponse, ringtone: string): VoiceLoginConfig {
  if (!response.token?.trim()) throw new Error('A calling session token was not returned.');
  const requestedLifetime = Number(response.expires_in ?? 3600);
  if (!Number.isFinite(requestedLifetime) || requestedLifetime <= 0) throw new Error('The calling session has expired.');
  const lifetimeSeconds = requestedLifetime;
  const iceServers = Array.isArray(response.ice_servers) && response.ice_servers.length
    ? response.ice_servers
    : undefined;
  return { token: response.token.trim(), expiresAt: Date.now() + lifetimeSeconds * 1000, iceServers, ringtone };
}

export async function waitForVoicePushToken(): Promise<string | undefined> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const token = await getVoicePushToken();
    if (token) return token;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

export function createRouteId() {
  return `vc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Waits for whichever engine is carrying calls to be registered.
 *
 * This used to watch the carrier SDK's connection state. On Vocivo's own edge
 * that SDK is never logged in, so every call from the app waited twelve
 * seconds and then failed with "Calling service is reconnecting" — the phone
 * could ring but never dial. The facade reflects the engine actually in use.
 */
export async function waitForVoiceConnection(
  timeoutMs = 12_000,
  probe: { state: () => VoiceConnectionState; engine: () => string | null; refresh: () => Promise<void>; sleep?: (ms: number) => Promise<void> } = {
    state: () => voice.currentConnectionState,
    engine: () => voice.currentEngine,
    refresh: refreshVocivoSip,
  },
) {
  const sleep = probe.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (probe.state() === ConnectionState.CONNECTED) return;
  // A phone that just came to the front may still be on a dead socket; ask the
  // SIP edge for its registration back rather than waiting for the timer.
  if (probe.engine() === 'sip') await probe.refresh().catch(() => undefined);
  const deadline = Date.now() + timeoutMs;
  while (probe.state() !== ConnectionState.CONNECTED && Date.now() < deadline) {
    await sleep(100);
  }
  if (probe.state() !== ConnectionState.CONNECTED) {
    throw new Error('Calling service is reconnecting. Please try again in a moment.');
  }
}

export function outboundHeaders(
  destination: string,
  callerNumber: string | undefined,
  flow: 'outbound' | 'internal',
  routeId: string,
  routeToken: string,
  remoteIdentity?: { name?: string; extension?: string },
) {
  return [
    { name: 'X-Vocivo-Flow', value: flow },
    { name: 'X-Vocivo-Destination', value: destination },
    { name: 'X-Vocivo-Route-ID', value: routeId },
    { name: 'X-Vocivo-Route-Token', value: routeToken },
    ...(callerNumber ? [{ name: 'X-Vocivo-Caller-ID', value: callerNumber }] : []),
    ...(remoteIdentity?.name ? [{ name: 'X-Vocivo-Destination-Name', value: remoteIdentity.name }] : []),
    ...(remoteIdentity?.extension ? [{ name: 'X-Vocivo-Destination-Extension', value: remoteIdentity.extension }] : []),
  ];
}
