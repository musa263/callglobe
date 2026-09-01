import { createHmac } from 'node:crypto';
import type { PbxConfig } from './pbx-config-store.js';

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

/** SIP-edge internal calls must never park or Dial on Telnyx Call Control. */
export function internalCallsUseTelnyxPark(edge: VoiceEdge = voiceEdge()) {
  return edge !== 'sip';
}

const PUBLIC_SIP_STUN: VoiceIceServer = { urls: 'stun:stun.l.google.com:19302' };

/** SIP clients use RTPEngine plus optional self-hosted TURN (never Telnyx TURN). */
export function sipIceServers(subject = 'voice-session'): VoiceIceServer[] {
  const servers: VoiceIceServer[] = [];
  const stun = iceUrlList(trimmedEnv('VOCIVO_STUN_URLS'));
  if (stun.length) servers.push(...stun.map((urls) => ({ urls })));
  else servers.push(PUBLIC_SIP_STUN);

  const staticTurn = trimmedEnv('VOCIVO_TURN_URI');
  const staticUser = trimmedEnv('VOCIVO_TURN_USERNAME');
  const staticCredential = trimmedEnv('VOCIVO_TURN_CREDENTIAL');
  if (staticTurn && staticUser && staticCredential && validIceUrl(staticTurn)) {
    servers.push({ urls: staticTurn, username: staticUser, credential: staticCredential });
  }

  const secret = trimmedEnv('VOCIVO_TURN_SECRET');
  const turnUrls = iceUrlList(trimmedEnv('VOCIVO_TURN_URLS'));
  if (secret && turnUrls.length) {
    const ttl = Number.parseInt(trimmedEnv('VOCIVO_TURN_TTL_SECONDS') || '3600', 10);
    const expires = Math.floor(Date.now() / 1000) + (Number.isSafeInteger(ttl) && ttl > 0 ? ttl : 3600);
    const username = `${expires}:${subject.slice(0, 80)}`;
    const credential = createHmac('sha1', secret).update(username).digest('base64');
    turnUrls.forEach((urls) => servers.push({ urls, username, credential }));
  }
  return servers;
}

function iceUrlList(value: string) {
  return value.split(/[\s,]+/).map((item) => item.trim()).filter(validIceUrl);
}

export function clientIceServers(edge: VoiceEdge = voiceEdge(), subject = 'voice-session'): VoiceIceServer[] {
  return edge === 'sip' ? sipIceServers() : voiceIceServers(subject);
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
  const explicit = trimmedEnv('VOCIVO_SIP_WSS_URI');
  if (explicit) return explicit;
  const domain = sipDomain();
  return domain ? `wss://${domain}/ws` : '';
}

function validIceUrl(value: unknown): value is string {
  return typeof value === 'string' && /^(?:stun|turn|turns):[^\s]+$/i.test(value);
}

export function voiceIceServers(_subject = 'voice-session'): VoiceIceServer[] {
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
    const urls = Array.isArray(value.urls) ? value.urls.filter(validIceUrl) : validIceUrl(value.urls) ? value.urls : [];
    if (!urls.length) throw new Error('Every Telnyx ICE server requires a STUN, TURN, or TURNS URL.');
    const requiresCredential = (Array.isArray(urls) ? urls : [urls]).some((url) => /^turns?:/i.test(url));
    if (requiresCredential && (!value.username || !value.credential)) throw new Error('Telnyx TURN servers require a username and credential.');
    return { urls, ...(value.username ? { username: value.username } : {}), ...(value.credential ? { credential: value.credential } : {}) };
  });
}
