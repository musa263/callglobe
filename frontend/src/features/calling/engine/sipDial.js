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

/**
 * What to tell the person when the edge, the switch or the carrier refused a
 * call before it was answered. Protocol diagnostics belong in logs; routine
 * outcomes should not look like application errors.
 */
export function describeCallRejection(statusCode, _reasonPhrase, name = '') {
  const code = Number(statusCode) || 0;
  if (code === 486 || code === 600) return 'The line is busy. Please try again later.';
  if (code === 480 || code === 408) return `${name || 'The person you called'} is unavailable right now. Please try again later.`;
  if (code === 487) return 'Call cancelled.';
  if (code === 603) return 'The call was declined.';
  if (code === 404 || code === 410 || code === 484) return 'That number could not be reached. Check the number and try again.';
  if (code === 401 || code === 407) return 'Your calling session needs to reconnect. Please try again shortly.';
  if (code === 402 || code === 403) return 'This call is not allowed. Contact your company administrator.';
  return 'The calling service could not complete the call. Please try again.';
}

export function isRoutineCallOutcome(code) {
  return [408, 480, 486, 487, 600, 603].includes(Number(code));
}
