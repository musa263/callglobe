import { requiredEnv } from './http.js';
import { telnyx } from './telnyx.js';

export type VoiceState = {
  flow: 'conference_host' | 'conference_guest' | 'outbound_destination' | 'api_outbound' | 'ivr' | 'configured_ivr' | 'extension' | 'agent' | 'queue_wait' | 'queue_agent' | 'voicemail_prompt' | 'voicemail_recording' | 'unavailable_prompt';
  room?: string;
  conferenceId?: string;
  participants?: string[];
  department?: string;
  parentCallControlId?: string;
  targetExtensionId?: string;
  targetExtensionIds?: string[];
  callerNumber?: string;
  callerName?: string;
  organizationId?: string;
  routeId?: string;
  inboundNumber?: string;
  callerId?: string;
  handlingId?: string;
  queueName?: string;
  voicemailEnabled?: boolean;
  forwardBusy?: string;
  forwardNoAnswer?: string;
  forwardUnavailable?: string;
  forwardingDepth?: number;
};

export function encodeVoiceState(state: VoiceState) {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

export function decodeVoiceState(value: unknown): VoiceState | null {
  if (typeof value !== 'string' || !value) return null;
  try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as VoiceState; } catch { return null; }
}

export async function dialCall(input: { to: string | string[]; state: VoiceState; from?: string; fromDisplayName?: string; customHeaders?: Array<{ name: string; value: string }>; linkTo?: string; commandId?: string; timeoutSeconds?: number }) {
  const response = await telnyx('/calls', {
    method: 'POST',
    body: JSON.stringify({
      connection_id: requiredEnv('TELNYX_CALL_CONTROL_APP_ID'),
      from: input.from || requiredEnv('TELNYX_SMS_FROM'),
      to: input.to,
      from_display_name: input.fromDisplayName || 'Vocivo',
      ...(input.customHeaders?.length ? { custom_headers: input.customHeaders } : {}),
      client_state: encodeVoiceState(input.state),
      timeout_secs: input.timeoutSeconds ?? 45,
      ...(input.linkTo ? { link_to: input.linkTo, bridge_on_answer: true, prevent_double_bridge: true } : {}),
      ...(input.commandId ? { command_id: input.commandId } : {}),
    }),
  });
  return await response.json() as { data?: { call_control_id?: string; call_leg_id?: string } };
}

export function callAction(callControlId: string, action: string, body: Record<string, unknown> = {}) {
  return telnyx(`/calls/${encodeURIComponent(callControlId)}/actions/${action}`, { method: 'POST', body: JSON.stringify(body) });
}
