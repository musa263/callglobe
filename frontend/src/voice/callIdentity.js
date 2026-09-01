export function callHeader(call, name) {
  const headers = call?.options?.customHeaders || call?.options?.dialogParams?.customHeaders || [];
  const header = headers.find((item) => (
    String(item?.name || item?.header_name || '').toLowerCase() === name.toLowerCase()
  ));
  return header?.value || header?.header_value;
}

export function describeRemote(call, fallbackNumber = '') {
  const rawNumber = call?.options?.remoteCallerNumber
    || call?.options?.callerNumber
    || call?.options?.destinationNumber
    || fallbackNumber;
  const rawName = call?.options?.remoteCallerName || call?.options?.callerName || '';
  const displayMatch = String(rawName).trim().match(/^(.+?)\s*-\s*Ext(?:ension)?\s+(\d{2,5})$/i);
  const extension = callHeader(call, 'X-Vocivo-Caller-Extension') || displayMatch?.[2];
  const employeeName = callHeader(call, 'X-Vocivo-Caller-Name') || displayMatch?.[1];
  const safeNumber = String(rawNumber || '').startsWith('sip:') ? 'Internal call' : rawNumber;
  return {
    name: employeeName || rawName || (extension ? 'Company colleague' : 'Phone call'),
    number: extension ? `Extension ${extension}` : safeNumber || 'Unknown caller',
    internal: Boolean(extension || callHeader(call, 'X-Vocivo-Call-Type') === 'internal'),
    photoUrl: callHeader(call, 'X-Vocivo-Caller-Photo') || '',
  };
}

export function describeIncoming(call, fallbackNumber = '') {
  if (call?.options || call?.direction) return describeRemote(call, fallbackNumber);
  const uri = String(call?.remoteIdentity?.uri || '');
  const user = uri.replace(/^sip:/i, '').split('@')[0];
  const displayName = String(call?.remoteIdentity?.displayName || '').trim();
  const extensionMatch = displayName.match(/extension\s+(\d{2,5})/i);
  return {
    name: displayName || (user ? 'Company colleague' : 'Incoming call'),
    number: extensionMatch ? `Extension ${extensionMatch[1]}` : (user && !user.startsWith('gencred') ? user : 'Internal call'),
    internal: true,
    photoUrl: '',
  };
}

export function getCallId(call) {
  return call?.id || call?.callId || '';
}
