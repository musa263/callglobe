import type { PbxConfig } from '../organizations/pbx-config-store.js';
import { sipDomain, voiceEdge } from './voice-provider.js';

const sipUri = /^sip:([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)(?::\d{1,5})?$/i;
const carrierSipAddress = /^(?:sip:)?([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)(?:;[^<>\s]+)?$/i;
const telnyxSipHost = 'sip.telnyx.com';

/**
 * Where an extension's phone is registered, and so where a call for it must be
 * sent: Vocivo's own edge once VOCIVO_VOICE_EDGE=sip, the carrier's credential
 * service before that. Dialling the carrier's host for a phone registered on
 * the edge rang nobody — that is what the Call Control fallback did for the
 * first hour of the cut-over.
 */
export function extensionSipHost() {
  return voiceEdge() === 'sip' ? sipDomain().toLowerCase() : telnyxSipHost;
}

function isExtensionSipHost(host: string) {
  const value = host.trim().toLowerCase();
  return value === telnyxSipHost || value === extensionSipHost();
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
  if (!username || !host || !isExtensionSipHost(host)) return null;
  return username;
}

export function isAllowedInternalSipDestination(destination: string) {
  return Boolean(parseInternalSipUser(destination));
}

export function extensionSipUri(sipUsername: string) {
  return `sip:${sipUsername}@${extensionSipHost()}`;
}

export function destinationSipUrisForInternalDial(
  destinationUsernames: string[],
  sourceUsernames: string[],
  fallbackDestination: string,
) {
  const blocked = new Set(sourceUsernames.map((username) => extensionSipUri(username)));
  const destinations = [...new Set(destinationUsernames.map(extensionSipUri).filter((uri) => !blocked.has(uri)))];
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
  return extensionSipUri(sipUsername);
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
