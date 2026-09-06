import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireSession } from '../../auth/auth.js';
import { allowMobile, methodNotAllowed, publicError, writeAuthError } from '../../../shared/http.js';
import { authorizeOutboundCall } from '../../billing/outbound-policy.js';
import { assertCallerIdForSession } from '../../numbers/phone-number-access.js';
import { getExtension, listExtensions } from '../../organizations/pbx.js';
import { pbxForOrganization, readPbxConfig } from '../../organizations/pbx-config-store.js';
import { sessionOrganizationId } from '../../organizations/tenancy.js';
import { dialCall, dialCallLegs } from '../voice-control.js';
import { organizationExtensionSipUri } from '../internal-sip.js';
import { requireFeature } from '../../organizations/saas-access.js';
import { assertTelnyxVoiceReady, TelnyxCarrierUnavailableError } from '../../../shared/telnyx.js';
import { outboundWalletBlockReason, readTenantWallet } from '../../billing/wallet-store.js';

const e164 = /^\+[1-9]\d{6,14}$/;
type ConferenceParticipant = { type: 'external'; number: string } | { type: 'extension'; extensionId: string };

export function requestedConferenceParticipants(value: unknown): ConferenceParticipant[] {
  if (!Array.isArray(value)) return [];
  if (value.length > 5) throw new Error('A conference can have up to five participants.');
  return value.map((item): ConferenceParticipant => {
    if (typeof item === 'string') {
      const number = item.replace(/[\s()-]/g, '');
      if (e164.test(number)) return { type: 'external', number };
      throw new Error('Every external participant requires a complete international number.');
    }
    if (!item || typeof item !== 'object') throw new Error('Choose a valid conference participant.');
    const candidate = item as Record<string, unknown>;
    if (candidate.type === 'external') {
      const number = typeof candidate.number === 'string' ? candidate.number.replace(/[\s()-]/g, '') : '';
      if (e164.test(number)) return { type: 'external', number };
      throw new Error('Every external participant requires a complete international number.');
    }
    if (candidate.type === 'extension' && typeof candidate.extensionId === 'string' && candidate.extensionId.trim()) {
      return { type: 'extension', extensionId: candidate.extensionId.trim() };
    }
    throw new Error('Choose a valid conference participant.');
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (allowMobile(req, res)) return;
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  try {
    const session = await requireSession(req);
    let participants: ConferenceParticipant[];
    try {
      participants = requestedConferenceParticipants(req.body?.participants);
    } catch (validationError) {
      return res.status(400).json({ error: validationError instanceof Error ? validationError.message : 'Choose valid conference participants.' });
    }
    if (participants.length < 2) return res.status(400).json({ error: 'Add at least two valid participants.' });
    const config = await readPbxConfig();
    const organizationId = sessionOrganizationId(session, config);
    const organization = config.organizations.find((organization) => organization.id === organizationId && organization.status === 'active');
    if (!organization) return res.status(403).json({ error: 'An active calling account is required to host a conference.' });
    if (participants.some((participant) => participant.type === 'extension')) await requireFeature(session, 'internalCalling', config);
    if (participants.some((participant) => participant.type === 'external')) await requireFeature(session, 'outboundCalling', config);
    const profile = session.extensionId ? config.userProfiles[session.extensionId] : undefined;
    const extension = session.extensionId ? await getExtension(session.extensionId) : undefined;
    if (!extension || extension.organizationId !== organizationId || extension.status !== 'active' || !extension.sipUsername) return res.status(403).json({ error: 'An active calling account is required to host a conference.' });
    const directory = participants.some((participant) => participant.type === 'extension') ? await listExtensions(organizationId) : [];
    const resolved = participants.map((participant) => {
      if (participant.type === 'external') return { destination: participant.number, displayName: participant.number, internal: false };
      const colleague = directory.find((candidate) => candidate.id === participant.extensionId && candidate.status === 'active');
      if (!colleague || colleague.id === extension.id || !colleague.sipUsername) throw new Error('Choose an active colleague in your organization.');
      return { destination: organizationExtensionSipUri(config, organizationId, colleague.sipUsername), displayName: colleague.name, internal: true, extension: colleague.extension };
    });
    const uniqueDestinations = new Set(resolved.map((participant) => participant.destination.toLowerCase()));
    if (uniqueDestinations.size !== resolved.length) return res.status(400).json({ error: 'Each conference participant can only be added once.' });
    const externalParticipants = resolved.filter((participant) => !participant.internal);
    await assertTelnyxVoiceReady();
    if (externalParticipants.length) {
      const wallet = await readTenantWallet(organizationId);
      const blocked = outboundWalletBlockReason(wallet);
      if (blocked) return res.status(402).json({ error: blocked });
    }
    let callerId: string | undefined;
    if (externalParticipants.length) {
      const tenant = pbxForOrganization(config, organizationId);
      const requestedCallerId = typeof req.body?.callerId === 'string' && req.body.callerId.trim()
        ? req.body.callerId
        : profile?.outboundCallerId || tenant.company.defaultCallerId;
      if (!requestedCallerId) return res.status(409).json({ error: 'Assign a caller ID before adding external conference participants.' });
      callerId = await assertCallerIdForSession(session, requestedCallerId);
    }
    for (const participant of externalParticipants) {
      authorizeOutboundCall(pbxForOrganization(config, organizationId), {
        extension: extension?.extension,
        department: extension?.department,
        internationalAllowed: profile?.permissions?.international !== false,
      }, participant.destination, callerId!);
    }
    const hostDestination = organizationExtensionSipUri(config, organizationId, extension.sipUsername);
    const room = `vocivo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const conferenceFrom = callerId || hostDestination;
    const result = await dialCall({
      to: hostDestination,
      from: conferenceFrom,
      state: { flow: 'conference_host', room, conferenceParticipants: resolved, callerId: conferenceFrom, organizationId, sourceExtension: extension.extension, sourceName: extension.name },
      fromDisplayName: `Conference for ${extension.name}`,
    });
    return res.status(200).json({ room, host_call_id: dialCallLegs(result)[0]?.call_control_id, participants: resolved.length, internalParticipants: resolved.filter((participant) => participant.internal).length });
  } catch (error) {
    if (writeAuthError(res, error)) return;
    if (error instanceof TelnyxCarrierUnavailableError) return res.status(503).json({ error: error.message });
    if (error instanceof Error && /wallet is frozen|Calling credit/i.test(error.message)) return res.status(402).json({ error: error.message });
    if (error instanceof Error && /Feature not enabled|Subscription inactive|Organization inactive/i.test(error.message)) return res.status(403).json({ error: 'This calling feature is not enabled for your company.' });
    if (error instanceof Error && /Caller ID|organization|owned|verified|outbound rule|International calling|active colleague|active company extension/i.test(error.message)) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: publicError(error) });
  }
}
