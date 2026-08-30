import { createHash } from 'node:crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { verifyAiTransferToken } from '../ai-transfer-token.js';
import { claimReplayKey, releaseReplayKey } from '../object-store.js';
import { findExtension, listExtensionSipUsernames } from '../pbx.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { extensionSipUri } from '../internal-sip.js';
import { callAction, dialCall, encodeVoiceState, primaryVoiceCallerId } from '../voice-control.js';
import { normalizeE164 } from '../tenancy.js';
import { sendIncomingCallWebPush } from '../web-push-dispatcher.js';
import { userAvailableBySchedule } from '../office-hours.js';
import { userNoAnswerSeconds, userVoicemailEnabled } from '../user-call-routing.js';

const e164 = /^\+[1-9]\d{6,14}$/;

function header(req: VercelRequest, name: string) {
  const value = req.headers[name.toLowerCase()];
  return (Array.isArray(value) ? value[0] : value || '').trim();
}

function callKey(callControlId: string) {
  return `ai-transfer:${createHash('sha256').update(callControlId).digest('hex')}`;
}

function commandPrefix(callControlId: string) {
  return `ai-xfer-${createHash('sha256').update(callControlId).digest('hex').slice(0, 24)}`;
}

function displayName(company: string, callerName?: string, callerNumber?: string) {
  const identity = callerName || callerNumber || 'Caller';
  return `${company} - ${identity}`.replace(/[^A-Za-z0-9 _~!.+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  const rawToken = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token;
  const authorization = verifyAiTransferToken(typeof rawToken === 'string' ? rawToken : '');
  const carrierCallControlId = header(req, 'x-telnyx-call-control-id');
  if (!authorization || !carrierCallControlId || carrierCallControlId !== authorization.callControlId) {
    return res.status(401).json({ error: 'Invalid or expired AI transfer authorization.' });
  }

  const requestedExtension = String(req.body?.extension || '').replace(/\D/g, '');
  if (!/^\d{2,5}$/.test(requestedExtension)) return res.status(400).json({ error: 'A valid company extension is required.' });

  const transferKey = callKey(authorization.callControlId);
  let claimed = false;
  try {
    const [extension, basePbx, business] = await Promise.all([
      findExtension(requestedExtension, authorization.organizationId),
      readPbxConfig(),
      readBusinessVoiceConfig(authorization.organizationId),
    ]);
    if (!extension || extension.status !== 'active' || !extension.sipUsername) {
      return res.status(404).json({ error: `Extension ${requestedExtension} is not available.` });
    }
    const pbx = pbxForOrganization(basePbx, authorization.organizationId);
    const profile = pbx.userProfiles[extension.id];
    if (!userAvailableBySchedule(profile, pbx.officeHours)) {
      return res.status(409).json({ error: `Extension ${requestedExtension} is outside its availability schedule.` });
    }

    claimed = await claimReplayKey(transferKey, new Date(Date.now() + 60 * 60 * 1000));
    if (!claimed) return res.status(200).json({ accepted: true, duplicate: true, extension: requestedExtension });

    const sipUsers = await listExtensionSipUsernames(extension.id);
    const destinations = [...new Set((sipUsers.length ? sipUsers : [extension.sipUsername]).map(extensionSipUri))];
    if (!destinations.length) throw new Error(`Extension ${requestedExtension} has no active device credentials.`);
    const inboundIdentity = normalizeE164(authorization.inboundNumber);
    const from = e164.test(inboundIdentity) ? inboundIdentity : await primaryVoiceCallerId();
    const prefix = commandPrefix(authorization.callControlId);

    await callAction(authorization.callControlId, 'ai_assistant_stop', { command_id: `${prefix}-stop-ai` });
    await callAction(authorization.callControlId, 'playback_start', {
      audio_url: `${requiredEnv('VITE_APP_URL').replace(/\/+$/, '')}/audio/ringback.wav?v=enterprise-2`,
      loop: 'infinity',
      command_id: `${prefix}-ringback`,
    });
    await dialCall({
      to: destinations.length === 1 ? destinations[0] : destinations,
      from,
      fromDisplayName: displayName(business.companyName, authorization.callerName, authorization.callerNumber),
      state: {
        flow: 'agent',
        department: `${extension.name}, extension ${extension.extension}`,
        parentCallControlId: authorization.callControlId,
        targetExtensionId: extension.id,
        targetExtensionIds: [extension.id],
        callerNumber: authorization.callerNumber,
        callerName: authorization.callerName,
        organizationId: authorization.organizationId,
        inboundNumber: authorization.inboundNumber,
        voicemailEnabled: userVoicemailEnabled(profile, business.voicemailEnabled),
        forwardBusy: profile?.forwardBusy,
        forwardNoAnswer: profile?.forwardNoAnswer,
        forwardUnavailable: profile?.forwardUnavailable,
      },
      commandId: `${prefix}-devices`,
      timeoutSeconds: userNoAnswerSeconds(profile, business.voicemailDelaySeconds),
    });
    sendIncomingCallWebPush({
      organizationId: authorization.organizationId,
      extensionIds: [extension.id],
      callerName: authorization.callerName,
      callId: authorization.callControlId,
    }).catch((error) => console.warn('Vocivo AI transfer web push failed', publicError(error)));
    return res.status(200).json({ accepted: true, extension: extension.extension, name: extension.name, devices: destinations.length });
  } catch (error) {
    if (claimed) await releaseReplayKey(transferKey).catch((releaseError) => console.warn('Vocivo could not release failed AI transfer claim', publicError(releaseError)));
    await callAction(authorization.callControlId, 'playback_stop', { stop: 'all', command_id: `${commandPrefix(authorization.callControlId)}-stop-failed-ringback` })
      .catch((playbackError) => console.warn('Vocivo could not stop failed AI transfer ringback', publicError(playbackError)));
    console.error('Vocivo AI extension transfer failed', error);
    return res.status(500).json({ error: 'The requested extension could not be connected.' });
  }
}
