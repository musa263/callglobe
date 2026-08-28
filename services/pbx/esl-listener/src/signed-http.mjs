import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function signBody(secret, timestamp, nonce, body) {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${nonce}.${body}`).digest('hex')}`;
}

export function signaturesMatch(secret, timestamp, nonce, body, signature) {
  const expected = Buffer.from(signBody(secret, timestamp, nonce, body));
  const actual = Buffer.from(signature || '');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function postSignedJson(url, value, secret, { timeoutMs = 5000 } = {}) {
  if (!url) return null;
  const body = canonicalJson(value);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = randomUUID();
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'Vocivo-ESL/1.0',
      'x-vocivo-timestamp': timestamp,
      'x-vocivo-nonce': nonce,
      'x-vocivo-signature': signBody(secret, timestamp, nonce, body),
    },
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const responseBody = await response.text();
  if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
  if (!responseBody) return null;
  try {
    return JSON.parse(responseBody);
  } catch {
    throw new Error('Webhook returned invalid JSON.');
  }
}
