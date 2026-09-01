const e164 = /^\+[1-9]\d{6,14}$/;
const sipUser = /^sip:([^@;>\s]+)@/i;

export function sipUserFromUri(destination) {
  const match = String(destination || '').trim().match(sipUser);
  return match ? match[1] : '';
}

export function sipTargetUri(destination, domain) {
  const value = String(destination || '').trim();
  if (e164.test(value)) return `sip:${value}@${domain}`;
  if (/^sip:/i.test(value)) {
    const user = sipUserFromUri(value);
    if (user && domain) return `sip:${user}@${domain}`;
    if (user) return value;
  }
  if (/^[A-Za-z0-9_.-]+$/.test(value)) return `sip:${value}@${domain}`;
  throw new Error('That destination cannot be dialed on the Vocivo SIP edge.');
}

export function describeSipSession(session) {
  const remote = session?.remoteIdentity || session?.assertedIdentity || {};
  const uri = String(remote.uri || remote.raw || '');
  const user = uri.replace(/^sip:/i, '').split('@')[0];
  return {
    name: String(remote.displayName || user || 'Phone call'),
    number: user,
    internal: !e164.test(user.startsWith('+') ? user : `+${user}`),
  };
}
