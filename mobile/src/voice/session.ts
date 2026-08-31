import { TelnyxConnectionState } from '@telnyx/react-voice-commons-sdk';
import { getVoicePushToken, voipClient } from '../lib/voipClient';
import { sipUserAgentReady } from '../lib/sipJsClient';
import type { VoiceLoginConfig, VoiceTokenResponse } from './contracts';

export function voiceLoginConfig(response: VoiceTokenResponse, ringtone: string): VoiceLoginConfig {
  if (!response.token?.trim()) throw new Error('A calling session token was not returned.');
  const requestedLifetime = Number(response.expires_in || 3600);
  const lifetimeSeconds = Number.isFinite(requestedLifetime) ? Math.max(60, requestedLifetime) : 3600;
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

export async function waitForVoiceConnection(timeoutMs = 12_000) {
  if (sipUserAgentReady()) return;
  const deadline = Date.now() + timeoutMs;
  while (voipClient.currentConnectionState !== TelnyxConnectionState.CONNECTED && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (sipUserAgentReady()) return;
  if (voipClient.currentConnectionState !== TelnyxConnectionState.CONNECTED) {
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
