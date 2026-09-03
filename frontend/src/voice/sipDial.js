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
 * call before it was answered. The SIP status is the one fact worth showing:
 * "480" means nobody was reachable, "403" means the edge did not let the call
 * out, "503" means the carrier or the switch was down — and a blank screen
 * meant nothing at all.
 */
export function describeCallRejection(statusCode, reasonPhrase) {
  const code = Number(statusCode) || 0;
  const reason = String(reasonPhrase || '').trim();
  const detail = code ? `${code}${reason ? ` ${reason}` : ''}` : reason;
  if (code === 486 || code === 600) return `The line is busy (${detail}).`;
  if (code === 480 || code === 408 || code === 487) return `No one was available to take the call (${detail}).`;
  if (code === 404 || code === 410 || code === 484) return `That number could not be reached (${detail}).`;
  if (code === 401 || code === 407) return `The phone could not sign in to the calling service (${detail}).`;
  if (code === 402 || code === 403) return `The call was not allowed (${detail}).`;
  if (code >= 500) return `The calling service could not place the call (${detail}).`;
  return detail ? `The call could not be completed (${detail}).` : 'The call could not be completed.';
}
