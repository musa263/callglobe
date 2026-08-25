import type { VocivoSession } from './auth.js';
import { readPbxConfig } from './pbx-config-store.js';
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

export async function listOwnedNumbers() {
  const response = await telnyx('/phone_numbers?page[size]=250&filter[status]=active');
  const payload = await response.json() as { data?: AccountPhoneNumber[] };
  return payload.data ?? [];
}

export async function listVerifiedNumbers() {
  const response = await telnyx('/verified_numbers?page[size]=250');
  const payload = await response.json() as { data?: Array<{ phone_number: string; verified_at?: string }> };
  return payload.data ?? [];
}

export async function assertCallerIdForOrganization(phoneNumber: string, organizationId: string) {
  const normalized = normalizeE164(phoneNumber);
  const config = await readPbxConfig();
  const assignedOrganization = config.numberAssignments[normalized]?.organizationId || config.organizations[0]?.id || 'primary';
  if (assignedOrganization !== organizationId) throw new Error('Caller ID is not assigned to this organization.');
  const [owned, verified] = await Promise.all([listOwnedNumbers(), listVerifiedNumbers()]);
  if (!owned.some((item) => normalizeE164(item.phone_number) === normalized) && !verified.some((item) => normalizeE164(item.phone_number) === normalized)) {
    throw new Error('Caller ID is not owned or verified on this account.');
  }
  return normalized;
}

export async function assertCallerIdForSession(session: VocivoSession, phoneNumber: string) {
  const config = await readPbxConfig();
  const normalized = normalizeE164(phoneNumber);
  if (!sessionCanAccessNumber(session, normalized, config)) throw new Error('Caller ID is not assigned to your organization.');
  const organizationId = sessionOrganizationId(session, config);
  return assertCallerIdForOrganization(normalized, organizationId);
}
