import type { PbxConfig } from '../organizations/pbx-config-store.js';
import { createHash, createHmac } from 'node:crypto';

export type VoiceEdge = 'telnyx' | 'sip';

export type VoiceIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

function trimmedEnv(name: string) {
  return process.env[name]?.trim() || '';
}

export function voiceEdge(_config?: PbxConfig): VoiceEdge {
  return trimmedEnv('VOCIVO_VOICE_EDGE') === 'sip' ? 'sip' : 'telnyx';
}

/** Internal SIP-edge calls stay on Kamailio/FreeSWITCH and must not wait on Telnyx /balance. */
export function voiceRouteNeedsTelnyxCredit(flow: 'internal' | 'outbound', edge: VoiceEdge = voiceEdge()) {
  return !(edge === 'sip' && flow === 'internal');
}

/** @deprecated use voiceEdge */
export function voiceProvider(config?: PbxConfig) {
  return voiceEdge(config);
}

export function sipInboundEnabled() {
  return trimmedEnv('VOCIVO_SIP_INBOUND') === '1';
}

export function sipRealm() {
  return trimmedEnv('VOCIVO_SIP_REALM') || trimmedEnv('VOCIVO_SIP_DOMAIN') || 'sip.vocivo.local';
}

export function sipDomain() {
  return trimmedEnv('VOCIVO_SIP_DOMAIN') || sipRealm();
}

export function sipWsUri() {
  return trimmedEnv('VOCIVO_SIP_WSS_URI');
}

function validIceUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(?:stun|turn|turns):[^\s]+$/i.test(value);
}

export function voiceIceServers(subject = 'voice-session'): VoiceIceServer[] {
  if (voiceEdge() === 'sip') {
    if (!trimmedEnv('VOCIVO_TURN_URLS')) throw new Error('VOCIVO_TURN_URLS is required for SIP media relay.');
    const urls = trimmedEnv('VOCIVO_TURN_URLS').split(',').map((url) => url.trim());
    if (urls.some((url) => !/^turns?:[^\s,]+$/i.test(url))) throw new Error('VOCIVO_TURN_URLS requires comma-separated TURN or TURNS URLs.');
    const secret = trimmedEnv('VOCIVO_TURN_SECRET');
    if (secret.length < 32) throw new Error('VOCIVO_TURN_SECRET must match the secure coturn authentication secret.');
    // Coturn REST authentication: the expiry prefix is verified by the relay.
    // Hash the subject so tenant and employee identifiers do not enter relay logs.
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${createHash('sha256').update(subject).digest('hex').slice(0, 24)}`;
    return [{ urls, username, credential: createHmac('sha1', secret).update(username).digest('base64') }];
  }
  const configured = trimmedEnv('TELNYX_ICE_SERVERS_JSON');
  if (!configured) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(configured);
  } catch {
    throw new Error('TELNYX_ICE_SERVERS_JSON must contain valid JSON.');
  }
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('TELNYX_ICE_SERVERS_JSON must contain at least one ICE server.');
  return parsed.map((candidate) => {
    if (!candidate || typeof candidate !== 'object') throw new Error('TELNYX_ICE_SERVERS_JSON contains an invalid ICE server.');
    const value = candidate as VoiceIceServer;
    if (Array.isArray(value.urls) && value.urls.some((url) => !validIceUrl(url))) throw new Error('Every Telnyx ICE URL must use STUN, TURN, or TURNS.');
    const urls = Array.isArray(value.urls) ? value.urls : validIceUrl(value.urls) ? value.urls : [];
    if (!urls.length) throw new Error('Every Telnyx ICE server requires a STUN, TURN, or TURNS URL.');
    const requiresCredential = (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
    if (requiresCredential && (!value.username || !value.credential)) throw new Error('Telnyx TURN servers require a username and credential.');
    return { urls, ...(value.username ? { username: value.username } : {}), ...(value.credential ? { credential: value.credential } : {}) };
  });
}
