import { createHash } from 'node:crypto';

function clean(value, maximum = 160) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, maximum) : '';
}

function callKitUuid(value) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

export function buildIncomingCallEnvelope(call, { bundleId = 'app.vocivo.mobile' } = {}) {
  const callUUID = callKitUuid(call.callId);
  const callerName = clean(call.caller?.name) || 'Unknown caller';
  const callerNumber = clean(call.caller?.number || call.caller?.extension) || 'private';
  const organizationName = clean(call.organizationName) || 'Vocivo';
  const extension = clean(call.targetExtension, 12);
  const photoUrl = clean(call.caller?.photoUrl, 1000);
  const sentAt = new Date().toISOString();
  const common = {
    type: 'incoming_call',
    schema: 'vocivo.push.call.v1',
    callUUID,
    callId: clean(call.callId, 128),
    sessionId: clean(call.sessionId, 128),
    organizationId: clean(call.organizationId, 80),
    organizationName,
    extension,
    callerName,
    callerNumber,
    photoUrl,
    hasVideo: Boolean(call.video),
    sentAt,
  };
  const fcmData = Object.fromEntries(Object.entries(common).map(([key, value]) => [key, String(value)]));
  return {
    schema: 'vocivo.push-envelope.v1',
    event: 'incoming_call',
    call: common,
    apns: {
      headers: {
        'apns-push-type': 'voip',
        'apns-topic': `${bundleId}.voip`,
        'apns-priority': '10',
        'apns-expiration': '0',
        'apns-collapse-id': callUUID,
      },
      payload: {
        aps: { 'content-available': 1 },
        ...common,
      },
    },
    fcm: {
      message: {
        data: fcmData,
        android: {
          priority: 'high',
          ttl: '30s',
        },
      },
    },
  };
}
