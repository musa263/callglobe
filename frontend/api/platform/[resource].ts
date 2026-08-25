import type { VercelRequest, VercelResponse } from '@vercel/node';
import { authenticatePlatformKey, type PlatformScope } from '../_lib/platform-key-store.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../_lib/http.js';
import { findExtension, listExtensions } from '../_lib/pbx.js';
import { callAction, dialCall } from '../_lib/voice-control.js';
import { telnyx } from '../_lib/telnyx.js';

const e164 = /^\+[1-9]\d{6,14}$/;
function text(value: unknown, max: number) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

function scopeFor(resource: string, method: string): PlatformScope | null {
  if (resource === 'health') return 'calls:read';
  if (resource === 'extensions' && method === 'GET') return 'extensions:read';
  if (resource === 'calls' && method === 'GET') return 'calls:read';
  if (resource === 'calls' && ['POST', 'PATCH'].includes(method)) return 'calls:write';
  if (resource === 'numbers' && method === 'GET') return 'numbers:read';
  if (resource === 'numbers' && method === 'POST') return 'numbers:write';
  if (resource === 'events' && method === 'GET') return 'events:read';
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const resource = Array.isArray(req.query.resource) ? req.query.resource[0] : req.query.resource || '';
  const method = req.method || '';
  if (resource === 'health') {
    if (allowMobile(req, res)) return;
    if (method !== 'GET') return methodNotAllowed(res, ['GET']);
    return res.status(200).json({ ok: true, service: 'vocivo-api', status: 'operational', controlPlane: 'vocivo', mediaPlane: process.env.PBX_SERVICE_URL ? 'vocivo' : 'telnyx', pstnProvider: 'telnyx', time: new Date().toISOString() });
  }
  const scope = scopeFor(resource, method);
  if (!scope) return methodNotAllowed(res, ['GET', 'POST', 'PATCH']);
  try {
    const apiKey = await authenticatePlatformKey(req, scope);
    res.setHeader('Cache-Control', 'no-store');
    if (resource === 'extensions') return res.status(200).json({ data: await listExtensions(apiKey.organizationId) });
    if (resource === 'calls' && method === 'GET') {
      const response = await telnyx(`/connections/${requiredEnv('TELNYX_CALL_CONTROL_APP_ID')}/active_calls?page[size]=100`);
      const payload = await response.json();
      return res.status(200).json(payload);
    }
    if (resource === 'calls' && method === 'POST') {
      const requested = text(req.body?.to, 200);
      const internal = /^\d{2,5}$/.test(requested) ? await findExtension(requested, apiKey.organizationId) : null;
      const to = internal ? `sip:${internal.sipUsername}@sip.telnyx.com` : requested;
      if (!internal && !e164.test(to)) return res.status(400).json({ error: 'Destination must be an organization extension or E.164 number.' });
      const from = text(req.body?.from, 24);
      if (from && !e164.test(from)) return res.status(400).json({ error: 'Caller ID must use E.164 format.' });
      const result = await dialCall({ to, from: from || undefined, fromDisplayName: text(req.body?.displayName, 80) || 'Vocivo API', state: { flow: 'api_outbound' }, commandId: text(req.body?.commandId, 80) || crypto.randomUUID(), timeoutSeconds: Number(req.body?.timeoutSeconds) || 45 });
      return res.status(201).json({ data: { ...result.data, destination: requested, internal: Boolean(internal) } });
    }
    if (resource === 'calls' && method === 'PATCH') {
      const callControlId = text(req.body?.callControlId, 500);
      const action = text(req.body?.action, 30);
      const actions: Record<string, { endpoint: string; body: Record<string, unknown> }> = {
        hangup: { endpoint: 'hangup', body: {} },
        hold: { endpoint: 'hold', body: {} },
        resume: { endpoint: 'unhold', body: {} },
        mute: { endpoint: 'mute', body: {} },
        unmute: { endpoint: 'unmute', body: {} },
        transfer: { endpoint: 'transfer', body: { to: text(req.body?.to, 200) } },
        play: { endpoint: 'playback_start', body: { audio_url: text(req.body?.audioUrl, 500) } },
      };
      if (!callControlId || !actions[action]) return res.status(400).json({ error: 'Call control ID and supported action are required.' });
      await callAction(callControlId, actions[action].endpoint, { ...actions[action].body, command_id: text(req.body?.commandId, 80) || crypto.randomUUID() });
      return res.status(200).json({ data: { callControlId, action, accepted: true } });
    }
    if (resource === 'numbers' && method === 'GET') {
      const country = text(req.query.country, 2).toUpperCase();
      const path = country
        ? `/available_phone_numbers?filter[country_code]=${encodeURIComponent(country)}&page[size]=30`
        : '/phone_numbers?page[size]=250&filter[status]=active';
      const response = await telnyx(path);
      return res.status(200).json(await response.json());
    }
    if (resource === 'numbers' && method === 'POST') {
      if (req.body?.confirmPurchase !== true) return res.status(400).json({ error: 'Explicit purchase confirmation is required.' });
      const numbers = Array.isArray(req.body?.phoneNumbers) ? req.body.phoneNumbers.map((item: unknown) => text(item, 24)).filter((item: string) => e164.test(item)).slice(0, 10) : [];
      if (!numbers.length) return res.status(400).json({ error: 'At least one valid phone number is required.' });
      const response = await telnyx('/number_orders', { method: 'POST', body: JSON.stringify({ phone_numbers: numbers.map((phone_number: string) => ({ phone_number })), connection_id: requiredEnv('TELNYX_CALL_CONTROL_APP_ID'), customer_reference: text(req.body?.customerReference, 100) || `Vocivo API ${apiKey.id}` }) });
      return res.status(201).json(await response.json());
    }
    if (resource === 'events') {
      const query = new URLSearchParams({ 'page[size]': '100' });
      const callLegId = text(req.query.callLegId, 500); if (callLegId) query.set('filter[call_leg_id]', callLegId);
      const response = await telnyx(`/call_events?${query}`);
      return res.status(200).json(await response.json());
    }
    return res.status(404).json({ error: 'Not found' });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Invalid API key or scope.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
