import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { list, putMany, readObject, readObjects, transactObjectGroup } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';
import { hasMigrationMarker, listAllStoredPaths, newestFirstTimestamp, overwriteEntries, saveMigrationMarker, tenantStorageKey } from '../../shared/tenant-storage.js';

export type StoredMessage = {
  id: string;
  to: string;
  from: string;
  text: string;
  direction: 'inbound' | 'outbound';
  status: 'sending' | 'sent' | 'received' | 'delivered' | 'failed';
  providerEventId?: string;
  terminal?: boolean;
  createdAt: string;
  error?: string;
  updatedAt: string;
  organizationId: string;
  transport?: 'sms' | 'internal';
  senderExtensionId?: string;
  senderExtension?: string;
  senderName?: string;
  recipientExtensionId?: string;
  recipientExtension?: string;
  recipientName?: string;
};

function key() {
  return createHash('sha256').update(requiredEnv('AUTH_SECRET')).digest();
}

function encrypt(value: StoredMessage) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]);
}

function decrypt(value: Buffer): StoredMessage {
  const decipher = createDecipheriv('aes-256-gcm', key(), value.subarray(0, 12));
  decipher.setAuthTag(value.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8')) as StoredMessage;
}

export function mergeMessageEvent(previous: StoredMessage | undefined, incoming: StoredMessage): StoredMessage {
  if (!previous) return incoming;
  if (previous.id !== incoming.id || previous.organizationId !== incoming.organizationId) throw new Error('Message ownership mismatch.');
  const isTerminal = (item: StoredMessage) => item.terminal === true || ['failed', 'delivered', 'received'].includes(item.status);
  const keepPrevious = (isTerminal(previous) && !isTerminal(incoming))
    || (isTerminal(previous) === isTerminal(incoming) && previous.updatedAt >= incoming.updatedAt);
  const winner = keepPrevious ? previous : incoming;
  const other = keepPrevious ? incoming : previous;
  return { ...other, ...winner,
    text: winner.text || other.text, to: winner.to || other.to, from: winner.from || other.from,
    error: winner.status === 'failed' ? winner.error : undefined,
    createdAt: previous.createdAt < incoming.createdAt ? previous.createdAt : incoming.createdAt,
  };
}

function messageRecordPath(message: StoredMessage) {
  return `vocivo/messages/v4/${tenantStorageKey(message.organizationId)}/records/${createHash('sha256').update(message.id).digest('hex')}.bin`;
}
function messageRecentPath(message: StoredMessage) {
  return `vocivo/messages/v4/${tenantStorageKey(message.organizationId)}/recent/${newestFirstTimestamp(message.createdAt)}-${createHash('sha256').update(message.id).digest('hex')}.bin`;
}

export async function storeMessageEvent(message: StoredMessage, transaction = transactObjectGroup) {
  const organizationId = message.organizationId.trim();
  if (!organizationId) throw new Error('A tenant organization is required before storing a message.');
  const incoming = { ...message, organizationId };
  const pathname = messageRecordPath(incoming);
  await transaction(pathname, [pathname], current => {
    const row = current.get(pathname);
    const previous = row ? decrypt(row.body) : undefined;
    const merged = mergeMessageEvent(previous, incoming);
    if (previous && JSON.stringify(previous) === JSON.stringify(merged)) return { result: undefined };
    const recent = messageRecentPath(merged);
    return {
      puts: overwriteEntries([{ pathname, value: encrypt(merged) }, { pathname: recent, value: encrypt(merged) }]),
      deletes: previous && messageRecentPath(previous) !== recent ? [messageRecentPath(previous)] : [],
      result: undefined,
    };
  });
}

export function messageForViewer(item: StoredMessage, viewerExtensionId?: string) {
  if (item.transport !== 'internal') return { ...item, transport: 'sms' as const };
  if (!viewerExtensionId || ![item.senderExtensionId, item.recipientExtensionId].includes(viewerExtensionId)) return null;
  const outbound = item.senderExtensionId === viewerExtensionId;
  return {
    ...item,
    direction: outbound ? 'outbound' as const : 'inbound' as const,
    to: `extension:${item.recipientExtension || ''}`,
    from: `extension:${item.senderExtension || ''}`,
    contactName: outbound ? item.recipientName : item.senderName,
  };
}

export async function listStoredMessages(organizationId: string, viewerExtensionId?: string) {
  const tenantKey = tenantStorageKey(organizationId);
  const marker = `vocivo/migrations/messages-v3/${tenantKey}.marker`;
  if (!await hasMigrationMarker(marker)) {
    const legacyPaths = [...new Set([
      ...await listAllStoredPaths('vocivo/messages/v2/'),
      ...await listAllStoredPaths('vocivo/messages/', 10_000),
    ].filter((pathname) => !pathname.startsWith('vocivo/messages/v3/') && !pathname.startsWith('vocivo/messages/v4/')))];
    const legacyObjects = await readObjects(legacyPaths);
    const tenantEvents = legacyPaths.map((pathname) => {
      try { const value = legacyObjects.get(pathname); return value ? decrypt(value) : null; } catch { return null; }
    }).filter((item): item is StoredMessage => item !== null && item.organizationId === organizationId);
    if (tenantEvents.length) {
      await putMany(overwriteEntries(tenantEvents.map((message) => ({
        pathname: `vocivo/messages/v3/${tenantKey}/${newestFirstTimestamp(message.updatedAt || message.createdAt)}-${createHash('sha256').update(`${message.id}:${message.updatedAt}`).digest('hex').slice(0, 20)}.bin`,
        value: encrypt({ ...message, organizationId }),
      }))));
    }
    await saveMigrationMarker(marker);
  }
  const projectionMarker = `vocivo/migrations/messages-v4/${tenantKey}.json`;
  type Progress = { cursor?: string; done?: boolean };
  const rawProgress = await readObject(projectionMarker);
  const progress: Progress = rawProgress ? JSON.parse(rawProgress.toString('utf8')) : {};
  if (!progress.done) {
    // Bound migration work per request. A large history must not time out every read.
    const page = await list({ prefix: `vocivo/messages/v3/${tenantKey}/`, limit: 50, cursor: progress.cursor });
    const objects = await readObjects(page.blobs.map(blob => blob.pathname));
    for (let offset = 0; offset < page.blobs.length; offset += 5) {
      await Promise.all(page.blobs.slice(offset, offset + 5).map(async blob => {
        const body = objects.get(blob.pathname);
        if (!body) throw new Error('Message history migration could not read an event.');
        const event = decrypt(body);
        if (event.organizationId === organizationId) await storeMessageEvent(event);
      }));
    }
    await transactObjectGroup(projectionMarker, [projectionMarker], current => {
      const row = current.get(projectionMarker);
      const latest: Progress = row ? JSON.parse(row.body.toString('utf8')) : {};
      // A concurrent request that completed a later page must never be rolled back.
      if (latest.done || latest.cursor !== progress.cursor) return { result: undefined };
      return { puts: [{ pathname: projectionMarker, value: Buffer.from(JSON.stringify({ cursor: page.cursor, done: !page.hasMore })) }], result: undefined };
    });
  }
  const recent = await list({ prefix: `vocivo/messages/v4/${tenantKey}/recent/`, limit: 1000 });
  // Serve legacy history during the bounded migration; terminal projections win below.
  const legacy = !progress.done ? await list({ prefix: `vocivo/messages/v3/${tenantKey}/`, limit: 1000 }) : null;
  const blobs = [...recent.blobs, ...(legacy?.blobs || [])];
  const objects = await readObjects(blobs.map((blob) => blob.pathname));
  const events = blobs.map((blob) => {
    try {
      const value = objects.get(blob.pathname);
      return value ? decrypt(value) : null;
    } catch { return null; }
  }).filter((item): item is StoredMessage => Boolean(item));
  const latest = new Map<string, StoredMessage>();
  events.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).forEach((event) => {
    latest.set(event.id, mergeMessageEvent(latest.get(event.id), event));
  });
  return [...latest.values()]
    .filter((item) => item.organizationId === organizationId)
    .map((item) => messageForViewer(item, viewerExtensionId))
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200);
}
