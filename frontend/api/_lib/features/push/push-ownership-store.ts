import { createHash } from 'node:crypto';
import { list, readObjects, transactObjectGroup } from '../../shared/object-store.js';

type RecordOwner = { id: string; organizationId: string; extensionId: string; updatedAt: string };
type Owner = { recordPath: string; updatedAt: string };
export type PushStorage = Pick<typeof import('../../shared/object-store.js'), 'list' | 'readObjects' | 'transactObjectGroup'>;
const storage: PushStorage = { list, readObjects, transactObjectGroup };
const privateObject = { access: 'private' as const, contentType: 'application/octet-stream', allowOverwrite: true };

/** One physical delivery address has one current owner, across tenants and devices. */
export function createOwnedPushStore<T extends RecordOwner>(config: {
  root: string;
  scope: (organizationId: string, extensionId: string) => string;
  pathname: (record: RecordOwner) => string;
  destination: (record: T) => string;
  encrypt: (record: T) => Buffer;
  decrypt: (body: Buffer) => T;
}, deps: PushStorage = storage) {
  const ownerPath = (record: T) => `${config.root}owners/${createHash('sha256').update(config.destination(record)).digest('hex')}.bin`;
  const decodeOwner = (body?: Buffer): Owner | undefined => {
    if (!body) return undefined;
    const value = JSON.parse(body.toString('utf8')) as Owner;
    if (typeof value.recordPath !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('Invalid push ownership record.');
    return value;
  };
  const readRecords = async (prefix: string) => {
    const records: T[] = [];
    let cursor: string | undefined;
    let scanned = 0;
    do {
      const page = await deps.list({ prefix, cursor, limit: 1000 });
      scanned += page.blobs.length;
      if (scanned > 20000) throw new Error('Push ownership migration requires offline processing.');
      const bodies = await deps.readObjects(page.blobs.map(blob => blob.pathname));
      for (const blob of page.blobs) {
        // Ownership records share the provider root but contain no push secret.
        if (blob.pathname.startsWith(`${config.root}owners/`)) continue;
        const body = bodies.get(blob.pathname);
        if (!body) continue;
        const record = config.decrypt(body);
        if (config.pathname(record) !== blob.pathname || !Number.isFinite(Date.parse(record.updatedAt))) throw new Error('Invalid stored push registration.');
        records.push(record);
      }
      if (page.hasMore && (!page.cursor || page.cursor === cursor)) throw new Error('Push registration pagination did not advance.');
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return records;
  };

  const ensureOwners = async (records: T[]) => {
    const keys = [...new Set(records.map(ownerPath))];
    const owners = await deps.readObjects(keys);
    const missing = new Set(keys.filter(key => !owners.has(key)));
    if (!missing.size) return owners;
    // Existing installations may already be saved under several extensions.
    // Repair only missing indexes from all legacy owners, not just the callee.
    const winners = new Map<string, Owner>();
    for (const record of await readRecords(config.root)) {
      const key = ownerPath(record);
      if (!missing.has(key)) continue;
      const candidate = { recordPath: config.pathname(record), updatedAt: record.updatedAt };
      const prior = winners.get(key);
      if (!prior || Date.parse(candidate.updatedAt) > Date.parse(prior.updatedAt)) winners.set(key, candidate);
      else if (candidate.updatedAt === prior.updatedAt && candidate.recordPath !== prior.recordPath) {
        // A legacy tie cannot safely identify which login owns the device.
        winners.set(key, { ...candidate, recordPath: '' });
      }
    }
    for (const [key, candidate] of winners) {
      await deps.transactObjectGroup(key, [key], current => ({
        // A live registration/deletion always wins over a migration snapshot.
        puts: current.has(key) ? [] : [{ pathname: key, value: Buffer.from(JSON.stringify(candidate)), options: privateObject }],
        result: undefined,
      }));
    }
    return deps.readObjects(keys);
  };

  return {
    async save(record: T) {
      if (!Number.isFinite(Date.parse(record.updatedAt))) throw new Error('Invalid push registration time.');
      const path = config.pathname(record);
      const key = ownerPath(record);
      await deps.transactObjectGroup(key, [key, path], current => {
        const prior = decodeOwner(current.get(key)?.body);
        // Do not let a delayed older request take ownership back.
        if (prior && Date.parse(prior.updatedAt) > Date.parse(record.updatedAt)) return { result: undefined };
        return { puts: [
          { pathname: path, value: config.encrypt(record), options: privateObject },
          { pathname: key, value: Buffer.from(JSON.stringify({ recordPath: path, updatedAt: record.updatedAt })), options: privateObject },
        ], result: undefined };
      });
    },
    async list(organizationId: string, extensionId: string) {
      const records = await readRecords(config.scope(organizationId, extensionId));
      const owners = await ensureOwners(records);
      const cutoff = Date.now() - 45 * 86400_000;
      return records.filter(record => {
        const owner = decodeOwner(owners.get(ownerPath(record)));
        return record.organizationId === organizationId && record.extensionId === extensionId
          && Date.parse(record.updatedAt) >= cutoff && owner?.recordPath === config.pathname(record)
          && owner.updatedAt === record.updatedAt;
      });
    },
    async remove(input: Omit<RecordOwner, 'updatedAt'> & { updatedAt?: string }) {
      const path = config.pathname({ ...input, updatedAt: input.updatedAt || '' });
      const body = (await deps.readObjects([path])).get(path);
      if (!body) return;
      const record = config.decrypt(body);
      await ensureOwners([record]);
      await deps.transactObjectGroup(path, [path], current => {
        const stored = current.get(path)?.body;
        if (!stored || (input.updatedAt && config.decrypt(stored).updatedAt !== input.updatedAt)) return { result: undefined };
        // Retain the owner pointer as a tombstone: deleting a current device
        // must never reactivate an older record under another extension.
        return { deletes: [path], result: undefined };
      });
    },
  };
}
