function text(value, maximum = 160) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
}

function first(event, ...names) {
  for (const name of names) {
    const value = text(event[name]);
    if (value) return value;
  }
  return '';
}

function phaseFor(eventName) {
  if (eventName === 'CHANNEL_CREATE') return 'created';
  if (eventName === 'CHANNEL_PROGRESS' || eventName === 'CHANNEL_PROGRESS_MEDIA') return 'ringing';
  if (eventName === 'CHANNEL_ANSWER') return 'answered';
  if (eventName === 'CHANNEL_HANGUP_COMPLETE') return 'ended';
  if (eventName === 'DTMF') return 'dtmf';
  if (eventName === 'CUSTOM') return 'custom';
  return 'unknown';
}

export function normalizeEslEvent(event) {
  const eventName = first(event, 'Event-Name', 'event_name').toUpperCase();
  const callId = first(event, 'variable_vocivo_call_id', 'variable_call_uuid', 'Channel-Call-UUID', 'Unique-ID');
  if (!eventName || !callId) return null;
  const targetExtension = first(event, 'variable_vocivo_push_target_extension', 'variable_dialed_extension');
  const callerNumber = first(event, 'variable_vocivo_caller_number', 'Caller-Caller-ID-Number', 'variable_effective_caller_id_number');
  const callerName = first(event, 'variable_vocivo_caller_name', 'Caller-Caller-ID-Name', 'variable_effective_caller_id_name') || callerNumber || 'Unknown caller';
  const destination = first(event, 'Caller-Destination-Number', 'variable_sip_to_user');
  return {
    schema: 'vocivo.call-event.v1',
    eventId: first(event, 'Event-UUID') || `${callId}:${eventName}:${first(event, 'Event-Date-Timestamp')}`,
    eventName,
    phase: phaseFor(eventName),
    occurredAt: first(event, 'Event-Date-GMT') || new Date().toUTCString(),
    callId,
    legId: first(event, 'Unique-ID'),
    otherLegId: first(event, 'Other-Leg-Unique-ID'),
    sessionId: first(event, 'variable_sip_call_id', 'Channel-Call-UUID') || callId,
    direction: first(event, 'Call-Direction').toLowerCase() || 'unknown',
    callType: first(event, 'variable_vocivo_call_type') || 'voice',
    organizationId: first(event, 'variable_vocivo_organization_id') || 'primary',
    organizationName: first(event, 'variable_vocivo_organization_name') || 'Vocivo customer',
    targetExtension,
    destination,
    caller: {
      name: callerName,
      number: callerNumber,
      extension: first(event, 'variable_vocivo_caller_extension'),
      photoUrl: first(event, 'variable_vocivo_caller_photo', 'variable_sip_h_X-Vocivo-Caller-Photo').slice(0, 1000),
    },
    video: first(event, 'variable_vocivo_has_video') === 'true',
    hangupCause: first(event, 'Hangup-Cause', 'variable_hangup_cause'),
    dtmfDigit: first(event, 'DTMF-Digit'),
  };
}

export function shouldPushIncomingCall(call) {
  return call.phase === 'created' && Boolean(call.targetExtension);
}
