import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { findExtension, getExtension, listExtensions } from '../pbx.js';
import { telnyx, TelnyxApiError } from '../telnyx.js';
import { callAction, decodeVoiceState, dialCall, encodeVoiceState } from '../voice-control.js';
import { clearActiveCallRoute, saveActiveCallRoute } from '../call-route-store.js';
import { pbxForOrganization, readPbxConfig } from '../pbx-config-store.js';
import { storeVoicemail, storeVoicemailAudio } from '../voicemail-store.js';
import { clearOutboundCallPair, readOutboundCallPairByClient, readOutboundCallPairByDestination, saveOutboundCallPair } from '../outbound-call-store.js';
import { isInboundCallAnswered, isInboundCallInitiated } from '../voice-routing.js';
import { isVoiceRouteId } from '../voice-route-id.js';
import { bridgeOutboundCalls } from '../outbound-bridge.js';
import { carrierFallbackVoice, renderVocivoPrompt } from '../voice-catalog.js';
import { readVoiceRoute, updateVoiceRoute } from '../voice-route-store.js';
import { verifyVoiceRouteToken } from '../voice-route-token.js';
import { organizationForNumber } from '../tenancy.js';
import { verifyTelnyxWebhook } from '../telnyx-webhook-auth.js';
import { storeCallEvent } from '../call-event-store.js';
import { clearQueueCall, readQueueCall, saveQueueCall } from '../queue-call-store.js';
import { normalizeE164 } from '../tenancy.js';
import { forwardingTargetForCause, isUnansweredAgentCause, userNoAnswerSeconds, userVoicemailEnabled } from '../user-call-routing.js';
import { officeHoursDecision, userAvailableBySchedule } from '../office-hours.js';
import { accessForOrganization } from '../saas-access.js';

type VoiceEvent = {
  data?: {
    id?: string;
    event_type?: string;
    occurred_at?: string;
    payload?: {
      call_control_id?: string;
      call_session_id?: string;
      call_leg_id?: string;
      connection_id?: string;
      client_state?: string;
      direction?: string;
      state?: string;
      custom_headers?: Array<{ name?: string; value?: string; header_name?: string; header_value?: string }>;
      digits?: string;
      result?: string;
      from?: string;
      to?: string;
      caller_id_name?: string;
      hangup_cause?: string;
      hangup_source?: string;
      recording_id?: string;
      recording_started_at?: string;
      recording_ended_at?: string;
      recording_urls?: { mp3?: string; wav?: string };
      public_recording_urls?: { mp3?: string; wav?: string };
    };
  };
};

type VoicePayload = NonNullable<NonNullable<VoiceEvent['data']>['payload']>;
const e164 = /^\+[1-9]\d{6,14}$/;
const internalSip = /^sip:[A-Za-z0-9._-]+@sip\.telnyx\.com$/i;
function callerDisplay(value: string) {
  return value.replace(/[^A-Za-z0-9 _~!.+-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 128) || 'Vocivo';
}
function customHeader(payload: VoicePayload | undefined, name: string) {
  const match = payload?.custom_headers?.find((header) => (header.name || header.header_name || '').toLowerCase() === name.toLowerCase());
  return (match?.value || match?.header_value || '').trim();
}

async function stopPlaybackBeforeBridge(callControlId: string, commandId: string) {
  await callAction(callControlId, 'playback_stop', { stop: 'all', command_id: commandId }).catch(() => undefined);
}

function background(label: string, task: Promise<unknown>) {
  waitUntil(task.catch((error) => console.warn(`Vocivo background ${label} failed`, publicError(error))));
}

async function speakPrompt(callControlId: string, input: { payload: string; voice: string; [key: string]: unknown }) {
  const audioUrl = await renderVocivoPrompt(input.payload, input.voice);
  const { payload, voice, payload_type: _payloadType, ...shared } = input;
  return audioUrl
    ? callAction(callControlId, 'playback_start', { ...shared, audio_url: audioUrl, audio_type: 'wav', cache_audio: true })
    : callAction(callControlId, 'speak', { ...shared, payload, voice: carrierFallbackVoice(voice), payload_type: 'text' });
}

async function gatherPrompt(callControlId: string, input: { payload: string; invalid_payload: string; voice: string; [key: string]: unknown }) {
  const [audioUrl, invalidAudioUrl] = await Promise.all([renderVocivoPrompt(input.payload, input.voice), renderVocivoPrompt(input.invalid_payload, input.voice)]);
  const { payload, invalid_payload, voice, payload_type: _payloadType, ...shared } = input;
  return audioUrl
    ? callAction(callControlId, 'gather_using_audio', { ...shared, audio_url: audioUrl, ...(invalidAudioUrl ? { invalid_audio_url: invalidAudioUrl } : {}) })
    : callAction(callControlId, 'gather_using_speak', { ...shared, payload, invalid_payload, voice: carrierFallbackVoice(voice), payload_type: 'text' });
}

type AgentRouteOptions = {
  announceWaiting?: boolean;
  voicemailEnabled?: boolean;
  inboundNumber?: string;
  targetExtensionIds?: string[];
  forwardBusy?: string;
  forwardNoAnswer?: string;
  forwardUnavailable?: string;
  forwardingDepth?: number;
  dialFrom?: string;
};

async function routeToAgent(callControlId: string, department: string, waitingMessage: string, voice: string, eventId: string, destination: string | string[] = requiredEnv('TELNYX_SIP_URI'), targetExtensionId?: string, timeoutSeconds = 45, callerNumber?: string, callerName?: string, organizationId?: string, options: AgentRouteOptions = {}) {
  if (options.announceWaiting !== false) {
    await speakPrompt(callControlId, { payload: waitingMessage, voice, command_id: `${eventId}-wait` });
  } else {
    const appUrl = requiredEnv('VITE_APP_URL').replace(/\/+$/, '');
    await callAction(callControlId, 'playback_start', { audio_url: `${appUrl}/audio/ringback.wav`, loop: 'infinity', command_id: `${eventId}-ringback` }).catch(() => undefined);
  }
  await dialCall({
    to: destination,
    state: {
      flow: 'agent', department, parentCallControlId: callControlId, targetExtensionId,
      targetExtensionIds: options.targetExtensionIds, callerNumber, callerName, organizationId,
      inboundNumber: options.inboundNumber, voicemailEnabled: options.voicemailEnabled !== false,
      forwardBusy: options.forwardBusy, forwardNoAnswer: options.forwardNoAnswer,
      forwardUnavailable: options.forwardUnavailable, forwardingDepth: options.forwardingDepth,
    },
    from: options.dialFrom || (callerNumber && e164.test(callerNumber) ? callerNumber : undefined),
    fromDisplayName: `${department} call`,
    linkTo: callControlId,
    commandId: `${eventId}-agent`,
    timeoutSeconds,
  });
}

async function routeToAvailableAgent(input: {
  callControlId: string;
  department: string;
  eventId: string;
  organizationId: string;
  inboundNumber: string;
  callerNumber?: string;
  callerName?: string;
  preferMain?: boolean;
}) {
  const config = await readBusinessVoiceConfig(input.organizationId);
  const target = await resolveOrganizationDestination(input.organizationId, input.inboundNumber, input.department, input.preferMain);
  const destination = target?.sipUsername
    ? `sip:${target.sipUsername}@sip.telnyx.com`
    : input.organizationId === 'primary' ? requiredEnv('TELNYX_SIP_URI') : '';
  if (destination) {
    if (target) {
      await routeToExtension({ ...input, extension: target, announceWaiting: !input.preferMain });
    } else {
      await routeToAgent(input.callControlId, input.department, config.waitingMessage, config.voice, input.eventId, destination, undefined, config.voicemailDelaySeconds, input.callerNumber, input.callerName, input.organizationId, { announceWaiting: !input.preferMain, voicemailEnabled: config.voicemailEnabled, inboundNumber: input.inboundNumber });
    }
    return;
  }
  const flow = config.voicemailEnabled ? 'voicemail_prompt' : 'unavailable_prompt';
  await speakPrompt(input.callControlId, {
    payload: config.voicemailEnabled ? config.voicemailGreeting : 'No one is available to take your call right now. Please try again later.',
    voice: config.voice,
    client_state: encodeVoiceState({ flow, callerNumber: input.callerNumber, callerName: input.callerName, organizationId: input.organizationId }),
    command_id: `${input.eventId}-unavailable`,
  });
}

async function resolveOrganizationDestination(organizationId: string, inboundNumber: string, department?: string, preferMain = false) {
  const pbx = await readPbxConfig();
  const assignment = pbx.numberAssignments[inboundNumber];
  if (assignment?.organizationId === organizationId && assignment.destinationType === 'main') return null;
  if (assignment?.organizationId === organizationId && assignment.destinationType === 'extension' && assignment.destinationId) {
    const extension = await getExtension(assignment.destinationId).catch(() => null);
    if (extension?.status === 'active' && extension.organizationId === organizationId) return extension;
  }
  if (preferMain && organizationId === 'primary') return null;
  const extensions = (await listExtensions(organizationId)).filter((item) => item.status === 'active' && item.sipUsername);
  const departmental = department ? extensions.find((item) => item.department.toLowerCase() === department.toLowerCase()) : null;
  return departmental || extensions[0] || null;
}

async function routeUnavailable(callControlId: string, organizationId: string, eventId: string, callerNumber?: string, callerName?: string, voicemailOverride?: boolean) {
  const config = await readBusinessVoiceConfig(organizationId);
  const voicemailEnabled = config.voicemailEnabled && voicemailOverride !== false;
  const flow = voicemailEnabled ? 'voicemail_prompt' : 'unavailable_prompt';
  await speakPrompt(callControlId, {
    payload: voicemailEnabled ? config.voicemailGreeting : 'No one is available to take your call right now. Please try again later.',
    voice: config.voice,
    client_state: encodeVoiceState({ flow, callerNumber, callerName, organizationId }),
    command_id: `${eventId}-unavailable`,
  });
}

async function routeToExtension(input: {
  callControlId: string;
  eventId: string;
  organizationId: string;
  inboundNumber: string;
  extension: Awaited<ReturnType<typeof getExtension>>;
  department?: string;
  callerNumber?: string;
  callerName?: string;
  announceWaiting?: boolean;
  forwardingDepth?: number;
}) {
  const [config, basePbx, extensions] = await Promise.all([
    readBusinessVoiceConfig(input.organizationId),
    readPbxConfig(),
    listExtensions(input.organizationId),
  ]);
  const pbx = pbxForOrganization(basePbx, input.organizationId);
  const profile = pbx.userProfiles[input.extension.id];
  const voicemailEnabled = userVoicemailEnabled(profile, config.voicemailEnabled);
  if (!userAvailableBySchedule(profile, pbx.officeHours)) {
    await routeUnavailable(input.callControlId, input.organizationId, input.eventId, input.callerNumber, input.callerName, voicemailEnabled);
    return;
  }

  const destinations = [`sip:${input.extension.sipUsername}@sip.telnyx.com`];
  const targetExtensionIds = [input.extension.id];
  let dialFrom: string | undefined;
  const simultaneous = profile?.simultaneousRing?.trim() || '';
  const simultaneousExtension = extensions.find((item) => item.extension === simultaneous && item.id !== input.extension.id && item.status === 'active' && item.sipUsername);
  if (simultaneousExtension) {
    destinations.push(`sip:${simultaneousExtension.sipUsername}@sip.telnyx.com`);
    targetExtensionIds.push(simultaneousExtension.id);
  } else {
    const simultaneousNumber = normalizeE164(simultaneous);
    if (e164.test(simultaneousNumber)) {
      destinations.push(simultaneousNumber);
      dialFrom = e164.test(normalizeE164(input.inboundNumber)) ? normalizeE164(input.inboundNumber) : requiredEnv('TELNYX_SMS_FROM');
    }
  }

  await routeToAgent(
    input.callControlId,
    input.department || `${input.extension.name}, extension ${input.extension.extension}`,
    config.waitingMessage,
    config.voice,
    input.eventId,
    destinations.length === 1 ? destinations[0] : destinations,
    input.extension.id,
    userNoAnswerSeconds(profile, config.voicemailDelaySeconds),
    input.callerNumber,
    input.callerName,
    input.organizationId,
    {
      announceWaiting: input.announceWaiting,
      voicemailEnabled,
      inboundNumber: input.inboundNumber,
      targetExtensionIds,
      forwardBusy: profile?.forwardBusy,
      forwardNoAnswer: profile?.forwardNoAnswer,
      forwardUnavailable: profile?.forwardUnavailable,
      forwardingDepth: input.forwardingDepth || 0,
      dialFrom,
    },
  );
}

async function routeAfterAgentFailure(state: NonNullable<ReturnType<typeof decodeVoiceState>>, cause: string, eventId: string) {
  const organizationId = state.organizationId || 'primary';
  const target = forwardingTargetForCause(state, cause);
  const voicemailTarget = !target || ['voicemail', 'main voicemail'].includes(target.toLowerCase());
  if (voicemailTarget || (state.forwardingDepth || 0) >= 2) {
    await routeUnavailable(state.parentCallControlId || '', organizationId, eventId, state.callerNumber, state.callerName, state.voicemailEnabled);
    return;
  }

  const extension = await findExtension(target.replace(/\D/g, ''), organizationId);
  if (extension && extension.id !== state.targetExtensionId) {
    await routeToExtension({
      callControlId: state.parentCallControlId || '', eventId, organizationId,
      inboundNumber: state.inboundNumber || '', extension,
      callerNumber: state.callerNumber, callerName: state.callerName,
      announceWaiting: false, forwardingDepth: (state.forwardingDepth || 0) + 1,
    });
    return;
  }

  const destination = normalizeE164(target);
  if (e164.test(destination)) {
    const config = await readBusinessVoiceConfig(organizationId);
    const from = e164.test(normalizeE164(state.inboundNumber)) ? normalizeE164(state.inboundNumber) : requiredEnv('TELNYX_SMS_FROM');
    await routeToAgent(state.parentCallControlId || '', 'Forwarded call', config.waitingMessage, config.voice, eventId, destination, undefined, 45, state.callerNumber, state.callerName, organizationId, {
      announceWaiting: false, voicemailEnabled: state.voicemailEnabled, inboundNumber: state.inboundNumber,
      forwardingDepth: (state.forwardingDepth || 0) + 1, dialFrom: from,
    });
    return;
  }
  await routeUnavailable(state.parentCallControlId || '', organizationId, eventId, state.callerNumber, state.callerName, state.voicemailEnabled);
}

function cleanQueuePart(value: string) { return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24) || 'route'; }

async function routeToCallGroup(input: {
  callControlId: string;
  eventId: string;
  organizationId: string;
  handlingId: string;
  kind: 'ring_group' | 'queue';
  inboundNumber?: string;
  callerNumber?: string;
  callerName?: string;
}) {
  const [basePbx, extensions] = await Promise.all([
    readPbxConfig(),
    listExtensions(input.organizationId),
  ]);
  const pbx = pbxForOrganization(basePbx, input.organizationId);
  const collection = input.kind === 'ring_group' ? pbx.callHandling.ringGroups : pbx.callHandling.queues;
  const group = collection.find((item) => item.id === input.handlingId);
  const members = group ? extensions.filter((extension) => group.members.includes(extension.id) && extension.status === 'active' && extension.sipUsername) : [];
  if (!group || !members.length) {
    await routeCallGroupFallback(input);
    return;
  }
  const queueName = `vocivo-${input.kind === 'queue' ? 'q' : 'rg'}-${cleanQueuePart(group.id)}-${Date.now().toString(36)}`;
  const maxWaitSeconds = input.kind === 'queue'
    ? Math.min(900, Math.max(15, ('maxWait' in group ? group.maxWait : 180) || 180))
    : Math.min(120, Math.max(10, ('timeout' in group ? group.timeout : 25) || 25));
  await saveQueueCall({
    queueName,
    parentCallControlId: input.callControlId,
    organizationId: input.organizationId,
    handlingId: group.id,
    kind: input.kind,
    status: 'waiting',
    agentCallControlIds: [],
    updatedAt: new Date().toISOString(),
  });
  await callAction(input.callControlId, 'enqueue', {
    queue_name: queueName,
    max_wait_time_secs: maxWaitSeconds,
    max_size: 100,
    client_state: encodeVoiceState({
      flow: 'queue_wait', queueName, handlingId: group.id, organizationId: input.organizationId,
      targetExtensionIds: members.map((member) => member.id), inboundNumber: input.inboundNumber, callerNumber: input.callerNumber, callerName: input.callerName,
    }),
    command_id: `${input.eventId}-enqueue`,
  });
  // Dialing begins from call.enqueued so the waiting leg is ready before an agent answers.
}

async function routeCallGroupFallback(input: {
  callControlId: string;
  eventId: string;
  organizationId: string;
  handlingId: string;
  kind: 'ring_group' | 'queue';
  inboundNumber?: string;
  callerNumber?: string;
  callerName?: string;
}) {
  const pbx = pbxForOrganization(await readPbxConfig(), input.organizationId);
  const item = input.kind === 'ring_group'
    ? pbx.callHandling.ringGroups.find((entry) => entry.id === input.handlingId)
    : pbx.callHandling.queues.find((entry) => entry.id === input.handlingId);
  if (item?.fallback === 'Main line') {
    const config = await readBusinessVoiceConfig(input.organizationId);
    await routeToAvailableAgent({
      callControlId: input.callControlId, eventId: input.eventId,
      department: config.companyName, organizationId: input.organizationId,
      inboundNumber: input.inboundNumber || '', callerNumber: input.callerNumber,
      callerName: input.callerName, preferMain: true,
    });
    return;
  }
  await routeUnavailable(input.callControlId, input.organizationId, input.eventId, input.callerNumber, input.callerName);
}

function configuredTargetLabel(target: string, pbx: Awaited<ReturnType<typeof readPbxConfig>>, extensions: Awaited<ReturnType<typeof listExtensions>>) {
  const [type, id] = target.includes(':') ? target.split(':', 2) : ['extension', target];
  if (type === 'extension') return extensions.find((item) => item.id === id)?.name || 'an extension';
  const collection = type === 'ring_group' ? pbx.callHandling.ringGroups : type === 'queue' ? pbx.callHandling.queues : [];
  return collection.find((item) => item.id === id)?.name || 'a team';
}

async function routeToConfiguredIvr(input: { callControlId: string; eventId: string; organizationId: string; handlingId: string; inboundNumber?: string; callerNumber?: string; callerName?: string }) {
  const [basePbx, config, extensions] = await Promise.all([readPbxConfig(), readBusinessVoiceConfig(input.organizationId), listExtensions(input.organizationId)]);
  const pbx = pbxForOrganization(basePbx, input.organizationId);
  const ivr = pbx.callHandling.ivrs.find((item) => item.id === input.handlingId);
  const entries = Object.entries(ivr?.options || {}).filter(([digit, target]) => /^\d$/.test(digit) && Boolean(target)).slice(0, 10);
  if (!ivr || !entries.length) {
    await routeUnavailable(input.callControlId, input.organizationId, input.eventId, input.callerNumber, input.callerName);
    return;
  }
  const options = entries.map(([digit, target]) => `For ${configuredTargetLabel(target, pbx, extensions)}, press ${digit}.`).join(' ');
  await gatherPrompt(input.callControlId, {
    payload: `${ivr.greeting} ${options}`,
    invalid_payload: `That selection was not recognized. Please press one of these options: ${entries.map(([digit]) => digit).join(', ')}.`,
    voice: config.voice,
    minimum_digits: 1,
    maximum_digits: 1,
    valid_digits: entries.map(([digit]) => digit).join(''),
    maximum_tries: 2,
    timeout_millis: 10000,
    client_state: encodeVoiceState({ flow: 'configured_ivr', handlingId: ivr.id, organizationId: input.organizationId, inboundNumber: input.inboundNumber, callerNumber: input.callerNumber, callerName: input.callerName }),
    command_id: `${input.eventId}-configured-ivr`,
  });
}

async function routeToConfiguredTarget(input: { callControlId: string; eventId: string; organizationId: string; target: string; inboundNumber?: string; callerNumber?: string; callerName?: string }) {
  const [type, id] = input.target.includes(':') ? input.target.split(':', 2) : ['extension', input.target];
  if (type === 'ring_group' || type === 'queue') {
    await routeToCallGroup({ ...input, inboundNumber: input.inboundNumber, handlingId: id, kind: type });
    return;
  }
  const extension = type === 'extension' ? await getExtension(id).catch(() => null) : null;
  if (extension?.status === 'active' && extension.organizationId === input.organizationId) {
    await routeToExtension({ ...input, inboundNumber: input.inboundNumber || '', extension, announceWaiting: false });
    return;
  }
  await routeUnavailable(input.callControlId, input.organizationId, input.eventId, input.callerNumber, input.callerName);
}

async function extensionForAgentState(state: NonNullable<ReturnType<typeof decodeVoiceState>>, destination?: string) {
  if (!state.targetExtensionIds?.length || !state.organizationId) return state.targetExtensionId || '';
  const sipUsername = String(destination || '').match(/^sip:([^@]+)@/i)?.[1];
  if (!sipUsername) return state.targetExtensionId || '';
  const target = (await listExtensions(state.organizationId)).find((item) => state.targetExtensionIds?.includes(item.id) && item.sipUsername === sipUsername);
  return target?.id || '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (!verifyTelnyxWebhook(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const event = (req.body ?? {}) as VoiceEvent;
    const data = event.data;
    const payload = data?.payload;
    const eventType = data?.event_type || '';
    const eventId = data?.id || `event-${Date.now()}`;
    const callControlId = payload?.call_control_id;
    const state = decodeVoiceState(payload?.client_state);
    if (!callControlId) return res.status(200).json({ received: true });
    const parkedFlow = customHeader(payload, 'X-Vocivo-Flow');
    const eventRoute = verifyVoiceRouteToken(customHeader(payload, 'X-Vocivo-Route-Token'));
    background('call event', (async () => {
      const eventOrganizationId = state?.organizationId || eventRoute?.organizationId || await organizationForNumber(payload?.direction === 'incoming' ? payload?.to || '' : payload?.from || '');
      await storeCallEvent({
        id: eventId,
        name: eventType || 'unknown',
        type: 'webhook',
        event_timestamp: data?.occurred_at || new Date().toISOString(),
        call_session_id: payload?.call_session_id,
        call_leg_id: payload?.call_leg_id,
        call_control_id: callControlId,
        direction: payload?.direction,
        from: payload?.from,
        to: payload?.to,
        hangup_cause: payload?.hangup_cause,
        organizationId: eventOrganizationId,
        flow: state?.flow || parkedFlow,
        routeId: state?.routeId || eventRoute?.routeId,
        sourceExtensionId: state?.sourceExtensionId || eventRoute?.sourceExtensionId,
        sourceExtension: state?.sourceExtension || eventRoute?.callerExtension,
        sourceName: state?.sourceName || eventRoute?.callerName,
        destinationExtensionId: state?.destinationExtensionId || eventRoute?.destinationExtensionId,
        destinationExtension: state?.destinationExtension || eventRoute?.destinationExtension,
        destinationName: state?.destinationName || eventRoute?.destinationName,
      });
    })());

    const routeInput = {
      connectionId: payload?.connection_id,
      callControlApplicationId: requiredEnv('TELNYX_CALL_CONTROL_APP_ID'),
      hasManagedState: Boolean(state),
    };
    const outboundPair = eventType === 'call.answered' && !state ? await readOutboundCallPairByDestination(callControlId) : null;
    const endedOutboundPair = eventType === 'call.hangup' && !state ? await readOutboundCallPairByDestination(callControlId) : null;
    const isInboundInitiated = isInboundCallInitiated({ ...routeInput, direction: payload?.direction });
    const isInboundAnswered = eventType === 'call.answered'
      && (state?.flow === 'inbound_root' || isInboundCallAnswered({ ...routeInput, hasOutboundPair: Boolean(outboundPair) }));
    const isParkedVocivoClient = payload?.connection_id === requiredEnv('TELNYX_CONNECTION_ID')
      && payload?.direction === 'outgoing'
      && ['outbound', 'internal'].includes(parkedFlow);

    if (eventType === 'call.initiated' && isParkedVocivoClient && payload?.state === 'parked') {
      const destination = customHeader(payload, 'X-Vocivo-Destination') || payload.to || '';
      const selectedCallerId = customHeader(payload, 'X-Vocivo-Caller-ID');
      const requestedRouteId = customHeader(payload, 'X-Vocivo-Route-ID');
      const routeId = isVoiceRouteId(requestedRouteId) ? requestedRouteId : '';
      const signedReservation = verifyVoiceRouteToken(customHeader(payload, 'X-Vocivo-Route-Token'));
      // Persistent state remains a migration fallback for app builds released before signed routes.
      const reservation = signedReservation?.routeId === routeId ? signedReservation : routeId ? await readVoiceRoute(routeId) : null;
      const effectiveCallerId = selectedCallerId || reservation?.callerId || (reservation?.flow === 'outbound' ? requiredEnv('TELNYX_SMS_FROM') : '');
      if (!reservation || reservation.destination !== destination || reservation.flow !== parkedFlow || (reservation.callerId || '') !== effectiveCallerId || (!e164.test(destination) && !internalSip.test(destination))) {
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-invalid-destination` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      if (!signedReservation) {
        try {
          const access = await accessForOrganization(reservation.organizationId);
          const feature = reservation.flow === 'internal' ? 'internalCalling' : 'outboundCalling';
          if (!access.features[feature]) throw new Error('Feature not enabled');
        } catch {
          await callAction(callControlId, 'hangup', { command_id: `${eventId}-service-unavailable` }).catch(() => undefined);
          return res.status(200).json({ received: true });
        }
      }
      await callAction(callControlId, 'answer', { command_id: `${eventId}-answer-client` });
      const appUrl = requiredEnv('VITE_APP_URL').replace(/\/+$/, '');
      await callAction(callControlId, 'playback_start', {
        audio_url: `${appUrl}/audio/ringback.wav`,
        loop: 'infinity',
        command_id: `${eventId}-ringback`,
      }).catch((error) => console.warn('Vocivo could not start carrier ringback', publicError(error)));
      let destinationCall;
      try {
        destinationCall = await dialCall({
          to: destination,
          from: reservation.callerId,
          state: {
            flow: 'outbound_destination', parentCallControlId: callControlId, organizationId: reservation.organizationId, routeId,
            sourceExtensionId: reservation.sourceExtensionId, sourceExtension: reservation.callerExtension, sourceName: reservation.callerName,
            destinationExtensionId: reservation.destinationExtensionId, destinationExtension: reservation.destinationExtension,
            destinationName: reservation.destinationName,
          },
          fromDisplayName: callerDisplay(reservation.flow === 'internal' && reservation.callerName
            ? `${reservation.callerName}${reservation.callerExtension ? ` - Ext ${reservation.callerExtension}` : ''}`
            : payload.caller_id_name || 'Vocivo'),
          customHeaders: reservation.flow === 'internal' ? [
            { name: 'X-Vocivo-Call-Type', value: 'internal' },
            ...(reservation.callerName ? [{ name: 'X-Vocivo-Caller-Name', value: reservation.callerName }] : []),
            ...(reservation.callerExtension ? [{ name: 'X-Vocivo-Caller-Extension', value: reservation.callerExtension }] : []),
            { name: 'X-Vocivo-Organization-ID', value: reservation.organizationId },
          ] : undefined,
          commandId: `${eventId}-destination`,
        });
      } catch (dialError) {
        background('failed route state', updateVoiceRoute(routeId, { phase: 'failed', failureCause: dialError instanceof Error ? dialError.message : 'destination_dial_failed' }));
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-dial-failed` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      const destinationCallControlId = destinationCall.data?.call_control_id;
      if (!destinationCallControlId) {
        background('missing route leg', updateVoiceRoute(routeId, { phase: 'failed', failureCause: 'missing_destination_call_leg' }));
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-missing-leg` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      background('outbound pair', Promise.all([
        saveOutboundCallPair({
          clientCallControlId: callControlId,
          destinationCallControlId,
          routeId,
          destination,
          status: 'direct',
          phase: 'ringing',
          updatedAt: new Date().toISOString(),
        }),
        updateVoiceRoute(routeId, { phase: 'ringing' }),
      ]));
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.answered' && (state?.flow === 'outbound_destination' || outboundPair)) {
      const parentCallControlId = state?.flow === 'outbound_destination' ? state.parentCallControlId : outboundPair?.clientCallControlId;
      if (parentCallControlId) {
        await stopPlaybackBeforeBridge(parentCallControlId, `${eventId}-stop-ringback`);
        try {
          await bridgeOutboundCalls(parentCallControlId, callControlId, eventId);
          await callAction(parentCallControlId, 'playback_stop', {
            stop: 'all',
            command_id: `${eventId}-confirm-ringback-stopped`,
          }).catch(() => undefined);
          const connectedAt = new Date().toISOString();
          const connectedRouteId = outboundPair?.routeId || (state?.flow === 'outbound_destination' ? state.routeId : undefined);
          background('connected route state', Promise.all([
            ...(outboundPair ? [saveOutboundCallPair({ ...outboundPair, phase: 'connected', connectedAt, updatedAt: connectedAt })] : []),
            ...(connectedRouteId ? [updateVoiceRoute(connectedRouteId, { phase: 'connected', connectedAt })] : []),
          ]));
        } catch (bridgeError) {
          const failedRouteId = outboundPair?.routeId || (state?.flow === 'outbound_destination' ? state.routeId : undefined);
          if (failedRouteId) background('bridge failure state', updateVoiceRoute(failedRouteId, { phase: 'failed', failureCause: 'bridge_failed' }));
          await Promise.all([
            callAction(parentCallControlId, 'hangup', { command_id: `${eventId}-bridge-failed-client` }).catch(() => undefined),
            callAction(callControlId, 'hangup', { command_id: `${eventId}-bridge-failed-destination` }).catch(() => undefined),
          ]);
          return res.status(200).json({ received: true });
        }
        return res.status(200).json({ received: true });
      }
    }

    if (eventType === 'call.bridged') {
      if (state?.flow === 'outbound_destination' && state.routeId) {
        background('bridged route state', updateVoiceRoute(state.routeId, { phase: 'connected', connectedAt: new Date().toISOString() }));
        return res.status(200).json({ received: true });
      }
      const pair = await readOutboundCallPairByClient(callControlId)
        || await readOutboundCallPairByDestination(callControlId);
      if (pair?.status === 'direct' && pair.phase !== 'connected') {
        const connectedAt = new Date().toISOString();
        await saveOutboundCallPair({ ...pair, phase: 'connected', connectedAt, updatedAt: connectedAt });
        if (pair.routeId) await updateVoiceRoute(pair.routeId, { phase: 'connected', connectedAt });
      }
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.hangup' && (state?.flow === 'outbound_destination' || endedOutboundPair)) {
      if (state?.flow === 'outbound_destination') {
        const phase = payload?.hangup_cause === 'normal_clearing' ? 'ended' : 'failed';
        if (state.routeId) background('ended route state', updateVoiceRoute(state.routeId, { phase, failureCause: payload?.hangup_cause }));
        if (state.parentCallControlId) {
          await callAction(state.parentCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-ringback` }).catch(() => undefined);
          await callAction(state.parentCallControlId, 'hangup', { command_id: `${eventId}-end-client` }).catch(() => undefined);
        }
        return res.status(200).json({ received: true });
      }
      const pair = endedOutboundPair || await readOutboundCallPairByDestination(callControlId);
      if (pair?.status === 'direct') {
        const phase = payload?.hangup_cause === 'normal_clearing' ? 'ended' : 'failed';
        await saveOutboundCallPair({ ...pair, phase, failureCause: payload?.hangup_cause, updatedAt: new Date().toISOString() });
        if (pair.routeId) await updateVoiceRoute(pair.routeId, { phase, failureCause: payload?.hangup_cause });
        await callAction(pair.clientCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-ringback` }).catch(() => undefined);
        await callAction(pair.clientCallControlId, 'hangup', { command_id: `${eventId}-end-client` }).catch(() => undefined);
        await clearOutboundCallPair(pair).catch(() => undefined);
      } else if (!pair && state?.routeId) {
        const phase = payload?.hangup_cause === 'normal_clearing' ? 'ended' : 'failed';
        await updateVoiceRoute(state.routeId, { phase, failureCause: payload?.hangup_cause });
        if (state.parentCallControlId) {
          await callAction(state.parentCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-ringback` }).catch(() => undefined);
          await callAction(state.parentCallControlId, 'hangup', { command_id: `${eventId}-end-client` }).catch(() => undefined);
        }
      }
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.hangup' && payload?.connection_id === requiredEnv('TELNYX_CONNECTION_ID')) {
      const pair = await readOutboundCallPairByClient(callControlId);
      if (!pair) return res.status(200).json({ received: true });
      if (pair.status === 'direct') {
        if (pair.routeId) await updateVoiceRoute(pair.routeId, { phase: 'ended', failureCause: payload?.hangup_cause });
        await callAction(pair.destinationCallControlId, 'hangup', { command_id: `${eventId}-end-destination` }).catch(() => undefined);
        await clearOutboundCallPair(pair).catch(() => undefined);
      } else if (pair.status === 'conference' && pair.conferenceRole === 'host') {
        await Promise.all([pair.destinationCallControlId, pair.peerDestinationCallControlId]
          .filter((id): id is string => Boolean(id))
          .map((id) => callAction(id, 'hangup', { command_id: `${eventId}-end-${id.slice(-8)}` }).catch(() => undefined)));
        const peer = pair.peerClientCallControlId ? await readOutboundCallPairByClient(pair.peerClientCallControlId) : null;
        await Promise.all([clearOutboundCallPair(pair), ...(peer ? [clearOutboundCallPair(peer)] : [])]).catch(() => undefined);
      }
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.answered' && (state?.flow === 'agent' || state?.flow === 'queue_agent') && state.parentCallControlId) {
      const targetExtensionId = await extensionForAgentState(state, payload?.to);
      await callAction(state.parentCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-waiting` }).catch(() => undefined);
      if (targetExtensionId) {
        background('active agent route', saveActiveCallRoute({ extensionId: targetExtensionId, parentCallControlId: state.parentCallControlId, agentCallControlId: callControlId, updatedAt: new Date().toISOString() }));
      }
    }
    if (eventType === 'call.hangup' && (state?.flow === 'agent' || state?.flow === 'queue_agent')) {
      const targetExtensionId = await extensionForAgentState(state, payload?.to);
      if (targetExtensionId) await clearActiveCallRoute(targetExtensionId);
    }

    if (eventType === 'call.hangup' && state?.flow === 'agent' && state.parentCallControlId) {
      const cause = (payload?.hangup_cause || '').toLowerCase();
      if (isUnansweredAgentCause(cause)) {
        await callAction(state.parentCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-waiting` }).catch(() => undefined);
        await routeAfterAgentFailure(state, cause, eventId);
      }
    }

    if (eventType === 'call.enqueued' && state?.flow === 'queue_wait' && state.queueName && state.organizationId && state.targetExtensionIds?.length) {
      const queue = await readQueueCall(state.queueName);
      if (!queue || queue.status !== 'waiting') return res.status(200).json({ received: true });
      const [config, extensions] = await Promise.all([readBusinessVoiceConfig(state.organizationId), listExtensions(state.organizationId)]);
      const members = extensions.filter((extension) => state.targetExtensionIds?.includes(extension.id) && extension.status === 'active' && extension.sipUsername);
      if (!members.length) {
        await clearQueueCall(state.queueName);
        await callAction(callControlId, 'leave_queue', { command_id: `${eventId}-empty-queue` }).catch(() => undefined);
        await routeUnavailable(callControlId, state.organizationId, eventId, state.callerNumber, state.callerName);
        return res.status(200).json({ received: true });
      }
      await saveQueueCall({ ...queue, status: 'dialing', updatedAt: new Date().toISOString() });
      await speakPrompt(callControlId, { payload: config.waitingMessage, voice: config.voice, command_id: `${eventId}-queue-waiting` }).catch(() => undefined);
      const agentCall = await dialCall({
        to: members.map((member) => `sip:${member.sipUsername}@sip.telnyx.com`),
        from: state.callerNumber && e164.test(state.callerNumber) ? state.callerNumber : undefined,
        fromDisplayName: queue.kind === 'queue' ? 'Queued business call' : 'Business group call',
        state: { flow: 'queue_agent', queueName: state.queueName, handlingId: state.handlingId, parentCallControlId: callControlId, organizationId: state.organizationId, targetExtensionIds: members.map((member) => member.id), callerNumber: state.callerNumber, callerName: state.callerName },
        timeoutSeconds: queue.kind === 'queue' ? 45 : Math.min(120, Math.max(10, pbxForOrganization(await readPbxConfig(), state.organizationId).callHandling.ringGroups.find((item) => item.id === queue.handlingId)?.timeout || 25)),
        commandId: `${eventId}-queue-agents`,
      });
      const agentCallControlId = agentCall.data?.call_control_id;
      await saveQueueCall({ ...queue, status: 'dialing', agentCallControlIds: agentCallControlId ? [agentCallControlId] : [], updatedAt: new Date().toISOString() });
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.answered' && state?.flow === 'queue_agent' && state.queueName && state.parentCallControlId) {
      const queue = await readQueueCall(state.queueName);
      if (!queue || queue.status === 'connected') {
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-duplicate-agent` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      await saveQueueCall({ ...queue, status: 'connected', updatedAt: new Date().toISOString() });
      try {
        await callAction(callControlId, 'bridge', { queue: state.queueName, command_id: `${eventId}-bridge-queue` });
      } catch (bridgeError) {
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-queue-bridge-failed` }).catch(() => undefined);
        throw bridgeError;
      }
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.dequeued' && state?.flow === 'queue_wait' && state.queueName && state.organizationId) {
      const queue = await readQueueCall(state.queueName);
      await clearQueueCall(state.queueName);
      if (!queue || queue.status === 'connected') return res.status(200).json({ received: true });
      await routeCallGroupFallback({ callControlId, eventId, organizationId: state.organizationId, handlingId: state.handlingId || '', kind: queue?.kind || 'queue', inboundNumber: state.inboundNumber, callerNumber: state.callerNumber, callerName: state.callerName });
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.hangup' && state?.flow === 'queue_wait' && state.queueName) {
      const queue = await readQueueCall(state.queueName);
      await clearQueueCall(state.queueName);
      await Promise.all((queue?.agentCallControlIds || []).map((id) => callAction(id, 'hangup', { command_id: `${eventId}-end-agent-${id.slice(-8)}` }).catch(() => undefined)));
      return res.status(200).json({ received: true });
    }

    if (['call.speak.ended', 'call.playback.ended'].includes(eventType) && state?.flow === 'voicemail_prompt') {
      await callAction(callControlId, 'record_start', {
        format: 'mp3',
        channels: 'single',
        recording_track: 'inbound',
        play_beep: true,
        max_length: 120,
        timeout_secs: 6,
        trim: 'trim-silence',
        client_state: encodeVoiceState({ flow: 'voicemail_recording', callerNumber: state.callerNumber, callerName: state.callerName, organizationId: state.organizationId }),
        command_id: `${eventId}-voicemail-record`,
      });
    }

    if (['call.speak.ended', 'call.playback.ended'].includes(eventType) && state?.flow === 'unavailable_prompt') {
      await callAction(callControlId, 'hangup', { command_id: `${eventId}-unavailable-finish` }).catch(() => undefined);
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.recording.saved' && state?.flow === 'voicemail_recording') {
      const recordingId = payload?.recording_id || data?.id || eventId;
      const sourceUrl = payload?.recording_urls?.mp3 || payload?.public_recording_urls?.mp3;
      if (sourceUrl) {
        const recordingPath = await storeVoicemailAudio(recordingId, sourceUrl);
        const started = payload?.recording_started_at ? new Date(payload.recording_started_at).getTime() : 0;
        const ended = payload?.recording_ended_at ? new Date(payload.recording_ended_at).getTime() : 0;
        await storeVoicemail({
          id: recordingId,
          recordingId,
          callerNumber: state.callerNumber || payload?.from || 'Unknown caller',
          callerName: state.callerName,
          recordingPath,
          durationSeconds: started && ended ? Math.max(0, Math.round((ended - started) / 1000)) : undefined,
          createdAt: payload?.recording_ended_at || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          organizationId: state.organizationId || 'primary',
        });
      }
      await callAction(callControlId, 'hangup', { command_id: `${eventId}-voicemail-finish` }).catch(() => undefined);
    }

    if (eventType === 'call.initiated' && isInboundInitiated) {
      const inboundOrganizationId = await organizationForNumber(payload?.to || '');
      try {
        const access = await accessForOrganization(inboundOrganizationId);
        if (!access.features.phoneNumbers) throw new Error('Feature not enabled');
      } catch {
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-service-unavailable` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      await callAction(callControlId, 'answer', {
        client_state: encodeVoiceState({ flow: 'inbound_root', organizationId: inboundOrganizationId, inboundNumber: payload?.to, callerNumber: payload?.from, callerName: payload?.caller_id_name }),
        command_id: `${eventId}-answer`,
      });
    }

    if (eventType === 'call.answered' && state?.flow === 'conference_host') {
      const conferenceResponse = await telnyx('/conferences', {
        method: 'POST',
        body: JSON.stringify({ call_control_id: callControlId, name: state.room, beep_enabled: 'on_enter', max_participants: 6, comfort_noise: true, command_id: `${eventId}-conference` }),
      });
      const conferencePayload = await conferenceResponse.json() as { data?: { id?: string } };
      const conferenceId = conferencePayload.data?.id;
      if (conferenceId) {
        const participants = state.conferenceParticipants ?? (state.participants ?? []).map((destination) => ({ destination, displayName: destination, internal: false }));
        await Promise.all(participants.map((participant, index) => dialCall({
          to: participant.destination,
          from: state.callerId,
          state: { flow: 'conference_guest', room: state.room, conferenceId, callerId: state.callerId, organizationId: state.organizationId },
          fromDisplayName: participant.internal && state.sourceName
            ? callerDisplay(`${state.sourceName}${state.sourceExtension ? ` - Ext ${state.sourceExtension}` : ''}`)
            : 'Vocivo Conference',
          customHeaders: participant.internal ? [
            { name: 'X-Vocivo-Call-Type', value: 'internal' },
            ...(state.sourceName ? [{ name: 'X-Vocivo-Caller-Name', value: state.sourceName }] : []),
            ...(state.sourceExtension ? [{ name: 'X-Vocivo-Caller-Extension', value: state.sourceExtension }] : []),
            ...(state.organizationId ? [{ name: 'X-Vocivo-Organization-ID', value: state.organizationId }] : []),
          ] : undefined,
          commandId: `${eventId}-guest-${index}`,
        })));
      }
    }

    if (eventType === 'call.answered' && state?.flow === 'conference_guest' && state.conferenceId) {
      await telnyx(`/conferences/${encodeURIComponent(state.conferenceId)}/actions/join`, {
        method: 'POST',
        body: JSON.stringify({ call_control_id: callControlId, beep_enabled: 'on_enter', command_id: `${eventId}-join` }),
      });
    }

    if (isInboundAnswered) {
      const organizationId = state?.organizationId || await organizationForNumber(payload?.to || '');
      const inboundNumber = state?.inboundNumber || payload?.to || '';
      const callerNumber = state?.callerNumber || payload?.from;
      const callerName = state?.callerName || payload?.caller_id_name;
      const pbx = await readPbxConfig();
      const organizationPbx = pbxForOrganization(pbx, organizationId);
      const assignment = pbx.numberAssignments[normalizeE164(inboundNumber)];
      if (assignment?.organizationId === organizationId && assignment.destinationType === 'extension' && assignment.destinationId) {
        await routeToConfiguredTarget({ callControlId, eventId, organizationId, target: `extension:${assignment.destinationId}`, inboundNumber, callerNumber, callerName });
        return res.status(200).json({ received: true });
      }
      if (!officeHoursDecision(organizationPbx.officeHours).open) {
        await routeUnavailable(callControlId, organizationId, eventId, callerNumber, callerName);
        return res.status(200).json({ received: true });
      }
      if (assignment?.organizationId === organizationId && (assignment.destinationType === 'ring_group' || assignment.destinationType === 'queue') && assignment.destinationId) {
        await routeToCallGroup({ callControlId, eventId, organizationId, handlingId: assignment.destinationId, kind: assignment.destinationType, inboundNumber, callerNumber, callerName });
        return res.status(200).json({ received: true });
      }
      if (assignment?.organizationId === organizationId && assignment.destinationType === 'ivr' && assignment.destinationId) {
        await routeToConfiguredIvr({ callControlId, eventId, organizationId, handlingId: assignment.destinationId, inboundNumber, callerNumber, callerName });
        return res.status(200).json({ received: true });
      }
      if (organizationPbx.ai.enabled && organizationPbx.ai.assistantId) {
        try {
          await callAction(callControlId, 'ai_assistant_start', { assistant: { id: organizationPbx.ai.assistantId }, command_id: `${eventId}-ai` });
          return res.status(200).json({ received: true });
        } catch (aiError) {
          console.error('Vocivo AI receptionist could not start; using configured voice fallback', publicError(aiError));
        }
      }
      const config = await readBusinessVoiceConfig(organizationId);
      if (!config.enabled) {
        await routeToAvailableAgent({ callControlId, department: config.companyName, eventId, organizationId, inboundNumber, callerNumber, callerName, preferMain: true });
      } else {
        const hasExtensions = (await listExtensions(organizationId)).length > 0;
        const options = config.departments.map((department, index) => `For ${department}, press ${index + 1}.`).join(' ');
        const validDigits = `${config.departments.map((_, index) => String(index + 1)).join('')}${hasExtensions ? '9' : ''}`;
        const prompt = `${config.greeting} ${options}${hasExtensions ? ' If you know your party extension, press 9.' : ''}`;
        await gatherPrompt(callControlId, {
          payload: prompt,
          invalid_payload: `That selection was not recognized. Please press one of these options: ${validDigits.split('').join(', ')}.`,
          voice: config.voice,
          minimum_digits: 1,
          maximum_digits: 1,
          valid_digits: validDigits,
          maximum_tries: 2,
          timeout_millis: 10000,
          client_state: encodeVoiceState({ flow: 'ivr', callerNumber, callerName, organizationId, inboundNumber }),
          command_id: `${eventId}-ivr`,
        });
      }
    }

    if (eventType === 'call.gather.ended' && state?.flow === 'ivr') {
      const config = await readBusinessVoiceConfig(state.organizationId);
      const digit = Number(payload?.digits || payload?.result || '1');
      if (digit === 9 && (await listExtensions(state.organizationId)).length) {
        await gatherPrompt(callControlId, {
          payload: 'Please enter the extension number now.',
          invalid_payload: 'That extension was not recognized.',
          voice: config.voice,
          minimum_digits: 2,
          maximum_digits: 5,
          timeout_millis: 8000,
          client_state: encodeVoiceState({ flow: 'extension', callerNumber: state.callerNumber, callerName: state.callerName, organizationId: state.organizationId, inboundNumber: state.inboundNumber }),
          command_id: `${eventId}-extension`,
        });
        return res.status(200).json({ received: true });
      }
      const department = config.departments[digit - 1] || config.departments[0];
      await routeToAvailableAgent({ callControlId, department, eventId, organizationId: state.organizationId || 'primary', inboundNumber: state.inboundNumber || '', callerNumber: state.callerNumber, callerName: state.callerName });
    }

    if (eventType === 'call.gather.ended' && state?.flow === 'extension') {
      const config = await readBusinessVoiceConfig(state.organizationId);
      const extensionNumber = String(payload?.digits || payload?.result || '').replace(/\D/g, '');
      const extension = await findExtension(extensionNumber, state.organizationId);
      if (extension) {
        await routeToExtension({ callControlId, eventId, organizationId: state.organizationId || 'primary', inboundNumber: state.inboundNumber || '', extension, callerNumber: state.callerNumber, callerName: state.callerName });
      } else {
        await speakPrompt(callControlId, { payload: 'That extension is not available. We will connect you to the main line.', voice: config.voice, command_id: `${eventId}-extension-missing` });
        await routeToAvailableAgent({ callControlId, department: config.companyName, eventId, organizationId: state.organizationId || 'primary', inboundNumber: state.inboundNumber || '', callerNumber: state.callerNumber, callerName: state.callerName });
      }
    }

    if (eventType === 'call.gather.ended' && state?.flow === 'configured_ivr' && state.handlingId && state.organizationId) {
      const pbx = pbxForOrganization(await readPbxConfig(), state.organizationId);
      const ivr = pbx.callHandling.ivrs.find((item) => item.id === state.handlingId);
      const digit = String(payload?.digits || payload?.result || '').replace(/\D/g, '').slice(0, 1);
      const target = ivr?.options[digit];
      if (target) {
        await routeToConfiguredTarget({ callControlId, eventId, organizationId: state.organizationId, target, inboundNumber: state.inboundNumber, callerNumber: state.callerNumber, callerName: state.callerName });
      } else {
        await routeUnavailable(callControlId, state.organizationId, eventId, state.callerNumber, state.callerName);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    if (error instanceof TelnyxApiError && error.code === '90018') {
      return res.status(200).json({ received: true, ignored: 'call_ended' });
    }
    console.error('Vocivo voice webhook failed', error);
    return res.status(500).json({ error: publicError(error) });
  }
}
