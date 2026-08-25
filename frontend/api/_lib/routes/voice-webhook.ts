import type { VercelRequest, VercelResponse } from '@vercel/node';
import { methodNotAllowed, publicError, requiredEnv } from '../http.js';
import { readBusinessVoiceConfig } from '../number-config.js';
import { findExtension, listExtensions } from '../pbx.js';
import { telnyx } from '../telnyx.js';
import { callAction, decodeVoiceState, dialCall, encodeVoiceState } from '../voice-control.js';
import { clearActiveCallRoute, saveActiveCallRoute } from '../call-route-store.js';
import { readPbxConfig } from '../pbx-config-store.js';
import { storeVoicemail, storeVoicemailAudio } from '../voicemail-store.js';
import { clearOutboundCallPair, readOutboundCallPairByClient, readOutboundCallPairByDestination, saveOutboundCallPair } from '../outbound-call-store.js';
import { isInboundCallAnswered, isInboundCallInitiated } from '../voice-routing.js';
import { isVoiceRouteId } from '../voice-route-id.js';

type VoiceEvent = {
  data?: {
    id?: string;
    event_type?: string;
    payload?: {
      call_control_id?: string;
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
function customHeader(payload: VoicePayload | undefined, name: string) {
  const match = payload?.custom_headers?.find((header) => (header.name || header.header_name || '').toLowerCase() === name.toLowerCase());
  return (match?.value || match?.header_value || '').trim();
}

async function routeToAgent(callControlId: string, department: string, waitingMessage: string, voice: string, eventId: string, destination = requiredEnv('TELNYX_SIP_URI'), targetExtensionId?: string, timeoutSeconds = 45, callerNumber?: string, callerName?: string) {
  await callAction(callControlId, 'speak', { payload: waitingMessage, voice, payload_type: 'text', command_id: `${eventId}-wait` });
  await dialCall({
    to: destination,
    state: { flow: 'agent', department, parentCallControlId: callControlId, targetExtensionId, callerNumber, callerName },
    fromDisplayName: `${department} call`,
    linkTo: callControlId,
    commandId: `${eventId}-agent`,
    timeoutSeconds,
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);
  if (req.query.token !== requiredEnv('VOICE_WEBHOOK_SECRET')) return res.status(401).json({ error: 'Unauthorized' });
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
    const routeInput = {
      connectionId: payload?.connection_id,
      callControlApplicationId: requiredEnv('TELNYX_CALL_CONTROL_APP_ID'),
      to: payload?.to,
      inboundNumber: requiredEnv('TELNYX_SMS_FROM'),
      hasManagedState: Boolean(state),
    };
    const outboundPair = eventType === 'call.answered' ? await readOutboundCallPairByDestination(callControlId) : null;
    const isInboundInitiated = isInboundCallInitiated({ ...routeInput, direction: payload?.direction });
    const isInboundAnswered = eventType === 'call.answered'
      && isInboundCallAnswered({ ...routeInput, hasOutboundPair: Boolean(outboundPair) });
    const isParkedVocivoClient = payload?.connection_id === requiredEnv('TELNYX_CONNECTION_ID')
      && payload?.direction === 'outgoing'
      && ['outbound', 'internal'].includes(parkedFlow);

    if (eventType === 'call.initiated' && isParkedVocivoClient && payload?.state === 'parked') {
      const destination = customHeader(payload, 'X-Vocivo-Destination') || payload.to || '';
      const selectedCallerId = customHeader(payload, 'X-Vocivo-Caller-ID');
      const requestedRouteId = customHeader(payload, 'X-Vocivo-Route-ID');
      const routeId = isVoiceRouteId(requestedRouteId) ? requestedRouteId : undefined;
      if (!e164.test(destination) && !internalSip.test(destination)) {
        await callAction(callControlId, 'hangup', { command_id: `${eventId}-invalid-destination` }).catch(() => undefined);
        return res.status(200).json({ received: true });
      }
      const destinationCall = await dialCall({
        to: destination,
        from: e164.test(selectedCallerId) ? selectedCallerId : undefined,
        state: { flow: 'outbound_destination', parentCallControlId: callControlId },
        fromDisplayName: payload.caller_id_name || 'Vocivo',
        commandId: `${eventId}-destination`,
      });
      const destinationCallControlId = destinationCall.data?.call_control_id;
      if (!destinationCallControlId) throw new Error('Telnyx did not return the destination call leg.');
      await saveOutboundCallPair({
        clientCallControlId: callControlId,
        destinationCallControlId,
        routeId,
        destination,
        status: 'direct',
        updatedAt: new Date().toISOString(),
      });
      const appUrl = requiredEnv('VITE_APP_URL').replace(/\/+$/, '');
      await callAction(callControlId, 'playback_start', {
        audio_url: `${appUrl}/audio/ringback.wav`,
        loop: 'infinity',
        command_id: `${eventId}-ringback`,
      }).catch((error) => console.warn('Vocivo could not start ringback audio', publicError(error)));
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.answered' && (state?.flow === 'outbound_destination' || outboundPair)) {
      const parentCallControlId = state?.flow === 'outbound_destination' ? state.parentCallControlId : outboundPair?.clientCallControlId;
      if (parentCallControlId) {
        await callAction(parentCallControlId, 'playback_stop', {
          stop: 'all',
          command_id: `${eventId}-stop-ringback`,
        }).catch(() => undefined);
        await callAction(parentCallControlId, 'bridge', {
          call_control_id: callControlId,
          command_id: `${eventId}-bridge`,
        });
        return res.status(200).json({ received: true });
      }
    }

    if (eventType === 'call.hangup' && state?.flow === 'outbound_destination') {
      const pair = await readOutboundCallPairByDestination(callControlId);
      if (pair?.status === 'direct') {
        await callAction(pair.clientCallControlId, 'playback_stop', { stop: 'all', command_id: `${eventId}-stop-ringback` }).catch(() => undefined);
        await callAction(pair.clientCallControlId, 'hangup', { command_id: `${eventId}-end-client` }).catch(() => undefined);
        await clearOutboundCallPair(pair).catch(() => undefined);
      }
      return res.status(200).json({ received: true });
    }

    if (eventType === 'call.hangup' && payload?.connection_id === requiredEnv('TELNYX_CONNECTION_ID')) {
      const pair = await readOutboundCallPairByClient(callControlId);
      if (!pair) return res.status(200).json({ received: true });
      if (pair.status === 'direct') {
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

    if ((eventType === 'call.initiated' || eventType === 'call.answered') && state?.flow === 'agent' && state.targetExtensionId && state.parentCallControlId) {
      await saveActiveCallRoute({ extensionId: state.targetExtensionId, parentCallControlId: state.parentCallControlId, agentCallControlId: callControlId, updatedAt: new Date().toISOString() });
    }
    if (eventType === 'call.hangup' && state?.flow === 'agent' && state.targetExtensionId) await clearActiveCallRoute(state.targetExtensionId);

    if (eventType === 'call.hangup' && state?.flow === 'agent' && state.parentCallControlId) {
      const config = await readBusinessVoiceConfig();
      const cause = (payload?.hangup_cause || '').toLowerCase();
      const unanswered = ['timeout', 'no_answer', 'user_busy', 'call_rejected'].includes(cause);
      if (config.voicemailEnabled && unanswered && payload?.hangup_source !== 'caller') {
        await callAction(state.parentCallControlId, 'speak', {
          payload: config.voicemailGreeting,
          voice: config.voice,
          payload_type: 'text',
          client_state: encodeVoiceState({ flow: 'voicemail_prompt', callerNumber: state.callerNumber, callerName: state.callerName }),
          command_id: `${eventId}-voicemail-prompt`,
        });
      }
    }

    if (eventType === 'call.speak.ended' && state?.flow === 'voicemail_prompt') {
      await callAction(callControlId, 'record_start', {
        format: 'mp3',
        channels: 'single',
        recording_track: 'inbound',
        play_beep: true,
        max_length: 120,
        timeout_secs: 6,
        trim: 'trim-silence',
        client_state: encodeVoiceState({ flow: 'voicemail_recording', callerNumber: state.callerNumber, callerName: state.callerName }),
        command_id: `${eventId}-voicemail-record`,
      });
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
        });
      }
      await callAction(callControlId, 'hangup', { command_id: `${eventId}-voicemail-finish` }).catch(() => undefined);
    }

    if (eventType === 'call.initiated' && isInboundInitiated) {
      await callAction(callControlId, 'answer', { command_id: `${eventId}-answer` });
    }

    if (eventType === 'call.answered' && state?.flow === 'conference_host') {
      const conferenceResponse = await telnyx('/conferences', {
        method: 'POST',
        body: JSON.stringify({ call_control_id: callControlId, name: state.room, beep_enabled: 'on_enter', max_participants: 6, comfort_noise: true, command_id: `${eventId}-conference` }),
      });
      const conferencePayload = await conferenceResponse.json() as { data?: { id?: string } };
      const conferenceId = conferencePayload.data?.id;
      if (conferenceId) {
        await Promise.all((state.participants ?? []).map((participant, index) => dialCall({
          to: participant,
          state: { flow: 'conference_guest', room: state.room, conferenceId },
          fromDisplayName: 'Vocivo Conference',
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
      const pbx = await readPbxConfig();
      if (pbx.ai.enabled && pbx.ai.assistantId) {
        await callAction(callControlId, 'ai_assistant_start', { assistant: { id: pbx.ai.assistantId }, command_id: `${eventId}-ai` });
        return res.status(200).json({ received: true });
      }
      const config = await readBusinessVoiceConfig();
      if (!config.enabled) {
        await routeToAgent(callControlId, config.companyName, config.waitingMessage, config.voice, eventId, undefined, undefined, config.voicemailDelaySeconds, payload?.from, payload?.caller_id_name);
      } else {
        const hasExtensions = (await listExtensions()).length > 0;
        const options = config.departments.map((department, index) => `For ${department}, press ${index + 1}.`).join(' ');
        const validDigits = `${config.departments.map((_, index) => String(index + 1)).join('')}${hasExtensions ? '9' : ''}`;
        const prompt = `${config.greeting} ${options}${hasExtensions ? ' If you know your party extension, press 9.' : ''}`;
        await callAction(callControlId, 'gather_using_speak', {
          payload: prompt,
          invalid_payload: `That selection was not recognized. Please press one of these options: ${validDigits.split('').join(', ')}.`,
          voice: config.voice,
          payload_type: 'text',
          minimum_digits: 1,
          maximum_digits: 1,
          valid_digits: validDigits,
          maximum_tries: 2,
          timeout_millis: 10000,
          client_state: encodeVoiceState({ flow: 'ivr', callerNumber: payload?.from, callerName: payload?.caller_id_name }),
          command_id: `${eventId}-ivr`,
        });
      }
    }

    if (eventType === 'call.gather.ended' && state?.flow === 'ivr') {
      const config = await readBusinessVoiceConfig();
      const digit = Number(payload?.digits || payload?.result || '1');
      if (digit === 9 && (await listExtensions()).length) {
        await callAction(callControlId, 'gather_using_speak', {
          payload: 'Please enter the extension number now.',
          invalid_payload: 'That extension was not recognized.',
          voice: config.voice,
          payload_type: 'text',
          minimum_digits: 2,
          maximum_digits: 5,
          timeout_millis: 8000,
          client_state: encodeVoiceState({ flow: 'extension', callerNumber: state.callerNumber, callerName: state.callerName }),
          command_id: `${eventId}-extension`,
        });
        return res.status(200).json({ received: true });
      }
      const department = config.departments[digit - 1] || config.departments[0];
      await routeToAgent(callControlId, department, config.waitingMessage, config.voice, eventId, undefined, undefined, config.voicemailDelaySeconds, state.callerNumber, state.callerName);
    }

    if (eventType === 'call.gather.ended' && state?.flow === 'extension') {
      const config = await readBusinessVoiceConfig();
      const extensionNumber = String(payload?.digits || payload?.result || '').replace(/\D/g, '');
      const extension = await findExtension(extensionNumber);
      if (extension) {
        await routeToAgent(callControlId, `${extension.name}, extension ${extension.extension}`, config.waitingMessage, config.voice, eventId, `sip:${extension.sipUsername}@sip.telnyx.com`, extension.id, config.voicemailDelaySeconds, state.callerNumber, state.callerName);
      } else {
        await callAction(callControlId, 'speak', { payload: 'That extension is not available. We will connect you to the main line.', voice: config.voice, payload_type: 'text', command_id: `${eventId}-extension-missing` });
        await routeToAgent(callControlId, config.companyName, config.waitingMessage, config.voice, eventId, undefined, undefined, config.voicemailDelaySeconds, state.callerNumber, state.callerName);
      }
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Vocivo voice webhook failed', error);
    return res.status(500).json({ error: publicError(error) });
  }
}
