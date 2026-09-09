import { identityExtension, identityUser, visibleName } from '../engine/callIdentity.js';

/** Directory input must belong to the currently authenticated organization. */
export function describeHistory(item, directory = []) {
  const raw = String(item.address || item.number || '').trim();
  const user = identityUser(raw);
  const explicit = identityExtension(item.number);
  const matches = directory.filter(entry => (entry.sipUsername && entry.sipUsername === user)
    || entry.extension === explicit || entry.extension === user);
  const colleague = matches.length === 1 ? matches[0] : undefined;
  const internal = Boolean(item.internal || colleague || explicit || /^gencred/i.test(user));
  const claimedExtension = item.internal || /^Extension\s/i.test(String(item.number || ''));
  const extension = colleague?.extension || (claimedExtension ? explicit || identityExtension(user) : '');
  const publicNumber = /^\+?[\d ().-]{7,22}$/.test(user) ? user.replace(/[ ().-]/g, '') : '';
  const number = internal ? extension : publicNumber;
  const name = visibleName(colleague?.name) || visibleName(item.name);
  return { name, number, internal, canRedial: Boolean(number) && (!internal || Boolean(colleague)),
    label: name || (extension ? `Extension ${extension}` : publicNumber || (internal ? 'Company colleague' : 'Unknown caller')) };
}

export function historyEntry(call, date = new Date().toISOString()) {
  return { id: call.id || date, number: call.number || '', name: visibleName(call.name),
    address: call.address || '', internal: Boolean(call.internal), direction: call.direction,
    duration: Math.max(0, Number(call.duration) || 0), answered: call.answered ?? Number(call.duration) > 0, date };
}
