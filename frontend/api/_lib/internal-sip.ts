import type { PbxConfig } from './pbx-config-store.js';

const sipUri = /^sip:([A-Za-z0-9_.-]+)@([A-Za-z0-9.-]+)$/i;
const telnyxSipHost = 'sip.telnyx.com';

export function parseInternalSipUser(destination: string) {
  const match = destination.trim().match(sipUri);
  const username = match?.[1];
  const host = match?.[2];
  if (!username || host?.trim().toLowerCase() !== telnyxSipHost) return null;
  return username;
}

export function isAllowedInternalSipDestination(destination: string) {
  return Boolean(parseInternalSipUser(destination));
}

export function extensionSipUri(sipUsername: string) {
  return `sip:${sipUsername}@${telnyxSipHost}`;
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
