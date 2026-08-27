import type { PbxConfig } from './pbx-config-store.js';

export type VoiceProvider = 'telnyx' | 'freeswitch';

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
