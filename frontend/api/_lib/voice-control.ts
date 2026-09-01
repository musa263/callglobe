import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';

export type VoiceState = {
  flow: 'inbound_root' | 'conference_host' | 'conference_guest' | 'outbound_destination' | 'outbound_bridge_pending' | 'api_outbound' | 'ivr' | 'configured_ivr' | 'extension' | 'agent' | 'queue_wait' | 'queue_agent' | 'voicemail_prompt' | 'voicemail_recording' | 'unavailable_prompt';
  room?: string;
  conferenceId?: string;
  participants?: string[];
  conferenceParticipants?: Array<{
    destination: string;
    displayName: string;
    internal: boolean;
    extension?: string;
  }>;
  department?: string;
  parentCallControlId?: string;
  destinationCallControlId?: string;
  targetExtensionId?: string;
  targetExtensionIds?: string[];
  callerNumber?: string;
  callerName?: string;
  organizationId?: string;
  routeId?: string;
  sourceExtensionId?: string;
  sourceExtension?: string;
  sourceName?: string;
  sourcePhotoUrl?: string;
  destinationExtensionId?: string;
  destinationExtension?: string;
  destinationName?: string;
  inboundNumber?: string;
  callerId?: string;
  handlingId?: string;
  queueName?: string;
  voicemailEnabled?: boolean;
  forwardBusy?: string;
  forwardNoAnswer?: string;
  forwardUnavailable?: string;
  forwardingDepth?: number;
  bridgeOnAnswer?: boolean;
};

export function encodeVoiceState(state: VoiceState) {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeVoiceState(value: unknown): VoiceState | null {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as VoiceState; } catch { return null; }
}

export type DialCallLeg = {
  call_control_id?: string;
  call_leg_id?: string;
};

export type DialCallResponse = {
  data?: DialCallLeg | DialCallLeg[];
};

const e164 = /^\+[1-9]\d{6,14}$/;
let primaryVoiceNumberCache: { value: string; expiresAt: number } | null = null;

export async function primaryVoiceCallerId() {
  const configured = process.env.TELNYX_VOICE_FROM?.trim();
  if (configured && e164.test(configured)) return configured;
  const numberId = process.env.TELNYX_PHONE_NUMBER_ID?.trim();
  if (!numberId) throw new Error('Set TELNYX_VOICE_FROM to an E.164 caller identity for outbound PSTN.');
  if (primaryVoiceNumberCache && primaryVoiceNumberCache.expiresAt > Date.now()) return primaryVoiceNumberCache.value;
  const response = await telnyx(`/phone_numbers/${encodeURIComponent(numberId)}`);
  const payload = await response.json() as { data?: { phone_number?: string } };
  const value = payload.data?.phone_number?.trim() || '';
  if (!e164.test(value)) throw new Error('TELNYX_PHONE_NUMBER_ID is not a valid E.164 caller identity. Set TELNYX_VOICE_FROM instead.');
  primaryVoiceNumberCache = { value, expiresAt: Date.now() + 5 * 60 * 1000 };
  return value;
}

export function dialCallLegs(response: DialCallResponse) {
  if (!response.data) return [];
  return (Array.isArray(response.data) ? response.data : [response.data])
    .filter((leg): leg is DialCallLeg => Boolean(leg?.call_control_id));
}

export function dialCallBody(input: { to: string | string[]; state: VoiceState; from: string; fromDisplayName?: string; customHeaders?: Array<{ name: string; value: string }>; linkTo?: string; commandId?: string; timeoutSeconds?: number }) {
  const from = input.from?.trim();
  if (!from) throw new Error('An explicit server-resolved caller identity is required.');
  return {
    connection_id: requiredEnv('TELNYX_CALL_CONTROL_APP_ID'),
    from,
    to: input.to,
    from_display_name: input.fromDisplayName || 'Vocivo',
    ...(input.customHeaders?.length ? { custom_headers: input.customHeaders } : {}),
    client_state: encodeVoiceState(input.state),
    timeout_secs: input.timeoutSeconds ?? 45,
    ...(input.linkTo ? { link_to: input.linkTo, bridge_intent: true, bridge_on_answer: true, prevent_double_bridge: true } : {}),
    ...(input.commandId ? { command_id: input.commandId } : {}),
  };
}

export async function dialCall(input: { to: string | string[]; state: VoiceState; from: string; fromDisplayName?: string; customHeaders?: Array<{ name: string; value: string }>; linkTo?: string; commandId?: string; timeoutSeconds?: number }) {
  const response = await telnyx('/calls', {
    method: 'POST',
    body: JSON.stringify(dialCallBody(input)),
  });
  return await response.json() as DialCallResponse;
}

export function callAction(callControlId: string, action: string, body: Record<string, unknown> = {}) {
  return telnyx(`/calls/${encodeURIComponent(callControlId)}/actions/${action}`, { method: 'POST', body: JSON.stringify(body) });
}
