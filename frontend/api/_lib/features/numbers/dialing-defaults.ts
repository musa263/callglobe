import { parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { pbxForOrganization, type PbxConfig } from '../organizations/pbx-config-store.js';
import type { CarrierTrunk } from './carrier-trunk-store.js';

export function validateOutgoingLine(config: PbxConfig, organizationId: string, number: unknown) {
  if (number === '' || number === undefined || number === null) return;
  const assignment = typeof number === 'string' ? config.numberAssignments[number] : undefined;
  if (!assignment || assignment.organizationId !== organizationId || assignment.disabled
    || pbxForOrganization(config, organizationId).company.callingMode === 'carrier' && assignment.source !== 'carrier') {
    throw new Error('Outgoing user line must be an enabled number assigned to this company.');
  }
}

/** Only published tenant numbers can become a user's automatic outgoing line. */
export function dialingDefaults(config: PbxConfig, organizationId: string, extensionId?: string, trunks: CarrierTrunk[] = []) {
  const tenant = pbxForOrganization(config, organizationId);
  const business = config.organizations.find(item => item.id === organizationId)?.accountType === 'business';
  const requested = (extensionId && tenant.userProfiles[extensionId]?.outboundCallerId) || tenant.company.defaultCallerId
    || (!business ? Object.keys(config.numberAssignments).find(number => config.numberAssignments[number].organizationId === organizationId && !config.numberAssignments[number].disabled) : '');
  const assignment = requested ? config.numberAssignments[requested] : undefined;
  if (!requested || !assignment || assignment.disabled || assignment.organizationId !== organizationId
    || tenant.company.callingMode === 'carrier' && assignment.source !== 'carrier') return { callerId: null, country: null };
  const trunk = trunks.find(item => item.organizationId === organizationId && item.id === assignment.carrierTrunkId && item.revision === assignment.carrierTrunkRevision);
  const mainNumber = trunk?.numbers.find(item => item.inboundNumber === trunk.mainNumber)?.callerId;
  return { callerId: requested, country: parsePhoneNumberFromString(mainNumber || requested)?.country || null };
}
