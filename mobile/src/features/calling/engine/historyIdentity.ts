import type { CallLog } from '../../../shared/types';
import { identityExtension, identityUser, visibleCallerName } from './callIdentity';

type Colleague = { extension: string; name: string; sipUsername?: string };
const phone = /^(?=.*\d)\+?[\d ().-]+$/;

/** Only use the authenticated tenant directory, never a platform-wide lookup. */
export function normalizeHistoryIdentity(call: CallLog, directory: Colleague[] = []): CallLog {
  const raw = String(call.destination_number || '').trim();
  const username = identityUser(raw);
  const explicit = identityExtension(raw);
  const matches = directory.filter((user) => (Boolean(user.sipUsername) && user.sipUsername === username)
    || user.extension === explicit || user.extension === username);
  const colleague = matches.length === 1 ? matches[0] : undefined;
  const internal = Boolean(colleague || call.internal || call.destination_country === 'Internal' || !phone.test(raw));
  const suppliedName = visibleCallerName(call.destination_name);
  const safeName = suppliedName && suppliedName !== username ? suppliedName : undefined;
  if (!internal) return { ...call, destination_name: safeName };
  const extension = colleague?.extension || explicit || (internal ? identityExtension(username) : '');
  return {
    ...call,
    destination_number: extension,
    destination_name: visibleCallerName(colleague?.name) || safeName || 'Company extension',
    destination_country: 'Internal',
    internal: true,
  };
}

export function canRedialHistory(call: CallLog) {
  return call.internal ? /^\d{2,5}$/.test(call.destination_number) : phone.test(call.destination_number);
}
