export function callHeader(call, name) {
  const sipHeader = call?.request?.getHeader?.(name);
  if (sipHeader) return String(sipHeader).trim();
  const headers = call?.options?.customHeaders || call?.options?.dialogParams?.customHeaders || [];
  const header = headers.find((item) => (
    String(item?.name || item?.header_name || '').toLowerCase() === name.toLowerCase()
  ));
  return String(header?.value || header?.header_value || '').trim();
}

export function identityUser(value) {
  const raw = String(value || '').trim();
  return raw.match(/sips?:([^@;>\s]+)(?:@|;|>|$)/i)?.[1] || raw;
}

export function visibleName(value) {
  const name = String(value || '').trim();
  return !name || /sips?:|@|gencred|[\x00-\x1f\x7f]/i.test(name)
    || /^[\da-f]{8}-(?:[\da-f-]{27,})$/i.test(name)
    || /^(unknown(?: caller)?|internal call|phone call|incoming call)$/i.test(name) ? '' : name;
}

export function identityExtension(value) {
  return String(value || '').trim().match(/^(?:Extension\s+)?(\d{2,5})$/i)?.[1] || '';
}

export function describeRemote(call, fallbackNumber = '') {
  const rawNumber = call?.options?.remoteCallerNumber
    || call?.options?.callerNumber
    || call?.options?.destinationNumber
    || fallbackNumber;
  const rawName = call?.options?.remoteCallerName || call?.options?.callerName || '';
  const displayMatch = String(rawName).trim().match(/^(.+?)\s*-\s*Ext(?:ension)?\s+(\d{2,5})$/i);
  const extension = identityExtension(callHeader(call, 'X-Vocivo-Caller-Extension')) || displayMatch?.[2];
  const employeeName = callHeader(call, 'X-Vocivo-Caller-Name') || displayMatch?.[1];
  const user = identityUser(rawNumber);
  const safeNumber = /^(?:\+?[\d ().-]+)$/.test(user) ? user : '';
  return {
    name: visibleName(employeeName) || visibleName(rawName) || (extension ? 'Company colleague' : 'Phone call'),
    number: extension ? `Extension ${extension}` : safeNumber || 'Unknown caller',
    internal: Boolean(extension || callHeader(call, 'X-Vocivo-Call-Type') === 'internal'),
    photoUrl: callHeader(call, 'X-Vocivo-Caller-Photo') || '',
    address: String(rawNumber || ''),
  };
}

export function describeIncoming(call, fallbackNumber = '') {
  if (call?.options || call?.direction) return describeRemote(call, fallbackNumber);
  const uri = String(call?.remoteIdentity?.uri || '');
  const user = identityUser(uri);
  const displayName = String(call?.remoteIdentity?.displayName || '').trim();
  const extension = identityExtension(callHeader(call, 'X-Vocivo-Caller-Extension'))
    || displayName.match(/(?:^|\s)Ext(?:ension)?\s+(\d{2,5})$/i)?.[1]
    || identityExtension(user);
  const name = visibleName(callHeader(call, 'X-Vocivo-Caller-Name'))
    || visibleName(displayName.replace(/\s*-\s*Ext(?:ension)?\s+\d{2,5}$/i, ''));
  const publicNumber = /^\+\d{7,15}$/.test(user) ? user : '';
  return {
    name: name || (extension ? 'Company colleague' : 'Incoming call'),
    number: extension ? `Extension ${extension}` : publicNumber || 'Unknown caller',
    internal: Boolean(extension || callHeader(call, 'X-Vocivo-Call-Type') === 'internal' || /^gencred/i.test(user)),
    photoUrl: '',
    address: uri,
  };
}

export function getCallId(call) {
  return call?.id || call?.callId || '';
}
