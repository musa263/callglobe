import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireAdmin } from '../auth.js';
import { afterResponse, allowMobile, methodNotAllowed, publicError, writeAuthError } from '../http.js';
import { organizationSettingsFrom, PbxConfigConflictError, pbxForOrganization, readPbxConfig, savePbxConfig } from '../pbx-config-store.js';
import { prerenderTenantPrompts } from '../prompt-prerender.js';
import { telnyx } from '../telnyx.js';
import { carrierFallbackVoice } from '../voice-catalog.js';
import { findExtension, listExtensions } from '../pbx.js';
import { requireFeature } from '../saas-access.js';
import { sipInboundEnabled } from '../voice-provider.js';
import { activeAiTransferTargets, aiAssistantInstructions, aiAssistantTools } from '../ai-transfer.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);
  try {
    const access = await requireAdmin(req);
    const current = await readPbxConfig();
    await requireFeature(access.session, 'aiReceptionist', current);
    const organizationId = access.superadmin ? current.activeOrganizationId : access.organizationId!;
    const tenant = pbxForOrganization(current, organizationId);
    const ai = { ...tenant.ai, ...(req.body ?? {}) };
    if (ai.voice === 'Telnyx.KokoroTTS.af') ai.voice = 'Telnyx.Bayan.Amanda';
    if (!ai.name.trim() || !ai.instructions.trim()) return res.status(400).json({ error: 'Assistant name and instructions are required.' });
    const [fallback, extensions] = await Promise.all([
      ai.transferEnabled && ai.fallbackExtension ? findExtension(ai.fallbackExtension, organizationId) : Promise.resolve(null),
      listExtensions(organizationId),
    ]);
    if (ai.enabled && ai.transferEnabled && !fallback) {
      return res.status(400).json({ error: 'Choose an active company extension for AI transfers before enabling the receptionist.' });
    }
    const targets = activeAiTransferTargets(current, organizationId, extensions);

    // The receptionist runs on Vocivo's own SIP edge — FreeSWITCH for the call,
    // faster-whisper for what the caller said, Kokoro for what it says back. It
    // reads this configuration from /api/voice/receptionist at call time, so
    // there is nothing to push anywhere when it is saved.
    //
    // A carrier assistant is still created and kept in step for as long as
    // inbound is delivered by the carrier's Call Control app; the moment
    // VOCIVO_SIP_INBOUND is set, saving stops touching the carrier at all.
    let syncedWithCarrier = false;
    if (!sipInboundEnabled()) {
      const payload = {
        name: ai.name.trim(), description: 'Vocivo interactive company receptionist',
        instructions: aiAssistantInstructions(ai, targets),
        greeting: ai.greeting.trim(), enabled_features: ['telephony'],
        voice_settings: { voice: carrierFallbackVoice(ai.voice) },
        transcription: { model: ai.language === 'en' ? 'deepgram/flux' : 'deepgram/nova-3', language: ai.language },
        post_conversation_settings: { enabled: ai.summariesEnabled },
        // Live calls inject a signed, call-scoped transfer webhook. The stored
        // assistant deliberately has no reusable transfer destination or secret.
        tools: aiAssistantTools(ai.transferEnabled, targets),
      };
      const response = await telnyx(ai.assistantId ? `/ai/assistants/${encodeURIComponent(ai.assistantId)}` : '/ai/assistants', { method: 'POST', body: JSON.stringify(payload) });
      const assistant = await response.json() as { id?: string };
      ai.assistantId = assistant.id || ai.assistantId;
      syncedWithCarrier = Boolean(ai.assistantId);
    }
    const config = await savePbxConfig({
      organizationSettings: {
        ...current.organizationSettings,
        [organizationId]: organizationSettingsFrom({ ...tenant, ai }),
      },
    }, { expectedUpdatedAt: current.updatedAt });
    const saved = pbxForOrganization(config, organizationId).ai;
    // The greeting and the receptionist's fixed phrases are rendered in the
    // chosen voice now, so the next caller hears them without a cold render.
    afterResponse('receptionist prompt pre-render', prerenderTenantPrompts(organizationId, { config }));
    return res.status(200).json({ ai: saved, synced: syncedWithCarrier, engine: sipInboundEnabled() ? 'vocivo' : 'carrier' });
  } catch (error) {
    if (error instanceof PbxConfigConflictError) return res.status(409).json({ error: error.message });
    if (writeAuthError(res, error)) return;
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'AI receptionist is not enabled for this company.' });
    return res.status(500).json({ error: publicError(error) });
  }
}
