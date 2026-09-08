import type { VocivoSession } from '../auth/auth.js';
import { pbxForOrganization, readPbxConfig, type PbxConfig } from '../organizations/pbx-config-store.js';
import { telnyx } from '../../shared/telnyx.js';
import { normalizeE164, sessionCanAccessNumber, sessionOrganizationId } from '../organizations/tenancy.js';
import { CarrierTrunkError, type CarrierTrunk } from './carrier-trunk-store.js';
import { carrierReadiness, resolveCarrierOutbound } from './carrier-runtime.js';
import { dialingDefaults } from './dialing-defaults.js';

export type AccountPhoneNumber = {
  id: string;
  phone_number: string;
  country_iso_alpha2?: string;
  status?: string;
  connection_id?: string | null;
  connection_name?: string | null;
  messaging_profile_id?: string | null;
  tags?: string[];
};

let ownedCache: { expiresAt: number; value: AccountPhoneNumber[] } | null = null;
let ownedRequest: Promise<AccountPhoneNumber[]> | null = null;
let verifiedCache: { expiresAt: number; value: Array<{ phone_number: string; verified_at?: string }> } | null = null;
let verifiedRequest: Promise<Array<{ phone_number: string; verified_at?: string }>> | null = null;

export function invalidatePhoneNumberCache(type: 'owned' | 'verified' | 'all' = 'all') {
  if (type !== 'verified') ownedCache = null;
  if (type !== 'owned') verifiedCache = null;
}

export function callerIdBelongsToOrganization(phoneNumber: string, organizationId: string, assignments: Record<string, { organizationId: string; disabled?: boolean }>) {
  const normalized = normalizeE164(phoneNumber);
  return Boolean(normalized && assignments[normalized]?.organizationId === organizationId && !assignments[normalized]?.disabled);
}

export function assignedNumbersForOrganization(config: PbxConfig, organizationId: string, trunks: CarrierTrunk[] = []) {
  const ownCarrier = pbxForOrganization(config, organizationId).company.callingMode === 'carrier';
  return Object.entries(config.numberAssignments)
    .filter(([, assignment]) => assignment.organizationId === organizationId && !assignment.disabled && (!ownCarrier || assignment.source === 'carrier'))
    .map(([phoneNumber, assignment]) => {
      const source = assignment.source || (assignment.destinationType ? 'owned' : 'verified');
      const trunk = trunks.find(item => item.organizationId === organizationId && item.id === assignment.carrierTrunkId && item.revision === assignment.carrierTrunkRevision);
      const ready = trunk && carrierReadiness(trunk).status === 'ready';
      return {
        id: `assigned:${phoneNumber}`,
        phone_number: phoneNumber,
        label: assignment.label || (source === 'verified' ? 'Verified caller ID' : 'Vocivo number'),
        country_code: null,
        status: source === 'carrier' ? ready ? 'ready' : 'pending_activation' : 'active',
        receives_calls: Boolean(assignment.destinationType) && (source === 'owned' || source === 'carrier' && Boolean(ready) && trunk?.inboundEnabled === true),
        messaging_enabled: source === 'owned' && assignment.messagingEnabled === true,
        source,
      };
    });
}

export async function listOwnedNumbers() {
  if (ownedCache?.expiresAt && ownedCache.expiresAt > Date.now()) return ownedCache.value;
  ownedRequest ||= (async () => {
    const response = await telnyx('/phone_numbers?page[size]=250&filter[status]=active');
    const payload = await response.json() as { data?: AccountPhoneNumber[] };
    const value = payload.data ?? [];
    ownedCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  })().finally(() => { ownedRequest = null; });
  return ownedRequest;
}

export async function listVerifiedNumbers() {
  if (verifiedCache?.expiresAt && verifiedCache.expiresAt > Date.now()) return verifiedCache.value;
  verifiedRequest ||= (async () => {
    const response = await telnyx('/verified_numbers?page[size]=250');
    const payload = await response.json() as { data?: Array<{ phone_number: string; verified_at?: string }> };
    const value = payload.data ?? [];
    verifiedCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  })().finally(() => { verifiedRequest = null; });
  return verifiedRequest;
}

export async function assertCallerIdForOrganization(phoneNumber: string, organizationId: string, options: { allowCarrier?: boolean } = {}) {
  const normalized = normalizeE164(phoneNumber);
  const config = await readPbxConfig();
  if (!callerIdBelongsToOrganization(normalized, organizationId, config.numberAssignments)) throw new Error('Caller ID is not assigned to this organization.');
  const assignment = config.numberAssignments[normalized];
  if (pbxForOrganization(config, organizationId).company.callingMode === 'carrier' && assignment.source !== 'carrier') {
    throw new CarrierTrunkError(409, 'Choose a number from your company SIP trunk.');
  }
  if (assignment.source === 'carrier') {
    if (!options.allowCarrier) throw new CarrierTrunkError(409, 'Use the Vocivo SIP calling app for company carrier numbers.');
    await resolveCarrierOutbound(config, organizationId, normalized);
  }
  return normalized;
}

export async function assertCallerIdForSession(session: VocivoSession, phoneNumber: string, options: { allowCarrier?: boolean } = {}) {
  const config = await readPbxConfig();
  const normalized = normalizeE164(phoneNumber);
  if (!sessionCanAccessNumber(session, normalized, config)) throw new Error('Caller ID is not assigned to your organization.');
  const organizationId = sessionOrganizationId(session, config);
  if (config.organizations.find(item => item.id === organizationId)?.accountType === 'business'
    && dialingDefaults(config, organizationId, session.extensionId).callerId !== normalized) throw new Error('Caller ID must match the line assigned by your administrator.');
  return assertCallerIdForOrganization(normalized, organizationId, options);
}
