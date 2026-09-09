import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { readObject, transactObject } from '../../shared/object-store.js';
import { requiredEnv } from '../../shared/http.js';

export type Meeting = { id: string; title: string; kind: 'call' | 'video'; startsAt: string; durationMinutes: number;
  timeZone: string; destination: string; roomId: string; notes: string; version: number; updatedAt: string };
type Scope = { organizationId: string; ownerId: string };
type Record = Scope & { meetings: Meeting[] };
export class MeetingError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
export function validateMeeting(input: unknown, now = Date.now()): Omit<Meeting, 'version' | 'updatedAt'> {
  if (!input || typeof input !== 'object') throw new MeetingError('Meeting details are required.');
  const value = input as Partial<Meeting>;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length <= max && !/[\x00-\x08\x0b-\x1f\x7f]/.test(v) ? v.trim() : '';
  const id = text(value.id, 36); const title = text(value.title, 120); const notes = text(value.notes ?? '', 2000);
  const startsAt = text(value.startsAt, 30); const stamp = Date.parse(startsAt);
  const timeZone = text(value.timeZone, 100); const destination = text(value.destination || '', 24); const roomId = text(value.roomId || '', 36);
  if (!uuid.test(id) || !title || !['call', 'video'].includes(value.kind || '')) throw new MeetingError('Enter a title and valid meeting type.');
  if (!Number.isFinite(stamp) || !/(Z|[+-]\d{2}:\d{2})$/.test(startsAt) || stamp < now - 60_000 || stamp > now + 2 * 366 * 86400_000) throw new MeetingError('Choose a future date within the next two years.');
  if (!Number.isInteger(value.durationMinutes) || value.durationMinutes! < 5 || value.durationMinutes! > 240) throw new MeetingError('Duration must be between 5 and 240 minutes.');
  try { if (!timeZone) throw new Error(); new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new MeetingError('Choose a valid time zone.'); }
  if (typeof value.notes !== 'undefined' && (typeof value.notes !== 'string' || value.notes.trim() !== notes)) throw new MeetingError('Notes contain unsupported text or exceed 2,000 characters.');
  if (value.kind === 'call' && !/^(?:\d{2,5}|\+[1-9]\d{6,14})$/.test(destination)) throw new MeetingError('Enter a company extension or a full international phone number.');
  if (value.kind === 'video' && !uuid.test(roomId)) throw new MeetingError('A valid video meeting code is required.');
  return { id, title, kind: value.kind as Meeting['kind'], startsAt: new Date(stamp).toISOString(), durationMinutes: value.durationMinutes!, timeZone,
    destination: value.kind === 'call' ? destination : '', roomId: value.kind === 'video' ? roomId : '', notes };
}
function path(scope: Scope) {
  if (!scope.organizationId?.trim() || !scope.ownerId?.trim()) throw new MeetingError('Unauthorized', 401);
  return `vocivo/meetings/v1/${createHash('sha256').update(JSON.stringify([scope.organizationId, scope.ownerId])).digest('hex')}.bin`;
}
function key() { return createHash('sha256').update(`${requiredEnv('AUTH_SECRET')}:meetings`).digest(); }
function encode(record: Record, pathname: string) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(), iv);
  cipher.setAAD(Buffer.from(pathname));
  const body = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}
function decode(body: Buffer | null, scope: Scope): Record {
  if (!body) return { ...scope, meetings: [] };
  const decipher = createDecipheriv('aes-256-gcm', key(), body.subarray(0, 12));
  decipher.setAAD(Buffer.from(path(scope))); decipher.setAuthTag(body.subarray(12, 28));
  const record = JSON.parse(Buffer.concat([decipher.update(body.subarray(28)), decipher.final()]).toString()) as Record;
  if (record.organizationId !== scope.organizationId || record.ownerId !== scope.ownerId || !Array.isArray(record.meetings)) throw new Error('Invalid meeting ownership.');
  return record;
}
export function createMeetingStore(storage = { readObject, transactObject }) {
  return {
    async list(scope: Scope) { return decode(await storage.readObject(path(scope)), scope).meetings.sort((a, b) => a.startsAt.localeCompare(b.startsAt)); },
    async save(scope: Scope, value: Omit<Meeting, 'version' | 'updatedAt'>, version?: number) {
      const pathname = path(scope);
      const result = await storage.transactObject(pathname, body => {
        const record = decode(body, scope); const existing = record.meetings.find(item => item.id === value.id);
        if (existing && version === undefined) {
          const { version: _version, updatedAt: _date, ...previous } = existing;
          if (JSON.stringify(previous) === JSON.stringify(value)) return body!;
          throw new MeetingError('This meeting already exists. Refresh before editing.', 409);
        }
        if (version !== undefined && (!existing || existing.version !== version)) throw new MeetingError('This meeting changed in another window. Refresh and try again.', 409);
        if (!existing && record.meetings.length >= 200) throw new MeetingError('Remove an old meeting before adding another.', 409);
        const meeting = { ...value, version: (existing?.version || 0) + 1, updatedAt: new Date().toISOString() };
        return encode({ ...record, meetings: [...record.meetings.filter(item => item.id !== value.id), meeting] }, pathname);
      }, { access: 'private', contentType: 'application/octet-stream' });
      return decode(result.body, scope).meetings.find(item => item.id === value.id)!;
    },
    async remove(scope: Scope, id: string, version: number) {
      const pathname = path(scope);
      await storage.transactObject(pathname, body => {
        const record = decode(body, scope); const existing = record.meetings.find(item => item.id === id);
        if (!existing) return body || encode(record, pathname);
        if (existing.version !== version) throw new MeetingError('This meeting changed in another window. Refresh and try again.', 409);
        return encode({ ...record, meetings: record.meetings.filter(item => item.id !== id) }, pathname);
      }, { access: 'private', contentType: 'application/octet-stream' });
    },
  };
}
export const meetingStore = createMeetingStore();
