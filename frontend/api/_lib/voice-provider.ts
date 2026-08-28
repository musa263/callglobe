import { createHash, createHmac } from 'node:crypto';
import type { PbxConfig } from './pbx-config-store.js';

export type VoiceProvider = 'telnyx' | 'freeswitch';

export type VoiceIceServer = {
  urls: string | string[];
  username?: string;
  credential?: string;
};

function trimmedEnv(name: string) {
  return process.env[name]?.trim() || '';
}

export function voiceProvider(config: PbxConfig): VoiceProvider {
  const configured = trimmedEnv('VOCIVO_PBX_ENGINE').toLowerCase();
  if (configured === 'freeswitch' || configured === 'telnyx') return configured;
  return config.platform.pbxEngine === 'freeswitch' ? 'freeswitch' : 'telnyx';
}

export function baseSipDomain(config: PbxConfig) {
  return trimmedEnv('VOCIVO_SIP_DOMAIN') || config.platform.sipDomain;
}

export function organizationSipDomain(config: PbxConfig, organizationId: string) {
  const organization = config.organizations.find((item) => item.id === organizationId);
  if (!organization) throw new Error('Organization not found.');
  const base = baseSipDomain(config);
  return organization.accountType === 'business' ? `${organization.slug}.${base}` : `personal-${organization.slug}.${base}`;
}

export function sipWebSocketUrl(config: PbxConfig) {
  const configured = trimmedEnv('VOCIVO_SIP_WSS_URL');
  if (configured) {
    const url = new URL(configured);
    if (url.protocol !== 'wss:') throw new Error('VOCIVO_SIP_WSS_URL must use wss://.');
    return url.toString();
  }
  return `wss://${baseSipDomain(config)}`;
}

function iceUrls(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export function voiceIceServers(subject = 'voice-session'): VoiceIceServer[] {
  const stunUrls = iceUrls(trimmedEnv('VOCIVO_STUN_URLS') || 'stun:stun.cloudflare.com:3478');
  const turnUrls = iceUrls(trimmedEnv('VOCIVO_TURN_URLS'));
  const turnSecret = trimmedEnv('VOCIVO_TURN_SECRET');
  const servers: VoiceIceServer[] = [];
  if (stunUrls.length) servers.push({ urls: stunUrls.length === 1 ? stunUrls[0] : stunUrls });
  if (turnUrls.length && turnSecret) {
    if (turnSecret.length < 32) throw new Error('VOCIVO_TURN_SECRET must contain at least 32 characters.');
    const requestedTtl = Number(trimmedEnv('VOCIVO_TURN_TTL_SECONDS') || 600);
    const ttl = Number.isFinite(requestedTtl) ? Math.min(3600, Math.max(60, Math.floor(requestedTtl))) : 600;
    const expiresAt = Math.floor(Date.now() / 1000) + ttl;
    const opaqueSubject = createHash('sha256').update(subject).digest('hex').slice(0, 24);
    const username = `${expiresAt}:${opaqueSubject}`;
    const credential = createHmac('sha1', turnSecret).update(username).digest('base64');
    servers.push({ urls: turnUrls.length === 1 ? turnUrls[0] : turnUrls, username, credential });
  }
  return servers;
}
