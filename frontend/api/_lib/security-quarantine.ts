import { createCipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { requiredEnv } from './http.js';
import { put } from './object-store.js';

type QuarantineValue = string | number | boolean | null;

export type SecurityQuarantineEvent = {
  source: 'telnyx-messaging' | 'telnyx-voice' | 'freeswitch-esl';
  reason: string;
  eventId?: string;
  details?: Record<string, QuarantineValue>;
};

function encryptionKey() {
  return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:security-quarantine`).digest();
}

function clean(value: unknown, maximum = 200) {
  return typeof value === 'string' ? value.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
}

export function normalizedQuarantineEvent(input: SecurityQuarantineEvent) {
  const source = input.source;
  const reason = clean(input.reason, 120);
  if (!reason) throw new Error('A quarantine reason is required.');
  const details = Object.fromEntries(Object.entries(input.details || {}).slice(0, 20).map(([name, value]) => [
    clean(name, 60),
    typeof value === 'string' ? clean(value, 500) : value,
  ]).filter(([name]) => Boolean(name)));
  return {
    id: randomUUID(),
    source,
    reason,
    eventId: clean(input.eventId, 160),
    details,
    quarantinedAt: new Date().toISOString(),
  };
}

export async function quarantineSecurityEvent(input: SecurityQuarantineEvent) {
  const event = normalizedQuarantineEvent(input);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(event), 'utf8'), cipher.final()]);
  const body = Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
  const date = event.quarantinedAt.slice(0, 10);
  const identifier = createHash('sha256').update(`${event.id}:${event.eventId}`).digest('hex').slice(0, 24);
  await put(`vocivo/security/quarantine/${date}/${identifier}.bin`, body, { access: 'private', contentType: 'application/octet-stream' });
  return event.id;
}
