import webpush from 'web-push';
import { deleteWebPushSubscription, listWebPushSubscriptions } from './web-push-store.js';

let configured = false;

function configureWebPush() {
  if (configured) return true;
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.WEB_PUSH_SUBJECT?.trim() || 'mailto:security@vocivo.com';
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export async function sendIncomingCallWebPush(input: {
  organizationId: string;
  extensionIds: string[];
  callerName?: string;
  callId: string;
}) {
  if (!configureWebPush()) return { sent: 0, unavailable: true };
  const extensionIds = [...new Set(input.extensionIds.filter(Boolean))];
  const records = (await Promise.all(extensionIds.map((extensionId) => listWebPushSubscriptions(input.organizationId, extensionId)))).flat();
  let sent = 0;
  await Promise.allSettled(records.map(async (record) => {
    try {
      await webpush.sendNotification({ endpoint: record.endpoint, expirationTime: record.expirationTime, keys: record.keys }, JSON.stringify({
        type: 'vocivo.incoming_call',
        title: input.callerName ? `Call from ${input.callerName}` : 'Incoming Vocivo call',
        body: 'Open Vocivo to answer this call.',
        tag: `vocivo-call-${input.callId}`,
        url: '/?incoming=1',
      }), { TTL: 45, urgency: 'high', topic: `call-${input.callId.slice(-24)}` });
      sent += 1;
    } catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deleteWebPushSubscription(record);
        return;
      }
      throw error;
    }
  }));
  return { sent, unavailable: false };
}
