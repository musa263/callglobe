import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { del, put, transactObjectGroup } from './object-store.js';
import { readStoredObject } from './stored-object-read.js';
import { requiredEnv } from './http.js';

type ActiveCallRoute = { extensionId: string; parentCallControlId: string; agentCallControlId: string; updatedAt: string };

function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:call-routes`).digest(); }
function encrypt(value: ActiveCallRoute) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decrypt(value: Buffer) {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12)); decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as ActiveCallRoute;
}

export async function saveActiveCallRoute(route: ActiveCallRoute) {
  await put(`vocivo/call-routes/${route.extensionId}.bin`, encrypt(route), { access: 'private', contentType: 'application/octet-stream', allowOverwrite: true });
}

export async function readActiveCallRoute(extensionId: string) {
  try {
    const value = await readStoredObject(`vocivo/call-routes/${extensionId}.bin`);
    return value ? decrypt(value) : null;
  } catch { return null; }
}

export async function clearActiveCallRoute(extensionId: string) {
  await del(`vocivo/call-routes/${extensionId}.bin`);
}

export async function clearActiveCallRouteIfMatches(extensionId: string, agentCallControlId: string) {
  const pathname = `vocivo/call-routes/${extensionId}.bin`;
  return transactObjectGroup(`vocivo:call-route:${extensionId}`, [pathname], (objects) => {
    const stored = objects.get(pathname)?.body;
    if (!stored) return { result: false };
    const route = decrypt(stored);
    if (route.agentCallControlId !== agentCallControlId) return { result: false };
    return { deletes: [pathname], result: true };
  });
}
