import { createHash } from 'node:crypto';
import { readObjects, transactObject } from '../../shared/object-store.js';

export type Presence = 'online' | 'busy' | 'offline';
type Lease = { id: string; sequence: number; state: Presence; expiresAt: number };
type Record = { organizationId: string; extensionId: string; devices: Lease[] };
export const presenceLeaseMs = 60_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const path = (organizationId: string, extensionId: string) => {
  if (!organizationId || !extensionId) throw new Error('Presence requires explicit ownership.');
  return `vocivo/presence/v1/${digest(organizationId)}/${digest(extensionId)}.json`;
};
function decode(body: Buffer | undefined | null, organizationId: string, extensionId: string): Record {
  if (!body) return { organizationId, extensionId, devices: [] };
  const record = JSON.parse(body.toString()) as Record;
  if (record.organizationId !== organizationId || record.extensionId !== extensionId || !Array.isArray(record.devices)
    || record.devices.some(device => !device || !['online', 'busy', 'offline'].includes(device.state)
      || !Number.isSafeInteger(device.sequence) || !Number.isFinite(device.expiresAt) || typeof device.id !== 'string')) {
    throw new Error('Invalid presence ownership or record.');
  }
  return record;
}

export function createPresenceStore(storage = { readObjects, transactObject }, now = Date.now) {
  return {
    async update(organizationId: string, extensionId: string, deviceId: string, sequence: number, state: Presence) {
      if (!deviceId || !Number.isSafeInteger(sequence) || sequence < 1 || !['online', 'busy', 'offline'].includes(state)) throw new Error('Invalid presence update.');
      await storage.transactObject(path(organizationId, extensionId), body => {
        const record = decode(body, organizationId, extensionId);
        const time = now();
        // Keep short tombstones so a delayed online request cannot undo offline.
        const devices = record.devices.filter(device => device.expiresAt > time - 300_000);
        const existing = devices.find(device => device.id === deviceId);
        if (existing && sequence <= existing.sequence) return body!;
        if (!existing && devices.length >= 32) throw new Error('Too many presence devices.');
        const lease = { id: deviceId, sequence, state, expiresAt: time + presenceLeaseMs };
        return Buffer.from(JSON.stringify({ ...record, devices: [...devices.filter(device => device.id !== deviceId), lease] }));
      }, { access: 'private', contentType: 'application/json' });
    },
    async read(organizationId: string, extensionIds: string[]) {
      const rows = await storage.readObjects(extensionIds.map(id => path(organizationId, id)));
      return new Map(extensionIds.map(id => {
        const active = decode(rows.get(path(organizationId, id)), organizationId, id).devices.filter(device => device.expiresAt > now());
        const state: Presence = active.some(device => device.state === 'busy') ? 'busy' : active.some(device => device.state === 'online') ? 'online' : 'offline';
        return [id, state];
      }));
    },
  };
}
export const presenceStore = createPresenceStore();
