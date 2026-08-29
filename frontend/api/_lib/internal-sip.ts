import { organizationSipDomain, voiceProvider, type VoiceProvider } from './voice-provider.js';
import type { PbxConfig } from './pbx-config-store.js';

const sipUri = /^sip:([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)$/i;

function allowedInternalSipHost(host: string, organizationSipHost?: string) {
  const normalized = host.trim().toLowerCase();
  if (normalized === 'sip.telnyx.com') return true;
  return Boolean(organizationSipHost && normalized === organizationSipHost.trim().toLowerCase());
}

export function parseInternalSipUser(destination: string, organizationSipHost?: string) {
  const match = destination.trim().match(sipUri);
  const username = match?.[1];
  const host = match?.[2];
  if (!username || !host || !allowedInternalSipHost(host, organizationSipHost)) return null;
  return username;
}

export function isAllowedInternalSipDestination(destination: string, organizationSipHost?: string) {
  return Boolean(parseInternalSipUser(destination, organizationSipHost));
}

export function extensionSipUri(sipUsername: string, sipDomain = 'sip.telnyx.com') {
  return `sip:${sipUsername}@${sipDomain}`;
}

export function organizationExtensionSipUri(config: PbxConfig, organizationId: string, sipUsername: string, provider: VoiceProvider = voiceProvider(config)) {
  const sipDomain = provider === 'freeswitch' ? organizationSipDomain(config, organizationId) : 'sip.telnyx.com';
  return extensionSipUri(sipUsername, sipDomain);
}
