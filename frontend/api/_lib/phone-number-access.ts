import type { VocivoSession } from './auth.js';
import { readPbxConfig, type PbxConfig } from './pbx-config-store.js';
import { telnyx } from './telnyx.js';
import { normalizeE164, sessionCanAccessNumber, sessionOrganizationId } from './tenancy.js';

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

export function callerIdBelongsToOrganization(phoneNumber: string, organizationId: string, assignments: Record<string, { organizationId: string }>) {
  const normalized = normalizeE164(phoneNumber);
  return Boolean(normalized && assignments[normalized]?.organizationId === organizationId);
}

export function assignedNumbersForOrganization(config: PbxConfig, organizationId: string) {
  return Object.entries(config.numberAssignments)
    .filter(([, assignment]) => assignment.organizationId === organizationId)
    .map(([phoneNumber, assignment]) => {
      const source = assignment.source || (assignment.destinationType ? 'owned' : 'verified');
      return {
        id: `assigned:${phoneNumber}`,
        phone_number: phoneNumber,
        label: assignment.label || (source === 'verified' ? 'Verified caller ID' : 'Vocivo number'),
        country_code: null,
        status: 'active',
        receives_calls: source === 'owned' && Boolean(assignment.destinationType),
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

export async function assertCallerIdForOrganization(phoneNumber: string, organizationId: string) {
  const normalized = normalizeE164(phoneNumber);
  const config = await readPbxConfig();
  if (!callerIdBelongsToOrganization(normalized, organizationId, config.numberAssignments)) throw new Error('Caller ID is not assigned to this organization.');
  return normalized;
}

export async function assertCallerIdForSession(session: VocivoSession, phoneNumber: string) {
  const config = await readPbxConfig();
  const normalized = normalizeE164(phoneNumber);
  if (!sessionCanAccessNumber(session, normalized, config)) throw new Error('Caller ID is not assigned to your organization.');
  const organizationId = sessionOrganizationId(session, config);
  return assertCallerIdForOrganization(normalized, organizationId);
}
