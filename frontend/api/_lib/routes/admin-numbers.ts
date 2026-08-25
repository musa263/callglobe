import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { telnyx } from '../telnyx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { assignNumberToOrganization, removeNumberAssignment } from '../tenancy.js';
import { getExtension } from '../pbx.js';
import { requireFeature } from '../saas-access.js';

function text(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

type AvailableNumber = {
  phone_number: string;
  phone_number_type?: string;
  locality?: string;
  region_information?: Array<{ region_type?: string; region_name?: string }>;
  cost_information?: { upfront_cost?: string; monthly_cost?: string; currency?: string };
  features?: Array<{ name?: string }>;
  reservable?: boolean;
  best_effort?: boolean;
  quickship?: boolean;
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE']);
  try {
    const access = await requireAdmin(req);
    const config = await readPbxConfig();
    const subscriptionAccess = await requireFeature(access.session, 'phoneNumbers', config);
    const activeOrganizationId = access.organizationId || config.activeOrganizationId;
    if (req.method === 'GET' && req.query.mode === 'search') {
      const country = text(req.query.country, 2).toUpperCase();
      if (!/^[A-Z]{2}$/.test(country)) return res.status(400).json({ error: 'Choose a two-letter country code.' });
      const query = new URLSearchParams({ 'filter[country_code]': country, 'page[size]': '30' });
      const areaCode = text(req.query.areaCode, 8).replace(/\D/g, '');
      const locality = text(req.query.locality, 80);
      const type = text(req.query.type, 30);
      const features = text(req.query.features, 50);
      if (areaCode) query.set('filter[national_destination_code]', areaCode);
      if (locality) query.set('filter[locality]', locality);
      if (['local', 'toll-free', 'mobile', 'national', 'shared-cost'].includes(type)) query.set('filter[phone_number_type]', type);
      if (features) query.set('filter[features]', features);
      const response = await telnyx(`/available_phone_numbers?${query}`);
      const payload = await response.json() as { data?: AvailableNumber[]; meta?: Record<string, unknown> };
      return res.status(200).json({
        numbers: (payload.data ?? []).map((item) => ({
          phoneNumber: item.phone_number,
          type: item.phone_number_type || type || 'local',
          locality: item.locality || item.region_information?.find((region) => region.region_type === 'locality')?.region_name || '',
          upfrontCost: item.cost_information?.upfront_cost || '0.00',
          monthlyCost: item.cost_information?.monthly_cost || '0.00',
          currency: item.cost_information?.currency || 'USD',
          features: (item.features ?? []).map((feature) => feature.name).filter(Boolean),
          quickship: Boolean(item.quickship),
        })),
        meta: payload.meta ?? {},
      });
    }
    if (req.method === 'GET') {
      const [numbersResponse, ordersResponse, profilesResponse] = await Promise.all([
        telnyx('/phone_numbers?page[size]=250&filter[status]=active'),
        telnyx('/number_orders?page[size]=20'),
        telnyx('/messaging_profiles?page[size]=250'),
      ]);
      const numbersPayload = await numbersResponse.json() as { data?: Array<Record<string, any>> };
      const ordersPayload = await ordersResponse.json() as { data?: Array<Record<string, any>> };
      const profilesPayload = await profilesResponse.json() as { data?: Array<Record<string, any>> };
      const visibleNumbers = (numbersPayload.data ?? []).filter((item) => config.numberAssignments[item.phone_number]?.organizationId === activeOrganizationId);
      const visibleMessagingProfiles = new Set(visibleNumbers.map((item) => item.messaging_profile_id).filter(Boolean));
      const orderPrefix = `Vocivo ${activeOrganizationId} `;
      return res.status(200).json({
        numbers: visibleNumbers.map((item) => ({ id: item.id, phoneNumber: item.phone_number, status: item.status, country: item.country_iso_alpha2, connectionId: item.connection_id, connectionName: item.connection_name, messagingProfileId: item.messaging_profile_id, tags: item.tags || [], purchasedAt: item.purchased_at, assignment: config.numberAssignments[item.phone_number] || { organizationId: activeOrganizationId, destinationType: 'main' } })),
        orders: (ordersPayload.data ?? []).filter((item) => String(item.customer_reference || '').startsWith(orderPrefix)).map((item) => ({ id: item.id, status: item.status || (item.requirements_met ? 'complete' : 'requirements pending'), count: item.phone_numbers_count, createdAt: item.created_at, customerReference: item.customer_reference, requirementsMet: item.requirements_met })),
        messagingProfiles: (profilesPayload.data ?? []).filter((item) => visibleMessagingProfiles.has(item.id)).map((item) => ({ id: item.id, name: item.name || item.id, webhookUrl: item.webhook_url || '', webhookFailoverUrl: item.webhook_failover_url || '' })),
      });
    }
    if (req.method === 'POST') {
      if (req.body?.confirmPurchase !== true) return res.status(400).json({ error: 'Explicit purchase confirmation is required.' });
      const phoneNumbers = Array.isArray(req.body?.phoneNumbers) ? req.body.phoneNumbers.map((value: unknown) => text(value, 24)).filter((value: string) => /^\+[1-9]\d{6,14}$/.test(value)).slice(0, 10) : [];
      if (!phoneNumbers.length) return res.status(400).json({ error: 'Choose at least one valid phone number.' });
      if (subscriptionAccess.superadmin === false) {
        const assigned = Object.values(config.numberAssignments).filter((assignment) => assignment.organizationId === activeOrganizationId).length;
        if (assigned + phoneNumbers.length > subscriptionAccess.plan.limits.phoneNumbers) return res.status(409).json({ error: `Your ${subscriptionAccess.plan.name} plan includes ${subscriptionAccess.plan.limits.phoneNumbers} phone numbers.` });
      }
      const response = await telnyx('/number_orders', {
        method: 'POST',
        body: JSON.stringify({
          phone_numbers: phoneNumbers.map((phone_number: string) => ({ phone_number })),
          connection_id: access.superadmin ? text(req.body?.connectionId, 80) || requiredEnv('TELNYX_CALL_CONTROL_APP_ID') : requiredEnv('TELNYX_CALL_CONTROL_APP_ID'),
          customer_reference: access.superadmin ? text(req.body?.customerReference, 100) || `Vocivo ${activeOrganizationId} ${new Date().toISOString()}` : `Vocivo ${activeOrganizationId} ${new Date().toISOString()}`,
        }),
      });
      const payload = await response.json() as { data?: Record<string, unknown> };
      await Promise.all(phoneNumbers.map((phoneNumber: string) => assignNumberToOrganization(phoneNumber, activeOrganizationId, { destinationType: 'main' })));
      return res.status(201).json({ order: payload.data });
    }
    if (req.method === 'DELETE') {
      if (req.body?.confirmRelease !== true) return res.status(400).json({ error: 'Explicit number release confirmation is required.' });
      const id = text(req.body?.id, 80);
      const phoneNumber = text(req.body?.phoneNumber, 24);
      if (!id || !/^\+[1-9]\d{6,14}$/.test(phoneNumber)) return res.status(400).json({ error: 'Phone number ID and E.164 number are required.' });
      if (id === requiredEnv('TELNYX_PHONE_NUMBER_ID')) return res.status(409).json({ error: 'This is the primary Vocivo service number. Assign a replacement before releasing it.' });
      if (config.numberAssignments[phoneNumber]?.organizationId !== activeOrganizationId) return res.status(404).json({ error: 'Phone number not found in the selected customer workspace.' });
      const currentResponse = await telnyx(`/phone_numbers/${encodeURIComponent(id)}`);
      const currentPayload = await currentResponse.json() as { data?: { phone_number?: string; deletion_lock_enabled?: boolean } };
      if (currentPayload.data?.phone_number !== phoneNumber) return res.status(409).json({ error: 'The number no longer matches this inventory record. Refresh and try again.' });
      if (currentPayload.data?.deletion_lock_enabled) return res.status(409).json({ error: 'Telnyx deletion lock is enabled for this number. Disable the lock before releasing it.' });
      const response = await telnyx(`/phone_numbers/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const payload = response.status === 204 ? {} : await response.json() as { data?: Record<string, unknown> };
      await removeNumberAssignment(phoneNumber);
      return res.status(200).json({ number: payload.data, released: true });
    }
    const id = text(req.body?.id, 80);
    if (!id) return res.status(400).json({ error: 'Phone number ID is required.' });
    const ownedResponse = await telnyx(`/phone_numbers/${encodeURIComponent(id)}`);
    const owned = await ownedResponse.json() as { data?: { phone_number?: string } };
    const ownedNumber = text(owned.data?.phone_number, 24);
    if (!ownedNumber || config.numberAssignments[ownedNumber]?.organizationId !== activeOrganizationId) return res.status(404).json({ error: 'Phone number not found in the selected customer workspace.' });
    const body: Record<string, unknown> = {};
    if (req.body?.assignToVocivo === true) body.connection_id = requiredEnv('TELNYX_CALL_CONTROL_APP_ID');
    else if (req.body?.connectionId !== undefined) body.connection_id = text(req.body.connectionId, 80) || null;
    if (req.body?.messagingProfileId !== undefined) body.messaging_profile_id = text(req.body.messagingProfileId, 80) || null;
    if (Array.isArray(req.body?.tags)) body.tags = req.body.tags.map((item: unknown) => text(item, 50)).filter(Boolean).slice(0, 20);
    const requestedOrganizationId = text(req.body?.organizationId, 50);
    const organizationId = access.superadmin ? requestedOrganizationId || activeOrganizationId : activeOrganizationId;
    if (organizationId && !config.organizations.some((item) => item.id === organizationId && item.status === 'active')) return res.status(400).json({ error: 'Choose an active organization.' });
    const destinationType = ['main', 'extension', 'ring_group', 'queue', 'ivr'].includes(req.body?.destinationType) ? req.body.destinationType as 'main' | 'extension' | 'ring_group' | 'queue' | 'ivr' : 'main';
    const destinationId = text(req.body?.destinationId, 80);
    if (organizationId && destinationType !== 'main' && !destinationId) return res.status(400).json({ error: 'Choose an inbound destination.' });
    if (organizationId && destinationType === 'extension') {
      const extension = await getExtension(destinationId).catch(() => null);
      if (!extension || extension.status !== 'active' || extension.organizationId !== organizationId) return res.status(400).json({ error: 'Choose an active extension in this organization.' });
    }
    if (organizationId && ['ring_group', 'queue', 'ivr'].includes(destinationType)) {
      const organizationPbx = pbxForOrganization(config, organizationId);
      const collection = destinationType === 'ring_group' ? organizationPbx.callHandling.ringGroups : destinationType === 'queue' ? organizationPbx.callHandling.queues : organizationPbx.callHandling.ivrs;
      if (!collection.some((item) => item.id === destinationId)) return res.status(400).json({ error: 'Choose a configured inbound destination.' });
    }
    const response = await telnyx(`/phone_numbers/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
    const payload = await response.json() as { data?: Record<string, unknown> };
    const phoneNumber = text((payload.data as { phone_number?: unknown } | undefined)?.phone_number, 24);
    if (phoneNumber && organizationId) {
      await assignNumberToOrganization(phoneNumber, organizationId, { destinationType, destinationId: destinationId || undefined });
    }
    return res.status(200).json({ number: payload.data });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'Phone-number management is not enabled for this company.' });
    if (error instanceof Error && error.message === 'Forbidden') return res.status(403).json({ error: 'Owner access is required.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
