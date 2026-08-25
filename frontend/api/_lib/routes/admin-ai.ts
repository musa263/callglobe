import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { allowMobile, methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { organizationSettingsFrom, pbxForOrganization, readPbxConfig, savePbxConfig } from '../pbx-config-store.js';
import { telnyx } from '../telnyx.js';
import { carrierFallbackVoice } from '../voice-catalog.js';
import { findExtension } from '../pbx.js';
import { requireFeature } from '../saas-access.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);
  try {
    const access = await requireAdmin(req);
    const current = await readPbxConfig();
    await requireFeature(access.session, 'aiReceptionist', current);
    const organizationId = access.organizationId || current.activeOrganizationId;
    const tenant = pbxForOrganization(current, organizationId);
    const ai = { ...tenant.ai, ...(req.body ?? {}) };
    if (ai.voice === 'Telnyx.KokoroTTS.af') ai.voice = 'Telnyx.Bayan.Amanda';
    if (!ai.name.trim() || !ai.instructions.trim()) return res.status(400).json({ error: 'Assistant name and instructions are required.' });
    const fallback = ai.transferEnabled && ai.fallbackExtension
      ? await findExtension(ai.fallbackExtension, organizationId)
      : null;
    const tools: Array<Record<string, unknown>> = [{ type: 'hangup', hangup: {} }];
    if (fallback?.sipUsername) {
      tools.unshift({
        type: 'transfer',
        transfer: {
          targets: [{ name: `${fallback.name}, extension ${fallback.extension}`, to: `sip:${fallback.sipUsername}@sip.telnyx.com` }],
          from: tenant.company.defaultCallerId || requiredEnv('TELNYX_SMS_FROM'),
        },
      });
    }
    const payload = {
      name: ai.name.trim(), description: 'Vocivo interactive company receptionist',
      instructions: `${ai.instructions.trim()}\n\nApproved company information:\n${ai.knowledge.trim() || 'No additional company information has been approved.'}\n\n${ai.transferEnabled ? `When a human is needed, offer transfer to extension ${ai.fallbackExtension || 'the main line'}.` : 'Do not attempt to transfer calls.'}`,
      greeting: ai.greeting.trim(), enabled_features: ['telephony'],
      voice_settings: { voice: carrierFallbackVoice(ai.voice) },
      transcription: { model: ai.language === 'en' ? 'deepgram/flux' : 'deepgram/nova-3', language: ai.language },
      post_conversation_settings: { enabled: ai.summariesEnabled },
      tools,
    };
    const response = await telnyx(ai.assistantId ? `/ai/assistants/${encodeURIComponent(ai.assistantId)}` : '/ai/assistants', { method: 'POST', body: JSON.stringify(payload) });
    const assistant = await response.json() as { id?: string };
    ai.assistantId = assistant.id || ai.assistantId;
    const config = await savePbxConfig({
      organizationSettings: {
        ...current.organizationSettings,
        [organizationId]: organizationSettingsFrom({ ...tenant, ai }),
      },
    });
    const saved = pbxForOrganization(config, organizationId).ai;
    return res.status(200).json({ ai: saved, synced: Boolean(saved.assistantId) });
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') return res.status(401).json({ error: 'Session expired.' });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'AI receptionist is not enabled for this company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
