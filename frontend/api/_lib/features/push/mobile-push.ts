/**
 * Pure helpers for waking a mobile device when a call arrives on the SIP edge.
 *
 * Vocivo is a mobile PBX: the owner is usually away from a desk with the app
 * killed or backgrounded, so the ring depends entirely on a push arriving and
 * the device registering before Kamailio gives up. Everything here is
 * side-effect free so the payloads and the token-pruning rules can be tested
 * without touching APNs or FCM.
 */

export type MobilePushTarget = {
  platform: 'ios' | 'android';
  token: string;
  environment: 'production' | 'sandbox';
  extensionId: string;
  organizationId: string;
};

export type IncomingCallPush = {
  callId: string;
  sipUsername: string;
  callerName?: string;
  callerNumber?: string;
  /** Seconds the push is worth delivering for; past this the call is gone. */
  ttlSeconds: number;
};

/** iOS terminates an app that takes a VoIP push and does not report a call, so the payload must always be actionable. */
export function voipPayload(input: IncomingCallPush, now = Date.now()) {
  return {
    vocivo: {
      callId: input.callId,
      sipUsername: input.sipUsername,
      callerName: input.callerName || 'Incoming call',
      callerNumber: input.callerNumber || '',
      expiresAt: new Date(now + input.ttlSeconds * 1000).toISOString(),
    },
  };
}

/**
 * FCM data messages are string-valued only. A high-priority data message is
 * what wakes a Doze-ing device; a notification message would not.
 */
export function fcmMessage(token: string, input: IncomingCallPush, now = Date.now()) {
  const payload = voipPayload(input, now).vocivo;
  return {
    message: {
      token,
      android: {
        priority: 'HIGH' as const,
        ttl: `${input.ttlSeconds}s`,
        direct_boot_ok: true,
      },
      data: {
        type: 'vocivo.incoming_call',
        callId: payload.callId,
        sipUsername: payload.sipUsername,
        callerName: payload.callerName,
        callerNumber: payload.callerNumber,
        expiresAt: payload.expiresAt,
      },
    },
  };
}

/** PushKit listens on a dedicated topic, not the app's bundle id. */
export function voipTopic(bundleId: string) {
  const trimmed = bundleId.trim().replace(/\.voip$/i, '');
  if (!trimmed) throw new Error('An APNs topic (bundle id) is required.');
  return `${trimmed}.voip`;
}

export function apnsHost(environment: 'production' | 'sandbox') {
  return environment === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
}

/**
 * Whether a failed send means the token is dead and should be removed, rather
 * than a transient error worth keeping the device for. Mirrors the 404/410
 * handling in web-push-dispatcher.
 */
export function apnsTokenIsDead(status: number, reason?: string) {
  if (status === 410) return true;
  if (status !== 400) return false;
  return reason === 'BadDeviceToken' || reason === 'DeviceTokenNotForTopic' || reason === 'Unregistered';
}

export function fcmTokenIsDead(status: number, body?: { error?: { status?: string; details?: unknown[] } }) {
  if (status === 404) return true;
  if (status !== 400 && status !== 403) return false;
  const errorStatus = body?.error?.status;
  if (errorStatus === 'NOT_FOUND' || errorStatus === 'UNREGISTERED') return true;
  const details = Array.isArray(body?.error?.details) ? body!.error!.details! : [];
  return details.some((detail) => {
    const code = (detail as { errorCode?: string })?.errorCode;
    return code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT';
  });
}

export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; topic: string };

/**
 * The auth key arrives through an env var, so it may carry literal "\n"
 * instead of newlines. PKCS8 parsing fails silently-looking ways otherwise.
 */
export function normalizePrivateKey(value: string) {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

export function apnsConfig(env: NodeJS.ProcessEnv = process.env): ApnsConfig | null {
  const keyId = env.APNS_KEY_ID?.trim();
  const teamId = env.APNS_TEAM_ID?.trim();
  const privateKey = env.APNS_AUTH_KEY?.trim();
  const topic = env.APNS_TOPIC?.trim();
  if (!keyId || !teamId || !privateKey || !topic) return null;
  return { keyId, teamId, privateKey: normalizePrivateKey(privateKey), topic };
}

export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };

export function fcmConfig(env: NodeJS.ProcessEnv = process.env): FcmConfig | null {
  const raw = env.FCM_SERVICE_ACCOUNT?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { project_id?: string; client_email?: string; private_key?: string };
      if (parsed.project_id && parsed.client_email && parsed.private_key) {
        return { projectId: parsed.project_id, clientEmail: parsed.client_email, privateKey: normalizePrivateKey(parsed.private_key) };
      }
    } catch {
      // fall through to the discrete variables below
    }
  }
  const projectId = env.FCM_PROJECT_ID?.trim();
  const clientEmail = env.FCM_CLIENT_EMAIL?.trim();
  const privateKey = env.FCM_PRIVATE_KEY?.trim();
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey: normalizePrivateKey(privateKey) };
}
