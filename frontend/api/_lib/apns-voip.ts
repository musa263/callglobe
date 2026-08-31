import http2 from 'node:http2';
import { importPKCS8, SignJWT } from 'jose';

export type ApnsEnvironment = 'production' | 'sandbox';

export type VocivoSipPushPayload = {
  vocivo: 'sip';
  uuid: string;
  callId: string;
  from?: string;
  callerName?: string;
  username?: string;
  cancelled?: '1';
};

let jwtCache = { token: '', expiresAt: 0 };

export function vocivoSipPushPayload(input: {
  uuid: string;
  callId: string;
  from?: string;
  callerName?: string;
  username?: string;
  cancelled?: boolean;
}): VocivoSipPushPayload {
  return {
    vocivo: 'sip',
    uuid: input.uuid,
    callId: input.callId,
    ...(input.from ? { from: input.from.slice(0, 80) } : {}),
    ...(input.callerName ? { callerName: input.callerName.slice(0, 80) } : {}),
    ...(input.username ? { username: input.username.slice(0, 80) } : {}),
    ...(input.cancelled ? { cancelled: '1' as const } : {}),
  };
}

export function isVocivoSipPush(value: unknown): value is VocivoSipPushPayload {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return record.vocivo === 'sip' && typeof record.uuid === 'string' && typeof record.callId === 'string';
}

export function apnsConfigured() {
  return Boolean(process.env.APNS_AUTH_KEY?.trim() && process.env.APNS_KEY_ID?.trim() && process.env.APNS_TEAM_ID?.trim());
}

function pemKey() {
  const raw = process.env.APNS_AUTH_KEY?.trim() || '';
  if (raw.includes('BEGIN PRIVATE KEY')) return raw.replace(/\\n/g, '\n');
  return `-----BEGIN PRIVATE KEY-----\n${raw.replace(/\\n/g, '\n')}\n-----END PRIVATE KEY-----`;
}

async function apnsJwt() {
  if (jwtCache.token && jwtCache.expiresAt > Date.now() + 60_000) return jwtCache.token;
  const key = await importPKCS8(pemKey(), 'ES256');
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APNS_KEY_ID!.trim() })
    .setIssuer(process.env.APNS_TEAM_ID!.trim())
    .setIssuedAt()
    .sign(key);
  jwtCache.token = token;
  jwtCache.expiresAt = Date.now() + 50 * 60 * 1000;
  return token;
}

function hostFor(environment: ApnsEnvironment) {
  return environment === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';
}

export async function sendApnsVoip(input: {
  token: string;
  environment: ApnsEnvironment;
  payload: VocivoSipPushPayload;
}) {
  if (!apnsConfigured()) return { sent: false, reason: 'not_configured' as const };
  const token = input.token.replace(/\s/g, '');
  if (!/^[0-9a-fA-F]{64,}$/.test(token)) return { sent: false, reason: 'invalid_token' as const };
  const topic = (process.env.APNS_TOPIC || 'app.vocivo.mobile.voip').trim();
  const jwt = await apnsJwt();
  const body = JSON.stringify(input.payload);
  const host = hostFor(input.environment);
  return await new Promise<{ sent: boolean; reason?: string; status?: number }>((resolve) => {
    const client = http2.connect(`https://${host}`);
    client.on('error', (error) => {
      client.close();
      resolve({ sent: false, reason: error.message });
    });
    const request = client.request({
      ':method': 'POST',
      ':path': `/3/device/${token}`,
      authorization: `bearer ${jwt}`,
      'apns-topic': topic,
      'apns-push-type': 'voip',
      'apns-priority': '10',
      'apns-expiration': '0',
      'content-type': 'application/json',
    });
    let status = 0;
    let responseBody = '';
    request.on('response', (headers) => {
      status = Number(headers[':status'] || 0);
    });
    request.on('data', (chunk) => { responseBody += chunk; });
    request.on('end', () => {
      client.close();
      resolve({ sent: status === 200, status, reason: status === 200 ? undefined : responseBody.slice(0, 200) || `http_${status}` });
    });
    request.end(body);
  });
}
