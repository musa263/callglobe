import type { CallLog } from '../../../shared/types';

type Colleague = { extension: string; name: string; sipUsername?: string };
const phone = /^(?=.*\d)\+?[\d ().-]+$/;
const protocolIdentity = /sips?:|@|^gencred/i;

/** Only use the authenticated tenant directory, never a platform-wide lookup. */
export function normalizeHistoryIdentity(call: CallLog, directory: Colleague[] = []): CallLog {
  const raw = String(call.destination_number || '').trim();
  const username = raw.match(/sips?:([^@;>\s]+)(?:@|;|>|$)/i)?.[1] || raw;
  const colleague = directory.find((user) => Boolean(user.sipUsername) && user.sipUsername === username)
    || directory.find((user) => user.extension === raw);
  const internal = Boolean(colleague || call.internal || call.destination_country === 'Internal' || !phone.test(raw));
  const suppliedName = call.destination_name?.trim();
  const safeName = suppliedName && !protocolIdentity.test(suppliedName) && suppliedName !== username ? suppliedName : undefined;
  if (!internal) return { ...call, destination_name: safeName };
  const extension = colleague?.extension || (/^\d{2,8}$/.test(raw) ? raw : '');
  return {
    ...call,
    destination_number: extension,
    destination_name: colleague?.name || safeName || 'Company extension',
    destination_country: 'Internal',
    internal: true,
  };
}

export function canRedialHistory(call: CallLog) {
  return call.internal ? /^\d{2,8}$/.test(call.destination_number) : phone.test(call.destination_number);
}
