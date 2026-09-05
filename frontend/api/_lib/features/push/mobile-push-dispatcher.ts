import { connect, constants, type ClientHttp2Session } from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';
import { deletePushDevice, listPushDevices, type PushDevice } from './push-device-store.js';
import {
  apnsConfig,
  apnsHost,
  apnsTokenIsDead,
  fcmConfig,
  fcmMessage,
  fcmTokenIsDead,
  voipPayload,
  voipTopic,
  type IncomingCallPush,
} from './mobile-push.js';

/**
 * Wakes the phones registered to an extension when the SIP edge has a call for
 * it and no contact is registered. Kamailio holds the INVITE for a single 8 s
 * window, so this must be fast and must never throw into the edge's request.
 */

const APNS_JWT_TTL_MS = 20 * 60 * 1000; // Apple rejects tokens refreshed more often than every 20 minutes.
const GOOGLE_TOKEN_SKEW_MS = 60 * 1000;

let apnsJwtCache: { token: string; expiresAt: number } | null = null;
let googleTokenCache: { token: string; expiresAt: number } | null = null;

async function apnsJwt() {
  const config = apnsConfig();
  if (!config) return null;
  if (apnsJwtCache && apnsJwtCache.expiresAt > Date.now()) return { token: apnsJwtCache.token, config };
  const key = await importPKCS8(config.privateKey, 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt()
    .sign(key);
  apnsJwtCache = { token, expiresAt: Date.now() + APNS_JWT_TTL_MS };
  return { token, config };
}

async function googleAccessToken() {
  const config = fcmConfig();
  if (!config) return null;
  if (googleTokenCache && googleTokenCache.expiresAt > Date.now()) return { token: googleTokenCache.token, config };
  const key = await importPKCS8(config.privateKey, 'RS256');
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(config.clientEmail)
    .setSubject(config.clientEmail)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!response.ok) throw new Error(`Google token exchange failed with ${response.status}`);
  const body = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error('Google token exchange returned no access token.');
  googleTokenCache = { token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 - GOOGLE_TOKEN_SKEW_MS };
  return { token: body.access_token, config };
}

type SendOutcome = { ok: boolean; dead: boolean; detail?: string };

/** APNs is HTTP/2 only; one session is opened per environment and closed after the batch. */
async function sendApns(session: ClientHttp2Session, jwt: string, topic: string, token: string, payload: unknown, ttlSeconds: number) {
  return new Promise<SendOutcome>((resolve) => {
    const body = Buffer.from(JSON.stringify(payload));
    const request = session.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + ttlSeconds),
      'content-type': 'application/json',
      'content-length': body.length,
    });
    let status = 0;
    const chunks: Buffer[] = [];
    request.setTimeout(5000, () => {
      request.close();
      resolve({ ok: false, dead: false, detail: 'timeout' });
    });
    request.on('response', (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS]) || 0;
    });
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('error', (error) => resolve({ ok: false, dead: false, detail: error.message }));
    request.on('end', () => {
      if (status === 200) return resolve({ ok: true, dead: false });
      let reason: string | undefined;
      try {
        reason = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { reason?: string }).reason;
      } catch {
        reason = undefined;
      }
      resolve({ ok: false, dead: apnsTokenIsDead(status, reason), detail: `${status} ${reason ?? ''}`.trim() });
    });
    request.end(body);
  });
}

async function sendFcm(accessToken: string, projectId: string, token: string, input: IncomingCallPush): Promise<SendOutcome> {
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(fcmMessage(token, input)),
    signal: AbortSignal.timeout(5000),
  });
  if (response.ok) return { ok: true, dead: false };
  let body: { error?: { status?: string; details?: unknown[]; message?: string } } | undefined;
  try {
    body = (await response.json()) as typeof body;
  } catch {
    body = undefined;
  }
  return { ok: false, dead: fcmTokenIsDead(response.status, body), detail: `${response.status} ${body?.error?.status ?? ''}`.trim() };
}

export type MobileWakeResult = {
  attempted: number;
  sent: number;
  pruned: number;
  unavailable: { ios: boolean; android: boolean };
  failures: string[];
};

/**
 * Pushes an incoming call to every registered device for the extensions given.
 * Never throws: a wake failure must not stop the edge from ringing whatever is
 * already registered.
 */
export async function wakeMobileDevices(input: {
  targets: Array<Pick<PushDevice, 'organizationId' | 'extensionId'>>;
  call: IncomingCallPush;
}): Promise<MobileWakeResult> {
  const result: MobileWakeResult = { attempted: 0, sent: 0, pruned: 0, unavailable: { ios: false, android: false }, failures: [] };
  const seen = new Set<string>();
  const pairs = input.targets.filter((target) => {
    const key = `${target.organizationId}:${target.extensionId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const devices = (await Promise.all(pairs.map((pair) => listPushDevices(pair.organizationId, pair.extensionId)))).flat();
  if (!devices.length) return result;

  const ios = devices.filter((device) => device.platform === 'ios');
  const android = devices.filter((device) => device.platform === 'android');
  const prune = async (device: PushDevice) => {
    result.pruned += 1;
    try {
      await deletePushDevice(device);
    } catch (error) {
      console.error('Vocivo mobile push: could not prune dead token', { id: device.id, error });
    }
  };

  if (ios.length) {
    const auth = await apnsJwt().catch((error) => {
      result.failures.push(`apns-jwt: ${(error as Error).message}`);
      return null;
    });
    if (!auth) {
      result.unavailable.ios = true;
    } else {
      const topic = voipTopic(auth.config.topic);
      const byEnvironment = new Map<'production' | 'sandbox', PushDevice[]>();
      ios.forEach((device) => {
        const list = byEnvironment.get(device.environment) ?? [];
        list.push(device);
        byEnvironment.set(device.environment, list);
      });
      for (const [environment, group] of byEnvironment) {
        const session = connect(apnsHost(environment));
        session.on('error', (error) => result.failures.push(`apns-session: ${error.message}`));
        try {
          const payload = voipPayload(input.call);
          const outcomes = await Promise.all(group.map(async (device) => {
            result.attempted += 1;
            return { device, outcome: await sendApns(session, auth.token, topic, device.token, payload, input.call.ttlSeconds) };
          }));
          for (const { device, outcome } of outcomes) {
            if (outcome.ok) result.sent += 1;
            else if (outcome.dead) await prune(device);
            else result.failures.push(`apns ${environment}: ${outcome.detail ?? 'failed'}`);
          }
        } finally {
          session.close();
        }
      }
    }
  }

  if (android.length) {
    const auth = await googleAccessToken().catch((error) => {
      result.failures.push(`fcm-token: ${(error as Error).message}`);
      return null;
    });
    if (!auth) {
      result.unavailable.android = true;
    } else {
      const outcomes = await Promise.all(android.map(async (device) => {
        result.attempted += 1;
        try {
          return { device, outcome: await sendFcm(auth.token, auth.config.projectId, device.token, input.call) };
        } catch (error) {
          return { device, outcome: { ok: false, dead: false, detail: (error as Error).message } as SendOutcome };
        }
      }));
      for (const { device, outcome } of outcomes) {
        if (outcome.ok) result.sent += 1;
        else if (outcome.dead) await prune(device);
        else result.failures.push(`fcm: ${outcome.detail ?? 'failed'}`);
      }
    }
  }

  if (result.failures.length) console.error('Vocivo mobile push failures', result.failures);
  return result;
}

/** Exposed so tests can reset the module-level token caches. */
export function resetMobilePushCaches() {
  apnsJwtCache = null;
  googleTokenCache = null;
}
