import { randomUUID } from 'node:crypto';
import { parseInternalSipUser } from './internal-sip.js';
import { listExtensions } from './pbx.js';
import { listPushDevices } from './push-device-store.js';
import { sendIncomingCallWebPush } from './web-push-dispatcher.js';
import { apnsConfigured, sendApnsVoip, vocivoSipPushPayload } from './apns-voip.js';
import { saveWakeupCall } from './sip-wakeup-store.js';
import { publicError } from './http.js';
import { voiceEdge } from './voice-provider.js';

export async function ringSipEdgeDevices(input: { username: string; callId: string; callerName: string; from: string }) {
  try {
    const directory = await listExtensions();
    const matches = directory.filter((item) => item.status === 'active' && item.sipUsername === input.username);
    const extensionIds = matches.map((item) => item.id);
    const organizationIds = [...new Set(matches.map((item) => item.organizationId))];
    const web = await Promise.all(organizationIds.map((organizationId) => sendIncomingCallWebPush({
      organizationId,
      extensionIds,
      callerName: input.callerName || input.from,
      callId: input.callId,
    }).catch(() => ({ sent: 0 }))));
    const devices = (await Promise.all(matches.map((item) => listPushDevices(item.organizationId, item.id).catch(() => [])))).flat();
    const uuid = randomUUID();
    const payload = vocivoSipPushPayload({
      uuid,
      callId: input.callId,
      from: input.from,
      callerName: input.callerName,
      username: input.username,
    });
    const ios = devices.filter((device) => device.platform === 'ios');
    const voip = await Promise.all(ios.map((device) => sendApnsVoip({
      token: device.token,
      environment: device.environment,
      payload,
    }).catch(() => ({ sent: false as const }))));
    await saveWakeupCall({
      sipCallId: input.callId,
      uuid,
      username: input.username,
      devices: devices.map((device) => ({ token: device.token, environment: device.environment, platform: device.platform })),
      createdAt: new Date().toISOString(),
    }).catch(() => undefined);
    return {
      ok: true,
      uuid,
      webPush: web.reduce((total, item) => total + item.sent, 0),
      voipPush: voip.filter((item) => item.sent).length,
      devices: devices.map((device) => ({
        platform: device.platform,
        environment: device.environment,
        extensionId: device.extensionId,
        organizationId: device.organizationId,
      })),
      apnsConfigured: apnsConfigured(),
    };
  } catch (error) {
    console.error('Vocivo SIP ring failed', publicError(error));
    return {
      ok: false,
      uuid: randomUUID(),
      webPush: 0,
      voipPush: 0,
      devices: [],
      apnsConfigured: apnsConfigured(),
    };
  }
}

export async function wakeupSipDestinations(input: {
  destinations: string | string[];
  callId: string;
  callerName?: string;
  from?: string;
}) {
  if (voiceEdge() !== 'sip') return [];
  const uris = Array.isArray(input.destinations) ? input.destinations : [input.destinations];
  const usernames = [...new Set(uris.map((uri) => parseInternalSipUser(uri)).filter((value): value is string => Boolean(value)))];
  return Promise.all(usernames.map((username) => ringSipEdgeDevices({
    username,
    callId: input.callId,
    callerName: input.callerName || '',
    from: input.from || '',
  })));
}
