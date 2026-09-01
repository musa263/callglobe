import type { PbxConfig } from './pbx-config-store.js';
import { sipDomain, sipRealm, voiceEdge } from './voice-provider.js';

const sipUri = /^sip:([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)$/i;
const carrierSipAddress = /^(?:sip:)?([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)(?:;[^<>\s]+)?$/i;
const telnyxSipHost = 'sip.telnyx.com';

function isInternalSipHost(host: string | undefined) {
  const value = host?.trim().toLowerCase();
  if (!value) return false;
  const allowed = new Set([telnyxSipHost, sipDomain().toLowerCase(), sipRealm().toLowerCase(), 'sip.vocivo.app'].filter(Boolean));
  return allowed.has(value);
}

export function canonicalVoiceDestination(destination: string) {
  const value = destination.trim().replace(/^<|>$/g, '');
  const sip = value.match(carrierSipAddress);
  if (sip) return `sip:${sip[1]}@${sip[2].toLowerCase()}`;
  return value.replace(/[\s()-]/g, '');
}

export function voiceDestinationsMatch(left: string, right: string) {
  return Boolean(left && right && canonicalVoiceDestination(left) === canonicalVoiceDestination(right));
}

export function parseInternalSipUser(destination: string) {
  const match = destination.trim().match(sipUri);
  const username = match?.[1];
  const host = match?.[2];
  if (!username || !isInternalSipHost(host)) return null;
  return username;
}

export function isAllowedInternalSipDestination(destination: string) {
  return Boolean(parseInternalSipUser(destination));
}

export function extensionSipUri(sipUsername: string) {
  return `sip:${sipUsername}@${telnyxSipHost}`;
}

/** Destination clients INVITE, and Call Control Dial uses, for the active voice edge. */
export function clientExtensionSipUri(sipUsername: string) {
  const host = voiceEdge() === 'sip' ? (sipDomain() || 'sip.vocivo.app') : telnyxSipHost;
  return `sip:${sipUsername}@${host}`;
}

export function destinationSipUrisForInternalDial(
  destinationUsernames: string[],
  sourceUsernames: string[],
  fallbackDestination: string,
) {
  const blocked = new Set(sourceUsernames.map((username) => clientExtensionSipUri(username)));
  const destinations = [...new Set(destinationUsernames.map(clientExtensionSipUri).filter((uri) => !blocked.has(uri)))];
  if (destinations.length) return destinations;
  const fallback = isAllowedInternalSipDestination(fallbackDestination) ? canonicalVoiceDestination(fallbackDestination) : '';
  return fallback && !blocked.has(fallback) ? [fallback] : [];
}

type ExtensionSipIdentity = {
  organizationId: string;
  extension: string;
  sipUsername: string;
  status: string;
};

export function extensionSipUsernames(
  target: ExtensionSipIdentity,
  candidates: ExtensionSipIdentity[],
) {
  return [...new Set([target, ...candidates]
    .filter((candidate) => candidate.organizationId === target.organizationId
      && candidate.extension === target.extension
      && candidate.status === 'active'
      && candidate.sipUsername)
    .map((candidate) => candidate.sipUsername.trim())
    .filter(Boolean))];
}

export function organizationExtensionSipUri(_config: PbxConfig, _organizationId: string, sipUsername: string) {
  return clientExtensionSipUri(sipUsername);
}

export function activeOrganizationExtensionTargets(
  config: PbxConfig,
  organizationId: string,
  extensions: Array<{ id: string; organizationId: string; status: string; sipUsername: string }>,
) {
  const organization = config.organizations.find((item) => item.id === organizationId && item.status === 'active');
  if (!organization || organization.accountType !== 'business') return [];
  return extensions
    .filter((extension) => extension.organizationId === organizationId && extension.status === 'active' && extension.sipUsername)
    .map((extension) => ({
      extensionId: extension.id,
      destination: organizationExtensionSipUri(config, organizationId, extension.sipUsername),
    }));
}
